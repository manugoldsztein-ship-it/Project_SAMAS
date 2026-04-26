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
export function BrokerShell({ T, isNativeApp = false, onBack }) {
  const [tab, setTab] = useState("portafolio");
  const [selectedAsset, setSelectedAsset] = useState(null);

  // Lift broker data here so all sub-tabs see the same snapshot and
  // a single refresh() call after a successful order updates everyone.
  const [portfolio, setPortfolio] = useState(null);
  const [assets, setAssets] = useState([]);
  const [watchlists, setWatchlists] = useState([]);
  const [orders, setOrders] = useState([]);

  const refresh = useCallback(async () => {
    try {
      const [p, a, wl, o] = await Promise.all([
        brokerApi.getPortfolio(),
        brokerApi.getAssets(),
        brokerApi.getWatchlists(),
        brokerApi.getOrders({ status: "all" }),
      ]);
      setPortfolio(p); setAssets(a); setWatchlists(wl); setOrders(o);
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

      {/* ---------- scrollable content ---------- */}
      <div style={{
        flex: 1, overflowY: "auto",
        overscrollBehavior: "contain",
        WebkitOverflowScrolling: "touch",
      }}>
        {tab === "portafolio" && (
          <PortafolioView T={T} portfolio={portfolio} onSelectAsset={setSelectedAsset} />
        )}
        {tab === "mercado" && (
          <MercadoView T={T} assets={assets} onSelectAsset={setSelectedAsset} />
        )}
        {tab === "watchlist" && (
          <WatchlistView T={T} watchlists={watchlists} assets={assets} onSelectAsset={setSelectedAsset} />
        )}
        {tab === "ordenes" && (
          <OrdenesView T={T} orders={orders} onRefresh={refresh} />
        )}
      </div>

      {/* ---------- sub-nav bottom bar ---------- */}
      <SubNav T={T} tab={tab} setTab={setTab} bottomInset={navBottom} />

      {/* ---------- asset sheet ---------- */}
      {selectedAsset && (
        <AssetSheet
          T={T}
          asset={selectedAsset}
          onClose={() => setSelectedAsset(null)}
          onDone={() => { setSelectedAsset(null); refresh(); }}
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
// Portafolio — total + holdings list.
// ----------------------------------------------------------
function PortafolioView({ T, portfolio, onSelectAsset }) {
  if (!portfolio) return <Loader T={T}/>;

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
            fontFamily: FONT.sans, fontSize: 11, color: T.textDim,
            marginBottom: 6, letterSpacing: 0.6, fontWeight: 700,
          }}>VALOR DE CARTERA</div>
          <div style={{
            fontFamily: FONT.display, fontSize: 36, fontWeight: 700, color: T.text,
            letterSpacing: -1.2, fontVariantNumeric: "tabular-nums", marginBottom: 10,
          }}>
            US${fmtMoney(portfolio.totalUsd, "USD")}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Pill T={T} color={T.accent} bg={T.accentSoft}>+US$160.27</Pill>
            <Pill T={T} color={T.accent} bg={T.accentSoft}>+2.34%</Pill>
            <Pill T={T}>30 días</Pill>
          </div>
        </div>
      </div>

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
    </div>
  );
}

// ----------------------------------------------------------
// Mercado — full universe with category filter.
// ----------------------------------------------------------
function MercadoView({ T, assets, onSelectAsset }) {
  const [cat, setCat] = useState("Todas");
  const cats = useMemo(() => {
    const s = new Set(assets.map((a) => a.category));
    return ["Todas", ...Array.from(s)];
  }, [assets]);
  const filtered = cat === "Todas" ? assets : assets.filter((a) => a.category === cat);

  if (assets.length === 0) return <Loader T={T}/>;

  return (
    <div style={{ paddingBottom: 110 }}>
      <div style={{
        display: "flex", gap: 8, padding: "16px 16px 12px",
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
        {filtered.map((a, i) => (
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
        ))}
      </div>
    </div>
  );
}

// ----------------------------------------------------------
// Watchlist — first list (full mgmt UI is Phase 2.5).
// ----------------------------------------------------------
function WatchlistView({ T, watchlists, assets, onSelectAsset }) {
  if (!watchlists.length) {
    return <Empty T={T} title="Sin listas" subtitle="Próximamente." />;
  }
  const list = watchlists[0];
  const items = list.tickers.map((tk) => assets.find((a) => a.ticker === tk)).filter(Boolean);
  return (
    <div style={{ paddingBottom: 110 }}>
      <div style={{ margin: "16px" }}>
        <SectionHead T={T} title={list.name} action={`${items.length} activos`} />
      </div>
      {items.length === 0 ? (
        <Empty T={T} title="Lista vacía" subtitle="Agregá activos desde Mercado." />
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
    </div>
  );
}

// ----------------------------------------------------------
// Órdenes — list of submitted orders, with cancel button on open ones.
// ----------------------------------------------------------
function OrdenesView({ T, orders, onRefresh }) {
  const [busyId, setBusyId] = useState(null);

  async function cancel(orderId) {
    setBusyId(orderId);
    try {
      await brokerApi.cancelOrder(orderId);
      await onRefresh();
    } catch (e) { alert(e.message); }
    setBusyId(null);
  }

  if (orders.length === 0) {
    return (
      <div style={{ padding: "16px", paddingBottom: 110 }}>
        <SectionHead T={T} title="Órdenes" action="0 totales" />
        <Empty T={T} title="No hay órdenes" subtitle="Tus operaciones aparecen acá una vez que las envíes." />
      </div>
    );
  }

  // Group by status: open first, then filled, then cancelled.
  const ordered = [
    ...orders.filter((o) => o.status === "open"),
    ...orders.filter((o) => o.status === "filled"),
    ...orders.filter((o) => o.status === "cancelled"),
  ];

  return (
    <div style={{ paddingBottom: 110 }}>
      <div style={{ margin: "16px" }}>
        <SectionHead T={T} title="Órdenes" action={`${orders.length} totales`} />
      </div>
      <div style={{
        margin: "0 16px", borderRadius: 18,
        background: T.surface, border: `1px solid ${T.border}`, overflow: "hidden",
      }}>
        {ordered.map((o, i) => (
          <OrderRow
            key={o.id} T={T} order={o}
            isLast={i === ordered.length - 1}
            busy={busyId === o.id}
            onCancel={() => cancel(o.id)}
          />
        ))}
      </div>
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

function AssetRow({ T, asset, subline, rightTop, rightBottom, rightBottomColor, isLast, onClick }) {
  const hue = hashString(asset.ticker) % 360;
  const tile = `oklch(0.55 0.14 ${hue})`;
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

function AssetSheet({ T, asset, onClose, onDone }) {
  const [side, setSide] = useState("buy");
  const [qtyStr, setQtyStr] = useState("");
  const [type, setType] = useState("market");
  const [limitStr, setLimitStr] = useState(String(asset.price));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(null);

  const qty = parseFloat(qtyStr.replace(",", ".")) || 0;
  const limit = parseFloat(limitStr.replace(",", ".")) || 0;
  const price = type === "limit" ? limit : asset.price;
  const totalEst = qty * price;
  const ccySym = asset.currency === "ARS" ? "$" : "US$";

  async function submit() {
    setErr(null);
    if (!qty || qty <= 0) { setErr("Cantidad inválida."); return; }
    setBusy(true);
    try {
      const r = await brokerApi.placeOrder({
        ticker: asset.ticker, side, qty, type,
        limitPrice: type === "limit" ? limit : undefined,
      });
      setDone(r);
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
          ) : (
            <>
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

              <button onClick={submit} disabled={busy || qty <= 0} style={{
                width: "100%", marginTop: 18, padding: 16, borderRadius: 14,
                background: side === "buy" ? T.accent : T.danger,
                color: side === "buy" ? T.accentInk : "#FFFFFF",
                fontFamily: FONT.sans, fontSize: 15, fontWeight: 700, border: "none",
                cursor: busy ? "default" : "pointer", opacity: busy || qty <= 0 ? 0.6 : 1,
              }}>
                {busy ? "Enviando..." : side === "buy" ? `Comprar ${asset.ticker}` : `Vender ${asset.ticker}`}
              </button>
            </>
          )}
        </div>
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
