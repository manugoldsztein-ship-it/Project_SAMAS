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

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { FONT, fmtMoney, fmtPct } from "./theme.js";
import { Ico } from "./icons.jsx";
import { Pill, SectionHead, Sparkline, SAMAS_SPARKS } from "./shared.jsx";
import { broker as brokerApi } from "./api/index.js";
// The Objetivos wizard is shared with the legacy MobileApp UI. It
// expects a legacy-shape theme `C`, so we pass an adapter built from
// the v2 theme `T` to keep its visual language in sync with the new UI.
import { ObjectivesWizard } from "../ai/ObjectivesWizard.jsx";

// Sub-tabs metadata — drives both the bottom nav and the content
// switch in the top-level <BrokerShell/> render.
const SUB_TABS = [
  { id: "portafolio", label: "Portafolio", icon: Ico.Briefcase },
  { id: "mercado",    label: "Mercado",    icon: Ico.Chart },
  { id: "watchlist",  label: "Watchlist",  icon: Ico.Star },
  { id: "ordenes",    label: "Órdenes",    icon: Ico.List },
];

// ----------------------------------------------------------
// Top-level BrokerShell — replaces the main Shell entirely while
// the user is inside Invertir.
// ----------------------------------------------------------
export function BrokerShell({ T, isNativeApp = false, onBack, proMode = true }) {
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
    try {
      const [p, a, wl, o, al, st, f] = await Promise.all([
        brokerApi.getPortfolio(),
        brokerApi.getAssets(),
        brokerApi.getWatchlists(),
        brokerApi.getOrders({ status: "all" }),
        brokerApi.getPriceAlerts(),
        brokerApi.getStopLosses(),
        brokerApi.getFx(),
      ]);
      setPortfolio(p); setAssets(a); setWatchlists(wl); setOrders(o);
      setAlerts(al); setStops(st); setFx(f);
    } catch (e) { console.error("[broker] load:", e); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Sub-nav bottom inset same logic as main shell — float 12px above
  // the home-indicator zone.
  const navBottom = isNativeApp
    ? "calc(env(safe-area-inset-bottom) + 12px)"
    : 12;

  return (
    <div style={{
      position: "absolute", inset: 0,
      background: T.bg, color: T.text,
      overflow: "hidden",
      display: "flex", flexDirection: "column",
      fontFamily: FONT.sans,
    }}>
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
        <div style={{ flex: 1 }}>
          <div style={{
            fontFamily: FONT.display, fontSize: 22, fontWeight: 700,
            color: T.text, letterSpacing: -0.4,
          }}>Invertir</div>
          <div style={{ fontFamily: FONT.sans, fontSize: 12, color: T.textMute }}>
            {SUB_TABS.find((t) => t.id === tab)?.label}
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
      <div style={{
        flex: 1, overflowY: "auto",
        overscrollBehavior: "contain",
        WebkitOverflowScrolling: "touch",
      }}>
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
          />
        )}
        {tab === "mercado" && (
          <MercadoView T={T} assets={assets} ccy={ccy} setCcy={setCcy} onSelectAsset={setSelectedAsset} />
        )}
        {tab === "watchlist" && (
          <WatchlistView T={T} watchlists={watchlists} assets={assets} onSelectAsset={setSelectedAsset} onRefresh={refresh} />
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

      {/* ---------- sub-nav bottom bar ----------
          Hidden while the keyboard is open so it doesn't sit on top of
          modal buttons (Cancelar / Guardar) when typing. */}
      {!keyboardOpen && (
        <SubNav T={T} tab={tab} setTab={setTab} bottomInset={navBottom} />
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
function SubNav({ T, tab, setTab, bottomInset }) {
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
            <span>{t.label}</span>
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
function PortafolioView({ T, portfolio, assets, fx, ccy, setCcy, onSelectAsset, onOpenAIPlan, savedPlan, proMode = true }) {
  if (!portfolio) return <Loader T={T}/>;

  const ccySym = ccy === "ARS" ? "$" : "US$";
  const total = ccy === "ARS" ? portfolio.totalArs : portfolio.totalUsd;

  return (
    <div style={{ paddingBottom: 110 }}>
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
            }}>VALOR DE CARTERA</div>
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
            <Pill T={T}>30 días</Pill>
          </div>
          {fx && (
            <div style={{
              marginTop: 12, fontFamily: FONT.mono, fontSize: 11, color: T.textMute,
              fontVariantNumeric: "tabular-nums",
            }}>
              MEP ${fx.mep.value.toFixed(0)} · CCL ${fx.ccl.value.toFixed(0)} · Oficial ${fx.oficial.value.toFixed(0)}
            </div>
          )}
        </div>
      </div>

      {/* AI Plan card — links to the goal-planning wizard. Always
          shown so the user can find the wizard regardless of mode.
          When the user already has a saved plan, the card morphs into
          a summary of their strategy + target. */}
      <AIPlanCard T={T} onOpen={onOpenAIPlan} savedPlan={savedPlan} />

      {/* Distribución bar — % per holding of total cartera. Only in
          Pro mode (gated by the settings toggle). */}
      {proMode && portfolio.holdings.length > 0 && (
        <DistribucionBar T={T} holdings={portfolio.holdings} totalUsd={portfolio.totalUsd} />
      )}

      {/* holdings */}
      <div style={{ margin: "0 16px 16px" }}>
        <SectionHead T={T} title="Mis posiciones" action={`${portfolio.holdings.length} activos`} />
      </div>
      {portfolio.holdings.length === 0 ? (
        <Empty T={T}
          title="Aún no tenés posiciones"
          subtitle="Tocá Mercado para ver activos disponibles y hacer tu primera compra."
        />
      ) : (
        <div style={{ margin: "0 16px" }}>
          {portfolio.holdings.map((h, i) => (
            <AssetRow
              key={h.ticker}
              T={T}
              asset={h}
              subline={`${h.qty} u · prom. ${h.currency === "ARS" ? "$" : "US$"}${fmtMoney(h.avgCost, h.currency)}`}
              rightTop={`${h.currency === "ARS" ? "$" : "US$"}${fmtMoney(h.value, h.currency)}`}
              rightBottom={fmtPct(h.gainPct)}
              rightBottomColor={h.gainPct >= 0 ? T.accent : T.danger}
              isLast={i === portfolio.holdings.length - 1}
              onClick={() => onSelectAsset(h)}
            />
          ))}
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
function MercadoView({ T, assets, onSelectAsset }) {
  const [cat, setCat] = useState("Todas");
  const [query, setQuery] = useState("");
  const [showCompare, setShowCompare] = useState(false);
  const cats = useMemo(() => {
    const s = new Set(assets.map((a) => a.category));
    return ["Todas", ...Array.from(s)];
  }, [assets]);

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
    if (cat !== "Todas") rows = rows.filter((a) => a.category === cat);
    return rows;
  }, [assets, cat, query]);

  if (assets.length === 0) return <Loader T={T}/>;

  return (
    <div style={{ paddingBottom: 110 }}>
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
            placeholder="Buscar por ticker o nombre"
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
      <div style={{ margin: "0 16px" }}>
        {filtered.length === 0 ? (
          <Empty T={T} title="Sin resultados" subtitle={`No encontramos activos para "${query}".`} />
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

  return (
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
                <div style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: tileForCategory(a.category),
                  fontFamily: FONT.mono, fontSize: 9, fontWeight: 800, color: "#06170D",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  marginBottom: 8,
                }}>{a.ticker.slice(0,4)}</div>
                <div style={{ fontFamily: FONT.sans, fontSize: 13, fontWeight: 700, color: T.text }}>{a.ticker}</div>
                <div style={{ fontFamily: FONT.sans, fontSize: 10, color: T.textMute, marginBottom: 8 }}>{a.category}</div>
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
                width: "100%", padding: "8px 4px", background: "transparent",
                border: "none", borderBottom: `1px solid ${T.border}`,
                display: "flex", alignItems: "center", gap: 10,
                cursor: "pointer", textAlign: "left",
              }}>
                <div style={{
                  width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                  background: tileForCategory(a.category),
                  fontFamily: FONT.mono, fontSize: 9, fontWeight: 800, color: "#06170D",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>{a.ticker.slice(0,4)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: FONT.sans, fontSize: 13, fontWeight: 700, color: T.text }}>{a.ticker}</div>
                  <div style={{
                    fontFamily: FONT.sans, fontSize: 11, color: T.textMute,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{a.name}</div>
                </div>
                <div style={{ fontFamily: FONT.mono, fontSize: 11, color: a.changePct >= 0 ? T.accent : T.danger }}>
                  {fmtPct(a.changePct)}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
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
function WatchlistView({ T, watchlists, assets, onSelectAsset, onRefresh }) {
  // Selected list ID. Default to the first one; if it gets deleted
  // we fall back to whichever is now first.
  const [selectedId, setSelectedId] = useState(null);
  const [modal, setModal] = useState(null); // "create" | "rename" | "confirm-delete" | null

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
      <div style={{ paddingBottom: 110, padding: 16 }}>
        <Empty T={T} title="Sin listas"
          subtitle="Creá tu primera lista para seguir activos."
        />
        <button onClick={() => setModal("create")} style={{
          width: "100%", marginTop: 12, padding: 14, borderRadius: 14,
          background: T.accent, color: T.accentInk,
          fontFamily: FONT.sans, fontSize: 14, fontWeight: 700, border: "none",
          cursor: "pointer",
        }}>+ Crear lista</button>
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
    <div style={{ paddingBottom: 110 }}>
      {/* Pills row — each watchlist + "+" to create a new one. */}
      <div style={{
        display: "flex", gap: 8, padding: "16px 16px 12px",
        overflowX: "auto", scrollbarWidth: "none",
      }}>
        {watchlists.map((w) => {
          const active = w.id === selectedId;
          return (
            <button key={w.id} onClick={() => setSelectedId(w.id)} style={{
              flexShrink: 0, padding: "8px 14px", borderRadius: 999,
              background: active ? T.accentSoft : T.surface,
              border: `1px solid ${active ? T.accent : T.border}`,
              color: active ? T.accent : T.text,
              fontFamily: FONT.sans, fontSize: 13, fontWeight: 600,
              cursor: "pointer", whiteSpace: "nowrap",
            }}>{w.name} <span style={{ color: T.textMute, marginLeft: 4 }}>{w.tickers.length}</span></button>
          );
        })}
        <button onClick={() => setModal("create")} style={{
          flexShrink: 0, padding: "8px 14px", borderRadius: 999,
          background: T.surface, border: `1px dashed ${T.border}`,
          color: T.textMute, fontFamily: FONT.sans, fontSize: 13, fontWeight: 600,
          cursor: "pointer", whiteSpace: "nowrap",
        }}>+ Nueva</button>
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
          <div style={{ display: "flex", gap: 6 }}>
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
        <Empty T={T} title="Lista vacía" subtitle="Tocá + Agregar activo abajo o desde Mercado." />
      ) : (
        <div style={{ margin: "0 16px" }}>
          {items.map((a, i) => (
            <AssetRow
              key={a.ticker}
              T={T}
              asset={a}
              subline={a.name}
              rightTop={`${a.currency === "ARS" ? "$" : "US$"}${fmtMoney(a.price, a.currency)}`}
              rightBottom={fmtPct(a.changePct)}
              rightBottomColor={a.changePct >= 0 ? T.accent : T.danger}
              isLast={i === items.length - 1}
              onClick={() => onSelectAsset(a)}
            />
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
      {modal === "add-asset" && selected && (
        <AddAssetModal
          T={T}
          assets={assets}
          excludeTickers={selected.tickers}
          listName={selected.name}
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
    catch (e) { alert(e.message); }
    setBusyKey(null);
  }
  async function removeAlert(ticker) {
    setBusyKey(`alert:${ticker}`);
    try { await brokerApi.removePriceAlert(ticker); await onRefresh(); }
    catch (e) { alert(e.message); }
    setBusyKey(null);
  }
  async function removeStop(ticker) {
    setBusyKey(`stop:${ticker}`);
    try { await brokerApi.removeStopLoss(ticker); await onRefresh(); }
    catch (e) { alert(e.message); }
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
        paddingBottom: 110,
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
    <div style={{ paddingBottom: 110 }}>
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

// Tile background per asset category — same color for all CEDEAR, all
// ACCION, all CRYPTO etc. Keeps the list visually grouped instead of
// the chaotic per-ticker hue we had before.
const CATEGORY_TILES = {
  CEDEAR:  "#2563EB", // blue
  ACCION:  "#16C784", // green (Argentine equities)
  CRYPTO:  "#F7931A", // bitcoin orange
  ETF:     "#7C3AED", // violet
  COMMOD:  "#C9A84C", // gold
  BONO:    "#0EA5E9", // sky blue
};
function tileForCategory(category) {
  return CATEGORY_TILES[category] || "#6B7280";
}
function AssetRow({ T, asset, subline, rightTop, rightBottom, rightBottomColor, isLast, onClick }) {
  const tile = tileForCategory(asset.category);
  return (
    <button onClick={onClick} style={{
      width: "100%", padding: "12px 0",
      background: "transparent", border: "none",
      borderBottom: isLast ? "none" : `1px solid ${T.border}`,
      display: "flex", alignItems: "center", gap: 12,
      cursor: "pointer", textAlign: "left",
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 12, background: tile,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#06170D",
        fontFamily: FONT.mono, fontSize: 11, fontWeight: 800, flexShrink: 0,
      }}>{asset.ticker.slice(0, 4)}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: FONT.sans, fontSize: 14, fontWeight: 700, color: T.text,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{asset.ticker}</div>
        <div style={{
          fontFamily: FONT.sans, fontSize: 12, color: T.textMute,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{subline}</div>
      </div>
      <Sparkline
        data={(rightBottom || "").startsWith("-") ? SAMAS_SPARKS.bear : SAMAS_SPARKS.bull}
        color={rightBottomColor} w={50} h={20} sw={1.5}
      />
      <div style={{ textAlign: "right", marginLeft: 8, minWidth: 70 }}>
        <div style={{ fontFamily: FONT.mono, fontSize: 13, fontWeight: 700, color: T.text }}>{rightTop}</div>
        <div style={{ fontFamily: FONT.mono, fontSize: 11, fontWeight: 600, color: rightBottomColor }}>{rightBottom}</div>
      </div>
    </button>
  );
}

function AssetSheet({ T, asset, holding = null, onClose, onDone, watchlists = [], onWatchlistsChange }) {
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
  useEffect(() => {
    let alive = true;
    Promise.all([
      brokerApi.getAlertFor(asset.ticker),
      brokerApi.getStopFor(asset.ticker),
    ]).then(([a, s]) => { if (alive) { setAlert(a); setStop(s); } });
    return () => { alive = false; };
  }, [asset.ticker]);

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
      setDone(r);
      setConfirm(null);
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    }}>
      <div style={{
        width: "100%", maxWidth: 540,
        background: T.bgElev, color: T.text,
        borderTopLeftRadius: 28, borderTopRightRadius: 28,
        border: `1px solid ${T.border}`, borderBottom: "none",
        overflow: "hidden",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "20px 20px 8px",
        }}>
          <div>
            <div style={{ fontFamily: FONT.display, fontSize: 22, fontWeight: 700, color: T.text }}>
              {asset.ticker}
            </div>
            <div style={{ fontFamily: FONT.sans, fontSize: 12, color: T.textMute }}>
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
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 16 }}>
            <span style={{
              fontFamily: FONT.display, fontSize: 28, fontWeight: 700, color: T.text,
              fontVariantNumeric: "tabular-nums",
            }}>{ccySym}{fmtMoney(asset.price, asset.currency)}</span>
            <Pill T={T}
              color={asset.changePct >= 0 ? T.accent : T.danger}
              bg={asset.changePct >= 0 ? T.accentSoft : T.dangerSoft}>
              {fmtPct(asset.changePct)}
            </Pill>
          </div>

          {done ? (
            <DoneScreen T={T} done={done} side={side} qty={qty} ticker={asset.ticker} onClose={onDone} />
          ) : confirm ? (
            <ConfirmOrderStep
              T={T}
              asset={asset}
              confirm={confirm}
              busy={busy}
              err={err}
              onCancel={() => { setConfirm(null); setErr(null); }}
              onConfirm={confirmAndPlace}
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
                  { id: "buy",  label: "Comprar", color: T.accent,  soft: T.accentSoft },
                  { id: "sell", label: "Vender",  color: T.danger,  soft: T.dangerSoft },
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
                  { id: "market", label: "Mercado" },
                  { id: "limit",  label: "Límite" },
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

              <NumberInput T={T} label="Cantidad" value={qtyStr} onChange={setQtyStr} placeholder="0" />

              {type === "limit" && (
                <div style={{ marginTop: 12 }}>
                  <NumberInput T={T} label={`Precio límite (${asset.currency})`} value={limitStr} onChange={setLimitStr} placeholder={String(asset.price)} />
                </div>
              )}

              <div style={{
                marginTop: 14, padding: "12px 14px", borderRadius: 12,
                background: T.surface, border: `1px solid ${T.border}`,
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <span style={{ fontFamily: FONT.sans, fontSize: 12, color: T.textMute }}>Total estimado</span>
                <span style={{ fontFamily: FONT.mono, fontSize: 14, fontWeight: 700, color: T.text }}>
                  {qty > 0 ? `${ccySym}${fmtMoney(totalEst, asset.currency)}` : "—"}
                </span>
              </div>

              {err && <div style={{ marginTop: 12, color: T.danger, fontFamily: FONT.sans, fontSize: 12 }}>{err}</div>}

              <button onClick={openConfirm} disabled={qty <= 0} style={{
                width: "100%", marginTop: 18, padding: 16, borderRadius: 14,
                background: side === "buy" ? T.accent : T.danger,
                color: side === "buy" ? T.accentInk : "#FFFFFF",
                fontFamily: FONT.sans, fontSize: 15, fontWeight: 700, border: "none",
                cursor: "pointer", opacity: qty <= 0 ? 0.6 : 1,
              }}>
                {side === "buy" ? `Revisar compra` : `Revisar venta`}
              </button>
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
function AddAssetModal({ T, assets, excludeTickers = [], listName, onClose, onPick }) {
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
              placeholder="Buscar por ticker o nombre"
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
                onClick={async () => { setBusy(true); try { await onPick(a.ticker); } catch (e) { alert(e.message); setBusy(false); } }}
                style={{
                  width: "100%", padding: "10px 8px", background: "transparent",
                  border: "none", borderBottom: `1px solid ${T.border}`,
                  display: "flex", alignItems: "center", gap: 12,
                  cursor: busy ? "default" : "pointer", textAlign: "left",
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                  background: tileForCategory(a.category),
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#06170D",
                  fontFamily: FONT.mono, fontSize: 10, fontWeight: 800,
                }}>{a.ticker.slice(0, 4)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: FONT.sans, fontSize: 14, fontWeight: 700, color: T.text }}>
                    {a.ticker}
                  </div>
                  <div style={{
                    fontFamily: FONT.sans, fontSize: 12, color: T.textMute,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{a.name}</div>
                </div>
                <div style={{ fontFamily: FONT.mono, fontSize: 12, color: T.textMute }}>
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

function WatchlistPicker({ T, ticker, watchlists, onClose, onChange }) {
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
    } catch (e) { alert(e.message); }
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
        }}>Listo</button>
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
  // Signed %: positive = above current, negative = below.
  // Default to +5 so the form has a sensible starting value.
  const [pctStr, setPctStr] = useState("5");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  // Derived target + direction based on input mode. When type="pct"
  // we compute targetPrice from the signed % and infer direction
  // from the sign — UI shows a live preview so the user knows what
  // gets saved.
  const pctNum = parseFloat(pctStr.replace(",", ".")) || 0;
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
        <NumberInput T={T} label="Porcentaje (+ sube · − baja)"
          value={pctStr} onChange={setPctStr}
          placeholder="5" />
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
  const [pctStr, setPctStr] = useState(existing && existing.type === "pct" ? String(existing.value) : "-10");
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
    const value = type === "pct"
      ? parseFloat(pctStr.replace(",", "."))
      : parseFloat(priceStr.replace(",", "."));
    if (isNaN(value)) { setErr("Valor inválido."); return; }
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
        <NumberInput T={T} label="Porcentaje (negativo)" value={pctStr} onChange={setPctStr} placeholder="-10" />
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
function ConfirmOrderStep({ T, asset, confirm, busy, err, onCancel, onConfirm }) {
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
        <Row label="Cantidad" value={`${fmtMoney(confirm.qty, asset.currency)} ${asset.ticker}`} />
        <Row label="Tipo de orden" value={confirm.type === "limit" ? "Límite" : "Mercado"} />
        <Row label="Precio" value={`${ccySym}${fmtMoney(confirm.price, asset.currency)}`} />
        <div style={{ height: 1, background: T.border, margin: "6px 0" }} />
        <Row label="Subtotal" value={`${ccySym}${fmtMoney(fee.subtotal, asset.currency)}`} />
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

function DoneScreen({ T, done, side, qty, ticker, onClose }) {
  return (
    <div style={{ textAlign: "center", padding: "24px 0 8px" }}>
      <div style={{
        width: 64, height: 64, borderRadius: 32, background: T.accentSoft,
        color: T.accent, margin: "0 auto 16px",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5"/>
        </svg>
      </div>
      <div style={{ fontFamily: FONT.display, fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 6 }}>
        Orden {done.status === "filled" ? "ejecutada" : "enviada"}
      </div>
      <div style={{ fontFamily: FONT.sans, fontSize: 13, color: T.textMute, marginBottom: 20 }}>
        {side === "buy" ? "Compraste" : "Vendiste"} {qty} u de {ticker}
        {done.fillPrice ? ` a $${fmtMoney(done.fillPrice)}` : ""}
      </div>
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
// AIPlanCard — entry point for the goal-planning wizard. The wizard
// itself lives in /src/ai/ObjectivesWizard.jsx but it depends on the
// legacy theme and is heavy. For now this card opens a placeholder
// alert so the user sees the surface; we can wire the real wizard in
// a follow-up pass once it's been ported to the v2 theme.
// ----------------------------------------------------------
function AIPlanCard({ T, onOpen, savedPlan }) {
  // If the user already ran the wizard, show a summary of their plan
  // (strategy + objective + horizon) instead of the generic prompt.
  // Tapping still opens the wizard so they can review or adjust.
  if (savedPlan && savedPlan.strategy) {
    const strategyLabel = {
      conservadora: "Conservadora",
      moderada: "Moderada",
      agresiva: "Agresiva",
    }[savedPlan.strategy] || savedPlan.strategy;
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
          alert("Plan copiado al portapapeles.");
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
          }}>Tu plan · {strategyLabel}</div>
          <div style={{
            fontFamily: FONT.display, fontSize: 16, fontWeight: 700, color: T.text,
            letterSpacing: -0.3,
          }}>
            {sym}{Math.round(target).toLocaleString("es-AR")} en {horizon} {horizon === 1 ? "año" : "años"}
          </div>
          <div style={{ fontFamily: FONT.sans, fontSize: 11, color: T.textMute, marginTop: 2 }}>
            Tocá para revisar o ajustar
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

// ----------------------------------------------------------
// TopMovers — top 3 winners + top 3 losers across the asset universe.
// Tapping a row opens the AssetSheet for that ticker.
// ----------------------------------------------------------
function TopMovers({ T, assets, onSelectAsset }) {
  const sorted = useMemo(
    () => [...assets].sort((a, b) => b.changePct - a.changePct),
    [assets]
  );
  const winners = sorted.slice(0, 3);
  const losers = sorted.slice(-3).reverse();

  return (
    <div style={{ margin: "8px 16px 0" }}>
      <SectionHead T={T} title="Top del día" />
      <div style={{
        marginTop: 12, padding: 4, borderRadius: 18,
        background: T.surface, border: `1px solid ${T.border}`,
      }}>
        <MoverGroup T={T} label="Ganadores" rows={winners} positive onSelectAsset={onSelectAsset} />
        <div style={{ height: 1, background: T.border, margin: "0 12px" }}/>
        <MoverGroup T={T} label="Perdedores" rows={losers} positive={false} onSelectAsset={onSelectAsset} />
      </div>
    </div>
  );
}

function MoverGroup({ T, label, rows, positive, onSelectAsset }) {
  return (
    <div style={{ padding: "10px 12px" }}>
      <div style={{
        fontFamily: FONT.sans, fontSize: 11, color: T.textMute, fontWeight: 600,
        letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 8,
      }}>{label}</div>
      {rows.map((a) => (
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
          <div style={{ textAlign: "right" }}>
            <div style={{
              fontFamily: FONT.mono, fontSize: 12, fontWeight: 700, color: T.text,
            }}>{a.currency === "ARS" ? "$" : "US$"}{fmtMoney(a.price, a.currency)}</div>
            <div style={{
              fontFamily: FONT.mono, fontSize: 11, fontWeight: 700,
              color: positive ? T.accent : T.danger,
            }}>{fmtPct(a.changePct)}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

function Loader({ T }) {
  return (
    <div style={{ padding: 30, textAlign: "center", color: T.textMute, fontFamily: FONT.sans, fontSize: 13 }}>
      Cargando…
    </div>
  );
}

function Empty({ T, title, subtitle }) {
  return (
    <div style={{ margin: "0 16px", padding: "32px 24px", borderRadius: 22, background: T.surface, border: `1px solid ${T.border}`, textAlign: "center" }}>
      <div style={{ fontFamily: FONT.display, fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 6 }}>{title}</div>
      <div style={{ fontFamily: FONT.sans, fontSize: 13, color: T.textMute, lineHeight: 1.5 }}>{subtitle}</div>
    </div>
  );
}

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i);
  return Math.abs(h);
}

function NumberInput({ T, label, value, onChange, placeholder }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{ fontFamily: FONT.sans, fontSize: 11, color: T.textMute, marginBottom: 6, letterSpacing: 0.4 }}>{label}</div>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
        placeholder={placeholder}
        style={{
          width: "100%", boxSizing: "border-box",
          padding: "14px 16px", borderRadius: 14,
          background: T.surface, border: `1px solid ${T.border}`,
          color: T.text, fontFamily: FONT.mono, fontSize: 18, fontWeight: 600,
          outline: "none",
        }}
      />
    </label>
  );
}
