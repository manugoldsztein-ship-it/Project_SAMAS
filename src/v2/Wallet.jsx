// ============================================================
// SAMAS v2 — Wallet (home) screen
// ============================================================
// First page after auth. Connected to api/wallet.js + api/card.js +
// api/broker.js (for FX rates). All data flows through the v2 API
// layer — no direct fetch / Supabase call here.
//
// Sections (top → bottom):
//   - Header (avatar + greeting + search + bell)
//   - Balance card (ARS/USD toggle, eye-toggle, daily delta)
//   - Quick actions (Enviar / Recibir / Cambiar / Cargar)
//   - FX quotes (MEP + Oficial)
//   - Virtual card preview
//   - Portfolio peek (links to Broker tab)
//   - Recent transactions
//
// Modals lifted to this component (deposit / withdraw / card-details)
// — keeps the section components focused on rendering.
// ============================================================

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { FONT, fmtMoney, fmtPct } from "./theme.js";
import { Ico } from "./icons.jsx";
import {
  Avatar, ChromeBtn, Pill, SectionHead, Sparkline, SAMAS_SPARKS,
} from "./shared.jsx";
import { wallet as walletApi, card as cardApi, broker as brokerApi, notifications as notifApi } from "./api/index.js";
import { rowToNotif } from "./api/notifications.js";
import { supabase } from "../lib/supabase.js";
import { toast } from "./toast.jsx";
import { setRefreshHandler } from "./refreshRegistry.js";
import { t as tr } from "../lib/i18n.js";

