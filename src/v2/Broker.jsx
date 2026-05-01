// ============================================================
// SAMAS v2 — Broker (Invertir) — nested sub-shell
// ============================================================
// When the user taps "Invertir" on the main shell, the entire screen
// turns into this BrokerShell. It has:
//
//   - A header with a "← Volver" arrow that pops back to the main
//     shell, plus a section title.
//   - 4 sub-tabs at the bottom (replacing the main shell's nav while
//     the user is inside Invertir):
//
//        Portafolio   holdings + total + buy/sell
//        Mercado      full asset list, filterable
//        Watchlist    saved lists
//        Órdenes      open + recent orders (cancel from here)
//
//   - The main Shell hides its own bottom nav while we're rendered
//     (it short-circuits to <BrokerShell/> when tab === "broker").
//
// Tapping any asset row anywhere inside opens the AssetSheet — a
// bottom modal with the live quote + buy/sell input. Confirming
// calls broker.placeOrder() and refreshes the affected sub-page.
// ============================================================

import React, { useState, useEffect, useCallback, useMemo, useContext } from "react";
import ReactDOM from "react-dom";
import { FONT, fmtMoney, fmtPct } from "./theme.js";
import { Ico } from "./icons.jsx";
import { Pill, SectionHead, AssetSparkline, AssetRowSkeletonList, useShellEntryDone } from "./shared.jsx";
import { useLivePrice, LivePricesContext } from "./livePrices.jsx";
import { broker as brokerApi, wallet as walletApi } from "./api/index.js";
// The Objetivos wizard is shared with the legacy MobileApp UI. It
// expects a legacy-shape theme `C`, so we pass an adapter built from
// the v2 theme `T` to keep its visual language in sync with the new UI.
import { ObjectivesWizard } from "../ai/ObjectivesWizard.jsx";
// iOS-style swipe-from-left-edge back gesture.
import { useEdgeSwipeBack } from "./useEdgeSwipeBack.js";
import { hapticNative } from "../lib/native.js";
import { usePullToRefresh } from "./usePullToRefresh.jsx";
import { toast } from "./toast.jsx";
import { t as tr } from "../lib/i18n.js";
import { analyzeAsset, tradeCoach, suggestWatchlist, rebalancePortfolio, scoreRisk, positionSize } from "../lib/ai.js";

// Sub-tabs metadata — drives both the bottom nav and the content
// switch in the top-level <BrokerShell/> render.
// Labels are looked up via tr(...) at render time so they re-translate
// when the user changes language.
const SUB_TABS = [
  { id: "portafolio", key: "broker.subnav.cartera", icon: Ico.Briefcase },
  { id: "mercado",    key: "broker.subnav.market",  icon: Ico.Chart },
  { id: "watchlist",  key: "broker.subnav.list",    icon: Ico.Star },
  { id: "ordenes",    key: "broker.subnav.orders",  icon: Ico.List },
];

// ----------------------------------------------------------
// Top-level BrokerShell — replaces the main Shell entirely while
// the user is inside Invertir.
// ----------------------------------------------------------
export function BrokerShell({ T, isNativeApp = false, onBack, proMode = true, lang = "es" }) {
  const [tab, setTab] = useState("portafolio");
  const [selectedAsset, setSelectedAsset] = useState(null);

  // Lift broker data here so all sub-tabs see the same snapshot and
  // a single refresh() call after a successful order updates everyone.
  const [portfolio, setPortfolio] = useState(null);
  const [assets, setAssets] = useState([]);
  const [watchlists, setWatchlists] = useState([]);
  const [orders, setOrders] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [stops, setStops] = useState([]);
  const [fx, setFx] = useState(null);
  // ARS / USD display toggle for Portafolio + Mercado. Lifted here so
  // it stays consistent across sub-tabs (mirrors the wallet pattern).
  const [ccy, setCcy] = useState("USD");
  // AI plan wizard — opens from the AIPlanCard. Lifted here so the
  // wizard renders at shell level (full-screen) rather than inside the
  // page scroll container.
  const [showAIWizard, setShowAIWizard] = useState(false);
  // Persisted plan, if the user already ran the wizard. Stored in
  // localStorage so they don't lose their classification across reloads.
  const [savedPlan, setSavedPlan] = useState(() => {
    if (typeof localStorage === "undefined") return null;
    try {
      const raw = localStorage.getItem("samas_v2_ai_plan");
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });
  // Adapter: map v2 theme `T` -> legacy theme `C` shape that the
  // ObjectivesWizard expects. We only need to fill in the keys it
  // actually reads (bg, border, accent, text, textMd/Lt, card, creamDk,
  // green, red, gold).
  const C = useMemo(() => ({
    bg: T.bgElev, card: T.surface, creamDk: T.surface,
    border: T.border, accent: T.accent,
    text: T.text, textMd: T.textMute, textLt: T.textDim,
    green: T.accent, red: T.danger, gold: "#C9A84C",
    isDark: true,
  }), [T]);

  // Track whether any text input is focused so we can hide the floating
  // SubNav while the iOS keyboard is up. With Capacitor's
  // Keyboard.resize=body the body shrinks and the SubNav floats just
  // above the keyboard — which would cover modal buttons. We watch
  // document focusin/focusout and toggle the nav off whenever the user
  // is typing.
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const isField = (el) => {
      if (!el || !el.tagName) return false;
      const t = el.tagName;
      return t === "INPUT" || t === "TEXTAREA" || el.isContentEditable;
    };
    const onIn = (e) => { if (isField(e.target)) setKeyboardOpen(true); };
    const onOut = (e) => { if (isField(e.target)) setKeyboardOpen(false); };
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, []);

  const refresh = useCallback(async () => {
    // Use allSettled so a single failed call (e.g. price_alerts table
    // not yet migrated, FX endpoint down) doesn't blank the whole
    // Broker shell. Each setter gets the resolved value or a sane
    // default.
    const results = await Promise.allSettled([
      brokerApi.getPortfolio(),
      brokerApi.getAssets(),
      brokerApi.getWatchlists(),
      brokerApi.getOrders({ status: "all" }),
      brokerApi.getPriceAlerts(),
      brokerApi.getStopLosses(),
      brokerApi.getFx(),
    ]);
    const [pR, aR, wlR, oR, alR, stR, fR] = results;
    const val = (r, fallback) => r.status === "fulfilled" ? r.value : fallback;
    // Surface the rejected ones in the console so we still see real
    // bugs while the UI keeps working.
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        console.warn(`[broker] load[${i}]:`, r.reason?.message || r.reason);
      }
    });
    setPortfolio(val(pR, null));
    setAssets(val(aR, []));
    setWatchlists(val(wlR, []));
    setOrders(val(oR, []));
    setAlerts(val(alR, []));
    setStops(val(stR, []));
    setFx(val(fR, null));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Cross-shell deep-link drain for AssetSheet (samas-0.2.2). Shell's
  // samas:open-asset listener stashes { ticker, ts } in
  // samas_pending_open_asset and switches to this tab; we drain it
  // here once `assets` is loaded so we can resolve ticker → asset
  // object and open the sheet. Used by proactive-insights inbox-row
  // taps (and was originally introduced for the reverted tax-loss
  // harvester in 0.2.0).
  useEffect(() => {
    if (!assets || assets.length === 0) return;
    let raw;
    try { raw = localStorage.getItem("samas_pending_open_asset"); } catch { return; }
    if (!raw) return;
    let payload;
    try { payload = JSON.parse(raw); } catch { return; }
    try { localStorage.removeItem("samas_pending_open_asset"); } catch {}
    // Stale (older than 60s) → ignore. Stops a previously aborted
    // handoff from popping a sheet on a fresh broker entry.
    if (!payload?.ticker || !payload?.ts || (Date.now() - payload.ts > 60_000)) return;
    const a = assets.find((x) => x.ticker === payload.ticker);
    if (a) {
      setTab("portafolio");
      setSelectedAsset(a);
    }
  }, [assets]);

  // Sub-nav bottom inset same logic as main shell — float 12px above
  // the home-indicator zone.
  const navBottom = isNativeApp
    ? "calc(env(safe-area-inset-bottom) + 12px)"
    : 12;

  // iOS-style swipe-from-left-edge back to the main wallet shell.
  const { bind: swipeBind, style: swipeStyle } = useEdgeSwipeBack(onBack);
  // Pull-to-refresh for the inner scroll. Re-fetches portfolio +
  // assets + watchlists + orders + alerts + stops.
  const { bind: ptrBind, indicator: ptrIndicator } = usePullToRefresh(refresh);
  // Drop the entry animation's GPU compositing layer after it
  // completes — otherwise WebKit keeps the layer alive and any
  // position:fixed descendant gets trapped inside the resulting
  // stacking context (covered by sub-nav z-index 40). samas-0.0.87.
  const entryDone = useShellEntryDone(260);

  return (
    <div {...swipeBind} style={{
      position: "absolute", inset: 0,
      background: T.bg, color: T.text,
      overflow: "hidden",
      display: "flex", flexDirection: "column",
      fontFamily: FONT.sans,
      // iOS-style push-in animation when the user enters the
      // sub-shell. Combined with the swipe-back transform via
      // ...swipeStyle (which sets its own transition during drag).
      // animation: "none" once entryDone — drops compositing layer.
      animation: entryDone ? "none" : "samas-shell-in 240ms cubic-bezier(.2,.8,.2,1)",
      ...swipeStyle,
    }}>
      <style>{`
        @keyframes samas-shell-in {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
      `}</style>
      {/* ---------- header with back arrow ---------- */}
      <div style={{
        flexShrink: 0,
        // safe-area-aware top inset (same as Wallet)
        padding: "calc(env(safe-area-inset-top) + 14px) 16px 12px",
        display: "flex", alignItems: "center", gap: 12,
        background: T.bg, // sits above the scrollable content
        borderBottom: `1px solid ${T.border}`,
        zIndex: 5,
      }}>
        <button onClick={onBack} style={{
          width: 40, height: 40, borderRadius: 12,
          background: T.surface, border: `1px solid ${T.border}`,
          color: T.text, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Ico.Back size={18}/>
        </button>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 10 }}>
          {/* Mini SAMAS mark — shows up only inside drill-in sub-shells
              (Invertir / eventually Social) so the user always knows
              they're still inside the SAMAS app even when the bottom
              nav has been replaced by section-specific tabs. */}
          <div style={{ flexShrink: 0, color: T.text }}>
            <Ico.Logo size={26}/>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: FONT.display, fontSize: 22, fontWeight: 700,
              color: T.text, letterSpacing: -0.4,
            }}>{tr("broker.title", lang)}</div>
            <div style={{ fontFamily: FONT.sans, fontSize: 12, color: T.textMute }}>
              {tr(SUB_TABS.find((t) => t.id === tab)?.key || "broker.subnav.cartera", lang)}
            </div>
          </div>
        </div>
      </div>

      {/* ---------- sticky live ticker banner ----------
          Outside the scrollable region so it stays pinned at the top
          across all sub-tabs and through scroll. Filtered to ETFs +
          commodities + cripto only (no individual stocks). Hidden when
          the user turns Pro mode off. */}
      {proMode && (
        <TickerBanner T={T} assets={assets} />
      )}

      {/* ---------- scrollable content ---------- */}
      <div {...ptrBind} style={{
        flex: 1, overflowY: "auto",
        overscrollBehavior: "contain",
        WebkitOverflowScrolling: "touch",
      }}>
        {ptrIndicator}
        {/* Keyed wrapper so each sub-tab change re-mounts and triggers
            the .samas-tab-content fade-in animation defined globally
            in Shell.jsx (samas-0.0.81). Inner short-circuits stay the
            same — only one sub-view renders at a time. */}
        <div key={tab} className="samas-tab-content">
          {tab === "portafolio" && (
            <PortafolioView
              T={T}
              portfolio={portfolio}
              assets={assets}
              fx={fx}
              ccy={ccy}
              setCcy={setCcy}
              proMode={proMode}
              savedPlan={savedPlan}
              onSelectAsset={setSelectedAsset}
              onOpenAIPlan={() => setShowAIWizard(true)}
              onGoToMercado={() => setTab("mercado")}
              lang={lang}
            />
          )}
          {tab === "mercado" && (
            <MercadoView T={T} assets={assets} ccy={ccy} setCcy={setCcy} onSelectAsset={setSelectedAsset} proMode={proMode} lang={lang} />
          )}
          {tab === "watchlist" && (
            <WatchlistView
              T={T}
              watchlists={watchlists}
              assets={assets}
              onSelectAsset={setSelectedAsset}
              onRefresh={refresh}
              proMode={proMode}
              lang={lang}
            />
          )}
          {tab === "ordenes" && (
            <OrdenesView
              T={T}
              orders={orders}
              alerts={alerts}
              stops={stops}
              holdings={portfolio?.holdings || []}
              onRefresh={refresh}
            />
          )}
        </div>
      </div>

      {/* ---------- sub-nav bottom bar ----------
          Hidden while the keyboard is open so it doesn't sit on top of
          modal buttons (Cancelar / Guardar) when typing. */}
      {!keyboardOpen && (
        <SubNav T={T} tab={tab} setTab={setTab} bottomInset={navBottom} lang={lang} />
      )}

      {/* ---------- asset sheet ---------- */}
      {selectedAsset && (
        <AssetSheet
          T={T}
          asset={selectedAsset}
          holding={portfolio?.holdings.find((h) => h.ticker === selectedAsset.ticker) || null}
          onClose={() => setSelectedAsset(null)}
          onDone={() => { setSelectedAsset(null); refresh(); }}
          watchlists={watchlists}
          onWatchlistsChange={refresh}
          proMode={proMode}
          lang={lang}
        />
      )}

      {/* ---------- AI wizard (legacy ObjectivesWizard with v2 theme) ---------- */}
      {showAIWizard && (
        <ObjectivesWizard
          C={C}
          savedPlan={savedPlan}
          onClose={() => {
            setShowAIWizard(false);
            // Belt-and-suspenders: re-read from localStorage on close.
            // If the wizard called onSave, this is a no-op. If something
            // skipped onSave (e.g. user hit Listo before generating),
            // we still pick up whatever the wizard wrote.
            try {
              const raw = localStorage.getItem("samas_v2_ai_plan");
              if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && parsed.strategy) setSavedPlan(parsed);
              }
            } catch {}
          }}
          onSave={(p) => {
            setSavedPlan(p);
            try { localStorage.setItem("samas_v2_ai_plan", JSON.stringify(p)); } catch {}
          }}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------
// SubNav — bottom nav scoped to the Invertir section. Same shape as
// SamasTabBar but with the broker-specific tab list.
// ----------------------------------------------------------
function SubNav({ T, tab, setTab, bottomInset, lang = "es" }) {
  return (
    <div style={{
      position: "absolute", left: 12, right: 12, bottom: bottomInset,
      zIndex: 40,
      borderRadius: 28, padding: "10px 8px",
      background: T.surface,
      border: `1px solid ${T.border}`,
      boxShadow: "0 12px 30px rgba(0,0,0,0.35), 0 1px 0 rgba(255,255,255,0.04) inset",
      display: "flex", justifyContent: "space-around", alignItems: "center",
    }}>
      {SUB_TABS.map((t) => {
        const active = t.id === tab;
        const TabIco = t.icon;
        return (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            background: "none", border: "none", cursor: "pointer", padding: "6px 8px",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
            color: active ? T.accent : T.textMute, position: "relative",
            fontFamily: FONT.sans, fontSize: 10, fontWeight: 600, letterSpacing: 0.2,
          }}>
            {active && (
              <div style={{
                position: "absolute", top: -10, left: "50%", transform: "translateX(-50%)",
                width: 24, height: 3, borderRadius: 2, background: T.accent,
              }} />
            )}
            <TabIco size={20} sw={active ? 2 : 1.7} />
            <span>{tr(t.key, lang)}</span>
          </button>
        );
      })}
    </div>
  );
}

// ----------------------------------------------------------
// Portafolio — total + ARS/USD toggle + ticker banner + distribución +
// holdings + top/bottom movers + AI plan card.
// ----------------------------------------------------------
function PortafolioView({ T, portfolio, assets, fx, ccy, setCcy, onSelectAsset, onOpenAIPlan, savedPlan, proMode = true, onGoToMercado, lang = "es" }) {
  // While the portfolio fetches, render asset-row-shaped shimmer
  // skeletons in the same horizontal padding the real list will
  // use. Same trick on MercadoView below — keeps the page layout
  // stable instead of jumping when data arrives.
  if (!portfolio) return <div style={{ paddingTop: 12 }}><AssetRowSkeletonList T={T} count={5} /></div>;

  const ccySym = ccy === "ARS" ? "$" : "US$";
  const total = ccy === "ARS" ? portfolio.totalArs : portfolio.totalUsd;

  return (
    <div style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 96px)" }}>
      {/* portfolio summary card */}
      <div style={{
        margin: "16px", padding: 22, borderRadius: 24,
        background: `linear-gradient(155deg, ${T.surfaceHi} 0%, ${T.surface} 60%)`,
        border: `1px solid ${T.border}`, position: "relative", overflow: "hidden",
      }}>
        <div style={{
          position: "absolute", top: -60, right: -40, width: 200, height: 200,
          borderRadius: "50%", background: T.accent, opacity: 0.10, filter: "blur(40px)",
        }}/>
        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginBottom: 10,
          }}>
            <div style={{
              fontFamily: FONT.sans, fontSize: 11, color: T.textDim,
              letterSpacing: 0.6, fontWeight: 700,
            }}>{tr("broker.portfolio_value", lang)}</div>
            {/* ARS / USD toggle */}
            <div style={{
              display: "flex", gap: 4, padding: 4,
              background: T.bg, border: `1px solid ${T.border}`,
              borderRadius: 999,
            }}>
              {["ARS", "USD"].map(c => (
                <button key={c} onClick={() => setCcy(c)} style={{
                  padding: "4px 10px", borderRadius: 999, border: "none", cursor: "pointer",
                  background: ccy === c ? T.accent : "transparent",
                  color: ccy === c ? T.accentInk : T.textMute,
                  fontFamily: FONT.mono, fontSize: 10, fontWeight: 700, letterSpacing: 0.6,
                }}>{c}</button>
              ))}
            </div>
          </div>
          <div style={{
            fontFamily: FONT.display, fontSize: 36, fontWeight: 700, color: T.text,
            letterSpacing: -1.2, fontVariantNumeric: "tabular-nums", marginBottom: 10,
          }}>
            {ccySym}{fmtMoney(total, ccy)}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Pill T={T} color={T.accent} bg={T.accentSoft}>+{ccySym}{fmtMoney(total * 0.0234, ccy)}</Pill>
            <Pill T={T} color={T.accent} bg={T.accentSoft}>+2.34%</Pill>
            <Pill T={T}>{tr("wallet.last_30d", lang)}</Pill>
          </div>
          {fx && (
            <div style={{
              marginTop: 12, fontFamily: FONT.mono, fontSize: 11, color: T.textMute,
              fontVariantNumeric: "tabular-nums",
            }}>
              MEP ${fx.mep.value.toFixed(0)} · CCL ${fx.ccl.value.toFixed(0)} · {tr("broker.fx.official", lang)} ${fx.oficial.value.toFixed(0)}
            </div>
          )}
        </div>
      </div>

      {/* AI Plan card — links to the goal-planning wizard. Always
          shown so the user can find the wizard regardless of mode.
          When the user already has a saved plan, the card morphs into
          a summary of their strategy + target. */}
      <AIPlanCard T={T} onOpen={onOpenAIPlan} savedPlan={savedPlan} lang={lang} />

      {/* AI Rebalance card (samas-0.1.4) — only when there's a
          non-empty portfolio (rebalancing an empty book is moot).
          Tap → opens the rebalance sheet with profile selector +
          proposed buy/sell actions. */}
      {portfolio.holdings.length > 0 && (
        <RebalanceCard T={T} lang={lang} onRefresh={() => onSelectAsset && onSelectAsset(null)} />
      )}

      {/* AI Risk Profile (samas-0.1.9) — per-position 1-10 risk
          score + AI-refined reason. Auto-loads, expandable rows. */}
      {portfolio.holdings.length > 0 && (
        <RiskProfileCard T={T} lang={lang} />
      )}

      {/* Distribución bar — % per holding of total cartera. Only in
          Pro mode (gated by the settings toggle). */}
      {proMode && portfolio.holdings.length > 0 && (
        <DistribucionBar T={T} holdings={portfolio.holdings} totalUsd={portfolio.totalUsd} />
      )}

      {/* Pro Portfolio dashboard (samas-0.0.42) — three new visual
          cards. All gated by Pro mode + non-empty portfolio. Order:
            sector breakdown (composition) → risk metrics (single
            number summaries) → benchmark comparison (over time).
          Each component is self-contained and reads from holdings
          + totalUsd, so adding/removing them is a one-line change. */}
      {proMode && portfolio.holdings.length > 0 && (
        <SectorDonut T={T} holdings={portfolio.holdings} totalUsd={portfolio.totalUsd} lang={lang} />
      )}
      {proMode && portfolio.holdings.length > 0 && (
        <RiskMetricsRow T={T} holdings={portfolio.holdings} totalUsd={portfolio.totalUsd} lang={lang} />
      )}
      {proMode && portfolio.holdings.length > 0 && (
        <BenchmarkLine T={T} holdings={portfolio.holdings} totalUsd={portfolio.totalUsd} lang={lang} />
      )}

      {/* holdings */}
      <div style={{ margin: "0 16px 16px" }}>
        <SectionHead T={T} title={tr("broker.holdings_title", lang)} action={tr("broker.assets_count", lang, { n: portfolio.holdings.length })} />
      </div>
      {portfolio.holdings.length === 0 ? (
        <Empty T={T}
          icon={<Ico.Briefcase size={26}/>}
          title="Aún no tenés posiciones"
          subtitle="Comprá tu primer activo desde Mercado y empezá a construir tu cartera."
          ctaLabel="Ir a Mercado"
          onCta={onGoToMercado}
        />
      ) : (
        <div style={{ margin: "0 16px" }}>
          {portfolio.holdings.map((h, i) => {
            // Holdings carry only { ticker, qty, avg, value, gainPct,
            // currency }. We need the asset metadata (name, logo,
            // category) to render the row identically to Mercado /
            // Watchlist — so denormalize against `assets` here. The
            // enriched object also flows into AssetSheet via
            // onSelectAsset, so opening a holding lands on a sheet
            // with the same name + logo as opening from Mercado.
            const meta = assets.find((a) => a.ticker === h.ticker) || {};
            const enriched = { ...meta, ...h };
            const name = meta.name || h.ticker;
            return (
              <AssetRow
                key={h.ticker}
                T={T}
                asset={enriched}
                subline={`${name} · ${h.qty} u`}
                liveMultiplier={h.qty}
                rightBottom={fmtPct(h.gainPct)}
                rightBottomColor={h.gainPct >= 0 ? T.accent : T.danger}
                isLast={i === portfolio.holdings.length - 1}
                onClick={() => onSelectAsset(enriched)}
              />
            );
          })}
        </div>
      )}

      {/* Top / bottom movers across the whole asset universe. Pro only. */}
      {proMode && assets.length > 0 && (
        <TopMovers T={T} assets={assets} onSelectAsset={onSelectAsset} />
      )}
    </div>
  );
}

// ----------------------------------------------------------
// Mercado — full universe with search + category filter.
// ----------------------------------------------------------
function MercadoView({ T, assets, onSelectAsset, proMode = false, lang = "es" }) {
  const ALL = tr("market.filter.all", lang);
  const [cat, setCat] = useState(ALL);
  const [query, setQuery] = useState("");
  const [showCompare, setShowCompare] = useState(false);
  // Pro view toggle: list (default, same as before) or heatmap.
  // Persist within the session — when the user comes back to
  // Mercado we keep their chosen view. localStorage would survive
  // app restarts but feels overkill for a viewing pref.
  const [view, setView] = useState("list");
  const cats = useMemo(() => {
    const s = new Set(assets.map((a) => a.category));
    return [ALL, ...Array.from(s)];
  }, [assets, ALL]);

  // Search matches ticker OR name (case-insensitive). Then category
  // narrows further. Order matters: search first so the user can find
  // anything quickly without remembering its category.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = assets;
    if (q) {
      rows = rows.filter((a) =>
        a.ticker.toLowerCase().includes(q) ||
        (a.name || "").toLowerCase().includes(q)
      );
    }
    if (cat !== ALL) rows = rows.filter((a) => a.category === cat);
    return rows;
  }, [assets, cat, query]);

  if (assets.length === 0) return <div style={{ paddingTop: 12 }}><AssetRowSkeletonList T={T} count={6} /></div>;

  return (
    <div style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 96px)" }}>
      {/* Pro: upcoming earnings strip — sits above search so the
          next event is visible without scrolling. Tap a chip to
          jump straight to that asset's sheet. */}
      {proMode && (
        <EarningsWidget T={T} assets={assets} onSelectAsset={onSelectAsset} lang={lang} />
      )}

      {/* Search + Comparar at the top of Mercado. */}
      <div style={{ padding: "16px 16px 8px", display: "flex", gap: 8 }}>
        <div style={{
          flex: 1,
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 14px", borderRadius: 14,
          background: T.surface, border: `1px solid ${T.border}`,
        }}>
          <Ico.Search size={16} stroke={T.textMute} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr("market.search_ph", lang)}
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              color: T.text, fontFamily: FONT.sans, fontSize: 14,
            }}
          />
          {query && (
            <button onClick={() => setQuery("")} style={{
              background: "none", border: "none", cursor: "pointer",
              color: T.textMute, fontSize: 14, padding: 0, lineHeight: 1,
            }}>×</button>
          )}
        </div>
        <button onClick={() => setShowCompare(true)} style={{
          padding: "0 14px", borderRadius: 14,
          background: T.surface, border: `1px solid ${T.border}`,
          color: T.text, fontFamily: FONT.sans, fontSize: 12, fontWeight: 700,
          cursor: "pointer", whiteSpace: "nowrap",
        }}>Comparar</button>
      </div>

      <div style={{
        display: "flex", gap: 8, padding: "4px 16px 12px",
        overflowX: "auto", scrollbarWidth: "none",
      }}>
        {cats.map((c) => {
          const active = c === cat;
          return (
            <button key={c} onClick={() => setCat(c)} style={{
              flexShrink: 0, padding: "8px 14px", borderRadius: 999,
              background: active ? T.accentSoft : T.surface,
              border: `1px solid ${active ? T.accent : T.border}`,
              color: active ? T.accent : T.textMute,
              fontFamily: FONT.sans, fontSize: 12, fontWeight: 600,
              cursor: "pointer", whiteSpace: "nowrap",
            }}>{c}</button>
          );
        })}
      </div>

      {/* Pro: list / heatmap toggle. Lives right above the result
          area so it's clearly tied to the rendered list. Hidden in
          non-Pro since we only have one view there. */}
      {proMode && (
        <div style={{
          margin: "0 16px 12px", display: "flex", gap: 4, padding: 4,
          background: T.surface, border: `1px solid ${T.border}`,
          borderRadius: 12,
        }}>
          {[
            { id: "list",    label: tr("pro.market.view.list",    lang) },
            { id: "heatmap", label: tr("pro.market.view.heatmap", lang) },
          ].map((v) => {
            const active = v.id === view;
            return (
              <button key={v.id} onClick={() => setView(v.id)} style={{
                flex: 1, padding: "8px 0", borderRadius: 8,
                background: active ? T.bg : "transparent",
                border: active ? `1px solid ${T.border}` : "1px solid transparent",
                color: active ? T.text : T.textMute,
                fontFamily: FONT.sans, fontSize: 12, fontWeight: 600, cursor: "pointer",
              }}>{v.label}</button>
            );
          })}
        </div>
      )}

      {/* Heatmap mode — Pro-only, shown instead of the list. The
          empty / no-results case for the list still applies; we
          short-circuit to the regular Empty card to keep behavior
          consistent across views. */}
      {proMode && view === "heatmap" && filtered.length > 0 && (
        <HeatmapGrid T={T} assets={filtered} onSelectAsset={onSelectAsset} lang={lang} />
      )}

      <div style={{ margin: "0 16px", display: proMode && view === "heatmap" ? "none" : undefined }}>
        {filtered.length === 0 ? (
          <Empty T={T}
            icon={<Ico.Search size={26}/>}
            title="Sin resultados"
            subtitle={`No encontramos activos para "${query}".`}
          />
        ) : (
          filtered.map((a, i) => (
            <AssetRow
              key={a.ticker}
              T={T}
              asset={a}
              subline={a.name}
              rightTop={`${a.currency === "ARS" ? "$" : "US$"}${fmtMoney(a.price, a.currency)}`}
              rightBottom={fmtPct(a.changePct)}
              rightBottomColor={a.changePct >= 0 ? T.accent : T.danger}
              isLast={i === filtered.length - 1}
              onClick={() => onSelectAsset(a)}
            />
          ))
        )}
      </div>

      {showCompare && (
        <CompareSheet T={T} assets={assets} onClose={() => setShowCompare(false)} />
      )}
    </div>
  );
}

