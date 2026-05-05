# SAMAS — Claude context

You are working on **SAMAS**, an Argentine retail-investing prototype owned by **Manuel Goldsztein** (`manugoldsztein@gmail.com`). The product is a single-tenant iOS app being prepped for an investor pitch to **Cohen** (an ALyC-registered Argentine broker). Stack: Vite + React 18 + Capacitor 8 (iOS), Supabase backend (Postgres + RLS + Realtime + Storage + Edge Functions). Single-file production bundle via `vite-plugin-singlefile`.

The active branch is **`feature/samas-rebrand`** at `https://github.com/manugoldsztein-ship-it/Project_SAMAS`.

---

## Manuel's preferences — read first

These are NON-NEGOTIABLE. Every previous Claude has been corrected on these at least once.

### Patch summary format
After every shippable change, post a Discord-friendly patch note exactly in this shape:

````
```
Patch samas-0.X.Y
- bullet describing what changed (terse)
- second bullet
- third bullet
- pushed to feature/samas-rebrand: <oldsha>..<newsha>
```
````

Rules:
- Wrap in a triple-backtick code fence so Discord doesn't auto-bullet
- The patch counter increments by 1 per shipped patch (current is samas-0.4.54; next is 0.4.55). The minor (0.4.x) bumps when a major theme rolls — Manuel does that bump manually, don't pre-empt it
- Plain `-` bullets, no markdown headers, no bold, no blank lines inside the fence
- After the fence, list any commands Manuel needs to run, **labeled by destination** (see below)

### Always label command destinations
Every command block must say where Manuel should run it. He once pasted `open ~/samas-cli/supabase/social.sql` into the Supabase SQL editor and got a syntax error. Don't make him guess.

Use these labels:
- **Mac Terminal (in your samas-cli folder)** — for git, npm, npx commands
- **Supabase SQL editor** (Dashboard → SQL Editor → New query → paste → Run) — for SQL migrations
- **Xcode** (after `npx cap open ios`) — for Run / build tasks
- **iPhone** — for in-app testing steps

### Casual register is OK
Manuel likes a friendly tone with the occasional curse — says it makes the work funnier. Don't be stiff. Don't apologize unnecessarily. Push back when something is a bad idea.

### No avatar uploads, ever
Users CANNOT upload profile pictures in SAMAS. Color circle + initials only (`avatarPropsFor` in `src/v2/shared.jsx`). Manuel pulled this back after an attempted patch — likely App Store moderation requirement (user-uploaded photos need a report+remove pipeline) and demo simplicity. **Do NOT propose, build, or revive avatar uploads** unless he explicitly raises it again. Post images and DM images are fine — only the *profile picture* axis is closed.

---

## Project shape

