import { useEffect, useMemo, useRef, useState } from "react";
import { callObjectives, callExpenseParser, fvAnnuity, hasAnthropicKey } from "./client.js";
import { InfoBadge } from "./glossary.jsx";

// ============================================================
// OBJETIVOS WIZARD (AI) — spec v2
// ============================================================
// Flujo fijado por producto:
//   1. Ingresos mensuales
//   2. Gastos mensuales  (la app calcula el sobrante invertible en vivo)
//   3. Objetivo: monto + horizonte en anios
//   4. Resultado: proyeccion de interes compuesto + Claude elige la
//      estrategia (conservadora / moderada / agresiva) y la explica.
// La app hace la aritmetica de interes compuesto; Claude solo decide la
// estrategia y arma la asignacion contra las categorias SAMAS.

const CATEGORY_COLORS = {
  Acciones: "#16C784",
  CEDEAR:   "#2563EB",
  ETF:      "#7C3AED",
  Bonos:    "#C9A84C",
  ON:       "#E8C97A",
  FCI:      "#0EA5E9",
  Crypto:   "#F7931A",
  Cash:     "#6B7280",
};

const STRATEGY_COLORS = {
  conservadora: "#0EA5E9",
  moderada:     "#C9A84C",
  agresiva:     "#F7931A",
};

const HORIZON_PRESETS = [1, 3, 5, 10, 20];

function fmtNum(n) {
  return Math.round(Number(n) || 0).toLocaleString("es-AR");
}
function sym(currency) { return currency === "USD" ? "u$s" : "$"; }
// Back-compat alias used by PlanView below (ARS-biased wording).
const fmtARS = fmtNum;

