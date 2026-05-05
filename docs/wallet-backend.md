# Wallet backend — readiness audit

> Last update: samas-0.4.13 (Manuel asked: "is all the backend
> there?" before integrating real money rails).

## TL;DR

The data plumbing is DONE. The bank-rail integration (Mercado
Pago, CBU webhooks, real FX feed) is the work that's left and is
mostly partner-dependent.

## What's there ✅

### Tables (Supabase, all RLS-scoped per user)

| Table | Purpose |
|---|---|
| `public.accounts` | Cash balance per user × currency (ARS, USD) |
| `public.transactions` | Signed-amount ledger — every cash flow lands here |
| `public.wallet_credits` | Audit log for non-trade credits (aporte, manual top-ups) |
| `public.recurring_aportes` | Monthly aporte schedule (amount, currency, day_of_month) |
| `public.holdings` | Per-ticker positions (qty, avg_cost) |
| `public.orders` | Order audit (filled/pending/cancelled, broker_ref column ready for Cohen integration) |

### Triggers (the propagation glue)

| Trigger | Effect |
|---|---|
| `transactions_to_balance_trg` | After insert on `transactions` → upsert `accounts.balance += amount`. Single source of truth. samas-0.4.13. |
| `wallet_credits_propagate_trg` | After insert on `wallet_credits` → insert into `transactions` (which then triggers the balance update). samas-0.4.7, refactored 0.4.13. |
| `objectives_archive_prior_trg` | After insert on `objectives` → archive prior active row per user. |

### Edge Functions

| Function | Purpose |
|---|---|
| `process-recurring-aportes` | Daily cron. Reads `recurring_aportes` where `next_due <= today`, inserts into `wallet_credits`, advances `next_due`. Cron is active at 12:00 UTC. |
| `check-price-alerts` | Every 2 minutes. Fires push notifications when targets hit. |
| `send-push` | APNs delivery (deployed in 0.4.3). |
| `delete-user-account`, `export-user-data` | Apple Guideline 5.1.1(v) compliance. |

### Client API (`src/v2/api/wallet.js`)

- `getBalance()` — { ars, usd } from `accounts`.
- `getTransactions({ limit, before })` — paginated ledger query.
- `deposit({ amount, ccy, source })` — mock-instant. Real semantics: returns payment-intent URL.
- `withdraw({ amount, ccy, destinationCbu, destinationAlias })` — debits balance + writes ledger row.
- `swap({ from, to, amountFrom, rate })` — two ledger rows (out leg + in leg), atomic per the trigger.
- `getRecurringAporte()`, `setRecurringAporte()`, `cancelRecurringAporte()`.

### Realtime

- `transactions` realtime subscription on Wallet page (samas-0.4.10) — any new row triggers a refresh, balance + Movimientos update within ~200ms.

### Aporte mensual

End-to-end: schedule → cron fires daily → wallet_credits insert → trigger propagates to transactions → trigger propagates to balance → realtime subscription wakes the UI → Movimientos shows the row + balance updates. Verified end-to-end in 0.4.7 + 0.4.13.

## What's still missing ❌ (real-money integration scope)

These are partner-dependent or external-vendor work:

### Bank rails

- **Mercado Pago checkout integration**: `deposit({source: 'mp'})` returns a mock URL. Real flow needs:
  - MP merchant account (Manuel's, or Cohen's white-labelled).
  - `create-payment-preference` Edge Function that calls MP's API.
  - MP webhook (`POST /functions/v1/mp-webhook`) that listens for `payment.updated` events, verifies signature, inserts `wallet_credits` row.
- **CBU/CVU withdrawal rails**: `withdraw()` writes the ledger row but no actual money moves. Real flow needs:
  - Partner that can debit `accounts.balance` and push pesos via PIX/CBU/CVU. (In Argentina this is typically a fintech partner like Galicia BIND, GeoPagos, or directly through the ALyC.)
  - Status state machine on `transactions.status` (currently always implicit "settled"; would need `pending` → `settled` / `failed` transitions on the partner's webhook).

### FX / swap

- `swap()` accepts whatever rate the caller passes in. Real flow needs:
  - Daily MEP / CCL / oficial feed (could come from Cohen's FX desk or a public market data API).
  - Spread + fee model (we charge X bps over mid).
  - Settlement T+0 vs T+1 (MEP is usually T+1; UI should show "pendiente" if not same-day).

### Cards

- `getCard()` returns a mock card (`src/v2/api/card.js`). No `cards` table exists. If we want a real virtual debit card (think Brubank / Ualá Bis) we'd need:
  - Card-issuer partner (Galicia, Ualá-as-a-service, Pomelo).
  - `cards` table: card_id, last4, status, frozen flag, daily_limit, created_at.
  - Card-transactions feed → also lands in `transactions` (the trigger handles balance automatically).

### KYC / regulatory

- Currently we let users sign up with email + phone OTP only. Real money flow needs:
  - DNI/CUIT capture and verification (likely via Cohen's KYC pipeline since they're the ALyC of record).
  - Source-of-funds attestation for deposits over a threshold (UIF requirement).
  - Sanction-list screening (typically the partner does this).

### Reconciliation

- We're the source of truth right now. In a real partner flow, the **partner** is the source of truth and we mirror.
- Need: a reconciliation job that pulls partner balances daily and asserts they match `accounts.balance`. Discrepancies log to a `reconciliation_breaks` table for human review.

### Fraud / limits

- No daily / per-transaction limits today. Real flow needs:
  - Velocity rules (max N withdrawals per day, max amount).
  - Anomaly detection (deposit pattern matches money laundering heuristics).
  - Most of this lives at the partner; we just need to surface their failures cleanly.

## What we just fixed in 0.4.13

The `placeOrder` → `accounts.balance` bug. Manuel's actual data showed the divergence:

```
ARS accounts.balance:        6244
SUM(transactions.amount):   -841,500
```

Trades had been hitting `transactions` since launch but skipping `accounts.balance` entirely. Fixed by adding a `transactions_to_balance` trigger so any insert into `transactions` propagates atomically.

For Manuel's stale data: the cleanest reset is **Settings → "Resetear cuenta demo"** (zeros everything, then re-seeds the demo). New trades from now on move balance correctly.

## Recommendation for next steps

If you want to integrate real money rails next, the right order is:

1. **Pick a deposit partner** (Mercado Pago is the obvious AR choice). Build `mp-webhook` Edge Function. Wire `deposit({source:"mp"})` to return real preference URLs.
2. **Decide on FX source**. Easiest: scrape `dolarapi.com` daily, store in a new `fx_rates` table, swap reads from there.
3. **Withdrawal partner** — usually whoever processes deposits also processes withdrawals. Same webhook pattern.
4. **Reconciliation job** — once real money flows, add a daily sync that pulls partner balances and asserts they match.

These are 3-5 patches each, partner-dependent. Cohen integration probably gives us most of these for free since they're already plumbed for ARG retail ALyC operations.