// ----------------------------------------------------------
// CompareSheet — pick up to 3 assets and see them side-by-side. Useful
// for "should I buy AAPL or MSFT" type decisions. Each column shows
// price, 24h %, currency, category. Tap a chip to remove.
// ----------------------------------------------------------
function CompareSheet({ T, assets, onClose }) {
  const [picked, setPicked] = useState([]);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.filter((a) => {
      if (picked.includes(a.ticker)) return false;
      if (!q) return true;
      return a.ticker.toLowerCase().includes(q) || (a.name || "").toLowerCase().includes(q);
    }).slice(0, 30);
  }, [assets, picked, query]);

  const items = picked.map((tk) => assets.find((a) => a.ticker === tk)).filter(Boolean);

  function add(tk) {
    if (picked.length >= 3) return;
    setPicked([...picked, tk]);
    setQuery("");
  }
  function remove(tk) {
    setPicked(picked.filter((x) => x !== tk));
  }

  // Portal to document.body — the BrokerShell root has a translateX
  // entry animation that promotes it to a persistent GPU compositing
  // layer on iOS WebKit, which behaves like a stacking context that
  // traps position:fixed children. Without the portal, the shell's
  // sub-nav (zIndex: 40) ends up rendered ON TOP of this sheet
  // (zIndex: 100) because the sheet's zIndex is scoped to the trapped
  // layer, not the document root. samas-0.0.87 fix.
  return ReactDOM.createPortal(
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(0,0,0,0.65)",
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    }}>
      <div style={{
        width: "100%", maxWidth: 540, maxHeight: "90dvh",
        background: T.bgElev, color: T.text,
        borderTopLeftRadius: 28, borderTopRightRadius: 28,
        border: `1px solid ${T.border}`, borderBottom: "none",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          padding: "18px 20px 12px",
          borderBottom: `1px solid ${T.border}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontFamily: FONT.display, fontSize: 18, fontWeight: 700, color: T.text }}>
              Comparar activos
            </div>
            <div style={{ fontFamily: FONT.sans, fontSize: 12, color: T.textMute, marginTop: 2 }}>
              Hasta 3 activos lado a lado
            </div>
          </div>
          <button onClick={onClose} style={{
            background: T.surface, border: `1px solid ${T.border}`,
            width: 32, height: 32, borderRadius: 10, color: T.textMute,
            display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Picked chips */}
        {picked.length > 0 && (
          <div style={{ padding: "10px 16px", display: "flex", gap: 8, flexWrap: "wrap" }}>
            {picked.map((tk) => (
              <button key={tk} onClick={() => remove(tk)} style={{
                padding: "6px 10px", borderRadius: 999,
                background: T.accentSoft, border: `1px solid ${T.accent}`,
                color: T.accent, fontFamily: FONT.sans, fontSize: 12, fontWeight: 700,
                cursor: "pointer",
              }}>{tk} ×</button>
            ))}
          </div>
        )}

        {/* Side-by-side comparison */}
        {items.length > 0 && (
          <div style={{
            margin: "8px 16px", padding: 12, borderRadius: 14,
            background: T.surface, border: `1px solid ${T.border}`,
            display: "grid",
            gridTemplateColumns: `repeat(${items.length}, 1fr)`,
            gap: 10,
          }}>
            {items.map((a) => (
              <div key={a.ticker}>
                {/* Logo dropped in 0.0.67 to match the unified
                    Apple-Stocks aesthetic from 0.0.66. Ticker bumps
                    up in size to fill the visual weight. */}
                <div style={{
                  fontFamily: FONT.display, fontSize: 16, fontWeight: 800, color: T.text,
                  letterSpacing: -0.3, lineHeight: 1.1,
                }}>{a.ticker}</div>
                <div style={{ fontFamily: FONT.sans, fontSize: 10, color: T.textMute, marginBottom: 8 }}>{a.category || a.cat}</div>
                <Stat T={T} label="Precio" value={`${a.currency === "ARS" ? "$" : "US$"}${fmtMoney(a.price, a.currency)}`} mono />
                <Stat T={T} label="24h"
                  value={fmtPct(a.changePct)}
                  color={a.changePct >= 0 ? T.accent : T.danger}
                  mono />
                <Stat T={T} label="Moneda" value={a.currency} />
              </div>
            ))}
          </div>
        )}

        {/* Search + add */}
        {picked.length < 3 && (
          <div style={{ padding: "10px 16px 0" }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 14px", borderRadius: 12,
              background: T.surface, border: `1px solid ${T.border}`,
            }}>
              <Ico.Search size={14} stroke={T.textMute}/>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Agregar activo"
                style={{
                  flex: 1, background: "transparent", border: "none", outline: "none",
                  color: T.text, fontFamily: FONT.sans, fontSize: 13,
                }}
              />
            </div>
          </div>
        )}

        {/* Pickable list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 16px 16px" }}>
          {picked.length >= 3 ? (
            <div style={{ padding: 16, textAlign: "center", color: T.textMute, fontFamily: FONT.sans, fontSize: 12 }}>
              Llegaste al máximo. Quitá uno para agregar otro.
            </div>
          ) : (
            filtered.map((a) => (
              <button key={a.ticker} onClick={() => add(a.ticker)} style={{
                width: "100%", padding: "10px 4px", background: "transparent",
                border: "none", borderBottom: `1px solid ${T.border}`,
                display: "flex", alignItems: "center", gap: 10,
                cursor: "pointer", textAlign: "left",
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: FONT.display, fontSize: 14, fontWeight: 800, color: T.text,
                    letterSpacing: -0.3, lineHeight: 1.15, marginBottom: 2,
                  }}>{a.ticker}</div>
                  <div style={{
                    fontFamily: FONT.sans, fontSize: 11, color: T.textMute,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{a.name}</div>
                </div>
                {/* Solid pill for the change, matching AssetRow's
                    treatment so picker rows look like miniature
                    versions of the main list rows. */}
                <div style={{
                  fontFamily: FONT.mono, fontSize: 11, fontWeight: 700,
                  color: "#ffffff",
                  background: a.changePct >= 0 ? T.accent : T.danger,
                  padding: "3px 8px", borderRadius: 6,
                  letterSpacing: 0.2,
                }}>{fmtPct(a.changePct)}</div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function Stat({ T, label, value, color, mono }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontFamily: FONT.sans, fontSize: 9, color: T.textMute, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase" }}>{label}</div>
      <div style={{
        fontFamily: mono ? FONT.mono : FONT.sans, fontSize: 12, fontWeight: 700,
        color: color || T.text,
      }}>{value}</div>
    </div>
  );
}

// ----------------------------------------------------------
// Watchlist — multiple lists with name/create/rename/delete.
// ----------------------------------------------------------
// Color tag palette for watchlists v2. 8 colors keep the picker
// compact; we map by name → hex so a future migration could swap
// out a single hue without breaking persisted state.
const WL_COLORS = [
  { id: "green",  hex: "#16C784" },
  { id: "blue",   hex: "#3B82F6" },
  { id: "purple", hex: "#8B5CF6" },
  { id: "pink",   hex: "#EC4899" },
  { id: "orange", hex: "#F59E0B" },
  { id: "red",    hex: "#EF4444" },
  { id: "cyan",   hex: "#06B6D4" },
  { id: "lime",   hex: "#84CC16" },
];

function WatchlistView({ T, watchlists, assets, onSelectAsset, onRefresh, proMode = false, lang = "es" }) {
  // Selected list ID. Default to the first one; if it gets deleted
  // we fall back to whichever is now first.
  const [selectedId, setSelectedId] = useState(null);
  const [modal, setModal] = useState(null); // "create" | "rename" | "confirm-delete" | "add-asset" | "color" | null
  const [reorderBusy, setReorderBusy] = useState(false);

  // Pick a sensible initial selection when lists arrive. Re-runs if
  // the list set changes (e.g. after creating or deleting).
  useEffect(() => {
    if (!watchlists.length) { setSelectedId(null); return; }
    if (!selectedId || !watchlists.find((w) => w.id === selectedId)) {
      setSelectedId(watchlists[0].id);
    }
  }, [watchlists, selectedId]);

  const selected = watchlists.find((w) => w.id === selectedId);
  const items = selected
    ? selected.tickers.map((tk) => assets.find((a) => a.ticker === tk)).filter(Boolean)
    : [];

  if (!watchlists.length) {
    return (
      <div style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 96px)", padding: 16 }}>
        <Empty T={T}
          icon={<Ico.Star size={26}/>}
          title="Sin watchlists"
          subtitle="Armá una lista para seguir tus activos favoritos sin tenerlos comprados todavía."
          ctaLabel="+ Crear lista"
          onCta={() => setModal("create")}
        />
        {modal === "create" && (
          <NameModal T={T} title="Nueva lista" placeholder="Mi watchlist"
            onClose={() => setModal(null)}
            onSubmit={async (name) => {
              await brokerApi.createWatchlist(name);
              await onRefresh();
              setModal(null);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 96px)" }}>
      {/* Pills row — each watchlist + "+" to create a new one. */}
      <div style={{
        display: "flex", gap: 8, padding: "16px 16px 12px",
        overflowX: "auto", scrollbarWidth: "none",
      }}>
        {watchlists.map((w) => {
          const active = w.id === selectedId;
          // Color tag — small dot leading the pill text. Renders
          // for any list that has a color set (Pro feature) and
          // falls back to no dot for legacy / non-Pro lists.
          const tagColor = w.color
            ? (WL_COLORS.find((c) => c.id === w.color)?.hex || w.color)
            : null;
          return (
            <button key={w.id} onClick={() => setSelectedId(w.id)} style={{
              flexShrink: 0, padding: "8px 14px", borderRadius: 999,
              background: active ? T.accentSoft : T.surface,
              border: `1px solid ${active ? T.accent : T.border}`,
              color: active ? T.accent : T.text,
              fontFamily: FONT.sans, fontSize: 13, fontWeight: 600,
              cursor: "pointer", whiteSpace: "nowrap",
              display: "inline-flex", alignItems: "center", gap: 8,
            }}>
              {tagColor && (
                <span style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: tagColor, flexShrink: 0,
                }}/>
              )}
              {w.name} <span style={{ color: T.textMute, marginLeft: 4 }}>{w.tickers.length}</span>
            </button>
          );
        })}
        <button onClick={() => setModal("create")} style={{
          flexShrink: 0, padding: "8px 14px", borderRadius: 999,
          background: T.surface, border: `1px dashed ${T.border}`,
          color: T.textMute, fontFamily: FONT.sans, fontSize: 13, fontWeight: 600,
          cursor: "pointer", whiteSpace: "nowrap",
        }}>+ Nueva</button>
        {/* AI watchlist creator (samas-0.1.0). Same pill shape as
            "+ Nueva" but accent-bordered + sparkle glyph so it reads
            as the AI option. */}
        <button onClick={() => setModal("ai-create")} style={{
          flexShrink: 0, padding: "8px 14px", borderRadius: 999,
          background: T.surface, border: `1.5px solid ${T.accent}`,
          color: T.accent, fontFamily: FONT.sans, fontSize: 13, fontWeight: 700,
          cursor: "pointer", whiteSpace: "nowrap",
          display: "inline-flex", alignItems: "center", gap: 6,
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>
          </svg>
          IA
        </button>
      </div>

      {/* Selected list header with rename/delete actions */}
      {selected && (
        <div style={{
          margin: "0 16px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          gap: 12, marginBottom: 8,
        }}>
          <div style={{
            fontFamily: FONT.display, fontSize: 18, fontWeight: 700, color: T.text,
            letterSpacing: -0.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{selected.name}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {/* Pro: Compartir — dispatches the watchlist body to the
                Social compose box via the briefcase pattern (same as
                share-trade). Hidden in non-Pro. */}
            {proMode && selected.tickers.length > 0 && (
              <button
                onClick={() => {
                  const tickers = selected.tickers.map((t) => `$${t}`).join(" ");
                  const body = tr("pro.wl.share_template", lang, {
                    name: selected.name,
                    tickers,
                  }).slice(0, 280);
                  try {
                    window.dispatchEvent(new CustomEvent("samas:share-watchlist", {
                      detail: { body },
                    }));
                  } catch {}
                }}
                style={{
                  padding: "5px 10px", borderRadius: 8,
                  background: T.accentSoft, border: `1px solid ${T.accent}55`,
                  color: T.accent, fontFamily: FONT.sans, fontSize: 11, fontWeight: 700,
                  cursor: "pointer",
                }}
              >{tr("pro.wl.share", lang)}</button>
            )}
            {/* Pro: color tag picker. Tap → swatch row sheet. */}
            {proMode && (
              <button onClick={() => setModal("color")} style={{
                padding: "5px 10px", borderRadius: 8,
                background: "transparent", border: `1px solid ${T.border}`,
                color: T.textMute, fontFamily: FONT.sans, fontSize: 11, fontWeight: 600,
                cursor: "pointer",
              }}>{tr("pro.wl.color", lang)}</button>
            )}
            <button onClick={() => setModal("rename")} style={{
              padding: "5px 10px", borderRadius: 8,
              background: "transparent", border: `1px solid ${T.border}`,
              color: T.textMute, fontFamily: FONT.sans, fontSize: 11, fontWeight: 600,
              cursor: "pointer",
            }}>Renombrar</button>
            <button onClick={() => setModal("confirm-delete")} style={{
              padding: "5px 10px", borderRadius: 8,
              background: "transparent", border: `1px solid ${T.border}`,
              color: T.danger, fontFamily: FONT.sans, fontSize: 11, fontWeight: 600,
              cursor: "pointer",
            }}>Borrar</button>
          </div>
        </div>
      )}

      {/* Tickers */}
      {items.length === 0 ? (
        <Empty T={T}
          icon={<Ico.Star size={26}/>}
          title="Esta lista está vacía"
          subtitle="Agregá activos para verlos rápido sin tenerlos en tu cartera."
          ctaLabel="+ Agregar activo"
          onCta={() => setModal("add-asset")}
        />
      ) : (
        <div style={{ margin: "0 16px" }}>
          {items.map((a, i) => (
            <div key={a.ticker} style={{ display: "flex", alignItems: "stretch", gap: 6 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <AssetRow
                  T={T}
                  asset={a}
                  subline={a.name}
                  rightTop={`${a.currency === "ARS" ? "$" : "US$"}${fmtMoney(a.price, a.currency)}`}
                  rightBottom={fmtPct(a.changePct)}
                  rightBottomColor={a.changePct >= 0 ? T.accent : T.danger}
                  isLast={i === items.length - 1}
                  onClick={() => onSelectAsset(a)}
                />
              </div>
              {/* Pro reorder arrows — only render in Pro mode and only
                  when the list has at least 2 tickers (otherwise the
                  arrows would always be disabled). */}
              {proMode && items.length > 1 && (
                <div style={{
                  display: "flex", flexDirection: "column", gap: 4,
                  paddingTop: 8,
                }}>
                  {[
                    { dir: "up",   disabled: i === 0,                offset: -1 },
                    { dir: "down", disabled: i === items.length - 1, offset: 1 },
                  ].map(({ dir, disabled, offset }) => (
                    <button
                      key={dir}
                      disabled={disabled || reorderBusy}
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (disabled || reorderBusy) return;
                        setReorderBusy(true);
                        try {
                          // Compute the new ticker order from the
                          // currently-rendered items so we don't
                          // depend on `selected.tickers` ordering
                          // matching the visual ordering exactly.
                          const order = items.map((x) => x.ticker);
                          const j = i + offset;
                          [order[i], order[j]] = [order[j], order[i]];
                          await brokerApi.reorderWatchlist(selected.id, order);
                          await onRefresh();
                        } finally {
                          setReorderBusy(false);
                        }
                      }}
                      aria-label={tr(dir === "up" ? "pro.wl.move_up" : "pro.wl.move_down", lang)}
                      style={{
                        width: 28, height: 28, borderRadius: 8,
                        background: T.surface,
                        border: `1px solid ${T.border}`,
                        color: disabled ? T.textMute : T.text,
                        cursor: disabled ? "default" : "pointer",
                        opacity: disabled ? 0.4 : 1,
                        padding: 0, display: "flex",
                        alignItems: "center", justifyContent: "center",
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        {dir === "up"
                          ? <polyline points="18 15 12 9 6 15"/>
                          : <polyline points="6 9 12 15 18 9"/>}
                      </svg>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* + Agregar activo — picker that adds an asset to this list. */}
      {selected && (
        <div style={{ margin: "16px" }}>
          <button onClick={() => setModal("add-asset")} style={{
            width: "100%", padding: 14, borderRadius: 14,
            background: "transparent", border: `1.5px dashed ${T.border}`,
            color: T.textMute, fontFamily: FONT.sans, fontSize: 13, fontWeight: 600,
            cursor: "pointer",
          }}>+ Agregar activo</button>
        </div>
      )}

      {/* Modals */}
      {modal === "create" && (
        <NameModal T={T} title="Nueva lista" placeholder="Mi watchlist"
          onClose={() => setModal(null)}
          onSubmit={async (name) => {
            const wl = await brokerApi.createWatchlist(name);
            await onRefresh();
            setSelectedId(wl.id);
            setModal(null);
          }}
        />
      )}
      {/* AI watchlist creator (samas-0.1.0). User types a theme,
          AI proposes name + color + tickers + reason; user can
          edit before saving. */}
      {modal === "ai-create" && (
        <AIWatchlistModal
          T={T}
          lang={lang}
          onClose={() => setModal(null)}
          onSave={async ({ name, color, tickers }) => {
            const wl = await brokerApi.createWatchlist(name, { color });
            for (let i = 0; i < tickers.length; i++) {
              await brokerApi.addToWatchlist(wl.id, tickers[i]);
            }
            await onRefresh();
            setSelectedId(wl.id);
            setModal(null);
          }}
        />
      )}
      {modal === "rename" && selected && (
        <NameModal T={T} title="Renombrar lista" initial={selected.name}
          onClose={() => setModal(null)}
          onSubmit={async (name) => {
            await brokerApi.renameWatchlist(selected.id, name);
            await onRefresh();
            setModal(null);
          }}
        />
      )}
      {modal === "confirm-delete" && selected && (
        <ConfirmModal T={T}
          title="¿Borrar lista?"
          message={`Vas a perder la lista "${selected.name}" y los ${selected.tickers.length} activos que tiene.`}
          confirmLabel="Borrar"
          danger
          onClose={() => setModal(null)}
          onConfirm={async () => {
            await brokerApi.removeWatchlist(selected.id);
            await onRefresh();
            setModal(null);
          }}
        />
      )}
      {modal === "color" && selected && (
        <div onClick={(e) => { if (e.target === e.currentTarget) setModal(null); }} style={{
          position: "fixed", inset: 0, zIndex: 110,
          background: "rgba(0,0,0,0.6)",
          display: "flex", alignItems: "flex-end", justifyContent: "center",
        }}>
          <div style={{
            width: "100%", maxWidth: 540,
            background: T.bgElev || T.surface, color: T.text,
            borderTopLeftRadius: 24, borderTopRightRadius: 24,
            border: `1px solid ${T.border}`, borderBottom: "none",
            padding: "20px 20px 28px",
          }}>
            <div style={{
              fontFamily: FONT.display, fontSize: 17, fontWeight: 700,
              color: T.text, marginBottom: 14,
            }}>{tr("pro.wl.color", lang)}</div>
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 10, marginBottom: 12,
            }}>
              {/* "None" swatch — clears the color tag back to default. */}
              <button
                onClick={async () => {
                  await brokerApi.setWatchlistColor(selected.id, null);
                  await onRefresh();
                  setModal(null);
                }}
                style={{
                  aspectRatio: "1 / 1", borderRadius: 999,
                  background: "transparent", border: `2px dashed ${T.border}`,
                  color: T.textMute, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 18, lineHeight: 1, padding: 0,
                }}
              >×</button>
              {WL_COLORS.map((c) => {
                const active = selected.color === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={async () => {
                      await brokerApi.setWatchlistColor(selected.id, c.id);
                      await onRefresh();
                      setModal(null);
                    }}
                    style={{
                      aspectRatio: "1 / 1", borderRadius: 999,
                      background: c.hex,
                      border: active ? `3px solid ${T.text}` : `2px solid ${T.border}`,
                      cursor: "pointer", padding: 0,
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}
      {modal === "add-asset" && selected && (
        <AddAssetModal
          T={T}
          assets={assets}
          excludeTickers={selected.tickers}
          listName={selected.name}
          lang={lang}
          onClose={() => setModal(null)}
          onPick={async (ticker) => {
            await brokerApi.addToWatchlist(selected.id, ticker);
            await onRefresh();
            setModal(null);
          }}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------
// Tiny modal shells — used by watchlist mgmt and other simple flows.
// ----------------------------------------------------------
// ============================================================
// AIWatchlistModal (samas-0.1.0) — type a theme → AI proposes a
// watchlist (name + color + tickers + rationale) → user reviews +
// edits → saves.
// ============================================================
function AIWatchlistModal({ T, lang = "es", onClose, onSave }) {
  const [theme, setTheme] = useState("");
  const [proposal, setProposal] = useState(null); // { name, color, tickers, reason }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [savingBusy, setSavingBusy] = useState(false);

  // Suggestion chips for empty-state inspiration. Tap to fill the
  // theme input + auto-submit so the user sees "Cohen demo" at work.
  const STARTERS = [
    tr("watchlist.ai.starter.tech", lang),
    tr("watchlist.ai.starter.dividend", lang),
    tr("watchlist.ai.starter.energy_ar", lang),
    tr("watchlist.ai.starter.crypto", lang),
  ];

  async function generate(t) {
    const themeText = String(t || theme).trim();
    if (!themeText) { setErr("Ingresá un tema."); return; }
    setErr(null); setBusy(true); setProposal(null);
    hapticNative("tap").catch(() => {});
    try {
      const data = await suggestWatchlist(themeText);
      setProposal(data);
      hapticNative("success").catch(() => {});
    } catch (e) {
      if (e?.name === "AIConsentDeniedError" || e?.name === "AIQuotaExceededError") onClose();
      else setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  function toggleTicker(tk) {
    if (!proposal) return;
    setProposal((p) => ({
      ...p,
      tickers: p.tickers.includes(tk)
        ? p.tickers.filter((x) => x !== tk)
        : [...p.tickers, tk],
    }));
  }

  async function save() {
    if (!proposal || savingBusy) return;
    if (proposal.tickers.length === 0) {
      setErr("Necesitás al menos un ticker."); return;
    }
    setSavingBusy(true);
    try {
      await onSave({
        name: proposal.name,
        color: proposal.color,
        tickers: proposal.tickers,
      });
    } catch (e) {
      setErr(e?.message || String(e));
      setSavingBusy(false);
    }
  }

  const colorHex = proposal
    ? (WL_COLORS.find((c) => c.id === proposal.color)?.hex || T.accent)
    : null;

  return ReactDOM.createPortal(
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !savingBusy) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 130,
        background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        animation: "samas-fade-in 160ms ease-out",
      }}
    >
      <div style={{
        width: "100%", maxWidth: 540, maxHeight: "90vh",
        background: T.bgElev || T.bg, color: T.text,
        borderTopLeftRadius: 24, borderTopRightRadius: 24,
        border: `1px solid ${T.border}`, borderBottom: "none",
        display: "flex", flexDirection: "column", overflow: "hidden",
        animation: "samas-sheet-up 220ms ease-out",
      }}>
        {/* Header */}
        <div style={{
          padding: "16px 20px 12px", display: "flex", alignItems: "center", gap: 10,
          borderBottom: `1px solid ${T.border}`,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 10,
            background: T.accent, color: "#06180c", flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: FONT.sans, fontSize: 11, fontWeight: 700,
              color: T.accent, letterSpacing: 0.6, textTransform: "uppercase" }}>
              IA · {tr("watchlist.ai.kicker", lang)}
            </div>
            <div style={{ fontFamily: FONT.display, fontSize: 17, fontWeight: 700, color: T.text, letterSpacing: -0.3 }}>
              {tr("watchlist.ai.title", lang)}
            </div>
          </div>
          <button onClick={onClose} disabled={savingBusy} aria-label="Cerrar"
            style={{
              width: 32, height: 32, borderRadius: 16,
              background: T.bg, border: `1px solid ${T.border}`,
              color: T.textMute, fontFamily: FONT.sans, fontSize: 16,
              cursor: savingBusy ? "default" : "pointer", padding: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>×</button>
        </div>

        {/* Body — scrolls */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px" }}>
          <div style={{ fontFamily: FONT.sans, fontSize: 13, color: T.textMute, lineHeight: 1.5, marginBottom: 12 }}>
            {tr("watchlist.ai.intro", lang)}
          </div>
          <input
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            disabled={busy || savingBusy}
            placeholder={tr("watchlist.ai.input_ph", lang)}
            onKeyDown={(e) => { if (e.key === "Enter") generate(); }}
            style={{
              width: "100%", padding: "12px 14px", borderRadius: 12,
              background: T.surface, border: `1px solid ${T.border}`,
              color: T.text, fontFamily: FONT.sans, fontSize: 14,
              outline: "none", marginBottom: 8, boxSizing: "border-box",
            }}
          />
          {/* Starter chips */}
          {!proposal && !busy && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
              {STARTERS.map((s) => (
                <button key={s} onClick={() => { setTheme(s); generate(s); }}
                  style={{
                    padding: "6px 12px", borderRadius: 999,
                    background: T.bg, border: `1px solid ${T.border}`,
                    color: T.textMute, fontFamily: FONT.sans, fontSize: 12, fontWeight: 600,
                    cursor: "pointer",
                  }}>{s}</button>
              ))}
            </div>
          )}

          {/* Generate button */}
          {!proposal && (
            <button
              onClick={() => generate()}
              disabled={busy || !theme.trim()}
              style={{
                width: "100%", padding: "12px 14px", borderRadius: 12,
                background: theme.trim() && !busy ? T.accent : T.surface,
                color: theme.trim() && !busy ? T.accentInk : T.textMute,
                border: theme.trim() && !busy ? "none" : `1px solid ${T.border}`,
                fontFamily: FONT.sans, fontSize: 14, fontWeight: 700,
                cursor: busy || !theme.trim() ? "default" : "pointer",
                opacity: busy ? 0.7 : 1,
              }}
            >
              {busy ? tr("watchlist.ai.generating", lang) : tr("watchlist.ai.generate", lang)}
            </button>
          )}

          {err && (
            <div style={{
              marginTop: 10, padding: "10px 12px", borderRadius: 12,
              background: T.dangerSoft, color: T.danger,
              fontFamily: FONT.sans, fontSize: 12, lineHeight: 1.4,
            }}>{err}</div>
          )}

          {/* Proposal — name preview, reason, tickers (toggle to remove). */}
          {proposal && (
            <>
              <div style={{
                marginTop: 14, padding: 14, borderRadius: 14,
                background: `linear-gradient(135deg, ${T.accentSoft}, transparent 80%)`,
                border: `1.5px solid ${T.accent}`,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{
                    width: 10, height: 10, borderRadius: 5, background: colorHex,
                  }} />
                  <input
                    value={proposal.name}
                    onChange={(e) => setProposal((p) => ({ ...p, name: e.target.value.slice(0, 30) }))}
                    style={{
                      flex: 1,
                      background: "transparent", border: "none", outline: "none",
                      color: T.text, fontFamily: FONT.display, fontSize: 17, fontWeight: 700,
                    }}
                  />
                  <span style={{
                    fontFamily: FONT.mono, fontSize: 10, color: T.textMute, fontWeight: 700,
                  }}>{proposal.tickers.length}</span>
                </div>
                {proposal.reason && (
                  <div style={{
                    fontFamily: FONT.sans, fontSize: 12, color: T.textMute, lineHeight: 1.5,
                  }}>{proposal.reason}</div>
                )}
              </div>

              <div style={{
                marginTop: 14, marginBottom: 8,
                fontFamily: FONT.sans, fontSize: 11, fontWeight: 700,
                color: T.textMute, letterSpacing: 0.5, textTransform: "uppercase",
              }}>{tr("watchlist.ai.tickers_label", lang)}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {proposal.tickers.map((tk) => (
                  <button key={tk} onClick={() => toggleTicker(tk)}
                    style={{
                      padding: "6px 10px", borderRadius: 999,
                      background: T.accent, color: T.accentInk,
                      border: "none", cursor: "pointer",
                      fontFamily: FONT.mono, fontSize: 12, fontWeight: 700,
                      letterSpacing: 0.4,
                      display: "inline-flex", alignItems: "center", gap: 6,
                    }}>
                    ${tk}
                    <span style={{ opacity: 0.7, fontSize: 11 }}>×</span>
                  </button>
                ))}
              </div>
              <button
                onClick={() => { setProposal(null); setTheme(""); setErr(null); }}
                style={{
                  marginTop: 14, padding: "8px 12px", borderRadius: 999,
                  background: "transparent", border: `1px solid ${T.border}`,
                  color: T.textMute, fontFamily: FONT.sans, fontSize: 12, fontWeight: 600,
                  cursor: "pointer",
                }}>{tr("watchlist.ai.regenerate", lang)}</button>
            </>
          )}
        </div>

        {/* Sticky footer with Save */}
        {proposal && (
          <div style={{
            padding: "12px 18px calc(env(safe-area-inset-bottom) + 14px)",
            borderTop: `1px solid ${T.border}`,
            background: T.bgElev || T.bg,
          }}>
            <button
              onClick={save}
              disabled={savingBusy || proposal.tickers.length === 0}
              style={{
                width: "100%", padding: "13px 16px", borderRadius: 14,
                background: T.accent, color: T.accentInk,
                fontFamily: FONT.sans, fontSize: 14, fontWeight: 800, border: "none",
                cursor: savingBusy ? "default" : "pointer",
                opacity: savingBusy ? 0.6 : 1,
              }}>
              {savingBusy ? tr("watchlist.ai.saving", lang) : tr("watchlist.ai.save", lang)}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

function NameModal({ T, title, placeholder, initial, onClose, onSubmit }) {
  const [value, setValue] = useState(initial || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function go() {
    setErr(null);
    if (!value.trim()) { setErr("Indicá un nombre."); return; }
    setBusy(true);
    try { await onSubmit(value.trim()); }
    catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(0,0,0,0.6)",
      // Centered (not bottom-anchored) so when iOS pops the keyboard
      // the modal stays in the visible viewport instead of being
      // covered. Bottom-sheet visuals are nice but break with text
      // inputs on mobile.
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 16,
      // dvh (dynamic viewport height) shrinks with the keyboard so
      // the available area for the centered modal is always visible.
      maxHeight: "100dvh",
    }}>
      <div style={{
        width: "100%", maxWidth: 540,
        background: T.bgElev, color: T.text,
        borderRadius: 22,
        border: `1px solid ${T.border}`,
        padding: "20px 20px",
      }}>
        <div style={{ fontFamily: FONT.display, fontSize: 20, fontWeight: 700, color: T.text, marginBottom: 14 }}>{title}</div>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          maxLength={40}
          style={{
            width: "100%", boxSizing: "border-box",
            padding: "14px 16px", borderRadius: 14,
            background: T.surface, border: `1px solid ${T.border}`,
            color: T.text, fontFamily: FONT.sans, fontSize: 15, fontWeight: 500,
            outline: "none",
          }}
        />
        {err && <div style={{ marginTop: 10, color: T.danger, fontFamily: FONT.sans, fontSize: 12 }}>{err}</div>}
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button onClick={onClose} disabled={busy} style={{
            flex: 1, padding: 14, borderRadius: 14,
            background: T.surface, border: `1px solid ${T.border}`,
            color: T.text, fontFamily: FONT.sans, fontSize: 14, fontWeight: 600,
            cursor: busy ? "default" : "pointer",
          }}>Cancelar</button>
          <button onClick={go} disabled={busy} style={{
            flex: 1, padding: 14, borderRadius: 14,
            background: T.accent, color: T.accentInk,
            fontFamily: FONT.sans, fontSize: 14, fontWeight: 700, border: "none",
            cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
          }}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

function ConfirmModal({ T, title, message, confirmLabel = "Confirmar", danger, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function go() {
    setBusy(true); setErr(null);
    try { await onConfirm(); }
    catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(0,0,0,0.6)",
      // Centered (not bottom-anchored) so when iOS pops the keyboard
      // the modal stays in the visible viewport instead of being
      // covered. Bottom-sheet visuals are nice but break with text
      // inputs on mobile.
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 16,
      // dvh (dynamic viewport height) shrinks with the keyboard so
      // the available area for the centered modal is always visible.
      maxHeight: "100dvh",
    }}>
      <div style={{
        width: "100%", maxWidth: 540,
        background: T.bgElev, color: T.text,
        borderRadius: 22,
        border: `1px solid ${T.border}`,
        padding: "20px 20px",
      }}>
        <div style={{ fontFamily: FONT.display, fontSize: 20, fontWeight: 700, color: T.text, marginBottom: 8 }}>{title}</div>
        <div style={{ fontFamily: FONT.sans, fontSize: 13, color: T.textMute, lineHeight: 1.5 }}>{message}</div>
        {err && <div style={{ marginTop: 10, color: T.danger, fontFamily: FONT.sans, fontSize: 12 }}>{err}</div>}
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <button onClick={onClose} disabled={busy} style={{
            flex: 1, padding: 14, borderRadius: 14,
            background: T.surface, border: `1px solid ${T.border}`,
            color: T.text, fontFamily: FONT.sans, fontSize: 14, fontWeight: 600,
            cursor: busy ? "default" : "pointer",
          }}>Cancelar</button>
          <button onClick={go} disabled={busy} style={{
            flex: 1, padding: 14, borderRadius: 14,
            background: danger ? T.danger : T.accent,
            color: danger ? "#FFFFFF" : T.accentInk,
            fontFamily: FONT.sans, fontSize: 14, fontWeight: 700, border: "none",
            cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
          }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------
// Órdenes — list of submitted orders, with cancel button on open ones.
// ----------------------------------------------------------
function OrdenesView({ T, orders, alerts, stops, holdings, onRefresh }) {
  const [busyKey, setBusyKey] = useState(null);
  // Filter the four sections by status. "Todas" shows the full
  // structured view (default). Other tabs collapse to a single section.
  const [filter, setFilter] = useState("all");

  async function cancelOrder(orderId) {
    setBusyKey(`order:${orderId}`);
    try { await brokerApi.cancelOrder(orderId); await onRefresh(); }
    catch (e) { toast.error(e.message); }
    setBusyKey(null);
  }
  async function removeAlert(ticker) {
    setBusyKey(`alert:${ticker}`);
    try { await brokerApi.removePriceAlert(ticker); await onRefresh(); }
    catch (e) { toast.error(e.message); }
    setBusyKey(null);
  }
  async function removeStop(ticker) {
    setBusyKey(`stop:${ticker}`);
    try { await brokerApi.removeStopLoss(ticker); await onRefresh(); }
    catch (e) { toast.error(e.message); }
    setBusyKey(null);
  }

  const openOrders = orders.filter((o) => o.status === "open");
  const filledOrders = orders.filter((o) => o.status === "filled");
  const cancelledOrders = orders.filter((o) => o.status === "cancelled" || o.status === "canceled");
  const recentOrders = orders.filter((o) => o.status !== "open").slice(0, 20);
  const totalActive = openOrders.length + alerts.length + stops.length;

  const showOrders   = filter === "all" || filter === "open";
  const showAlerts   = filter === "all" || filter === "alerts";
  const showStops    = filter === "all" || filter === "stops";
  const showFilled   = filter === "all" || filter === "filled";
  const showCancelled = filter === "cancelled";

  // Empty state — vertically centered in the available area.
  if (totalActive === 0 && recentOrders.length === 0) {
    return (
      <div style={{
        padding: "16px",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 96px)",
        // minHeight 100% of the scroll container so flex centering works.
        minHeight: "calc(100vh - 200px)",
        display: "flex", flexDirection: "column",
      }}>
        <SectionHead T={T} title="Órdenes" action="0 activas" />
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{
            padding: "40px 28px", borderRadius: 22,
            background: T.surface, border: `1px solid ${T.border}`,
            textAlign: "center", maxWidth: 320,
          }}>
            <div style={{ fontFamily: FONT.display, fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 8 }}>
              Sin actividad
            </div>
            <div style={{ fontFamily: FONT.sans, fontSize: 13, color: T.textMute, lineHeight: 1.5 }}>
              Tus órdenes, alertas de precio y stop losses aparecen acá. Tocá un activo en Mercado para empezar.
            </div>
          </div>
        </div>
      </div>
    );
  }

  const FILTERS = [
    { id: "all",       label: "Todas" },
    { id: "open",      label: `Pendientes${openOrders.length ? ` (${openOrders.length})` : ""}` },
    { id: "alerts",    label: `Alertas${alerts.length ? ` (${alerts.length})` : ""}` },
    { id: "stops",     label: `Stops${stops.length ? ` (${stops.length})` : ""}` },
    { id: "filled",    label: "Ejecutadas" },
    { id: "cancelled", label: "Canceladas" },
  ];

  return (
    <div style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 96px)" }}>
      <div style={{ margin: "16px" }}>
        <SectionHead T={T} title="Órdenes" action={`${totalActive} activas`} />
      </div>

      {/* Filter pills — segmented control across all order/alert types. */}
      <div style={{
        display: "flex", gap: 8, padding: "0 16px 12px",
        overflowX: "auto", scrollbarWidth: "none",
      }}>
        {FILTERS.map((f) => {
          const active = f.id === filter;
          return (
            <button key={f.id} onClick={() => setFilter(f.id)} style={{
              flexShrink: 0, padding: "7px 14px", borderRadius: 999,
              background: active ? T.accentSoft : T.surface,
              border: `1px solid ${active ? T.accent : T.border}`,
              color: active ? T.accent : T.textMute,
              fontFamily: FONT.sans, fontSize: 12, fontWeight: 600,
              cursor: "pointer", whiteSpace: "nowrap",
            }}>{f.label}</button>
          );
        })}
      </div>

      {showOrders && openOrders.length > 0 && (
        <Group T={T} title="Órdenes pendientes">
          {openOrders.map((o, i) => (
            <OrderRow
              key={o.id} T={T} order={o}
              isLast={i === openOrders.length - 1}
              busy={busyKey === `order:${o.id}`}
              onCancel={() => cancelOrder(o.id)}
            />
          ))}
        </Group>
      )}

      {showAlerts && alerts.length > 0 && (
        <Group T={T} title="Alertas de precio">
          {alerts.map((a, i) => (
            <AlertRow
              key={a.ticker} T={T} alert={a}
              isLast={i === alerts.length - 1}
              busy={busyKey === `alert:${a.ticker}`}
              onRemove={() => removeAlert(a.ticker)}
            />
          ))}
        </Group>
      )}

      {showStops && stops.length > 0 && (
        <Group T={T} title="Stop losses">
          {stops.map((s, i) => (
            <StopRow
              key={s.ticker} T={T} stop={s}
              isLast={i === stops.length - 1}
              busy={busyKey === `stop:${s.ticker}`}
              onRemove={() => removeStop(s.ticker)}
            />
          ))}
        </Group>
      )}

      {filter === "all" && recentOrders.length > 0 && (
        <Group T={T} title="Histórico">
          {recentOrders.map((o, i) => (
            <OrderRow
              key={o.id} T={T} order={o}
              isLast={i === recentOrders.length - 1}
            />
          ))}
        </Group>
      )}

      {filter === "filled" && filledOrders.length > 0 && (
        <Group T={T} title="Ejecutadas">
          {filledOrders.map((o, i) => (
            <OrderRow key={o.id} T={T} order={o} isLast={i === filledOrders.length - 1} />
          ))}
        </Group>
      )}

      {showCancelled && (
        cancelledOrders.length > 0 ? (
          <Group T={T} title="Canceladas">
            {cancelledOrders.map((o, i) => (
              <OrderRow key={o.id} T={T} order={o} isLast={i === cancelledOrders.length - 1} />
            ))}
          </Group>
        ) : (
          <div style={{ padding: 30, textAlign: "center", color: T.textMute, fontFamily: FONT.sans, fontSize: 13 }}>
            Sin órdenes canceladas.
          </div>
        )
      )}
    </div>
  );
}

function Group({ T, title, children }) {
  return (
    <>
      <div style={{
        padding: "0 20px", marginTop: 18, marginBottom: 6,
        fontFamily: FONT.sans, fontSize: 11, fontWeight: 700,
        color: T.textDim, letterSpacing: 0.6,
      }}>{title.toUpperCase()}</div>
      <div style={{
        margin: "0 16px", borderRadius: 18,
        background: T.surface, border: `1px solid ${T.border}`, overflow: "hidden",
      }}>
        {children}
      </div>
    </>
  );
}

function AlertRow({ T, alert, isLast, busy, onRemove }) {
  const a = alert.asset;
  const cur = a?.price ?? 0;
  const distance = ((alert.targetPrice - cur) / cur) * 100;
  return (
    <div style={{
      padding: "14px 16px", display: "flex", alignItems: "center", gap: 12,
      borderBottom: isLast ? "none" : `1px solid ${T.border}`,
    }}>
      <div style={{
        width: 38, height: 38, borderRadius: 12,
        background: T.accentSoft, color: T.accent,
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}>
        <Ico.Bell size={16}/>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: FONT.sans, fontSize: 14, fontWeight: 700, color: T.text }}>
          {alert.ticker}{" "}
          <span style={{ color: T.textMute, fontWeight: 500 }}>
            · cuando {alert.direction === "above" ? "supere" : "baje a"}
          </span>
        </div>
        <div style={{ fontFamily: FONT.mono, fontSize: 12, color: T.textMute }}>
          ${fmtMoney(alert.targetPrice)} ({distance >= 0 ? "+" : ""}{distance.toFixed(1)}% del actual)
        </div>
      </div>
      <button onClick={onRemove} disabled={busy} style={{
        padding: "5px 10px", borderRadius: 8,
        background: "transparent", border: `1px solid ${T.border}`,
        color: T.textMute, fontFamily: FONT.sans, fontSize: 11, fontWeight: 600,
        cursor: busy ? "default" : "pointer",
      }}>Quitar</button>
    </div>
  );
}

function StopRow({ T, stop, isLast, busy, onRemove }) {
  return (
    <div style={{
      padding: "14px 16px", display: "flex", alignItems: "center", gap: 12,
      borderBottom: isLast ? "none" : `1px solid ${T.border}`,
    }}>
      <div style={{
        width: 38, height: 38, borderRadius: 12,
        background: T.dangerSoft, color: T.danger,
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0, fontFamily: FONT.mono, fontSize: 11, fontWeight: 800,
      }}>SL</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: FONT.sans, fontSize: 14, fontWeight: 700, color: T.text }}>
          {stop.ticker}{" "}
          <span style={{ color: T.textMute, fontWeight: 500 }}>· vender si baja a</span>
        </div>
        <div style={{ fontFamily: FONT.mono, fontSize: 12, color: T.textMute }}>
          ${fmtMoney(stop.triggerPrice)}
          {stop.type === "pct" ? ` (${stop.value}% del actual)` : ""}
        </div>
      </div>
      <button onClick={onRemove} disabled={busy} style={{
        padding: "5px 10px", borderRadius: 8,
        background: "transparent", border: `1px solid ${T.border}`,
        color: T.textMute, fontFamily: FONT.sans, fontSize: 11, fontWeight: 600,
        cursor: busy ? "default" : "pointer",
      }}>Quitar</button>
    </div>
  );
}

function OrderRow({ T, order, isLast, busy, onCancel }) {
  const sideColor = order.side === "buy" ? T.accent : T.danger;
  const sideSoft  = order.side === "buy" ? T.accentSoft : T.dangerSoft;
  const sideLabel = order.side === "buy" ? "COMPRA" : "VENTA";
  const statusLabel =
    order.status === "open" ? "Pendiente"
    : order.status === "filled" ? "Ejecutada"
    : "Cancelada";
  const statusColor =
    order.status === "open" ? T.warn
    : order.status === "filled" ? T.accent
    : T.textMute;

  return (
    <div style={{
      padding: "14px 16px", display: "flex", alignItems: "center", gap: 12,
      borderBottom: isLast ? "none" : `1px solid ${T.border}`,
    }}>
      <Pill T={T} color={sideColor} bg={sideSoft}>{sideLabel}</Pill>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: FONT.sans, fontSize: 14, fontWeight: 700, color: T.text,
        }}>
          {order.ticker} <span style={{ color: T.textMute, fontWeight: 500 }}>· {order.qty} u</span>
        </div>
        <div style={{ fontFamily: FONT.sans, fontSize: 12, color: T.textMute }}>
          {order.type === "market" ? "Mercado" : `Límite $${fmtMoney(order.limitPrice || 0)}`}
          {" · "}
          {order.atLabel}
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontFamily: FONT.mono, fontSize: 12, fontWeight: 700, color: statusColor }}>
          {statusLabel}
        </div>
        {order.status === "open" && (
          <button onClick={onCancel} disabled={busy} style={{
            marginTop: 4, padding: "4px 10px", borderRadius: 8,
            background: "transparent", border: `1px solid ${T.border}`,
            color: T.danger, fontFamily: FONT.sans, fontSize: 11, fontWeight: 600,
            cursor: busy ? "default" : "pointer",
          }}>Cancelar</button>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Shared row + AssetSheet + helpers
// ============================================================

// AssetRow — the canonical "one asset, one line" component. Used in
// every list across the broker (Mercado, Portafolio, Watchlist) so
// the same asset shows up identically everywhere.
//
// REDESIGN (samas-0.0.66 → 0.0.67) — Apple Stocks aesthetic per
// Manuel's reference screenshot. Key shape changes:
//   - NO logo column anywhere in the broker. Just bigger / bolder
//     ticker text on the left edge. AssetLogo still exists as an
//     export from shared.jsx (callers outside the broker can opt
//     in) but no broker surface uses it anymore.
//   - Sparkline grew slightly + uses the new area-fill gradient
//     (also in 0.0.66) so it reads as a tiny chart rather than a
//     pencil-thin stroke.
//   - Change is now a SOLID FILLED PILL (white text on accent
//     bg for + / danger bg for -), stacked under the price.
//     Was tinted text before — pill version reads more like a
//     traditional broker UI.
//
// LIVE PRICE TICKING (samas-0.0.57)
//   The price text is still driven by useLivePrice and flashes
//   green/red on tick. Pass `liveMultiplier` for Portfolio rows.
//   `rightTop` prop still exists as a fallback for callers that
//   want to render a literal string (not currently used).
function AssetRow({ T, asset, subline, liveMultiplier = 1, rightTop, rightBottom, rightBottomColor, isLast, onClick }) {
  const live = useLivePrice(asset?.ticker, asset?.price);
  const value = live.price * liveMultiplier;
  const cur = asset?.currency === "ARS" ? "$" : "US$";
  const displayedTop = asset?.ticker
    ? `${cur}${fmtMoney(value, asset.currency)}`
    : rightTop;

  // Pill background tracks the change-direction. We derive from
  // rightBottomColor (passed in by parents — accent for positive,
  // danger for negative) so the parent's existing color logic
  // still drives the visual.
  const isNegative = (rightBottom || "").trim().startsWith("-");
  const pillBg = isNegative ? T.danger : T.accent;

  return (
    <button onClick={onClick} style={{
      width: "100%", padding: "14px 0",
      background: "transparent", border: "none",
      borderBottom: isLast ? "none" : `1px solid ${T.border}`,
      display: "flex", alignItems: "center", gap: 12,
      cursor: "pointer", textAlign: "left",
    }}>
      {/* Identity column — ticker (bold display font) + subline.
          Replaces the old logo + ticker + subline triple. */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: FONT.display, fontSize: 17, fontWeight: 800, color: T.text,
          letterSpacing: -0.3, lineHeight: 1.15,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          marginBottom: 2,
        }}>{asset.ticker}</div>
        <div style={{
          fontFamily: FONT.sans, fontSize: 13, color: T.textMute,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{subline}</div>
      </div>
      {/* Bigger sparkline now that there's no logo competing for
          horizontal space. 64×28 fits the row nicely and the
          area-fill gradient reads at this size (was barely visible
          at 50×20). */}
      <AssetSparkline asset={asset} color={rightBottomColor} w={64} h={28} sw={1.5} />
      {/* Right column: price on top (live-tick flashes), solid
          colored pill underneath with the change. Fixed 96px so
          sparklines line up vertically across rows. */}
      <div style={{
        textAlign: "right", marginLeft: 6, width: 96,
        fontVariantNumeric: "tabular-nums",
        flexShrink: 0,
        display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4,
      }}>
        <div
          key={live.tickCount}
          style={{
            fontFamily: FONT.display, fontSize: 15, fontWeight: 700, color: T.text,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            display: "inline-block",
            borderRadius: 4,
            padding: "0 4px",
            margin: "0 -4px",
            ...(live.sign !== "flat"
              ? { animation: `samas-tick-${live.sign} 600ms ease-out` }
              : {}),
          }}
        >{displayedTop}</div>
        <div style={{
          fontFamily: FONT.mono, fontSize: 12, fontWeight: 700,
          color: "#ffffff",
          background: pillBg,
          padding: "3px 9px",
          borderRadius: 6,
          letterSpacing: 0.2,
        }}>{rightBottom}</div>
      </div>
    </button>
  );
}

// AssetSheetHeroPrice — the big number at the top of AssetSheet,
// live-ticked via useLivePrice and flashed green/red on each tick.
// Lifted into its own component so AssetSheet itself stays stable
// (its multi-step flow renders different sub-trees, and adding a
// hook to the parent body would risk hook-count mismatches between
// renders).
function AssetSheetHeroPrice({ T, asset, ccySym }) {
  const live = useLivePrice(asset?.ticker, asset?.price);
  return (
    <span
      key={live.tickCount}
      style={{
        fontFamily: FONT.display, fontSize: 28, fontWeight: 700, color: T.text,
        fontVariantNumeric: "tabular-nums",
        display: "inline-block",
        borderRadius: 6,
        padding: "0 6px",
        margin: "0 -6px",
        ...(live.sign !== "flat"
          ? { animation: `samas-tick-${live.sign} 600ms ease-out` }
          : {}),
      }}
    >{ccySym}{fmtMoney(live.price, asset.currency)}</span>
  );
}

function AssetSheet({ T, asset, holding = null, onClose: rawOnClose, onDone: rawOnDone, watchlists = [], onWatchlistsChange, proMode = false, lang = "es" }) {
  // Wrap close + done callbacks so we play a slide-down exit animation
  // before the parent unmounts the sheet. The CSS transition lives on
  // the inner sheet div (transform translateY).
  const [closing, setClosing] = useState(false);
  const onClose = () => {
    setClosing(true);
    setTimeout(() => { if (rawOnClose) rawOnClose(); }, 220);
  };
  const onDone = () => {
    setClosing(true);
    setTimeout(() => { if (rawOnDone) rawOnDone(); }, 220);
  };
  // Asset sheet has 3 modes via a top tab: Trade / Alerta / Stop loss.
  // Each renders its own form below the price header.
  const [mode, setMode] = useState("trade");
  const [side, setSide] = useState("buy");
  const [qtyStr, setQtyStr] = useState("");
  const [type, setType] = useState("market");
  const [limitStr, setLimitStr] = useState(String(asset.price));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(null);
  // Confirm step — when set, we render the breakdown sheet instead of
  // the form. Holds the snapshot of fees so the user sees exactly what
  // they're agreeing to.
  const [confirm, setConfirm] = useState(null);

  // Existing alert / stop for this asset, loaded once on open.
  const [alert, setAlert] = useState(null);
  const [stop, setStop] = useState(null);
  // Wallet balance in the asset's currency. Drives the "Disponible"
  // line + the inline insufficient-funds warning so the user can see
  // before tapping Review whether they can actually afford the order.
  const [cashAvailable, setCashAvailable] = useState(null);
  useEffect(() => {
    let alive = true;
    Promise.all([
      brokerApi.getAlertFor(asset.ticker),
      brokerApi.getStopFor(asset.ticker),
      walletApi.getBalance(),
    ]).then(([a, s, b]) => {
      if (!alive) return;
      setAlert(a); setStop(s);
      const v = asset.currency === "ARS" ? b?.ars : b?.usd;
      setCashAvailable(typeof v === "number" ? v : null);
    });
    return () => { alive = false; };
  }, [asset.ticker, asset.currency]);

  // Whether the user owns this asset (only then can they set a stop or sell).
  const ownsIt = !!holding && holding.qty > 0;

  // Watchlist picker — shown over the sheet when the user taps the
  // star. Lists every saved watchlist with a checkmark when this
  // asset is already in it.
  const [showListPicker, setShowListPicker] = useState(false);
  const inAnyList = watchlists.some((wl) => wl.tickers.includes(asset.ticker));

  const qty = parseFloat(qtyStr.replace(",", ".")) || 0;
  const limit = parseFloat(limitStr.replace(",", ".")) || 0;
  const price = type === "limit" ? limit : asset.price;
  const totalEst = qty * price;
  const ccySym = asset.currency === "ARS" ? "$" : "US$";

  // First click on Comprar/Vender opens the confirmation step. We
  // freeze the price + fee breakdown into `confirm` so what the user
  // sees on the review screen is exactly what gets sent.
  function openConfirm() {
    setErr(null);
    if (!qty || qty <= 0) { setErr("Cantidad inválida."); return; }
    if (side === "sell" && (!holding || holding.qty < qty)) {
      setErr("Cantidad insuficiente para vender."); return;
    }
    const fees = brokerApi.quoteOrderFees({ side, subtotal: qty * price });
    setConfirm({
      side, qty, type,
      price, limitPrice: type === "limit" ? limit : null,
      fees,
    });
  }

  // Second click — actually places the order using the snapshot from
  // openConfirm() (so a price tick mid-review doesn't surprise the user).
  async function confirmAndPlace() {
    if (!confirm) return;
    setBusy(true); setErr(null);
    try {
      const r = await brokerApi.placeOrder({
        ticker: asset.ticker,
        side: confirm.side,
        qty: confirm.qty,
        type: confirm.type,
        limitPrice: confirm.limitPrice || undefined,
      });
      // Fire the success haptic SYNCHRONOUSLY right when the order
      // resolves, before setDone schedules a re-render. iOS WebView
      // haptics can be flaky when triggered from a useEffect that
      // mounts several awaits and animation frames after the user's
      // tap — the gesture context is lost and the native call still
      // works in theory, but in practice some configurations swallow
      // it. Calling here gives the most reliable "feedback at the
      // right moment" — DoneScreen's mount comes immediately after.
      hapticNative(r.status === "filled" ? "success" : "tap").catch(() => {});
      setDone(r);
      setConfirm(null);
    } catch (e) {
      setErr(e.message); setBusy(false);
      hapticNative("error").catch(() => {});
    }
  }

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: closing ? "rgba(0,0,0,0)" : "rgba(0,0,0,0.6)",
      transition: "background 220ms ease",
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    }}>
      <div style={{
        width: "100%", maxWidth: 540,
        // dvh shrinks with the iOS keyboard; capping at 92dvh keeps a
        // small backdrop strip visible (so the user knows they can tap
        // outside to close) and lets the content scroll internally
        // when the keyboard pushes up.
        maxHeight: "92dvh",
        background: T.bgElev, color: T.text,
        borderTopLeftRadius: 28, borderTopRightRadius: 28,
        border: `1px solid ${T.border}`, borderBottom: "none",
        overflowY: "auto",
        overscrollBehavior: "contain",
        WebkitOverflowScrolling: "touch",
        // Slide-up entry on mount, slide-down exit when the user
        // dismisses (closing flag). Combined with the backdrop fade
        // it feels native iOS sheet.
        animation: closing ? "none" : "samas-sheet-up 220ms cubic-bezier(.2,.8,.2,1)",
        transform: closing ? "translateY(100%)" : "translateY(0)",
        transition: closing ? "transform 220ms cubic-bezier(.4,0,.6,1)" : undefined,
      }}>
        <style>{`
          @keyframes samas-sheet-up {
            from { transform: translateY(100%); }
            to   { transform: translateY(0); }
          }
        `}</style>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "20px 20px 8px",
        }}>
          {/* Header identity — ticker + name only. Logo dropped in
              0.0.66 to match the Apple-Stocks-style detail page where
              the brand mark isn't needed (the name spells it out). */}
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontFamily: FONT.display, fontSize: 22, fontWeight: 800, color: T.text,
              letterSpacing: -0.4,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {asset.ticker}
            </div>
            <div style={{
              fontFamily: FONT.sans, fontSize: 13, color: T.textMute,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {asset.name || asset.ticker}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {/* Star toggle — opens the watchlist picker. Filled
                accent when this asset is in any list, hollow muted
                otherwise. */}
            {watchlists.length > 0 && (
              <button onClick={() => setShowListPicker(true)} style={{
                background: inAnyList ? T.accentSoft : T.surface,
                border: `1px solid ${inAnyList ? T.accent : T.border}`,
                width: 32, height: 32, borderRadius: 10,
                color: inAnyList ? T.accent : T.textMute,
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer",
              }}>
                <Ico.Star size={16} {...(inAnyList ? { fill: "currentColor" } : {})}/>
              </button>
            )}
            <button onClick={onClose} style={{
              background: T.surface, border: `1px solid ${T.border}`,
              width: 32, height: 32, borderRadius: 10, color: T.textMute,
              display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>

        <div style={{
          padding: "8px 20px",
          paddingBottom: "calc(env(safe-area-inset-bottom) + 24px)",
        }}>
          {/* Live-ticking hero price + sticky % Pill. The price gets
              the same tick-up / tick-down flash treatment as the
              AssetRow right column. The % Pill represents the day's
              cumulative change and stays sticky — only the live
              price wiggles. AssetSheetHeroPrice wraps the live hook
              so the AssetSheet body's hook count stays stable
              regardless of which sub-flow is rendered. */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 16 }}>
            <AssetSheetHeroPrice T={T} asset={asset} ccySym={ccySym} />
            <Pill T={T}
              color={asset.changePct >= 0 ? T.accent : T.danger}
              bg={asset.changePct >= 0 ? T.accentSoft : T.dangerSoft}>
              {fmtPct(asset.changePct)}
            </Pill>
          </div>

          {/* Pro AssetDetail (samas-0.0.43) — chart + 52w range +
              fundamentals. Only shown when not in confirm/done sub-
              steps so the buy-flow doesn't get cluttered. Pro-mode
              gated; non-pro users see the existing compact header
              and go straight to the trade form. */}
          {proMode && !done && !confirm && (
            <>
              <ProAssetChart T={T} asset={asset} lang={lang} />
              <RangeBar52w T={T} asset={asset} lang={lang} />
              <FundamentalsCard T={T} asset={asset} lang={lang} />
            </>
          )}

          {/* AI insight (samas-0.0.85) — Análisis IA card. Visible to
              every user (not Pro-gated) since AI is the differentiator.
              Hidden during confirm/done sub-steps to keep the trade
              flow focused. */}
          {!done && !confirm && (
            <AssetAIInsight T={T} ticker={asset.ticker} lang={lang} />
          )}

          {done ? (
            <DoneScreen
              T={T}
              done={done}
              side={side}
              qty={qty}
              asset={asset}
              holding={holding}
              onClose={onDone}
            />
          ) : confirm ? (
            <ConfirmOrderStep
              T={T}
              asset={asset}
              confirm={confirm}
              busy={busy}
              err={err}
              onCancel={() => { setConfirm(null); setErr(null); }}
              onConfirm={confirmAndPlace}
              lang={lang}
            />
          ) : (
            <>
              {/* Mode tabs: Trade / Alerta / Stop loss */}
              <div style={{
                display: "flex", gap: 4, padding: 4, marginBottom: 16,
                background: T.surface, border: `1px solid ${T.border}`,
                borderRadius: 12,
              }}>
                {[
                  { id: "trade",  label: "Operar" },
                  { id: "alert",  label: alert ? "Alerta ✓" : "Alerta" },
                  { id: "stop",   label: stop  ? "Stop ✓"  : "Stop"   },
                ].map((m) => {
                  const active = m.id === mode;
                  return (
                    <button key={m.id} onClick={() => { setMode(m.id); setErr(null); }} style={{
                      flex: 1, padding: "8px 0", borderRadius: 8,
                      background: active ? T.bg : "transparent",
                      border: active ? `1px solid ${T.border}` : "1px solid transparent",
                      color: active ? T.text : T.textMute,
                      fontFamily: FONT.sans, fontSize: 12, fontWeight: 600, cursor: "pointer",
                    }}>{m.label}</button>
                  );
                })}
              </div>

              {mode === "alert" && (
                <AlertForm T={T} asset={asset} existing={alert}
                  onSaved={(a) => { setAlert(a); setMode("trade"); }}
                  onRemoved={() => setAlert(null)} />
              )}

              {mode === "stop" && (
                <StopForm T={T} asset={asset} existing={stop} ownsIt={ownsIt}
                  onSaved={(s) => { setStop(s); setMode("trade"); }}
                  onRemoved={() => setStop(null)} />
              )}

              {mode === "trade" && (
                <>
              {/* Tenencia row — shows what the user already owns of
                  this asset. Always rendered when in Operar mode so
                  buying/selling feels grounded. */}
              <div style={{
                marginBottom: 14, padding: "12px 14px", borderRadius: 12,
                background: ownsIt ? T.accentSoft : T.surface,
                border: `1px solid ${ownsIt ? T.accent : T.border}`,
                display: "flex", justifyContent: "space-between", alignItems: "center",
                gap: 8,
              }}>
                <div>
                  <div style={{ fontFamily: FONT.sans, fontSize: 11, color: T.textMute, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase" }}>
                    Tenencia actual
                  </div>
                  <div style={{ fontFamily: FONT.mono, fontSize: 15, fontWeight: 700, color: ownsIt ? T.accent : T.text, marginTop: 2 }}>
                    {ownsIt ? `${fmtMoney(holding.qty, asset.currency)} ${asset.ticker}` : `0 ${asset.ticker}`}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: FONT.sans, fontSize: 11, color: T.textMute, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase" }}>
                    Valuación
                  </div>
                  <div style={{ fontFamily: FONT.mono, fontSize: 15, fontWeight: 700, color: T.text, marginTop: 2 }}>
                    {ownsIt ? `${ccySym}${fmtMoney(holding.value, asset.currency)}` : "—"}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                {[
                  { id: "buy",  label: tr("asset.buy",  lang), color: T.accent,  soft: T.accentSoft },
                  { id: "sell", label: tr("asset.sell", lang), color: T.danger,  soft: T.dangerSoft },
                ].map((s) => {
                  const active = s.id === side;
                  return (
                    <button key={s.id} onClick={() => setSide(s.id)} style={{
                      flex: 1, padding: 14, borderRadius: 12,
                      background: active ? s.soft : T.surface,
                      border: `1px solid ${active ? s.color : T.border}`,
                      color: active ? s.color : T.text,
                      fontFamily: FONT.sans, fontSize: 14, fontWeight: 700, cursor: "pointer",
                    }}>{s.label}</button>
                  );
                })}
              </div>

              <div style={{
                display: "flex", gap: 4, padding: 4,
                background: T.surface, border: `1px solid ${T.border}`,
                borderRadius: 12, marginBottom: 14,
              }}>
                {[
                  { id: "market", label: tr("asset.market", lang) },
                  { id: "limit",  label: tr("asset.limit",  lang) },
                ].map((t) => {
                  const active = t.id === type;
                  return (
                    <button key={t.id} onClick={() => setType(t.id)} style={{
                      flex: 1, padding: "8px 0", borderRadius: 8,
                      background: active ? T.bg : "transparent",
                      border: active ? `1px solid ${T.border}` : "1px solid transparent",
                      color: active ? T.text : T.textMute,
                      fontFamily: FONT.sans, fontSize: 12, fontWeight: 600, cursor: "pointer",
                    }}>{t.label}</button>
                  );
                })}
              </div>

              <NumberInput T={T} label={tr("asset.qty", lang)} value={qtyStr} onChange={setQtyStr} placeholder="0" />

              {/* AI Position Sizing helper (samas-0.2.3) — auto-loads
                  on mount with the ticker + side; renders 3 chips
                  (conservador / estándar / agresivo for buy, or
                  un tercio / la mitad / todo for sell). Tap a chip
                  to autofill qtyStr. Hides silently on AI failure /
                  consent denial / sub-minimum balance. */}
              <PositionSizingCard
                T={T}
                lang={lang}
                ticker={asset.ticker}
                side={side}
                onPick={(qty) => {
                  setQtyStr(String(qty));
                  hapticNative("tap").catch(() => {});
                }}
              />

              {type === "limit" && (
                <div style={{ marginTop: 12 }}>
                  <NumberInput T={T} label={`${tr("asset.price", lang)} ${tr("asset.limit", lang).toLowerCase()} (${asset.currency})`} value={limitStr} onChange={setLimitStr} placeholder={String(asset.price)} />
                </div>
              )}

              <div style={{
                marginTop: 14, padding: "12px 14px", borderRadius: 12,
                background: T.surface, border: `1px solid ${T.border}`,
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <span style={{ fontFamily: FONT.sans, fontSize: 12, color: T.textMute }}>{tr("asset.total", lang)}</span>
                <span style={{ fontFamily: FONT.mono, fontSize: 14, fontWeight: 700, color: T.text }}>
                  {qty > 0 ? `${ccySym}${fmtMoney(totalEst, asset.currency)}` : "—"}
                </span>
              </div>

              {/* Available-balance / holding hint + inline insufficient
                  warning. Shown below the total so the user always knows
                  whether they can afford the trade BEFORE tapping Review.
                  - Buy: their cash balance in the asset's currency.
                  - Sell: how many units they currently hold.
                  When qty > available, we tint the row red and disable
                  the Review button so they can't tap into a guaranteed
                  rejection. */}
              {(() => {
                if (side === "buy") {
                  if (cashAvailable == null) return null;
                  const over = qty > 0 && totalEst > cashAvailable;
                  return (
                    <div style={{
                      marginTop: 8, padding: "10px 14px", borderRadius: 12,
                      background: over ? T.dangerSoft : T.surface,
                      border: `1px solid ${over ? T.danger + "55" : T.border}`,
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                    }}>
                      <span style={{
                        fontFamily: FONT.sans, fontSize: 11, fontWeight: 600,
                        color: over ? T.danger : T.textMute,
                      }}>
                        {over
                          ? `Te faltan ${ccySym}${fmtMoney(totalEst - cashAvailable, asset.currency)}`
                          : "Disponible"}
                      </span>
                      <span style={{
                        fontFamily: FONT.mono, fontSize: 12, fontWeight: 700,
                        color: over ? T.danger : T.text,
                      }}>
                        {ccySym}{fmtMoney(cashAvailable, asset.currency)}
                      </span>
                    </div>
                  );
                }
                // sell
                const haveQty = holding?.qty || 0;
                const over = qty > 0 && qty > haveQty;
                return (
                  <div style={{
                    marginTop: 8, padding: "10px 14px", borderRadius: 12,
                    background: over ? T.dangerSoft : T.surface,
                    border: `1px solid ${over ? T.danger + "55" : T.border}`,
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                  }}>
                    <span style={{
                      fontFamily: FONT.sans, fontSize: 11, fontWeight: 600,
                      color: over ? T.danger : T.textMute,
                    }}>
                      {over ? `Te faltan ${qty - haveQty} u` : "Tenencia"}
                    </span>
                    <span style={{
                      fontFamily: FONT.mono, fontSize: 12, fontWeight: 700,
                      color: over ? T.danger : T.text,
                    }}>
                      {haveQty} {asset.ticker}
                    </span>
                  </div>
                );
              })()}

              {err && <div style={{ marginTop: 12, color: T.danger, fontFamily: FONT.sans, fontSize: 12 }}>{err}</div>}

              {/* Review button disabled not just on zero qty but also
                  when the user is over their available cash / holding —
                  no point letting them tap through to a rejection. */}
              {(() => {
                const overBuy  = side === "buy"  && cashAvailable != null && qty > 0 && totalEst > cashAvailable;
                const overSell = side === "sell" && qty > 0 && qty > (holding?.qty || 0);
                const blocked = qty <= 0 || overBuy || overSell;
                return (
                  <button onClick={openConfirm} disabled={blocked} style={{
                    width: "100%", marginTop: 18, padding: 16, borderRadius: 14,
                    background: side === "buy" ? T.accent : T.danger,
                    color: side === "buy" ? T.accentInk : "#FFFFFF",
                    fontFamily: FONT.sans, fontSize: 15, fontWeight: 700, border: "none",
                    cursor: blocked ? "default" : "pointer",
                    opacity: blocked ? 0.5 : 1,
                  }}>
                    {tr("asset.review", lang)}
                  </button>
                );
              })()}
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Watchlist picker overlay — opens on top of the AssetSheet
          when the user taps the star icon in the header. */}
      {showListPicker && (
        <WatchlistPicker
          T={T}
          ticker={asset.ticker}
          watchlists={watchlists}
          lang={lang}
          onClose={() => setShowListPicker(false)}
          onChange={onWatchlistsChange}
        />
      )}
    </div>
  );
}

// ----------------------------------------------------------
// WatchlistPicker — modal that lets the user toggle this asset's
// membership across all of their watchlists with checkmarks.
// ----------------------------------------------------------
// ----------------------------------------------------------
// AddAssetModal — picker that lists every asset in the universe so the
// user can add one to a specific watchlist directly from the Watchlist
// tab (alternative to going to Mercado, opening AssetSheet, and using
// the star icon). Includes search to find tickers fast.
// ----------------------------------------------------------
function AddAssetModal({ T, assets, excludeTickers = [], listName, onClose, onPick, lang = "es" }) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets.filter((a) => {
      if (excludeTickers.includes(a.ticker)) return false;
      if (!q) return true;
      return a.ticker.toLowerCase().includes(q) || (a.name || "").toLowerCase().includes(q);
    });
  }, [assets, excludeTickers, query]);

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{
      position: "fixed", inset: 0, zIndex: 110,
      background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    }}>
      <div style={{
        width: "100%", maxWidth: 540, maxHeight: "85dvh",
        background: T.bgElev, color: T.text,
        borderTopLeftRadius: 28, borderTopRightRadius: 28,
        border: `1px solid ${T.border}`, borderBottom: "none",
        overflow: "hidden", display: "flex", flexDirection: "column",
      }}>
        <div style={{ padding: "20px 20px 12px" }}>
          <div style={{ fontFamily: FONT.display, fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 4 }}>
            Agregar a {listName || "lista"}
          </div>
          <div style={{ fontFamily: FONT.sans, fontSize: 12, color: T.textMute, marginBottom: 12 }}>
            Tocá un activo para agregarlo a esta lista.
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 14px", borderRadius: 12,
            background: T.surface, border: `1px solid ${T.border}`,
          }}>
            <Ico.Search size={16} stroke={T.textMute} />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tr("market.search_ph", lang)}
              style={{
                flex: 1, background: "transparent", border: "none", outline: "none",
                color: T.text, fontFamily: FONT.sans, fontSize: 14,
              }}
            />
          </div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "0 12px 12px" }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 30, textAlign: "center", color: T.textMute, fontFamily: FONT.sans, fontSize: 13 }}>
              No hay más activos para agregar.
            </div>
          ) : (
            filtered.map((a, i) => (
              <button
                key={a.ticker}
                disabled={busy}
                onClick={async () => { setBusy(true); try { await onPick(a.ticker); } catch (e) { toast.error(e.message); setBusy(false); } }}
                style={{
                  width: "100%", padding: "10px 8px", background: "transparent",
                  border: "none", borderBottom: `1px solid ${T.border}`,
                  display: "flex", alignItems: "center", gap: 12,
                  cursor: busy ? "default" : "pointer", textAlign: "left",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: FONT.display, fontSize: 16, fontWeight: 800, color: T.text,
                    letterSpacing: -0.3, lineHeight: 1.15, marginBottom: 2,
                  }}>{a.ticker}</div>
                  <div style={{
                    fontFamily: FONT.sans, fontSize: 12, color: T.textMute,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{a.name}</div>
                </div>
                <div style={{
                  fontFamily: FONT.mono, fontSize: 13, fontWeight: 700, color: T.text,
                  fontVariantNumeric: "tabular-nums",
                }}>
                  {a.currency === "ARS" ? "$" : "US$"}{fmtMoney(a.price, a.currency)}
                </div>
              </button>
            ))
          )}
        </div>
        <button onClick={onClose} style={{
          padding: 14, background: T.surface, border: "none",
          color: T.text, fontFamily: FONT.sans, fontSize: 14, fontWeight: 600,
          cursor: "pointer",
        }}>Cancelar</button>
      </div>
    </div>
  );
}

function WatchlistPicker({ T, ticker, watchlists, lang = "es", onClose, onChange }) {
  const [busyId, setBusyId] = useState(null);

  async function toggle(wl) {
    const isIn = wl.tickers.includes(ticker);
    setBusyId(wl.id);
    try {
      if (isIn) {
        await brokerApi.removeFromWatchlist(wl.id, ticker);
      } else {
        await brokerApi.addToWatchlist(wl.id, ticker);
      }
      if (onChange) await onChange();
    } catch (e) { toast.error(e.message); }
    setBusyId(null);
  }

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{
      position: "fixed", inset: 0, zIndex: 110,
      background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 16,
    }}>
      <div style={{
        width: "100%", maxWidth: 420,
        background: T.bgElev, color: T.text,
        borderRadius: 22, border: `1px solid ${T.border}`,
        overflow: "hidden",
      }}>
        <div style={{ padding: "20px 20px 12px" }}>
          <div style={{ fontFamily: FONT.display, fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 4 }}>
            Agregar {ticker} a una lista
          </div>
          <div style={{ fontFamily: FONT.sans, fontSize: 12, color: T.textMute }}>
            Tocá una lista para agregarlo o quitarlo.
          </div>
        </div>
        <div style={{ borderTop: `1px solid ${T.border}` }}>
          {watchlists.map((wl) => {
            const isIn = wl.tickers.includes(ticker);
            const busy = busyId === wl.id;
            return (
              <button
                key={wl.id}
                onClick={() => toggle(wl)}
                disabled={busy}
                style={{
                  width: "100%", padding: "14px 20px",
                  background: "transparent", border: "none",
                  borderBottom: `1px solid ${T.border}`,
                  display: "flex", alignItems: "center", gap: 12,
                  cursor: busy ? "default" : "pointer",
                  textAlign: "left", color: T.text,
                }}
              >
                <div style={{
                  width: 24, height: 24, borderRadius: 8,
                  border: `1.5px solid ${isIn ? T.accent : T.border}`,
                  background: isIn ? T.accent : "transparent",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                }}>
                  {isIn && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                      stroke={T.accentInk} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6L9 17l-5-5"/>
                    </svg>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: FONT.sans, fontSize: 14, fontWeight: 600, color: T.text }}>
                    {wl.name}
                  </div>
                  <div style={{ fontFamily: FONT.sans, fontSize: 12, color: T.textMute }}>
                    {wl.tickers.length} {wl.tickers.length === 1 ? "activo" : "activos"}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        <button onClick={onClose} style={{
          width: "100%", padding: 14,
          background: T.surface, border: "none",
          color: T.text, fontFamily: FONT.sans, fontSize: 14, fontWeight: 600,
          cursor: "pointer",
        }}>{tr("settings.done", lang)}</button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------
// AlertForm — set / edit / remove a price alert.
// ----------------------------------------------------------
// Two input modes (toggle): "Precio" sets an absolute target,
// "Porcentaje" sets a signed % from current (+5 = +5% → above,
// -3 = -3% → below). The form computes targetPrice + direction
// before calling the API; the API itself stays simple (one shape:
// { ticker, targetPrice, direction }).
//
// When the user opens the sheet on an asset that already has an
// alert, we re-derive the form mode by checking whether the saved
// targetPrice corresponds to a "round" percentage from the current
// price — if not, we fall back to "Precio" mode and show the
// stored absolute price.
function AlertForm({ T, asset, existing, onSaved, onRemoved }) {
  const [type, setType] = useState("price"); // "price" | "pct"
  const [direction, setDirection] = useState(existing?.direction || "above");
  const [priceStr, setPriceStr] = useState(
    existing ? String(existing.targetPrice) : String(asset.price)
  );
  // Pct flow: store ABSOLUTE value in pctStr, sign comes from the
  // pctSign pill ("+" or "-"). Numeric keyboard stays sane this way —
  // typing "-" used to force iOS into the QWERTY layout.
  const [pctStr, setPctStr] = useState("5");
  const [pctSign, setPctSign] = useState("+");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  // Effective signed % derived from pctSign + pctStr.
  const pctNum = (pctSign === "-" ? -1 : 1) * (parseFloat(pctStr.replace(",", ".")) || 0);
  const computedTarget = type === "pct"
    ? asset.price * (1 + pctNum / 100)
    : parseFloat(priceStr.replace(",", ".")) || 0;
  const computedDirection = type === "pct"
    ? (pctNum >= 0 ? "above" : "below")
    : direction;

  async function save() {
    setErr(null);
    if (!computedTarget || computedTarget <= 0) {
      setErr("Valor inválido.");
      return;
    }
    if (type === "pct" && pctNum === 0) {
      setErr("El porcentaje no puede ser cero.");
      return;
    }
    setBusy(true);
    try {
      const a = await brokerApi.setPriceAlert({
        ticker: asset.ticker,
        targetPrice: computedTarget,
        direction: computedDirection,
      });
      onSaved(a);
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  async function remove() {
    setBusy(true);
    try { await brokerApi.removePriceAlert(asset.ticker); onRemoved(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <>
      <div style={{ fontFamily: FONT.sans, fontSize: 13, color: T.textMute, marginBottom: 14, lineHeight: 1.5 }}>
        Te avisamos por notificación cuando {asset.ticker} llegue al nivel que elijas.
      </div>

      {/* Type toggle: Precio / Porcentaje */}
      <div style={{
        display: "flex", gap: 4, padding: 4, marginBottom: 14,
        background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12,
      }}>
        {[
          { id: "price", label: "Precio" },
          { id: "pct",   label: "Porcentaje" },
        ].map((t) => {
          const active = t.id === type;
          return (
            <button key={t.id} onClick={() => setType(t.id)} style={{
              flex: 1, padding: "8px 0", borderRadius: 8,
              background: active ? T.bg : "transparent",
              border: active ? `1px solid ${T.border}` : "1px solid transparent",
              color: active ? T.text : T.textMute,
              fontFamily: FONT.sans, fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}>{t.label}</button>
          );
        })}
      </div>

      {/* Direction selector — only for Precio mode. In Porcentaje mode
          direction is derived from the sign of the % so showing this
          would just be redundant. */}
      {type === "price" && (
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          {[
            { id: "above", label: "Cuando supere" },
            { id: "below", label: "Cuando baje" },
          ].map((d) => {
            const active = d.id === direction;
            return (
              <button key={d.id} onClick={() => setDirection(d.id)} style={{
                flex: 1, padding: 12, borderRadius: 12,
                background: active ? T.accentSoft : T.surface,
                border: `1px solid ${active ? T.accent : T.border}`,
                color: active ? T.accent : T.text,
                fontFamily: FONT.sans, fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}>{d.label}</button>
            );
          })}
        </div>
      )}

      {/* Input depends on mode */}
      {type === "price" ? (
        <NumberInput T={T} label={`Precio objetivo (${asset.currency})`}
          value={priceStr} onChange={setPriceStr}
          placeholder={String(asset.price)} />
      ) : (
        <>
          {/* Direction pill for % mode — explicit + (sube) / − (baja).
              Cleaner than typing a minus sign because iOS keeps the
              numeric keyboard up. */}
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            {[
              { id: "+", label: "Sube",  color: T.accent, soft: T.accentSoft },
              { id: "-", label: "Baja",  color: T.danger, soft: T.dangerSoft },
            ].map((d) => {
              const active = d.id === pctSign;
              return (
                <button key={d.id} onClick={() => setPctSign(d.id)} style={{
                  flex: 1, padding: 12, borderRadius: 12,
                  background: active ? d.soft : T.surface,
                  border: `1px solid ${active ? d.color : T.border}`,
                  color: active ? d.color : T.text,
                  fontFamily: FONT.sans, fontSize: 13, fontWeight: 700, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                }}>
                  <span style={{ fontFamily: FONT.mono, fontSize: 16, fontWeight: 800 }}>{d.id}</span>
                  {d.label}
                </button>
              );
            })}
          </div>
          <NumberInput T={T} label="Porcentaje"
            value={pctStr} onChange={setPctStr}
            placeholder="5" prefix={pctSign === "-" ? "−" : "+"} />
        </>
      )}

      {/* Live preview — what we'll actually save */}
      {(type === "pct" && pctNum !== 0) || (type === "price" && computedTarget > 0) ? (
        <div style={{
          marginTop: 12, padding: "10px 14px", borderRadius: 12,
          background: T.surface, border: `1px solid ${T.border}`,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span style={{ fontFamily: FONT.sans, fontSize: 12, color: T.textMute }}>
            {computedDirection === "above" ? "Avisar cuando supere" : "Avisar cuando baje a"}
          </span>
          <span style={{ fontFamily: FONT.mono, fontSize: 14, fontWeight: 700, color: T.text }}>
            {asset.currency === "ARS" ? "$" : "US$"}{fmtMoney(computedTarget, asset.currency)}
          </span>
        </div>
      ) : null}

      {err && <div style={{ marginTop: 12, color: T.danger, fontFamily: FONT.sans, fontSize: 12 }}>{err}</div>}

      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        {existing && (
          <button onClick={remove} disabled={busy} style={{
            flex: 1, padding: 14, borderRadius: 14,
            background: T.surface, border: `1px solid ${T.border}`,
            color: T.danger, fontFamily: FONT.sans, fontSize: 14, fontWeight: 600,
            cursor: busy ? "default" : "pointer",
          }}>Quitar alerta</button>
        )}
        <button onClick={save} disabled={busy} style={{
          flex: 1, padding: 14, borderRadius: 14,
          background: T.accent, color: T.accentInk,
          fontFamily: FONT.sans, fontSize: 14, fontWeight: 700, border: "none",
          cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
        }}>{existing ? "Actualizar" : "Crear alerta"}</button>
      </div>
    </>
  );
}

// ----------------------------------------------------------
// StopForm — set / edit / remove a stop loss. Only available on
// assets the user owns.
// ----------------------------------------------------------
function StopForm({ T, asset, existing, ownsIt, onSaved, onRemoved }) {
  const [type, setType] = useState(existing?.type || "pct");
  // Stop-loss is always BELOW current price, so we store the absolute
  // pct value in the input and prepend "−" in the prefix on display +
  // make it negative when saving. Avoids the QWERTY-keyboard pitfall.
  const [pctStr, setPctStr] = useState(
    existing && existing.type === "pct"
      ? String(Math.abs(existing.value))
      : "10"
  );
  const [priceStr, setPriceStr] = useState(existing && existing.type === "price" ? String(existing.value) : String(asset.price * 0.9));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  if (!ownsIt) {
    return (
      <div style={{ padding: "32px 24px", textAlign: "center" }}>
        <div style={{ fontFamily: FONT.display, fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 8 }}>
          Sin posición en {asset.ticker}
        </div>
        <div style={{ fontFamily: FONT.sans, fontSize: 13, color: T.textMute, lineHeight: 1.5 }}>
          Solo podés poner stop loss en activos que tenés. Comprá primero y volvé acá.
        </div>
      </div>
    );
  }

  async function save() {
    setErr(null);
    let value;
    if (type === "pct") {
      // Stored as positive in the input → make negative when saving
      // because a stop-loss only fires on the way DOWN.
      const abs = parseFloat(pctStr.replace(",", "."));
      if (isNaN(abs) || abs <= 0) { setErr("Ingresá un porcentaje mayor a 0."); return; }
      value = -Math.abs(abs);
    } else {
      value = parseFloat(priceStr.replace(",", "."));
      if (isNaN(value)) { setErr("Valor inválido."); return; }
    }
    setBusy(true);
    try {
      const s = await brokerApi.setStopLoss({ ticker: asset.ticker, type, value });
      onSaved(s);
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  async function remove() {
    setBusy(true);
    try { await brokerApi.removeStopLoss(asset.ticker); onRemoved(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <>
      <div style={{ fontFamily: FONT.sans, fontSize: 13, color: T.textMute, marginBottom: 14, lineHeight: 1.5 }}>
        Vendemos {asset.ticker} automáticamente si el precio cae al nivel que definas. Te protege en caídas fuertes.
      </div>

      {/* Type toggle */}
      <div style={{
        display: "flex", gap: 4, padding: 4, marginBottom: 14,
        background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12,
      }}>
        {[
          { id: "pct",   label: "Porcentaje" },
          { id: "price", label: "Precio" },
        ].map((t) => {
          const active = t.id === type;
          return (
            <button key={t.id} onClick={() => setType(t.id)} style={{
              flex: 1, padding: "8px 0", borderRadius: 8,
              background: active ? T.bg : "transparent",
              border: active ? `1px solid ${T.border}` : "1px solid transparent",
              color: active ? T.text : T.textMute,
              fontFamily: FONT.sans, fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}>{t.label}</button>
          );
        })}
      </div>

      {type === "pct" ? (
        <NumberInput T={T} label="Caída desde precio actual" value={pctStr} onChange={setPctStr} placeholder="10" prefix="−" />
      ) : (
        <NumberInput T={T} label={`Precio gatillo (${asset.currency})`} value={priceStr} onChange={setPriceStr} placeholder={String(asset.price * 0.9)} />
      )}

      {err && <div style={{ marginTop: 12, color: T.danger, fontFamily: FONT.sans, fontSize: 12 }}>{err}</div>}

      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        {existing && (
          <button onClick={remove} disabled={busy} style={{
            flex: 1, padding: 14, borderRadius: 14,
            background: T.surface, border: `1px solid ${T.border}`,
            color: T.danger, fontFamily: FONT.sans, fontSize: 14, fontWeight: 600,
            cursor: busy ? "default" : "pointer",
          }}>Quitar stop</button>
        )}
        <button onClick={save} disabled={busy} style={{
          flex: 1, padding: 14, borderRadius: 14,
          background: T.danger, color: "#FFFFFF",
          fontFamily: FONT.sans, fontSize: 14, fontWeight: 700, border: "none",
          cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
        }}>{existing ? "Actualizar" : "Crear stop"}</button>
      </div>
    </>
  );
}

// ----------------------------------------------------------
// ConfirmOrderStep — review screen shown after the user clicks
// "Revisar compra/venta" but before the order is actually sent. Lists
// every line item (price, comisión, IVA, derechos de mercado) so the
// user knows exactly what they're paying / receiving.
// ----------------------------------------------------------
function ConfirmOrderStep({ T, asset, confirm, busy, err, onCancel, onConfirm, lang = "es" }) {
  const ccySym = asset.currency === "ARS" ? "$" : "US$";
  const fee = confirm.fees;
  const isBuy = confirm.side === "buy";

  const Row = ({ label, value, strong, color }) => (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "baseline",
      padding: "8px 0", gap: 8,
    }}>
      <span style={{ fontFamily: FONT.sans, fontSize: 13, color: T.textMute }}>{label}</span>
      <span style={{
        fontFamily: FONT.mono, fontSize: strong ? 15 : 13,
        fontWeight: strong ? 700 : 600,
        color: color || T.text,
      }}>{value}</span>
    </div>
  );

  return (
    <div>
      <div style={{
        marginBottom: 14, padding: "10px 14px", borderRadius: 10,
        background: isBuy ? T.accentSoft : T.dangerSoft,
        color: isBuy ? T.accent : T.danger,
        fontFamily: FONT.sans, fontSize: 12, fontWeight: 700,
        letterSpacing: 0.5, textTransform: "uppercase",
        textAlign: "center",
      }}>
        Revisar {isBuy ? "compra" : "venta"} de {asset.ticker}
      </div>

      <div style={{
        padding: "12px 16px", borderRadius: 14,
        background: T.surface, border: `1px solid ${T.border}`,
        marginBottom: 14,
      }}>
        <Row label={tr("asset.qty", lang)} value={`${fmtMoney(confirm.qty, asset.currency)} ${asset.ticker}`} />
        <Row label={tr("asset.market", lang) + " / " + tr("asset.limit", lang)} value={confirm.type === "limit" ? tr("asset.limit", lang) : tr("asset.market", lang)} />
        <Row label="Precio" value={`${ccySym}${fmtMoney(confirm.price, asset.currency)}`} />
        <div style={{ height: 1, background: T.border, margin: "6px 0" }} />
        <Row label={tr("asset.subtotal", lang)} value={`${ccySym}${fmtMoney(fee.subtotal, asset.currency)}`} />
        <Row label="Comisión (0,5%)" value={`${ccySym}${fmtMoney(fee.commission, asset.currency)}`} />
        <Row label="IVA s/comisión (21%)" value={`${ccySym}${fmtMoney(fee.iva, asset.currency)}`} />
        <Row label="Derechos de mercado" value={`${ccySym}${fmtMoney(fee.marketDuty, asset.currency)}`} />
        <div style={{ height: 1, background: T.border, margin: "6px 0" }} />
        <Row
          label={isBuy ? "Total a pagar" : "Total a recibir"}
          value={`${ccySym}${fmtMoney(fee.total, asset.currency)}`}
          strong
          color={isBuy ? T.danger : T.accent}
        />
      </div>

      <div style={{
        fontFamily: FONT.sans, fontSize: 11, color: T.textMute,
        lineHeight: 1.5, marginBottom: 14,
      }}>
        Los valores son estimados. El precio final puede variar levemente al ejecutarse en el mercado.
      </div>

      {/* AI Trade Coach (samas-0.0.95) — runs once on mount with the
          ticker/side/qty/price; returns a verdict + reason that
          contextualizes this order against the user's existing book. */}
      <TradeCoachCard
        T={T}
        lang={lang}
        ticker={asset.ticker}
        side={confirm.side}
        qty={confirm.qty}
        price={confirm.price}
      />

      {err && <div style={{ marginBottom: 12, color: T.danger, fontFamily: FONT.sans, fontSize: 12 }}>{err}</div>}

      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={onCancel} disabled={busy} style={{
          flex: 1, padding: 16, borderRadius: 14,
          background: T.surface, border: `1px solid ${T.border}`,
          color: T.text, fontFamily: FONT.sans, fontSize: 14, fontWeight: 600,
          cursor: busy ? "default" : "pointer",
        }}>Modificar</button>
        <button onClick={onConfirm} disabled={busy} style={{
          flex: 1.4, padding: 16, borderRadius: 14,
          background: isBuy ? T.accent : T.danger,
          color: isBuy ? T.accentInk : "#FFFFFF",
          fontFamily: FONT.sans, fontSize: 14, fontWeight: 700, border: "none",
          cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
        }}>{busy ? "Enviando..." : `Confirmar ${isBuy ? "compra" : "venta"}`}</button>
      </div>
    </div>
  );
}

// ============================================================
// PositionSizingCard (samas-0.2.3) — AI sizing chips next to qty
// ============================================================
// Auto-loads on mount with the ticker + side; calls position-size
// Edge Function which returns 3 deterministic suggestions. Renders
// each as a tap-to-fill chip with qty, % of book, and a one-line
// rationale. Hides silently on AI failure / consent denial / when
// the server returns 0 viable sizes (insufficient balance, etc).
function PositionSizingCard({ T, lang = "es", ticker, side, onPick }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [picked, setPicked] = useState(null); // bucket id | null

  // Re-fetch whenever the user flips between buy/sell so the chips
  // match. ticker is constant per AssetSheet mount but cheap to
  // include in the deps for safety.
  useEffect(() => {
    let alive = true;
    setBusy(true);
    setData(null);
    setHidden(false);
    setPicked(null);
    (async () => {
      try {
        const res = await positionSize({ ticker, side });
        if (!alive) return;
        if (!res?.suggestions || res.suggestions.length === 0) {
          setHidden(true);
        } else {
          setData(res);
        }
      } catch (e) {
        if (!alive) return;
        if (e?.name === "AIConsentDeniedError" || e?.name === "AIQuotaExceededError") setHidden(true);
        else setHidden(true);
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => { alive = false; };
  }, [ticker, side]);

  if (hidden) return null;

  const isBuy = side === "buy";
  // Color per bucket — conservador = subtle, estandar = accent,
  // agresivo = warm. Sell variants get a single danger tint.
  const tintForBucket = (id) => {
    if (!isBuy) return T.danger;
    if (id === "conservador") return T.textMute;
    if (id === "estandar")    return T.accent;
    return "#F59E0B"; // amber for agresivo
  };

  return (
    <div style={{
      marginTop: 12, padding: 12, borderRadius: 14,
      background: T.surface, border: `1px solid ${T.border}`,
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
      }}>
        <div style={{
          width: 22, height: 22, borderRadius: 6, flexShrink: 0,
          background: T.accent, color: T.accentInk,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>
          </svg>
        </div>
        <div style={{
          flex: 1, fontFamily: FONT.mono, fontSize: 10, fontWeight: 700,
          color: T.textMute, letterSpacing: 0.6, textTransform: "uppercase",
        }}>
          {tr(isBuy ? "asset.sizing.title_buy" : "asset.sizing.title_sell", lang)}
        </div>
      </div>

      {/* Skeleton while loading */}
      {busy && !data ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{
              height: 44, borderRadius: 10,
              background: T.bgElev || T.bg, opacity: 0.5,
              backgroundImage: `linear-gradient(90deg, ${T.border} 0, ${T.surface} 50%, ${T.border} 100%)`,
              backgroundSize: "200% 100%",
              animation: `samas-skel 1.4s ease-in-out ${i * 0.15}s infinite`,
            }} />
          ))}
        </div>
      ) : null}

      {/* Summary line */}
      {data?.summary && (
        <div style={{
          fontFamily: FONT.sans, fontSize: 11, color: T.textMute, lineHeight: 1.5,
          marginBottom: 10,
        }}>{data.summary}</div>
      )}

      {/* Suggestions */}
      {data?.suggestions?.map((s) => {
        const tint = tintForBucket(s.label);
        const isPicked = picked === s.label;
        return (
          <button
            key={s.label}
            onClick={() => {
              setPicked(s.label);
              onPick && onPick(s.qty);
            }}
            style={{
              width: "100%", marginBottom: 8, padding: "10px 12px", borderRadius: 12,
              background: isPicked ? T.accentSoft : T.bgElev || T.bg,
              border: `1px solid ${isPicked ? T.accent : T.border}`,
              display: "flex", alignItems: "center", gap: 10,
              cursor: "pointer", textAlign: "left",
            }}
          >
            <div style={{
              minWidth: 60, padding: "4px 8px", borderRadius: 8,
              background: tint + "22", color: tint,
              fontFamily: FONT.mono, fontSize: 11, fontWeight: 800,
              letterSpacing: 0.4, textTransform: "uppercase", textAlign: "center",
            }}>
              {s.displayLabel}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                display: "flex", alignItems: "baseline", gap: 6,
                fontFamily: FONT.mono, fontSize: 14, fontWeight: 800, color: T.text,
              }}>
                <span>{s.qty}</span>
                <span style={{ fontSize: 10, color: T.textMute, fontWeight: 600 }}>
                  {tr("asset.sizing.units", lang)}
                </span>
                {isBuy && (
                  <span style={{
                    marginLeft: "auto", fontSize: 10, color: T.textMute, fontWeight: 600,
                  }}>
                    → {s.pctOfBook.toFixed(0)}% del book
                  </span>
                )}
              </div>
              <div style={{
                marginTop: 2, fontFamily: FONT.sans, fontSize: 11, color: T.textMute,
                lineHeight: 1.4,
              }}>{s.rationale}</div>
            </div>
          </button>
        );
      })}

      {data?.suggestions?.length > 0 && (
        <div style={{
          marginTop: 4, fontFamily: FONT.sans, fontSize: 10,
          color: T.textMute, textAlign: "right",
        }}>{tr("asset.sizing.disclaimer", lang)}</div>
      )}
    </div>
  );
}

// ============================================================
// TradeCoachCard (samas-0.0.95) — AI sanity check shown above the
// Cancel/Confirm buttons in the order confirmation step.
// ============================================================
// Auto-fires once on mount with the pending trade params. While
// loading, shows a subtle skeleton row. On success, renders the
// verdict (go / caution / flag) with color coding + the AI's
// headline + reason. On error, hides itself silently — we don't
// want to block a confirmation flow on AI being down.
function TradeCoachCard({ T, lang = "es", ticker, side, qty, price }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(true);
  const [hidden, setHidden] = useState(false);   // 0.1.1 — replaces err sentinel

  useEffect(() => {
    let alive = true;
    setBusy(true); setHidden(false); setData(null);
    tradeCoach({ ticker, side, qty, price })
      .then((res) => { if (alive) { setData(res); setBusy(false); } })
      .catch((e) => {
        if (!alive) return;
        // Hide the card on ANY error — AI being down should never
        // block a trade confirmation. Consent declined gets the
        // same silent treatment. (Pre-0.1.1 we set an err sentinel
        // string here; cleaner to just track a hidden boolean.)
        setHidden(true);
        setBusy(false);
      });
    return () => { alive = false; };
  }, [ticker, side, qty, price]);

  if (hidden) return null;

  const meta = data ? (() => {
    if (data.verdict === "flag")
      return { label: tr("broker.coach.flag", lang), color: T.danger, bg: T.dangerSoft, ring: T.danger };
    if (data.verdict === "caution")
      return { label: tr("broker.coach.caution", lang), color: "#F59E0B", bg: "rgba(245, 158, 11, 0.12)", ring: "#F59E0B" };
    return { label: tr("broker.coach.go", lang), color: T.accent, bg: T.accentSoft, ring: T.accent };
  })() : null;

  return (
    <div style={{
      marginBottom: 14, padding: 14, borderRadius: 14,
      background: T.surface, border: `1px solid ${meta ? meta.ring + "55" : T.border}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: busy || data ? 10 : 0 }}>
        <div style={{
          width: 22, height: 22, borderRadius: 6, flexShrink: 0,
          background: T.accent, color: "#06180c",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>
          </svg>
        </div>
        <div style={{
          flex: 1,
          fontFamily: FONT.mono, fontSize: 11, fontWeight: 700,
          color: T.textMute, letterSpacing: 0.4, textTransform: "uppercase",
        }}>{tr("broker.coach.title", lang)}</div>
        {meta && (
          <div style={{
            padding: "3px 8px", borderRadius: 999,
            background: meta.bg, color: meta.color,
            fontFamily: FONT.sans, fontSize: 10, fontWeight: 700,
            textTransform: "uppercase", letterSpacing: 0.5,
          }}>{meta.label}</div>
        )}
      </div>

      {busy && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          color: T.textMute, fontFamily: FONT.sans, fontSize: 12,
          padding: "2px 0",
        }}>
          <div style={{
            width: 14, height: 14, borderRadius: 999,
            border: `2px solid ${T.border}`, borderTopColor: T.accent,
            animation: "samas-spin 800ms linear infinite", flexShrink: 0,
          }} />
          {tr("broker.coach.thinking", lang)}
        </div>
      )}

      {data && !busy && (
        <>
          <div style={{
            fontFamily: FONT.sans, fontSize: 13, fontWeight: 700,
            color: T.text, lineHeight: 1.4, marginBottom: 6,
          }}>{data.headline}</div>
          {data.reason && (
            <div style={{
              fontFamily: FONT.sans, fontSize: 12, color: T.textMute, lineHeight: 1.5,
            }}>{data.reason}</div>
          )}
        </>
      )}
    </div>
  );
}

