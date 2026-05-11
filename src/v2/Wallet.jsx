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

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import ReactDOM from "react-dom";
import { FONT, fmtMoney, fmtPct } from "./theme.js";
import { Ico } from "./icons.jsx";
import {
  Avatar, ChromeBtn, Pill, SectionHead, Sparkline, SAMAS_SPARKS, Skeleton,
  avatarPropsFor, DisclaimerStrip, useModalGuard,
} from "./shared.jsx";
import { arsToUva, fmtUva, uvaVsHistoryMessage, periodLabel } from "../lib/uva.js";
import { wallet as walletApi, card as cardApi, broker as brokerApi, notifications as notifApi } from "./api/index.js";
import { rowToNotif } from "./api/notifications.js";
import { supabase } from "../lib/supabase.js";
import { toast } from "./toast.jsx";
import { setRefreshHandler } from "./refreshRegistry.js";
import { t as tr } from "../lib/i18n.js";
import { useLivePortfolioRatio } from "./livePrices.jsx";
import { analyzePortfolio, chatPortfolio, dailyBrief, compareBenchmark, earningsWatch, proactiveInsights, quarterlyReview } from "../lib/ai.js";
import { isAIDisabled } from "../lib/aiConsent.js";
import { ObjetivosCard } from "./Objetivos.jsx";
import { HipoteticoCard } from "./Hipotetico.jsx";
import { StressTestCard } from "./StressTest.jsx";
import { BehaviorCard } from "./Behavior.jsx";
import { JournalCard } from "./Journal.jsx";
import { FCICard } from "./FCI.jsx";
import { EducationCard } from "./Education.jsx";
import { AIQuotaPill } from "./AIQuotaPill.jsx";
import { reauthWithPassword } from "../lib/reauth.js";
import { hapticNative } from "../lib/native.js";
import { useDragToDismiss } from "./useDragToDismiss.js";

