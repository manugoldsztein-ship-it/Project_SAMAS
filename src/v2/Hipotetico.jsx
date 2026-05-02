// ============================================================
// Hipotetico — historical-backtest tool (samas-0.4.22)
// ============================================================
// Manuel's father (financial advisor) flagged in his review that the
// app was missing a "what if I had invested $X N years ago in this
// strategy?" surface. Every retail-investing app worth its salt has
// one — Cocos, Balanz, IOL all do — and it's the single feature an
// asesor financiero uses to walk a new client through how compounding
// works.
//
// SCOPE
//   - Two surfaces: Wallet card (entry) + bottom sheet (full UX)
//   - User picks: strategy (conservadora / moderada / agresiva)
//                 initial amount + currency
//                 horizon (1y / 3y / 5y / 10y)
//   - Output: line chart of value over time + final number + delta
//     vs. plain savings (bank deposit baseline).
//   - All deterministic, computed client-side. No Edge Function call,
//     no AI in the loop — just compound growth + seeded variance for
//     visual realism.
//
// WHY NOT REAL HISTORICAL DATA?
//   For a Cohen-pitch demo we don't need actual market history; we
//   need a tool that DEMONSTRATES the calculation engine. When we
//   onboard with Cohen they'll plug in their real backtest data —
//   the UI shape and the math don't change, only the prices array.
//   The seeded variance gives the chart a believable shape (drawdowns,
//   recoveries) instead of a smooth exponential which would scream
//   "this is fake".
//
// CALIBRATION
//   Returns calibrated in samas-0.4.15 against Manuel's father's
//   feedback: conservadora 4% base, moderada 7% base, agresiva 10%
//   base. We display a low/base/high BAND from the same return-rate
//   table so users see a range, not a fantasy single number.
// ============================================================

import React, { useState, useMemo, useEffect } from "react";
import ReactDOM from "react-dom";
import { FONT, fmtMoney } from "./theme.js";
import { t as tr } from "../lib/i18n.js";
import { hapticNative } from "../lib/native.js";
import { DisclaimerStrip } from "./shared.jsx";

// Same calibration as supabase/functions/objectives-plan/index.ts
// (samas-0.4.15). Keep in sync — if the Edge Function changes its
// return bands, update this table too.
const ANNUAL_RETURN_BANDS = {
  conservadora: { low: 0.02, base: 0.04, high: 0.06 },
  moderada:     { low: 0.04, base: 0.07, high: 0.10 },
  agresiva:     { low: 0.05, base: 0.10, high: 0.15 },
};

// Plain savings baseline — what you'd get parking the money in a
// US savings account (USD) or a plazo-fijo UVA (ARS). Conservative
// reference so the strategy looks favorable but not implausibly so.
const SAVINGS_BASELINE = { USD: 0.04, ARS: 0.04 }; // 4% real

const HORIZONS = [
  { months: 12,  labelKey: "hipotetico.horizon.1y" },
  { months: 36,  labelKey: "hipotetico.horizon.3y" },
  { months: 60,  labelKey: "hipotetico.horizon.5y" },
  { months: 120, labelKey: "hipotetico.horizon.10y" },
];

