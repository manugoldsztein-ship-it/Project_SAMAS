// ============================================================
// Objetivos — v2 wizard + Wallet card (samas-0.4.12)
// ============================================================
// Replaces the legacy ObjectivesWizard from src/ai/. Two surfaces:
//
//   - ObjetivosCard: lives on Wallet. If the user has an active
//     objective, shows progress (allocation strip + monthly aporte
//     hint + narrative); if not, shows a CTA to launch the wizard.
//
//   - ObjetivosWizard: bottom sheet, multi-step. User describes
//     their goal, picks horizon + optional target amount, IA
//     classifies + returns plan, user saves.
//
// Persistence: public.objectives table (RLS-scoped per user).
// One active objective per user; new insert auto-archives prior
// active row via trigger (see supabase/objectives.sql).
// ============================================================

import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom";
import { FONT, fmtMoney } from "./theme.js";
import { t as tr } from "../lib/i18n.js";
import { objectivesPlan, saveObjective, getActiveObjective, deleteObjective } from "../lib/ai.js";
import { isAIDisabled } from "../lib/aiConsent.js";
import { hapticNative } from "../lib/native.js";
import { DisclaimerStrip, Skeleton } from "./shared.jsx";
import { useDragToDismiss } from "./useDragToDismiss.js";

// ----- Wallet card -----
export function ObjetivosCard({ T, lang = "es" }) {
  const [obj, setObj] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [aiDisabled, setAiDisabled] = useState(() => isAIDisabled());

  useEffect(() => {
    function onChange(e) { setAiDisabled(!!e?.detail?.disabled); }
    window.addEventListener("samas:ai-disabled-changed", onChange);
    return () => window.removeEventListener("samas:ai-disabled-changed", onChange);
  }, []);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const o = await getActiveObjective();
      setObj(o);
    } catch (_e) { setObj(null); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (aiDisabled) return null;

  return (
    <>
      <div style={{ margin: "20px 16px 0" }}>
        <SectionTitle T={T}>{tr("objetivos.section.title", lang)}</SectionTitle>
        {loading ? (
          // 0.4.47 — placeholder pelado reemplazado por skeleton shaped
          // como ObjetivoCardActive (icon + título + sub).
          <div style={{
            marginTop: 12, padding: 16, borderRadius: 22,
            background: T.surface, border: `1px solid ${T.border}`,
            display: "flex", alignItems: "center", gap: 14,
          }}>
            <Skeleton T={T} width={44} height={44} borderRadius={12} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Skeleton T={T} width="60%" height={14} marginBottom={8} />
              <Skeleton T={T} width="85%" height={12} />
            </div>
          </div>
        ) : obj ? (
          <ObjetivoCardActive
            T={T} lang={lang} obj={obj}
            onEdit={() => setOpen(true)}
            onDelete={async () => {
              if (!confirm(tr("objetivos.delete_confirm", lang))) return;
              await deleteObjective(obj.id);
              await refresh();
            }}
          />
        ) : (
          <ObjetivoCardEmpty T={T} lang={lang} onStart={() => setOpen(true)} />
        )}
      </div>

      {open && (
        <ObjetivosWizard
          T={T} lang={lang}
          existing={obj}
          onClose={() => setOpen(false)}
          onSaved={async () => { setOpen(false); await refresh(); }}
        />
      )}
    </>
  );
}

function SectionTitle({ T, children }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      fontFamily: FONT.mono, fontSize: 11, fontWeight: 700,
      color: T.textMute, letterSpacing: 0.6, textTransform: "uppercase",
    }}>
      <span>{children}</span>
    </div>
  );
}

function ObjetivoCardEmpty({ T, lang, onStart }) {
  return (
    <button
      onClick={onStart}
      style={{
        marginTop: 12, padding: 16, borderRadius: 22,
        width: "100%", textAlign: "left", cursor: "pointer",
        background: T.surface,
        border: `1px solid ${T.accent}55`,
        display: "flex", alignItems: "center", gap: 14,
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
          <circle cx="12" cy="12" r="6"/>
          <circle cx="12" cy="12" r="2"/>
        </svg>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: FONT.sans, fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 2,
        }}>{tr("objetivos.empty.title", lang)}</div>
        <div style={{
          fontFamily: FONT.sans, fontSize: 12, color: T.textMute, lineHeight: 1.4,
        }}>{tr("objetivos.empty.sub", lang)}</div>
      </div>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.textMute}
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </button>
  );
}

