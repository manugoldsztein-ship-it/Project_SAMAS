// ============================================================
// SAMAS v2 — API LAYER
// ============================================================
// Single import point for the whole app. Every screen pulls from
// here, NOT from supabase / fetch / etc. directly:
//
//   import { wallet, card, broker, social, news } from "../api";
//   const balance = await wallet.getBalance();
//
// Why this layer exists:
//   - We have NO real backend integrations yet (no Cohen broker API,
//     no Mercado Pago, no Pomelo card issuer). Everything underneath
//     is a mock that returns realistic data.
//   - When we DO get those integrations, the UI doesn't change —
//     only the file inside src/v2/api/ that holds the implementation.
//
// Each module documents its public functions and the shape of the
// data they return so when Cohen / Pomelo / MP send their docs we
// can map their endpoints to ours one to one.
//
// See ./README.md for the integration playbook.
// ============================================================

import * as wallet from "./wallet.js";
import * as card from "./card.js";
import * as broker from "./broker.js";
import * as social from "./social.js";
import * as news from "./news.js";
import * as notifications from "./notifications.js";

export { wallet, card, broker, social, news, notifications };