// FNV-1a hash → seed for the variance generator. Same inputs yield
// the same chart — no shimmer between renders, but different
// strategies / amounts / horizons produce visually distinct paths.
function seedFor(strategy, months, amount) {
  const s = `${strategy}:${months}:${Math.round(amount)}`;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
function mulberry32(seed) {
  return function () {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * runBacktest — compute month-by-month value series.
 *
 * Returns:
 *   {
 *     series:      number[],   // length = months+1, starts at amount
 *     finalValue:  number,
 *     finalLow:    number,
 *     finalHigh:   number,
 *     savingsValue: number,
 *     totalReturn: number,     // (final / initial) - 1
 *     vsSavings:   number,     // final / savingsValue - 1
 *   }
 */
function runBacktest({ strategy, months, amount, currency }) {
  const band = ANNUAL_RETURN_BANDS[strategy];
  const baseMonthly = band.base / 12;
  // Per-month variance — gives the chart a realistic shape with
  // drawdowns. Variance amplitude scales with the strategy:
  // conservadora ~1% vol, moderada ~2.5%, agresiva ~5% per month.
  const volByStrategy = { conservadora: 0.010, moderada: 0.025, agresiva: 0.050 };
  const monthlyVol = volByStrategy[strategy] || 0.02;
  const rng = mulberry32(seedFor(strategy, months, amount));

  const series = [amount];
  let value = amount;
  for (let i = 0; i < months; i++) {
    // Box-Muller-ish: sample two uniforms → approx-normal. We don't
    // need exact normality, just symmetric around 0.
    const u = (rng() + rng() + rng() - 1.5) * (2 / 3); // ~N(0,1)
    const monthlyReturn = baseMonthly + u * monthlyVol;
    value = value * (1 + monthlyReturn);
    series.push(value);
  }
  // Bands: deterministic (no variance) low/base/high projections so
  // the user sees a range. Apply the FV formula directly.
  const fv = (rate) => amount * Math.pow(1 + rate / 12, months);
  const finalLow  = fv(band.low);
  const finalHigh = fv(band.high);

  const savingsValue = fv(SAVINGS_BASELINE[currency] || SAVINGS_BASELINE.USD);

  return {
    series,
    finalValue:   value,
    finalLow,
    finalHigh,
    savingsValue,
    totalReturn:  value / amount - 1,
    vsSavings:    value / savingsValue - 1,
  };
}

// ----- Wallet card (entry point) -----
export function HipoteticoCard({ T, lang = "es" }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div style={{ margin: "20px 16px 0" }}>
        <div style={{
          fontFamily: FONT.mono, fontSize: 11, fontWeight: 700,
          color: T.textMute, letterSpacing: 0.6, textTransform: "uppercase",
        }}>
          {tr("hipotetico.section.title", lang)}
        </div>
        <button
          onClick={() => { setOpen(true); hapticNative("tap").catch(() => {}); }}
          style={{
            marginTop: 12, padding: 16, borderRadius: 22,
            width: "100%", textAlign: "left", cursor: "pointer",
            background: T.surface,
            border: `1px solid ${T.accent}55`,
            display: "flex", alignItems: "center", gap: 14,
            fontFamily: "inherit",
          }}
        >
          <div style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            background: T.accent, color: T.accentInk,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {/* Trending-up glyph — the asesor's universal "compound
                growth" symbol. */}
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
              <polyline points="17 6 23 6 23 12"/>
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: FONT.sans, fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 2,
            }}>{tr("hipotetico.cta.title", lang)}</div>
            <div style={{
              fontFamily: FONT.sans, fontSize: 12, color: T.textMute, lineHeight: 1.4,
            }}>{tr("hipotetico.cta.sub", lang)}</div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.textMute}
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
      </div>
      {open && <HipoteticoSheet T={T} lang={lang} onClose={() => setOpen(false)} />}
    </>
  );
}