### File layout
```
src/
  App.jsx                    # legacy orchestrator + ErrorBoundary + tab router (7000+ lines)
  main.jsx                   # entry, mounts <App>
  auth/
    SupabaseAuth.jsx         # signup / login / WhatsApp OTP / forgot pwd. Univ dropdown + paste OTP buttons live here
    Mfa.jsx                  # TOTP enrollment + challenge (raw GoTrue REST, SDK hangs intermittently)
    PinLock.jsx              # local PIN unlock
    WelcomeChooser.jsx
  v2/                        # NEW shell. Almost all active dev happens here
    Shell.jsx                # SamasShell — top-level tab switcher (wallet/social/news + broker/social sub-shells)
                             # Owns: SettingsSheet, EditProfileSheet, LegalSheet, ChangelogSheet, ProUpsellModal
    Wallet.jsx               # WalletPage — home tab. Pro Wallet cards (cash flow, P&L, dividends, tax) here
    Broker.jsx               # BrokerShell — Invertir tab. PortafolioView, MercadoView, WatchlistView, AssetSheet
                             # Pro Portfolio dashboard, Pro AssetDetail, Pro Mercado, Watchlists v2 — all here
    Social.jsx               # SocialPage + FeedView, SearchView, ProfileView, MessagesView, ConversationView, ThreadView, TickerFeedView, FollowListView, PostCard, ReplyRow, UserRow
    News.jsx                 # NewsPage
    shared.jsx               # Sparkline, Avatar, Pill, SectionHead, SamasTabBar, avatarPropsFor
    theme.js                 # SAMAS_THEME (dark + light), FONT, fmtMoney, fmtPct
    icons.jsx                # Ico.* (lucide-style inline SVG icons)
    api/
      index.js               # exports wallet, card, broker, social, news, notifications, messages
      wallet.js / card.js / broker.js / news.js / notifications.js   # mostly mock state w/ localStorage
      social.js / messages.js                                          # real Supabase-backed
      _mock.js               # jitter + relativeStamp helpers
    refreshRegistry.js       # global refresh handler registry (pull-to-refresh hook routes through this)
    usePullToRefresh.jsx
    useEdgeSwipeBack.js
    toast.jsx
  lib/
    i18n.js                  # tr(key, lang, vars) helper. 12 locales, each ~190 keys. SOURCE OF TRUTH for all strings
    supabase.js              # createClient with persistSession + auto-refresh
    news.js                  # client wrapper for fetch-news Edge Function
    native.js                # Capacitor App.appStateChange bridge + onAppStateChange helper
    push.js                  # Capacitor Push Notifications wrapper
    biometric.js             # Capacitor Biometric Auth wrapper
supabase/                    # SQL migrations. Run via Supabase SQL editor.
                             # 30+ files now — list with `ls supabase/*.sql`.
                             # Highlights below; rest are themed by feature name.
  schema.sql                 # original profiles, txns, otp_codes, etc
  social*.sql                # social network: posts, likes, replies, follows,
                             # university, cnv_idoneo, post-images, kinds, FKs
  samas_plus*.sql            # Plus subscription: is_plus flag, ai_usage_daily,
                             # consume_ai_quota / get_ai_quota_status / activate_plus RPCs
  rate_limits*.sql           # IP/user rate-limit table + GC cron (security pass 0.4.16-0.4.18)
  trade_journal.sql          # per-trade reflection (0.4.29)
  objectives.sql             # AI-driven goals (0.4.12)
  recurring_aportes.sql      # monthly contribution scheduler (0.4.7)
  watchlists.sql / theses.sql / price_alerts.sql / risk_rules.sql
  device_tokens.sql / notifications.sql / preferences.sql / ui_mode.sql
  functions/                 # 35+ Edge Functions. Auth (send-otp/verify-otp),
                             # AI (analyze-asset, analyze-portfolio, chat-portfolio,
                             # daily-brief, news-digest, trade-coach, behavior-watch,
                             # objectives-plan, score-risk, draft-post, ...),
                             # admin (delete-user-account, export-user-data,
                             # seed-social-demo), cron (check-price-alerts,
                             # process-recurring-aportes, news-digest)
ios/                         # Capacitor-generated Xcode project. App.xcworkspace lives here
capacitor.config.json
vite.config.js               # vite-plugin-singlefile inlines everything into one HTML file
```

### Build commands
- `npm run build` — web build
- `npm run build:cap` — same with `VITE_CAPACITOR=1` env (toggles a few feature flags)
- `npx cap sync ios` — copies dist/ into ios/App/App/public/
- `npx cap open ios` — opens the Xcode workspace
- Run on device from Xcode (▶︎ button)

**Stale WebView cache is a real recurring issue.** When the app crashes inexplicably after a sync, tell Manuel to delete the SAMAS app from the phone and reinstall — Capacitor's WKWebView caches HTML/JS aggressively even after `cap sync`.

---

## Architecture patterns

### Tab layout
The Shell has 4 bottom tabs: **Wallet · Invest · Social · News**. Wallet + News are first-class pages. Invest + Social are *sub-shells* that mount as full-screen overlays with their own bottom nav (so they have their own internal tab structure: portafolio/mercado/watchlist/ordenes for broker; feed/search/messages/profile for social).

### Cross-shell handoff via briefcase + window event
When one screen needs to hand state to another that's mounted lazily, we use a localStorage "briefcase" + a window CustomEvent. The Shell.jsx listens, stashes payload, switches tabs. The receiving screen drains the briefcase on mount (`useEffect` reads + `removeItem`s), then renders. Patterns in use:
- `samas:share-trade` → `samas_pending_trade_share` → Social compose pre-fills with the trade card
- `samas:share-watchlist` → `samas_pending_text_share` → Social compose pre-fills with the watchlist text
- `samas_pending_dm_peer` → MessagesView opens that DM thread on mount
- `samas_pending_search` → SearchView pre-fills query (used by hashtag taps)
- `samas:open-pro-upsell` → Shell shows the Pro upsell modal

This is intentional — it keeps lazy-load boundaries clean and avoids prop-threading through 5 levels.

### Drill-in overlays in SocialPage
SocialPage manages 4 overlay states: `profileUserId`, `threadPost`, `tickerFilter`, `followList`. Each renders an `position: absolute, inset: 0` overlay above the current sub-tab. Stack order via z-index (10 / 30 / 32 / 35). The bottom nav hides whenever ANY overlay is active (compose bars fight for the same vertical real estate as the tab bar).

### Pro mode vs SAMAS Plus — DISTINCT
These are two different things and confusing them is the #1 way to break this codebase. Read carefully.

**Pro mode** (UI density toggle, free):
- Boolean in `samas_v2_pro_mode` localStorage key. Owned by `SamasShellInner` state, plumbed via prop into BrokerShell, MercadoView, AssetSheet, WatchlistView, WalletPage. Free for everyone — it just shows/hides denser cards.
- Lite/Pro segmented picker shipped in Settings (samas-0.4.37). Lite is the default.
- Pro features should ALWAYS be defensively gated — when `proMode` is false the Pro components don't render. **Don't make non-Pro paths assume the Pro components exist.**
- Pro surfaces: SectorDonut/RiskMetricsRow/BenchmarkLine (Portafolio), ProAssetChart/RangeBar52w/FundamentalsCard (AssetDetail), EarningsWidget/HeatmapGrid (Mercado), MonthPnLCard/DividendCard/TaxYearCard (Wallet — note CashFlowBars was promoted to free in 0.4.15), Watchlists v2 (color tags, reorder, share-to-social).

**SAMAS Plus** (paid AI subscription, US$5/mo):
- Server-side flag `profiles_social.is_plus`. Source: `supabase/samas_plus.sql`.
- Free tier: 5 user-initiated AI calls per UTC day. Plus: unlimited.
- Auto-loaded AI surfaces (Daily Brief, Earnings Watch, Compare Benchmark, Risk Score, Quarterly Review) and safety AI (Trade Coach, Position Sizing) stay free in both tiers — funnel hooks.
- RPCs: `consume_ai_quota`, `get_ai_quota_status`, `activate_plus`. Pricing screen at samas-0.4.23 with US$5/mo + 7-day trial.
- The Pro upsell modal in older code is now repurposed as the Plus upsell — opens on `samas:open-pro-upsell` event but routes to the Plus pricing sheet.

### i18n
Every user-facing string goes through `tr(key, lang, vars)` from `src/lib/i18n.js`. 12 locales, Spanish (es) is the canonical base — other locales fall back to es when a key is missing. The function is wrapped in try/catch as of 0.0.50 so a malformed call can't crash the app — it returns the key string and console.warns instead.

`vars` uses `{name}` placeholders, NOT `${name}` template-literal syntax. Replacement is a global regex.

### Supabase
- Auth: email + password. WhatsApp OTP for phone verification (custom Edge Function `send-otp` / `verify-otp` since Supabase's SMS provider is region-limited). MFA via TOTP — RAW GoTrue REST, NOT SDK (the SDK's `auth.mfa.*` helpers hang intermittently in this build).
- RLS on every user-data table. `auth.uid()` everywhere. Service role can flip locked fields (`profiles_social.verified`, `cnv_idoneo`, `university_verified`).
- Realtime via `supabase.channel().on('postgres_changes', ...)`. The publication `supabase_realtime` includes posts / replies / likes / follows / notifications / dm_messages.
- Storage buckets: `post-images` (public read, user-folder-scoped writes). NO `avatars` bucket — user avatar uploads are not allowed (see Manuel's preferences above).

### Verification badges
- **University verified** (green check + chip): user picks AR university at signup. BEFORE INSERT trigger on `profiles_social` checks email domain against `is_university_email(uni, email)` allowlist. Auto-flip, no admin needed. Source of truth: `supabase/social_university.sql`.
- **CNV idóneo** (blue check + chip): admin-only via SQL — no automated check. Manual update against the public CNV registry of registered representatives. Source: `supabase/social_cnv_idoneo.sql`.

### AI architecture
~19 AI surfaces, all server-side via Supabase Edge Functions. The provider's API key lives in Edge Function env (`AI_API_KEY`) — never in the client bundle. Every surface has a deterministic templated fallback so the app keeps working without the LLM.

Three layers of gating, in order:
1. **AI consent gate** (samas-0.0.98): first-tap consent dialog. `ensureAIConsent()` short-circuits everything if denied. Revocable from Settings.
2. **AI master switch** (samas-0.4.11): per-user kill switch in Settings. When OFF, every surface self-hides and skeletons skip mounting.
3. **Daily quota** (samas-0.2.6): 5 user-initiated calls/day on free tier, unlimited on Plus. Auto-loaded surfaces and safety AI bypass the quota.

User-facing copy MUST anonymize the provider — say "IA" / "SAMAS AI", never the model vendor's name. The 0.4.42 sweep + 0.4.53 hygiene pass enforce this; any future copy that leaks the provider name is a regression.

### Security posture (samas-0.4.16 → 0.4.19, then 0.4.32)
The security pass is complete. Don't loosen any of this without a good reason:
- Rate limits on all 21+ AI Edge Functions and auth routes — table `rate_limits` + GC cron. `RATE_LIMITS.AI = 60/min/user`.
- Body validation on every Edge Function (rejects malformed JSON, oversized payloads).
- Security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy).
- Constant-time OTP comparison + hCaptcha scaffolding on auth routes.
- Sentry error tracking shipped 0.4.32. Off by default — needs `VITE_SENTRY_DSN` to activate.

---

## Current state (samas-0.4.54 shipped)

The branch has moved a LOT since the 0.0.x era. Major eras, in order:
- **0.0.x — 0.1.x** — social network, Pro UI batch, Pro upsell, AI consent gate
- **0.2.x** — SAMAS Plus subscription mechanism (is_plus flag, ai_usage_daily, RPCs, paywall)
- **0.3.x** — AI tour walkthrough, thesis tracker, privacy-on-share work
- **0.4.x** — pre-Cohen-pitch push: dead-code sweep, security audit (0.4.16-0.4.19), Cohen-fit changes (crypto removed → CEDEAR exposure 0.4.21, hypothetical portfolio 0.4.22, pricing polish 0.4.23, demo seeding combo 0.4.24, loading skeletons 0.4.25, UVA toggle 0.4.26, stress test 0.4.27, mood-aware AI 0.4.28, Trade Journal 0.4.29, Sentry 0.4.32), FCI module 0.4.34, Education Duolingo-style 0.4.35, Lite/Pro UI mode 0.4.37, drag-to-dismiss sheets 0.4.46, AporteModal bottom-sheet rebuild 0.4.50.

Latest: **samas-0.4.54** — AporteModal keyboard fix. Latest "pre-pitch hygiene" sweeps are in 0.4.42 (anonymize AI provider in user copy) and 0.4.53 (final sweep on the same).

The big shipped categories on this branch:
- **AI** — 19+ surfaces (analyze-asset, analyze-portfolio, chat-portfolio, daily-brief, news-digest, trade-coach, behavior-watch, objectives-plan, score-risk, draft-post, position-size, validate-thesis, explain-news, explain-term, fetch-news, sector-rotation, suggest-watchlist, quarterly-review, journal-recap, proactive-insights, rebalance-portfolio, earnings-watch, compare-benchmark)
- **Monetization** — SAMAS Plus paywall + 7-day trial + value-framing card (0.4.23)
- **Compliance** — App Store: account deletion (`delete-user-account`) + data export (`export-user-data`) Edge Functions live
- **Demo readiness** — single-tap "full demo" combo button in Settings (0.4.24) seeds social + portfolio
- **Security** — full audit pass complete (0.4.16-0.4.19)
- **Education** — Duolingo-style tutorials path with XP + streak (0.4.35)
- **Wallet** — Objetivos with AI (0.4.12), Movimientos realtime (0.4.10), recurring aportes (0.4.7), AporteModal as a proper bottom sheet (0.4.50)

### Open issues / unknowns
Most of the old 0.0.x bugs are presumed resolved on this branch (the lang crash got an explicit hotfix, see `samas-0.0.50` → see Shell.jsx:4382 for "Hotfix: Can't find variable: lang"). New things to be aware of:
- **0.4.44** fixed an `id does not exist` RPC bug for SAMAS Plus — the consolidated migration `supabase/samas_plus_id_fix.sql` has to actually run in Supabase SQL editor on the live DB. Confirm with Manuel that he's run it before assuming Plus activation works in prod.
- **Cohen pitch readiness** — recent commits are labeled "pre-pitch hygiene". The pitch may be imminent or just-past. Ask before assuming.

### Default punch list
Manuel rejects long menus. Just ship. If you need a starter, sensible picks:
- More polish on Education / FCI / Trade Journal copy + edge cases
- Empty-state polish across screens (still some bare strings)
- Fix anything Manuel flags from the device
- Tighten any AI surface where the templated fallback feels off

The pre-Cohen punch list (loading skeletons, demo seeding, account deletion, pricing screen, demo accounts) is **all shipped**. Don't re-propose those.

---

## Things to NOT do

- **Don't mock the database in tests** — Manuel got burned by mock/prod divergence. Use a real Supabase test project.
- **Don't ship production financial features without legal review** — the privacy/terms screens we ship are prototype-grade; when Cohen integration lands they need a lawyer pass. The Privacy Policy + Terms in `LegalSheet` (Shell.jsx) flag this explicitly.
- **Don't add user avatar uploads** (see Manuel's preferences).
- **Don't skip git hooks** unless explicitly requested.
- **Don't `git commit --amend` after a hook failure** — the failed commit didn't happen, so amending modifies the PREVIOUS commit. Always create a NEW commit.
- **Don't propose features that need Apple Developer cert work** (push notifications, real APNs) without flagging the cert blocker upfront.

## Things to know about Manuel

- He's not a senior engineer — explain trade-offs in plain language, but don't condescend. He understands code, just not always the niche framework details.
- His goal is the Cohen investor pitch. Every patch should serve that goal somehow (polish, monetization story, social-demo readiness, etc).
- He prefers shipping over planning. Long AskUserQuestion menus annoy him — he rejected one explicitly. Default to "I'll just ship X next" and only ask when the choice is high-stakes.
- He responds tersely ("Sure", "What now", "Lets keep going"). That's not lack of engagement, that's his style. Trust the green light.
- He's had AI agents lose context on this project before — the 24-hour marathon session that produced 0.0.16 → 0.0.34 was rebuilt from a transcript on context overflow. **Your job is to not be that agent.** When this conversation gets long, save key decisions to memory promptly.

## Memory store

Manuel's auto-memory lives at `/Users/manuel/.claude/memory/` (or wherever Claude Code's memory dir is on his Mac). Key memories already saved:
- Project shape (covered by this CLAUDE.md, but the memory file goes deeper on tech choices)
- Patch summary format (covered above)
- Label command destinations (covered above)
- Casual register OK (covered above)
- No avatar uploads (covered above)

When you save NEW memories, follow the existing pattern: `feedback_*.md` for behavioral preferences, `project_*.md` for state, `reference_*.md` for external system pointers.

---

## Quick orientation commands

```bash
# Mac Terminal (in samas-cli folder)
git log --oneline -10                    # Recent patches
git status                                # Where we are
ls supabase/*.sql                         # All migrations
grep -rn "samas-0.0" src/v2/Shell.jsx     # Find changelog entries
```

```bash
# Build + deploy
npm run build:cap && npx cap sync ios && npx cap open ios
```

```sql
-- Supabase SQL editor — fast sanity checks
select count(*) from public.posts where deleted_at is null;
select count(*) from public.profiles_social where cnv_idoneo;
select * from public.notifications order by created_at desc limit 10;
```

Welcome to SAMAS. Don't break anything Manuel's already happy with.
