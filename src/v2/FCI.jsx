// ============================================================
// FCI — Fondos Comunes de Inversión module (samas-0.4.34)
// ============================================================
// Cocos-clone style fund layer for Lite users. Per Rolan's
// recommendation: "ofrece fondos comunes en primera plana". The
// most beginner-friendly product in AR retail — one tap, your
// money goes into a managed pool (money market / fixed income /
// mixed / equity).
//
// SURFACES
//   1. FCICard (this file) — Wallet front-page card. Shows the
//      user's FCI holdings if any, otherwise an empty-state
//      "probá un FCI" CTA. Tap → FCIPickerSheet.
//   2. FCIPickerSheet (this file) — bottom sheet listing the 5
//      curated SAMAS funds with TNA, riesgo level, "buy" CTA per
//      row. Tap a row → existing AssetSheet (which knows how to
//      render any ticker via its category).
//
// THE 5 FUNDS (all live in src/v2/api/broker.js ASSETS, category="FCI"):
//   - MMARS   — Money Market ARS, TNA 68%, riesgo 1
//   - MMUSD   — Money Market USD, TNA 4%, riesgo 1
//   - RFAR    — Renta Fija (bonos AR), TNA 8% USD, riesgo 2
//   - MIXTO   — Mixta (40% bonos / 30% AR / 30% CEDEAR), TNA 11%, riesgo 3
//   - EQUITY  — Renta Variable (CEDEARs + AR equity), TNA 14%, riesgo 4
//
// Mock data lives in broker.js. Production wiring: Cohen would
// expose their actual FCI lineup via an API; we'd swap the
// hardcoded list with a live fetch. UI shape doesn't change.
// ============================================================

import React, { useState, useMemo, useEffect } from "react";
import ReactDOM from "react-dom";
import { FONT, fmtMoney } from "./theme.js";
import { t as tr } from "../lib/i18n.js";
import { hapticNative } from "../lib/native.js";
import { Skeleton } from "./shared.jsx";
import { broker as brokerApi } from "./api/index.js";

// ----- helpers -----

function riskColor(T, level) {
  if (level <= 1) return T.accent;       // very safe
  if (level <= 2) return "#10B981";      // safe
  if (level <= 3) return "#F59E0B";      // medium
  if (level <= 4) return "#EF4444";      // high
  return T.danger;                       // very high
}

function riskLabel(level, lang) {
  const k = level <= 1 ? "fci.risk.very_low"
    : level <= 2 ? "fci.risk.low"
    : level <= 3 ? "fci.risk.medium"
    : level <= 4 ? "fci.risk.high"
    : "fci.risk.very_high";
  return tr(k, lang);
}

function fundTypeLabel(fundType, lang) {
  return tr(`fci.type.${fundType || "money_market"}`, lang);
}

// ----- FCICard (Wallet front-page entry) -----