function ObjetivoCardActive({ T, lang, obj, onEdit, onDelete }) {
  const plan = obj.plan || {};
  const strategy = obj.strategy || plan.strategy;
  const horizonY = (obj.horizon_months / 12).toFixed(obj.horizon_months % 12 === 0 ? 0 : 1);
  const palette = (s) => ({
    conservadora: T.textMute,
    moderada:     T.accent,
    agresiva:     "#F59E0B",
  })[s] || T.textMute;
  const stratColor = palette(strategy);

  return (
    <div style={{
      marginTop: 12, padding: 14, borderRadius: 22,
      background: T.surface, border: `1px solid ${T.border}`,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 10 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 12, flexShrink: 0,
          background: T.accentSoft, color: T.accent,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <circle cx="12" cy="12" r="6"/>
            <circle cx="12" cy="12" r="2"/>
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: FONT.sans, fontSize: 14, fontWeight: 700, color: T.text,
            marginBottom: 2,
          }}>{obj.goal_text}</div>
          <div style={{
            fontFamily: FONT.mono, fontSize: 11, color: T.textMute,
          }}>
            {horizonY} {tr("objetivos.years", lang)}
            {obj.target_amount && ` · ${obj.target_currency === "USD" ? "US$" : "$"}${fmtMoney(obj.target_amount, obj.target_currency)}`}
          </div>
        </div>
        {strategy && (
          <span style={{
            padding: "3px 9px", borderRadius: 999, flexShrink: 0,
            background: stratColor + "22", color: stratColor,
            fontFamily: FONT.mono, fontSize: 10, fontWeight: 800,
            letterSpacing: 0.5, textTransform: "uppercase",
          }}>{strategy}</span>
        )}
      </div>

      {/* Allocation strip */}
      {Array.isArray(plan.allocation) && plan.allocation.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{
            display: "flex", height: 8, borderRadius: 999, overflow: "hidden",
            background: T.bg, border: `1px solid ${T.border}`,
          }}>
            {plan.allocation.map((a, i) => {
              const palette = ["#16C784", "#7DD3A0", "#F59E0B", "#60A5FA", "#A78BFA", T.textMute];
              if (a.pctOfBook <= 0) return null;
              return (
                <div key={a.category}
                  title={`${a.category} · ${a.pctOfBook}%`}
                  style={{
                    flex: `${a.pctOfBook} 0 0`,
                    background: palette[i % palette.length],
                  }}
                />
              );
            })}
          </div>
          <div style={{
            display: "flex", flexWrap: "wrap", gap: 6,
            marginTop: 6,
          }}>
            {plan.allocation.filter((a) => a.pctOfBook > 0).map((a) => (
              <span key={a.category} style={{
                fontFamily: FONT.mono, fontSize: 9, fontWeight: 700,
                padding: "2px 6px", borderRadius: 999,
                background: T.bg, border: `1px solid ${T.border}`,
                color: T.textMute,
              }}>{a.category} {a.pctOfBook}%</span>
            ))}
          </div>
        </div>
      )}

      {/* Monthly aporte hint removed samas-0.4.88 — el feature de aporte
          recurrente salió, así que mostrar un sugerido sin lugar donde
          plug-in-earlo era ruido. */}

      {/* Narrative */}
      {plan.narrative && (
        <div style={{
          fontFamily: FONT.sans, fontSize: 12, color: T.textMute, lineHeight: 1.55,
          marginBottom: 10,
        }}>{plan.narrative}</div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onEdit} style={{
          flex: 1, padding: "9px 12px", borderRadius: 10,
          background: T.bg, border: `1px solid ${T.border}`,
          color: T.text, fontFamily: FONT.sans, fontSize: 12, fontWeight: 700,
          cursor: "pointer",
        }}>{tr("objetivos.edit", lang)}</button>
        <button onClick={onDelete} style={{
          padding: "9px 12px", borderRadius: 10,
          background: "transparent", border: `1px solid ${T.border}`,
          color: T.textMute, fontFamily: FONT.sans, fontSize: 12, fontWeight: 600,
          cursor: "pointer",
        }}>{tr("objetivos.delete", lang)}</button>
      </div>

      {/* Disclaimer — financial advisor (Manuel's father) flagged
          that any AI-generated return projection needs an explicit
          "no es asesoramiento" line. samas-0.4.15. */}
      <DisclaimerStrip T={T} variant="card" textKey="common.ai_disclaimer_returns" lang={lang} />
    </div>
  );
}

