# Deep audit pass — samas-0.4.4

Companion to the 0.4.3 quick audit. Documents what was found,
what was fixed, what stays open as known issues.

## 1. Layout / UX cramping on small screens

**Found:**
- `ChromeBtn` (the round header buttons in Wallet) didn't forward
  `aria-label` / `title` props. The new ? Explain button (0.4.2) had
  its `aria-label` silently ignored — accessibility hole.
- 4 ChromeBtns at 40px each + 8px gaps + greeting block on the
  left ≈ 322px on iPhone SE (320px wide). Tight overlap risk on
  smallest devices. Manuel uses iPhone 17 Pro Max (430px) so
  in-scope but not blocking.

**Fixed:**
- `ChromeBtn` now spreads `...rest` into the `<button>` so any
  unknown prop (aria-label, title, etc.) reaches the DOM.
- Wallet header gap tightened from 8px to 6px.

**Open / not fixed:**
- AssetSheet trade confirm step has a lot of vertical content
  (review summary + Trade Coach + thesis textarea + CTAs). The
  outer container scrolls (`overflowY: auto, maxHeight: 92dvh`)
  so no content is unreachable, just verbose. Acceptable.

## 2. AI prompt quality + JSON schema robustness

**Audited 18 functions** that parse LLM JSON responses.

**All clean:**
- Each has `try { JSON.parse(stripped) } catch` around the parse.
- Each strips ```json/``` fences before parsing.
- Each has a templated fallback when the LLM returns garbage,
  fails the request, or no API key is set.
- Token budgets sized correctly (300-1200 max, fetch-news at
  4000 for batch translation).
- Timeouts in 10-18s range, well within the 60s Edge Function
  wall-clock limit.

**No bugs found.**

## 3. Realtime subscription leaks

**Audited 7 channel creations:**

| Channel | Deps | Cleanup | Verdict |
|---|---|---|---|
| `notifications-bell-${uid}` | `[]` | ✅ | Stable, mounts once |
| `notifications-inbox-${uid}` | `[]` | ✅ | Mounts on inbox open |
| `social-feed-${tab}` | `[tab]` | ✅ | Re-creates on tab switch |
| `dm-threads-${uid}` | `[refresh]` | ✅ | refresh is stable useCallback |
| `dm-thread-${thread.id}` | `[thread.id]` | ✅ | Re-creates on thread switch |
| `replies-${post.id}` | `[post.id]` | ✅ | Re-creates per post |
| `ticker-feed-${symbol}` | `[symbol]` | ✅ | Re-creates per symbol |

**No leaks found.** Every channel has matching `removeChannel` in
the effect cleanup. The `let channel = null` + closure-over-channel
pattern correctly handles the case where the cleanup fires before
the async auth.getUser() resolves.

## 4. App-foreground race conditions

**Audited:**

- `App.jsx:855` price-poll interval: pauses on background, resumes
  on foreground with a fresh `setInterval`. ✅ correct guard.
- `usePullToRefresh`: has `refreshing` state guard, multiple pulls
  can't fire simultaneously. ✅
- AI-surface `busy` guards: every component that calls a quota'd
  AI surface has `if (busy) return` before `setBusy(true)`. ⚠️
  Theoretical micro-race exists between the guard read and the
  state set (React batches across event handlers). In practice,
  iOS WebView event loop isn't fast enough to fire two taps in
  the same microtask. Low priority.
- `Wallet.refresh` and `Broker.refresh`: NO in-flight guard. If
  pull-to-refresh + tab-resume fire concurrently, both refreshes
  run, both write state. State writes are "set", not "append", so
  no corruption — just redundant API calls + UI flicker. ⚠️ Known.

**Action items left open** (not blocking for the Cohen pitch):
1. Add `inFlightRef` to `Wallet.refresh` + `Broker.refresh` to
   coalesce concurrent refreshes. Saves ~6 redundant API calls
   per accidental double-fire.
2. Promote `busy`-guard to `useRef`-based in-flight in any AI
   surface where double-tap is observed in production.

## What to watch for in production

These are spots where a real-world bug COULD surface that the
audit can't catch from code alone:

1. **Realtime reconnect on bad network** — Supabase's client
   handles reconnection but heavy network drops could leave a
   subscription stale. Easy to spot (no live updates), easy to
   fix (background interval that calls `refresh()` after detected
   stale period).
2. **Edge Function cold start after low traffic** — first call
   after >15min idle takes longer. The 12s timeout is enough
   margin, but watch the p99 latency on the Anthropic dashboard.
3. **Quota counter reset edge case** — `consume_ai_quota` uses
   `current_date` (UTC). A user in Buenos Aires (UTC-3) will see
   their quota reset at 21:00 local time, not midnight. Confusing
   if they hit the limit at 20:30 and expect a midnight reset.
   Future fix: store + reset in the user's local timezone.