export function FCICard({ T, lang = "es", onSelectAsset }) {
  const [assets, setAssets] = useState(null);
  const [holdings, setHoldings] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [aa, port] = await Promise.all([
          brokerApi.getAssets ? brokerApi.getAssets() : Promise.resolve([]),
          brokerApi.getPortfolio ? brokerApi.getPortfolio() : Promise.resolve({ holdings: [] }),
        ]);
        if (cancelled) return;
        setAssets((aa || []).filter((a) => a.category === "FCI"));
        // Filter holdings to only the FCI ones, enriched with asset
        // metadata for rendering (name, tnaPct, riskLevel, etc).
        const fciTickers = new Set((aa || []).filter((a) => a.category === "FCI").map((a) => a.ticker));
        setHoldings((port?.holdings || []).filter((h) => fciTickers.has(h.ticker)));
      } catch (_e) {
        if (!cancelled) { setAssets([]); setHoldings([]); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const totalValueUsd = useMemo(() => {
    if (!holdings || !assets) return 0;
    return holdings.reduce((sum, h) => {
      const meta = assets.find((a) => a.ticker === h.ticker) || {};
      const valueLocal = (h.qty || 0) * (meta.price || 0);
      const valueUsd = meta.currency === "ARS" ? valueLocal / 1245 : valueLocal;
      return sum + valueUsd;
    }, 0);
  }, [holdings, assets]);

  const showSkeleton = holdings === null;
  const isEmpty = !showSkeleton && holdings.length === 0;

  return (
    <>
      <div style={{ margin: "20px 16px 0" }}>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "baseline",
          padding: "0 4px", marginBottom: 8,
        }}>
          <div style={{
            fontFamily: FONT.mono, fontSize: 11, fontWeight: 700,
            color: T.textMute, letterSpacing: 0.6, textTransform: "uppercase",
          }}>{tr("fci.section.title", lang)}</div>
          <button
            onClick={() => { setOpen(true); hapticNative("tap").catch(() => {}); }}
            style={{
              background: "none", border: "none", cursor: "pointer",
              fontFamily: FONT.sans, fontSize: 12, fontWeight: 600, color: T.accent,
            }}>{tr("fci.section.action", lang)}</button>
        </div>

        {showSkeleton && <Skeleton T={T} height={80} borderRadius={22} />}

        {isEmpty && (
          <button
            onClick={() => { setOpen(true); hapticNative("tap").catch(() => {}); }}
            style={{
              width: "100%", padding: 16, borderRadius: 22,
              background: T.surface,
              border: `1px solid ${T.accent}55`,
              display: "flex", alignItems: "center", gap: 14,
              cursor: "pointer", textAlign: "left",
              fontFamily: "inherit",
            }}
          >
            <div style={{
              width: 44, height: 44, borderRadius: 12, flexShrink: 0,
              background: T.accent, color: T.accentInk,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <path d="M2 12h20"/>
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontFamily: FONT.sans, fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 2,
              }}>{tr("fci.empty.title", lang)}</div>
              <div style={{
                fontFamily: FONT.sans, fontSize: 12, color: T.textMute, lineHeight: 1.4,
              }}>{tr("fci.empty.sub", lang)}</div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.textMute}
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        )}

        {!showSkeleton && holdings.length > 0 && (
          <div style={{
            padding: 14, borderRadius: 22,
            background: T.surface, border: `1px solid ${T.border}`,
          }}>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "baseline",
              marginBottom: 12, paddingBottom: 10,
              borderBottom: `1px solid ${T.border}`,
            }}>
              <span style={{
                fontFamily: FONT.sans, fontSize: 11, color: T.textMute, fontWeight: 600,
              }}>{tr("fci.total_label", lang)}</span>
              <span style={{
                fontFamily: FONT.display, fontSize: 18, fontWeight: 800, color: T.text,
                fontVariantNumeric: "tabular-nums",
              }}>US${fmtMoney(totalValueUsd, "USD")}</span>
            </div>
            {holdings.map((h, i) => {
              const meta = assets.find((a) => a.ticker === h.ticker) || {};
              const valueLocal = (h.qty || 0) * (meta.price || 0);
              const ccyPrefix = meta.currency === "ARS" ? "$" : "US$";
              return (
                <button
                  key={h.ticker}
                  onClick={() => { onSelectAsset && onSelectAsset({ ...meta, ...h }); }}
                  style={{
                    width: "100%", padding: "10px 0",
                    borderTop: i === 0 ? "none" : `1px solid ${T.border}`,
                    background: "transparent", border: "none", cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 10,
                    textAlign: "left", fontFamily: "inherit",
                  }}
                >
                  <div style={{
                    width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                    background: riskColor(T, meta.riskLevel || 1) + "22",
                    color: riskColor(T, meta.riskLevel || 1),
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: FONT.mono, fontSize: 10, fontWeight: 800,
                  }}>{(meta.fundType || "MM").charAt(0).toUpperCase()}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontFamily: FONT.sans, fontSize: 13, fontWeight: 700, color: T.text,
                    }}>{meta.name}</div>
                    <div style={{
                      fontFamily: FONT.mono, fontSize: 10, color: T.textMute, marginTop: 2,
                    }}>{tr("fci.tna_label", lang)} {meta.tnaPct ?? "—"}%</div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{
                      fontFamily: FONT.mono, fontSize: 13, fontWeight: 700, color: T.text,
                      fontVariantNumeric: "tabular-nums",
                    }}>{ccyPrefix}{fmtMoney(valueLocal, meta.currency)}</div>
                    <div style={{
                      fontFamily: FONT.mono, fontSize: 10, color: meta.changePct >= 0 ? T.accent : T.danger,
                      fontVariantNumeric: "tabular-nums", marginTop: 2,
                    }}>{meta.changePct >= 0 ? "+" : ""}{(meta.changePct || 0).toFixed(2)}%</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      {open && (
        <FCIPickerSheet
          T={T} lang={lang}
          assets={assets || []}
          onClose={() => setOpen(false)}
          onSelectAsset={(asset) => {
            setOpen(false);
            // small async gap so the sheet's exit animation has a
            // chance to start before the AssetSheet mounts on top.
            setTimeout(() => onSelectAsset && onSelectAsset(asset), 50);
          }}
        />
      )}
    </>
  );
}

// ----- FCIPickerSheet (bottom sheet with the 5 funds) -----