// ----- Wizard sheet -----
const HORIZON_PRESETS = [
  { months: 12,  label: "1 año"  },
  { months: 36,  label: "3 años" },
  { months: 60,  label: "5 años" },
  { months: 120, label: "10 años" },
  { months: 240, label: "20 años" },
];

const GOAL_PRESETS = [
  "Ahorrar para un departamento",
  "Jubilación tranquila",
  "Viaje grande",
  "Auto",
  "Educación",
  "Reserva de emergencia",
];

function ObjetivosWizard({ T, lang, existing, onClose, onSaved }) {
  const [step, setStep] = useState(1);
  const [goal, setGoal] = useState(existing?.goal_text || "");
  const [horizonMonths, setHorizonMonths] = useState(existing?.horizon_months || 60);
  const [targetAmount, setTargetAmount] = useState(existing?.target_amount?.toString() || "");
  const [targetCurrency, setTargetCurrency] = useState(existing?.target_currency || "USD");
  const [plan, setPlan] = useState(existing?.plan || null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const dtd = useDragToDismiss(onClose);

  async function generatePlan() {
    if (!goal.trim() || !horizonMonths) {
      setErr(tr("objetivos.err.fill_required", lang));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const amt = Number(targetAmount) || null;
      const res = await objectivesPlan({
        goal: goal.trim(),
        horizonMonths,
        targetAmount: amt,
        targetCurrency: amt ? targetCurrency : null,
      });
      setPlan(res);
      setStep(3);
      hapticNative("success").catch(() => {});
    } catch (e) {
      if (e?.name === "AIConsentDeniedError" || e?.name === "AIQuotaExceededError") {
        onClose();
        return;
      }
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const amt = Number(targetAmount) || null;
      await saveObjective({
        goal: goal.trim(),
        horizonMonths,
        targetAmount: amt,
        targetCurrency: amt ? targetCurrency : null,
        plan,
      });
      hapticNative("success").catch(() => {});
      onSaved && onSaved();
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

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

        {/* Header */}
        <div style={{
          padding: "12px 22px 10px",
          background: "transparent",
        }}>
          <div style={{
            fontFamily: FONT.mono, fontSize: 10, fontWeight: 700,
            color: T.accent, letterSpacing: 0.6, textTransform: "uppercase",
            marginBottom: 4,
          }}>{tr("objetivos.wizard.kicker", lang)}</div>
          <div style={{
            fontFamily: FONT.display, fontSize: 22, fontWeight: 800,
            color: T.text, letterSpacing: -0.3,
          }}>
            {step === 1 && tr("objetivos.wizard.step1_title", lang)}
            {step === 2 && tr("objetivos.wizard.step2_title", lang)}
            {step === 3 && tr("objetivos.wizard.step3_title", lang)}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 22px 20px" }}>
          {step === 1 && (
            <>
              <div style={{
                fontFamily: FONT.sans, fontSize: 13, color: T.textMute,
                lineHeight: 1.5, marginBottom: 14,
              }}>{tr("objetivos.wizard.step1_help", lang)}</div>
              <input
                value={goal}
                onChange={(e) => setGoal(e.target.value.slice(0, 200))}
                placeholder={tr("objetivos.wizard.goal_ph", lang)}
                style={{
                  width: "100%", boxSizing: "border-box",
                  padding: "12px 14px", borderRadius: 12, marginBottom: 12,
                  background: T.surface, border: `1px solid ${T.border}`,
                  color: T.text, fontFamily: FONT.sans, fontSize: 14, outline: "none",
                }}
              />
              <div style={{
                fontFamily: FONT.mono, fontSize: 9, fontWeight: 700,
                color: T.textMute, letterSpacing: 0.6, textTransform: "uppercase",
                marginBottom: 6,
              }}>{tr("objetivos.wizard.suggestions", lang)}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {GOAL_PRESETS.map((p) => (
                  <button key={p} onClick={() => setGoal(p)}
                    style={{
                      padding: "6px 12px", borderRadius: 999,
                      background: goal === p ? T.accentSoft : T.bg,
                      border: `1px solid ${goal === p ? T.accent + "55" : T.border}`,
                      color: goal === p ? T.accent : T.text,
                      fontFamily: FONT.sans, fontSize: 12, cursor: "pointer",
                    }}>{p}</button>
                ))}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div style={{
                fontFamily: FONT.sans, fontSize: 13, color: T.textMute,
                lineHeight: 1.5, marginBottom: 14,
              }}>{tr("objetivos.wizard.step2_help", lang)}</div>

              <div style={{
                fontFamily: FONT.mono, fontSize: 9, fontWeight: 700,
                color: T.textMute, letterSpacing: 0.6, textTransform: "uppercase",
                marginBottom: 6,
              }}>{tr("objetivos.wizard.horizon_label", lang)}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
                {HORIZON_PRESETS.map((p) => (
                  <button key={p.months} onClick={() => setHorizonMonths(p.months)}
                    style={{
                      padding: "8px 14px", borderRadius: 12,
                      background: horizonMonths === p.months ? T.accent : T.surface,
                      border: `1px solid ${horizonMonths === p.months ? T.accent : T.border}`,
                      color: horizonMonths === p.months ? T.accentInk : T.text,
                      fontFamily: FONT.sans, fontSize: 13, fontWeight: 700,
                      cursor: "pointer",
                    }}>{p.label}</button>
                ))}
              </div>

              <div style={{
                fontFamily: FONT.mono, fontSize: 9, fontWeight: 700,
                color: T.textMute, letterSpacing: 0.6, textTransform: "uppercase",
                marginBottom: 6,
              }}>{tr("objetivos.wizard.target_label", lang)}</div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="number"
                  inputMode="decimal"
                  value={targetAmount}
                  onChange={(e) => setTargetAmount(e.target.value)}
                  placeholder={tr("objetivos.wizard.target_ph", lang)}
                  style={{
                    flex: 1, padding: "11px 14px", borderRadius: 12,
                    background: T.surface, border: `1px solid ${T.border}`,
                    color: T.text, fontFamily: FONT.mono, fontSize: 14, outline: "none",
                  }}
                />
                <div style={{ display: "flex", gap: 4 }}>
                  {["ARS", "USD"].map((c) => (
                    <button key={c} onClick={() => setTargetCurrency(c)}
                      style={{
                        padding: "11px 14px", borderRadius: 12,
                        background: targetCurrency === c ? T.accent : T.surface,
                        border: `1px solid ${targetCurrency === c ? T.accent : T.border}`,
                        color: targetCurrency === c ? T.accentInk : T.text,
                        fontFamily: FONT.mono, fontSize: 13, fontWeight: 800, letterSpacing: 0.4,
                        cursor: "pointer",
                      }}>{c}</button>
                  ))}
                </div>
              </div>
            </>
          )}

          {step === 3 && plan && (
            <ObjetivoPlanPreview T={T} lang={lang} plan={plan} horizonMonths={horizonMonths} />
          )}

          {err && (
            <div style={{
              marginTop: 10, padding: "8px 12px", borderRadius: 10,
              background: T.dangerSoft, color: T.danger,
              fontFamily: FONT.sans, fontSize: 12,
            }}>{err}</div>
          )}
        </div>

        {/* Sticky footer */}
        <div style={{
          padding: "12px 18px calc(env(safe-area-inset-bottom) + 16px)",
          borderTop: `1px solid ${T.border}`,
          background: T.bgElev || T.bg,
          display: "flex", gap: 10,
        }}>
          {step === 1 && (
            <>
              <button onClick={onClose} style={{
                flex: 1, padding: "13px 16px", borderRadius: 14,
                background: "transparent", border: `1px solid ${T.border}`,
                color: T.text, fontFamily: FONT.sans, fontSize: 14, fontWeight: 600,
                cursor: "pointer",
              }}>{tr("objetivos.wizard.cancel", lang)}</button>
              <button
                onClick={() => { setErr(null); setStep(2); }}
                disabled={!goal.trim()}
                style={{
                  flex: 2, padding: "13px 16px", borderRadius: 14,
                  background: T.accent, border: "none",
                  color: T.accentInk, fontFamily: FONT.sans, fontSize: 14, fontWeight: 800,
                  cursor: goal.trim() ? "pointer" : "default", opacity: goal.trim() ? 1 : 0.5,
                }}>{tr("objetivos.wizard.next", lang)}</button>
            </>
          )}
          {step === 2 && (
            <>
              <button onClick={() => setStep(1)} style={{
                flex: 1, padding: "13px 16px", borderRadius: 14,
                background: "transparent", border: `1px solid ${T.border}`,
                color: T.text, fontFamily: FONT.sans, fontSize: 14, fontWeight: 600,
                cursor: "pointer",
              }}>{tr("objetivos.wizard.back", lang)}</button>
              <button
                onClick={generatePlan}
                disabled={busy}
                style={{
                  flex: 2, padding: "13px 16px", borderRadius: 14,
                  background: T.accent, border: "none",
                  color: T.accentInk, fontFamily: FONT.sans, fontSize: 14, fontWeight: 800,
                  cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
                }}>{busy ? tr("objetivos.wizard.busy", lang) : tr("objetivos.wizard.generate", lang)}</button>
            </>
          )}
          {step === 3 && (
            <>
              <button onClick={() => setStep(2)} style={{
                flex: 1, padding: "13px 16px", borderRadius: 14,
                background: "transparent", border: `1px solid ${T.border}`,
                color: T.text, fontFamily: FONT.sans, fontSize: 14, fontWeight: 600,
                cursor: "pointer",
              }}>{tr("objetivos.wizard.back", lang)}</button>
              <button
                onClick={save}
                disabled={busy}
                style={{
                  flex: 2, padding: "13px 16px", borderRadius: 14,
                  background: T.accent, border: "none",
                  color: T.accentInk, fontFamily: FONT.sans, fontSize: 14, fontWeight: 800,
                  cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
                }}>{busy ? tr("objetivos.wizard.busy", lang) : tr("objetivos.wizard.save", lang)}</button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ObjetivoPlanPreview({ T, lang, plan, horizonMonths }) {
  const palette = (s) => ({
    conservadora: T.textMute,
    moderada:     T.accent,
    agresiva:     "#F59E0B",
  })[s] || T.textMute;
  const stratColor = palette(plan.strategy);
  return (
    <div>
      {/* Strategy header */}
      <div style={{
        padding: "12px 14px", borderRadius: 14, marginBottom: 14,
        background: stratColor + "11", border: `1px solid ${stratColor}55`,
      }}>
        <div style={{
          fontFamily: FONT.mono, fontSize: 9, fontWeight: 700,
          color: stratColor, letterSpacing: 0.6, textTransform: "uppercase",
          marginBottom: 4,
        }}>{tr("objetivos.preview.strategy_label", lang)}</div>
        <div style={{
          fontFamily: FONT.display, fontSize: 22, fontWeight: 800,
          color: T.text, letterSpacing: -0.3, textTransform: "capitalize",
        }}>{plan.strategy}</div>
      </div>

      {/* Allocation */}
      {Array.isArray(plan.allocation) && plan.allocation.length > 0 && (
        <div style={{
          padding: 14, borderRadius: 14, marginBottom: 14,
          background: T.surface, border: `1px solid ${T.border}`,
        }}>
          <div style={{
            fontFamily: FONT.mono, fontSize: 9, fontWeight: 700,
            color: T.textMute, letterSpacing: 0.6, textTransform: "uppercase",
            marginBottom: 10,
          }}>{tr("objetivos.preview.allocation_label", lang)}</div>
          {plan.allocation.filter((a) => a.pctOfBook > 0).map((a) => (
            <div key={a.category} style={{
              display: "flex", alignItems: "center", gap: 12,
              marginBottom: 8,
            }}>
              <span style={{
                minWidth: 64,
                fontFamily: FONT.mono, fontSize: 11, fontWeight: 700, color: T.text,
                letterSpacing: 0.4,
              }}>{a.category}</span>
              <div style={{
                flex: 1, height: 6, borderRadius: 3, background: T.bg,
                overflow: "hidden",
              }}>
                <div style={{
                  width: `${a.pctOfBook}%`, height: "100%",
                  background: T.accent, borderRadius: 3,
                }}/>
              </div>
              <span style={{
                minWidth: 36, textAlign: "right",
                fontFamily: FONT.mono, fontSize: 12, fontWeight: 700, color: T.text,
              }}>{a.pctOfBook}%</span>
            </div>
          ))}
        </div>
      )}

      {/* Monthly aporte preview removed samas-0.4.88 — same as above. */}

      {/* Milestones — range version (samas-0.4.15). The Edge Function
          returns expectedLow / expectedValue (base) / expectedHigh
          using a calibrated return band. We render the BASE on the
          right and a small "rango: low – high" line beneath so the
          user understands the projection isn't a guarantee. Falls
          back to the legacy single-number display for any cached/
          older payload missing the new fields. */}
      {Array.isArray(plan.milestones) && plan.milestones.length > 0 && (
        <div style={{
          padding: 14, borderRadius: 14, marginBottom: 14,
          background: T.surface, border: `1px solid ${T.border}`,
        }}>
          <div style={{
            fontFamily: FONT.mono, fontSize: 9, fontWeight: 700,
            color: T.textMute, letterSpacing: 0.6, textTransform: "uppercase",
            marginBottom: 10,
          }}>{tr("objetivos.preview.milestones_label", lang)}</div>
          {plan.milestones.map((m, i) => {
            const ccy = plan.monthlyAporte?.currency || "USD";
            const ccyPrefix = ccy === "USD" ? "US$" : "$";
            const hasRange = typeof m.expectedLow === "number"
              && typeof m.expectedHigh === "number";
            return (
              <div key={i} style={{
                padding: "8px 0",
                borderTop: i === 0 ? "none" : `1px solid ${T.border}`,
                fontFamily: FONT.mono, fontSize: 12,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: T.textMute }}>{m.label} ({(m.atMonths/12).toFixed(1)}a)</span>
                  <span style={{ color: T.text, fontWeight: 700 }}>
                    {ccyPrefix}{fmtMoney(m.expectedValue, ccy)}
                  </span>
                </div>
                {hasRange && (
                  <div style={{
                    marginTop: 2, fontFamily: FONT.mono, fontSize: 10,
                    color: T.textMute, textAlign: "right",
                  }}>
                    {ccyPrefix}{fmtMoney(m.expectedLow, ccy)} – {ccyPrefix}{fmtMoney(m.expectedHigh, ccy)}
                  </div>
                )}
              </div>
            );
          })}
          <div style={{
            marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.border}`,
            fontFamily: FONT.sans, fontSize: 10, color: T.textMute,
            lineHeight: 1.45,
          }}>
            {tr("objetivos.preview.range_hint", lang)}
            {plan.annualReturn && (
              <div style={{ marginTop: 4 }}>
                {tr("objetivos.preview.return_assumption", lang, {
                  pct: `${(plan.annualReturn.low * 100).toFixed(0)}–${(plan.annualReturn.high * 100).toFixed(0)}`,
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Narrative */}
      {plan.narrative && (
        <div style={{
          padding: "12px 14px", borderRadius: 14,
          background: T.surface, border: `1px solid ${T.border}`,
          fontFamily: FONT.sans, fontSize: 13, color: T.text, lineHeight: 1.55,
        }}>{plan.narrative}</div>
      )}

      {/* Disclaimer (samas-0.4.15) */}
      <DisclaimerStrip T={T} variant="card" textKey="common.ai_disclaimer" lang={lang} />
    </div>
  );
}
