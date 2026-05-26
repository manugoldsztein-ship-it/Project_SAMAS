# SAMAS v2 — API Layer

Single source of truth for every backend interaction. The UI **never**
calls `fetch()` / Supabase / a partner SDK directly — it goes through
this layer.

## Why this exists

- We have **zero real backend integrations** today (no Cohen broker,
  no Mercado Pago wallet, no Pomelo card). Every module here returns
  realistic mock data.
- When real partnerships land, **only this folder changes**. The
  rest of the app keeps working with no JSX edits.

## Modules

| Module | Owns | Production target |
|---|---|---|
| `wallet.js` | ARS+USD cash, deposits, withdrawals, transactions, ARS↔USD swap | Mercado Pago Marketplace API · MODO · Geopagos · dLocal |
| `card.js` | Virtual SAMAS prepaid card (PAN, freeze, settlements) | Pomelo |
| `broker.js` | Portfolio, quotes, orders, watchlists, FX | Cohen (TBD) · IOL · Cocos · IEB |
| `social.js` | Posts, likes, reposts, follows, reports, moderation queue | Supabase tables + RLS (no external partner) |
| `news.js` | Categorized news, market ticker | Existing `fetch-news` edge function |

Each file exports plain async functions. Import via the barrel:

```js
import { wallet, card, broker, social, news } from "../api";

const balance = await wallet.getBalance();
const portfolio = await broker.getPortfolio();
```

## How to swap a mock for the real API

The mock and the real implementation must satisfy the **same exported
signatures and return shapes**. Steps:

1. **Read the partner's docs.** Look for the closest endpoint to each
   exported function in our module.
2. **Edit only the function body.** Keep the parameter list and the
   shape of the resolved promise identical.
3. **Validate with the existing UI.** No screen edits should be needed.

### Example — switching `wallet.getBalance` to Mercado Pago

```js
// before (mock)
export async function getBalance() {
  await jitter();
  return { ars: state.ars_centavos / 100, usd: state.usd_cents / 100, cvu: state.cvu, alias: state.alias };
}

// after (real)
export async function getBalance() {
  const { user } = await supabase.auth.getUser();
  const resp = await fetch(`${MP_BASE}/v1/wallets/${user.id}/balance`, {
    headers: { Authorization: `Bearer ${MP_TOKEN}` },
  });
  if (!resp.ok) throw new Error(await resp.text());
  const json = await resp.json();
  return {
    ars: json.balances.ARS / 100,
    usd: json.balances.USD / 100,
    cvu: json.cvu,
    alias: json.alias,
  };
}
```

The shape on the right matches the shape on the left → UI keeps
working.

## Contract details — what each function MUST return

### wallet

| Function | Resolves to |
|---|---|
| `getBalance()` | `{ ars, usd, cvu, alias }` — all amounts in major units (pesos / dollars), not centavos |
| `getTransactions({ limit?, before? })` | `Array<Transaction>` newest first |
| `deposit({ amount, ccy, source, note? })` | `{ txnId, newBalance, redirectUrl? }` |
| `withdraw({ amount, ccy, destinationCbu?, destinationAlias?, note? })` | `{ txnId, newBalance }` |
| `swap({ from, to, amountFrom, rate })` | `{ txnId, amountTo, balances: { ars, usd } }` |

`Transaction = { id, type: "in"|"out"|"swap", who, amount, ccy, note, cat, at, atLabel }`

`cat ∈ "transfer" | "income" | "card" | "invest" | "swap" | "fee"`

### card

| Function | Resolves to |
|---|---|
| `getCard()` | `{ id, last4, expMonth, expYear, holderName, network: "visa"|"mastercard", status: "active"|"frozen"|"blocked" }` |
| `revealCard()` | `{ pan, cvv, expMonth, expYear }` — call only after fresh user re-auth (Face ID / PIN) |
| `freezeCard()` | `{ status: "frozen" }` |
| `unfreezeCard()` | `{ status: "active" }` |
| `getCardTransactions({ limit? })` | `Array<{ id, merchant, amount, ccy, at, atLabel, status: "pending"|"settled"|"declined" }>` |

### broker

| Function | Resolves to |
|---|---|
| `getAssets({ category? })` | `Array<Asset>` — universe of instruments |
| `getQuote(ticker)` | `{ ticker, price, changePct, currency, at }` |
| `getPortfolio()` | `{ holdings: Array<Holding>, totalArs, totalUsd }` |
| `placeOrder({ ticker, side, qty, type?, limitPrice? })` | `{ orderId, status: "filled"|"open", fillPrice? }` |
| `getOrders({ status? })` | `Array<Order>` |
| `cancelOrder(orderId)` | `{ ok: true }` |
| `getWatchlists()` | `Array<{ id, name, tickers: string[] }>` |
| `addToWatchlist(id, ticker)` / `removeFromWatchlist(id, ticker)` / `createWatchlist(name)` | mutation results |
| `getFx()` | `{ mep, ccl, oficial }` each `{ value, change }` |

`Asset = { ticker, name, category, currency: "ARS"|"USD", price, changePct }`
`Holding = { ticker, qty, avgCost, currency, name, category, price, value, gainAbs, gainPct }`

### social

| Function | Resolves to |
|---|---|
| `getFeed({ tab?, limit? })` | `Array<Post>` |
| `getPost(id)` | `Post` |
| `createPost({ body, trade? })` | `Post` |
| `deletePost(id)` | `{ ok: true }` |
| `likePost(id)` / `unlikePost(id)` | `{ likes, likedByMe }` |
| `repostPost(id)` | `{ reposts, repostedByMe }` |
| `follow(userId)` / `unfollow(userId)` | `{ ok: true }` |
| `reportPost({ postId, reason })` | `{ ok: true, reportId }` |
| `getMe()` | `{ id, handle, displayName, avatarColor, verified }` |
| `getModerationQueue({ status? })` | `Array<Report>` (admin only) |
| `resolveReport({ reportId, action: "dismiss"|"delete_post"|"ban_user" })` | `{ ok: true }` |

`Post = { id, body, trade?, at, atLabel, likes, comments, reposts, likedByMe, repostedByMe, author }`
`author = { id, handle, displayName, avatarColor, verified }`

### news

| Function | Resolves to |
|---|---|
| `getCategorizedNews({ category?, limit? })` | `Array<NewsItem>` |
| `getNewsForTickers(tickers)` | `Array<{ id, title, summary, source, at, timeLabel }>` |
| `getMarketTicker()` | `Array<{ sym, value, changePct }>` |
| `getCategories()` | `Array<string>` |

## Errors

Every async function may throw. UI **must** wrap calls in try/catch
and surface the message. Mocks throw a small percentage of the time
(default 2%) so error-handling code gets exercised in dev.

Errors should be `Error` instances with a human-readable Spanish
message. Server-side errors in production should map to the same
shape (translate before throwing).

## Demo state reset

Each module exports `_resetDemo()` that clears its localStorage
snapshot back to seed data. Useful while testing flows. Remove these
calls before going to production.

```js
import { wallet, card, broker, social } from "../api";
wallet._resetDemo();
card._resetDemo();
broker._resetDemo();
social._resetDemo();
```

## When you receive partner specs

1. Drop the spec PDF / Postman collection in `docs/integrations/`.
2. Compare against the contract above. Note any field-name or shape
   differences.
3. Either rename our fields to match theirs (preferred) or add a thin
   adapter inside the module body. The exported function signatures
   must stay the same regardless.
4. PR the change with a screenshot showing the UI still works.
