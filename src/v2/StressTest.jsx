// ============================================================
// StressTest — historical-scenario portfolio stress test (samas-0.4.27)
// ============================================================
// "¿Cómo aguantó esta cartera durante COVID / 2008 / corralito?"
// Every senior AR financial advisor opens client meetings with this
// question. Zero retail brokers expose it. SAMAS makes it a one-tap
// card in Wallet.
//
// METHOD
//   For each preset scenario, we have hardcoded percentage drawdowns
//   per asset CATEGORY (CEDEAR / ACCION / BONO / ETF / COMMOD)
//   sourced from public market data. Apply each category's drawdown
//   to the user's portfolio % in that category, sum to a portfolio-
//   level "what would your book have done" number.
//
//   This is intentionally simple: real factor-model stress tests
//   require correlation matrices and per-asset shocks. For a Cohen-
//   pitch demo, category-level shocks are honest enough — and the
//   methodology is transparent (the math is in this file).
//
// SCENARIOS
//   Pinned to events that AR retail crowds remember vividly:
//   - 2020 COVID crash (Feb-Mar 2020)
//   - 2008 GFC (Sep-Oct 2008)
//   - 2018 Macri devaluation (Aug-Sep 2018)
//   - 2001 Corralito (Dec 2001-Jan 2002)
//   Numbers are public data, rounded to whole percentage points.
// ============================================================

import React, { useState, useMemo } from "react";
import ReactDOM from "react-dom";
import { FONT, fmtMoney } from "./theme.js";
import { t as tr } from "../lib/i18n.js";
import { hapticNative } from "../lib/native.js";
import { DisclaimerStrip } from "./shared.jsx";

// Category-level peak-to-trough drawdowns (in % of value lost) for
// each historical event. Sources: public market data, S&P / MSCI
// indexes for global, Merval / IAMC for AR. CRYPTO column dropped
// in samas-0.4.21 (Cohen doesn't operate crypto).
//
// Values are negative (losses). A 0 means the category was flat or
// gained (e.g., USD bonds during AR-specific crises).
const SCENARIOS = [
  {
    id: "covid_2020",
    titleKey: "stress.scenario.covid",
    period:   "Feb-Mar 2020",
    duration: "~30 días",
    drawdowns: { CEDEAR: -34, ACCION: -41, ETF: -33, BONO: -8, COMMOD: -27 },
    note: "stress.note.covid",
  },
  {
    id: "gfc_2008",
    titleKey: "stress.scenario.gfc",
    period:   "Sep-Oct 2008",
    duration: "~60 días",
    drawdowns: { CEDEAR: -38, ACCION: -52, ETF: -36, BONO: -12, COMMOD: -22 },
    note: "stress.note.gfc",
  },
  {
    id: "macri_2018",
    titleKey: "stress.scenario.macri",
    period:   "Ago-Sep 2018",
    duration: "~45 días",
    drawdowns: { CEDEAR: -8,  ACCION: -45, ETF: -5, BONO: -20, COMMOD: 0  },
    note: "stress.note.macri",
  },
  {
    id: "corralito_2001",
    titleKey: "stress.scenario.corralito",
    period:   "Dic 2001-Ene 2002",
    duration: "~45 días",
    drawdowns: { CEDEAR: -22, ACCION: -68, ETF: -10, BONO: -65, COMMOD: -5 },
    note: "stress.note.corralito",
  },
];

function applyScenario(portfolio, scenario) {
  // Build sector mix: % of total portfolio per category.
  if (!portfolio || !portfolio.holdings || portfolio.totalUsd <= 0) return null;
  const sectorPct = {};
  for (const h of portfolio.holdings) {
    const cat = h.category || "OTROS";
    const valueUsd = h.currency === "ARS" ? (h.value || 0) / 1245 : (h.value || 0);
    const w = valueUsd / portfolio.totalUsd;
    sectorPct[cat] = (sectorPct[cat] || 0) + w;
  }
  // Weighted portfolio drawdown = Σ (weight_cat × drawdown_cat).
  // Categories not in the scenario fall back to 0 (no shock).
  let portfolioDrawdown = 0;
  const breakdown = [];
  for (const [cat, w] of Object.entries(sectorPct)) {
    const ddPct = (scenario.drawdowns[cat] ?? 0) / 100;
    portfolioDrawdown += w * ddPct;
    breakdown.push({ cat, weight: w, ddPct, contribUsd: w * ddPct * portfolio.totalUsd });
  }
  // Sort breakdown by absolute contribution (biggest pain points first).
  breakdown.sort((a, b) => Math.abs(b.contribUsd) - Math.abs(a.contribUsd));

  const lossUsd = portfolioDrawdown * portfolio.totalUsd;
  const after = portfolio.totalUsd + lossUsd;

  return {
    portfolioDrawdown,           // negative number (e.g. -0.27 for -27%)
    lossUsd,                     // negative
    afterUsd: after,
    breakdown,                   // sorted by contribution magnitude
  };
}

