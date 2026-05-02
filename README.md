# SAMAS

The app of the future — for the investors of today.

SAMAS is a trading and social prototype built as a single-file Vite + React
build: simulated portfolio, real-time optional quotes (Finnhub), multi-asset
coverage of the Argentine market (Acciones, CEDEAR, ETFs, Bonos, ONs, FCI),
and **19 native AI features** powered by Edge Functions on Supabase.

<p align="center">
  <em>Portfolio simulator · Live quotes · AI advisor · AI objectives · AI news sentiment · Pattern detector · Trade journal</em>
</p>

## Quick start

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually `http://localhost:5173`). You can also
produce a single-file HTML bundle:

```bash
npm run build      # writes dist/index.html, fully self-contained
npm run preview    # serve the built file locally
```

For iOS:

```bash
npm run build:cap
npx cap sync ios
npx cap open ios
```

## AI features

All AI surfaces are powered server-side via Supabase Edge Functions. The
provider's API key lives in the Edge Function environment — it never reaches
the client bundle. Each surface ships with a deterministic templated fallback
so the app keeps working if the provider is unreachable.

Highlights:

1. **Análisis IA** — one-line headline + observations + concrete suggestion
   on the Wallet card. Reads holdings via JWT-scoped RLS.
2. **Preguntale a SAMAS** — multi-turn chat with portfolio context.
3. **Objetivos personalizados** — 3-step wizard (goal → horizon → risk).
   Strategy classified deterministically; the LLM only refines the narrative.
4. **News digest** — 2–3 sentence synthesis of headlines for your top 5
   weighted holdings.
5. **Detector de patrones tóxicos** — anti-overtrading nudge.
6. **Trade Journal** — per-trade reflection + 90-day win-rate recap.

…plus stress-test, hypothetical backtest, daily brief, sector rotation,
position-size suggestion, thesis validation, news explainer, asset analysis,
quarterly review, tax-loss harvest, proactive insights, watchlist generator,
post draft, and risk score.

## Configuration

Edge Function secrets live in **Supabase Dashboard → Edge Functions → Manage
Secrets**. Set `AI_API_KEY` and `FINNHUB_API_KEY` there — they never appear
in the client bundle.

Without `AI_API_KEY` set, every AI surface uses its templated fallback so
demos and screenshots keep working.

## What's in this repo

- `src/v2/` — the active app shell (Wallet, Broker, Social, News).
- `src/lib/i18n.js` — i18n source of truth, 12 locales.
- `supabase/functions/` — 30 Edge Functions (auth, AI, admin, cron).
- `supabase/*.sql` — schema migrations (run via Supabase SQL editor).

## Existing integrations

- **Finnhub** — optional live quotes, 60s refresh.
- **WhatsApp Business API** — phone OTP for signup verification.

## Non-goals

SAMAS is a prototype. The trades it displays are simulated — no order
routing, no custody, nothing real. Anything the AI says is **educational
only, not financial advice**. KYC + CNV registration is the broker's
responsibility, not SAMAS.