// ----- Bottom sheet -----
function HipoteticoSheet({ T, lang, onClose }) {
  const [strategy, setStrategy] = useState("moderada");
  const [amount, setAmount] = useState("10000");
  const [currency, setCurrency] = useState("USD");
  const [months, setMonths] = useState(60);

  const numericAmount = Number(amount.replace(/[^0-9.]/g, "")) || 0;

  // Live-recompute on every input change. Cheap (≤120 iterations).
  const result = useMemo(() => {
    if (numericAmount <= 0) return null;
    return runBacktest({
      strategy, months, amount: numericAmount, currency,
    });
  }, [strategy, months, numericAmount, currency]);

  if (typeof document === "undefined") return null;

  const ccyPrefix = currency === "USD" ? "US$" : "$";
  const stratColor = (s) => ({
    conservadora: T.textMute,
    moderada:     T.accent,
    agresiva:     "#F59E0B",
  })[s] || T.accent;

  return ReactDOM.createPortal(
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 140,
        background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
      }}
    >
      <div style={{
        width: "100%", maxWidth: 540, maxHeight: "92dvh",
        background: T.bgElev || T.bg, color: T.text,
        borderTopLeftRadius: 28, borderTopRightRadius: 28,
        border: `1px solid ${T.border}`, borderBottom: "none",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        {/* Drag handle */}
        <div style={{ display: "flex", justifyContent: "center", paddingTop: 12 }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: T.border }}/>
        </div>

        {/* Header */}
        <div style={{
          padding: "12px 22px 10px",
          background: "transparent",
        }}>
          <div style={{
            fontFamily: FONT.mono, fontSize: 10, fontWeight: 700,
            color: T.accent, letterSpacing: 0.6, textTransform: "uppercase",
            marginBottom: 4,
          }}>{tr("hipotetico.sheet.kicker", lang)}</div>
          <div style={{
            fontFamily: FONT.display, fontSize: 22, fontWeight: 800,
            color: T.text, letterSpacing: -0.3,
          }}>
            {tr("hipotetico.sheet.title", lang)}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 22px 20px" }}>
          {/* Strategy picker */}
          <div style={{
            fontFamily: FONT.mono, fontSize: 9, fontWeight: 700,
            color: T.textMute, letterSpacing: 0.6, textTransform: "uppercase",
            marginBottom: 6,
          }}>{tr("hipotetico.strategy_label", lang)}</div>
          <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
            {(["conservadora", "moderada", "agresiva"]).map((s) => (
              <button key={s} onClick={() => setStrategy(s)}
                style={{
                  flex: 1, padding: "10px 8px", borderRadius: 12,
                  background: strategy === s ? stratColor(s) + "22" : T.surface,
                  border: `1px solid ${strategy === s ? stratColor(s) + "88" : T.border}`,
                  color: strategy === s ? stratColor(s) : T.text,
                  fontFamily: FONT.sans, fontSize: 12, fontWeight: 700,
                  cursor: "pointer", textTransform: "capitalize",
                }}>{s}</button>
            ))}
          </div>

          {/* Amount + currency */}
          <div style={{
            fontFamily: FONT.mono, fontSize: 9, fontWeight: 700,
            color: T.textMute, letterSpacing: 0.6, textTransform: "uppercase",
            marginBottom: 6,
          }}>{tr("hipotetico.amount_label", lang)}</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <input
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={tr("hipotetico.amount_ph", lang)}
              style={{
                flex: 1, padding: "11px 14px", borderRadius: 12,
                background: T.surface, border: `1px solid ${T.border}`,
                color: T.text, fontFamily: FONT.mono, fontSize: 14, outline: "none",
              }}
            />
            <div style={{ display: "flex", gap: 4 }}>
              {["ARS", "USD"].map((c) => (
                <button key={c} onClick={() => setCurrency(c)}
                  style={{
                    padding: "11px 14px", borderRadius: 12,
                    background: currency === c ? T.accent : T.surface,
                    border: `1px solid ${currency === c ? T.accent : T.border}`,
                    color: currency === c ? T.accentInk : T.text,
                    fontFamily: FONT.mono, fontSize: 13, fontWeight: 800, letterSpacing: 0.4,
                    cursor: "pointer",
                  }}>{c}</button>
              ))}
            </div>
          </div>

          {/* Horizon */}
          <div style={{
            fontFamily: FONT.mono, fontSize: 9, fontWeight: 700,
            color: T.textMute, letterSpacing: 0.6, textTransform: "uppercase",
            marginBottom: 6,
          }}>{tr("hipotetico.horizon_label", lang)}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
            {HORIZONS.map((h) => (
              <button key={h.months} onClick={() => setMonths(h.months)}
                style={{
                  padding: "8px 14px", borderRadius: 12,
                  background: months === h.months ? T.accent : T.surface,
                  border: `1px solid ${months === h.months ? T.accent : T.border}`,
                  color: months === h.months ? T.accentInk : T.text,
                  fontFamily: FONT.sans, fontSize: 13, fontWeight: 700,
                  cursor: "pointer",
                }}>{tr(h.labelKey, lang)}</button>
            ))}
          </div>

          {/* Result */}
          {result && numericAmount > 0 && (
            <>
              {/* Final value card */}
              <div style={{
                padding: "14px 16px", borderRadius: 16, marginBottom: 12,
                background: stratColor(strategy) + "11",
                border: `1px solid ${stratColor(strategy)}55`,
              }}>
                <div style={{
                  fontFamily: FONT.mono, fontSize: 9, fontWeight: 700,
                  color: stratColor(strategy), letterSpacing: 0.6, textTransform: "uppercase",
                  marginBottom: 4,
                }}>{tr("hipotetico.result.final_label", lang)}</div>
                <div style={{
                  fontFamily: FONT.display, fontSize: 30, fontWeight: 800,
                  color: T.text, letterSpacing: -0.6, fontVariantNumeric: "tabular-nums",
                }}>
                  {ccyPrefix}{fmtMoney(result.finalValue, currency)}
                </div>
                <div style={{
                  marginTop: 4,
                  fontFamily: FONT.mono, fontSize: 11, color: T.textMute,
                }}>
                  {tr("hipotetico.result.range", lang, {
                    low:  `${ccyPrefix}${fmtMoney(result.finalLow, currency)}`,
                    high: `${ccyPrefix}${fmtMoney(result.finalHigh, currency)}`,
                  })}
                </div>
              </div>

              {/* Chart */}
              <BacktestChart T={T} series={result.series} stratColor={stratColor(strategy)} months={months} lang={lang} />

              {/* Stats: total return + vs savings */}
              <div style={{ display: "flex", gap: 8, marginTop: 12, marginBottom: 12 }}>
                <StatBox T={T}
                  label={tr("hipotetico.result.total_return", lang)}
                  value={`${result.totalReturn >= 0 ? "+" : ""}${(result.totalReturn * 100).toFixed(1)}%`}
                  positive={result.totalReturn >= 0}
                />
                <StatBox T={T}
                  label={tr("hipotetico.result.vs_savings", lang)}
                  value={`${result.vsSavings >= 0 ? "+" : ""}${(result.vsSavings * 100).toFixed(1)}%`}
                  positive={result.vsSavings >= 0}
                  hint={`${ccyPrefix}${fmtMoney(result.savingsValue, currency)}`}
                />
              </div>

              {/* Disclaimer — heavy, since this surface looks like a
                  forecast even though it's a backtest tool. Use the
                  returns-specific copy that explicitly mentions past
                  performance ≠ future results. */}
              <DisclaimerStrip T={T} variant="card" textKey="common.ai_disclaimer_returns" lang={lang} />
            </>
          )}

          {numericAmount <= 0 && (
            <div style={{
              padding: 24, textAlign: "center", borderRadius: 14,
              background: T.surface, border: `1px solid ${T.border}`,
              fontFamily: FONT.sans, fontSize: 13, color: T.textMute,
            }}>{tr("hipotetico.empty", lang)}</div>
          )}
        </div>

        {/* Sticky footer */}
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
          }}>{tr("hipotetico.close", lang)}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ----- Inline SVG line chart -----
