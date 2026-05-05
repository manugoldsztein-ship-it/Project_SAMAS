# Aporte automático — backend setup

The frontend already creates / edits / cancels recurring aportes against `public.recurring_aportes`. To actually fire the credits on the scheduled day, three things have to land in your Supabase project.

## 1. Apply the SQL migration

```bash
psql "$SUPABASE_DB_URL" -f supabase/recurring_aportes.sql
```

Or paste the file contents into the SQL editor at <https://app.supabase.com/project/_/sql>.

The migration creates:

- `public.recurring_aportes` — one active row per user (amount, currency, day_of_month, next_due, last_credited_at).
- `public.wallet_credits` — append-only ledger the cron writes to on each successful fire.
- RLS so users only see their own rows.

## 2. Deploy the Edge Function

```bash
supabase functions deploy process-recurring-aportes
```

Smoke-test it manually before scheduling — replace `<PROJECT>` and `<SERVICE_ROLE_KEY>`:

```bash
curl -X POST "https://<PROJECT>.supabase.co/functions/v1/process-recurring-aportes" \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json"
```

Expected response shape:

```json
{ "today": "2026-04-27", "fired": 0, "skippedIdempotent": 0, "errors": [] }
```

If you have a row with `next_due <= today`, `fired` will increment and a `wallet_credits` row will appear.

## 3. Schedule the cron

In the Supabase SQL editor:

```sql
-- pg_cron is enabled by default on paid plans. On free, the
-- "Database → Extensions" page has a one-click toggle.
select cron.schedule(
  'samas-process-aportes',
  '0 6 * * *',                         -- daily at 06:00 AR (09:00 UTC)
  $$
    select net.http_post(
      url     := 'https://<PROJECT>.supabase.co/functions/v1/process-recurring-aportes',
      headers := jsonb_build_object(
        'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
        'Content-Type', 'application/json'
      ),
      body    := '{}'::jsonb
    );
  $$
);
```

Why 06:00 AR: aportes are calendar-day events, and the user expects them to be there when they wake up. Running at the start of the local morning gives the function the whole day to retry on transient failures (the function is idempotent — if it re-fires it skips rows whose `last_credited_at` is already today).

To pause: `select cron.unschedule('samas-process-aportes');`
To inspect last runs: `select * from cron.job_run_details where jobname = 'samas-process-aportes' order by start_time desc limit 5;`

## 4. Verify end-to-end

1. Open the app, set up an aporte (Wallet → Aporte mensual → set amount + day).
2. In Supabase SQL editor, check the row landed: `select * from public.recurring_aportes;`.
3. Manually fast-forward by setting `next_due` to today: `update public.recurring_aportes set next_due = current_date where user_id = '<your_uuid>';`.
4. Trigger the function via the curl above, or wait for the cron.
5. Check `select * from public.wallet_credits where user_id = '<your_uuid>';` — there should be a new row.
6. Reload the app — the "Aporte mensual" card should show "Último: <today's date>".

## Future work

- Wire `send-push` so the user gets a notification on each successful credit.
- Pull from a real linked bank account (CVU debit) instead of the symbolic credit. The cron already has the user_id + amount + currency at that point, so it's a one-call addition.
- Multi-aporte support — drop the `unique(user_id)` constraint once we let users schedule both an ARS and a USD aporte side by side.