function FCIPickerSheet({ T, lang, assets, onClose, onSelectAsset }) {
  if (typeof document === "undefined") return null;

  // Sort by risk level so beginner-safe options appear first.
  const sorted = [...(assets || [])].sort((a, b) => (a.riskLevel || 0) - (b.riskLevel || 0));

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
        <div style={{
          padding: "12px 22px 10px",
          background: "transparent",
        }}>
          <div style={{
            fontFamily: FONT.mono, fontSize: 10, fontWeight: 700,
            color: T.accent, letterSpacing: 0.6, textTransform: "uppercase",
            marginBottom: 4,
          }}>{tr("fci.picker.kicker", lang)}</div>
          <div style={{
            fontFamily: FONT.display, fontSize: 22, fontWeight: 800,
            color: T.text, letterSpacing: -0.3,
          }}>{tr("fci.picker.title", lang)}</div>
          <div style={{
            fontFamily: FONT.sans, fontSize: 12, color: T.textMute, marginTop: 4, lineHeight: 1.45,
          }}>{tr("fci.picker.sub", lang)}</div>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 18px 16px" }}>
          {sorted.map((a) => (
            <button
              key={a.ticker}
              onClick={() => { hapticNative("tap").catch(() => {}); onSelectAsset(a); }}
              style={{
                width: "100%", padding: 14, marginBottom: 10, borderRadius: 16,
                background: T.surface, border: `1px solid ${T.border}`,
                display: "flex", alignItems: "center", gap: 12,
                cursor: "pointer", textAlign: "left",
                fontFamily: "inherit",
              }}
            >
              <div style={{
                width: 44, height: 44, borderRadius: 12, flexShrink: 0,
                background: riskColor(T, a.riskLevel) + "22",
                color: riskColor(T, a.riskLevel),
                display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                fontFamily: FONT.mono, fontWeight: 800,
              }}>
                <span style={{ fontSize: 9, opacity: 0.85 }}>RIESGO</span>
                <span style={{ fontSize: 14 }}>{a.riskLevel}</span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontFamily: FONT.sans, fontSize: 14, fontWeight: 700, color: T.text,
                }}>{a.name}</div>
                <div style={{
                  marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap",
                }}>
                  <span style={{
                    fontFamily: FONT.mono, fontSize: 9, fontWeight: 700,
                    padding: "2px 6px", borderRadius: 4,
                    background: T.bg, color: T.textMute,
                    letterSpacing: 0.3, textTransform: "uppercase",
                  }}>{fundTypeLabel(a.fundType, lang)}</span>
                  <span style={{
                    fontFamily: FONT.mono, fontSize: 9, fontWeight: 700,
                    padding: "2px 6px", borderRadius: 4,
                    background: T.bg, color: T.textMute,
                    letterSpacing: 0.3,
                  }}>{a.currency}</span>
                  <span style={{
                    fontFamily: FONT.mono, fontSize: 9, fontWeight: 700,
                    padding: "2px 6px", borderRadius: 4,
                    background: riskColor(T, a.riskLevel) + "22",
                    color: riskColor(T, a.riskLevel),
                    letterSpacing: 0.3,
                  }}>{riskLabel(a.riskLevel, lang)}</span>
                </div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{
                  fontFamily: FONT.mono, fontSize: 9, fontWeight: 700,
                  color: T.textMute, letterSpacing: 0.5, textTransform: "uppercase",
                  marginBottom: 2,
                }}>{tr("fci.tna_label", lang)}</div>
                <div style={{
                  fontFamily: FONT.display, fontSize: 18, fontWeight: 800,
                  color: T.accent, fontVariantNumeric: "tabular-nums",
                }}>{a.tnaPct}%</div>
              </div>
            </button>
          ))}
          <div style={{
            marginTop: 12, padding: "10px 14px", borderRadius: 12,
            background: T.bg, border: `1px dashed ${T.border}`,
            fontFamily: FONT.sans, fontSize: 11, color: T.textMute, lineHeight: 1.5,
            textAlign: "center",
          }}>{tr("fci.picker.disclaimer", lang)}</div>
        </div>
        <div style={{
          padding: "12px 18px calc(env(safe-area-inset-bottom) + 16px)",
          borderTop: `1px solid ${T.border}`,
          background: T.bgElev || T.bg,
        }}>
          <button onClick={onClose} style={{
            width: "100%", padding: "13px 16px", borderRadius: 14,
            background: "transparent", border: `1px solid ${T.border}`,
            color: T.text, fontFamily: FONT.sans, fontSize: 14, fontWeight: 700,
            cursor: "pointer",
          }}>{tr("fci.picker.close", lang)}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