export function ObjectivesWizard({ onClose, onSave, savedPlan, C }) {
  // When reopening with an existing plan, prefill the form with the values
  // that produced it so the user can tweak + regenerate without retyping.
  const prior = savedPlan?._profile || null;
  const [currency, setCurrency] = useState(prior?.currency ?? "ARS");
  const [step, setStep] = useState(savedPlan ? 4 : 1);
  // Sensible defaults per currency; only applied on fresh wizard (no prior).
  const dft = currency === "USD"
    ? { income: 1500, expenses: 1000, target: 50000, horizon: 10 }
    : { income: 500000, expenses: 350000, target: 10000000, horizon: 10 };
  const [monthlyIncome, setMonthlyIncome]     = useState(prior?.monthlyIncome   ?? dft.income);
  const [monthlyExpenses, setMonthlyExpenses] = useState(prior?.monthlyExpenses ?? dft.expenses);
  const [targetAmount, setTargetAmount]       = useState(prior?.targetAmount    ?? dft.target);
  const [horizonYears, setHorizonYears]       = useState(prior?.horizonYears    ?? dft.horizon);
  // Keep input defaults in sync when the user flips the currency toggle
  // before typing their own numbers. We only swap if the user is still on
  // the previous currency's defaults (i.e. hasn't customized).
  useEffect(() => {
    const wasArs = monthlyIncome === 500000 && monthlyExpenses === 350000 && targetAmount === 10000000;
    const wasUsd = monthlyIncome === 1500   && monthlyExpenses === 1000   && targetAmount === 50000;
    if (currency === "USD" && wasArs) {
      setMonthlyIncome(1500); setMonthlyExpenses(1000); setTargetAmount(50000);
    } else if (currency === "ARS" && wasUsd) {
      setMonthlyIncome(500000); setMonthlyExpenses(350000); setTargetAmount(10000000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency]);
  const [plan, setPlan] = useState(savedPlan || null);
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState(null);

  // Track mount state so we can safely ignore late async results if the
  // user closed the wizard mid-fetch.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Escape key closes the wizard.
  useEffect(() => {
    const fn = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose]);

  const invest = Math.max(0, (Number(monthlyIncome) || 0) - (Number(monthlyExpenses) || 0));
  const savingsRate = (Number(monthlyIncome) || 0) > 0 ? invest / monthlyIncome : 0;

  // Live compound-interest preview on step 3 so the user sees feasibility
  // before waiting on the AI round-trip.
  const preview = useMemo(() => {
    const rates = [0.06, 0.09, 0.12];
    return rates.map(r => ({
      rate: r,
      final: fvAnnuity(invest, horizonYears, r),
    }));
  }, [invest, horizonYears]);

  async function generate() {
    if (busy) return;                          // prevent double-submit
    if (horizonYears <= 0) { setErr("El horizonte debe ser mayor a 0"); return; }
    if (targetAmount <= 0) { setErr("El objetivo debe ser mayor a 0"); return; }
    setBusy(true);
    setErr(null);
    // Advance to step 4 immediately so the skeleton renders while we wait
    // for Claude — gives the user visual anticipation instead of a frozen
    // button. If the call fails we bounce back to step 3.
    setPlan(null);
    setStep(4);
    try {
      const p = await callObjectives({
        monthlyIncome,
        monthlyExpenses,
        targetAmount,
        horizonYears,
        currency,
      });
      if (!mountedRef.current) return;         // late result after close — discard
      // Stamp the plan so we can show "hace X dias" on the progress card.
      const stamped = { ...p, _savedAt: Date.now() };
      setPlan(stamped);
      // Persist automatically so the user doesn't lose the plan if they
      // close without hitting "Cerrar" (most people just swipe away).
      if (onSave) onSave(stamped);
    } catch (e) {
      if (!mountedRef.current) return;
      setErr(e?.message || "Error al generar el plan");
      setStep(3);
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }

  function reset() {
    setPlan(null);
    setStep(1);
    setErr(null);
  }

  return (
    <div style={{ position:"absolute", inset:0, zIndex:45, background:"rgba(0,0,0,0.6)", display:"flex", flexDirection:"column" }}>
      <div onClick={onClose} style={{ flex:1 }}/>
      <div style={{ background:C.bg, borderRadius:"22px 22px 0 0", maxHeight:"92%", display:"flex", flexDirection:"column", border:"1px solid "+C.border, borderBottom:"none", overflow:"hidden" }}>
        {/* Drag handle */}
        <div style={{ display:"flex", justifyContent:"center", padding:"10px 0 4px" }}>
          <div style={{ width:36, height:4, background:C.border, borderRadius:2 }}/>
        </div>

        {/* Header */}
        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"4px 16px 10px", borderBottom:"1px solid "+C.border }}>
          <div style={{ width:34, height:34, borderRadius:10, background:"linear-gradient(135deg,"+C.accent+",#7C3AED)", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <circle cx="12" cy="12" r="6"/>
              <circle cx="12" cy="12" r="2"/>
            </svg>
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:700, fontSize:14, color:C.text }}>Objetivos con IA</div>
            <div style={{ fontSize:10, color:hasAnthropicKey()?C.green:C.gold, fontWeight:600 }}>
              {hasAnthropicKey() ? "Claude · en vivo" : "Modo demo (sin API key)"}
            </div>
          </div>
          {/* Currency toggle — disabled on step 4 (plan view) so it doesn't
              look like you can change the plan's currency after the fact. */}
          {step < 4 && (
            <div style={{ display:"flex", background:C.creamDk, border:"1px solid "+C.border, borderRadius:10, padding:2, marginRight:6 }}>
              {["ARS", "USD"].map(code => (
                <button
                  key={code}
                  onClick={() => setCurrency(code)}
                  style={{
                    background: currency === code ? C.accent : "transparent",
                    color:      currency === code ? "#fff" : C.textMd,
                    border:"none", borderRadius:8, padding:"5px 9px",
                    fontSize:11, fontWeight:700, cursor:"pointer", fontFamily:"inherit",
                  }}
                >
                  {code}
                </button>
              ))}
            </div>
          )}
          <button onClick={onClose} aria-label="Cerrar" style={{ background:"transparent", border:"none", cursor:"pointer", padding:4, color:C.textMd }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Progress */}
        {step < 4 && (
          <div style={{ padding:"10px 16px 0", display:"flex", gap:4 }}>
            {[1, 2, 3].map(s => (
              <div key={s} style={{ flex:1, height:4, borderRadius:2, background: s <= step ? C.accent : C.creamDk }}/>
            ))}
          </div>
        )}

        {/* Body */}
        <div style={{ flex:1, overflowY:"auto", padding:"16px" }}>
          {step === 1 && (
            <StepIncome
              monthlyIncome={monthlyIncome}
              setMonthlyIncome={setMonthlyIncome}
              currency={currency}
              C={C}
            />
          )}
          {step === 2 && (
            <StepExpenses
              monthlyIncome={monthlyIncome}
              monthlyExpenses={monthlyExpenses}
              setMonthlyExpenses={setMonthlyExpenses}
              invest={invest}
              savingsRate={savingsRate}
              currency={currency}
              C={C}
            />
          )}
          {step === 3 && (
            <StepGoal
              targetAmount={targetAmount}
              setTargetAmount={setTargetAmount}
              horizonYears={horizonYears}
              setHorizonYears={setHorizonYears}
              invest={invest}
              preview={preview}
              currency={currency}
              C={C}
            />
          )}
          {step === 4 && !plan && (
            <PlanSkeleton C={C}/>
          )}
          {step === 4 && plan && (
            <PlanView
              plan={plan}
              invest={invest}
              target={targetAmount}
              horizon={horizonYears}
              currency={currency}
              C={C}
            />
          )}
          {err && (
            <div style={{ marginTop:10, background:C.red+"18", border:"1px solid "+C.red+"44", color:C.red, borderRadius:10, padding:"8px 10px", fontSize:11 }}>
              {err}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding:"10px 16px 14px", borderTop:"1px solid "+C.border, display:"flex", gap:8, background:C.bg }}>
          {step > 1 && step < 4 && (
            <button onClick={() => setStep(s => s - 1)} style={{ flex:1, background:C.creamDk, color:C.textMd, border:"1.5px solid "+C.border, borderRadius:12, padding:"11px", fontWeight:600, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
              Atras
            </button>
          )}
          {step < 3 && (
            <button
              onClick={() => setStep(s => s + 1)}
              disabled={step === 2 && invest <= 0}
              style={{
                flex:2,
                background: step === 2 && invest <= 0 ? C.creamDk : C.accent,
                color: step === 2 && invest <= 0 ? C.textLt : "#fff",
                border:"none", borderRadius:12, padding:"11px", fontWeight:700, fontSize:13,
                cursor: step === 2 && invest <= 0 ? "not-allowed" : "pointer", fontFamily:"inherit"
              }}>
              Siguiente
            </button>
          )}
          {step === 3 && (
            <button onClick={generate} disabled={busy || invest <= 0 || targetAmount <= 0} style={{ flex:2, background: busy || invest <= 0 || targetAmount <= 0 ? C.creamDk : C.accent, color: busy || invest <= 0 || targetAmount <= 0 ? C.textLt : "#fff", border:"none", borderRadius:12, padding:"11px", fontWeight:700, fontSize:13, cursor: busy || invest <= 0 || targetAmount <= 0 ? "not-allowed" : "pointer", fontFamily:"inherit" }}>
              {busy ? "Pensando…" : "Elegir estrategia con IA"}
            </button>
          )}
          {step === 4 && (
            <>
              <button
                onClick={reset}
                disabled={busy}
                style={{ flex:1, background:C.creamDk, color: busy ? C.textLt : C.textMd, border:"1.5px solid "+C.border, borderRadius:12, padding:"11px", fontWeight:600, fontSize:13, cursor: busy ? "not-allowed" : "pointer", fontFamily:"inherit", opacity: busy ? 0.6 : 1 }}
              >
                Regenerar
              </button>
              <button
                onClick={onClose}
                disabled={busy}
                style={{ flex:2, background: busy ? C.creamDk : C.accent, color: busy ? C.textLt : "#fff", border:"none", borderRadius:12, padding:"11px", fontWeight:700, fontSize:13, cursor: busy ? "not-allowed" : "pointer", fontFamily:"inherit" }}
              >
                {busy ? "Pensando..." : "Listo"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ------- steps -------------------------------------------------------------

function StepIncome({ monthlyIncome, setMonthlyIncome, currency, C }) {
  return (
    <div>
      <div style={{ fontSize:18, fontWeight:700, color:C.text, marginBottom:4 }}>Cuanto cobras por mes?</div>
      <div style={{ fontSize:12, color:C.textMd, marginBottom:16, lineHeight:1.5 }}>
        Ingreso mensual neto en {currency === "USD" ? "dolares" : "pesos argentinos"}. Sueldo, freelance, todo junto.
      </div>
      <CurrencyInput value={monthlyIncome} onChange={setMonthlyIncome} currency={currency} C={C}/>
      <div style={{ marginTop:14, padding:"10px 12px", background:C.card, border:"1px dashed "+C.border, borderRadius:12, fontSize:11, color:C.textMd, lineHeight:1.5 }}>
        Los datos quedan solo en tu navegador. No los guardamos en ningun servidor.
      </div>
    </div>
  );
}

function StepExpenses({ monthlyIncome, monthlyExpenses, setMonthlyExpenses, invest, savingsRate, currency, C }) {
  const over = monthlyExpenses > monthlyIncome;
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [parseBusy, setParseBusy] = useState(false);
  const [parseResult, setParseResult] = useState(null);
  const [parseErr, setParseErr] = useState(null);

  async function runParse() {
    if (!pasteText.trim() || parseBusy) return;
    setParseBusy(true);
    setParseErr(null);
    try {
      const out = await callExpenseParser(pasteText);
      setParseResult(out);
      if (out?.total > 0) setMonthlyExpenses(Math.round(out.total));
    } catch (e) {
      setParseErr(e?.message || "No se pudo parsear el resumen");
    } finally {
      setParseBusy(false);
    }
  }

  return (
    <div>
      <div style={{ fontSize:18, fontWeight:700, color:C.text, marginBottom:4 }}>Cuanto gastas por mes?</div>
      <div style={{ fontSize:12, color:C.textMd, marginBottom:16, lineHeight:1.5 }}>
        Sumale alquiler, expensas, comida, transporte, suscripciones, gustitos — todo lo que se te va.
      </div>
      <CurrencyInput value={monthlyExpenses} onChange={setMonthlyExpenses} currency={currency} C={C}/>

      {/* "Pegar resumen" option — lets Claude parse a bank/card statement */}
      <div style={{ marginTop:10 }}>
        <button
          onClick={() => setPasteOpen(v => !v)}
          style={{
            width:"100%",
            background: pasteOpen ? C.accent + "18" : "transparent",
            border: "1.5px dashed " + (pasteOpen ? C.accent + "66" : C.border),
            borderRadius: 10,
            padding: "10px 12px",
            fontSize: 12,
            color: pasteOpen ? C.accent : C.textMd,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="8" y="2" width="8" height="4" rx="1"/>
            <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
          </svg>
          {pasteOpen ? "Ocultar parser" : "No sabes el total? Pega tu resumen"}
        </button>
      </div>

      {pasteOpen && (
        <div style={{ marginTop:10, background:C.card, border:"1px solid "+C.border, borderRadius:12, padding:"12px" }}>
          <div style={{ fontSize:11, color:C.textMd, marginBottom:8, lineHeight:1.5 }}>
            Pegá texto de tu resumen de tarjeta, cuenta banco, Mercado Pago, etc. Claude extrae el total y categoriza.
          </div>
          <textarea
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            placeholder="Pega aca tu resumen (max ~8000 chars)..."
            rows={6}
            style={{ width:"100%", boxSizing:"border-box", background:C.bg, border:"1.5px solid "+C.border, borderRadius:10, padding:"10px", fontSize:12, fontFamily:"monospace", color:C.text, outline:"none", resize:"vertical", marginBottom:8 }}
          />
          <button
            onClick={runParse}
            disabled={parseBusy || !pasteText.trim()}
            style={{
              width:"100%",
              background: parseBusy || !pasteText.trim() ? C.creamDk : C.accent,
              color: parseBusy || !pasteText.trim() ? C.textLt : "#fff",
              border:"none", borderRadius:10, padding:"10px", fontSize:12, fontWeight:700,
              cursor: parseBusy || !pasteText.trim() ? "not-allowed" : "pointer", fontFamily:"inherit",
            }}
          >
            {parseBusy ? "Analizando…" : "Calcular total con IA"}
          </button>
          {parseErr && (
            <div style={{ marginTop:8, background:C.red+"18", border:"1px solid "+C.red+"44", color:C.red, borderRadius:8, padding:"6px 8px", fontSize:11 }}>{parseErr}</div>
          )}
          {parseResult && (
            <div style={{ marginTop:10, fontSize:11, color:C.textMd, lineHeight:1.5 }}>
              Total detectado: <strong style={{ color:C.text, fontFamily:"monospace" }}>{sym(parseResult.currency || currency)}{fmtNum(parseResult.total)}</strong>
              {Array.isArray(parseResult.categories) && parseResult.categories.length > 0 && (
                <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:8 }}>
                  {parseResult.categories.slice(0, 6).map((c, i) => (
                    <span key={i} style={{ background:C.bg, border:"1px solid "+C.border, borderRadius:8, padding:"3px 7px", fontSize:10, color:C.text }}>
                      {c.name} <span style={{ color:C.textMd, fontFamily:"monospace" }}>{sym(parseResult.currency || currency)}{fmtNum(c.amount)}</span>
                    </span>
                  ))}
                </div>
              )}
              {parseResult.notes && <div style={{ marginTop:8, fontSize:10, color:C.textLt, fontStyle:"italic" }}>{parseResult.notes}</div>}
            </div>
          )}
        </div>
      )}

      {/* Live breakdown */}
      <div style={{ marginTop:18, background:C.card, borderRadius:14, border:"1px solid "+C.border, padding:"14px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
          <span style={{ fontSize:11, fontWeight:700, color:C.textMd, textTransform:"uppercase", letterSpacing:1 }}>Sobrante invertible</span>
          {!over && invest > 0 && (
            <span style={{ fontSize:10, fontWeight:700, color:C.accent, background:C.accent+"22", borderRadius:6, padding:"2px 7px" }}>
              {(savingsRate * 100).toFixed(1)}% de tus ingresos
            </span>
          )}
        </div>

        {/* Visual bar */}
        <div style={{ display:"flex", height:10, borderRadius:5, overflow:"hidden", background:C.creamDk, marginBottom:10 }}>
          <div style={{ width: monthlyIncome ? Math.min(100, (monthlyExpenses / monthlyIncome) * 100) + "%" : "0%", background: over ? C.red : C.textLt, transition:"width 0.2s" }}/>
          {!over && <div style={{ flex:1, background: invest > 0 ? C.accent : "transparent" }}/>}
        </div>

        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:10 }}>
          <div>
            <div style={{ fontSize:26, fontWeight:800, color: over ? C.red : (invest > 0 ? C.accent : C.textLt), fontFamily:"monospace" }}>
              {sym(currency)}{fmtNum(invest)}
            </div>
            <div style={{ fontSize:10, color:C.textLt, marginTop:2 }}>podes destinar a inversion cada mes</div>
          </div>
          <div style={{ textAlign:"right", fontSize:11, color:C.textLt, lineHeight:1.5 }}>
            Ingreso {sym(currency)}{fmtNum(monthlyIncome)}<br/>
            Gasto  {sym(currency)}{fmtNum(monthlyExpenses)}
          </div>
        </div>

        {over && (
          <div style={{ marginTop:12, background:C.red+"22", border:"1px solid "+C.red+"55", color:C.red, borderRadius:10, padding:"8px 10px", fontSize:11, lineHeight:1.5 }}>
            Tus gastos superan los ingresos — no hay margen para invertir con estos numeros. Revisa gastos antes de seguir.
          </div>
        )}
        {!over && invest === 0 && (
          <div style={{ marginTop:12, background:C.gold+"22", border:"1px solid "+C.gold+"55", color:C.gold, borderRadius:10, padding:"8px 10px", fontSize:11, lineHeight:1.5 }}>
            Gastas todo lo que ganas. Incluso {sym(currency)}{currency === "USD" ? "20" : "5.000"} por mes es mejor que cero — probalo.
          </div>
        )}
      </div>
    </div>
  );
}

function StepGoal({ targetAmount, setTargetAmount, horizonYears, setHorizonYears, invest, preview, currency, C }) {
  return (
    <div>
      <div style={{ fontSize:18, fontWeight:700, color:C.text, marginBottom:4 }}>Cual es tu objetivo?</div>
      <div style={{ fontSize:12, color:C.textMd, marginBottom:16, lineHeight:1.5 }}>Monto a acumular y en cuanto tiempo. La IA va a ver si te da con tu sobrante actual y elegir la estrategia.</div>

      <div style={{ fontSize:10, fontWeight:700, color:C.textMd, letterSpacing:1, textTransform:"uppercase", marginBottom:6 }}>Monto objetivo ({currency})</div>
      <CurrencyInput value={targetAmount} onChange={setTargetAmount} currency={currency} C={C}/>

      <div style={{ fontSize:10, fontWeight:700, color:C.textMd, letterSpacing:1, textTransform:"uppercase", marginTop:14, marginBottom:8 }}>Horizonte</div>
      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:10 }}>
        {HORIZON_PRESETS.map(h => {
          const active = horizonYears === h;
          return (
            <button
              key={h}
              onClick={() => setHorizonYears(h)}
              style={{
                flex: "1 1 30%",
                background: active ? C.accent + "18" : C.card,
                border: "1.5px solid " + (active ? C.accent : C.border),
                color: active ? C.accent : C.text,
                borderRadius: 12,
                padding: "10px 8px",
                fontSize: 13,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                textAlign: "center",
              }}>
              {h} {h === 1 ? "anio" : "anios"}
            </button>
          );
        })}
      </div>

      {/* Live compound-interest preview */}
      <div style={{ marginTop:14, background:C.card, borderRadius:14, border:"1px solid "+C.border, padding:"14px" }}>
        <div style={{ fontSize:11, fontWeight:700, color:C.textMd, letterSpacing:1, textTransform:"uppercase", marginBottom:6 }}>
          Si invertis {sym(currency)}{fmtNum(invest)}/mes durante {horizonYears} anios
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {preview.map(p => {
            const reaches = p.final >= targetAmount && targetAmount > 0;
            const pct = targetAmount > 0 ? Math.min(100, (p.final / targetAmount) * 100) : 0;
            return (
              <div key={p.rate}>
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginBottom:4 }}>
                  <span style={{ color:C.text, fontWeight:600 }}>
                    {(p.rate * 100).toFixed(0)}% anual
                    {reaches && <span style={{ marginLeft:6, fontSize:10, fontWeight:800, color:C.green, background:C.green+"22", padding:"1px 5px", borderRadius:4 }}>llega</span>}
                  </span>
                  <span style={{ color:C.text, fontFamily:"monospace", fontWeight:700 }}>{sym(currency)}{fmtNum(p.final)}</span>
                </div>
                <div style={{ height:6, background:C.creamDk, borderRadius:3, overflow:"hidden" }}>
                  <div style={{ width: pct + "%", height:"100%", background: reaches ? C.green : C.accent, transition:"width 0.2s" }}/>
                </div>
              </div>
            );
          })}
        </div>
        {targetAmount > 0 && (
          <div style={{ fontSize:10, color:C.textLt, marginTop:10, lineHeight:1.5 }}>
            Objetivo: {sym(currency)}{fmtNum(targetAmount)} · Cuanto mas larga la barra, mas cerca estas de tu objetivo a esa tasa.
          </div>
        )}
      </div>
    </div>
  );
}

// ------- plan view ---------------------------------------------------------

function PlanView({ plan, invest, target, horizon, currency = "ARS", C }) {
  const stratColor = STRATEGY_COLORS[plan.strategy] || C.accent;
  const feasColor =
    plan.feasibility === "holgado"  ? C.green :
    plan.feasibility === "ajustado" ? C.gold  :
    plan.feasibility === "inviable" ? C.red   : C.textMd;
  const alloc = Array.isArray(plan.allocation) ? plan.allocation : [];
  const total = alloc.reduce((s, a) => s + (Number(a.percent) || 0), 0) || 1;

  return (
    <div>
      {/* Strategy hero */}
      <div style={{ background: stratColor + "18", border: "1px solid " + stratColor + "55", borderRadius: 14, padding: "14px" }}>
        <div style={{ fontSize:11, fontWeight:700, color:stratColor, letterSpacing:1, textTransform:"uppercase", marginBottom:4 }}>Tu estrategia</div>
        <div style={{ fontSize:24, fontWeight:800, color:C.text, textTransform:"capitalize", marginBottom:6 }}>{plan.strategy || "—"}</div>
        <div style={{ fontSize:12, color:C.text, lineHeight:1.5 }}>{plan.rationale}</div>
      </div>

      {/* Numbers row */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginTop:12 }}>
        <StatCard label="Retorno asumido" value={`${((plan.assumedReturn || 0) * 100).toFixed(1)}%`} sub="anual" C={C}/>
        <StatCard label="Aporte necesario" value={`${sym(currency)}${fmtNum(plan.monthlyNeeded)}`} sub="mensual" C={C}/>
      </div>

      {/* Feasibility */}
      <div style={{ marginTop:12, background:C.card, border:"1px solid "+C.border, borderRadius:14, padding:"12px 14px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
          <span style={{ fontSize:11, fontWeight:700, color:C.textMd, letterSpacing:1, textTransform:"uppercase" }}>Viabilidad</span>
          <span style={{ fontSize:10, fontWeight:800, color: feasColor, background: feasColor + "22", borderRadius:6, padding:"3px 8px", textTransform:"uppercase", letterSpacing:1 }}>
            {plan.feasibility || "—"}
          </span>
        </div>
        <div style={{ display:"flex", height:8, borderRadius:4, overflow:"hidden", background:C.creamDk, marginBottom:8 }}>
          <div style={{
            width: Math.min(100, (invest / Math.max(1, plan.monthlyNeeded || 1)) * 100) + "%",
            background: feasColor, transition:"width 0.2s",
          }}/>
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:C.textLt }}>
          <span>Tenes {sym(currency)}{fmtNum(invest)}/mes</span>
          <span>Necesitas {sym(currency)}{fmtNum(plan.monthlyNeeded)}/mes</span>
        </div>
        {plan.advice && (
          <div style={{ marginTop:10, fontSize:12, color:C.text, lineHeight:1.5 }}>{plan.advice}</div>
        )}
      </div>

      {/* Allocation */}
      {alloc.length > 0 && (
        <div style={{ marginTop:14 }}>
          <div style={{ fontSize:11, fontWeight:700, color:C.textMd, letterSpacing:1, textTransform:"uppercase", marginBottom:6 }}>Asignacion sugerida</div>
          <div style={{ display:"flex", height:12, borderRadius:6, overflow:"hidden", marginBottom:8, background:C.creamDk }}>
            {alloc.map((a, i) => (
              <div key={i} title={`${a.name} ${a.percent}%`} style={{ width: ((a.percent / total) * 100) + "%", background: CATEGORY_COLORS[a.name] || "#6B7280" }}/>
            ))}
          </div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
            {alloc.map((a, i) => (
              <div key={i} style={{ display:"flex", alignItems:"center", gap:5, background:C.card, border:"1px solid "+C.border, borderRadius:10, padding:"4px 9px" }}>
                <div style={{ width:9, height:9, borderRadius:2, background: CATEGORY_COLORS[a.name] || "#6B7280" }}/>
                <span style={{ fontSize:11, color:C.text, fontWeight:600 }}>{a.name}</span>
                <span style={{ fontSize:11, color:C.textMd, fontFamily:"monospace" }}>{a.percent}%</span>
                <InfoBadge term={a.name} C={C}/>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Disclaimer */}
      <div style={{ marginTop:16, padding:"10px 12px", background:C.card, border:"1px solid "+C.border, borderRadius:12, fontSize:10, color:C.textLt, lineHeight:1.5 }}>
        {plan.disclaimer || "Esto es educativo, no asesoramiento financiero."}
      </div>
    </div>
  );
}

// Skeleton state rendered while Claude is computing the plan. Mirrors the
// structure of PlanView so the layout doesn't jump when the real data
// lands — same hero card, same stat grid, same allocation strip.
function PlanSkeleton({ C }) {
  const sk = (style = {}) => (
    <div className="samas-skeleton" style={{ height:14, ...style }}/>
  );
  return (
    <div className="samas-fade">
      <div style={{ background: C.accent + "18", border: "1px solid " + C.accent + "55", borderRadius: 14, padding: "14px" }}>
        <div style={{ fontSize:11, fontWeight:700, color:C.accent, letterSpacing:1, textTransform:"uppercase", marginBottom:6, display:"flex", alignItems:"center", gap:8 }}>
          <span>Armando tu plan</span>
          <DotsSpinner C={C}/>
        </div>
        {sk({ width: "50%", height: 22, marginBottom: 10 })}
        {sk({ width: "100%", marginBottom: 5 })}
        {sk({ width: "82%", marginBottom: 5 })}
        {sk({ width: "65%" })}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginTop:12 }}>
        <div style={{ background:C.card, border:"1px solid "+C.border, borderRadius:14, padding:"11px 13px" }}>
          {sk({ width: "55%", height: 8, marginBottom: 8 })}
          {sk({ width: "70%", height: 18 })}
        </div>
        <div style={{ background:C.card, border:"1px solid "+C.border, borderRadius:14, padding:"11px 13px" }}>
          {sk({ width: "55%", height: 8, marginBottom: 8 })}
          {sk({ width: "80%", height: 18 })}
        </div>
      </div>

      <div style={{ marginTop:12, background:C.card, border:"1px solid "+C.border, borderRadius:14, padding:"12px 14px" }}>
        {sk({ width: "30%", height: 10, marginBottom: 10 })}
        {sk({ width: "100%", height: 8, marginBottom: 8 })}
        {sk({ width: "90%", height: 12 })}
      </div>

      <div style={{ marginTop:14 }}>
        {sk({ width: "40%", height: 10, marginBottom: 8 })}
        {sk({ width: "100%", height: 12, marginBottom: 8 })}
        <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
          {[62, 78, 90, 110, 72, 88].map((w, i) => (
            <div key={i} className="samas-skeleton" style={{ width: w, height: 22, borderRadius: 10 }}/>
          ))}
        </div>
      </div>
    </div>
  );
}

function DotsSpinner({ C }) {
  return (
    <span style={{ display: "inline-flex", gap: 3 }}>
      {[0, 1, 2].map(i => (
        <span
          key={i}
          style={{
            width: 5, height: 5, borderRadius: 3,
            background: C.accent,
            animation: `samasDot 1.1s infinite ease-in-out`,
            animationDelay: (i * 0.14) + "s",
            display: "inline-block",
          }}
        />
      ))}
      <style>{`@keyframes samasDot { 0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1); } }`}</style>
    </span>
  );
}

function StatCard({ label, value, sub, C }) {
  return (
    <div style={{ background:C.card, border:"1px solid "+C.border, borderRadius:14, padding:"11px 13px" }}>
      <div style={{ fontSize:10, fontWeight:700, color:C.textMd, letterSpacing:1, textTransform:"uppercase" }}>{label}</div>
      <div style={{ fontSize:18, fontWeight:800, color:C.text, fontFamily:"monospace", marginTop:4 }}>{value}</div>
      {sub && <div style={{ fontSize:10, color:C.textLt, marginTop:2 }}>{sub}</div>}
    </div>
  );
}

// ------- shared inputs -----------------------------------------------------

function CurrencyInput({ value, onChange, currency = "ARS", C }) {
  const prefix = currency === "USD" ? "u$s" : "$";
  const leftPad = currency === "USD" ? 40 : 26;
  // Show the raw number while typing so we don't fight the user's cursor.
  // When the value is 0 we render empty + use a placeholder — avoids the
  // classic "0432323" bug where typing appends to a stray leading zero.
  // Using type="text" + inputMode="numeric" gives us full control over
  // what gets into state (number inputs strip leading zeros inconsistently
  // across browsers and have other quirks with spinners/scientific entry).
  const display = value > 0 ? String(value) : "";
  return (
    <div style={{ position:"relative" }}>
      <span style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", color:C.textLt, fontSize:14, fontWeight:600, pointerEvents:"none" }}>{prefix}</span>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={display}
        placeholder="0"
        onFocus={e => { try { e.target.select(); } catch {} }}
        onChange={e => {
          // Keep only digits. Strip leading zeros so pasted strings like
          // "00123" or "0432323" normalize cleanly.
          const cleaned = e.target.value.replace(/[^\d]/g, "").replace(/^0+(?=\d)/, "");
          onChange(cleaned === "" ? 0 : Number(cleaned));
        }}
        onKeyDown={e => { if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-" || e.key === ".") e.preventDefault(); }}
        style={{
          background: C.bg,
          border: "1.5px solid " + C.border,
          borderRadius: 12,
          padding: `14px 14px 14px ${leftPad}px`,
          fontSize: 18,
          fontFamily: "Sora,sans-serif",
          fontWeight: 700,
          color: C.text,
          outline: "none",
          width: "100%",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}