export function WalletPage({ T, onTab, user, balanceVisible, setBalanceVisible, isDark, onToggleDark, onOpenSettings, onOpenTutorials, proMode = false, isPlus = false, onOpenProUpsell, lang = "es" }) {
  // ----------- data state -----------
  const [balance, setBalance] = useState(null);
  const [fx, setFx] = useState(null);
  const [card, setCard] = useState(null);
  const [txns, setTxns] = useState([]);
  const [portfolio, setPortfolio] = useState(null);
  const [aporte, setAporte] = useState(null);

  // Live drift on the portfolio total — proportional ratio derived
  // from the underlying assets ticking. Multiply portfolio.totalArs
  // / totalUsd by liveRatio.ratio to get the live-ticked totals.
  // Currency-agnostic: the same ratio applies to ARS and USD alike
  // since each holding's base price is in its own currency and the
  // hook computes the ratio as live/base, which cancels currency.
  const liveRatio = useLivePortfolioRatio(portfolio?.holdings);

  // Rolling 30-point buffer of live portfolio totals — drives the
  // Wallet hero sparkline so the chart visibly grows as the underlying
  // assets tick. We keep it on totalArs because the sparkline is
  // a shape, not a value (ARS vs USD doesn't matter — the line
  // looks the same either way), and ARS is always defined when
  // portfolio is loaded.
  const SPARK_BUFFER_LEN = 30;
  const [sparkBuffer, setSparkBuffer] = useState([]);
  useEffect(() => {
    if (!portfolio) return;
    // Seed the buffer the first time portfolio loads so the chart
    // doesn't start as a single dot. Repeats the static total
    // 8 times so the line has shape immediately; subsequent ticks
    // append the live value and slide the seed out.
    if (sparkBuffer.length === 0) {
      setSparkBuffer(Array(8).fill(portfolio.totalArs));
      return;
    }
    if (liveRatio.tickCount > 0) {
      setSparkBuffer((prev) => {
        const next = [...prev, portfolio.totalArs * liveRatio.ratio];
        return next.length > SPARK_BUFFER_LEN ? next.slice(-SPARK_BUFFER_LEN) : next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveRatio.tickCount, portfolio?.totalArs]);

  // ----------- UI state -----------
  const [ccy, setCcy] = useState("ARS");
  // samas-0.4.33: si el user estaba en UVA (Pro) y desactiva Pro, el
  // chip "UVA" desaparece pero el ccy queda colgado. Reset a USD
  // automáticamente para que el balance display vuelva a algo válido.
  useEffect(() => {
    if (!proMode && ccy === "UVA") setCcy("USD");
  }, [proMode, ccy]);
  const [activeModal, setActiveModal] = useState(null); // "deposit" | "withdraw" | "card" | "aporte" | "inbox" | "txns_all" | null
  // AI master switch state (samas-0.4.11) — drives whether the ?
  // Explain button + AI cards render. Listens for the
  // samas:ai-disabled-changed broadcast so a Settings flip
  // immediately updates the Wallet without a re-mount.
  const [aiDisabled, setAiDisabled] = useState(() => isAIDisabled());
  useEffect(() => {
    function onChange(e) { setAiDisabled(!!e?.detail?.disabled); }
    window.addEventListener("samas:ai-disabled-changed", onChange);
    return () => window.removeEventListener("samas:ai-disabled-changed", onChange);
  }, []);
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
  // In-flight ref coalesces concurrent refresh() calls (samas-0.4.5).
  // Pull-to-refresh + tab-resume + initial mount can fire in the same
  // tick on iOS app foreground; without this guard each call would
  // run 6 redundant API requests and the UI would briefly flicker
  // through two near-identical state snapshots. Promise.all results
  // are stored on the ref so multiple awaiters share the same fetch.
  const walletRefreshInFlight = React.useRef(null);
  const refresh = useCallback(async () => {
    if (walletRefreshInFlight.current) return walletRefreshInFlight.current;
    const p = (async () => {
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
      } finally {
        walletRefreshInFlight.current = null;
      }
    })();
    walletRefreshInFlight.current = p;
    return p;
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Register refresh under the "wallet" tab id so the parent Shell's
  // pull-to-refresh can invoke it.
  useEffect(() => setRefreshHandler("wallet", refresh), [refresh]);

  // Realtime: when a new transactions row hits this user (a trade
  // fill in Broker, an aporte cron credit, a swap), call refresh()
  // so the Movimientos list + balance + portfolio all re-fetch.
  // samas-0.4.10. Without this, the Wallet stayed stale until the
  // user pulled to refresh manually.
  useEffect(() => {
    let alive = true;
    let channel = null;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id;
      if (!uid || !alive) return;
      channel = supabase
        .channel(`wallet-tx-${uid}`)
        .on("postgres_changes", {
          event: "INSERT",
          schema: "public",
          table: "transactions",
          filter: `user_id=eq.${uid}`,
        }, () => {
          if (alive) refresh();
        })
        .subscribe();
    })();
    return () => {
      alive = false;
      if (channel) supabase.removeChannel(channel);
    };
  }, [refresh]);

  // ----------- derived -----------
  const userName = user?.name?.split(" ")[0] || "Usuario";
  const userInitials = user?.initials || "??";
  const avatarColor = user?.avatarColor || "oklch(0.78 0.16 145)";
  // UVA derived from current ARS balance (samas-0.4.26). When ccy
  // is "UVA", we show the user's nominal ARS in inflation-indexed
  // units. The hero card also surfaces a "vs 6 meses atrás" line
  // so the user immediately sees how much real value they've lost
  // by sitting in nominal pesos.
  const balanceValue = balance
    ? (ccy === "ARS" ? balance.ars
       : ccy === "USD" ? balance.usd
       : ccy === "UVA" ? arsToUva(balance.ars)
       : balance.ars)
    : null;
  const uvaCompare = ccy === "UVA" && balance?.ars > 0
    ? uvaVsHistoryMessage(balance.ars, "m6")
    : null;

  return (
    <div style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 96px)" }}>
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
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              fontFamily: FONT.sans, fontSize: 12, color: T.textMute,
            }}>
              <span>{tr("greeting_prefix", lang)}</span>
              {/* samas-0.4.37: Mode chip. Manuel pidió que sea visible
                  qué UI mode está activo. Tap el avatar (que ya abre
                  Settings) lleva a switchearlo. */}
              <span style={{
                padding: "1px 6px", borderRadius: 999,
                background: proMode ? T.accent : T.bg,
                color: proMode ? T.accentInk : T.textMute,
                border: proMode ? "none" : `1px solid ${T.border}`,
                fontFamily: FONT.mono, fontSize: 9, fontWeight: 800,
                letterSpacing: 0.6, textTransform: "uppercase",
              }}>{proMode ? "PRO" : "LITE"}</span>
            </div>
            <div style={{ fontFamily: FONT.sans, fontSize: 16, fontWeight: 700, color: T.text }}>{userName}</div>
          </div>
        </button>
        {/* Header buttons. Tightened from 8→6 gap (samas-0.4.4) so
            4 buttons (theme + Search + ? + Bell) at 40px each fit
            comfortably alongside the avatar+greeting on iPhone SE
            (320px) — 4×40 + 3×6 = 178px right column, 134px left =
            312px, fits in 280px usable. Was 184px right column on
            8px gap — overflowed. */}
        <div style={{ display: "flex", gap: 6 }}>
          {onToggleDark && (
            <ChromeBtn T={T} onClick={onToggleDark}>
              {isDark ? <Ico.Sun size={18}/> : <Ico.Moon size={18}/>}
            </ChromeBtn>
          )}
          {/* Search ChromeBtn was here through 0.4.5 with no onClick —
              decorative-only. Removed in 0.4.6 (Manuel's "make sure
              there's nothing useless"). The ? Explain button below is
              the actual go-to-find-something surface now. If real
              global search lands later, it gets a working onClick. */}

          {/* Explain-a-term button (samas-0.4.2). Opens a global
              modal with a text input → IA returns a definition in
              plain AR-Spanish. Dispatching a window event lets any
              other component pop the same modal in the future.
              Hidden when AI is globally disabled (samas-0.4.11). */}
          {!aiDisabled && (
            <ChromeBtn
              T={T}
              onClick={() => {
                try {
                  window.dispatchEvent(new CustomEvent("samas:explain-term", { detail: {} }));
                } catch (_) { /* SSR */ }
              }}
              aria-label={tr("explain.aria_open", lang)}
            >
              <span style={{
                fontFamily: FONT.display, fontSize: 16, fontWeight: 800, color: T.text,
                lineHeight: 1, padding: 0,
              }}>?</span>
            </ChromeBtn>
          )}
          <ChromeBtn T={T} dot={unread > 0} onClick={() => setActiveModal("inbox")}>
            <Ico.Bell size={18}/>
          </ChromeBtn>
        </div>
      </div>

      {/* ---------- AI Daily Brief (samas-0.1.6) ----------
          Top-of-screen greeting with portfolio context. Auto-loads
          on every Wallet mount, cached client-side for ~12 hours so
          rapid re-mounts don't re-call. Only shown when there's a
          non-empty portfolio (no point in a brief about nothing). */}
      {!aiDisabled && portfolio && portfolio.totalUsd > 0 && (
        <DailyBriefCard T={T} lang={lang} />
      )}

      {/* ---------- balance card (samas-0.4.39: flat-style) ----------
          Manuel: "tiene que dejar de parecer vibe-coded". Removí el
          gradient + glow orb que tenía esta card. Ahora es flat
          T.surface con un solo border accent — el balance es el
          número más importante de la pantalla, no necesita efectos
          decorativos para llamar la atención. */}
      <div style={{
        margin: "24px 16px 0", padding: 24, borderRadius: 28,
        background: T.surface,
        border: `1px solid ${T.border}`,
        position: "relative", overflow: "hidden",
      }}>
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
              {/* UVA added in samas-0.4.26 — third unit alongside
                  ARS / USD. Shows the user's value in inflation-
                  indexed units. Argentine ALyC differentiator.
                  samas-0.4.33: solo visible en Pro mode. Per Rolan,
                  el Lite es Cocos-clone simple — no metric toggles. */}
              {(proMode ? ["ARS", "USD", "UVA"] : ["ARS", "USD"]).map(c => (
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
              {ccy === "ARS" ? "$" : ccy === "USD" ? "US$" : ""}
            </span>
            <span style={{
              fontFamily: FONT.display, fontSize: 40, fontWeight: 700, color: T.text,
              letterSpacing: -1.5, fontVariantNumeric: "tabular-nums",
            }}>
              {balanceValue == null
                ? "—"
                : balanceVisible
                  ? (ccy === "UVA" ? fmtUva(balanceValue) : fmtMoney(balanceValue, ccy))
                  : "••••••"}
            </span>
            {ccy === "UVA" && (
              <span style={{
                fontFamily: FONT.mono, fontSize: 12, color: T.textMute, fontWeight: 600,
                marginLeft: 4,
              }}>UVA</span>
            )}
          </div>

          {/* UVA-specific historical comparison (samas-0.4.26).
              Tells the user how much real purchasing power they've
              lost by holding nominal pesos. Fades in on mode switch
              instead of stacking on top of the regular delta line. */}
          {ccy === "UVA" && uvaCompare && balanceVisible && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                fontFamily: FONT.mono, fontSize: 12, fontWeight: 600,
                color: uvaCompare.lossPct < 0 ? T.danger : T.accent,
                padding: "3px 8px", borderRadius: 6,
                background: uvaCompare.lossPct < 0 ? T.dangerSoft : T.accentSoft,
                whiteSpace: "nowrap",
              }}>
                {uvaCompare.lossPct >= 0 ? "↑" : "↓"} {Math.abs(uvaCompare.lossPct).toFixed(1)}%
              </span>
              <span style={{ fontFamily: FONT.sans, fontSize: 12, color: T.textMute }}>
                {tr("wallet.uva.vs_history", lang, { period: periodLabel(uvaCompare.period) })}
              </span>
            </div>
          )}

          {ccy !== "UVA" && portfolio && (
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

      {/* ---------- Plus upsell hint card (samas-0.2.7) ----------
          Only when the user is NOT subscribed to SAMAS Plus —
          pushes them toward the Plus pitch (advisor positioning).
          Was gated on !proMode in earlier patches when "Pro" still
          meant the paid tier; now Pro is the free UI density toggle
          and Plus is the paid AI subscription. Sits between FX and
          portfolio peek so it's visible above the fold without
          competing with the hero balance card. */}
      {!isPlus && onOpenProUpsell && (
        <button
          onClick={onOpenProUpsell}
          style={{
            display: "flex", alignItems: "center", gap: 14,
            margin: "16px 16px 0", padding: "14px 16px",
            borderRadius: 18, cursor: "pointer", textAlign: "left",
            width: "calc(100% - 32px)",
            background: T.surface,
            border: `1px solid ${T.border}`,
            color: T.text,
          }}
        >
          <div style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            background: T.accent, color: T.accentInk,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, fontWeight: 800,
          }}>★</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: FONT.display, fontSize: 14, fontWeight: 700,
              color: T.text, marginBottom: 2,
            }}>{tr("pro.upsell.hint.title", lang)}</div>
            <div style={{
              fontFamily: FONT.sans, fontSize: 12, color: T.textMute,
              lineHeight: 1.4,
              overflow: "hidden", textOverflow: "ellipsis",
              display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
            }}>{tr("pro.upsell.hint.sub", lang)}</div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.textMute}
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
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
              {/* Live-ticked portfolio total. We multiply the static
                  pre-computed totalArs/totalUsd by liveRatio.ratio
                  so both currencies move proportionally as the
                  underlying assets tick. The key={liveRatio.tickCount}
                  re-mounts the cell each tick so the green/red
                  flash keyframe re-runs from the start. */}
              <div
                key={liveRatio.tickCount}
                style={{
                  fontFamily: FONT.display, fontSize: 22, fontWeight: 700, color: T.text,
                  letterSpacing: -0.6, fontVariantNumeric: "tabular-nums",
                  display: "inline-block",
                  borderRadius: 6,
                  padding: "0 6px",
                  margin: "0 -6px",
                  ...(liveRatio.sign !== "flat"
                    ? { animation: `samas-tick-${liveRatio.sign} 600ms ease-out` }
                    : {}),
                }}
              >
                {ccy === "ARS"
                  ? `$${fmtMoney(portfolio.totalArs * liveRatio.ratio, "ARS")}`
                  : `US$${fmtMoney(portfolio.totalUsd * liveRatio.ratio, "USD")}`}
              </div>
              <div style={{
                fontFamily: FONT.mono, fontSize: 12, color: T.textMute, marginTop: 2,
                fontVariantNumeric: "tabular-nums",
              }}>
                {ccy === "ARS"
                  ? `≈ US$${fmtMoney(portfolio.totalUsd * liveRatio.ratio, "USD")}`
                  : `≈ $${fmtMoney(portfolio.totalArs * liveRatio.ratio, "ARS")}`}
              </div>
              {/* Return chip — was a static "+2.34%" before 0.0.68;
                  now derived from a fake 30-day baseline + the live
                  session drift so it stays in sync with the ticking
                  total above (no jarring "+2.34%" green while the
                  total just ticked down). Solid-fill pill matches
                  the AssetRow aesthetic from 0.0.66. */}
              {(() => {
                const baseline = 2.34;
                const sessionPct = (liveRatio.ratio - 1) * 100;
                const totalPct = baseline + sessionPct;
                const positive = totalPct >= 0;
                const sign = positive ? "+" : "";
                return (
                  <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
                    <span style={{
                      fontFamily: FONT.mono, fontSize: 11, fontWeight: 700,
                      padding: "3px 9px", borderRadius: 6,
                      color: "#ffffff",
                      background: positive ? T.accent : T.danger,
                      letterSpacing: 0.2,
                      fontVariantNumeric: "tabular-nums",
                    }}>{sign}{totalPct.toFixed(2)}%</span>
                    <Pill T={T}>{tr("wallet.last_30d", lang)}</Pill>
                  </div>
                );
              })()}
            </div>
            {/* Live-growing portfolio sparkline. Each tick appends a
                point and the line slides left after 30 ticks (~75s
                of session). Color tracks the recent direction:
                accent green when the latest point is above the
                first, danger red when below. Falls back to the
                static SAMAS_SPARKS.bull only on the very first
                render before the buffer seeds. */}
            <Sparkline
              data={sparkBuffer.length >= 2 ? sparkBuffer : SAMAS_SPARKS.bull}
              color={
                sparkBuffer.length >= 2 && sparkBuffer[sparkBuffer.length - 1] < sparkBuffer[0]
                  ? T.danger
                  : T.accent
              }
              w={90} h={42} sw={2}
            />
          </div>
        </div>
      )}

      {/* Mis FCI (samas-0.4.34 → 0.4.37: gated to Pro).
          Inicialmente lo había puesto en primera plana del Lite por
          la spec de Rolan, pero Manuel revisó la UI y decidió que el
          Lite Wallet va con menos cards (balance + cartera + Aprendé
          + disciplina + Objetivos + AI Chat + Aporte). FCI sigue
          accesible vía Invertir → Mercado → filter chip "FCI". */}
      {proMode && (
        <FCICard
          T={T} lang={lang}
          onSelectAsset={(asset) => {
            if (!asset?.ticker) return;
            try {
              localStorage.setItem(
                "samas_pending_open_asset",
                JSON.stringify({ ticker: asset.ticker, ts: Date.now() }),
              );
            } catch (_e) { /* ignore */ }
            window.dispatchEvent(new CustomEvent("samas:open-asset", {
              detail: { ticker: asset.ticker },
            }));
            if (onTab) onTab("broker");
          }}
        />
      )}

      {/* Education (samas-0.4.35) — Duolingo-style entry point a la
          Tutorials hub. Per Rolan's spec, education en primera
          plana del Lite. Visible para todos. Stats live (XP +
          streak + completed/total) preview el progreso del user. */}
      {onOpenTutorials && (
        <EducationCard T={T} lang={lang} onOpen={onOpenTutorials} />
      )}

      {/* ---------- Cash flow (samas-0.4.15 → 0.4.33: re-gated Pro) ----------
          Originalmente lo había promovido a Lite por feedback del padre
          de Manuel. Rolan (asesor de Manuel) revisó la app entera y
          recomendó: "Saca el cash flow [del Lite]. Saca todas las
          metricas. Lite = Cocos-clone con AI + education." Tiene
          razón sobre el target: un usuario Lite que recién empieza
          no entiende un cashflow chart, lo abruma. Pro mode lo sigue
          mostrando para los que sí entienden el valor. */}
      {proMode && portfolio && portfolio.totalUsd > 0 && (
        <CashFlowBars T={T} portfolio={portfolio} lang={lang} />
      )}

      {/* ---------- Pro Wallet dashboard (samas-0.0.46) ----------
          Month/dividend/tax cards. Pro-only desde siempre. */}
      {proMode && portfolio && portfolio.totalUsd > 0 && (
        <>
          <div style={{ display: "flex", gap: 8, margin: "12px 16px 0" }}>
            <MonthPnLCard T={T} portfolio={portfolio} lang={lang} />
            <DividendCard T={T} portfolio={portfolio} lang={lang} />
          </div>
          <TaxYearCard T={T} portfolio={portfolio} lang={lang} />
        </>
      )}

      {/* ---------- AI cards LITE-FRIENDLY (samas-0.4.33 → 0.4.37) ----------
          Cards de IA narrativas / beginner-friendly. Manuel quitó
          AIAnalysisCard de Lite en 0.4.37 — la lectura "headline + 3
          bullets + suggestion" es overkill para un beginner que ya
          tiene AIChatCard para preguntar lo mismo de forma natural. */}
      {!aiDisabled && portfolio && portfolio.totalUsd > 0 && (
        <>
          {/* Behavior watch (0.4.28) — anti-overtrading nudge. Stays
              in Lite porque protege al beginner de sí mismo, exactly
              el target audience del Lite. */}
          <BehaviorCard T={T} lang={lang} />
          {/* Objetivos con IA — goal wizard. Beginner-friendly. */}
          <ObjetivosCard T={T} lang={lang} />
          {/* Preguntale a SAMAS — multi-turn Q&A. Beginner-friendly. */}
          <AIChatCard T={T} lang={lang} />
        </>
      )}

      {/* ---------- AI cards PRO-ONLY (samas-0.4.33 → 0.4.37) ----------
          Cards con métricas / análisis avanzado / herramientas
          asesor-class. Per Rolan: "Saca todas las metricas" del Lite.
          AIAnalysisCard movido aquí en 0.4.37. */}
      {proMode && !aiDisabled && portfolio && portfolio.totalUsd > 0 && (
        <>
          <AIAnalysisCard T={T} lang={lang} />
          {/* Benchmark compare — "am I beating the market?" (0.1.7). */}
          <BenchmarkCompareCard T={T} lang={lang} />
          {/* Earnings watch — upcoming reports for held tickers (0.1.8). */}
          <EarningsWatchCard T={T} lang={lang} />
          {/* Quarterly review — 90-day narrative summary (0.2.4). */}
          <QuarterlyReviewCard T={T} lang={lang} />
          {/* Trade Journal (0.4.29) — métricas de trading (win rate,
              P/L). Pro-only por ser asesor-class. */}
          <JournalCard T={T} lang={lang} />
        </>
      )}

      {/* Portafolio Hipotético (0.4.22) — backtest tool. Pro desde
          0.4.33 — calcula returns con bands, es métrica pesada que
          confunde al beginner. */}
      {proMode && <HipoteticoCard T={T} lang={lang} />}

      {/* Stress test histórico (0.4.27) — pregunta "cómo aguantó tu
          cartera el corralito". Pro desde 0.4.33 — concepto avanzado,
          el beginner no tiene base mental para entender drawdowns
          históricos. */}
      {proMode && <StressTestCard T={T} lang={lang} portfolio={portfolio} />}

      {/* ---------- aporte mensual ---------- */}
      <div style={{ margin: "28px 16px 0" }}>
        <SectionHead T={T} title={tr("wallet.section.aporte", lang)} />
        <button
          onClick={() => setActiveModal("aporte")}
          style={{
            width: "100%", marginTop: 12, padding: 16, borderRadius: 22,
            background: aporte ? T.accentSoft : T.surface,
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
        <SectionHead
          T={T}
          title={tr("wallet.section.txns", lang)}
          action={tr("wallet.see_all", lang)}
          onAction={() => setActiveModal("txns_all")}
        />
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

      {/* ---------- Lite → Pro discoverability hint (samas-0.4.41) ----------
          Lite es default, y Settings está al pie. Para un user nuevo
          (incluyendo Cohen reps en el demo), no hay forma fácil de
          enterarse que existe un Modo Pro con flujo de fondos, métricas,
          stress test, journal, hipotético, UVA. Esta tira chiquita al
          pie del Wallet hace explícita esa puerta — tap abre Settings,
          donde el segmented control de UI activa los espera. */}
      {!proMode && onOpenSettings && (
        <div style={{ margin: "28px 16px 0" }}>
          <button
            onClick={onOpenSettings}
            style={{
              width: "100%", padding: "14px 16px", borderRadius: 18,
              background: T.surface, border: `1px solid ${T.border}`,
              display: "flex", alignItems: "center", gap: 12, cursor: "pointer",
              textAlign: "left",
            }}
          >
            <div style={{
              width: 36, height: 36, borderRadius: 10, flexShrink: 0,
              background: T.accentSoft, color: T.accent,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: FONT.display, fontSize: 11, fontWeight: 800,
              letterSpacing: 0.4,
            }}>
              PRO
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: FONT.sans, fontSize: 13, fontWeight: 700, color: T.text }}>
                {tr("wallet.lite_hint.title", lang)}
              </div>
              <div style={{ fontFamily: FONT.sans, fontSize: 11, color: T.textMute, marginTop: 2, lineHeight: 1.4 }}>
                {tr("wallet.lite_hint.body", lang)}
              </div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.textMute}
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        </div>
      )}

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
      {activeModal === "txns_all" && (
        <TxnsAllSheet T={T} lang={lang} balanceVisible={balanceVisible}
          onClose={() => setActiveModal(null)} />
      )}
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
// ============================================================
// PRO WALLET (samas-0.0.46)
// ============================================================
// Four new cards rendered in WalletPage when proMode is true.
// All values are derived from holdings + a deterministic seed so
// they're stable across renders within a session and shift with
// the user's actual portfolio. When we onboard with Cohen and get
// real tx data + dividend feeds + tax events, swap each helper's
// body for an API call — the prop shapes don't need to change.
//
//   1. CashFlowBars     — 6-month deposits/withdrawals bar chart.
//   2. MonthPnLCard     — this-month return vs last month.
//   3. DividendCard     — next upcoming dividend payment.
//   4. TaxYearCard      — YTD realized + unrealized P&L.
// ============================================================