// ----- Wallet card (entry point) -----
export function StressTestCard({ T, lang = "es", portfolio }) {
  const [open, setOpen] = useState(false);
  // Card hidden when the user has no portfolio — there's nothing to
  // stress-test against. Comes back automatically once they trade.
  if (!portfolio || portfolio.totalUsd <= 0) return null;
  return (
    <>
      <div style={{ margin: "20px 16px 0" }}>
        <div style={{
          fontFamily: FONT.mono, fontSize: 11, fontWeight: 700,
          color: T.textMute, letterSpacing: 0.6, textTransform: "uppercase",
        }}>
          {tr("stress.section.title", lang)}
        </div>
        <button
          onClick={() => { setOpen(true); hapticNative("tap").catch(() => {}); }}
          style={{
            marginTop: 12, padding: 16, borderRadius: 22,
            width: "100%", textAlign: "left", cursor: "pointer",
            background: T.surface,
            border: `1px solid ${T.border}`,
            display: "flex", alignItems: "center", gap: 14,
            fontFamily: "inherit",
          }}
        >
          {/* Shield-with-warning glyph — "stress test" reads as
              "stress on a defensive structure". */}
          <div style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            background: T.dangerSoft, color: T.danger,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: FONT.sans, fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 2,
            }}>{tr("stress.cta.title", lang)}</div>
            <div style={{
              fontFamily: FONT.sans, fontSize: 12, color: T.textMute, lineHeight: 1.4,
            }}>{tr("stress.cta.sub", lang)}</div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.textMute}
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
      </div>
      {open && <StressTestSheet T={T} lang={lang} portfolio={portfolio} onClose={() => setOpen(false)} />}
    </>
  );
}