// Same visual language as the Wallet portfolio sparkline (gradient
// fill + 2px stroke) but at 100% width with month labels along the
// X axis. No external chart lib — keeps the bundle small.
function BacktestChart({ T, series, stratColor, months, lang }) {
  const W = 320;
  const H = 140;
  const PAD_X = 8;
  const PAD_Y_TOP = 8;
  const PAD_Y_BOT = 22;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;

  const points = series.map((v, i) => {
    const x = PAD_X + (i / (series.length - 1)) * (W - 2 * PAD_X);
    const y = PAD_Y_TOP + (1 - (v - min) / range) * (H - PAD_Y_TOP - PAD_Y_BOT);
    return [x, y];
  });
  const pts = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const areaPts = `${pts} ${(W - PAD_X).toFixed(1)},${(H - PAD_Y_BOT).toFixed(1)} ${PAD_X.toFixed(1)},${(H - PAD_Y_BOT).toFixed(1)}`;
  const gradId = `samas-hipo-${stratColor.replace(/[^a-zA-Z0-9]/g, "")}`;

  // X-axis tick labels — show start, midpoint, end as years.
  const yrs = months / 12;
  const labels = [
    { x: PAD_X, label: "0y" },
    { x: W / 2, label: `${(yrs / 2).toFixed(yrs >= 4 ? 0 : 1)}y` },
    { x: W - PAD_X, label: `${yrs.toFixed(0)}y` },
  ];

  return (
    <div style={{
      padding: 12, borderRadius: 14,
      background: T.surface, border: `1px solid ${T.border}`,
      marginBottom: 0,
    }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: "block" }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stratColor} stopOpacity="0.4" />
            <stop offset="100%" stopColor={stratColor} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Area fill */}
        <polygon points={areaPts} fill={`url(#${gradId})`} />
        {/* Line */}
        <polyline points={pts} fill="none" stroke={stratColor} strokeWidth={2}
          strokeLinecap="round" strokeLinejoin="round" />
        {/* Baseline */}
        <line
          x1={PAD_X} y1={H - PAD_Y_BOT}
          x2={W - PAD_X} y2={H - PAD_Y_BOT}
          stroke={T.border} strokeWidth={1}
        />
        {/* X labels */}
        {labels.map((l, i) => (
          <text key={i} x={l.x} y={H - 4}
            fontFamily="monospace" fontSize="10"
            fill={T.textMute}
            textAnchor={i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle"}
          >{l.label}</text>
        ))}
      </svg>
    </div>
  );
}

function StatBox({ T, label, value, positive, hint }) {
  return (
    <div style={{
      flex: 1, padding: "10px 12px", borderRadius: 12,
      background: T.surface, border: `1px solid ${T.border}`,
    }}>
      <div style={{
        fontFamily: FONT.mono, fontSize: 9, fontWeight: 700,
        color: T.textMute, letterSpacing: 0.5, textTransform: "uppercase",
        marginBottom: 4,
      }}>{label}</div>
      <div style={{
        fontFamily: FONT.mono, fontSize: 16, fontWeight: 800,
        color: positive ? T.accent : T.danger,
      }}>{value}</div>
      {hint && (
        <div style={{
          fontFamily: FONT.mono, fontSize: 10, color: T.textMute, marginTop: 2,
        }}>{hint}</div>
      )}
    </div>
  );
}
