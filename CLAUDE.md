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
Patch samas-0.0.X
- bullet describing what changed (terse)
- second bullet
- third bullet
- pushed to feature/samas-rebrand: <oldsha>..<newsha>
```
````

Rules:
- Wrap in a triple-backtick code fence so Discord doesn't auto-bullet
- `samas-0.0.X` increments by 1 per shipped patch (current is samas-0.0.50; next is 0.0.51)
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
supabase/                    # SQL migrations. Run via Supabase SQL editor
  schema.sql                 # original profiles, txns, otp_codes, etc
  social.sql                 # social network: profiles_social, posts, likes, replies, follows, reports
  social_fks.sql             # FKs to profiles_social (PostgREST relational selects need direct FKs)
  social_messages.sql        # DM tables: dm_threads + dm_messages
  social_notifications.sql   # AFTER-INSERT triggers (likes/reposts/replies/follows -> notifications)
  social_university.sql      # profiles_social.university + university_verified, BEFORE INSERT trigger
  social_cnv_idoneo.sql      # profiles_social.cnv_idoneo (admin-flipped)
  social_post_images.sql     # posts.image_url + post-images Storage bucket
  realtime_publication.sql   # supabase_realtime publication adds
  replies_realtime.sql       # adds replies to publication
  functions/                 # Edge Functions (fetch-news, send-otp, verify-otp, etc)
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

### Pro mode
Boolean toggle persisted in `samas_v2_pro_mode` localStorage key. Owned by `SamasShellInner` state, plumbed via prop into BrokerShell, MercadoView, AssetSheet, WatchlistView, WalletPage. Pro features should ALWAYS be defensively gated — when `proMode` is false the Pro components don't render. **Don't make non-Pro paths assume the Pro components exist.**

Pro features by surface:
- **Pro Portfolio** (Broker > Portafolio): SectorDonut, RiskMetricsRow, BenchmarkLine
- **Pro AssetDetail** (Broker > tap any asset): ProAssetChart, RangeBar52w, FundamentalsCard
- **Pro Mercado** (Broker > Mercado): EarningsWidget, list/heatmap toggle, HeatmapGrid
- **Pro Wallet** (Wallet tab): CashFlowBars, MonthPnLCard, DividendCard, TaxYearCard
- **Watchlists v2** (Broker > Watchlist): color tags, reorder arrows, share-to-social

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

---

## Current state (samas-0.0.50 shipped)

The Pro UI batch is fully shipped (0.0.42–0.0.47). Pro upsell modal shipped 0.0.49. Latest patch 0.0.50 hardened `tr()` and added component-stack readout to the error boundary.

### Open issues
- **"Can't find variable: lang" runtime crash** — Manuel hit this on launch after pulling 0.0.49. Couldn't reproduce locally; build is clean and every `tr(..., lang)` call site has lang in scope. Most likely a stale WKWebView cache, hence 0.0.50 added defensive try/catch + version footer. **Next step: if it still crashes after a fresh app reinstall, the new error boundary will show the component stack — use that to localize.**
- **News tab "isn't working"** — original report was vague. 0.0.37 added defensive timeouts, 0.0.48 fixed an English-locale category-filter bug (cat state was using translated label, never matched the data's Spanish keys). Likely resolved but not confirmed by Manuel.
- **Invest button → monthly contribution menu bug** — Manuel reported "tap Invertir, sometimes Aporte modal opens". Couldn't repro from code review; pending screenshot.

### What's next on the punch list
Manuel rejected the structured menu last time and just said "What now". He likes when I just pick and ship. Reasonable batch picks for the next patch:
- **Seed social demo data** — bake a Settings button that creates ~12 fake users with posts/threads/follows. The social tab will be empty during the Cohen pitch otherwise. Heaviest of these — needs Supabase admin write since fake users need auth.users rows.
- **Loading skeletons** — replace bare "Cargando…" strings across the app with proper skeleton placeholders. Polish lift.
- **Account deletion + data export** — App Store hard requirement (Guideline 5.1.1(v)). "Borrar mi cuenta" + "Descargar mis datos" in Settings.
- **Pro pricing screen** — fake "$5/mes" page reachable from the Pro upsell modal's CTA. Demonstrates monetization concretely for Cohen.
- **Demo accounts seeded with social activity** for the live demo.

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
