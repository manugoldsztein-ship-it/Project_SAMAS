// ============================================================
// LIVE PRICES — simulated tick provider for the demo
// ============================================================
// Every price displayed in Mercado / Watchlist / Portafolio /
// AssetSheet / the Wallet hero used to be static — the same number
// the entire session. That made the app feel like a screenshot, not
// a product. This module ticks every visible price every 2.5s with
// a small random walk and lets each row flash green/red on the new
// value so the whole shell reads as alive.
//
// IT'S FAKE, ON PURPOSE
//   The data is local random walk biased back toward each ticker's
//   "real" base price (to keep the demo recognizable: BTC stays in
//   the BTC range, GGAL in GGAL's). When real Finnhub websocket
//   streaming goes in (separate task — needs cert + plan upgrade)
//   the same hook keeps the same shape; we just swap the tick
//   driver underneath.
//
// USAGE
//   1. Wrap the tree in <LivePricesProvider>...</LivePricesProvider>
//      somewhere above any consumer (we mount once at SamasShellInner
//      so Wallet + Broker + AssetSheet all sit inside).
//   2. From any component:
//        const { price, prevPrice, sign, tickCount } =
//          useLivePrice(asset.ticker, asset.price);
//      The first arg is the ticker (registers it on mount); the
//      second is the asset's "real" base price used to seed the
//      walk and clamp wild drift. Returns the latest tick state.
//   3. For the green/red flash on update, use `tickCount` as a
//      `key` on the cell that should re-animate, and apply the
//      samas-tick-up / samas-tick-down CSS animation conditionally
//      on `sign`. Both keyframes are defined in Shell.jsx's global
//      <style> block.
// ============================================================

import React, {
  createContext, useContext, useEffect, useMemo, useRef, useState, useCallback,
} from "react";

// 2.5s feels alive without burning battery. 1s is too jittery
// (numbers blur), 5s is too slow (looks dead during a pitch).
const TICK_INTERVAL_MS = 2500;

// Per-tick delta range. ±0.3% covers normal market fluctuation
// without making CEDEAR rows flash huge double-digit moves
// every couple seconds.
const MAX_PCT_PER_TICK = 0.003;

// Clamp drift so a long-running session doesn't push BTC to 0 or
// AAPL to a million. 70%-150% of base price is plenty of breathing
// room for the demo's lifetime.
const CLAMP_LO = 0.7;
const CLAMP_HI = 1.5;

const LivePricesContext = createContext(null);