// Stable per-portfolio seeded RNG. Keyed off a hash of the
// holdings + total so two different portfolios get different
// numbers but the same one stays consistent.
//
// Defensive: a missing/null portfolio falls back to a constant seed
// so the consumers never crash. They render with stable but
// arbitrary numbers in that case — though all the call sites are
// gated on `portfolio && portfolio.totalUsd > 0` so this branch
// is mostly belt-and-suspenders.
function portfolioSeed(portfolio, salt = 0) {
  if (!portfolio) {
    let fallbackH = (1234567 ^ salt) >>> 0;
    return () => {
      fallbackH = (fallbackH + 0x6D2B79F5) >>> 0;
      let t = fallbackH;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const tickers = (portfolio.holdings || []).map((h) => h.ticker).join("|");
  let h = 0;
  for (let i = 0; i < tickers.length; i++) {
    h = ((h << 5) - h + tickers.charCodeAt(i)) | 0;
  }
  h = ((h ^ Math.round(portfolio.totalUsd || 0)) ^ salt) >>> 0;
  return () => {
    h = (h + 0x6D2B79F5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function CashFlowBars({ T, portfolio, lang = "es" }) {
  // 6 months of deposits + withdrawals, scaled to the size of
  // the portfolio so a $10K cartera doesn't show $50K bars.
  const data = useMemo(() => {
    const rng = portfolioSeed(portfolio, 11);
    const baseUsd = Math.max(500, (portfolio?.totalUsd || 0) * 0.08);
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const inAmt = baseUsd * (0.5 + rng() * 1.4);
      // Withdrawals happen ~40% of months and are smaller than deposits.
      const out = rng() < 0.4 ? baseUsd * (0.2 + rng() * 0.5) : 0;
      months.push({
        label: d.toLocaleDateString("es-AR", { month: "short" }),
        in: inAmt,
        out,
      });
    }
    return months;
  }, [portfolio]);
  const totalIn = data.reduce((s, m) => s + m.in, 0);
  const totalOut = data.reduce((s, m) => s + m.out, 0);
  const net = totalIn - totalOut;
  const max = Math.max(...data.map((m) => Math.max(m.in, m.out))) || 1;
  return (
    <div style={{ margin: "28px 16px 0" }}>
      <SectionHead T={T} title={tr("pro.wallet.cashflow.title", lang)} />
      <div style={{
        marginTop: 12, padding: 16, borderRadius: 22,
        background: T.surface, border: `1px solid ${T.border}`,
      }}>
        <div style={{
          display: "flex", justifyContent: "space-between",
          marginBottom: 14,
        }}>
          <Stat3 T={T} label={tr("pro.wallet.cashflow.in", lang)}
            value={`+US$${fmtMoney(totalIn, "USD")}`} color={T.accent} />
          <Stat3 T={T} label={tr("pro.wallet.cashflow.out", lang)}
            value={`-US$${fmtMoney(totalOut, "USD")}`} color={T.danger} />
          <Stat3 T={T} label={tr("pro.wallet.cashflow.net", lang)}
            value={`${net >= 0 ? "+" : "-"}US$${fmtMoney(Math.abs(net), "USD")}`}
            color={net >= 0 ? T.accent : T.danger} />
        </div>
        {/* Paired bars per month — green up for deposits, red down
            for withdrawals on a center axis so the visual reads
            as "money in vs money out" rather than two separate
            stacked series. */}
        <div style={{
          display: "flex", alignItems: "stretch",
          gap: 6, height: 100,
        }}>
          {data.map((m, i) => {
            const inH = (m.in / max) * 44;
            const outH = (m.out / max) * 44;
            return (
              <div key={i} style={{
                flex: 1, display: "flex", flexDirection: "column",
                alignItems: "center", gap: 2,
              }}>
                <div style={{
                  width: "70%", height: 44,
                  display: "flex", flexDirection: "column", justifyContent: "flex-end",
                }}>
                  <div style={{
                    width: "100%", height: inH, background: T.accent,
                    borderRadius: "4px 4px 0 0",
                  }}/>
                </div>
                <div style={{
                  width: "70%", height: 44,
                  display: "flex", flexDirection: "column", justifyContent: "flex-start",
                }}>
                  <div style={{
                    width: "100%", height: outH, background: T.danger,
                    borderRadius: "0 0 4px 4px", opacity: outH > 0 ? 1 : 0,
                  }}/>
                </div>
                <div style={{
                  fontFamily: FONT.mono, fontSize: 9, color: T.textMute,
                  fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase",
                }}>{m.label}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Stat3({ T, label, value, color }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{
        fontFamily: FONT.sans, fontSize: 10, fontWeight: 700,
        color: T.textMute, letterSpacing: 0.4, textTransform: "uppercase",
      }}>{label}</div>
      <div style={{
        fontFamily: FONT.mono, fontSize: 13, fontWeight: 700,
        color: color || T.text, marginTop: 2,
        fontVariantNumeric: "tabular-nums",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{value}</div>
    </div>
  );
}

function MonthPnLCard({ T, portfolio, lang = "es" }) {
  const { thisMonth, lastMonth, delta } = useMemo(() => {
    const rng = portfolioSeed(portfolio, 23);
    // Sythesize: this month's return = ±0–6% scaled by portfolio size.
    const tot = portfolio?.totalUsd || 1000;
    const tm = (rng() - 0.4) * 0.08 * tot; // skewed slightly positive
    const lm = (rng() - 0.5) * 0.08 * tot;
    return { thisMonth: tm, lastMonth: lm, delta: tm - lm };
  }, [portfolio]);
  const up = thisMonth >= 0;
  return (
    <div style={{
      flex: 1, padding: 14, borderRadius: 18,
      background: T.surface, border: `1px solid ${T.border}`,
      display: "flex", flexDirection: "column", gap: 6, minWidth: 0,
    }}>
      <div style={{
        fontFamily: FONT.sans, fontSize: 10, fontWeight: 700,
        color: T.textMute, letterSpacing: 0.4, textTransform: "uppercase",
      }}>{tr("pro.wallet.month_pnl.title", lang)}</div>
      <div style={{
        fontFamily: FONT.display, fontSize: 20, fontWeight: 700,
        color: up ? T.accent : T.danger, letterSpacing: -0.4,
        fontVariantNumeric: "tabular-nums",
      }}>{up ? "+" : "-"}US${fmtMoney(Math.abs(thisMonth), "USD")}</div>
      <div style={{
        fontFamily: FONT.mono, fontSize: 11, color: T.textMute,
        fontVariantNumeric: "tabular-nums",
      }}>
        {delta >= 0 ? "▲" : "▼"} US${fmtMoney(Math.abs(delta), "USD")} {tr("pro.wallet.month_pnl.vs", lang)}
      </div>
    </div>
  );
}

function DividendCard({ T, portfolio, lang = "es" }) {
  // Pick the first dividend-paying holding; if none, show empty.
  const div = useMemo(() => {
    const rng = portfolioSeed(portfolio, 47);
    const dividendPayers = (portfolio?.holdings || []).filter((h) =>
      ["AAPL", "MSFT", "KO", "PG", "GGAL", "YPF"].includes(h.ticker) ||
      h.category === "ETF" || h.category === "BONO"
    );
    if (dividendPayers.length === 0) return null;
    const idx = Math.floor(rng() * dividendPayers.length);
    const h = dividendPayers[idx];
    const yieldRate = 0.005 + rng() * 0.025; // 0.5%–3% per quarter
    const amount = h.value * yieldRate;
    const days = 5 + Math.floor(rng() * 25);
    const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    return { ticker: h.ticker, currency: h.currency, amount, date, days };
  }, [portfolio]);
  return (
    <div style={{
      flex: 1, padding: 14, borderRadius: 18,
      background: T.surface, border: `1px solid ${T.border}`,
      display: "flex", flexDirection: "column", gap: 6, minWidth: 0,
    }}>
      <div style={{
        fontFamily: FONT.sans, fontSize: 10, fontWeight: 700,
        color: T.textMute, letterSpacing: 0.4, textTransform: "uppercase",
      }}>{tr("pro.wallet.dividends.title", lang)}</div>
      {div ? (
        <>
          <div style={{
            fontFamily: FONT.display, fontSize: 20, fontWeight: 700,
            color: T.text, letterSpacing: -0.4,
            fontVariantNumeric: "tabular-nums",
          }}>
            {div.currency === "ARS" ? "$" : "US$"}{fmtMoney(div.amount, div.currency)}
          </div>
          <div style={{
            fontFamily: FONT.mono, fontSize: 11, color: T.textMute,
            display: "flex", gap: 6, flexWrap: "wrap",
          }}>
            <span style={{ color: T.accent, fontWeight: 700 }}>{div.ticker}</span>
            <span>· {div.date.toLocaleDateString("es-AR", { day: "2-digit", month: "short" })}</span>
          </div>
        </>
      ) : (
        <div style={{
          fontFamily: FONT.sans, fontSize: 12, color: T.textMute,
          marginTop: 6, lineHeight: 1.4,
        }}>{tr("pro.wallet.dividends.empty", lang)}</div>
      )}
    </div>
  );
}

function TaxYearCard({ T, portfolio, lang = "es" }) {
  const { realized, unrealized, year } = useMemo(() => {
    const rng = portfolioSeed(portfolio, 71);
    const tot = portfolio?.totalUsd || 0;
    return {
      realized: (rng() - 0.4) * 0.04 * tot,
      // Sum of unrealized comes from holdings.gainAbs converted to USD.
      unrealized: (portfolio?.holdings || []).reduce((s, h) => {
        const gainUsd = h.currency === "ARS" ? (h.gainAbs / 1248) : h.gainAbs;
        return s + (gainUsd || 0);
      }, 0),
      year: new Date().getFullYear(),
    };
  }, [portfolio]);
  return (
    <div style={{ margin: "12px 16px 0" }}>
      <div style={{
        padding: 14, borderRadius: 18,
        background: T.surface, border: `1px solid ${T.border}`,
      }}>
        <div style={{
          fontFamily: FONT.sans, fontSize: 10, fontWeight: 700,
          color: T.textMute, letterSpacing: 0.4, textTransform: "uppercase",
          marginBottom: 10,
        }}>{tr("pro.wallet.tax.title", lang, { year })}</div>
        <div style={{ display: "flex", gap: 12, marginBottom: 8 }}>
          <Stat3 T={T}
            label={tr("pro.wallet.tax.realized", lang)}
            value={`${realized >= 0 ? "+" : "-"}US$${fmtMoney(Math.abs(realized), "USD")}`}
            color={realized >= 0 ? T.accent : T.danger}
          />
          <Stat3 T={T}
            label={tr("pro.wallet.tax.unrealized", lang)}
            value={`${unrealized >= 0 ? "+" : "-"}US$${fmtMoney(Math.abs(unrealized), "USD")}`}
            color={unrealized >= 0 ? T.accent : T.danger}
          />
        </div>
        <div style={{
          fontFamily: FONT.sans, fontSize: 10, color: T.textMute,
          lineHeight: 1.4, fontStyle: "italic",
        }}>{tr("pro.wallet.tax.note", lang)}</div>
      </div>
    </div>
  );
}

// ============================================================
// DailyBriefCard (samas-0.1.6) — auto-loaded "good morning" AI
// summary at the top of the Wallet.
// ============================================================
// Caches the response keyed by user_id + UTC date — re-fetches at
// most once per calendar day so we don't burn LLM calls on every
// app open. Refresh button forces a re-call.
//
// Renders a compact card with the headline + brief paragraph.
// "—" placeholder while loading. Hides silently on hard error
// (we don't block the wallet on a flaky AI call).
function DailyBriefCard({ T, lang = "es" }) {
  const [data, setData] = useState(() => {
    // Hydrate from localStorage if we have a fresh cache (same day).
    try {
      const raw = localStorage.getItem("samas_daily_brief_v1");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const today = new Date().toISOString().slice(0, 10);
      if (parsed?.date === today && parsed?.payload) return parsed.payload;
    } catch {}
    return null;
  });
  const [busy, setBusy] = useState(!data);
  const [hidden, setHidden] = useState(false);
  // In-flight ref so the refresh button can't double-fire while a
  // call is mid-air. The previous busy-state guard fired against
  // initial-mount busy=true and silently blocked the auto-load,
  // leaving the card stuck on the skeleton forever (samas-0.2.5).
  const inFlight = React.useRef(false);

  async function load(force = false) {
    if (inFlight.current && !force) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const res = await dailyBrief();
      setData(res);
      const today = new Date().toISOString().slice(0, 10);
      try {
        localStorage.setItem("samas_daily_brief_v1", JSON.stringify({
          date: today, payload: res,
        }));
      } catch {}
    } catch (e) {
      // Consent declined or any error → hide the card silently. No
      // point in showing a "brief failed" banner above the wallet.
      if (e?.name === "AIConsentDeniedError" || e?.name === "AIQuotaExceededError") setHidden(true);
      else if (!data) setHidden(true);
      // If we already had a cached brief and refresh failed, keep
      // showing the cache.
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }

  // Auto-load on mount if no cache. Only fires once.
  useEffect(() => {
    if (!data) load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (hidden) return null;

  const gainColor = data && data.gainPct >= 0 ? T.accent : T.danger;

  return (
    <div style={{
      margin: "16px 16px 0", padding: 16, borderRadius: 22,
      background: T.surface,
      border: `1px solid ${T.accent}55`,
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8, flexShrink: 0,
          background: T.accent, color: "#06180c",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>
          </svg>
        </div>
        <div style={{
          flex: 1, fontFamily: FONT.mono, fontSize: 11, fontWeight: 700,
          color: T.accent, letterSpacing: 0.6, textTransform: "uppercase",
        }}>
          {tr("wallet.brief.kicker", lang)}
        </div>
        {data && data.gainPct != null && (
          <div style={{
            padding: "3px 8px", borderRadius: 999,
            background: data.gainPct >= 0 ? T.accentSoft : T.dangerSoft,
            color: gainColor,
            fontFamily: FONT.mono, fontSize: 11, fontWeight: 700,
          }}>
            {data.gainPct >= 0 ? "+" : ""}{data.gainPct.toFixed(1)}%
          </div>
        )}
        <button
          onClick={() => load(true)}
          disabled={busy}
          aria-label={tr("wallet.brief.refresh", lang)}
          title={tr("wallet.brief.refresh", lang)}
          style={{
            width: 26, height: 26, borderRadius: 13,
            background: T.bg, border: `1px solid ${T.border}`,
            color: T.textMute, padding: 0,
            cursor: busy ? "default" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
          {busy ? (
            <div style={{
              width: 12, height: 12, borderRadius: 999,
              border: `2px solid ${T.border}`, borderTopColor: T.accent,
              animation: "samas-spin 800ms linear infinite",
            }} />
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
          )}
        </button>
      </div>
      {busy && !data ? (
        <div>
          <div style={{
            height: 14, marginBottom: 8, borderRadius: 6,
            background: T.border, opacity: 0.5,
            animation: "samas-skel 1.4s ease-in-out infinite",
            backgroundImage: `linear-gradient(90deg, ${T.border} 0, ${T.surface} 50%, ${T.border} 100%)`,
            backgroundSize: "200% 100%",
          }} />
          <div style={{
            height: 14, width: "85%", borderRadius: 6,
            background: T.border, opacity: 0.5,
            animation: "samas-skel 1.4s ease-in-out 0.2s infinite",
            backgroundImage: `linear-gradient(90deg, ${T.border} 0, ${T.surface} 50%, ${T.border} 100%)`,
            backgroundSize: "200% 100%",
          }} />
        </div>
      ) : data ? (
        <>
          <div style={{
            fontFamily: FONT.sans, fontSize: 13, color: T.text, lineHeight: 1.55,
          }}>{data.brief}</div>
          {/* AI disclaimer (samas-0.4.15). Brief is generated from
              live portfolio data — make it clear it's IA, not advice. */}
          <div style={{
            marginTop: 4, paddingTop: 8,
            borderTop: `1px solid ${T.accent}22`,
            fontFamily: FONT.sans, fontSize: 10, color: T.textMute,
            lineHeight: 1.45,
          }}>
            {tr("common.ai_disclaimer_short", lang)}
          </div>
        </>
      ) : null}
    </div>
  );
}

// ============================================================
// AIAnalysisCard (samas-0.0.83) — entry point + result sheet for
// the analyze-portfolio Edge Function (the LLM).
// ============================================================
// Two states:
//   - idle: a CTA card with the SAMAS logo + "Análisis IA" label.
//     Tap → calls the function, shows a thinking spinner.
//   - showing: a sheet slides up from the bottom with the result
//     (headline / 3 bullets / suggestion / concentration chip).
//
// Caches the result for the session — re-tapping shows the same
// analysis instead of burning another LLM call. The cache clears
// on full app reload, which is the right cadence for "look at my
// book again" semantics.
function AIAnalysisCard({ T, lang = "es" }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState(null);

  async function run() {
    if (busy) return;
    setErr(null);
    // If we have a cached result from this session, just open the
    // sheet — no need to re-call.
    if (result) {
      setOpen(true);
      hapticNative("tap").catch(() => {});
      return;
    }
    setBusy(true);
    setOpen(true);   // open immediately so the loader shows in the sheet
    hapticNative("tap").catch(() => {});
    try {
      const data = await analyzePortfolio();
      setResult(data);
      hapticNative("success").catch(() => {});
    } catch (e) {
      // User declined the consent dialog — close the sheet silently.
      if (e?.name === "AIConsentDeniedError" || e?.name === "AIQuotaExceededError") { setOpen(false); }
      else { setErr(e?.message || String(e)); }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div style={{ margin: "28px 16px 0" }}>
        <SectionHead T={T} title={tr("wallet.section.ai", lang)} />
        <button
          onClick={run}
          disabled={busy}
          style={{
            width: "100%", marginTop: 12, padding: 16, borderRadius: 22,
            // Accent-tinted gradient — visually distinct from the
            // other Wallet cards so the "AI" affordance reads
            // immediately, even before the user reads the label.
            background: T.surface,
            border: `1px solid ${T.accent}55`,
            display: "flex", alignItems: "center", gap: 14, cursor: busy ? "default" : "pointer",
            textAlign: "left",
            opacity: busy ? 0.7 : 1,
          }}
        >
          {/* Sparkles glyph (Lucide-style) — universal "AI" signal. */}
          <div style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            background: T.accent, color: "#06180c",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>
              <path d="M19 13l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/>
              <path d="M5 14l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/>
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: FONT.sans, fontSize: 13, fontWeight: 700,
              color: T.text, marginBottom: 2,
            }}>
              {tr("wallet.ai.cta_title", lang)}
            </div>
            <div style={{
              fontFamily: FONT.sans, fontSize: 12, color: T.textMute, lineHeight: 1.4,
            }}>
              {busy
                ? tr("wallet.ai.thinking", lang)
                : (result
                  ? tr("wallet.ai.cta_subtitle_again", lang)
                  : tr("wallet.ai.cta_subtitle", lang))}
            </div>
          </div>
          <Pill T={T}>IA</Pill>
        </button>
      </div>

      {/* Result sheet — portaled to document.body so it escapes the
          Wallet scroll container's stacking context. Otherwise the
          floating bottom nav (rendered at the Shell root) sits ON
          TOP of the sheet because it's in a sibling layer the inner
          stacking context can't elevate above. samas-0.0.83 fix
          (was filed as bug after 0.0.83 first ship). */}
      {open && ReactDOM.createPortal(
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed", inset: 0, zIndex: 100,
            background: "rgba(0,0,0,0.55)",
            display: "flex", alignItems: "flex-end",
            animation: "samas-fade-in 160ms ease-out",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%", maxHeight: "82vh",
              background: T.surface, color: T.text,
              borderTopLeftRadius: 24, borderTopRightRadius: 24,
              borderTop: `1px solid ${T.border}`,
              padding: "18px 18px calc(env(safe-area-inset-bottom) + 24px)",
              overflowY: "auto",
              boxShadow: "0 -18px 50px rgba(0,0,0,0.5)",
              animation: "samas-sheet-up 220ms ease-out",
            }}
          >
            {/* Drag handle */}
            <div style={{
              width: 44, height: 4, borderRadius: 2,
              background: T.border, margin: "0 auto 14px",
            }} />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
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
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  fontFamily: FONT.sans, fontSize: 11, fontWeight: 700,
                  color: T.accent, letterSpacing: 0.6, textTransform: "uppercase",
                }}>
                  <span>{tr("wallet.ai.sheet.kicker", lang)}</span>
                  <AIQuotaPill T={T} lang={lang} />
                </div>
                <div style={{ fontFamily: FONT.display, fontSize: 18, fontWeight: 700, color: T.text, letterSpacing: -0.3 }}>
                  {tr("wallet.ai.sheet.title", lang)}
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                style={{
                  width: 32, height: 32, borderRadius: 16,
                  background: T.bg, border: `1px solid ${T.border}`,
                  color: T.textMute, fontFamily: FONT.sans, fontSize: 16,
                  cursor: "pointer", padding: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >×</button>
            </div>

            {busy && !result && (
              <div style={{
                padding: "32px 16px", textAlign: "center",
                color: T.textMute, fontFamily: FONT.sans, fontSize: 13,
              }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 999,
                  border: `2.5px solid ${T.border}`, borderTopColor: T.accent,
                  margin: "0 auto 12px", animation: "samas-spin 800ms linear infinite",
                }} />
                {tr("wallet.ai.thinking", lang)}
              </div>
            )}

            {err && (
              <div style={{
                padding: "16px", borderRadius: 14, background: T.dangerSoft,
                color: T.danger, fontFamily: FONT.sans, fontSize: 13, lineHeight: 1.5,
              }}>
                {err}
              </div>
            )}

            {result && !busy && (
              <div>
                {/* Headline */}
                <div style={{
                  fontFamily: FONT.display, fontSize: 17, fontWeight: 700,
                  color: T.text, lineHeight: 1.35, marginBottom: 12,
                }}>
                  {result.headline}
                </div>
                {/* Concentration chip */}
                {result.concentration && (
                  <div style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "5px 10px", borderRadius: 999,
                    background: T.bg, border: `1px solid ${T.border}`,
                    color: T.textMute, fontFamily: FONT.sans, fontSize: 11, fontWeight: 600,
                    marginBottom: 16,
                  }}>
                    <span style={{ color: T.accent }}>●</span>
                    {tr("wallet.ai.concentration", lang)}: {result.concentration}
                  </div>
                )}
                {/* Bullets */}
                {Array.isArray(result.bullets) && result.bullets.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    {result.bullets.map((b, i) => (
                      <div key={i} style={{
                        display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10,
                        padding: "10px 12px", borderRadius: 12,
                        background: T.bg, border: `1px solid ${T.border}`,
                      }}>
                        {/* Numbered badge — alignSelf-flex-start so multi-
                            line bullets don't stretch the badge to full
                            row height. marginTop: 0 leaves the badge
                            top-aligned with the first line of text
                            (samas-0.0.86 alignment sweep). */}
                        <div style={{
                          width: 20, height: 20, borderRadius: 10, flexShrink: 0,
                          background: T.accent, color: "#06180c",
                          fontFamily: FONT.mono, fontSize: 11, fontWeight: 700,
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>{i + 1}</div>
                        <div style={{
                          fontFamily: FONT.sans, fontSize: 13, color: T.text, lineHeight: 1.5,
                          flex: 1, minWidth: 0,
                        }}>{b}</div>
                      </div>
                    ))}
                  </div>
                )}
                {/* Suggestion */}
                {result.suggestion && (
                  <div style={{
                    padding: "14px 14px", borderRadius: 14,
                    background: T.accentSoft,
                    border: `1.5px solid ${T.accent}`,
                  }}>
                    <div style={{
                      fontFamily: FONT.sans, fontSize: 11, fontWeight: 700,
                      color: T.accent, letterSpacing: 0.6, textTransform: "uppercase",
                      marginBottom: 6,
                    }}>{tr("wallet.ai.suggestion", lang)}</div>
                    <div style={{
                      fontFamily: FONT.sans, fontSize: 14, color: T.text, lineHeight: 1.5,
                    }}>{result.suggestion}</div>
                  </div>
                )}
                {/* Disclaimer (samas-0.4.15) — upgraded from
                    one-liner to the shared strip + stronger
                    "no es asesoramiento" copy per Manuel's father's
                    advisor feedback. */}
                <div style={{ marginTop: 16 }}>
                  <DisclaimerStrip T={T} variant="card" textKey="common.ai_disclaimer" lang={lang} />
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ============================================================
// BenchmarkCompareCard (samas-0.1.7) — "am I beating the market?"
// ============================================================
// Compact card showing portfolio gain% next to Merval / S&P / BTC.
// Auto-loads on mount, caches per session — refresh button forces
// re-fetch. Color-codes each row: green check if portfolio beats,
// red × if behind.
function BenchmarkCompareCard({ T, lang = "es" }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(true);
  const [hidden, setHidden] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const res = await compareBenchmark();
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

  // 0.4.47 — full skeleton mientras busy + sin data, en vez de
  // mostrar el chrome de la card con "…" / "—" (lee a vacío).
  if (busy && !data) {
    return (
      <div style={{ margin: "20px 16px 0" }}>
        <SectionHead T={T} title={tr("wallet.benchmark.title", lang)} />
        <div style={{
          marginTop: 12, padding: 16, borderRadius: 22,
          background: T.surface, border: `1px solid ${T.border}`,
        }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "10px 0",
              borderBottom: i < 2 ? `1px solid ${T.border}` : "none",
            }}>
              <Skeleton T={T} width={28} height={28} borderRadius={8} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Skeleton T={T} width="50%" height={12} marginBottom={6} />
                <Skeleton T={T} width="35%" height={10} />
              </div>
              <Skeleton T={T} width={56} height={16} borderRadius={6} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const portfolioGain = data?.portfolio?.gainPct;
  const portfolioColor = portfolioGain == null ? T.textMute
    : portfolioGain >= 0 ? T.accent : T.danger;

  return (
    <div style={{ margin: "20px 16px 0" }}>
      <SectionHead T={T} title={tr("wallet.benchmark.title", lang)} />
      <div style={{
        marginTop: 12, padding: 16, borderRadius: 22,
        background: T.surface, border: `1px solid ${T.border}`,
      }}>
        {/* Portfolio row — distinct treatment so it reads as YOU */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "10px 0", borderBottom: `1px solid ${T.border}`,
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8, flexShrink: 0,
            background: T.accent, color: "#06180c",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: FONT.sans, fontSize: 13, fontWeight: 700, color: T.text }}>
              {tr("wallet.benchmark.you", lang)}
            </div>
            <div style={{ fontFamily: FONT.sans, fontSize: 11, color: T.textMute, marginTop: 2 }}>
              {data?.portfolio?.totalUsd
                ? `US$${data.portfolio.totalUsd.toLocaleString("en-US")}`
                : "—"}
            </div>
          </div>
          <div style={{
            fontFamily: FONT.mono, fontSize: 16, fontWeight: 800,
            color: portfolioColor, fontVariantNumeric: "tabular-nums",
          }}>
            {portfolioGain != null
              ? `${portfolioGain >= 0 ? "+" : ""}${portfolioGain.toFixed(1)}%`
              : "—"}
          </div>
        </div>

        {/* Benchmark rows */}
        {(data?.benchmarks || []).map((b) => (
          <div key={b.id} style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "10px 0",
            borderBottom: `1px solid ${T.border}`,
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8, flexShrink: 0,
              background: T.bg, border: `1px solid ${T.border}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: FONT.mono, fontSize: 11, fontWeight: 800,
              color: T.textMute, letterSpacing: 0.4,
            }}>
              {b.id === "merval" ? "AR" : b.id === "spx" ? "US" : "₿"}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: FONT.sans, fontSize: 13, fontWeight: 600, color: T.text }}>
                {b.name}
              </div>
              <div style={{ fontFamily: FONT.sans, fontSize: 11, color: b.beat ? T.accent : T.danger, marginTop: 2 }}>
                {b.beat ? tr("wallet.benchmark.beat", lang) : tr("wallet.benchmark.behind", lang)}
              </div>
            </div>
            <div style={{
              fontFamily: FONT.mono, fontSize: 14, fontWeight: 700,
              color: b.gainPct >= 0 ? T.text : T.danger,
              fontVariantNumeric: "tabular-nums",
            }}>
              {b.gainPct >= 0 ? "+" : ""}{b.gainPct.toFixed(1)}%
            </div>
          </div>
        ))}

        {/* AI verdict */}
        <div style={{ paddingTop: 12 }}>
          {busy && !data ? (
            <div style={{
              height: 14, marginBottom: 6, borderRadius: 6,
              background: T.border, opacity: 0.5,
              animation: "samas-skel 1.4s ease-in-out infinite",
              backgroundImage: `linear-gradient(90deg, ${T.border} 0, ${T.surface} 50%, ${T.border} 100%)`,
              backgroundSize: "200% 100%",
            }} />
          ) : data?.verdict ? (
            <div style={{
              fontFamily: FONT.sans, fontSize: 13, color: T.textMute, lineHeight: 1.5,
            }}>{data.verdict}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// EarningsWatchCard (samas-0.1.8) — upcoming earnings + AI note
// ============================================================
// Shows up to 3 closest upcoming earnings for held tickers (rest
// hidden behind a "Ver todas" tap). Each row: countdown chip +
// ticker + AI commentary on position-impact + day's-out indicator.
// Hides silently if there are no upcoming earnings (clean Wallet
// view) or AI hard-fails.
function EarningsWatchCard({ T, lang = "es" }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [showAll, setShowAll] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const res = await earningsWatch();
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
  // No upcoming earnings → don't render anything (vs. an empty card).
  if (data && (!data.items || data.items.length === 0)) return null;

  const items = data?.items || [];
  const visibleItems = showAll ? items : items.slice(0, 3);
  const hiddenCount = items.length - visibleItems.length;

  function countdownLabel(days) {
    if (days === 0) return tr("wallet.earnings.today", lang);
    if (days === 1) return tr("wallet.earnings.tomorrow", lang);
    return tr("wallet.earnings.days_out", lang, { n: days });
  }

  function countdownColor(days) {
    if (days <= 1) return T.danger;
    if (days <= 7) return "#F59E0B";   // amber for "this week"
    return T.textMute;
  }

  return (
    <div style={{ margin: "20px 16px 0" }}>
      <SectionHead T={T} title={tr("wallet.earnings.title", lang)} />
      <div style={{
        marginTop: 12, padding: 16, borderRadius: 22,
        background: T.surface, border: `1px solid ${T.border}`,
      }}>
        {/* Summary header */}
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
            marginBottom: 8,
          }}>{data.summary}</div>
        ) : null}

        {/* Earnings rows */}
        {visibleItems.map((it, idx) => {
          const cdColor = countdownColor(it.daysOut);
          return (
            <div key={`${it.ticker}-${it.eventDate}`} style={{
              display: "flex", gap: 12, padding: "12px 0",
              borderTop: idx === 0 ? "none" : `1px solid ${T.border}`,
              alignItems: "flex-start",
            }}>
              {/* Countdown chip — date hierarchy, not a button */}
              <div style={{
                width: 60, flexShrink: 0,
                padding: "4px 0", borderRadius: 8,
                background: T.bg, border: `1px solid ${T.border}`,
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                color: cdColor,
              }}>
                <div style={{
                  fontFamily: FONT.mono, fontSize: 18, fontWeight: 800, lineHeight: 1,
                }}>{it.daysOut === 0 ? "★" : it.daysOut}</div>
                <div style={{
                  fontFamily: FONT.mono, fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
                  textTransform: "uppercase", marginTop: 2,
                }}>{it.daysOut === 0
                    ? tr("wallet.earnings.today_short", lang)
                    : it.daysOut === 1
                      ? tr("wallet.earnings.tomorrow_short", lang)
                      : tr("wallet.earnings.days_short", lang)}</div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4,
                }}>
                  <span style={{
                    fontFamily: FONT.mono, fontSize: 13, fontWeight: 800, color: T.text,
                    letterSpacing: 0.4,
                  }}>${it.ticker}</span>
                  <span style={{ fontFamily: FONT.sans, fontSize: 11, color: T.textMute }}>
                    {it.name}
                  </span>
                  <span style={{
                    marginLeft: "auto",
                    fontFamily: FONT.mono, fontSize: 10, color: cdColor, fontWeight: 700,
                  }}>{countdownLabel(it.daysOut)}</span>
                </div>
                <div style={{
                  fontFamily: FONT.sans, fontSize: 12, color: T.textMute, lineHeight: 1.5,
                }}>{it.note}</div>
                <div style={{
                  marginTop: 4,
                  fontFamily: FONT.mono, fontSize: 10, color: T.textMute,
                }}>
                  {it.pctOfBook.toFixed(0)}% del book · US${it.valueUsd.toLocaleString("en-US")}
                </div>
              </div>
            </div>
          );
        })}

        {/* Show all / collapse toggle */}
        {hiddenCount > 0 && (
          <button
            onClick={() => setShowAll(true)}
            style={{
              width: "100%", marginTop: 8, padding: "8px 12px", borderRadius: 10,
              background: "transparent", border: `1px dashed ${T.border}`,
              color: T.textMute, fontFamily: FONT.sans, fontSize: 12, fontWeight: 600,
              cursor: "pointer",
            }}>
            {tr("wallet.earnings.show_all", lang, { n: hiddenCount })}
          </button>
        )}
      </div>
    </div>
  );
}


// ============================================================
// QuarterlyReviewCard (samas-0.2.4) — narrative 90-day review
// ============================================================
// Card on the Wallet → tap → opens a sheet with a AI-written
// 3-4 paragraph review of the user's last 90 days. Auto-loads the
// headline + key stat (return %) on the card so the user sees the
// hook before tapping. Lazy-loads the full narrative on sheet open
// to keep wallet renders fast.
function QuarterlyReviewCard({ T, lang = "es" }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);

  async function load() {
    setBusy(true);
    try {
      const res = await quarterlyReview();
      setData(res);
      // Hide silently if the user has no positions to review.
      if (!res?.stats) setHidden(true);
    } catch (e) {
      if (e?.name === "AIConsentDeniedError" || e?.name === "AIQuotaExceededError") setHidden(true);
      else if (!data) setHidden(true);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  if (hidden) return null;

  const ret = data?.stats?.quarterReturnPct ?? 0;
  const retColor = ret >= 0 ? T.accent : T.danger;
  const retSign = ret >= 0 ? "+" : "";

  return (
    <>
      <div style={{ margin: "20px 16px 0" }}>
        <SectionHead T={T} title={tr("wallet.review.title", lang)} />
        <button
          onClick={() => {
            if (!data) return;
            setOpen(true);
            hapticNative("tap").catch(() => {});
          }}
          disabled={!data}
          style={{
            width: "100%", marginTop: 12, padding: 16, borderRadius: 22,
            background: T.surface, border: `1px solid ${T.border}`,
            display: "flex", alignItems: "center", gap: 14,
            cursor: data ? "pointer" : "default", textAlign: "left",
          }}>
          {/* Icon block */}
          <div style={{
            width: 44, height: 44, flexShrink: 0, borderRadius: 12,
            background: T.accentSoft, color: T.accent,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            {busy && !data ? (
              <>
                <div style={{
                  height: 12, width: "70%", marginBottom: 6, borderRadius: 4,
                  background: T.border, opacity: 0.5,
                  backgroundImage: `linear-gradient(90deg, ${T.border} 0, ${T.surface} 50%, ${T.border} 100%)`,
                  backgroundSize: "200% 100%",
                  animation: "samas-skel 1.4s ease-in-out infinite",
                }} />
                <div style={{
                  height: 10, width: "50%", borderRadius: 4,
                  background: T.border, opacity: 0.5,
                  backgroundImage: `linear-gradient(90deg, ${T.border} 0, ${T.surface} 50%, ${T.border} 100%)`,
                  backgroundSize: "200% 100%",
                  animation: "samas-skel 1.4s ease-in-out 0.2s infinite",
                }} />
              </>
            ) : (
              <>
                <div style={{
                  fontFamily: FONT.sans, fontSize: 13, fontWeight: 700, color: T.text,
                  lineHeight: 1.4, marginBottom: 4,
                }}>{data?.headline || tr("wallet.review.subtitle", lang)}</div>
                <div style={{
                  display: "flex", alignItems: "baseline", gap: 8,
                  fontFamily: FONT.mono, fontSize: 11, color: T.textMute,
                }}>
                  <span style={{
                    color: retColor, fontSize: 13, fontWeight: 800,
                  }}>{retSign}{ret.toFixed(1)}%</span>
                  <span>· {tr("wallet.review.period_label", lang)}</span>
                </div>
              </>
            )}
          </div>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={T.textMute}
            strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
      </div>

      {open && data && (
        <QuarterlyReviewSheet
          T={T} lang={lang} data={data}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// ============================================================
// QuarterlyReviewSheet — full narrative + stats
// ============================================================
// Bottom sheet that renders the AI-written markdown review
// plus a stat strip (winners / losers / activity). Markdown is
// rendered with a tiny in-house parser since pulling in a full
// react-markdown dependency for 4 paragraphs of h2 + p is overkill.
function QuarterlyReviewSheet({ T, lang = "es", data, onClose }) {
  const stats = data?.stats || {};
  const dtd = useDragToDismiss(onClose);
  // Tiny markdown → React renderer. Handles ## h2 and paragraphs.
  // Bolds anything between ** **. $TICKER stays plain.
  function renderMarkdown(md) {
    if (!md) return null;
    const lines = md.split("\n");
    const elements = [];
    let para = [];
    const flushPara = () => {
      if (para.length === 0) return;
      const text = para.join(" ").trim();
      if (text) elements.push(
        <p key={`p-${elements.length}`} style={{
          fontFamily: FONT.sans, fontSize: 13, color: T.textMute, lineHeight: 1.65,
          margin: "0 0 12px",
        }}>{renderInline(text)}</p>
      );
      para = [];
    };
    function renderInline(text) {
      const parts = text.split(/(\*\*[^*]+\*\*)/g);
      return parts.map((p, i) => {
        if (p.startsWith("**") && p.endsWith("**")) {
          return <strong key={i} style={{ color: T.text, fontWeight: 700 }}>{p.slice(2, -2)}</strong>;
        }
        return p;
      });
    }
    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith("## ")) {
        flushPara();
        elements.push(
          <h2 key={`h-${elements.length}`} style={{
            fontFamily: FONT.display, fontSize: 14, fontWeight: 800,
            color: T.text, letterSpacing: -0.2, margin: "16px 0 8px",
            textTransform: "uppercase",
          }}>{line.slice(3)}</h2>
        );
      } else if (line === "") {
        flushPara();
      } else {
        para.push(line);
      }
    }
    flushPara();
    return elements;
  }

  const ret = stats?.quarterReturnPct ?? 0;
  const retColor = ret >= 0 ? T.accent : T.danger;
  const retSign = ret >= 0 ? "+" : "";

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 110,
        background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
      }}
    >
      <div ref={dtd.ref} style={{
        width: "100%", maxWidth: 540, maxHeight: "92dvh",
        background: T.bgElev || T.bg, color: T.text,
        borderTopLeftRadius: 28, borderTopRightRadius: 28,
        border: `1px solid ${T.border}`, borderBottom: "none",
        display: "flex", flexDirection: "column", overflow: "hidden",
        ...dtd.dragStyle,
      }}>
        {/* Drag handle */}
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 12 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: T.border }}/>
        </div>

        {/* Header — accent gradient */}
        <div style={{
          padding: "14px 22px 16px",
          background: "transparent",
        }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "4px 10px", borderRadius: 999,
            background: T.accent, color: T.accentInk,
            fontFamily: FONT.mono, fontSize: 9, fontWeight: 800,
            letterSpacing: 0.6, textTransform: "uppercase",
            marginBottom: 8,
          }}>
            ✦ Review IA · {tr("wallet.review.period_label", lang)}
          </div>
          <div style={{
            fontFamily: FONT.display, fontSize: 22, fontWeight: 700,
            color: T.text, letterSpacing: -0.4, lineHeight: 1.25,
            marginBottom: 6,
          }}>{data?.headline}</div>
          <div style={{
            display: "flex", alignItems: "baseline", gap: 8,
            fontFamily: FONT.mono, fontSize: 12, color: T.textMute,
          }}>
            <span style={{
              fontSize: 22, fontWeight: 800, color: retColor, letterSpacing: -0.4,
            }}>{retSign}{ret.toFixed(1)}%</span>
            <span>{tr("wallet.review.return_label", lang)}</span>
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{
          flex: 1, overflowY: "auto", padding: "8px 22px 20px",
        }}>
          {/* Stats strip */}
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr",
            gap: 8, marginBottom: 14,
          }}>
            <div style={{
              padding: 12, borderRadius: 14,
              background: T.surface, border: `1px solid ${T.border}`,
            }}>
              <div style={{
                fontFamily: FONT.mono, fontSize: 9, fontWeight: 700,
                color: T.textMute, letterSpacing: 0.6, textTransform: "uppercase",
                marginBottom: 4,
              }}>{tr("wallet.review.trades_label", lang)}</div>
              <div style={{
                fontFamily: FONT.mono, fontSize: 18, fontWeight: 800, color: T.text,
              }}>{stats?.tradesCount || 0}</div>
            </div>
            <div style={{
              padding: 12, borderRadius: 14,
              background: T.surface, border: `1px solid ${T.border}`,
            }}>
              <div style={{
                fontFamily: FONT.mono, fontSize: 9, fontWeight: 700,
                color: T.textMute, letterSpacing: 0.6, textTransform: "uppercase",
                marginBottom: 4,
              }}>{tr("wallet.review.busiest_label", lang)}</div>
              <div style={{
                fontFamily: FONT.mono, fontSize: 14, fontWeight: 800, color: T.text,
              }}>{stats?.busiest ? `$${stats.busiest.ticker}` : "—"}</div>
            </div>
          </div>

          {/* Winners / Losers chips */}
          {(stats?.winners?.length > 0 || stats?.losers?.length > 0) && (
            <div style={{
              display: "flex", flexDirection: "column", gap: 6,
              marginBottom: 14, padding: 12, borderRadius: 14,
              background: T.surface, border: `1px solid ${T.border}`,
            }}>
              {stats.winners?.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{
                    fontFamily: FONT.mono, fontSize: 9, fontWeight: 700,
                    color: T.textMute, letterSpacing: 0.6, textTransform: "uppercase",
                    marginRight: 4,
                  }}>{tr("wallet.review.winners_label", lang)}</span>
                  {stats.winners.map((w) => (
                    <span key={w.ticker} style={{
                      fontFamily: FONT.mono, fontSize: 11, fontWeight: 700,
                      padding: "3px 8px", borderRadius: 999,
                      background: T.accentSoft, color: T.accent,
                    }}>${w.ticker} +{w.gainPct.toFixed(1)}%</span>
                  ))}
                </div>
              )}
              {stats.losers?.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{
                    fontFamily: FONT.mono, fontSize: 9, fontWeight: 700,
                    color: T.textMute, letterSpacing: 0.6, textTransform: "uppercase",
                    marginRight: 4,
                  }}>{tr("wallet.review.losers_label", lang)}</span>
                  {stats.losers.map((l) => (
                    <span key={l.ticker} style={{
                      fontFamily: FONT.mono, fontSize: 11, fontWeight: 700,
                      padding: "3px 8px", borderRadius: 999,
                      background: T.dangerSoft, color: T.danger,
                    }}>${l.ticker} {l.gainPct.toFixed(1)}%</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Narrative */}
          <div>{renderMarkdown(data?.narrative)}</div>

          <div style={{
            marginTop: 8, fontFamily: FONT.sans, fontSize: 10,
            color: T.textMute, textAlign: "center",
          }}>{tr("wallet.review.disclaimer", lang)}</div>
        </div>

        {/* Sticky close */}
        <div style={{
          padding: "12px 18px calc(env(safe-area-inset-bottom) + 16px)",
          borderTop: `1px solid ${T.border}`,
          background: T.bgElev || T.bg,
        }}>
          <button onClick={onClose} style={{
            width: "100%", padding: "13px 16px", borderRadius: 14,
            background: T.accent, border: "none",
            color: T.accentInk, fontFamily: FONT.sans, fontSize: 14, fontWeight: 800,
            cursor: "pointer",
          }}>{tr("wallet.review.close", lang)}</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// AIChatCard (samas-0.0.89) — "Preguntale a SAMAS" multi-turn
// chat with the user's portfolio in context. Killer demo for
// Cohen.
// ============================================================
// Card on the Wallet tab → tap → opens a chat sheet with message
// bubbles. User types, presses Send → server reads holdings via
// JWT-scoped RLS, prepends a system prompt, calls the LLM
// with the conversation history, returns reply. Templated server-
// side fallback when ANTHROPIC_API_KEY isn't set.
// ============================================================
function AIChatCard({ T, lang = "es" }) {
  const [open, setOpen] = useState(false);
  // Conversation state lives ABOVE the sheet so a close-then-reopen
  // preserves the chat. Cleared by an explicit "Nueva conversación"
  // action inside the sheet.
  const [messages, setMessages] = useState([]); // [{role, content}]
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const scrollRef = React.useRef(null);
  const inputRef = React.useRef(null);

  // Auto-scroll to the bottom whenever messages change so the
  // newest reply is always visible without the user dragging.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  // 0.4.56 — hide SamasTabBar while chat is open. Mismo patrón que
  // useModalGuard pero acá el "modal" vive en el mismo componente
  // (gateado por `open`), entonces despachamos los events directos.
  useEffect(() => {
    if (!open) return;
    window.dispatchEvent(new Event("samas:modal-mounted"));
    return () => window.dispatchEvent(new Event("samas:modal-unmounted"));
  }, [open]);

  // 0.4.68 — keyboard offset comes from the global CSS variable
  // `--samas-kb-h` set by initKeyboardCSSVar() (lib/native.js) at app
  // boot. Listener is global so the keyboard height is always in sync
  // when the chat opens — no React state race.

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setErr(null);
    const next = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    hapticNative("tap").catch(() => {});
    try {
      const { reply } = await chatPortfolio({ messages: next });
      if (reply) {
        setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
        hapticNative("success").catch(() => {});
      }
    } catch (e) {
      // Consent declined OR quota hit → roll back the optimistic user
      // message + close. Quota also pops the Plus upsell modal globally
      // (handled by gateOnQuota dispatch).
      if (e?.name === "AIConsentDeniedError" || e?.name === "AIQuotaExceededError") {
        setMessages((prev) => prev.slice(0, -1));
        setInput(text);  // restore typed input so they don't lose it
        setOpen(false);
      } else {
        setErr(e?.message || String(e));
      }
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function reset() {
    setMessages([]);
    setInput("");
    setErr(null);
  }

  // Suggested starter prompts — make the empty-state useful so the
  // user can demo without thinking up a question.
  const STARTERS = [
    tr("wallet.chat.starter.diversification", lang),
    tr("wallet.chat.starter.performance", lang),
    tr("wallet.chat.starter.next_move", lang),
  ];

  return (
    <>
      <div style={{ margin: "12px 16px 0" }}>
        <button
          onClick={() => {
            setOpen(true);
            hapticNative("tap").catch(() => {});
            // 0.4.61 — quitamos el auto-focus del input al abrir el chat.
            // Manuel: "siempre me salta el teclado". Mejor que el usuario
            // vea las suggested prompts primero y tape el input él si quiere.
            // El focus después de enviar (send()) sigue ahí para flow
            // continuo de conversación.
          }}
          style={{
            width: "100%", padding: 16, borderRadius: 22,
            background: T.surface, border: `1px solid ${T.border}`,
            display: "flex", alignItems: "center", gap: 14, cursor: "pointer",
            textAlign: "left",
          }}
        >
          <div style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            background: T.accent, color: "#06180c",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: FONT.sans, fontSize: 13, fontWeight: 700,
              color: T.text, marginBottom: 2,
            }}>
              {tr("wallet.chat.cta_title", lang)}
            </div>
            <div style={{
              fontFamily: FONT.sans, fontSize: 12, color: T.textMute, lineHeight: 1.4,
            }}>
              {messages.length > 0
                ? tr("wallet.chat.cta_subtitle_again", lang, { n: messages.length })
                : tr("wallet.chat.cta_subtitle", lang)}
            </div>
          </div>
          <Pill T={T}>IA</Pill>
        </button>
      </div>

      {/* Chat sheet — portaled to body so it escapes the Wallet
          scroll container's stacking context (same pattern as the
          AI analysis sheet). */}
      {open && ReactDOM.createPortal(
        <div
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
          style={{
            // 0.4.68 — bottom es la variable CSS global setada por
            // initKeyboardCSSVar() (incluye los +48 del QuickType).
            position: "fixed",
            top: 0, left: 0, right: 0,
            bottom: "var(--samas-kb-h, 0px)",
            zIndex: 100,
            background: "rgba(0,0,0,0.55)",
            display: "flex", alignItems: "flex-end",
            animation: "samas-fade-in 160ms ease-out",
            transition: "bottom 200ms ease-out",
          }}
        >
          <div style={{
            // 0.4.64 — sheet ahora es intrinsic-sized (maxHeight cap) en
            // vez de height fija 92%. Cuando el chat está vacío (solo
            // intro + chips), el sheet se achica a sus contenidos y
            // queda compacto, pegado al input arriba del keyboard. Sin
            // dead space al medio. Cuando hay messages el sheet crece
            // hasta el cap, y messages scroll internamente.
            width: "100%", maxHeight: "92%",
            background: T.surface, color: T.text,
            borderTopLeftRadius: 24, borderTopRightRadius: 24,
            borderTop: `1px solid ${T.border}`,
            display: "flex", flexDirection: "column",
            boxShadow: "0 -18px 50px rgba(0,0,0,0.5)",
            animation: "samas-sheet-up 220ms ease-out",
          }}>
            {/* Drag handle + header */}
            <div style={{
              padding: "12px 18px 10px", borderBottom: `1px solid ${T.border}`,
              display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
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
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  fontFamily: FONT.sans, fontSize: 11, fontWeight: 700,
                  color: T.accent, letterSpacing: 0.6, textTransform: "uppercase",
                }}>
                  <span>{tr("wallet.chat.sheet.kicker", lang)}</span>
                  {/* Quota pill — shows X/5 IA hoy for free users.
                      Hides for Plus / unknown. Tap → upsell modal. */}
                  <AIQuotaPill T={T} lang={lang} />
                </div>
                <div style={{ fontFamily: FONT.display, fontSize: 17, fontWeight: 700, color: T.text, letterSpacing: -0.3 }}>
                  {tr("wallet.chat.sheet.title", lang)}
                </div>
              </div>
              {messages.length > 0 && (
                <button
                  onClick={reset}
                  style={{
                    background: T.bg, border: `1px solid ${T.border}`,
                    color: T.textMute, fontFamily: FONT.sans, fontSize: 11, fontWeight: 600,
                    padding: "6px 10px", borderRadius: 999, cursor: "pointer",
                  }}
                >{tr("wallet.chat.reset", lang)}</button>
              )}
              <button
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                style={{
                  width: 32, height: 32, borderRadius: 16,
                  background: T.bg, border: `1px solid ${T.border}`,
                  color: T.textMute, fontFamily: FONT.sans, fontSize: 16,
                  cursor: "pointer", padding: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >×</button>
            </div>

            {/* Message list — scrolls.
                0.4.64 — flex: 1 1 auto: basis=auto (content size) + grow=1
                (take extra space when sheet hits maxHeight) + shrink=1
                (shrink to fit when constrained). Sheet en intrinsic-sized
                con maxHeight cap; este container crece con contenido y
                scrollea cuando llega al cap. */}
            <div ref={scrollRef} style={{
              flex: "1 1 auto", minHeight: 0, overflowY: "auto",
              padding: "14px 16px",
              WebkitOverflowScrolling: "touch",
              overscrollBehavior: "contain",
            }}>
              {messages.length === 0 && (
                <div style={{ padding: "8px 4px 14px" }}>
                  <div style={{
                    fontFamily: FONT.sans, fontSize: 13, color: T.textMute,
                    lineHeight: 1.5, marginBottom: 14,
                  }}>{tr("wallet.chat.empty_intro", lang)}</div>
                  {/* Suggested starter prompts — tap to fill the input. */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {STARTERS.map((s) => (
                      <button
                        key={s}
                        onClick={() => {
                          setInput(s);
                          setTimeout(() => inputRef.current?.focus(), 0);
                        }}
                        style={{
                          padding: "10px 12px", borderRadius: 12,
                          background: T.bg, border: `1px solid ${T.border}`,
                          color: T.text, cursor: "pointer", textAlign: "left",
                          fontFamily: FONT.sans, fontSize: 13, lineHeight: 1.4,
                        }}
                      >{s}</button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((m, i) => (
                <ChatBubble key={i} T={T} role={m.role} content={m.content} />
              ))}
              {busy && (
                <ChatBubble T={T} role="assistant" content={null} thinking />
              )}
              {err && (
                <div style={{
                  marginTop: 8, padding: "10px 12px", borderRadius: 12,
                  background: T.dangerSoft, color: T.danger,
                  fontFamily: FONT.sans, fontSize: 12, lineHeight: 1.5,
                }}>{err}</div>
              )}
            </div>

            {/* Input — pinned to the bottom of the sheet. */}
            <div style={{
              flexShrink: 0,
              padding: "10px 14px calc(env(safe-area-inset-bottom) + 14px)",
              borderTop: `1px solid ${T.border}`,
              background: T.surface,
              display: "flex", alignItems: "flex-end", gap: 8,
            }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value.slice(0, 500))}
                onKeyDown={(e) => {
                  // Enter sends, Shift+Enter inserts newline.
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder={tr("wallet.chat.input_ph", lang)}
                rows={1}
                disabled={busy}
                style={{
                  flex: 1, minWidth: 0,
                  padding: "10px 12px", borderRadius: 14,
                  background: T.bg, border: `1px solid ${T.border}`,
                  color: T.text, fontFamily: FONT.sans, fontSize: 14,
                  resize: "none", outline: "none",
                  maxHeight: 100,
                }}
              />
              <button
                onClick={send}
                disabled={busy || !input.trim()}
                aria-label={tr("wallet.chat.send", lang)}
                style={{
                  width: 38, height: 38, borderRadius: 999,
                  background: input.trim() && !busy ? T.accent : T.bg,
                  color: input.trim() && !busy ? "#06180c" : T.textMute,
                  border: input.trim() && !busy ? "none" : `1px solid ${T.border}`,
                  cursor: busy || !input.trim() ? "default" : "pointer",
                  flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  padding: 0,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"/>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// Chat bubble — user (right, accent) vs assistant (left, surface).
// thinking=true renders a 3-dot loader instead of content.
function ChatBubble({ T, role, content, thinking = false }) {
  const isUser = role === "user";
  return (
    <div style={{
      display: "flex",
      justifyContent: isUser ? "flex-end" : "flex-start",
      marginBottom: 8,
    }}>
      <div style={{
        maxWidth: "85%",
        padding: "10px 14px",
        borderRadius: 16,
        borderTopLeftRadius: isUser ? 16 : 4,
        borderTopRightRadius: isUser ? 4 : 16,
        background: isUser ? T.accent : T.bg,
        color: isUser ? "#06180c" : T.text,
        border: isUser ? "none" : `1px solid ${T.border}`,
        fontFamily: FONT.sans, fontSize: 14, lineHeight: 1.5,
        whiteSpace: "pre-wrap", wordBreak: "break-word",
      }}>
        {thinking ? (
          <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 0" }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{
                width: 6, height: 6, borderRadius: 999,
                background: T.textMute,
                animation: `samas-chat-dot 1.2s ${i * 0.18}s infinite`,
              }} />
            ))}
            <style>{`
              @keyframes samas-chat-dot {
                0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
                40%           { opacity: 1;   transform: translateY(-3px); }
              }
            `}</style>
          </div>
        ) : (
          content
        )}
      </div>
    </div>
  );
}

function NotificationsInbox({ T, lang = "es", onClose }) {
  const [items, setItems] = useState(null); // null=loading, [] = empty
  const [busy, setBusy] = useState(false);
  const dtd = useDragToDismiss(onClose);
  // Proactive insights generator (samas-0.2.1). Tap → calls the
  // proactive-insights Edge Function, which writes notif rows the
  // realtime subscription below picks up automatically.
  const [genBusy, setGenBusy] = useState(false);
  const [genFlash, setGenFlash] = useState(null); // string | null

  async function generateInsights() {
    if (genBusy) return;
    setGenBusy(true);
    setGenFlash(null);
    try {
      const res = await proactiveInsights();
      hapticNative("success").catch(() => {});
      if ((res?.inserted || 0) === 0) {
        setGenFlash(tr("notif.insights.none", lang));
      } else {
        setGenFlash(tr("notif.insights.created", lang, { n: res.inserted }));
      }
      setTimeout(() => setGenFlash(null), 4000);
    } catch (e) {
      if (e?.name === "AIConsentDeniedError" || e?.name === "AIQuotaExceededError") {
        // Consent declined OR quota hit — silent. Consent modal or
        // Plus upsell modal already showed UI.
      } else {
        setGenFlash(tr("notif.insights.error", lang));
        setTimeout(() => setGenFlash(null), 4000);
      }
    } finally {
      setGenBusy(false);
    }
  }

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
      <div ref={dtd.ref} style={{
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
        ...dtd.dragStyle,
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
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontFamily: FONT.display, fontSize: 18, fontWeight: 700, color: T.text }}>
              {tr("notif.title", lang)}
            </div>
            <AIQuotaPill T={T} lang={lang} />
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <button onClick={generateInsights} disabled={genBusy} style={{
              background: T.accentSoft, border: `1px solid ${T.accent}55`,
              color: T.accent, fontFamily: FONT.sans, fontSize: 11, fontWeight: 700,
              padding: "5px 10px", borderRadius: 999,
              cursor: genBusy ? "default" : "pointer",
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
                style={genBusy ? { animation: "samas-spin 1s linear infinite" } : null}>
                <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/>
              </svg>
              {genBusy ? tr("notif.insights.generating", lang) : tr("notif.insights.generate", lang)}
            </button>
            {items && items.length > 0 && (
              <button onClick={clearAll} disabled={busy} style={{
                background: "transparent", border: "none",
                color: T.textMute, fontFamily: FONT.sans, fontSize: 12, fontWeight: 600,
                cursor: busy ? "default" : "pointer",
              }}>{tr("notif.clear_all", lang)}</button>
            )}
          </div>
        </div>
        {genFlash && (
          <div style={{
            margin: "0 20px 8px", padding: "8px 12px", borderRadius: 10,
            background: T.accentSoft, border: `1px solid ${T.accent}55`,
            color: T.accent, fontFamily: FONT.sans, fontSize: 12, fontWeight: 600,
          }}>{genFlash}</div>
        )}
        <div style={{
          flex: 1, overflowY: "auto",
          padding: "0 16px 24px",
        }}>
          {items === null ? (
            // Skeleton stack mirrors the resolved row layout so the
            // sheet doesn't reflow when the data arrives. Three rows
            // is enough to fill the visible area on most phones.
            <div style={{ padding: "16px 0 0" }}>
              <div style={{
                background: T.surface, border: `1px solid ${T.border}`,
                borderRadius: 14, overflow: "hidden",
              }}>
                {[0, 1, 2].map((i) => (
                  <div key={i} style={{
                    padding: "12px 14px",
                    borderBottom: i === 2 ? "none" : `1px solid ${T.border}`,
                    display: "flex", gap: 12, alignItems: "center",
                  }}>
                    <Skeleton T={T} width={32} height={32} borderRadius={10} />
                    <div style={{ flex: 1 }}>
                      <Skeleton T={T} height={13} width="65%" marginBottom={6} />
                      <Skeleton T={T} height={11} width="40%" />
                    </div>
                  </div>
                ))}
              </div>
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
                <NotifGroup T={T} label={tr("wallet.today", lang).toUpperCase()} items={groups.today} onTap={onClose} />
              )}
              {groups.earlier.length > 0 && (
                <NotifGroup T={T} label={tr("notif.earlier", lang).toUpperCase()} items={groups.earlier} onTap={onClose} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function NotifGroup({ T, label, items, onTap }) {
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
          <NotifRow key={n.id} T={T} n={n} isLast={i === items.length - 1} onTap={onTap} />
        ))}
      </div>
    </>
  );
}

// Map a notification kind+data to a cross-shell navigation. Social
// kinds dispatch a window CustomEvent that SamasShell listens for —
// it stashes the target id in localStorage and switches to the
// Social tab; SocialPage's mount-effect reads the briefcase and
// drills into the right view (ProfileView or ThreadView). Same
// pattern used by share-trade / share-watchlist.
//
// Returns true if the notification was actionable (caller closes
// the inbox), false otherwise.
function navigateFromNotif(n) {
  const data = n?.data || {};
  switch (n?.kind) {
    case "social_follow":
      // Open the follower's profile.
      if (!data.actor_id) return false;
      window.dispatchEvent(new CustomEvent("samas:open-profile", {
        detail: { userId: data.actor_id },
      }));
      return true;
    case "social_like":
    case "social_repost":
    case "social_reply":
    case "mention":
      // Open the post thread the engagement happened on.
      if (!data.post_id) return false;
      window.dispatchEvent(new CustomEvent("samas:open-thread", {
        detail: { postId: data.post_id },
      }));
      return true;
    case "insight":
      // Proactive insight — if there's a ticker, deep-link into
      // the AssetSheet via the generic samas:open-asset channel.
      // BrokerShell drains samas_pending_open_asset once `assets`
      // is loaded. For non-ticker insights (cash_drag) there's no
      // destination yet — return false so the row stays inert.
      if (!data.ticker) return false;
      window.dispatchEvent(new CustomEvent("samas:open-asset", {
        detail: { ticker: data.ticker },
      }));
      return true;
    // price_alert / aporte / news / system kinds don't have a
    // social destination; future patches can wire them to the
    // matching surface (asset detail / wallet / news article).
    default:
      return false;
  }
}

// Pull the actor's display name out of the title for social kinds.
// social_notifications.sql formats titles as "{display} <verb>...",
// so we strip the known suffix per kind. Returns null when the
// notification isn't social-actor-shaped.
function actorNameFromNotif(n) {
  if (!n?.title) return null;
  const suffixes = {
    social_like:   " dio like a tu post",
    social_repost: " reposteó tu post",
    social_reply:  " respondió a tu post",
    social_follow: " empezó a seguirte",
  };
  const suf = suffixes[n.kind];
  if (suf && n.title.endsWith(suf)) {
    return n.title.slice(0, -suf.length).trim();
  }
  return null;
}

// Small SVG kind-badge that overlays the avatar's bottom-right
// corner. Crisp at any size, doesn't suffer from iOS emoji's
// generic-silhouette rendering for the 👤 glyph.
function KindBadge({ kind, T }) {
  const cfg = (() => {
    switch (kind) {
      case "social_like":
        return { bg: T.danger, glyph: (
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" fill="#fff" stroke="none"/>
        )};
      case "social_repost":
        return { bg: T.accent, glyph: (
          <g stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none">
            <polyline points="17 1 21 5 17 9"/>
            <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
            <polyline points="7 23 3 19 7 15"/>
            <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
          </g>
        )};
      case "social_reply":
        return { bg: T.accent, glyph: (
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" fill="#fff" stroke="none"/>
        )};
      case "social_follow":
        return { bg: T.accent, glyph: (
          <g stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <line x1="19" y1="8" x2="19" y2="14"/>
            <line x1="22" y1="11" x2="16" y2="11"/>
          </g>
        )};
      default:
        return null;
    }
  })();
  if (!cfg) return null;
  return (
    <div style={{
      position: "absolute", bottom: -2, right: -2,
      width: 18, height: 18, borderRadius: 9,
      background: cfg.bg, border: `2px solid ${T.surface}`,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        {cfg.glyph}
      </svg>
    </div>
  );
}

function NotifRow({ T, n, isLast, onTap }) {
  // Social kinds get a real-looking user avatar (initials + per-actor
  // color) with a small kind-badge in the corner — a major upgrade
  // from the iOS-rendered 👤 emoji which looked like a generic
  // contact silhouette in 0.0.73. Non-social kinds keep the simple
  // emoji-on-tile look since they don't have an actor.
  const actorName = actorNameFromNotif(n);
  const isSocialActor = !!actorName;
  const avatarProps = isSocialActor
    ? avatarPropsFor({
        displayName: actorName,
        // Use actor_handle as the avatar-color seed so the same
        // user gets the same color in the inbox as on their
        // profile page.
        id: n?.data?.actor_handle || n?.data?.actor_id || actorName,
      }, T.accent)
    : null;
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
      case "insight":       return { emoji: "✦",  tint: T.accent };
      default:              return { emoji: "🔔", tint: T.textMute };
    }
  })();
  const when = relativeWhen(n.createdAt);
  // Whether this notification has a destination to drill into.
  // Social kinds (like/repost/reply/follow/mention) all do; price
  // alert / aporte / news / system don't yet so the row stays
  // non-interactive for those.
  const actionable =
    n?.kind === "social_follow" ||
    n?.kind === "social_like" ||
    n?.kind === "social_repost" ||
    n?.kind === "social_reply" ||
    n?.kind === "mention" ||
    (n?.kind === "insight" && !!n?.data?.ticker);
  function handleTap() {
    if (!actionable) return;
    const navigated = navigateFromNotif(n);
    if (navigated && onTap) onTap();
  }
  return (
    <button
      onClick={handleTap}
      disabled={!actionable}
      style={{
        width: "100%", padding: "12px 14px",
        borderBottom: isLast ? "none" : `1px solid ${T.border}`,
        display: "flex", gap: 12, alignItems: "flex-start",
        // Unread rows get a faint accent stripe + slightly bolder weight.
        background: n.readAt ? "transparent" : `${T.accent}08`,
        border: "none", textAlign: "left",
        cursor: actionable ? "pointer" : "default",
        fontFamily: "inherit",
      }}
    >
      {isSocialActor ? (
        // Avatar + kind-badge for social-actor notifications.
        // KindBadge sits absolute in the bottom-right corner with
        // a 2px surface-colored border so it reads as "notch
        // overlaid on avatar" rather than two separate elements.
        <div style={{ position: "relative", flexShrink: 0 }}>
          <Avatar T={T}
            initials={avatarProps.initials}
            color={avatarProps.color}
            size={36}
          />
          <KindBadge kind={n.kind} T={T} />
        </div>
      ) : (
        <div style={{
          width: 36, height: 36, borderRadius: 10, flexShrink: 0,
          background: T.bgElev, color: meta.tint,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 16,
        }}>{meta.emoji}</div>
      )}
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
      {/* Chevron — only shown for actionable rows so the user
          can see at a glance which notifications drill in. */}
      {actionable && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke={T.textMute} strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0, marginTop: 4 }}>
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      )}
    </button>
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
  const dtd = useDragToDismiss(onClose);
  const inputRef = useRef(null);
  useModalGuard(); // 0.4.56 — hide SamasTabBar while sheet is open

  // 0.4.54 — defer focus so the sheet has time to lay out BEFORE the
  // keyboard fires. autoFocus on mount + Capacitor's keyboard resize +
  // 92dvh recalculating mid-animation made the sheet collapse to height 0
  // on iPhone (black void with just the keyboard visible). Same UX as
  // autoFocus, just async.
  useEffect(() => {
    const t = setTimeout(() => { inputRef.current?.focus(); }, 220);
    return () => clearTimeout(t);
  }, []);

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
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    }}>
      {/* 0.4.50 — convertido de centered modal a bottom sheet
          (a) keyboard ya no tapa parte del form (la sheet sube cuando abre keyboard)
          (b) drag-to-dismiss now applies.
          0.4.54 — maxHeight: "92%" (no más "92dvh"). Match al patrón de
          ModalShell, que sirve a Deposit/Withdraw/CardDetails sin issues.
          dvh recalculaba mid-keyboard-animation y colapsaba la sheet en iPhone. */}
      <div ref={dtd.ref} style={{
        width: "100%", maxWidth: 540, maxHeight: "92%",
        background: T.bgElev, color: T.text,
        borderTopLeftRadius: 28, borderTopRightRadius: 28,
        border: `1px solid ${T.border}`, borderBottom: "none",
        padding: "12px 20px calc(env(safe-area-inset-bottom) + 20px)",
        overflowY: "auto",
        ...dtd.dragStyle,
      }}>
        {/* Drag handle */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: T.border }}/>
        </div>
        <div style={{ fontFamily: FONT.display, fontSize: 20, fontWeight: 700, color: T.text, marginBottom: 4 }}>
          Aporte mensual
        </div>
        <div style={{ fontFamily: FONT.sans, fontSize: 12, color: T.textMute, marginBottom: 16 }}>
          Cargá un monto fijo cada mes. Se acredita en tu cuenta automáticamente el día que elijas.
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
          ref={inputRef}
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
      background: T.surfaceHi,
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
// ----------------------------------------------------------
// TxnsAllSheet (samas-0.4.10) — full transactions history
// ----------------------------------------------------------
// Bottom sheet opened from Wallet's Movimientos "Ver todos" link.
// Replaces the dead "Filtrar" link that used to sit there with no
// onClick. Pulls up to 200 most recent rows from public.transactions
// and renders them grouped by day (Hoy / Ayer / DD MMM).
function TxnsAllSheet({ T, lang = "es", balanceVisible, onClose }) {
  const [items, setItems] = useState(null); // null=loading, [] = empty
  const dtd = useDragToDismiss(onClose);
  useEffect(() => {
    let alive = true;
    walletApi.getTransactions({ limit: 200 })
      .then((r) => { if (alive) setItems(r); })
      .catch((e) => {
        console.error("[txns-all] load:", e);
        if (alive) setItems([]);
      });
    return () => { alive = false; };
  }, []);

  // Group by day for visual scanability — same pattern as the
  // Notifications inbox (Hoy / Antes).
  const groups = React.useMemo(() => {
    if (!items) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yest = today.getTime() - 24 * 60 * 60 * 1000;
    const buckets = new Map(); // labelKey → array
    for (const t of items) {
      let label;
      if (t.at >= today.getTime()) label = tr("wallet.today", lang);
      else if (t.at >= yest) label = tr("wallet.yesterday", lang);
      else {
        const d = new Date(t.at);
        label = d.toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
      }
      const arr = buckets.get(label) || [];
      arr.push(t);
      buckets.set(label, arr);
    }
    return [...buckets.entries()];
  }, [items, lang]);

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    }}>
      <div ref={dtd.ref} style={{
        width: "100%", maxWidth: 540, maxHeight: "92dvh",
        minHeight: "60dvh",
        background: T.bgElev, color: T.text,
        borderTopLeftRadius: 28, borderTopRightRadius: 28,
        border: `1px solid ${T.border}`, borderBottom: "none",
        display: "flex", flexDirection: "column", overflow: "hidden",
        ...dtd.dragStyle,
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
            {tr("wallet.section.txns", lang)}
          </div>
          <button onClick={onClose} style={{
            background: "transparent", border: "none",
            color: T.textMute, fontFamily: FONT.sans, fontSize: 14, fontWeight: 600,
            cursor: "pointer",
          }}>{tr("wallet.txns_all.close", lang)}</button>
        </div>
        {/* Body */}
        <div style={{
          flex: 1, overflowY: "auto",
          padding: "0 16px 24px",
        }}>
          {items === null ? (
            <div style={{ padding: "16px 0 0" }}>
              <div style={{
                background: T.surface, border: `1px solid ${T.border}`,
                borderRadius: 14, overflow: "hidden",
              }}>
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} style={{
                    padding: "14px 16px",
                    borderBottom: i === 4 ? "none" : `1px solid ${T.border}`,
                    display: "flex", gap: 12, alignItems: "center",
                  }}>
                    <Skeleton T={T} width={38} height={38} borderRadius={12} />
                    <div style={{ flex: 1 }}>
                      <Skeleton T={T} height={14} width="55%" marginBottom={6} />
                      <Skeleton T={T} height={11} width="40%" />
                    </div>
                    <Skeleton T={T} width={70} height={14} />
                  </div>
                ))}
              </div>
            </div>
          ) : items.length === 0 ? (
            <div style={{
              padding: "40px 20px", textAlign: "center",
              fontFamily: FONT.sans, color: T.textMute,
            }}>
              <div style={{ fontFamily: FONT.display, fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 4 }}>
                {tr("wallet.txns_all.empty_title", lang)}
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                {tr("wallet.txns_all.empty_sub", lang)}
              </div>
            </div>
          ) : (
            (groups || []).map(([label, rows]) => (
              <div key={label} style={{ marginTop: 16 }}>
                <div style={{
                  fontFamily: FONT.mono, fontSize: 10, fontWeight: 700,
                  color: T.textMute, letterSpacing: 0.6, textTransform: "uppercase",
                  marginBottom: 6, padding: "0 4px",
                }}>{label}</div>
                <div style={{
                  background: T.surface, border: `1px solid ${T.border}`,
                  borderRadius: 14, overflow: "hidden",
                }}>
                  {rows.map((t, i) => (
                    <TxnRow key={t.id} t={t} T={T}
                      isLast={i === rows.length - 1}
                      visible={balanceVisible} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

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
  const dtd = useDragToDismiss(onClose);
  useModalGuard(); // 0.4.56 — hide SamasTabBar while sheet is open
  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    }}>
      <div ref={dtd.ref} style={{
        width: "100%", maxWidth: 540, maxHeight: "92%",
        background: T.bgElev, color: T.text,
        borderTopLeftRadius: 28, borderTopRightRadius: 28,
        border: `1px solid ${T.border}`, borderBottom: "none",
        display: "flex", flexDirection: "column", overflow: "hidden",
        ...dtd.dragStyle,
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
  const [ccy, setCcy] = useState("ARS");
  const [source, setSource] = useState("mp");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function submit() {
    setErr(null);
    const n = parseFloat(amount);
    if (!n || n <= 0) { setErr("Ingresá un monto válido."); return; }
    setBusy(true);
    try {
      await walletApi.deposit({ amount: n, ccy, source });
      onDone();
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  // Quick-amount chips so the user doesn't have to type for the
  // common amounts. Different sets per currency since pesos and
  // dolares operate on different scales.
  const quickAmounts = ccy === "ARS"
    ? [50000, 100000, 250000, 500000]
    : [50, 100, 500, 1000];

  return (
    <ModalShell T={T} title={tr("deposit.title", lang)} onClose={onClose}>
      <div style={{ fontFamily: FONT.sans, fontSize: 13, color: T.textMute, marginBottom: 16, lineHeight: 1.5 }}>
        Sumá fondos a tu cuenta. Esos fondos son los que después usás para invertir
        — sin paso intermedio.
      </div>

      {/* Currency picker */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {[{ id: "ARS", label: "Pesos" }, { id: "USD", label: "Dólares" }].map((c) => (
          <button key={c.id} onClick={() => { setCcy(c.id); setAmount(""); }} style={{
            flex: 1, padding: "10px", borderRadius: 12,
            background: ccy === c.id ? T.accent : T.surface,
            border: `1px solid ${ccy === c.id ? T.accent : T.border}`,
            color: ccy === c.id ? T.accentInk : T.text,
            fontFamily: FONT.sans, fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}>{c.label}</button>
        ))}
      </div>

      {/* Source */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[
          { id: "mp", label: "Mercado Pago", sub: "Acreditación instantánea" },
          { id: "transfer", label: "Transferencia", sub: "Tu CBU / Alias" },
        ].map(s => (
          <button key={s.id} onClick={() => setSource(s.id)} style={{
            flex: 1, padding: "10px 12px", borderRadius: 12, textAlign: "left",
            background: source === s.id ? T.accentSoft : T.surface,
            border: `1px solid ${source === s.id ? T.accent : T.border}`,
            color: source === s.id ? T.accent : T.text,
            fontFamily: FONT.sans, fontSize: 13, fontWeight: 700, cursor: "pointer",
            display: "flex", flexDirection: "column", gap: 3,
          }}>
            <span>{s.label}</span>
            <span style={{ fontSize: 10, fontWeight: 500, color: T.textMute }}>{s.sub}</span>
          </button>
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
          <div style={{ marginTop: 8, fontFamily: FONT.sans, fontSize: 11, color: T.textMute, lineHeight: 1.4 }}>
            La plata se acredita cuando la transferencia llega — típicamente en
            menos de 1 minuto en horario bancario.
          </div>
        </div>
      )}

      <NumberInput T={T} label={`Monto (${ccy})`} value={amount} onChange={setAmount} />

      {/* Quick-amount chips */}
      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        {quickAmounts.map((q) => (
          <button key={q} onClick={() => setAmount(String(q))} style={{
            padding: "6px 12px", borderRadius: 999,
            background: T.bg, border: `1px solid ${T.border}`,
            color: T.text, fontFamily: FONT.mono, fontSize: 11, fontWeight: 700,
            cursor: "pointer",
          }}>
            {ccy === "ARS" ? "$" : "US$"}{q.toLocaleString("es-AR")}
          </button>
        ))}
      </div>

      {err && <div style={{ marginTop: 12, color: T.danger, fontFamily: FONT.sans, fontSize: 12 }}>{err}</div>}

      <button onClick={submit} disabled={busy} style={{
        width: "100%", marginTop: 20, padding: 16, borderRadius: 14,
        background: T.accent, color: T.accentInk,
        fontFamily: FONT.sans, fontSize: 15, fontWeight: 700, border: "none",
        cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
      }}>
        {busy
          ? "Procesando..."
          : source === "mp" ? "Ir a Mercado Pago" : "Generar instrucción"}
      </button>

      <div style={{
        marginTop: 12, fontFamily: FONT.sans, fontSize: 10, color: T.textMute,
        textAlign: "center", lineHeight: 1.4,
      }}>
        Demo: la plata se acredita instantáneamente. Producción: pasa por el
        webhook del partner (MP / transferencia bancaria) antes de aparecer.
      </div>
    </ModalShell>
  );
}

function WithdrawModal({ T, lang = "es", balance, onClose, onDone }) {
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [password, setPassword] = useState("");  // 0.0.98 reauth gate
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function submit() {
    setErr(null);
    const n = parseFloat(amount);
    if (!n || n <= 0) { setErr("Monto inválido."); return; }
    if (!destination.trim()) { setErr("Indicá CBU o alias destino."); return; }
    if (!password) { setErr("Confirmá tu contraseña."); return; }
    setBusy(true);
    try {
      // Step 1: re-auth. Throws "Contraseña incorrecta." which we
      // surface inline. Even if a session is hijacked or the device
      // is unlocked, withdrawing requires the password again.
      await reauthWithPassword(password);
      // Step 2: actual withdraw.
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
      <div style={{ height: 14 }}/>
      {/* Password reauth (samas-0.0.98). Belt-and-braces — even
          inside an authenticated session, outbound transfers
          require fresh password proof. */}
      <div style={{ fontFamily: FONT.sans, fontSize: 12, color: T.text, marginBottom: 6 }}>
        Confirmar con contraseña
      </div>
      <input
        type="password"
        value={password}
        onChange={(e) => { setPassword(e.target.value); setErr(null); }}
        autoComplete="current-password"
        placeholder="Tu contraseña"
        style={{
          width: "100%", padding: "12px 14px", borderRadius: 12,
          background: T.surface, border: `1px solid ${T.border}`,
          color: T.text, fontFamily: FONT.sans, fontSize: 14,
          outline: "none", boxSizing: "border-box",
        }}
      />

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
        background: T.surfaceHi,
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
