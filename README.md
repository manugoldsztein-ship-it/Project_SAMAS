# SAMAS

The app of the future — for the investors of today.

SAMAS is a trading and social prototype built as a single-file Vite + React
build: simulated portfolio, real-time optional quotes (Finnhub), multi-asset
coverage of the Argentine market (Acciones, CEDEAR, ETFs, Bonos, ONs, FCI,
Crypto), and — as of this branch — **native AI features powered by Claude**.

<p align="center">
  <em>Portfolio simulator · Live quotes · AI coach · AI objectives · AI news sentiment</em>
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

## AI features

All three of these are opt-in: drop in your own Anthropic API key and they
light up. Without a key, the rest of SAMAS works as before and the AI
surfaces show realistic mock output so you can still see the shape.

### 1. Coach IA (chat)

A floating button on the mobile frame opens a chat with **SAMAS Coach**,
an in-app financial coach. It speaks Spanish (rioplatense) by default and
follows the user's language. The coach receives your current portfolio
(tickers + quantities + ARS value) as context so answers can reference real
positions — e.g. *"tenes 25 NVDA, asi que ya sos materialmente dolarizado"*.

Built-in quick prompts: CEDEAR explainer, AL30 vs GD30 comparison,
conservative plan in pesos, and a portfolio snapshot.

### 2. Objetivos personalizados (plan wizard)

On the Portfolio page, the **Armar mi plan con IA** banner launches a 4-step
wizard (goal → horizon → risk → capacity). Claude returns a JSON plan mapped
1:1 onto SAMAS's actual asset classes:

- **Acciones** (argentine equities)
- **CEDEAR** (foreign equities, peso-denominated)
- **ETF** (global ETFs)
- **Bonos** (AL30 / GD30 / CER / LEDES)
- **ON** (corporate obligaciones negociables)
- **FCI** (fondos comunes — money market / renta fija / mixto)
- **Crypto** / **Cash**

The plan view includes an allocation bar, suggested monthly contribution,
short milestones, and grounding principles.

### 3. News sentiment card

On the Noticias tab, the sentiment card scores the current headlines as
bullish / bearish / neutral and surfaces 3–5 hot topics plus a neutral
2-sentence summary. It re-analyzes on demand.

## Configuring AI

### Option A — bring your own key (recommended for local use)

1. Create a key at <https://console.anthropic.com/settings/keys>.
2. In the app, open **Profile → Coach IA (Claude)**.
3. Paste the key, pick a model (`claude-sonnet-4-6` is the default), hit
   **Probar** to verify, then **Guardar**.

The key is stored in `localStorage` on your machine only. Browser fetches
go directly to `api.anthropic.com` with the header
`anthropic-dangerous-direct-browser-access: true`.

### Option B — use a proxy (recommended if you don't want the key in the browser)

If you prefer to keep the key off the client, point SAMAS at a small proxy
that forwards to Anthropic and injects the key server-side. Set a custom
endpoint in `localStorage`:

```js
localStorage.setItem("samas_anthropic_endpoint", "https://your-proxy.example.com/v1/messages");
```

Your proxy only needs to accept the same JSON body SAMAS sends
(`model`, `max_tokens`, `system`, `messages`), attach the `x-api-key`
server-side, and forward to `https://api.anthropic.com/v1/messages`. A
30-line Express handler is enough.

### Option C — stay in demo mode

Do nothing. Every AI surface has a sensible mock and clearly labels itself
as **"Modo demo"** so demos, screenshots, and offline walkthroughs keep
working.

## What's in this branch

- `src/ai/client.js` — Anthropic client (BYOK, mock fallback, chat /
  objectives / sentiment helpers, system prompts tuned for the SAMAS
  surface).
- `src/ai/CoachChat.jsx` — floating chat panel. Portfolio-aware.
- `src/ai/ObjectivesWizard.jsx` — 4-step wizard, renders a category
  allocation mapped to SAMAS's asset classes.
- `src/ai/SentimentCard.jsx` — news-feed sentiment + hot topics.
- `src/App.jsx` — wires the three components into the existing mobile frame
  and web dashboard, and adds an **API key input** in the Profile sheet
  that follows the existing Finnhub / EmailJS pattern.

## Existing integrations (still here)

- **Finnhub** (optional live quotes, 60s refresh) — Profile → Cotizaciones
  en vivo.
- **EmailJS** (optional real signup emails) — Profile → Envio de emails.

## Non-goals

SAMAS is a prototype. The "trades" it displays are simulated — no order
routing, no custody, nothing real. Anything the Coach says is **educational
only, not financial advice**.

## Other comments

// I'm Retep and I am evil
