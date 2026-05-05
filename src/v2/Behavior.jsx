// ============================================================
// Behavior — overtrading / revenge / FOMO / panic detector
// ============================================================
// "Tu disciplina esta semana" card on Wallet. Shows AI-detected
// behavior alerts with empathetic, non-punitive copy. The pitch
// story: Robinhood profits when you overtrade; SAMAS profits
// when you stay disciplined.
//
// MOUNT
//   Mounted in Wallet, gated on !aiDisabled and on the user
//   actually having transactions. Fires behaviorWatch() on mount
//   (cached ~1h via localStorage so we don't burn quota every
//   tab-switch).
//
// FALLBACK
//   On AI quota / consent denied: card is silently hidden.
//   On all-clear (zero alerts): renders a small green "tu
//   disciplina está sólida esta semana" affordance instead
//   (positive reinforcement matters as much as the warnings).
// ============================================================

import React, { useEffect, useState } from "react";
import { FONT } from "./theme.js";
import { t as tr } from "../lib/i18n.js";
import { behaviorWatch } from "../lib/ai.js";
import { isAIDisabled } from "../lib/aiConsent.js";
import { hapticNative } from "../lib/native.js";
import { Skeleton } from "./shared.jsx";

const CACHE_KEY = "samas_behavior_watch_v1";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function readCache() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(CACHE_KEY) : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.at || Date.now() - parsed.at > CACHE_TTL_MS) return null;
    return parsed.payload;
  } catch { return null; }
}

function writeCache(payload) {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), payload }));
    }
  } catch { /* ignore */ }
}

const SEVERITY_COLORS = (T) => ({
  low:    { bg: T.surface,           bd: T.border,          fg: T.textMute },
  medium: { bg: T.warningSoft || "#3A2E12", bd: "#F59E0B66", fg: "#F59E0B" },
  high:   { bg: T.dangerSoft,        bd: T.danger + "55",   fg: T.danger },
});

const PATTERN_LABEL = {
  overtrading: { es: "Overtrading", en: "Overtrading" },
  revenge:     { es: "Revenge trading", en: "Revenge trading" },
  fomo:        { es: "FOMO", en: "FOMO" },
  panic:       { es: "Pánico", en: "Panic selling" },
  drift:       { es: "Inactividad", en: "Drift" },
};

export function BehaviorCard({ T, lang = "es" }) {
  const [data, setData] = useState(() => readCache());
  const [busy, setBusy] = useState(!data);
  const [hidden, setHidden] = useState(false);
  const [aiDisabled, setAiDisabled] = useState(() => isAIDisabled());

  useEffect(() => {
    const onChange = (e) => setAiDisabled(!!e?.detail?.disabled);
    window.addEventListener("samas:ai-disabled-changed", onChange);
    return () => window.removeEventListener("samas:ai-disabled-changed", onChange);
  }, []);

  useEffect(() => {
    if (aiDisabled || data) return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      try {
        const res = await behaviorWatch();
        if (!cancelled) {
          setData(res);
          writeCache(res);
        }
      } catch (e) {
        // Silently hide on quota/consent denial. The card isn't
        // critical and we don't want to surface AI failures here.
        if (!cancelled) setHidden(true);
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiDisabled]);

  if (aiDisabled || hidden) return null;
  const alerts = data?.alerts || [];

  // No alerts AND we have data → show a small positive
  // reinforcement card. Otherwise show the alerts. Otherwise hide
  // (e.g., during initial load before cache hydrates and call
  // returns).
  const SC = SEVERITY_COLORS(T);
  const showSkeleton = busy && !data;
  const showOk = !busy && alerts.length === 0;
  if (!showSkeleton && !showOk && alerts.length === 0) return null;

  return (
    <div style={{ margin: "20px 16px 0" }}>
      <div style={{
        fontFamily: FONT.mono, fontSize: 11, fontWeight: 700,
        color: T.textMute, letterSpacing: 0.6, textTransform: "uppercase",
      }}>
        {tr("behavior.section.title", lang)}
      </div>

      {showSkeleton && (
        <div style={{
          marginTop: 12, padding: 14, borderRadius: 18,
          background: T.surface, border: `1px solid ${T.border}`,
        }}>
          <Skeleton T={T} width="50%" height={14} marginBottom={8}/>
          <Skeleton T={T} height={12} marginBottom={6}/>
          <Skeleton T={T} width="80%" height={12} />
        </div>
      )}

      {showOk && (
        <div style={{
          marginTop: 12, padding: "14px 16px", borderRadius: 18,
          background: T.accentSoft, border: `1px solid ${T.accent}55`,
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            background: T.accent, color: T.accentInk,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 12 10 16 18 8"/>
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: FONT.sans, fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 2,
            }}>{tr("behavior.ok.title", lang)}</div>
            <div style={{
              fontFamily: FONT.sans, fontSize: 12, color: T.textMute, lineHeight: 1.4,
            }}>{tr("behavior.ok.sub", lang)}</div>
          </div>
        </div>
      )}

      {alerts.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {alerts.map((a, i) => {
            const c = SC[a.severity] || SC.low;
            const labelMap = PATTERN_LABEL[a.pattern] || { es: a.pattern, en: a.pattern };
            const label = labelMap[lang] || labelMap.es;
            return (
              <div key={i} style={{
                padding: "14px 16px", borderRadius: 18,
                background: c.bg, border: `1px solid ${c.bd}`,
              }}>
                <div style={{
                  display: "flex", alignItems: "center", gap: 8, marginBottom: 8,
                }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                    background: c.fg + "22", color: c.fg,
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      {a.severity === "high" ? (
                        <>
                          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                          <line x1="12" y1="9" x2="12" y2="13"/>
                          <line x1="12" y1="17" x2="12.01" y2="17"/>
                        </>
                      ) : (
                        <>
                          <circle cx="12" cy="12" r="10"/>
                          <line x1="12" y1="8" x2="12" y2="12"/>
                          <line x1="12" y1="16" x2="12.01" y2="16"/>
                        </>
                      )}
                    </svg>
                  </div>
                  <span style={{
                    fontFamily: FONT.mono, fontSize: 10, fontWeight: 800,
                    color: c.fg, letterSpacing: 0.5, textTransform: "uppercase",
                  }}>{label}</span>
                  <span style={{ flex: 1 }} />
                  <span style={{
                    fontFamily: FONT.mono, fontSize: 9, fontWeight: 600,
                    color: T.textMute, opacity: 0.8,
                  }}>{a.reason}</span>
                </div>
                <div style={{
                  fontFamily: FONT.sans, fontSize: 13, color: T.text, lineHeight: 1.5,
                  marginBottom: 8,
                }}>{a.message}</div>
                <div style={{
                  padding: "6px 10px", borderRadius: 8,
                  background: T.bg, border: `1px solid ${T.border}`,
                  fontFamily: FONT.sans, fontSize: 11, color: T.textMute,
                  display: "inline-block",
                }}>
                  ✓ {a.suggestion}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
