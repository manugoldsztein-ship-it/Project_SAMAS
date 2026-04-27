# Push notifications — end-to-end setup

The code is in place. To actually deliver pushes you need to wire three things outside the repo:

1. An **APNs Auth Key** from Apple Developer (one-time, used for the lifetime of the app).
2. Three **Supabase secrets** + the two new **Edge Functions** deployed.
3. **Push Notifications capability** enabled in Xcode + a **cron schedule** for the alert checker.

Plan on ~30 minutes if you have Xcode and a Supabase CLI ready.

---

## 1. Create the APNs Auth Key (Apple Developer)

You need a paid Apple Developer membership for this.

1. Go to <https://developer.apple.com/account/resources/authkeys/list>.
2. Click the **+** to create a new key.
3. Name it `SAMAS Push` (or whatever — the name is just for you).
4. Tick **Apple Push Notifications service (APNs)**. Leave the other capabilities alone.
5. **Continue → Register → Download**. You get a `.p8` file like `AuthKey_AB12CD34EF.p8`. **You can only download it once** — store it somewhere safe.
6. From the same page, copy:
   - **Key ID** (the 10-char string in the filename, e.g. `AB12CD34EF`).
   - **Team ID** (top-right of <https://developer.apple.com/account>, also 10 chars).

Bundle ID for SAMAS is `app.samas.broker` (matches `capacitor.config.json` and Xcode).

---

## 2. Set Supabase secrets

From the `Project_SAMAS` directory (the Supabase CLI must be logged in: `supabase login`):

```bash
# Paste the .p8 contents — keep the BEGIN/END lines, escape the
# newlines as \n if your shell mangles them. The function code already
# replaces \n back into real newlines.
supabase secrets set APNS_PRIVATE_KEY="$(cat path/to/AuthKey_AB12CD34EF.p8)"

supabase secrets set APNS_TEAM_ID=YOUR_TEAM_ID
supabase secrets set APNS_KEY_ID=AB12CD34EF
supabase secrets set APNS_BUNDLE_ID=app.samas.broker

# "true" while debugging on TestFlight or a development device
# (uses api.sandbox.push.apple.com). Flip to "false" for App Store.
supabase secrets set APNS_USE_SANDBOX=true
```

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_ANON_KEY` are auto-provisioned in the function runtime — don't set them manually.

---

## 3. Apply the SQL migrations

```bash
psql "$SUPABASE_DB_URL" -f supabase/device_tokens.sql
psql "$SUPABASE_DB_URL" -f supabase/price_alerts.sql
```

Or paste each file into the SQL editor at <https://app.supabase.com/project/_/sql>.

---

## 4. Deploy the Edge Functions

```bash
supabase functions deploy send-push
supabase functions deploy check-price-alerts
```

Quick smoke test for `send-push` (replace `USER_ID` with a real auth.users row that has at least one device token):

```bash
curl -X POST "$SUPABASE_URL/functions/v1/send-push" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"userId":"USER_ID","title":"Test","body":"Hola desde SAMAS"}'
```

You should see `{ "status": "ok", "sent": 1, "pruned": 0, "errors": [] }`.

---

## 5. Schedule the alert checker

In the Supabase SQL editor:

```sql
-- pg_cron is enabled by default on paid plans. On free, the
-- "Database → Extensions" page has a one-click toggle.
select cron.schedule(
  'samas-check-price-alerts',
  '*/2 * * * *',                          -- every 2 minutes
  $$
    select net.http_post(
      url     := 'https://<PROJECT>.supabase.co/functions/v1/check-price-alerts',
      headers := jsonb_build_object(
        'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
        'Content-Type', 'application/json'
      ),
      body    := '{}'::jsonb
    );
  $$
);
```

Replace `<PROJECT>` with your project ref and `<SERVICE_ROLE_KEY>` with the value from Project Settings → API. To pause the cron: `select cron.unschedule('samas-check-price-alerts');`.

---

## 6. Enable Push Notifications in Xcode

1. Open `ios/App/App.xcworkspace`.
2. Select the **App** target → **Signing & Capabilities** tab.
3. Click **+ Capability** and pick **Push Notifications**.
4. While you're there, also add **Background Modes** and tick:
   - **Remote notifications** — lets iOS wake the app for silent pushes (we don't use this yet, but it's free and avoids a future re-sign).
5. Also confirm **Provisioning** is automatic and the team is set. Capability changes regenerate the provisioning profile.

Run `npx cap sync ios` once after the capability changes — this ensures the entitlements file gets picked up by the Capacitor build.

---

## 7. Test on a real device

The simulator does NOT receive APNs pushes. You need a physical iPhone signed into the same Apple ID as your dev account.

1. Xcode → Play (⌘R) on a real device.
2. Open the app, complete login, unlock with PIN.
3. Avatar → Ajustes → toggle **Notificaciones push** on. iOS prompts for permission — accept.
4. Set a price alert that's already triggered (e.g. AAPL above $1) so the cron fires it on the next tick.
5. Lock the phone. Within ~2 minutes you should see a banner.

If you're not seeing pushes:

- Check the function logs: `supabase functions logs send-push --tail`
- Check the cron last-run via `select * from cron.job_run_details order by start_time desc limit 5;`
- Verify the device token landed: `select * from public.device_tokens;` (should have one row per device).
- Verify your Apple Push environment matches `APNS_USE_SANDBOX` — Xcode-signed builds = sandbox; TestFlight + App Store = production.

---

## 8. Going to production

When you ship to TestFlight or the App Store:

```bash
supabase secrets set APNS_USE_SANDBOX=false
```

That single change flips the function from `api.sandbox.push.apple.com` to `api.push.apple.com`. The same `.p8` key works for both environments.