// ----- Bottom sheet -----
function StressTestSheet({ T, lang, portfolio, onClose }) {
  const [scenarioId, setScenarioId] = useState("covid_2020");
  const scenario = SCENARIOS.find((s) => s.id === scenarioId) || SCENARIOS[0];
  const result = useMemo(
    () => applyScenario(portfolio, scenario),
    [portfolio, scenario],
  );

  if (typeof document === "undefined") return null;

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
            color: T.danger, letterSpacing: 0.6, textTransform: "uppercase",
            marginBottom: 4,
          }}>{tr("stress.sheet.kicker", lang)}</div>
          <div style={{
            fontFamily: FONT.display, fontSize: 22, fontWeight: 800,
            color: T.text, letterSpacing: -0.3,
          }}>
            {tr("stress.sheet.title", lang)}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 22px 20px" }}>
          {/* Scenario picker */}
          <div style={{
            fontFamily: FONT.mono, fontSize: 9, fontWeight: 700,
            color: T.textMute, letterSpacing: 0.6, textTransform: "uppercase",
            marginBottom: 6,
          }}>{tr("stress.scenario_label", lang)}</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
            {SCENARIOS.map((s) => {
              const active = s.id === scenarioId;
              return (
                <button key={s.id}
                  onClick={() => setScenarioId(s.id)}
                  style={{
                    padding: "8px 12px", borderRadius: 12,
                    background: active ? T.danger + "22" : T.surface,
                    border: `1px solid ${active ? T.danger + "88" : T.border}`,
                    color: active ? T.danger : T.text,
                    fontFamily: FONT.sans, fontSize: 12, fontWeight: 700,
                    cursor: "pointer",
                    display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2,
                  }}>
                  <span>{tr(s.titleKey, lang)}</span>
                  <span style={{
                    fontFamily: FONT.mono, fontSize: 9, opacity: 0.7, fontWeight: 600,
                  }}>{s.period}</span>
                </button>
              );
            })}
          </div>

          {/* Result hero */}
          {result && (
            <>
              <div style={{
                padding: "16px 18px", borderRadius: 18, marginBottom: 12,
                background: T.danger + "11",
                border: `1px solid ${T.danger}55`,
              }}>
                <div style={{
                  fontFamily: FONT.mono, fontSize: 9, fontWeight: 700,
                  color: T.danger, letterSpacing: 0.6, textTransform: "uppercase",
                  marginBottom: 4,
                }}>{tr("stress.result.drawdown_label", lang)}</div>
                <div style={{
                  fontFamily: FONT.display, fontSize: 36, fontWeight: 800,
                  color: T.danger, letterSpacing: -0.6, fontVariantNumeric: "tabular-nums",
                  lineHeight: 1.1,
                }}>
                  {(result.portfolioDrawdown * 100).toFixed(1)}%
                </div>
                <div style={{
                  marginTop: 6, display: "flex", justifyContent: "space-between", alignItems: "baseline",
                  fontFamily: FONT.mono, fontSize: 12,
                }}>
                  <span style={{ color: T.textMute }}>{tr("stress.result.before_label", lang)}</span>
                  <span style={{ color: T.text, fontWeight: 700 }}>
                    US${fmtMoney(portfolio.totalUsd, "USD")}
                  </span>
                </div>
                <div style={{
                  marginTop: 4, display: "flex", justifyContent: "space-between", alignItems: "baseline",
                  fontFamily: FONT.mono, fontSize: 12,
                }}>
                  <span style={{ color: T.textMute }}>{tr("stress.result.after_label", lang)}</span>
                  <span style={{ color: T.text, fontWeight: 700 }}>
                    US${fmtMoney(result.afterUsd, "USD")}
                  </span>
                </div>
                <div style={{
                  marginTop: 4, display: "flex", justifyContent: "space-between", alignItems: "baseline",
                  fontFamily: FONT.mono, fontSize: 12,
                }}>
                  <span style={{ color: T.textMute }}>{tr("stress.result.duration_label", lang)}</span>
                  <span style={{ color: T.text, fontWeight: 700 }}>
                    {scenario.duration}
                  </span>
                </div>
              </div>

              {/* Breakdown by category — shows where the pain came from. */}
              <div style={{
                padding: 14, borderRadius: 14, marginBottom: 12,
                background: T.surface, border: `1px solid ${T.border}`,
              }}>
                <div style={{
                  fontFamily: FONT.mono, fontSize: 9, fontWeight: 700,
                  color: T.textMute, letterSpacing: 0.5, textTransform: "uppercase",
                  marginBottom: 10,
                }}>{tr("stress.breakdown.title", lang)}</div>
                {result.breakdown.filter((b) => Math.abs(b.contribUsd) > 1).map((b) => (
                  <div key={b.cat} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "baseline",
                    padding: "6px 0",
                    fontFamily: FONT.mono, fontSize: 12,
                  }}>
                    <span style={{ color: T.text, fontWeight: 700, minWidth: 64 }}>{b.cat}</span>
                    <span style={{ color: T.textMute, fontSize: 10 }}>
                      {(b.weight * 100).toFixed(0)}% × {(b.ddPct * 100).toFixed(0)}%
                    </span>
                    <span style={{
                      color: b.contribUsd < 0 ? T.danger : T.text, fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                    }}>
                      {b.contribUsd >= 0 ? "+" : ""}US${fmtMoney(b.contribUsd, "USD")}
                    </span>
                  </div>
                ))}
              </div>

              {/* Educational note about this specific scenario. */}
              <div style={{
                padding: "12px 14px", borderRadius: 12, marginBottom: 10,
                background: T.bg, border: `1px dashed ${T.border}`,
                fontFamily: FONT.sans, fontSize: 12, color: T.textMute, lineHeight: 1.5,
              }}>{tr(scenario.note, lang)}</div>

              <DisclaimerStrip T={T} variant="card" textKey="stress.disclaimer" lang={lang} />
            </>
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
          }}>{tr("stress.close", lang)}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