export function WalletPage({ T, onTab, user, balanceVisible, setBalanceVisible, isDark, onToggleDark, onOpenSettings, lang = "es" }) {
  // ----------- data state -----------
  const [balance, setBalance] = useState(null);
  const [fx, setFx] = useState(null);
  const [card, setCard] = useState(null);
  const [txns, setTxns] = useState([]);
  const [portfolio, setPortfolio] = useState(null);
  const [aporte, setAporte] = useState(null);

  // ----------- UI state -----------
  const [ccy, setCcy] = useState("ARS");
  const [activeModal, setActiveModal] = useState(null); // "deposit" | "withdraw" | "card" | "aporte" | "inbox" | null
  // Unread badge on the bell. Refetched on tab focus + after the
  // inbox closes (since opening it marks rows read). Returns 0 when
  // the table doesn't exist yet, so the dot just stays hidden until
  // the migration is applied.
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let alive = true;
    notifApi.getUnreadCount().then((n) => { if (alive) setUnread(n); }).catch(() => {});
    return () => { alive = false; };
  }, [activeModal]);
  // Realtime: bump the bell badge the moment a notification row is
  // written for this user (e.g. someone likes a post, follows them,
  // or replies — see supabase/social_notifications.sql triggers).
  // Filtering on user_id at the channel level so we only get our
  // own rows; RLS already enforces the same on the read side, but
  // the filter saves bytes on the wire.
  useEffect(() => {
    let alive = true;
    let channel = null;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id;
      if (!uid || !alive) return;
      channel = supabase
        .channel(`notifications-bell-${uid}`)
        .on("postgres_changes", {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${uid}`,
        }, () => {
          if (alive) setUnread((n) => n + 1);
        })
        .subscribe();
    })();
    return () => {
      alive = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  // ----------- load everything in parallel -----------
  const refresh = useCallback(async () => {
    try {
      const [b, f, c, t, p, a] = await Promise.all([
        walletApi.getBalance(),
        brokerApi.getFx(),
        cardApi.getCard(),
        walletApi.getTransactions({ limit: 5 }),
        brokerApi.getPortfolio(),
        walletApi.getRecurringAporte(),
      ]);
      setBalance(b); setFx(f); setCard(c); setTxns(t); setPortfolio(p);
      setAporte(a);
    } catch (e) {
      console.error("[wallet] load:", e);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Register refresh under the "wallet" tab id so the parent Shell's
  // pull-to-refresh can invoke it.
  useEffect(() => setRefreshHandler("wallet", refresh), [refresh]);

  // ----------- derived -----------
  const userName = user?.name?.split(" ")[0] || "Usuario";
  const userInitials = user?.initials || "??";
  const avatarColor = user?.avatarColor || "oklch(0.78 0.16 145)";
  const balanceValue = balance
    ? (ccy === "ARS" ? balance.ars : balance.usd)
    : null;

  return (
    <div style={{ paddingBottom: 110 }}>
      {/* ---------- header ---------- */}
      <div style={{
        // Top inset = safe-area-top (status bar / DI) + 20px breathing
        // room. env() resolves to 0 on web preview so the layout looks
        // identical there, but on iPhone the avatar+greeting sit
        // properly below the system UI.
        padding: "calc(env(safe-area-inset-top) + 20px) 20px 0",
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <button
          onClick={onOpenSettings}
          style={{
            display: "flex", alignItems: "center", gap: 12,
            background: "transparent", border: "none", padding: 0,
            cursor: onOpenSettings ? "pointer" : "default", textAlign: "left",
          }}
        >
          <Avatar color={avatarColor} initials={userInitials} size={42} />
          <div>
            <div style={{ fontFamily: FONT.sans, fontSize: 12, color: T.textMute }}>{tr("greeting_prefix", lang)}</div>
            <div style={{ fontFamily: FONT.sans, fontSize: 16, fontWeight: 700, color: T.text }}>{userName}</div>
          </div>
        </button>
        <div style={{ display: "flex", gap: 8 }}>
          {onToggleDark && (
            <ChromeBtn T={T} onClick={onToggleDark}>
              {isDark ? <Ico.Sun size={18}/> : <Ico.Moon size={18}/>}
            </ChromeBtn>
          )}
          <ChromeBtn T={T}><Ico.Search size={18}/></ChromeBtn>
          <ChromeBtn T={T} dot={unread > 0} onClick={() => setActiveModal("inbox")}>
            <Ico.Bell size={18}/>
          </ChromeBtn>
        </div>
      </div>

      {/* ---------- balance card ---------- */}
      <div style={{
        margin: "24px 16px 0", padding: 24, borderRadius: 28,
        background: `linear-gradient(155deg, ${T.surfaceHi} 0%, ${T.surface} 60%)`,
        border: `1px solid ${T.border}`,
        position: "relative", overflow: "hidden",
      }}>
        <div style={{
          position: "absolute", top: -80, right: -60, width: 220, height: 220,
          borderRadius: "50%", background: T.accent, opacity: 0.10, filter: "blur(40px)",
        }}/>

        <div style={{ position: "relative", zIndex: 1 }}>
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            marginBottom: 12,
          }}>
            <div style={{
              display: "flex", gap: 4, padding: 4,
              background: T.bg, border: `1px solid ${T.border}`,
              borderRadius: 999,
            }}>
              {["ARS", "USD"].map(c => (
                <button key={c} onClick={() => setCcy(c)} style={{
                  padding: "5px 12px", borderRadius: 999, border: "none", cursor: "pointer",
                  background: ccy === c ? T.accent : "transparent",
                  color: ccy === c ? T.accentInk : T.textMute,
                  fontFamily: FONT.mono, fontSize: 11, fontWeight: 700, letterSpacing: 0.6,
                }}>{c}</button>
              ))}
            </div>
            <button onClick={() => setBalanceVisible(!balanceVisible)} style={{
              background: "none", border: "none", cursor: "pointer", color: T.textMute,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {balanceVisible ? <Ico.Eye size={18}/> : <Ico.EyeOff size={18}/>}
            </button>
          </div>

          <div style={{
            fontFamily: FONT.sans, fontSize: 12, color: T.textMute,
            marginBottom: 4, letterSpacing: 0.3,
          }}>
            {tr("wallet.balance_total", lang)} · {ccy}
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 8 }}>
            <span style={{
              fontFamily: FONT.display, fontSize: 13, color: T.textMute, fontWeight: 600,
            }}>
              {ccy === "ARS" ? "$" : "US$"}
            </span>
            <span style={{
              fontFamily: FONT.display, fontSize: 40, fontWeight: 700, color: T.text,
              letterSpacing: -1.5, fontVariantNumeric: "tabular-nums",
            }}>
              {balanceValue == null
                ? "—"
                : balanceVisible
                  ? fmtMoney(balanceValue, ccy)
                  : "••••••"}
            </span>
          </div>

          {portfolio && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                fontFamily: FONT.mono, fontSize: 12, fontWeight: 600,
                color: T.accent, padding: "3px 8px", borderRadius: 6,
                background: T.accentSoft, whiteSpace: "nowrap",
              }}>
                ↑ {fmtPct(1.84)}
              </span>
              <span style={{ fontFamily: FONT.sans, fontSize: 12, color: T.textMute }}>
                {tr("wallet.today", lang)} · {balanceVisible ? `+US$${(portfolio.totalUsd * 0.0184).toFixed(2)}` : "••••"}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ---------- quick actions ---------- */}
      <div style={{
        margin: "20px 16px 0",
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8,
      }}>
        <Action T={T} icon={<Ico.Send size={18}/>}   label={tr("wallet.action.send", lang)}  onClick={() => setActiveModal("withdraw")} />
        <Action T={T} icon={<Ico.Recv size={18}/>}   label={tr("wallet.action.receive", lang)} onClick={() => setActiveModal("deposit")} />
        <Action T={T} icon={<Ico.Repeat size={18}/>} label={tr("wallet.action.swap", lang)} onClick={() => toast.info(tr("wallet.swap_soon", lang))} />
        <Action T={T} icon={<Ico.Add size={18}/>}    label={tr("wallet.action.deposit", lang)}  onClick={() => setActiveModal("deposit")} />
      </div>

      {/* ---------- FX quotes ---------- */}
      {fx && (
        <div style={{
          margin: "24px 16px 0",
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10,
        }}>
          <Quote T={T} label="DÓLAR MEP"     value={fx.mep.value}     delta={fx.mep.change} />
          <Quote T={T} label="DÓLAR OFICIAL" value={fx.oficial.value} delta={fx.oficial.change} />
        </div>
      )}

      {/* ---------- portfolio peek ---------- */}
      {portfolio && portfolio.totalUsd > 0 && (
        <div style={{ margin: "28px 16px 0" }}>
          <SectionHead T={T} title={tr("wallet.section.portfolio", lang)} action={tr("wallet.see_all", lang)} onAction={() => onTab && onTab("broker")} />
          <div style={{
            marginTop: 12, padding: 16, borderRadius: 22,
            background: T.surface, border: `1px solid ${T.border}`,
            display: "flex", alignItems: "center", gap: 14,
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: FONT.sans, fontSize: 12, color: T.textMute, marginBottom: 4 }}>
                {tr("wallet.value_invested", lang)}
              </div>
              {/* Show whichever currency the user picked in the
                  balance card pill, so cartera and balance feel
                  consistent. The other currency is shown small
                  below as reference. */}
              <div style={{
                fontFamily: FONT.display, fontSize: 22, fontWeight: 700, color: T.text,
                letterSpacing: -0.6, fontVariantNumeric: "tabular-nums",
              }}>
                {ccy === "ARS"
                  ? `$${fmtMoney(portfolio.totalArs, "ARS")}`
                  : `US$${fmtMoney(portfolio.totalUsd, "USD")}`}
              </div>
              <div style={{
                fontFamily: FONT.mono, fontSize: 12, color: T.textMute, marginTop: 2,
                fontVariantNumeric: "tabular-nums",
              }}>
                {ccy === "ARS"
                  ? `≈ US$${fmtMoney(portfolio.totalUsd, "USD")}`
                  : `≈ $${fmtMoney(portfolio.totalArs, "ARS")}`}
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <Pill T={T} color={T.accent} bg={T.accentSoft}>+2.34%</Pill>
                <Pill T={T}>{tr("wallet.last_30d", lang)}</Pill>
              </div>
            </div>
            <Sparkline data={SAMAS_SPARKS.bull} color={T.accent} w={90} h={42} sw={2}/>
          </div>
        </div>
      )}

      {/* ---------- aporte mensual ---------- */}
      <div style={{ margin: "28px 16px 0" }}>
        <SectionHead T={T} title={tr("wallet.section.aporte", lang)} />
        <button
          onClick={() => setActiveModal("aporte")}
          style={{
            width: "100%", marginTop: 12, padding: 16, borderRadius: 22,
            background: aporte ? `linear-gradient(135deg, ${T.accentSoft} 0%, ${T.surface} 70%)` : T.surface,
            border: `1px solid ${aporte ? T.accent + "55" : T.border}`,
            display: "flex", alignItems: "center", gap: 14, cursor: "pointer",
            textAlign: "left",
          }}
        >
          <div style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            background: T.bg, border: `1px solid ${T.border}`,
            color: T.accent,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {aporte ? (
              <>
                <div style={{
                  fontFamily: FONT.sans, fontSize: 11, color: T.textMute,
                  letterSpacing: 0.6, fontWeight: 700, textTransform: "uppercase", marginBottom: 2,
                }}>{tr("aporte.title", lang)}</div>
                <div style={{ fontFamily: FONT.display, fontSize: 16, fontWeight: 700, color: T.text }}>
                  {aporte.currency === "ARS" ? "$" : "US$"}{fmtMoney(aporte.amount, aporte.currency)}
                  {" "}<span style={{ color: T.textMute, fontWeight: 500 }}>·</span>{" "}
                  <span style={{ color: T.accent }}>{nextLabel(aporte.nextAt)}</span>
                </div>
                <div style={{ fontFamily: FONT.sans, fontSize: 11, color: T.textMute, marginTop: 2 }}>
                  Día {aporte.dayOfMonth} de cada mes
                  {aporte.lastAt ? ` · Último: ${shortDate(aporte.lastAt)}` : ""}
                  {" · Tocá para ajustar"}
                </div>
              </>
            ) : (
              <>
                <div style={{ fontFamily: FONT.display, fontSize: 15, fontWeight: 700, color: T.text }}>
                  {tr("aporte.title", lang)}
                </div>
                <div style={{ fontFamily: FONT.sans, fontSize: 12, color: T.textMute, marginTop: 2 }}>
                  Cargá un monto fijo cada mes y ahorrá sin pensarlo.
                </div>
              </>
            )}
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.textMute}
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
      </div>

      {/* ---------- movimientos ---------- */}
      <div style={{ margin: "28px 16px 0" }}>
        <SectionHead T={T} title={tr("wallet.section.txns", lang)} action={tr("wallet.filter", lang)}/>
        <div style={{
          marginTop: 12, borderRadius: 22, background: T.surface,
          border: `1px solid ${T.border}`, overflow: "hidden",
        }}>
          {txns.length === 0 ? (
            <div style={{ padding: 20, textAlign: "center", color: T.textMute, fontFamily: FONT.sans, fontSize: 13 }}>
              Aún no hay movimientos.
            </div>
          ) : (
            txns.map((t, i) => (
              <TxnRow key={t.id} t={t} T={T} isLast={i === txns.length - 1} visible={balanceVisible} />
            ))
          )}
        </div>
      </div>

      {/* ---------- settings entry ---------- */}
      {onOpenSettings && (
        <div style={{ margin: "28px 16px 0" }}>
          <button
            onClick={onOpenSettings}
            style={{
              width: "100%", padding: "16px 18px", borderRadius: 18,
              background: T.surface, border: `1px solid ${T.border}`,
              display: "flex", alignItems: "center", gap: 14, cursor: "pointer",
              textAlign: "left",
            }}
          >
            <div style={{
              width: 40, height: 40, borderRadius: 10, flexShrink: 0,
              background: T.bg, border: `1px solid ${T.border}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: T.text,
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: FONT.sans, fontSize: 14, fontWeight: 700, color: T.text }}>
                Ajustes
              </div>
              <div style={{ fontFamily: FONT.sans, fontSize: 12, color: T.textMute, marginTop: 2 }}>
                Modo Pro, tema y preferencias
              </div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.textMute} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        </div>
      )}

      {/* ---------- modals ---------- */}
      {activeModal === "deposit" && (
        <DepositModal T={T} lang={lang} balance={balance}
          onClose={() => setActiveModal(null)}
          onDone={() => { setActiveModal(null); refresh(); }} />
      )}
      {activeModal === "withdraw" && (
        <WithdrawModal T={T} lang={lang} balance={balance}
          onClose={() => setActiveModal(null)}
          onDone={() => { setActiveModal(null); refresh(); }} />
      )}
      {activeModal === "card" && (
        <CardDetailsModal T={T} lang={lang} card={card}
          onClose={() => setActiveModal(null)}
          onCardChange={(updated) => setCard((c) => ({ ...c, ...updated }))} />
      )}
      {activeModal === "aporte" && (
        <AporteModal T={T} lang={lang} aporte={aporte}
          onClose={() => setActiveModal(null)}
          onDone={() => { setActiveModal(null); refresh(); }} />
      )}
      {activeModal === "inbox" && (
        <NotificationsInbox T={T} lang={lang}
          onClose={() => setActiveModal(null)} />
      )}
    </div>
  );
}