export function LivePricesProvider({ children }) {
  // Ref-backed Map so writes don't re-render. We trigger re-renders
  // explicitly via setTickCount each interval.
  const mapRef = useRef(new Map());
  const [tickCount, setTickCount] = useState(0);

  const register = useCallback((ticker, basePrice) => {
    if (!ticker || typeof basePrice !== "number" || !isFinite(basePrice)) return;
    const map = mapRef.current;
    const existing = map.get(ticker);
    if (existing) {
      // Update the base if the asset metadata changed (rare, but the
      // Demo seed flow can swap holdings underneath).
      existing.basePrice = basePrice;
      return;
    }
    map.set(ticker, {
      basePrice,
      price: basePrice,
      prevPrice: basePrice,
      sign: "flat",
    });
  }, []);

  const get = useCallback((ticker) => mapRef.current.get(ticker), []);

  useEffect(() => {
    const id = setInterval(() => {
      const map = mapRef.current;
      if (map.size === 0) return; // nothing registered, no-op tick
      for (const entry of map.values()) {
        // Random walk biased slightly toward base so prices don't
        // drift off forever. The bias is the difference from base
        // pulled back at ~10% strength.
        const drift = (Math.random() - 0.5) * 2 * MAX_PCT_PER_TICK;
        const meanReversion = (entry.basePrice - entry.price) / entry.basePrice * 0.1;
        const pct = drift + meanReversion;
        const target = entry.price * (1 + pct);
        const clamped = Math.max(
          entry.basePrice * CLAMP_LO,
          Math.min(entry.basePrice * CLAMP_HI, target),
        );
        // Treat sub-0.001% changes as flat — visually nothing happens
        // and we don't want an animation to fire on noise that small.
        const diff = clamped - entry.price;
        const sign = Math.abs(diff) / entry.price < 0.00001
          ? "flat"
          : diff > 0 ? "up" : "down";
        entry.prevPrice = entry.price;
        entry.price = clamped;
        entry.sign = sign;
      }
      setTickCount((c) => c + 1);
    }, TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const value = useMemo(() => ({ register, get, tickCount }),
                        [register, get, tickCount]);

  return (
    <LivePricesContext.Provider value={value}>
      {children}
    </LivePricesContext.Provider>
  );
}

/**
 * useLivePrice(ticker, basePrice) — returns the latest live state
 * for `ticker` and registers it with the provider on first call.
 * Safe to call without a Provider in the tree (returns the static
 * basePrice, no ticking) so leaf components can be developed in
 * isolation.
 *
 * Return shape: { price, prevPrice, sign, tickCount }
 *   - price: latest tick price
 *   - prevPrice: price one tick ago (used to compute deltas)
 *   - sign: "up" | "down" | "flat" — direction of last tick
 *   - tickCount: monotonic counter from the provider; use as a
 *     `key` on cells that should re-animate each tick
 */
export function useLivePrice(ticker, basePrice) {
  const ctx = useContext(LivePricesContext);

  // Register the ticker on mount + on basePrice change. We do this
  // unconditionally before the early return so React's hook order
  // stays stable when the provider is or isn't mounted.
  useEffect(() => {
    if (ctx && ticker) ctx.register(ticker, basePrice);
  }, [ctx, ticker, basePrice]);

  if (!ctx || !ticker) {
    return { price: basePrice, prevPrice: basePrice, sign: "flat", tickCount: 0 };
  }
  const entry = ctx.get(ticker);
  return {
    price: entry?.price ?? basePrice,
    prevPrice: entry?.prevPrice ?? basePrice,
    sign: entry?.sign ?? "flat",
    tickCount: ctx.tickCount,
  };
}

/**
 * useLivePortfolioRatio(holdings) — returns a live drift ratio
 * for the portfolio, computed as (sum of live price × qty) divided
 * by (sum of base price × qty). Multiply any pre-computed total
 * (totalArs / totalUsd / etc) by `ratio` to get its live value.
 *
 * Currency-agnostic: we don't need to know whether each holding is
 * priced in ARS or USD because the ratio cancels out — both sides
 * of the division use the same per-holding base price. The Wallet
 * hero already has totalArs and totalUsd pre-computed; multiplying
 * by ratio keeps both currencies consistent without needing FX
 * data inside the hook.
 *
 * Holdings shape: [{ ticker, qty, price (per-unit base) }, ...]
 *
 * Returns: { ratio, sign, tickCount }
 *   - ratio: 1.0 at rest, drifts ±a few % over a session
 *   - sign: aggregate "up" | "down" | "flat" of the last tick
 *   - tickCount: monotonic counter, key for flash animations
 */
export function useLivePortfolioRatio(holdings) {
  const ctx = useContext(LivePricesContext);

  // Register every holding's ticker with the provider so they tick
  // even if no row component is currently mounted (e.g. when the
  // user is on Wallet tab and Mercado/Portfolio aren't rendered).
  useEffect(() => {
    if (!ctx || !holdings) return;
    for (const h of holdings) {
      if (h?.ticker && typeof h.price === "number" && h.price > 0) {
        ctx.register(h.ticker, h.price);
      }
    }
  }, [ctx, holdings]);

  if (!ctx || !holdings || holdings.length === 0) {
    return { ratio: 1, sign: "flat", tickCount: 0 };
  }

  let liveSum = 0;
  let baseSum = 0;
  let prevSum = 0;
  for (const h of holdings) {
    if (!h?.ticker || typeof h.price !== "number" || !(h.qty > 0)) continue;
    const entry = ctx.get(h.ticker);
    const base = h.price;
    const live = entry?.price ?? base;
    const prev = entry?.prevPrice ?? live;
    liveSum += live * h.qty;
    baseSum += base * h.qty;
    prevSum += prev * h.qty;
  }
  const ratio = baseSum > 0 ? liveSum / baseSum : 1;
  const diff = liveSum - prevSum;
  const sign = Math.abs(diff) / Math.max(prevSum, 1) < 0.00001
    ? "flat"
    : diff > 0 ? "up" : "down";
  return { ratio, sign, tickCount: ctx.tickCount };
}