// Confetti — 14 small particles falling from the checkmark center,
// each with randomized direction + rotation + delay. Pure CSS,
// runs once on mount and stays static (opacity → 0) afterward.
// We pass --cx, --cy, --cr as CSS vars so the keyframe ends each
// particle at a different position.
function ConfettiBurst({ T }) {
  const pieces = useMemo(() => {
    const out = [];
    const colors = [T.accent, T.danger, "#F59E0B", "#3B82F6", "#A855F7", T.accent];
    for (let i = 0; i < 14; i++) {
      const cx = (Math.random() - 0.5) * 220;     // ±110px horizontal spread
      const cy = 80 + Math.random() * 40;          // 80-120px down
      const cr = 180 + Math.random() * 360;        // 180-540 deg rotate
      const delay = Math.random() * 120;           // 0-120ms stagger
      const size = 6 + Math.random() * 4;          // 6-10px
      out.push({ cx, cy, cr, delay, size, color: colors[i % colors.length] });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {pieces.map((p, i) => (
        <span key={i} style={{
          position: "absolute", left: "50%", top: 16,
          width: p.size, height: p.size, borderRadius: 2,
          background: p.color,
          "--cx": `${p.cx}px`,
          "--cy": `${p.cy}px`,
          "--cr": `${p.cr}deg`,
          animation: `samas-confetti-fall 1100ms cubic-bezier(.2,.6,.4,1) ${p.delay}ms forwards`,
        }}/>
      ))}
    </div>
  );
}

function DoneScreen({ T, done, side, qty, asset, holding, onClose }) {
  const ticker = asset?.ticker;
  const filled = done.status === "filled";
  const isBuy = side === "buy";

  // Note: success haptic was previously fired here on mount but
  // moved to confirmAndPlace (synchronously after placeOrder
  // resolves) in 0.0.71 — iOS WebView haptics fire more reliably
  // when called inside the resolving async function rather than
  // a useEffect that runs after several render frames.

  // "Share this trade" hands off to the Social tab via a window
  // CustomEvent (BrokerShell + SocialPage are sibling sub-shells
  // under SamasShell, which listens, stashes payload in localStorage,
  // switches tab). Social.jsx prefills the compose box on mount.
  function shareTrade() {
    if (!filled || !done.fillPrice) return;
    try {
      window.dispatchEvent(new CustomEvent("samas:share-trade", {
        detail: { side, qty, ticker, price: done.fillPrice },
      }));
    } catch {}
    onClose();
  }

  // Compute the new post-trade position to show in the position card.
  // Available when we have a holding object + this is a market-fill
  // (limit-pending orders haven't moved the position yet).
  const oldQty = holding?.qty || 0;
  const newQty = filled ? (isBuy ? oldQty + qty : oldQty - qty) : oldQty;
  const cur = asset?.currency === "ARS" ? "$" : "US$";
  const totalSpent = filled && done.fillPrice ? qty * done.fillPrice : 0;

  return (
    <div style={{ textAlign: "center", padding: "20px 0 8px", position: "relative" }}>
      {/* Confetti only on filled orders — limit-pending doesn't earn
          a celebration yet. */}
      {filled && <ConfettiBurst T={T} />}

      {/* Animated success circle. Scales in with overshoot, then the
          checkmark path strokes itself in. Both keyframes defined
          globally in Shell.jsx. */}
      <div style={{
        width: 72, height: 72, borderRadius: 36,
        background: T.accentSoft, color: T.accent,
        margin: "0 auto 16px",
        display: "flex", alignItems: "center", justifyContent: "center",
        animation: "samas-done-circle-in 420ms cubic-bezier(.34,1.56,.64,1)",
      }}>
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="3"
          strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5"
            style={{
              strokeDasharray: 32,
              strokeDashoffset: 32,
              animation: "samas-done-check-draw 380ms ease-out 220ms forwards",
            }}
          />
        </svg>
      </div>

      <div style={{
        fontFamily: FONT.display, fontSize: 22, fontWeight: 800,
        color: T.text, letterSpacing: -0.4, marginBottom: 4,
      }}>
        {filled ? `Orden ejecutada` : `Orden enviada`}
      </div>
      <div style={{
        fontFamily: FONT.sans, fontSize: 13, color: T.textMute, marginBottom: 16,
      }}>
        {isBuy ? "Compraste" : "Vendiste"} {qty} {ticker}
        {done.fillPrice ? ` a ${cur}${fmtMoney(done.fillPrice, asset?.currency)}` : ""}
      </div>

      {/* Position card — shown only for filled orders where we know
          the prior holding. Two columns: total spent/received on the
          left, new position on the right. Reads like a receipt
          summary, not just a confirmation. */}
      {filled && holding != null && (
        <div style={{
          padding: "14px 16px", borderRadius: 14, marginBottom: 12,
          background: T.surface, border: `1px solid ${T.border}`,
          display: "flex", justifyContent: "space-between", alignItems: "center",
          gap: 12, fontVariantNumeric: "tabular-nums",
        }}>
          <div style={{ textAlign: "left" }}>
            <div style={{
              fontFamily: FONT.sans, fontSize: 10, fontWeight: 700,
              color: T.textMute, letterSpacing: 0.5, textTransform: "uppercase",
              marginBottom: 4,
            }}>{isBuy ? "Total invertido" : "Total recibido"}</div>
            <div style={{
              fontFamily: FONT.mono, fontSize: 14, fontWeight: 700, color: T.text,
            }}>{cur}{fmtMoney(totalSpent, asset?.currency)}</div>
          </div>
          <div style={{
            width: 1, alignSelf: "stretch", background: T.border,
          }}/>
          <div style={{ textAlign: "right" }}>
            <div style={{
              fontFamily: FONT.sans, fontSize: 10, fontWeight: 700,
              color: T.textMute, letterSpacing: 0.5, textTransform: "uppercase",
              marginBottom: 4,
            }}>Tu posición</div>
            <div style={{
              fontFamily: FONT.mono, fontSize: 14, fontWeight: 700, color: T.text,
            }}>{newQty} {ticker}</div>
          </div>
        </div>
      )}

      {/* Order ID line — small, muted, tabular-nums. Mimics what real
          broker confirmations look like and gives the investor a
          mental model of "this is a real transaction with a record". */}
      {done.orderId && (
        <div style={{
          fontFamily: FONT.mono, fontSize: 10, color: T.textMute,
          letterSpacing: 0.4, marginBottom: 16,
        }}>
          # {String(done.orderId).slice(0, 12).toUpperCase()}
        </div>
      )}

      {filled && done.fillPrice && (
        <button onClick={shareTrade} style={{
          width: "100%", padding: 14, borderRadius: 14, marginBottom: 8,
          background: T.surface, color: T.accent,
          border: `1px solid ${T.accent}`,
          fontFamily: FONT.sans, fontSize: 14, fontWeight: 700,
          cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="18" cy="5"  r="3"/>
            <circle cx="6"  cy="12" r="3"/>
            <circle cx="18" cy="19" r="3"/>
            <line x1="8.59"  y1="13.51" x2="15.42" y2="17.49"/>
            <line x1="15.41" y1="6.51"  x2="8.59"  y2="10.49"/>
          </svg>
          Compartir este trade
        </button>
      )}
      <button onClick={onClose} style={{
        width: "100%", padding: 14, borderRadius: 14,
        background: T.accent, color: T.accentInk,
        fontFamily: FONT.sans, fontSize: 14, fontWeight: 700, border: "none",
        cursor: "pointer",
      }}>
        Listo
      </button>
    </div>
  );
}

// ----------------------------------------------------------
// TickerBanner — horizontal scrolling row of selected tickers + price
// + change %, capped at the top of Portafolio. Same role as the legacy
// PRO live ticker. Static data here (the asset universe is mocked) but
// rolls smoothly via CSS animation.
// ----------------------------------------------------------
function TickerBanner({ T, assets }) {
  // ETFs + commodities + cripto only — these are "the market" at a
  // glance. We deliberately skip individual stocks (AAPL, TSLA, etc.)
  // since those belong to Mercado/Top movers, not the macro snapshot.
  const pick = useMemo(() => {
    if (!assets || assets.length === 0) return [];
    const wanted = ["SPY", "QQQ", "IWM", "EWZ", "GLD", "SLV", "USO", "BTC", "ETH"];
    const found = wanted.map((tk) => assets.find((a) => a.ticker === tk)).filter(Boolean);
    if (found.length) return found;
    // Fallback: filter by category if specific tickers aren't seeded.
    return assets.filter((a) => ["ETF", "COMMOD", "CRYPTO"].includes(a.category));
  }, [assets]);

  if (pick.length === 0) return null;
  // Duplicate the list so the marquee loops seamlessly.
  const loop = [...pick, ...pick];

  return (
    <div style={{
      position: "relative",
      borderTop: `1px solid ${T.border}`,
      borderBottom: `1px solid ${T.border}`,
      background: T.surface,
      overflow: "hidden",
      paddingLeft: 16,
    }}>
      <style>{`
        @keyframes samas-marquee {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
      `}</style>
      <div style={{
        display: "flex", gap: 18, padding: "10px 0",
        whiteSpace: "nowrap",
        animation: "samas-marquee 38s linear infinite",
        willChange: "transform",
      }}>
        {loop.map((a, i) => {
          const up = a.changePct >= 0;
          return (
            <div key={`${a.ticker}-${i}`} style={{
              display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
              fontFamily: FONT.mono, fontSize: 11, fontWeight: 600,
            }}>
              <span style={{ color: T.textMute }}>{a.ticker}</span>
              <span style={{ color: T.text }}>
                {a.currency === "ARS" ? "$" : "US$"}{fmtMoney(a.price, a.currency)}
              </span>
              <span style={{ color: up ? T.accent : T.danger }}>{fmtPct(a.changePct)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ----------------------------------------------------------
// ============================================================
// RiskProfileCard (samas-0.1.9) — 1-10 risk score per holding
// ============================================================
// Auto-loads on mount, renders a compact list of held tickers with
// color-coded score chips. Each row expandable inline to show the
// AI-refined reason. Hides silently on AI failure / consent denial.
function RiskProfileCard({ T, lang = "es" }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [expanded, setExpanded] = useState(null); // ticker | null

  async function load() {
    setBusy(true);
    try {
      const res = await scoreRisk();
      setData(res);
    } catch (e) {
      if (e?.name === "AIConsentDeniedError" || e?.name === "AIQuotaExceededError") setHidden(true);
      else if (!data) setHidden(true);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  if (hidden) return null;
  const scores = data?.scores || {};
  const tickers = Object.keys(scores);
  if (data && tickers.length === 0) return null;

  // Sort highest risk first so the user sees what to look at.
  const sorted = tickers.slice().sort((a, b) => scores[b].score - scores[a].score);

  // Score → color. Low (1-3) = accent green, medium (4-6) = amber,
  // high (7-10) = danger red. Uses oklch-tolerant fallbacks.
  function colorForScore(s) {
    if (s <= 3) return T.accent;
    if (s <= 6) return "#F59E0B";
    return T.danger;
  }
  function bgForScore(s) {
    if (s <= 3) return T.accentSoft;
    if (s <= 6) return "rgba(245, 158, 11, 0.14)";
    return T.dangerSoft;
  }

  return (
    <div style={{
      margin: "0 16px 18px", padding: 14, borderRadius: 18,
      background: T.surface, border: `1px solid ${T.border}`,
    }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
      }}>
        <div style={{
          width: 22, height: 22, borderRadius: 6, flexShrink: 0,
          background: T.accent, color: "#06180c",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>
          </svg>
        </div>
        <div style={{
          flex: 1,
          fontFamily: FONT.mono, fontSize: 11, fontWeight: 700,
          color: T.textMute, letterSpacing: 0.6, textTransform: "uppercase",
        }}>
          {tr("portafolio.risk.title", lang)}
        </div>
      </div>

      {/* Summary line */}
      {busy && !data ? (
        <div style={{
          height: 14, marginBottom: 12, borderRadius: 6,
          background: T.border, opacity: 0.5,
          backgroundImage: `linear-gradient(90deg, ${T.border} 0, ${T.surface} 50%, ${T.border} 100%)`,
          backgroundSize: "200% 100%",
          animation: "samas-skel 1.4s ease-in-out infinite",
        }} />
      ) : data?.summary ? (
        <div style={{
          fontFamily: FONT.sans, fontSize: 12, color: T.textMute, lineHeight: 1.5,
          marginBottom: 12,
        }}>{data.summary}</div>
      ) : null}

      {/* Per-position rows */}
      {sorted.map((ticker, i) => {
        const s = scores[ticker];
        const isOpen = expanded === ticker;
        return (
          <div key={ticker} style={{
            borderTop: i === 0 ? "none" : `1px solid ${T.border}`,
          }}>
            <button
              onClick={() => setExpanded(isOpen ? null : ticker)}
              style={{
                width: "100%", padding: "10px 0",
                background: "transparent", border: "none",
                display: "flex", alignItems: "center", gap: 12, cursor: "pointer",
                textAlign: "left",
              }}
            >
              {/* Score chip */}
              <div style={{
                width: 38, height: 28, flexShrink: 0,
                borderRadius: 8,
                background: bgForScore(s.score),
                color: colorForScore(s.score),
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: FONT.mono, fontSize: 14, fontWeight: 800,
              }}>{s.score}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  display: "flex", alignItems: "baseline", gap: 8,
                }}>
                  <span style={{
                    fontFamily: FONT.mono, fontSize: 13, fontWeight: 700, color: T.text,
                    letterSpacing: 0.4,
                  }}>${ticker}</span>
                  <span style={{
                    fontFamily: FONT.sans, fontSize: 11, fontWeight: 600,
                    color: colorForScore(s.score), textTransform: "uppercase", letterSpacing: 0.4,
                  }}>{tr(`portafolio.risk.level.${s.level}`, lang)}</span>
                </div>
              </div>
              {/* Caret */}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke={T.textMute} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
                style={{
                  transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                  transition: "transform 160ms ease-out", flexShrink: 0,
                }}>
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
            {isOpen && (
              <div style={{
                paddingBottom: 10, paddingLeft: 50,
                fontFamily: FONT.sans, fontSize: 12, color: T.textMute, lineHeight: 1.55,
              }}>{s.reason}</div>
            )}
          </div>
        );
      })}

      <div style={{
        marginTop: 10, fontFamily: FONT.sans, fontSize: 10,
        color: T.textMute, textAlign: "right",
      }}>
        {tr("portafolio.risk.disclaimer", lang)}
      </div>
    </div>
  );
}

// ============================================================
// RebalanceCard + RebalanceSheet (samas-0.1.4)
// ============================================================
// Card on the Portafolio view → tap → sheet with a 3-way profile
// selector (Conservador / Equilibrado / Agresivo). Pick a profile
// → AI generates concrete buy/sell actions to move the book toward
// the target category mix → user reviews + (un)checks each action
// → "Ejecutar" loops through brokerApi.placeOrder.
// ============================================================
function RebalanceCard({ T, lang = "es", onRefresh }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => { setOpen(true); hapticNative("tap").catch(() => {}); }}
        style={{
          width: "calc(100% - 32px)", margin: "0 16px 18px",
          padding: 14, borderRadius: 18,
          background: T.surface, border: `1.5px solid ${T.accent}55`,
          display: "flex", alignItems: "center", gap: 12,
          cursor: "pointer", textAlign: "left",
        }}
      >
        <div style={{
          width: 38, height: 38, borderRadius: 12, flexShrink: 0,
          background: T.accent, color: "#06180c",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
            <polyline points="17 6 23 6 23 12"/>
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: FONT.sans, fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 2 }}>
            {tr("rebalance.cta_title", lang)}
          </div>
          <div style={{ fontFamily: FONT.sans, fontSize: 11, color: T.textMute, lineHeight: 1.4 }}>
            {tr("rebalance.cta_subtitle", lang)}
          </div>
        </div>
        <Pill T={T}>IA</Pill>
      </button>
      {open && (
        <RebalanceSheet
          T={T}
          lang={lang}
          onClose={() => setOpen(false)}
          onExecuted={() => {
            setOpen(false);
            if (onRefresh) onRefresh();
          }}
        />
      )}
    </>
  );
}

const PROFILES = [
  { id: "conservative", labelKey: "rebalance.profile.conservative", subKey: "rebalance.profile.conservative_sub" },
  { id: "balanced",     labelKey: "rebalance.profile.balanced",     subKey: "rebalance.profile.balanced_sub" },
  { id: "aggressive",   labelKey: "rebalance.profile.aggressive",   subKey: "rebalance.profile.aggressive_sub" },
];

function RebalanceSheet({ T, lang = "es", onClose, onExecuted }) {
  const [profile, setProfile] = useState("balanced");
  const [proposal, setProposal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  // Per-action checkbox state — keyed by index. Defaults to "all
  // checked" when the proposal arrives.
  const [selected, setSelected] = useState({});
  const [executing, setExecuting] = useState(false);
  const [executionLog, setExecutionLog] = useState([]); // [{ index, ok, msg }]

  async function generate(p) {
    if (busy) return;
    setBusy(true); setErr(null); setProposal(null); setSelected({});
    hapticNative("tap").catch(() => {});
    try {
      const data = await rebalancePortfolio(p);
      setProposal(data);
      // Default: all actions checked.
      const initialSel = {};
      (data.actions || []).forEach((_, i) => { initialSel[i] = true; });
      setSelected(initialSel);
      hapticNative("success").catch(() => {});
    } catch (e) {
      if (e?.name === "AIConsentDeniedError" || e?.name === "AIQuotaExceededError") onClose();
      else setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function execute() {
    if (!proposal || executing) return;
    const toRun = (proposal.actions || []).map((a, i) => ({ ...a, _idx: i }))
      .filter((a) => selected[a._idx]);
    if (toRun.length === 0) return;
    if (!window.confirm(tr("rebalance.confirm", lang, { n: toRun.length }))) return;
    setExecuting(true); setExecutionLog([]); setErr(null);
    let okCount = 0;
    for (const a of toRun) {
      try {
        // Use market order for everything — simpler than handling
        // limit prices. broker.placeOrder pre-checks holdings on
        // sells, so a malformed sell rejects fast.
        await brokerApi.placeOrder({
          ticker: a.ticker,
          side: a.side,
          qty: a.qty,
          type: "market",
        });
        setExecutionLog((log) => [...log, { index: a._idx, ok: true }]);
        okCount++;
      } catch (e) {
        setExecutionLog((log) => [...log, {
          index: a._idx, ok: false, msg: e?.message || String(e),
        }]);
      }
    }
    setExecuting(false);
    hapticNative(okCount === toRun.length ? "success" : "tap").catch(() => {});
    // If everything succeeded, close + signal refresh.
    if (okCount === toRun.length) {
      setTimeout(() => onExecuted(), 800);
    }
  }

  function toggleAction(i) {
    setSelected((s) => ({ ...s, [i]: !s[i] }));
  }

  return ReactDOM.createPortal(
    <div
      onClick={(e) => { if (e.target === e.currentTarget && !executing) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 130,
        background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        animation: "samas-fade-in 160ms ease-out",
      }}
    >
      <div style={{
        width: "100%", maxWidth: 540, maxHeight: "92vh",
        background: T.bgElev || T.bg, color: T.text,
        borderTopLeftRadius: 24, borderTopRightRadius: 24,
        border: `1px solid ${T.border}`, borderBottom: "none",
        display: "flex", flexDirection: "column", overflow: "hidden",
        animation: "samas-sheet-up 220ms ease-out",
      }}>
        {/* Header */}
        <div style={{
          padding: "16px 20px 12px",
          borderBottom: `1px solid ${T.border}`,
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 10, flexShrink: 0,
            background: T.accent, color: "#06180c",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: FONT.sans, fontSize: 11, fontWeight: 700,
              color: T.accent, letterSpacing: 0.6, textTransform: "uppercase" }}>
              IA · {tr("rebalance.kicker", lang)}
            </div>
            <div style={{ fontFamily: FONT.display, fontSize: 17, fontWeight: 700, color: T.text, letterSpacing: -0.3 }}>
              {tr("rebalance.title", lang)}
            </div>
          </div>
          <button onClick={onClose} disabled={executing} aria-label="Cerrar"
            style={{
              width: 32, height: 32, borderRadius: 16,
              background: T.bg, border: `1px solid ${T.border}`,
              color: T.textMute, fontFamily: FONT.sans, fontSize: 16,
              cursor: executing ? "default" : "pointer", padding: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>×</button>
        </div>

        {/* Body — scrolls */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px" }}>
          <div style={{ fontFamily: FONT.sans, fontSize: 13, color: T.textMute, lineHeight: 1.5, marginBottom: 12 }}>
            {tr("rebalance.intro", lang)}
          </div>

          {/* Profile selector */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
            {PROFILES.map((p) => {
              const active = profile === p.id;
              return (
                <button key={p.id} onClick={() => setProfile(p.id)}
                  disabled={busy || executing}
                  style={{
                    width: "100%", padding: "12px 14px", borderRadius: 14,
                    background: active ? T.accentSoft : T.surface,
                    border: `1.5px solid ${active ? T.accent : T.border}`,
                    color: T.text, cursor: busy ? "default" : "pointer",
                    textAlign: "left", display: "flex", alignItems: "center", gap: 12,
                  }}>
                  <div style={{
                    width: 18, height: 18, borderRadius: 9, flexShrink: 0,
                    border: `2px solid ${active ? T.accent : T.border}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {active && (<div style={{ width: 10, height: 10, borderRadius: 5, background: T.accent }}/>)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: FONT.sans, fontSize: 14, fontWeight: 700, color: T.text }}>
                      {tr(p.labelKey, lang)}
                    </div>
                    <div style={{ fontFamily: FONT.sans, fontSize: 12, color: T.textMute, marginTop: 2 }}>
                      {tr(p.subKey, lang)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {!proposal && !busy && (
            <button onClick={() => generate(profile)}
              disabled={executing}
              style={{
                width: "100%", padding: "12px 14px", borderRadius: 12,
                background: T.accent, color: T.accentInk,
                fontFamily: FONT.sans, fontSize: 14, fontWeight: 700, border: "none",
                cursor: "pointer",
              }}>
              {tr("rebalance.generate", lang)}
            </button>
          )}

          {busy && (
            <div style={{
              display: "flex", alignItems: "center", gap: 10, padding: "12px 0",
              color: T.textMute, fontFamily: FONT.sans, fontSize: 13,
            }}>
              <div style={{
                width: 18, height: 18, borderRadius: 999,
                border: `2.4px solid ${T.border}`, borderTopColor: T.accent,
                animation: "samas-spin 800ms linear infinite",
              }} />
              {tr("rebalance.thinking", lang)}
            </div>
          )}

          {err && (
            <div style={{
              padding: "10px 12px", borderRadius: 12,
              background: T.dangerSoft, color: T.danger,
              fontFamily: FONT.sans, fontSize: 12, lineHeight: 1.5, marginTop: 8,
            }}>{err}</div>
          )}

          {proposal && !busy && (
            <>
              {/* Summary */}
              <div style={{
                marginTop: 4, marginBottom: 14, padding: 12, borderRadius: 12,
                background: T.surface, border: `1px solid ${T.border}`,
                fontFamily: FONT.sans, fontSize: 13, color: T.text, lineHeight: 1.5,
              }}>{proposal.summary}</div>

              {/* Actions list */}
              {(proposal.actions || []).length === 0 ? (
                <div style={{
                  padding: 18, borderRadius: 14,
                  background: T.accentSoft, color: T.text,
                  fontFamily: FONT.sans, fontSize: 13, textAlign: "center",
                }}>
                  {tr("rebalance.no_actions", lang)}
                </div>
              ) : (
                <>
                  <div style={{
                    fontFamily: FONT.sans, fontSize: 11, fontWeight: 700,
                    color: T.textMute, letterSpacing: 0.5, textTransform: "uppercase",
                    marginBottom: 8,
                  }}>{tr("rebalance.actions_label", lang)}</div>
                  {(proposal.actions || []).map((a, i) => {
                    const isOn = !!selected[i];
                    const log = executionLog.find((l) => l.index === i);
                    return (
                      <div key={i} style={{
                        display: "flex", alignItems: "flex-start", gap: 10,
                        padding: 12, marginBottom: 8, borderRadius: 12,
                        background: T.surface, border: `1px solid ${log?.ok ? T.accent : (log?.ok === false ? T.danger : T.border)}`,
                        opacity: isOn ? 1 : 0.55,
                      }}>
                        <button
                          onClick={() => toggleAction(i)}
                          disabled={executing}
                          style={{
                            width: 22, height: 22, borderRadius: 6, flexShrink: 0, marginTop: 1,
                            background: isOn ? T.accent : "transparent",
                            border: `2px solid ${isOn ? T.accent : T.border}`,
                            color: T.accentInk, padding: 0, cursor: "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}>
                          {isOn && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                              strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                          )}
                        </button>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            display: "flex", alignItems: "center", gap: 8, marginBottom: 4,
                          }}>
                            <span style={{
                              padding: "2px 8px", borderRadius: 6,
                              background: a.side === "buy" ? T.accentSoft : T.dangerSoft,
                              color: a.side === "buy" ? T.accent : T.danger,
                              fontFamily: FONT.mono, fontSize: 10, fontWeight: 800, letterSpacing: 0.5,
                            }}>{a.side === "buy" ? "COMPRA" : "VENTA"}</span>
                            <span style={{
                              fontFamily: FONT.mono, fontSize: 13, fontWeight: 700, color: T.text,
                            }}>{a.qty} {a.ticker}</span>
                            {log && (
                              <span style={{
                                marginLeft: "auto",
                                fontFamily: FONT.sans, fontSize: 10, fontWeight: 700,
                                color: log.ok ? T.accent : T.danger,
                              }}>{log.ok ? "✓" : "×"}</span>
                            )}
                          </div>
                          <div style={{
                            fontFamily: FONT.sans, fontSize: 12, color: T.textMute, lineHeight: 1.5,
                          }}>{a.reason}</div>
                          {log && !log.ok && log.msg && (
                            <div style={{
                              marginTop: 4, fontFamily: FONT.sans, fontSize: 11, color: T.danger,
                            }}>{log.msg}</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </>
          )}
        </div>

        {/* Sticky footer with Execute button */}
        {proposal && (proposal.actions || []).length > 0 && (
          <div style={{
            padding: "12px 18px calc(env(safe-area-inset-bottom) + 14px)",
            borderTop: `1px solid ${T.border}`,
            background: T.bgElev || T.bg,
          }}>
            <button
              onClick={execute}
              disabled={executing || Object.values(selected).every((v) => !v)}
              style={{
                width: "100%", padding: "13px 16px", borderRadius: 14,
                background: T.accent, color: T.accentInk,
                fontFamily: FONT.sans, fontSize: 14, fontWeight: 800, border: "none",
                cursor: executing ? "default" : "pointer",
                opacity: executing ? 0.6 : 1,
              }}>
              {executing
                ? tr("rebalance.executing", lang)
                : tr("rebalance.execute", lang)}
            </button>
            <div style={{
              marginTop: 6, fontFamily: FONT.sans, fontSize: 10, color: T.textMute,
              textAlign: "center", lineHeight: 1.4,
            }}>{tr("rebalance.disclaimer", lang)}</div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// AIPlanCard — entry point for the goal-planning wizard. The wizard
// itself lives in /src/ai/ObjectivesWizard.jsx but it depends on the
// legacy theme and is heavy. For now this card opens a placeholder
// alert so the user sees the surface; we can wire the real wizard in
// a follow-up pass once it's been ported to the v2 theme.
// ----------------------------------------------------------
function AIPlanCard({ T, onOpen, savedPlan, lang = "es" }) {
  // If the user already ran the wizard, show a summary of their plan
  // (strategy + objective + horizon) instead of the generic prompt.
  // Tapping still opens the wizard so they can review or adjust.
  if (savedPlan && savedPlan.strategy) {
    const strategyKey = {
      conservadora: "broker.strategy.conservative",
      moderada:     "broker.strategy.moderate",
      agresiva:     "broker.strategy.aggressive",
    }[savedPlan.strategy];
    const strategyLabel = strategyKey ? tr(strategyKey, lang) : savedPlan.strategy;
    const stratColor = {
      conservadora: "#0EA5E9",
      moderada: T.accent,
      agresiva: "#F7931A",
    }[savedPlan.strategy] || T.accent;
    const profile = savedPlan._profile || {};
    const target = profile.targetAmount || 0;
    const horizon = profile.horizonYears || 0;
    const currency = profile.currency || "ARS";
    const sym = currency === "USD" ? "US$" : "$";

    async function share(e) {
      e.stopPropagation();
      const allocation = (savedPlan.allocation || [])
        .map((a) => `• ${a.name}: ${a.percent}%`).join("\n");
      const text = [
        `Mi plan en SAMAS:`,
        `Estrategia: ${strategyLabel}`,
        `Objetivo: ${sym}${Math.round(target).toLocaleString("es-AR")} en ${horizon} ${horizon === 1 ? "año" : "años"}`,
        ``,
        `Asignación:`,
        allocation,
      ].join("\n");
      try {
        if (navigator.share) {
          await navigator.share({ title: "Mi plan en SAMAS", text });
        } else if (navigator.clipboard) {
          await navigator.clipboard.writeText(text);
          toast.success("Plan copiado al portapapeles.");
        }
      } catch (_) { /* user cancelled */ }
    }

    return (
      <div onClick={onOpen || (() => {})} style={{
        margin: "16px", padding: 16, borderRadius: 22,
        background: `linear-gradient(135deg, ${stratColor}1F 0%, ${T.surface} 70%)`,
        border: `1px solid ${stratColor}55`,
        display: "flex", alignItems: "center", gap: 14, cursor: "pointer",
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 12, flexShrink: 0,
          background: T.bg, border: `1px solid ${T.border}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: stratColor,
        }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2" fill="currentColor"/>
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: FONT.sans, fontSize: 11, color: T.textMute,
            letterSpacing: 0.6, fontWeight: 700, textTransform: "uppercase", marginBottom: 2,
          }}>{tr("broker.your_plan", lang)} · {strategyLabel}</div>
          <div style={{
            fontFamily: FONT.display, fontSize: 16, fontWeight: 700, color: T.text,
            letterSpacing: -0.3,
          }}>
            {sym}{Math.round(target).toLocaleString("es-AR")} {horizon === 1 ? tr("broker.target_in_year", lang) : tr("broker.target_in_years", lang, { n: horizon })}
          </div>
          <div style={{ fontFamily: FONT.sans, fontSize: 11, color: T.textMute, marginTop: 2 }}>
            {tr("broker.tap_review", lang)}
          </div>
        </div>
        <button onClick={share} aria-label="Compartir plan" style={{
          width: 34, height: 34, borderRadius: 10, flexShrink: 0,
          background: T.bg, border: `1px solid ${T.border}`,
          color: T.text, display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer",
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
          </svg>
        </button>
      </div>
    );
  }

  // No plan yet — show the prompt to run the wizard.
  return (
    <div style={{
      margin: "16px",
      padding: 16,
      borderRadius: 22,
      background: `linear-gradient(135deg, ${T.accentSoft} 0%, ${T.surface} 70%)`,
      border: `1px solid ${T.accent}33`,
      display: "flex", alignItems: "center", gap: 14,
      cursor: "pointer",
    }} onClick={onOpen || (() => {})}>
      <div style={{
        width: 48, height: 48, borderRadius: 12,
        background: T.bg, border: `1px solid ${T.border}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: T.accent, flexShrink: 0,
      }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <circle cx="12" cy="12" r="6"/>
          <circle cx="12" cy="12" r="2" fill="currentColor"/>
        </svg>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <span style={{ fontFamily: FONT.display, fontSize: 15, fontWeight: 700, color: T.text }}>
            Armar mi plan con IA
          </span>
          <span style={{
            fontFamily: FONT.mono, fontSize: 9, fontWeight: 700, letterSpacing: 0.6,
            padding: "2px 6px", borderRadius: 4,
            background: T.accent, color: T.accentInk,
          }}>NUEVO</span>
        </div>
        <div style={{ fontFamily: FONT.sans, fontSize: 12, color: T.textMute, lineHeight: 1.4 }}>
          Análisis de ingresos, gastos y objetivo para diseñar tu estrategia.
        </div>
      </div>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.textMute} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </div>
  );
}

// ----------------------------------------------------------
// DistribucionBar — horizontal bar split by holding share of the total
// USD value of the cartera. Each segment gets a deterministic color so
// the same ticker is the same color across renders. Below the bar,
// a legend lists each ticker + its %.
// ----------------------------------------------------------
const DIST_COLORS = [
  "#16C784", "#7C5CFF", "#F59E0B", "#06B6D4", "#EF4444",
  "#22D3EE", "#EC4899", "#84CC16", "#F97316", "#A855F7",
];
function colorFor(ticker, idx) {
  return DIST_COLORS[idx % DIST_COLORS.length];
}
function DistribucionBar({ T, holdings, totalUsd }) {
  const rows = useMemo(() => {
    if (!totalUsd) return [];
    return holdings.map((h, i) => {
      const valUsd = h.currency === "ARS" ? (h.value / 1248) : h.value; // approx MEP
      const pct = (valUsd / totalUsd) * 100;
      return { ticker: h.ticker, pct, color: colorFor(h.ticker, i) };
    }).sort((a, b) => b.pct - a.pct);
  }, [holdings, totalUsd]);

  if (rows.length === 0) return null;

  return (
    <div style={{ margin: "0 16px 20px" }}>
      <SectionHead T={T} title="Distribución" />
      <div style={{
        marginTop: 12, padding: 14, borderRadius: 18,
        background: T.surface, border: `1px solid ${T.border}`,
      }}>
        <div style={{
          display: "flex", height: 10, borderRadius: 5, overflow: "hidden",
          background: T.bg,
        }}>
          {rows.map((r) => (
            <div key={r.ticker} style={{
              width: `${r.pct}%`, background: r.color,
            }} />
          ))}
        </div>
        <div style={{
          marginTop: 10, display: "flex", flexWrap: "wrap", gap: "6px 14px",
        }}>
          {rows.map((r) => (
            <div key={r.ticker} style={{
              display: "flex", alignItems: "center", gap: 6,
              fontFamily: FONT.sans, fontSize: 11, color: T.textMute,
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: 2, background: r.color,
              }}/>
              <span style={{ color: T.text, fontWeight: 600 }}>{r.ticker}</span>
              <span style={{ fontFamily: FONT.mono }}>{r.pct.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// PRO MERCADO (samas-0.0.44)
// ============================================================
// Two new visual surfaces in MercadoView when Pro mode is on:
//
//   1. EarningsWidget — small horizontal-scroll card listing the
//      next ~5 earnings dates. Mock data, deterministic per ticker.
//      Sits above the search row so users see "next event" first.
//   2. HeatmapGrid    — grid of color-coded tiles (red→accent based
//      on gain%). Toggle on the search row picks list vs heatmap.
// ============================================================

// Mock earnings calendar — fixed offsets from "today" so the
// dates are stable across renders within a session and shift
// realistically over time. Tickers chosen to cover popular CEDEAR +
// AR stocks so most demo accounts have at least one match.
const EARNINGS_OFFSETS = {
  NVDA: 4, AAPL: 7,  TSLA: 12, MSFT: 14, GOOGL: 21,
  GGAL: 3, YPF: 9,   PAMP: 18,
};

function nextEarningsList() {
  const now = new Date();
  return Object.entries(EARNINGS_OFFSETS)
    .map(([ticker, days]) => {
      const d = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
      return { ticker, days, date: d };
    })
    .sort((a, b) => a.days - b.days)
    .slice(0, 5);
}

function EarningsWidget({ T, assets, onSelectAsset, lang = "es" }) {
  const list = useMemo(() => nextEarningsList(), []);
  function dateLabel(days, date) {
    if (days === 0) return tr("pro.market.earnings.today", lang);
    if (days === 1) return tr("pro.market.earnings.tomorrow", lang);
    return tr("pro.market.earnings.in_days", lang, { n: days });
  }
  return (
    <div style={{ margin: "16px 16px 0" }}>
      <div style={{
        fontFamily: FONT.mono, fontSize: 11, fontWeight: 700,
        color: T.textMute, letterSpacing: 0.4, textTransform: "uppercase",
        padding: "0 4px 8px",
      }}>{tr("pro.market.earnings.title", lang)}</div>
      <div style={{
        display: "flex", gap: 8,
        overflowX: "auto", scrollbarWidth: "none",
        WebkitOverflowScrolling: "touch",
        // Slight negative margin so the first chip kisses the edge
        // and the last chip doesn't get clipped on overscroll.
        padding: "0 4px 4px",
      }}>
        {list.map((e) => {
          const asset = assets.find((a) => a.ticker === e.ticker);
          return (
            <button
              key={e.ticker}
              onClick={() => asset && onSelectAsset(asset)}
              disabled={!asset}
              style={{
                flexShrink: 0, padding: "8px 12px", borderRadius: 12,
                background: T.surface, border: `1px solid ${T.border}`,
                cursor: asset ? "pointer" : "default", textAlign: "left",
                display: "flex", flexDirection: "column", gap: 2,
                opacity: asset ? 1 : 0.5,
                minWidth: 110,
              }}
            >
              <span style={{
                fontFamily: FONT.mono, fontSize: 12, fontWeight: 800,
                color: T.text, letterSpacing: 0.2,
              }}>{e.ticker}</span>
              <span style={{
                fontFamily: FONT.sans, fontSize: 11, color: T.accent, fontWeight: 700,
              }}>{dateLabel(e.days, e.date)}</span>
              <span style={{
                fontFamily: FONT.mono, fontSize: 10, color: T.textMute,
              }}>{e.date.toLocaleDateString("es-AR", { day: "2-digit", month: "short" })}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// Map a gain% in [-5, +5] to a CSS color from a red→neutral→green
// gradient. We clamp at 5% in either direction so a single moonshot
// doesn't flatten everyone else's tiles into the same shade.
//
// IMPORTANT: T.accent / T.danger are oklch() values in this build,
// not hex strings — so the previous `${T.danger}cc` string-concat
// approach produced literal invalid CSS like "oklch(...)cc" and the
// heatmap silently rendered with no background. Using fixed hex
// stops here keeps the gradient predictable across light/dark
// themes and is a one-time tweak away if we ever theme-shift it.
const HEAT_DANGER_RGB = "239, 68, 68";   // ~#EF4444 (red-500)
const HEAT_ACCENT_RGB = "22, 199, 132";  // ~#16C784 (samas accent)
function heatColorFor(pct, T) {
  const clamped = Math.max(-5, Math.min(5, pct || 0));
  if (clamped === 0) return T.surface;
  if (clamped < 0) {
    // -5 → fully red, 0 → transparent. Layer on top of the surface
    // by emitting rgba so the card still picks up the surrounding
    // theme. alpha caps at 0.8 so the ticker text stays legible.
    const alpha = Math.min(0.8, (Math.abs(clamped) / 5) * 0.8);
    return `rgba(${HEAT_DANGER_RGB}, ${alpha.toFixed(2)})`;
  }
  const alpha = Math.min(0.8, (clamped / 5) * 0.8);
  return `rgba(${HEAT_ACCENT_RGB}, ${alpha.toFixed(2)})`;
}

function HeatmapGrid({ T, assets, onSelectAsset, lang = "es" }) {
  if (!assets || assets.length === 0) return null;
  return (
    <div style={{ margin: "0 16px 16px" }}>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 6,
      }}>
        {assets.map((a) => {
          const up = (a.changePct || 0) >= 0;
          const bg = heatColorFor(a.changePct, T);
          return (
            <button
              key={a.ticker}
              onClick={() => onSelectAsset(a)}
              style={{
                padding: "10px 8px", borderRadius: 12,
                background: bg,
                border: `1px solid ${T.border}`,
                color: T.text, cursor: "pointer", textAlign: "left",
                display: "flex", flexDirection: "column", gap: 2,
                aspectRatio: "1.4 / 1",
                overflow: "hidden",
              }}
            >
              <span style={{
                fontFamily: FONT.mono, fontSize: 13, fontWeight: 800,
                color: T.text, letterSpacing: 0.2,
              }}>{a.ticker}</span>
              <span style={{
                fontFamily: FONT.mono, fontSize: 11, fontWeight: 700,
                color: up ? T.accent : T.danger,
                fontVariantNumeric: "tabular-nums",
              }}>{up ? "+" : ""}{(a.changePct || 0).toFixed(2)}%</span>
              <span style={{
                marginTop: "auto",
                fontFamily: FONT.mono, fontSize: 10, color: T.textMute,
                fontVariantNumeric: "tabular-nums",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {a.currency === "ARS" ? "$" : "US$"}{fmtMoney(a.price, a.currency)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// PRO ASSETDETAIL (samas-0.0.43)
// ============================================================
// Three new visual cards that render at the top of AssetSheet
// when proMode is on. Like the portfolio dashboard, all data is
// derived from the asset prop so it's stable and deterministic
// per ticker — no live feed required for the prototype.
//
//   1. ProAssetChart   — multi-timeframe area chart with toggle.
//   2. RangeBar52w     — visual marker between 52w low and high.
//   3. FundamentalsCard — P/E · EPS · Mkt cap · Div yield · Vol.
// ============================================================

// Deterministic-but-different number generator seeded from the
// ticker string, so AAPL always has the same fundamentals across
// renders but they differ from NVDA / TSLA / etc.
function tickerSeed(ticker, salt = 0) {
  let h = 0;
  for (let i = 0; i < (ticker || "").length; i++) {
    h = ((h << 5) - h + ticker.charCodeAt(i)) | 0;
  }
  h = (h ^ salt) >>> 0;
  return () => {
    // mulberry32
    h = (h + 0x6D2B79F5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TIMEFRAMES = [
  { id: "1d",  key: "pro.asset.tf.1d",  points: 24,  vol: 0.006, drift: 0.001 },
  { id: "1w",  key: "pro.asset.tf.1w",  points: 35,  vol: 0.012, drift: 0.004 },
  { id: "1m",  key: "pro.asset.tf.1m",  points: 30,  vol: 0.018, drift: 0.012 },
  { id: "1y",  key: "pro.asset.tf.1y",  points: 52,  vol: 0.030, drift: 0.060 },
  { id: "all", key: "pro.asset.tf.all", points: 60,  vol: 0.040, drift: 0.180 },
];

// ProAssetChart — SVG line + area (rolled back from TradingView in
// 0.0.94). Lightweight Charts wouldn't render in this Capacitor
// WebView setup despite four debug attempts; without remote devtools
// access I can't dig deeper. Falling back to the hand-rolled SVG so
// the Cohen demo has a working chart. TradingView is parked as a
// future-Pro feature once we can isolate the WebView issue.
function ProAssetChart({ T, asset, lang = "es" }) {
  const [tf, setTf] = useState("1m");
  const cfg = TIMEFRAMES.find((t) => t.id === tf) || TIMEFRAMES[2];
  const series = useMemo(() => {
    const rng = tickerSeed(asset.ticker, cfg.points);
    const target = asset.price;
    // Build a series ending at the current price by walking backward
    // from `target` with random walk, then reverse so the latest
    // point is on the right.
    const out = [target];
    for (let i = 1; i < cfg.points; i++) {
      const noise = (rng() - 0.5) * cfg.vol;
      const drift = cfg.drift / cfg.points;
      const prev = out[i - 1] / (1 + drift + noise);
      out.push(prev);
    }
    return out.reverse();
  }, [asset.ticker, asset.price, cfg.points, cfg.vol, cfg.drift]);
  const first = series[0];
  const last = series[series.length - 1];
  const periodPct = first ? ((last - first) / first) * 100 : 0;
  const up = periodPct >= 0;
  const ccySym = asset.currency === "ARS" ? "$" : "US$";

  // Layout — 320×140 viewBox, full-width responsive. Path math:
  // build a polyline + close it down to the bottom for the area
  // fill. Y inverted because SVG origin is top-left.
  const w = 320, h = 140;
  const min = Math.min(...series), max = Math.max(...series);
  const range = max - min || 1;
  function ptX(i) { return (i / (series.length - 1)) * w; }
  function ptY(v) { return h - ((v - min) / range) * h; }
  const linePath = series.map((v, i) =>
    `${i === 0 ? "M" : "L"} ${ptX(i).toFixed(1)} ${ptY(v).toFixed(1)}`
  ).join(" ");
  const fillPath = `${linePath} L ${w} ${h} L 0 ${h} Z`;

  return (
    <div style={{
      margin: "0 0 18px",
      padding: "14px 16px 16px", borderRadius: 18,
      background: T.surface, border: `1px solid ${T.border}`,
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline",
        marginBottom: 8,
      }}>
        <div style={{
          fontFamily: FONT.mono, fontSize: 11, fontWeight: 700,
          color: T.textMute, letterSpacing: 0.4, textTransform: "uppercase",
        }}>
          {tr(cfg.key, lang)} · {up ? "+" : ""}{periodPct.toFixed(2)}%
        </div>
        <div style={{
          fontFamily: FONT.mono, fontSize: 11, fontWeight: 700,
          color: up ? T.accent : T.danger,
        }}>
          {up ? "+" : ""}{ccySym}{fmtMoney(Math.abs(last - first), asset.currency)}
        </div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none">
        <defs>
          <linearGradient id={`grad-${asset.ticker}-${tf}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={up ? T.accent : T.danger} stopOpacity="0.32"/>
            <stop offset="100%" stopColor={up ? T.accent : T.danger} stopOpacity="0"/>
          </linearGradient>
        </defs>
        {/* Subtle horizontal gridlines at 25/50/75% — give the eye
            an anchor without chrome heavy enough to compete with
            the price line itself. */}
        {[0.25, 0.5, 0.75].map((p) => (
          <line key={p} x1={0} x2={w} y1={h * p} y2={h * p}
            stroke={T.border} strokeDasharray="2 4" strokeWidth={0.5} opacity={0.6} />
        ))}
        <path d={fillPath} fill={`url(#grad-${asset.ticker}-${tf})`} />
        <path d={linePath} fill="none" stroke={up ? T.accent : T.danger}
          strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div style={{
        marginTop: 10, display: "flex", gap: 4,
        background: T.bg, border: `1px solid ${T.border}`,
        borderRadius: 999, padding: 3,
      }}>
        {TIMEFRAMES.map((t) => (
          <button
            key={t.id}
            onClick={() => setTf(t.id)}
            style={{
              flex: 1, padding: "5px 0", borderRadius: 999, border: "none", cursor: "pointer",
              background: tf === t.id ? T.accent : "transparent",
              color: tf === t.id ? T.accentInk : T.textMute,
              fontFamily: FONT.mono, fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
            }}
          >{tr(t.key, lang)}</button>
        ))}
      </div>
    </div>
  );
}

// ----------------------------------------------------------
// RangeBar52w — visual where the current price sits between the
// 52-week low and 52-week high. Mock low/high derived from price
// with a deterministic seed so each ticker has its own range.
// ----------------------------------------------------------
function RangeBar52w({ T, asset, lang = "es" }) {
  const { low, high, pos } = useMemo(() => {
    const rng = tickerSeed(asset.ticker, 99);
    // Low between -45% and -15% of current; high between +5% and +35%.
    const lowMul  = 1 - (0.15 + rng() * 0.30);
    const highMul = 1 + (0.05 + rng() * 0.30);
    const lo = asset.price * lowMul;
    const hi = asset.price * highMul;
    const p = (asset.price - lo) / (hi - lo);
    return { low: lo, high: hi, pos: Math.max(0, Math.min(1, p)) };
  }, [asset.ticker, asset.price]);
  const ccySym = asset.currency === "ARS" ? "$" : "US$";
  return (
    <div style={{
      margin: "0 0 18px",
      padding: "12px 16px 14px", borderRadius: 18,
      background: T.surface, border: `1px solid ${T.border}`,
    }}>
      <div style={{
        fontFamily: FONT.mono, fontSize: 11, fontWeight: 700,
        color: T.textMute, letterSpacing: 0.4, textTransform: "uppercase",
        marginBottom: 12,
      }}>{tr("pro.asset.range.title", lang)}</div>
      {/* Bar — full width, 6px tall, gradient red→accent so the
          color cue tracks low → high too. The marker is a white
          pill at `pos` × bar width. */}
      <div style={{ position: "relative", height: 6, borderRadius: 3, overflow: "visible" }}>
        <div style={{
          position: "absolute", inset: 0, borderRadius: 3,
          // Hardcoded rgba stops — same reason as heatColorFor above:
          // T.danger / T.accent are oklch() values in this build, so
          // `${T.danger}99` produces invalid CSS and the gradient
          // would silently disappear. Static rgba keeps the bar
          // visible regardless of theme.
          background: "linear-gradient(90deg, rgba(239,68,68,0.6) 0%, rgba(120,120,120,0.25) 50%, rgba(22,199,132,0.6) 100%)",
        }}/>
        <div style={{
          position: "absolute", top: -3, left: `calc(${(pos * 100).toFixed(1)}% - 6px)`,
          width: 12, height: 12, borderRadius: 6,
          background: T.text, border: `2px solid ${T.surface}`,
          boxShadow: "0 1px 4px rgba(0,0,0,0.3)",
        }}/>
      </div>
      <div style={{
        marginTop: 10, display: "flex", justifyContent: "space-between",
        fontFamily: FONT.mono, fontSize: 11,
      }}>
        <div>
          <div style={{ color: T.textMute, fontSize: 9, letterSpacing: 0.4 }}>
            {tr("pro.asset.range.low", lang)}
          </div>
          <div style={{ color: T.text, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
            {ccySym}{fmtMoney(low, asset.currency)}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: T.textMute, fontSize: 9, letterSpacing: 0.4 }}>
            {tr("pro.asset.range.high", lang)}
          </div>
          <div style={{ color: T.text, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
            {ccySym}{fmtMoney(high, asset.currency)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------
// FundamentalsCard — 2-column key/value grid. Numbers are
// deterministic per ticker so they don't shuffle across renders.
// ETFs / bonds get tailored values (no P/E for an ETF, etc) so
// the screen doesn't show nonsense.
// ----------------------------------------------------------
function fmtCompactNumber(n) {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6)  return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3)  return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

// ============================================================
// AssetAIInsight (samas-0.0.85) — AI-generated take on a single
// asset. Reads ticker → calls analyze-asset → renders headline +
// bullets + thesis + sentiment chip. Self-contained: starts in a
// "tap to analyze" state, async-loads on demand, caches the result
// for the session by ticker so re-opening the same AssetSheet
// doesn't burn another LLM call.
//
// Deliberately NOT pro-gated — AI is the demo differentiator;
// Cohen should see this on every asset they tap. Templated server
// fallback keeps the demo working without an Anthropic key.
// ============================================================
const ASSET_INSIGHT_CACHE = new Map(); // ticker → response

function AssetAIInsight({ T, ticker, lang = "es" }) {
  const [data, setData] = useState(() => ASSET_INSIGHT_CACHE.get(ticker) || null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  // Reset when the user navigates between assets (sheet stays
  // mounted, ticker changes via prop) so we don't show NVDA's
  // analysis on the GGAL detail.
  useEffect(() => {
    setData(ASSET_INSIGHT_CACHE.get(ticker) || null);
    setBusy(false);
    setErr(null);
  }, [ticker]);

  async function run() {
    if (busy) return;
    setErr(null); setBusy(true);
    hapticNative("tap").catch(() => {});
    try {
      const result = await analyzeAsset(ticker);
      ASSET_INSIGHT_CACHE.set(ticker, result);
      setData(result);
      hapticNative("success").catch(() => {});
    } catch (e) {
      // Consent declined — bail without surfacing as error.
      if (e?.name === "AIConsentDeniedError" || e?.name === "AIQuotaExceededError") { /* no-op */ }
      else setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  // Sentiment chip styling — bullish/neutral/bearish map to
  // accent / textMute / danger so the at-a-glance read is fast.
  const sentimentMeta = data ? (() => {
    if (data.sentiment === "bullish")
      return { label: tr("broker.ai.sentiment.bullish", lang), color: T.accent, bg: T.accentSoft };
    if (data.sentiment === "bearish")
      return { label: tr("broker.ai.sentiment.bearish", lang), color: T.danger, bg: T.dangerSoft };
    return { label: tr("broker.ai.sentiment.neutral", lang), color: T.textMute, bg: T.bg };
  })() : null;

  return (
    <div style={{
      // Match sibling sections (RangeBar52w / FundamentalsCard) so the
      // AssetSheet body has consistent left/right alignment + bottom
      // rhythm. Header now sits INSIDE this card's padding line
      // instead of floating at 4px-from-edge (samas-0.0.86 fix).
      margin: "0 0 18px",
      padding: "14px 16px",
      borderRadius: 18,
      background: T.surface, border: `1px solid ${T.border}`,
    }}>
      {/* Header row — icon + AI INSIGHT label + sentiment chip on the
          right when loaded. Title styled to MATCH the FUNDAMENTALS /
          RANGE titles in sibling cards (mono 11 textMute) so the
          AssetSheet has one consistent section-title typography
          (samas-0.0.86 alignment sweep). */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <div style={{
          width: 22, height: 22, borderRadius: 6,
          background: T.accent, color: "#06180c", flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>
          </svg>
        </div>
        <div style={{
          flex: 1,
          fontFamily: FONT.mono, fontSize: 11, fontWeight: 700,
          color: T.textMute, letterSpacing: 0.4, textTransform: "uppercase",
        }}>
          {tr("broker.ai.title", lang)}
        </div>
        {sentimentMeta && (
          <div style={{
            padding: "3px 8px", borderRadius: 999,
            background: sentimentMeta.bg, color: sentimentMeta.color,
            fontFamily: FONT.sans, fontSize: 10, fontWeight: 700,
            textTransform: "uppercase", letterSpacing: 0.5,
          }}>{sentimentMeta.label}</div>
        )}
      </div>

      {/* Idle CTA — flat pill INSIDE the card. No nested gradient (the
          card itself provides the chrome). */}
      {!data && !busy && !err && (
        <button
          onClick={run}
          style={{
            width: "100%", padding: "12px 14px", borderRadius: 12,
            background: `linear-gradient(135deg, ${T.accentSoft} 0%, transparent 80%)`,
            border: `1px solid ${T.accent}55`,
            color: T.text, cursor: "pointer", textAlign: "left",
            fontFamily: FONT.sans, fontSize: 13, fontWeight: 600,
            display: "flex", alignItems: "center", gap: 10,
          }}
        >
          <span style={{ flex: 1 }}>{tr("broker.ai.cta", lang)}</span>
          <span style={{
            padding: "2px 8px", borderRadius: 999,
            background: T.accent, color: "#06180c",
            fontFamily: FONT.sans, fontSize: 10, fontWeight: 700, letterSpacing: 0.6,
          }}>IA</span>
        </button>
      )}

      {/* Loading — inline spinner row, no nested card. */}
      {busy && (
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          color: T.textMute, fontFamily: FONT.sans, fontSize: 13,
          padding: "8px 0",
        }}>
          <div style={{
            width: 18, height: 18, borderRadius: 999,
            border: `2.4px solid ${T.border}`, borderTopColor: T.accent,
            animation: "samas-spin 800ms linear infinite", flexShrink: 0,
          }} />
          {tr("broker.ai.thinking", lang)}
        </div>
      )}

      {/* Error */}
      {err && !busy && (
        <div style={{
          padding: "10px 12px", borderRadius: 12,
          background: T.dangerSoft, color: T.danger,
          fontFamily: FONT.sans, fontSize: 12, lineHeight: 1.5,
        }}>{err}</div>
      )}

      {/* Result body — also inline (no nested card). Headline → bullets
          → thesis → disclaimer. */}
      {data && !busy && (
        <>
          <div style={{
            fontFamily: FONT.sans, fontSize: 14, fontWeight: 700,
            color: T.text, lineHeight: 1.4, marginBottom: 10,
          }}>{data.headline}</div>
          {Array.isArray(data.bullets) && data.bullets.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              {data.bullets.map((b, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "flex-start", gap: 10,
                  padding: "8px 0",
                  borderTop: i === 0 ? "none" : `1px solid ${T.border}`,
                }}>
                  {/* Smaller dot (8px) with 6px top offset → centers on
                      the first line of 13px text (line-height ~1.5 = 19px,
                      midpoint ~9px from top; dot top:6 + radius:4 = 10).
                      Old 14px dot with margin:4 sat 4px below text center. */}
                  <span style={{
                    width: 8, height: 8, marginTop: 6, flexShrink: 0,
                    borderRadius: 4, background: T.accent,
                  }} />
                  <div style={{
                    fontFamily: FONT.sans, fontSize: 13, color: T.text, lineHeight: 1.5,
                  }}>{b}</div>
                </div>
              ))}
            </div>
          )}
          {data.thesis && (
            <div style={{
              padding: "10px 12px", borderRadius: 12,
              background: `linear-gradient(135deg, ${T.accentSoft}, transparent 80%)`,
              border: `1.5px solid ${T.accent}`,
            }}>
              <div style={{
                fontFamily: FONT.sans, fontSize: 10, fontWeight: 700,
                color: T.accent, letterSpacing: 0.6, textTransform: "uppercase",
                marginBottom: 4,
              }}>{tr("broker.ai.thesis", lang)}</div>
              <div style={{
                fontFamily: FONT.sans, fontSize: 13, color: T.text, lineHeight: 1.5,
              }}>{data.thesis}</div>
            </div>
          )}
          <div style={{
            marginTop: 10, fontFamily: FONT.sans, fontSize: 10,
            color: T.textMute, textAlign: "right",
          }}>
            {tr("broker.ai.disclaimer", lang)}
          </div>
        </>
      )}
    </div>
  );
}

function FundamentalsCard({ T, asset, lang = "es" }) {
  const data = useMemo(() => {
    const rng = tickerSeed(asset.ticker, 7);
    const isCedearOrAccion = asset.category === "CEDEAR" || asset.category === "ACCION";
    const isCrypto = asset.category === "CRYPTO";
    const isBono = asset.category === "BONO";
    const pe = isCedearOrAccion ? (10 + rng() * 30).toFixed(1) : "—";
    const eps = isCedearOrAccion
      ? `${asset.currency === "ARS" ? "$" : "US$"}${(asset.price / (15 + rng() * 20)).toFixed(2)}`
      : "—";
    const sharesOut = isCrypto
      ? 19_000_000 + rng() * 100_000_000  // crypto "supply" approximation
      : 1e8 + rng() * 5e10;               // equity shares outstanding
    const mcap = asset.price * sharesOut;
    const divYield = isCedearOrAccion
      ? `${(rng() * 4).toFixed(2)}%`
      : isBono ? `${(8 + rng() * 6).toFixed(2)}%`
      : "—";
    const vol = isCrypto
      ? rng() * 5e10
      : (1e6 + rng() * 5e7);
    const ccySym = asset.currency === "ARS" ? "$" : "US$";
    return [
      { label: tr("pro.asset.fund.pe",    lang), value: pe },
      { label: tr("pro.asset.fund.eps",   lang), value: eps },
      { label: tr("pro.asset.fund.mcap",  lang), value: `${ccySym}${fmtCompactNumber(mcap)}` },
      { label: tr("pro.asset.fund.div",   lang), value: divYield },
      { label: tr("pro.asset.fund.vol",   lang), value: `${ccySym}${fmtCompactNumber(vol)}` },
      { label: "Sector",                          value: asset.category || "—" },
    ];
  }, [asset.ticker, asset.price, asset.currency, asset.category, lang]);
  return (
    <div style={{
      margin: "0 0 18px",
      padding: "14px 16px 12px", borderRadius: 18,
      background: T.surface, border: `1px solid ${T.border}`,
    }}>
      <div style={{
        fontFamily: FONT.mono, fontSize: 11, fontWeight: 700,
        color: T.textMute, letterSpacing: 0.4, textTransform: "uppercase",
        marginBottom: 10,
      }}>{tr("pro.asset.fund.title", lang)}</div>
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        rowGap: 10, columnGap: 16,
      }}>
        {data.map((d) => (
          <div key={d.label} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{
              fontFamily: FONT.sans, fontSize: 11, color: T.textMute,
            }}>{d.label}</div>
            <div style={{
              fontFamily: FONT.mono, fontSize: 14, fontWeight: 700, color: T.text,
              fontVariantNumeric: "tabular-nums",
            }}>{d.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// PRO PORTFOLIO DASHBOARD (samas-0.0.42)
// ============================================================
// Three new visual cards that only render when proMode is on.
// All three are pure-JS / inline-SVG with no external chart deps:
//
//   1. SectorDonut       — composition by category (CEDEAR / Cripto / …).
//   2. RiskMetricsRow    — Beta · Volatilidad 30d · Sharpe.
//   3. BenchmarkLine     — your cartera vs MERVAL or S&P 500 over 30d.
//
// The numbers in (2) and (3) are derived from holdings + their
// categories so they shift with the user's actual portfolio. They're
// not pulled from a live risk feed — when we onboard with Cohen and
// get real backing for these stats, swap each helper's body for an
// API call. The visual shape (and the data shape it consumes) won't
// change.
// ============================================================

// Stable color per category. Keep in sync with the SECTOR labels in
// i18n above and the CATEGORY enum in api/broker.js.
const SECTOR_COLORS = {
  CEDEAR: "#7C5CFF",
  ACCION: "#16C784",
  CRYPTO: "#F59E0B",
  BONO:   "#06B6D4",
  ETF:    "#EC4899",
  COMMOD: "#A855F7",
};
const SECTOR_LABEL_KEYS = {
  CEDEAR: "pro.sector.cedear",
  ACCION: "pro.sector.accion",
  CRYPTO: "pro.sector.crypto",
  BONO:   "pro.sector.bono",
  ETF:    "pro.sector.etf",
  COMMOD: "pro.sector.commod",
};

function SectorDonut({ T, holdings, totalUsd, lang = "es" }) {
  // Bucket holdings by category, summing their USD-equivalent value.
  // We approximate the ARS→USD conversion with a fixed MEP rate so we
  // don't depend on the fx prop being stable on first paint; the
  // resulting % is virtually identical (within 1pp) to using live MEP.
  const groups = useMemo(() => {
    const g = {};
    for (const h of holdings || []) {
      const valUsd = h.currency === "ARS" ? (h.value / 1248) : h.value;
      const cat = h.category || "ETF";
      g[cat] = (g[cat] || 0) + valUsd;
    }
    const rows = Object.entries(g).map(([cat, v]) => ({
      cat,
      pct: totalUsd ? (v / totalUsd) * 100 : 0,
      value: v,
      color: SECTOR_COLORS[cat] || "#999",
      label: tr(SECTOR_LABEL_KEYS[cat] || "pro.sector.etf", lang),
    }));
    rows.sort((a, b) => b.pct - a.pct);
    return rows;
  }, [holdings, totalUsd, lang]);
  if (groups.length === 0) return null;

  // Donut math — accumulate each slice as an SVG arc path. Center
  // (60,60), outer radius 50, inner radius 30 for the hole. We start
  // at 12 o'clock (-90°) so the largest slice opens to the right.
  const size = 120;
  const cx = size / 2, cy = size / 2;
  const rOuter = 50, rInner = 30;
  let cursor = -Math.PI / 2;
  const arcs = groups.map((g) => {
    const angle = (g.pct / 100) * Math.PI * 2;
    const start = cursor;
    const end = cursor + angle;
    cursor = end;
    // Special case: one slice fills the whole donut → SVG can't
    // render a 360° arc as a single path, so we fake it with two
    // half-arcs concatenated. Practical case: a fresh user with one
    // CEDEAR holding.
    const large = angle > Math.PI ? 1 : 0;
    const x1 = cx + rOuter * Math.cos(start), y1 = cy + rOuter * Math.sin(start);
    const x2 = cx + rOuter * Math.cos(end),   y2 = cy + rOuter * Math.sin(end);
    const x3 = cx + rInner * Math.cos(end),   y3 = cy + rInner * Math.sin(end);
    const x4 = cx + rInner * Math.cos(start), y4 = cy + rInner * Math.sin(start);
    const d = angle >= Math.PI * 1.999
      ? `M ${cx + rOuter} ${cy} A ${rOuter} ${rOuter} 0 1 1 ${cx - rOuter} ${cy} A ${rOuter} ${rOuter} 0 1 1 ${cx + rOuter} ${cy} M ${cx + rInner} ${cy} A ${rInner} ${rInner} 0 1 0 ${cx - rInner} ${cy} A ${rInner} ${rInner} 0 1 0 ${cx + rInner} ${cy} Z`
      : `M ${x1} ${y1} A ${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${rInner} ${rInner} 0 ${large} 0 ${x4} ${y4} Z`;
    return { ...g, d };
  });
  const top = groups[0];
  return (
    <div style={{ margin: "0 16px 20px" }}>
      <SectionHead T={T} title={tr("pro.sector.title", lang)} />
      <div style={{
        marginTop: 12, padding: 14, borderRadius: 18,
        background: T.surface, border: `1px solid ${T.border}`,
        display: "flex", alignItems: "center", gap: 16,
      }}>
        <svg width={size} height={size} style={{ flexShrink: 0 }}>
          {arcs.map((a) => (
            <path key={a.cat} d={a.d} fill={a.color} fillRule="evenodd" />
          ))}
          {/* Center label — top sector + its % */}
          <text x={cx} y={cy - 3} textAnchor="middle"
            fontFamily={FONT.mono} fontSize={9} fontWeight={700} fill={T.textMute}>
            {top?.label || ""}
          </text>
          <text x={cx} y={cy + 11} textAnchor="middle"
            fontFamily={FONT.display} fontSize={14} fontWeight={800} fill={T.text}>
            {top?.pct.toFixed(0)}%
          </text>
        </svg>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          {groups.map((g) => (
            <div key={g.cat} style={{
              display: "flex", alignItems: "center", gap: 8,
              fontFamily: FONT.sans, fontSize: 12,
            }}>
              <span style={{
                width: 10, height: 10, borderRadius: 3, background: g.color,
                flexShrink: 0,
              }}/>
              <span style={{ color: T.text, fontWeight: 600, flex: 1 }}>{g.label}</span>
              <span style={{ color: T.textMute, fontFamily: FONT.mono, fontVariantNumeric: "tabular-nums" }}>
                {g.pct.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------
// RiskMetricsRow — three numeric cards (Beta · Vol · Sharpe).
// Tap a card → flips to show the explanation. Numbers derived from
// holdings + sector mix so they move with the user's portfolio.
// ----------------------------------------------------------
function RiskMetricsRow({ T, holdings, totalUsd, lang = "es" }) {
  // Per-category risk parameters. Loosely calibrated: CRYPTO is
  // very volatile + high beta, BONOs are low. Real values would come
  // from a market-data provider.
  const RISK_PARAMS = {
    CEDEAR: { beta: 1.05, vol: 0.22 },
    ACCION: { beta: 1.20, vol: 0.34 },
    CRYPTO: { beta: 1.85, vol: 0.78 },
    BONO:   { beta: 0.20, vol: 0.10 },
    ETF:    { beta: 1.00, vol: 0.15 },
    COMMOD: { beta: 0.65, vol: 0.20 },
  };
  const metrics = useMemo(() => {
    if (!holdings || holdings.length === 0 || !totalUsd) {
      return { beta: 0, vol: 0, sharpe: 0 };
    }
    let beta = 0;
    let vol = 0;
    for (const h of holdings) {
      const valUsd = h.currency === "ARS" ? (h.value / 1248) : h.value;
      const w = valUsd / totalUsd;
      const p = RISK_PARAMS[h.category] || RISK_PARAMS.ETF;
      beta += w * p.beta;
      // Variance (vol²) sums weighted, square-root for vol. Real
      // calc would need correlation matrix; this simplification is
      // close enough for a dashboard widget.
      vol += w * w * p.vol * p.vol;
    }
    vol = Math.sqrt(vol);
    // Mocked annualized return derived from holdings' gain%, capped
    // so a single moonshot doesn't spike Sharpe to absurd values.
    const annualReturn = Math.max(-0.5, Math.min(0.6,
      holdings.reduce((s, h) => {
        const valUsd = h.currency === "ARS" ? (h.value / 1248) : h.value;
        const w = valUsd / totalUsd;
        return s + w * ((h.gainPct || 0) / 100);
      }, 0) * 4 // rough annualization from a 90d snapshot
    ));
    const riskFree = 0.04; // 4% nominal risk-free baseline
    const sharpe = vol > 0 ? (annualReturn - riskFree) / vol : 0;
    return {
      beta: Number.isFinite(beta) ? beta : 0,
      vol: Number.isFinite(vol) ? vol : 0,
      sharpe: Number.isFinite(sharpe) ? sharpe : 0,
    };
  }, [holdings, totalUsd]);

  const [opened, setOpened] = useState(null); // "beta" | "vol" | "sharpe" | null
  const cards = [
    { id: "beta",   label: tr("pro.risk.beta",   lang), value: metrics.beta.toFixed(2), help: tr("pro.risk.beta_help", lang) },
    { id: "vol",    label: tr("pro.risk.vol",    lang), value: `${(metrics.vol * 100).toFixed(1)}%`, help: tr("pro.risk.vol_help", lang) },
    { id: "sharpe", label: tr("pro.risk.sharpe", lang), value: metrics.sharpe.toFixed(2), help: tr("pro.risk.sharpe_help", lang) },
  ];
  return (
    <div style={{ margin: "0 16px 20px" }}>
      <SectionHead T={T} title={tr("pro.risk.title", lang)} />
      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        {cards.map((c) => (
          <button
            key={c.id}
            onClick={() => setOpened(opened === c.id ? null : c.id)}
            style={{
              flex: 1, padding: "12px 10px", borderRadius: 14,
              background: T.surface, border: `1px solid ${T.border}`,
              color: T.text, cursor: "pointer", textAlign: "left",
              display: "flex", flexDirection: "column", gap: 4,
              minWidth: 0,
            }}
          >
            <div style={{
              fontFamily: FONT.mono, fontSize: 10, fontWeight: 700,
              color: T.textMute, letterSpacing: 0.4, textTransform: "uppercase",
            }}>{c.label}</div>
            <div style={{
              fontFamily: FONT.display, fontSize: 20, fontWeight: 700, color: T.text,
              fontVariantNumeric: "tabular-nums", letterSpacing: -0.4,
            }}>{c.value}</div>
          </button>
        ))}
      </div>
      {opened && (
        <div style={{
          marginTop: 8, padding: "10px 12px", borderRadius: 12,
          background: T.bg, border: `1px solid ${T.border}`,
          fontFamily: FONT.sans, fontSize: 12, color: T.textMute, lineHeight: 1.45,
        }}>
          {cards.find((c) => c.id === opened)?.help}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------
// BenchmarkLine — your cartera vs MERVAL/S&P500 over 30 days.
// Two stacked polylines normalized to [0,1] so visual comparison
// shows direction + magnitude despite different absolute scales.
// ----------------------------------------------------------
function BenchmarkLine({ T, holdings, totalUsd, lang = "es" }) {
  // Pick a benchmark: AR-heavy portfolios get MERVAL, US-heavy get
  // S&P. We default to MERVAL when the user hasn't bought anything.
  const [benchKey, setBenchKey] = useState(() => {
    if (!holdings || holdings.length === 0) return "merval";
    const arsExposure = holdings.reduce((s, h) => {
      const valUsd = h.currency === "ARS" ? (h.value / 1248) : 0;
      return s + valUsd;
    }, 0);
    return totalUsd && (arsExposure / totalUsd) > 0.4 ? "merval" : "spx";
  });

  // Mock 30-day series. We seed from the holdings hash so the line
  // doesn't reshuffle on every re-render but does change between
  // different portfolios. Same approach for the benchmark series.
  const { youSeries, benchSeries, youReturn, benchReturn } = useMemo(() => {
    const N = 30;
    // Stable seed so the line is consistent across renders.
    const seed = (holdings || []).reduce((s, h) => s + h.qty * (h.ticker.charCodeAt(0) || 1), 7);
    function rng(i) {
      // Mulberry32-ish: deterministic but spread-y enough that the
      // line looks like real noise.
      const x = Math.sin(seed * (i + 1) * 12.9898) * 43758.5453;
      return x - Math.floor(x);
    }
    function buildSeries(targetReturn, vol) {
      // Produce N daily prices starting at 100, ending close to
      // 100 * (1 + targetReturn). vol controls daily noise.
      const out = [100];
      const dailyDrift = targetReturn / N;
      for (let i = 1; i < N; i++) {
        const noise = (rng(i) - 0.5) * vol;
        out.push(out[i - 1] * (1 + dailyDrift + noise));
      }
      return out;
    }
    // Sum the user's last-30d return as a weighted avg of holding
    // gainPct. This is the same number we'd show in the green pill
    // on the portfolio card, just normalized.
    const userReturn = (() => {
      if (!totalUsd || !holdings) return 0;
      let r = 0;
      for (const h of holdings) {
        const valUsd = h.currency === "ARS" ? (h.value / 1248) : h.value;
        const w = valUsd / totalUsd;
        r += w * ((h.gainPct || 0) / 100);
      }
      // The card's pill says +2.34% — synthesize a 30d return that
      // tracks the same direction but is bounded so we don't end up
      // with a flat or absurd line.
      return Math.max(-0.18, Math.min(0.20, r * 0.5 + 0.0234));
    })();
    const bench = benchKey === "merval"
      ? { ret: 0.012, vol: 0.018 }   // MERVAL: ~1.2% over 30d, choppy
      : { ret: 0.018, vol: 0.011 };  // SPX: ~1.8%, smoother
    const youS = buildSeries(userReturn, 0.012);
    const benchS = buildSeries(bench.ret, bench.vol);
    return {
      youSeries: youS,
      benchSeries: benchS,
      youReturn: userReturn,
      benchReturn: bench.ret,
    };
  }, [holdings, totalUsd, benchKey]);

  // SVG layout — full-width, fixed 110px tall. Both series share
  // the same y-range (combined min/max) so the visual height
  // difference == real performance difference.
  const w = 320, h = 110;
  const allPts = [...youSeries, ...benchSeries];
  const min = Math.min(...allPts);
  const max = Math.max(...allPts);
  const range = max - min || 1;
  function path(series) {
    return series.map((v, i) => {
      const x = (i / (series.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(" ");
  }
  const youColor = T.accent;
  const benchColor = T.textMute;
  return (
    <div style={{ margin: "0 16px 20px" }}>
      <div style={{
        display: "flex", alignItems: "baseline", justifyContent: "space-between",
        marginBottom: 8, padding: "0 4px",
      }}>
        <div style={{
          fontFamily: FONT.sans, fontSize: 13, fontWeight: 700,
          color: T.text, letterSpacing: -0.2,
        }}>{tr("pro.bench.title", lang)}</div>
        {/* MERVAL / S&P toggle */}
        <div style={{
          display: "flex", gap: 4, padding: 3,
          background: T.bg, border: `1px solid ${T.border}`, borderRadius: 999,
        }}>
          {["merval", "spx"].map((k) => (
            <button key={k} onClick={() => setBenchKey(k)} style={{
              padding: "3px 10px", borderRadius: 999, border: "none", cursor: "pointer",
              background: benchKey === k ? T.accent : "transparent",
              color: benchKey === k ? T.accentInk : T.textMute,
              fontFamily: FONT.mono, fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
            }}>{tr(k === "merval" ? "pro.bench.merval" : "pro.bench.spx", lang)}</button>
          ))}
        </div>
      </div>
      <div style={{
        padding: "12px 14px 14px", borderRadius: 18,
        background: T.surface, border: `1px solid ${T.border}`,
      }}>
        <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none">
          <path d={path(benchSeries)} fill="none" stroke={benchColor}
            strokeWidth={1.4} strokeDasharray="3 3" opacity={0.7} />
          <path d={path(youSeries)} fill="none" stroke={youColor}
            strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div style={{
          marginTop: 10, display: "flex", justifyContent: "space-between",
          fontFamily: FONT.sans, fontSize: 11,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 16, height: 2.5, background: youColor, borderRadius: 2 }}/>
            <span style={{ color: T.textMute }}>{tr("pro.bench.you", lang)}</span>
            <span style={{
              color: youReturn >= 0 ? T.accent : T.danger,
              fontFamily: FONT.mono, fontWeight: 700,
            }}>{youReturn >= 0 ? "+" : ""}{(youReturn * 100).toFixed(2)}%</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {/* Dashed line legend marker — render as 4 small segments
                of a 1px-tall span using a repeating linear-gradient,
                which is the iOS-WebKit-friendly way to fake a dashed
                inline rule without abusing borderTop on a 0-height
                element (which the browser ignored, leaving the
                legend without a visible marker). */}
            <span style={{
              width: 16, height: 0,
              borderTop: `2px dashed ${benchColor}`,
              opacity: 0.7,
              flexShrink: 0,
            }}/>
            <span style={{ color: T.textMute }}>
              {tr(benchKey === "merval" ? "pro.bench.merval" : "pro.bench.spx", lang)}
            </span>
            <span style={{
              color: benchReturn >= 0 ? T.accent : T.danger,
              fontFamily: FONT.mono, fontWeight: 700,
            }}>{benchReturn >= 0 ? "+" : ""}{(benchReturn * 100).toFixed(2)}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------------
// TopMovers — top 3 winners + top 3 losers across the asset universe.
// LIVE-SORTED: re-orders every tick using each asset's session
// drift on top of its baseline daily change. Ranks shuffle visibly
// during a Cohen demo when one asset breaks out of its band, which
// is exactly the "alive market" feel we want.
// Tapping a row opens the AssetSheet for that ticker.
// ----------------------------------------------------------
function TopMovers({ T, assets, onSelectAsset }) {
  const ctx = useContext(LivePricesContext);

  // Make sure every asset is registered so it ticks even if the
  // Mercado list isn't currently mounted (TopMovers can render in
  // PortafolioView without Mercado below it).
  useEffect(() => {
    if (!ctx) return;
    for (const a of assets) {
      if (a?.ticker && typeof a.price === "number" && a.price > 0) {
        ctx.register(a.ticker, a.price);
      }
    }
  }, [ctx, assets]);

  const tickCount = ctx?.tickCount ?? 0;

  // Compose each asset's display delta from its baseline daily
  // change + the session-drift since launch. Recomputes every tick
  // because tickCount is in the deps, which makes the sort move.
  const ranked = useMemo(() => {
    const enriched = assets.map((a) => {
      const live = ctx?.get(a.ticker);
      const livePrice = live?.price ?? a.price;
      const sessionPct = a.price > 0 ? ((livePrice - a.price) / a.price) * 100 : 0;
      const compositeDelta = (a.changePct || 0) + sessionPct;
      return { ...a, livePrice, compositeDelta, tickSign: live?.sign ?? "flat" };
    });
    return enriched.sort((a, b) => b.compositeDelta - a.compositeDelta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets, ctx, tickCount]);

  const winners = ranked.slice(0, 3);
  const losers = ranked.slice(-3).reverse();

  return (
    <div style={{ margin: "8px 16px 0" }}>
      <SectionHead T={T} title="Top del día" />
      <div style={{
        marginTop: 12, padding: 4, borderRadius: 18,
        background: T.surface, border: `1px solid ${T.border}`,
      }}>
        <MoverGroup T={T} label="Ganadores" rows={winners} positive tickCount={tickCount} onSelectAsset={onSelectAsset} />
        <div style={{ height: 1, background: T.border, margin: "0 12px" }}/>
        <MoverGroup T={T} label="Perdedores" rows={losers} positive={false} tickCount={tickCount} onSelectAsset={onSelectAsset} />
      </div>
    </div>
  );
}

function MoverGroup({ T, label, rows, positive, tickCount, onSelectAsset }) {
  return (
    <div style={{ padding: "10px 12px" }}>
      <div style={{
        fontFamily: FONT.sans, fontSize: 11, color: T.textMute, fontWeight: 600,
        letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 8,
      }}>{label}</div>
      {rows.map((a) => {
        const cur = a.currency === "ARS" ? "$" : "US$";
        // Sign for the flash animation — derived from this row's
        // last tick direction, scoped per row so different assets
        // can flash green/red simultaneously without crosstalk.
        const flashSign = a.tickSign && a.tickSign !== "flat" ? a.tickSign : null;
        return (
          <button key={a.ticker} onClick={() => onSelectAsset(a)} style={{
            width: "100%", padding: "8px 4px", background: "transparent",
            border: "none", cursor: "pointer", display: "flex",
            alignItems: "center", justifyContent: "space-between", gap: 10,
          }}>
            <div style={{ textAlign: "left", minWidth: 0, flex: 1 }}>
              <div style={{ fontFamily: FONT.sans, fontSize: 13, fontWeight: 700, color: T.text }}>{a.ticker}</div>
              <div style={{
                fontFamily: FONT.sans, fontSize: 11, color: T.textMute,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>{a.name}</div>
            </div>
            <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              <div
                key={`p-${tickCount}`}
                style={{
                  fontFamily: FONT.mono, fontSize: 12, fontWeight: 700, color: T.text,
                  display: "inline-block",
                  borderRadius: 4, padding: "0 4px", margin: "0 -4px",
                  ...(flashSign
                    ? { animation: `samas-tick-${flashSign} 600ms ease-out` }
                    : {}),
                }}
              >{cur}{fmtMoney(a.livePrice, a.currency)}</div>
              <div style={{
                fontFamily: FONT.mono, fontSize: 11, fontWeight: 700,
                color: positive ? T.accent : T.danger,
              }}>{fmtPct(a.compositeDelta)}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// Loader removed in 0.0.65 — replaced everywhere by AssetRowSkeletonList
// (and the skeleton composites in shared.jsx). Left this comment as a
// breadcrumb so anyone grepping for "Cargando" in Broker.jsx sees why
// it's gone.

// Empty state — icon + title + subtitle + optional CTA. Used wherever
// a list comes back with zero rows. icon defaults to an "open box"
// glyph; pass a different node (Ico.X) to override per surface.
function Empty({ T, title, subtitle, icon, ctaLabel, onCta }) {
  const defaultIcon = (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
      <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
      <line x1="12" y1="22.08" x2="12" y2="12"/>
    </svg>
  );
  return (
    <div style={{
      margin: "0 16px", padding: "36px 24px", borderRadius: 22,
      background: T.surface, border: `1px solid ${T.border}`,
      textAlign: "center",
      display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: 16,
        background: T.bg, border: `1px solid ${T.border}`,
        color: T.textMute,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>{icon || defaultIcon}</div>
      <div>
        <div style={{ fontFamily: FONT.display, fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 4 }}>{title}</div>
        {subtitle && (
          <div style={{ fontFamily: FONT.sans, fontSize: 13, color: T.textMute, lineHeight: 1.5, maxWidth: 320, margin: "0 auto" }}>{subtitle}</div>
        )}
      </div>
      {ctaLabel && onCta && (
        <button onClick={onCta} style={{
          marginTop: 4, padding: "10px 18px", borderRadius: 999,
          background: T.accent, color: T.accentInk, border: "none",
          fontFamily: FONT.sans, fontSize: 13, fontWeight: 700, cursor: "pointer",
        }}>{ctaLabel}</button>
      )}
    </div>
  );
}

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i);
  return Math.abs(h);
}

function NumberInput({ T, label, value, onChange, placeholder, prefix }) {
  // Always numeric keyboard. Sign (when applicable) is selected via a
  // separate pill toggle in the parent — much better UX than typing "-"
  // on iOS, which forces the QWERTY keyboard.
  const sanitize = (raw) => raw.replace(/[^\d.,]/g, "").replace(",", ".");
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontFamily: FONT.sans, fontSize: 11, color: T.textMute, marginBottom: 6, letterSpacing: 0.4 }}>{label}</div>
      <div style={{
        display: "flex", alignItems: "center",
        background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14,
        overflow: "hidden",
      }}>
        {prefix && (
          <div style={{
            paddingLeft: 14, paddingRight: 6,
            fontFamily: FONT.mono, fontSize: 18, fontWeight: 700, color: T.textMute,
          }}>{prefix}</div>
        )}
        <input
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(sanitize(e.target.value))}
          onFocus={(e) => {
            // Scroll into view so the iOS keyboard doesn't cover the
            // field when it pops up. 320ms gives the keyboard animation
            // a moment so we measure the post-resize viewport.
            const el = e.target;
            setTimeout(() => {
              try { el.scrollIntoView({ block: "center", behavior: "smooth" }); } catch {}
            }, 320);
          }}
          placeholder={placeholder}
          style={{
            flex: 1, boxSizing: "border-box",
            padding: prefix ? "14px 16px 14px 4px" : "14px 16px",
            background: "transparent", border: "none",
            color: T.text, fontFamily: FONT.mono, fontSize: 18, fontWeight: 600,
            outline: "none",
          }}
        />
      </div>
    </label>
  );
}