// ----------------------------------------------------------
// NotificationsInbox — bell-icon modal listing past pings
// ----------------------------------------------------------
// Bottom sheet that opens from the Wallet header. Loads the most recent
// 50 notifications, groups them by Today / Earlier, renders each with
// a kind-specific icon. On open we mark all unread items as read so
// the bell badge clears — the user sees the bold/dot styling for one
// frame before they fade, which is the same pattern Brubank / Ualá use.
//
// When the table doesn't exist yet, getNotifications returns [] and we
// show the empty state — same gracefulfallback as alerts.js.
// ----------------------------------------------------------
function NotificationsInbox({ T, lang = "es", onClose }) {
  const [items, setItems] = useState(null); // null=loading, [] = empty
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    notifApi.getNotifications({ limit: 50 }).then((rows) => {
      if (!alive) return;
      setItems(rows);
      // Mark all read after we've rendered them once. The bell badge
      // will reset on the next focus check (handled by the parent's
      // unread-count effect that depends on activeModal).
      if (rows.some((r) => !r.readAt)) {
        notifApi.markAllRead().catch(() => {});
      }
    }).catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, []);

  // Realtime: while the inbox is open, prepend any new notifications
  // as they arrive so the user sees them slide in. We don't bother
  // marking them read here (the parent will reset the unread badge
  // on next focus); the visual update is what matters.
  useEffect(() => {
    let alive = true;
    let channel = null;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id;
      if (!uid || !alive) return;
      channel = supabase
        .channel(`notifications-inbox-${uid}`)
        .on("postgres_changes", {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${uid}`,
        }, (payload) => {
          if (!alive) return;
          const n = rowToNotif(payload.new);
          setItems((prev) => prev ? [n, ...prev] : [n]);
        })
        .subscribe();
    })();
    return () => {
      alive = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  // Group by Today / Earlier for visual scanability.
  const groups = useMemo(() => {
    if (!items) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();
    const t = []; const e = [];
    for (const n of items) (n.createdAt >= todayMs ? t : e).push(n);
    return { today: t, earlier: e };
  }, [items]);

  async function clearAll() {
    if (!items || items.length === 0) return;
    if (busy) return;
    setBusy(true);
    try {
      await Promise.all(items.map((n) => notifApi.deleteNotification(n.id)));
      setItems([]);
    } finally { setBusy(false); }
  }

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    }}>
      <div style={{
        width: "100%", maxWidth: 540, maxHeight: "92dvh",
        // Min height so the sheet feels like a proper bottom sheet
        // even when the inbox is empty / loading. Without this, the
        // sheet collapses to fit only the drag handle + header +
        // bell emoji, and the "empty" title/subtitle get clipped
        // because the flex:1 scroll area has nothing to expand into
        // (parent height = sum of content). 55dvh leaves enough
        // backdrop visible that the user knows they can tap to close.
        minHeight: "55dvh",
        background: T.bgElev, color: T.text,
        borderTopLeftRadius: 28, borderTopRightRadius: 28,
        border: `1px solid ${T.border}`, borderBottom: "none",
        display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>
        {/* Drag handle */}
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 14 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: T.border }}/>
        </div>
        {/* Header */}
        <div style={{
          padding: "14px 20px 10px", display: "flex",
          justifyContent: "space-between", alignItems: "center",
        }}>
          <div style={{ fontFamily: FONT.display, fontSize: 18, fontWeight: 700, color: T.text }}>
            {tr("notif.title", lang)}
          </div>
          {items && items.length > 0 && (
            <button onClick={clearAll} disabled={busy} style={{
              background: "transparent", border: "none",
              color: T.textMute, fontFamily: FONT.sans, fontSize: 12, fontWeight: 600,
              cursor: busy ? "default" : "pointer",
            }}>{tr("notif.clear_all", lang)}</button>
          )}
        </div>
        <div style={{
          flex: 1, overflowY: "auto",
          padding: "0 16px 24px",
        }}>
          {items === null ? (
            <div style={{ padding: 40, textAlign: "center", color: T.textMute, fontFamily: FONT.sans, fontSize: 13 }}>
              {tr("common.loading", lang)}
            </div>
          ) : items.length === 0 ? (
            <div style={{
              padding: "40px 20px", textAlign: "center",
              fontFamily: FONT.sans, color: T.textMute,
            }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>🔔</div>
              <div style={{ fontFamily: FONT.display, fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 4 }}>
                {tr("notif.empty_title", lang)}
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                {tr("notif.empty_sub", lang)}
              </div>
            </div>
          ) : (
            <>
              {groups.today.length > 0 && (
                <NotifGroup T={T} label={tr("wallet.today", lang).toUpperCase()} items={groups.today} />
              )}
              {groups.earlier.length > 0 && (
                <NotifGroup T={T} label={tr("notif.earlier", lang).toUpperCase()} items={groups.earlier} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function NotifGroup({ T, label, items }) {
  return (
    <>
      <div style={{
        marginTop: 14, marginBottom: 8,
        fontFamily: FONT.sans, fontSize: 11, fontWeight: 700,
        color: T.textMute, letterSpacing: 0.6,
      }}>{label}</div>
      <div style={{
        background: T.surface, border: `1px solid ${T.border}`,
        borderRadius: 14, overflow: "hidden",
      }}>
        {items.map((n, i) => (
          <NotifRow key={n.id} T={T} n={n} isLast={i === items.length - 1} />
        ))}
      </div>
    </>
  );
}

function NotifRow({ T, n, isLast }) {
  // Per-kind glyph + tint. New kinds fall through to a neutral system bell.
  // Social kinds (social_like / social_repost / social_reply /
  // social_follow) are written by triggers in supabase/social_notifications.sql
  // when someone interacts with the user's posts or follows them.
  const meta = (() => {
    switch (n.kind) {
      case "price_alert":   return { emoji: "📈", tint: T.accent };
      case "aporte":        return { emoji: "💰", tint: "#C9A84C" };
      case "news":          return { emoji: "📰", tint: T.text };
      case "mention":       return { emoji: "@",  tint: T.accent };
      case "social_like":   return { emoji: "❤️", tint: T.danger };
      case "social_repost": return { emoji: "🔁", tint: T.accent };
      case "social_reply":  return { emoji: "💬", tint: T.accent };
      case "social_follow": return { emoji: "👤", tint: T.accent };
      default:              return { emoji: "🔔", tint: T.textMute };
    }
  })();
  const when = relativeWhen(n.createdAt);
  return (
    <div style={{
      padding: "12px 14px",
      borderBottom: isLast ? "none" : `1px solid ${T.border}`,
      display: "flex", gap: 12, alignItems: "flex-start",
      // Unread rows get a faint accent stripe + slightly bolder weight.
      background: n.readAt ? "transparent" : `${T.accent}08`,
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 10, flexShrink: 0,
        background: T.bgElev, color: meta.tint,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 16,
      }}>{meta.emoji}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: FONT.sans, fontSize: 13,
          fontWeight: n.readAt ? 600 : 700,
          color: T.text, marginBottom: 2,
        }}>
          {n.title}
        </div>
        {n.body && (
          <div style={{
            fontFamily: FONT.sans, fontSize: 12, color: T.textMute,
            lineHeight: 1.4,
          }}>{n.body}</div>
        )}
        <div style={{
          fontFamily: FONT.sans, fontSize: 10, color: T.textMute,
          marginTop: 4, opacity: 0.7,
        }}>{when}</div>
      </div>
    </div>
  );
}

function relativeWhen(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `hace ${days} d`;
  return new Date(ts).toLocaleDateString("es-AR", { day: "numeric", month: "short" });
}

// ----------------------------------------------------------
// Aporte mensual — modal to set / edit / cancel a recurring monthly
// deposit. Saves via walletApi.setRecurringAporte. The schedule is
// purely local for now (mock); production needs a server-side cron.
// ----------------------------------------------------------
function AporteModal({ T, lang = "es", aporte, onClose, onDone }) {
  const [amountStr, setAmountStr] = useState(String(aporte?.amount || ""));
  const [currency, setCurrency] = useState(aporte?.currency || "ARS");
  const [day, setDay] = useState(aporte?.dayOfMonth || 1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function save() {
    setErr(null);
    const amount = parseFloat(amountStr.replace(",", "."));
    if (!amount || amount <= 0) { setErr("Ingresá un monto válido."); return; }
    setBusy(true);
    try {
      await walletApi.setRecurringAporte({ amount, currency, dayOfMonth: day });
      onDone();
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  async function cancel() {
    if (!aporte) { onClose(); return; }
    if (!window.confirm("¿Cancelar el aporte mensual?")) return;
    setBusy(true);
    try {
      await walletApi.cancelRecurringAporte();
      onDone();
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 16,
    }}>
      <div style={{
        width: "100%", maxWidth: 480,
        background: T.bgElev, color: T.text,
        borderRadius: 22, border: `1px solid ${T.border}`,
        padding: 20,
      }}>
        <div style={{ fontFamily: FONT.display, fontSize: 20, fontWeight: 700, color: T.text, marginBottom: 4 }}>
          Aporte mensual
        </div>
        <div style={{ fontFamily: FONT.sans, fontSize: 12, color: T.textMute, marginBottom: 16 }}>
          Cargá un monto fijo cada mes. Se acredita en tu wallet automáticamente el día que elijas.
        </div>

        {/* Currency pill */}
        <div style={{
          display: "flex", gap: 4, padding: 4, marginBottom: 12,
          background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12,
        }}>
          {["ARS", "USD"].map((c) => (
            <button key={c} onClick={() => setCurrency(c)} style={{
              flex: 1, padding: "8px 0", borderRadius: 8,
              background: currency === c ? T.bg : "transparent",
              border: currency === c ? `1px solid ${T.border}` : "1px solid transparent",
              color: currency === c ? T.text : T.textMute,
              fontFamily: FONT.mono, fontSize: 12, fontWeight: 700, letterSpacing: 0.4, cursor: "pointer",
            }}>{c}</button>
          ))}
        </div>

        {/* Amount input */}
        <div style={{
          fontFamily: FONT.sans, fontSize: 11, color: T.textMute, fontWeight: 600,
          letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 6,
        }}>Monto ({currency})</div>
        <input
          autoFocus
          inputMode="decimal"
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value.replace(/[^\d,.]/g, ""))}
          placeholder={currency === "ARS" ? "50000" : "200"}
          style={{
            width: "100%", boxSizing: "border-box",
            padding: "14px 16px", borderRadius: 14, marginBottom: 16,
            background: T.surface, border: `1px solid ${T.border}`,
            color: T.text, fontFamily: FONT.mono, fontSize: 18, fontWeight: 700,
            outline: "none",
          }}
        />

        {/* Day of month */}
        <div style={{
          fontFamily: FONT.sans, fontSize: 11, color: T.textMute, fontWeight: 600,
          letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 6,
        }}>Día del mes</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          {[1, 5, 10, 15, 20, 25, 28].map((d) => {
            const active = d === day;
            return (
              <button key={d} onClick={() => setDay(d)} style={{
                padding: "8px 14px", borderRadius: 999,
                background: active ? T.accentSoft : T.surface,
                border: `1px solid ${active ? T.accent : T.border}`,
                color: active ? T.accent : T.textMute,
                fontFamily: FONT.mono, fontSize: 13, fontWeight: 700, cursor: "pointer",
              }}>{d}</button>
            );
          })}
        </div>

        {err && <div style={{ marginBottom: 12, color: T.danger, fontFamily: FONT.sans, fontSize: 12 }}>{err}</div>}

        <div style={{ display: "flex", gap: 10 }}>
          {aporte && (
            <button onClick={cancel} disabled={busy} style={{
              flex: 1, padding: 14, borderRadius: 14,
              background: "transparent", border: `1px solid ${T.danger}55`,
              color: T.danger, fontFamily: FONT.sans, fontSize: 13, fontWeight: 700,
              cursor: busy ? "default" : "pointer",
            }}>Cancelar aporte</button>
          )}
          <button onClick={save} disabled={busy} style={{
            flex: 1.4, padding: 14, borderRadius: 14,
            background: T.accent, color: T.accentInk,
            fontFamily: FONT.sans, fontSize: 14, fontWeight: 700, border: "none",
            cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
          }}>{busy ? "Guardando..." : (aporte ? "Actualizar" : "Programar")}</button>
        </div>
      </div>
    </div>
  );
}

// "Próximo aporte" relative date — "mañana", "en 5 días", or formatted.
function nextLabel(ts) {
  if (!ts) return "";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(ts); target.setHours(0, 0, 0, 0);
  const diffDays = Math.round((target - today) / (24 * 3600 * 1000));
  if (diffDays <= 0) return "hoy";
  if (diffDays === 1) return "mañana";
  if (diffDays <= 7) return `en ${diffDays} días`;
  return target.toLocaleDateString("es-AR", { day: "numeric", month: "short" });
}

// Compact "{day} {monthAbbrev}" formatter for the "Último aporte" line.
// Used when the user has had at least one credit fire — surfaces the
// fact that the schedule is alive and well.
function shortDate(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString("es-AR", { day: "numeric", month: "short" });
}

// ----------------------------------------------------------
// Action — quick-action button.
// ----------------------------------------------------------
function Action({ T, icon, label, onClick }) {
  return (
    <button onClick={onClick} style={{
      background: T.surface, border: `1px solid ${T.border}`,
      borderRadius: 18, padding: "14px 6px", cursor: "pointer",
      display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
      color: T.text, fontFamily: FONT.sans, fontSize: 12, fontWeight: 600,
    }}>
      <span style={{
        width: 36, height: 36, borderRadius: 12,
        background: T.accentSoft, color: T.accent,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>{icon}</span>
      {label}
    </button>
  );
}

// ----------------------------------------------------------
// Quote — single FX rate card.
// ----------------------------------------------------------
function Quote({ T, label, value, delta }) {
  return (
    <div style={{
      padding: "12px 14px", borderRadius: 16,
      background: T.surface, border: `1px solid ${T.border}`,
    }}>
      <div style={{
        fontFamily: FONT.sans, fontSize: 10, fontWeight: 700,
        color: T.textDim, letterSpacing: 0.6,
      }}>{label}</div>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline",
        marginTop: 4,
      }}>
        <span style={{
          fontFamily: FONT.mono, fontSize: 18, fontWeight: 700, color: T.text,
        }}>${fmtMoney(value, "ARS")}</span>
        <span style={{
          fontFamily: FONT.mono, fontSize: 11, fontWeight: 600,
          color: delta >= 0 ? T.accent : T.danger,
        }}>{fmtPct(delta)}</span>
      </div>
    </div>
  );
}

// ----------------------------------------------------------
// CardPreview — small visual of the card on the home screen.
// ----------------------------------------------------------
function CardPreview({ T, card, onClick }) {
  return (
    <button onClick={onClick} style={{
      position: "relative",
      width: "100%", marginTop: 12, padding: 18, borderRadius: 22,
      background: `linear-gradient(135deg, ${T.accentDim} 0%, ${T.surfaceHi} 100%)`,
      border: `1px solid ${T.border}`,
      display: "flex", flexDirection: "column", gap: 28,
      cursor: "pointer", color: T.text, textAlign: "left",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: FONT.sans, fontSize: 13, fontWeight: 700, letterSpacing: 1 }}>
          SAMAS
        </span>
        <span style={{ fontFamily: FONT.display, fontSize: 14, fontWeight: 800, letterSpacing: 1 }}>
          {card.network === "visa" ? "VISA" : "MC"}
        </span>
      </div>
      <div style={{
        fontFamily: FONT.mono, fontSize: 15, fontWeight: 700, letterSpacing: 2,
      }}>
        •••• •••• •••• {card.last4}
      </div>
      <div style={{
        display: "flex", justifyContent: "space-between",
        fontFamily: FONT.mono, fontSize: 10, color: T.textMute,
      }}>
        <span>{card.holderName}</span>
        <span>{String(card.expMonth).padStart(2, "0")}/{card.expYear}</span>
      </div>
      {card.status !== "active" && (
        <div style={{
          position: "absolute", top: 12, right: 18,
          fontFamily: FONT.mono, fontSize: 10, fontWeight: 700,
          padding: "3px 8px", borderRadius: 999,
          background: T.dangerSoft, color: T.danger,
        }}>{card.status === "frozen" ? "CONGELADA" : "BLOQUEADA"}</div>
      )}
    </button>
  );
}

// ----------------------------------------------------------
// TxnRow — single transaction line.
// ----------------------------------------------------------
function TxnRow({ t, T, isLast, visible }) {
  const isIn = t.type === "in";
  const isSwap = t.type === "swap";
  const sign = isIn ? "+" : isSwap ? "" : "−";
  const amountColor = isIn ? T.accent : T.text;

  let bg = T.surfaceHi;
  let icon = <Ico.Up size={16}/>;
  if (isIn)        { bg = T.accentSoft; icon = <Ico.Down size={16}/>; }
  else if (isSwap) {                    icon = <Ico.Repeat size={16}/>; }
  else if (t.cat === "invest") {        icon = <Ico.Chart size={16}/>; }

  return (
    <div style={{
      display: "flex", alignItems: "center", padding: "14px 16px", gap: 12,
      borderBottom: isLast ? "none" : `1px solid ${T.border}`,
    }}>
      <div style={{
        width: 38, height: 38, borderRadius: 12, background: bg,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: isIn ? T.accent : T.textMute,
      }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: FONT.sans, fontSize: 14, fontWeight: 600, color: T.text,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{t.who}</div>
        <div style={{
          fontFamily: FONT.sans, fontSize: 12, color: T.textMute,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{t.note} · {t.atLabel}</div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{
          fontFamily: FONT.mono, fontSize: 14, fontWeight: 700, color: amountColor,
        }}>
          {visible
            ? `${sign}${t.ccy === "ARS" ? "$" : "US$"}${fmtMoney(t.amount, t.ccy)}`
            : "••••"}
        </div>
        <div style={{
          fontFamily: FONT.mono, fontSize: 10, color: T.textDim, letterSpacing: 0.4,
        }}>{t.ccy}</div>
      </div>
    </div>
  );
}

// ============================================================
// MODALS
// ============================================================

function ModalShell({ T, title, onClose, children }) {
  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    }}>
      <div style={{
        width: "100%", maxWidth: 540, maxHeight: "92%",
        background: T.bgElev, color: T.text,
        borderTopLeftRadius: 28, borderTopRightRadius: 28,
        border: `1px solid ${T.border}`, borderBottom: "none",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "20px 20px 12px",
        }}>
          <div style={{
            fontFamily: FONT.display, fontSize: 22, fontWeight: 700,
            color: T.text, letterSpacing: -0.4,
          }}>{title}</div>
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
          overflowY: "auto",
        }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function DepositModal({ T, lang = "es", balance, onClose, onDone }) {
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState("mp");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function submit() {
    setErr(null);
    const n = parseFloat(amount);
    if (!n || n <= 0) { setErr("Ingresá un monto válido."); return; }
    setBusy(true);
    try {
      await walletApi.deposit({ amount: n, ccy: "ARS", source });
      onDone();
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <ModalShell T={T} title={tr("deposit.title", lang)} onClose={onClose}>
      <div style={{ fontFamily: FONT.sans, fontSize: 13, color: T.textMute, marginBottom: 16 }}>
        Acreditamos en pesos a tu cuenta SAMAS.
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[
          { id: "mp", label: "Mercado Pago" },
          { id: "transfer", label: "Transferencia" },
        ].map(s => (
          <button key={s.id} onClick={() => setSource(s.id)} style={{
            flex: 1, padding: "12px", borderRadius: 12,
            background: source === s.id ? T.accentSoft : T.surface,
            border: `1px solid ${source === s.id ? T.accent : T.border}`,
            color: source === s.id ? T.accent : T.text,
            fontFamily: FONT.sans, fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}>{s.label}</button>
        ))}
      </div>

      {source === "transfer" && balance && (
        <div style={{
          padding: 14, borderRadius: 14, background: T.surface, border: `1px solid ${T.border}`,
          marginBottom: 16,
        }}>
          <div style={{ fontFamily: FONT.sans, fontSize: 11, color: T.textMute, marginBottom: 4 }}>
            Tus datos para recibir
          </div>
          <div style={{ fontFamily: FONT.mono, fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 8 }}>
            Alias: <span style={{ color: T.accent }}>{balance.alias}</span>
          </div>
          <div style={{ fontFamily: FONT.mono, fontSize: 12, color: T.textMute }}>
            CVU: {balance.cvu}
          </div>
        </div>
      )}

      <NumberInput T={T} label="Monto (ARS)" value={amount} onChange={setAmount} />

      {err && <div style={{ marginTop: 12, color: T.danger, fontFamily: FONT.sans, fontSize: 12 }}>{err}</div>}

      <button onClick={submit} disabled={busy} style={{
        width: "100%", marginTop: 20, padding: 16, borderRadius: 14,
        background: T.accent, color: T.accentInk,
        fontFamily: FONT.sans, fontSize: 15, fontWeight: 700, border: "none",
        cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
      }}>
        {busy ? "Procesando..." : source === "mp" ? "Ir a Mercado Pago" : "Confirmar"}
      </button>
    </ModalShell>
  );
}

function WithdrawModal({ T, lang = "es", balance, onClose, onDone }) {
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function submit() {
    setErr(null);
    const n = parseFloat(amount);
    if (!n || n <= 0) { setErr("Monto inválido."); return; }
    if (!destination.trim()) { setErr("Indicá CBU o alias destino."); return; }
    setBusy(true);
    try {
      const isCbu = /^\d{22}$/.test(destination.trim());
      await walletApi.withdraw({
        amount: n, ccy: "ARS",
        destinationCbu: isCbu ? destination.trim() : undefined,
        destinationAlias: !isCbu ? destination.trim() : undefined,
      });
      onDone();
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  return (
    <ModalShell T={T} title={tr("withdraw.title", lang)} onClose={onClose}>
      <div style={{ fontFamily: FONT.sans, fontSize: 13, color: T.textMute, marginBottom: 16 }}>
        Saldo disponible: <strong style={{ color: T.text }}>${balance ? fmtMoney(balance.ars, "ARS") : "—"}</strong>
      </div>
      <NumberInput T={T} label="Monto (ARS)" value={amount} onChange={setAmount} />
      <div style={{ height: 14 }}/>
      <TextInput T={T} label="CBU o Alias destino" value={destination}
        onChange={setDestination} placeholder="ej: juan.perez.galicia" />

      {err && <div style={{ marginTop: 12, color: T.danger, fontFamily: FONT.sans, fontSize: 12 }}>{err}</div>}

      <button onClick={submit} disabled={busy} style={{
        width: "100%", marginTop: 20, padding: 16, borderRadius: 14,
        background: T.accent, color: T.accentInk,
        fontFamily: FONT.sans, fontSize: 15, fontWeight: 700, border: "none",
        cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
      }}>
        {busy ? "Enviando..." : "Enviar"}
      </button>
    </ModalShell>
  );
}

function CardDetailsModal({ T, lang = "es", card, onClose, onCardChange }) {
  const [revealed, setRevealed] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  // Auto-hide revealed PAN after 30s for security.
  useEffect(() => {
    if (!revealed) return;
    const t = setTimeout(() => setRevealed(null), 30_000);
    return () => clearTimeout(t);
  }, [revealed]);

  async function reveal() {
    setErr(null); setBusy(true);
    try {
      const r = await cardApi.revealCard();
      setRevealed(r);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  async function toggleFreeze() {
    setErr(null); setBusy(true);
    try {
      const r = card.status === "active"
        ? await cardApi.freezeCard()
        : await cardApi.unfreezeCard();
      onCardChange({ status: r.status });
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  return (
    <ModalShell T={T} title={tr("card.title", lang)} onClose={onClose}>
      <div style={{
        padding: 22, borderRadius: 18,
        background: `linear-gradient(135deg, ${T.accentDim} 0%, ${T.surfaceHi} 100%)`,
        border: `1px solid ${T.border}`,
        display: "flex", flexDirection: "column", gap: 32, marginBottom: 20,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{
            fontFamily: FONT.sans, fontSize: 14, fontWeight: 700,
            letterSpacing: 1.5, color: T.text,
          }}>SAMAS</span>
          <span style={{
            fontFamily: FONT.display, fontSize: 16, fontWeight: 800,
            letterSpacing: 1, color: T.text,
          }}>
            {card.network === "visa" ? "VISA" : "MC"}
          </span>
        </div>
        <div style={{
          fontFamily: FONT.mono, fontSize: 18, fontWeight: 700,
          letterSpacing: 2.5, color: T.text,
        }}>
          {revealed ? revealed.pan : `•••• •••• •••• ${card.last4}`}
        </div>
        <div style={{
          display: "flex", justifyContent: "space-between",
          fontFamily: FONT.mono, fontSize: 11, color: T.textMute,
        }}>
          <div>
            <div style={{ fontSize: 9, letterSpacing: 1 }}>TITULAR</div>
            <div style={{ color: T.text, marginTop: 2 }}>{card.holderName}</div>
          </div>
          <div>
            <div style={{ fontSize: 9, letterSpacing: 1 }}>VENCE</div>
            <div style={{ color: T.text, marginTop: 2 }}>
              {String(card.expMonth).padStart(2, "0")}/{card.expYear}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 9, letterSpacing: 1 }}>CVV</div>
            <div style={{ color: T.text, marginTop: 2 }}>{revealed ? revealed.cvv : "•••"}</div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={reveal} disabled={busy || !!revealed} style={{
          flex: 1, padding: 14, borderRadius: 12,
          background: T.surface, border: `1px solid ${T.border}`,
          color: T.text, fontFamily: FONT.sans, fontSize: 13, fontWeight: 600,
          cursor: busy ? "default" : "pointer", opacity: revealed ? 0.5 : 1,
        }}>
          {revealed ? "Visible 30s" : "Mostrar número"}
        </button>
        <button onClick={toggleFreeze} disabled={busy} style={{
          flex: 1, padding: 14, borderRadius: 12,
          background: card.status === "frozen" ? T.accentSoft : T.surface,
          border: `1px solid ${card.status === "frozen" ? T.accent : T.border}`,
          color: card.status === "frozen" ? T.accent : T.text,
          fontFamily: FONT.sans, fontSize: 13, fontWeight: 600,
          cursor: busy ? "default" : "pointer",
        }}>
          {card.status === "frozen" ? "Descongelar" : "Congelar"}
        </button>
      </div>

      {err && <div style={{ marginTop: 12, color: T.danger, fontFamily: FONT.sans, fontSize: 12 }}>{err}</div>}

      <div style={{
        marginTop: 20, padding: 14, borderRadius: 12,
        background: T.surface, border: `1px solid ${T.border}`,
      }}>
        <div style={{ fontFamily: FONT.sans, fontSize: 12, color: T.textMute, lineHeight: 1.5 }}>
          Tarjeta virtual prepaga. Al pagar online los fondos se debitan
          de tu balance ARS. Congelarla bloquea nuevos consumos sin afectar
          movimientos pendientes.
        </div>
      </div>
    </ModalShell>
  );
}

function NumberInput({ T, label, value, onChange }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{
        fontFamily: FONT.sans, fontSize: 11, color: T.textMute,
        marginBottom: 6, letterSpacing: 0.4,
      }}>{label}</div>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, "").replace(",", "."))}
        placeholder="0,00"
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

function TextInput({ T, label, value, onChange, placeholder }) {
  return (
    <label style={{ display: "block" }}>
      <div style={{
        fontFamily: FONT.sans, fontSize: 11, color: T.textMute,
        marginBottom: 6, letterSpacing: 0.4,
      }}>{label}</div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: "100%", boxSizing: "border-box",
          padding: "14px 16px", borderRadius: 14,
          background: T.surface, border: `1px solid ${T.border}`,
          color: T.text, fontFamily: FONT.sans, fontSize: 14, fontWeight: 500,
          outline: "none",
        }}
      />
    </label>
  );
}
