import { useEffect, useMemo, useRef, useState } from "react";
import { callObjectives, fvAnnuity, pmtForGoal, hasAnthropicKey } from "./client.js";
import { InfoBadge } from "./glossary.jsx";

// ============================================================
// OBJETIVOS WIZARD — spec v3 (simplified)
// ============================================================
// Per product direction, the AI only classifies the objective as
// CONSERVADORA / MODERADA / AGRESIVA based on horizon + currency. It does
// NOT ask for income/expenses and does NOT judge whether the goal is
// "viable" — that felt paternalistic. Users set their goal and get:
//   (a) an interactive compound-interest calculator so they can see what
//       different rates + monthly contributions would accumulate, and
//   (b) the AI's classification + an allocation mapped to SAMAS asset
//       categories.
//
// Flow: one page (2 steps minimum):
//   Step 1 — Objetivo + horizonte + calculadora interactiva
//   Step 2 — Clasificacion con IA (estrategia + asignacion)

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

export function ObjectivesWizard({ onClose, onSave, savedPlan, C }) {
  const prior = savedPlan?._profile || null;
  const [currency, setCurrency] = useState(prior?.currency ?? "ARS");
  const [step, setStep] = useState(savedPlan ? 2 : 1);

  // Goal inputs.
  const defaultTarget = currency === "USD" ? 50000 : 10000000;
  const [targetAmount, setTargetAmount] = useState(prior?.targetAmount ?? defaultTarget);
  const [horizonYears, setHorizonYears] = useState(prior?.horizonYears ?? 10);

  // Calculator-only inputs (not sent to the AI). Let the user play.
  const [calcMonthly, setCalcMonthly] = useState(currency === "USD" ? 200 : 50000);
  const [calcRate, setCalcRate]       = useState(currency === "USD" ? 0.07 : 0.09);

  // Keep the defaults sensible when the user flips currency before typing.
  useEffect(() => {
    const wasArsGoal = targetAmount === 10000000;
    const wasUsdGoal = targetAmount === 50000;
    if (currency === "USD" && wasArsGoal) { setTargetAmount(50000); setCalcMonthly(200); setCalcRate(0.07); }
    else if (currency === "ARS" && wasUsdGoal) { setTargetAmount(10000000); setCalcMonthly(50000); setCalcRate(0.09); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency]);

  const [plan, setPlan] = useState(savedPlan || null);
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState(null);

  // Unmount tracking for late-arriving async results.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Escape key closes the wizard (matches every other modal in SAMAS).
  useEffect(() => {
    const fn = (e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [onClose]);

  // Live compound-interest projection (client-side math only).
  const projected = useMemo(() => fvAnnuity(calcMonthly, horizonYears, calcRate), [calcMonthly, horizonYears, calcRate]);
  const monthlyToReachGoal = useMemo(() => pmtForGoal(targetAmount, horizonYears, calcRate), [targetAmount, horizonYears, calcRate]);

  async function generate() {
    if (busy) return;
    if (horizonYears <= 0) { setErr("El horizonte debe ser mayor a 0"); return; }
    if (targetAmount <= 0) { setErr("El objetivo debe ser mayor a 0"); return; }
    setBusy(true);
    setErr(null);
    setPlan(null);
    setStep(2);
    try {
      const p = await callObjectives({ targetAmount, horizonYears, currency });
      if (!mountedRef.current) return;
      const stamped = { ...p, _savedAt: Date.now() };
      setPlan(stamped);
      if (onSave) onSave(stamped);
    } catch (e) {
      if (!mountedRef.current) return;
      setErr(e?.message || "Error al generar la clasificación");
      setStep(1);
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
              {hasAnthropicKey() ? "SAMAS IA · en vivo" : "Modo demo (sin API key)"}
            </div>
          </div>
          {step === 1 && (
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

        {/* Body */}
        <div style={{ flex:1, overflowY:"auto", padding:"16px" }}>
          {step === 1 && (
            <StepObjective
              currency={currency}
              targetAmount={targetAmount}
              setTargetAmount={setTargetAmount}
              horizonYears={horizonYears}
              setHorizonYears={setHorizonYears}
              calcMonthly={calcMonthly}
              setCalcMonthly={setCalcMonthly}
              calcRate={calcRate}
              setCalcRate={setCalcRate}
              projected={projected}
              monthlyToReachGoal={monthlyToReachGoal}
              C={C}
            />
          )}
          {step === 2 && !plan && (
            <PlanSkeleton C={C}/>
          )}
          {step === 2 && plan && (
            <PlanView plan={plan} target={targetAmount} horizon={horizonYears} currency={currency} C={C}/>
          )}
          {err && (
            <div style={{ marginTop:10, background:C.red+"18", border:"1px solid "+C.red+"44", color:C.red, borderRadius:10, padding:"8px 10px", fontSize:11 }}>
              {err}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding:"10px 16px 14px", borderTop:"1px solid "+C.border, display:"flex", gap:8, background:C.bg }}>
          {step === 1 && (
            <button
              onClick={generate}
              disabled={busy || targetAmount <= 0 || horizonYears <= 0}
              style={{ flex:1, background: busy || targetAmount <= 0 ? C.creamDk : C.accent, color: busy || targetAmount <= 0 ? C.textLt : "#fff", border:"none", borderRadius:12, padding:"11px", fontWeight:700, fontSize:13, cursor: busy || targetAmount <= 0 ? "not-allowed" : "pointer", fontFamily:"inherit" }}
            >
              {busy ? "Pensando..." : "Clasificar con IA"}
            </button>
          )}
          {step === 2 && (
            <>
              <button
                onClick={reset}
                disabled={busy}
                style={{ flex:1, background:C.creamDk, color: busy ? C.textLt : C.textMd, border:"1.5px solid "+C.border, borderRadius:12, padding:"11px", fontWeight:600, fontSize:13, cursor: busy ? "not-allowed" : "pointer", fontFamily:"inherit", opacity: busy ? 0.6 : 1 }}
              >
                Ajustar objetivo
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

// ------- step 1: goal + calculator ------------------------------------------

function StepObjective({ currency, targetAmount, setTargetAmount, horizonYears, setHorizonYears, calcMonthly, setCalcMonthly, calcRate, setCalcRate, projected, monthlyToReachGoal, C }) {
  const reaches = projected >= targetAmount && targetAmount > 0;
  const progressPct = targetAmount > 0 ? Math.min(100, (projected / targetAmount) * 100) : 0;
  return (
    <div>
      <div style={{ fontSize:18, fontWeight:800, color:C.text, marginBottom:4 }}>¿Cuál es tu objetivo?</div>
      <div style={{ fontSize:12, color:C.textMd, marginBottom:14, lineHeight:1.5 }}>
        Dinos cuánto querés acumular y en cuánto tiempo. La IA te dice qué perfil de riesgo encaja con ese horizonte.
      </div>

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
                flex:"1 1 30%",
                background: active ? C.accent + "18" : C.card,
                border: "1.5px solid " + (active ? C.accent : C.border),
                color: active ? C.accent : C.text,
                borderRadius: 12,
                padding:"10px 8px",
                fontSize: 13,
                fontWeight: 700,
                cursor:"pointer",
                fontFamily:"inherit",
                textAlign:"center",
              }}
            >
              {h} {h === 1 ? "año" : "años"}
            </button>
          );
        })}
      </div>

      {/* Calculator — fully interactive. Doesn't send anything to the AI;
          the user plays with monthly + rate to intuit what it takes. */}
      <div style={{ marginTop:16, background:C.card, border:"1px solid "+C.border, borderRadius:14, padding:"14px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
          <div style={{ fontSize:11, fontWeight:700, color:C.textMd, letterSpacing:1, textTransform:"uppercase" }}>Calculadora de interés compuesto</div>
          <span style={{ fontSize:9, fontWeight:800, background:C.accent+"22", color:C.accent, borderRadius:4, padding:"1px 6px", letterSpacing:0.5 }}>SIMULÁ</span>
        </div>

        <div style={{ fontSize:10, fontWeight:700, color:C.textMd, letterSpacing:1, textTransform:"uppercase", marginBottom:5 }}>
          Aporte mensual
        </div>
        <CurrencyInput value={calcMonthly} onChange={setCalcMonthly} currency={currency} C={C}/>

        <div style={{ fontSize:10, fontWeight:700, color:C.textMd, letterSpacing:1, textTransform:"uppercase", marginTop:12, marginBottom:6, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <span>Tasa anual estimada</span>
          <span style={{ fontSize:12, fontWeight:800, color:C.accent, fontFamily:"monospace" }}>{(calcRate * 100).toFixed(1)}%</span>
        </div>
        <input
          type="range"
          min={currency === "USD" ? 2 : 4}
          max={currency === "USD" ? 15 : 25}
          step={0.5}
          value={calcRate * 100}
          onChange={e => setCalcRate(Number(e.target.value) / 100)}
          style={{ width:"100%", accentColor: C.accent }}
        />

        {/* Live result */}
        <div style={{ marginTop:14, paddingTop:14, borderTop:"1px solid "+C.border }}>
          <div style={{ fontSize:11, fontWeight:700, color:C.textMd, letterSpacing:1, textTransform:"uppercase", marginBottom:6 }}>
            En {horizonYears} {horizonYears === 1 ? "año" : "años"} acumulás
          </div>
          <div style={{ fontSize:26, fontWeight:800, color: reaches ? C.green : C.text, fontFamily:"monospace" }}>
            {sym(currency)}{fmtNum(projected)}
          </div>
          {targetAmount > 0 && (
            <>
              <div style={{ height:6, background:C.creamDk, borderRadius:3, overflow:"hidden", marginTop:8 }}>
                <div style={{ width: progressPct + "%", height:"100%", background: reaches ? C.green : C.accent, transition:"width 0.2s" }}/>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:C.textLt, marginTop:4 }}>
                <span>{progressPct.toFixed(0)}% del objetivo</span>
                <span>Objetivo: {sym(currency)}{fmtNum(targetAmount)}</span>
              </div>
            </>
          )}
          <div style={{ marginTop:10, padding:"8px 10px", background:C.bg, border:"1px dashed "+C.border, borderRadius:10, fontSize:11, color:C.textMd, lineHeight:1.5 }}>
            A {(calcRate * 100).toFixed(1)}% anual, para llegar exactamente al objetivo tendrías que aportar{" "}
            <strong style={{ color:C.text, fontFamily:"monospace" }}>{sym(currency)}{fmtNum(monthlyToReachGoal)}/mes</strong>.
          </div>
        </div>
      </div>

      <div style={{ marginTop:12, fontSize:10, color:C.gold, lineHeight:1.5 }}>
        ⚠︎ Proyecciones nominales. No ajustan por inflación de ARS ni USD; el poder de compra real puede ser distinto.
      </div>
    </div>
  );
}

// ------- skeleton while AI is classifying -----------------------------------

function PlanSkeleton({ C }) {
  const sk = (style = {}) => <div className="samas-skeleton" style={{ height:14, ...style }}/>;
  return (
    <div className="samas-fade">
      <div style={{ background: C.accent + "18", border: "1px solid " + C.accent + "55", borderRadius: 14, padding: "14px" }}>
        <div style={{ fontSize:11, fontWeight:700, color:C.accent, letterSpacing:1, textTransform:"uppercase", marginBottom:6, display:"flex", alignItems:"center", gap:8 }}>
          <span>Clasificando tu objetivo</span>
          <DotsSpinner C={C}/>
        </div>
        {sk({ width: "50%", height: 22, marginBottom: 10 })}
        {sk({ width: "100%", marginBottom: 5 })}
        {sk({ width: "82%", marginBottom: 5 })}
        {sk({ width: "65%" })}
      </div>
      <div style={{ marginTop:12 }}>
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
    <span style={{ display:"inline-flex", gap:3 }}>
      {[0,1,2].map(i => (
        <span
          key={i}
          style={{
            width:5, height:5, borderRadius:3,
            background:C.accent,
            animation:`samasDot 1.1s infinite ease-in-out`,
            animationDelay:(i * 0.14) + "s",
            display:"inline-block",
          }}
        />
      ))}
      <style>{`@keyframes samasDot { 0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1); } }`}</style>
    </span>
  );
}

// ------- step 2: plan view --------------------------------------------------

function PlanView({ plan, target, horizon, currency = "ARS", C }) {
  const stratColor = STRATEGY_COLORS[plan.strategy] || C.accent;
  const alloc = Array.isArray(plan.allocation) ? plan.allocation : [];
  const total = alloc.reduce((s, a) => s + (Number(a.percent) || 0), 0) || 1;
  // Monthly needed is pure math — compute client-side so we still show it
  // without relying on the AI to return it.
  const monthlyNeeded = target > 0 && plan.assumedReturn && horizon > 0
    ? Math.round(pmtForGoal(target, horizon, plan.assumedReturn))
    : 0;
  const difficulty = plan.difficulty || "normal";
  const diffColor = difficulty === "muy_exigente" ? C.red
                  : difficulty === "exigente"     ? C.gold
                  : null;
  const diffLabel = difficulty === "muy_exigente" ? "Jodidísimo"
                  : difficulty === "exigente"     ? "Exigente"
                  : null;

  return (
    <div>
      {/* Difficulty banner — only shown when the goal is non-trivial.
          Soft colloquial tone, no "imposible", no guilt. */}
      {diffColor && (
        <div className="samas-slide-up" style={{ background:diffColor + "18", border:"1.5px solid "+diffColor+"55", borderRadius:14, padding:"11px 13px", marginBottom:10, display:"flex", gap:10, alignItems:"flex-start" }}>
          <div style={{ width:26, height:26, borderRadius:13, background:diffColor+"33", color:diffColor, fontSize:14, fontWeight:800, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>!</div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:11, fontWeight:800, color:diffColor, letterSpacing:1, textTransform:"uppercase", marginBottom:2 }}>{diffLabel}</div>
            <div style={{ fontSize:12, color:C.text, lineHeight:1.45 }}>
              {difficulty === "muy_exigente"
                ? `Para llegar a ${sym(currency)}${fmtNum(target)} en ${horizon} ${horizon === 1 ? "año" : "años"} con retornos típicos necesitarías ${sym(currency)}${fmtNum(monthlyNeeded)}/mes. Vas a tener que meterle nazi con los aportes — o alargar un poco el plazo.`
                : `Para llegar a ${sym(currency)}${fmtNum(target)} en ${horizon} ${horizon === 1 ? "año" : "años"} te piden aportes firmes (~${sym(currency)}${fmtNum(monthlyNeeded)}/mes al ${(plan.assumedReturn*100).toFixed(0)}% anual). Se puede, pero hay que ponerle.`}
            </div>
          </div>
        </div>
      )}

      {/* Strategy hero */}
      <div style={{ background:stratColor + "18", border:"1px solid " + stratColor + "55", borderRadius:14, padding:"14px" }}>
        <div style={{ fontSize:11, fontWeight:700, color:stratColor, letterSpacing:1, textTransform:"uppercase", marginBottom:4 }}>Tu perfil</div>
        <div style={{ fontSize:24, fontWeight:800, color:C.text, textTransform:"capitalize", marginBottom:6 }}>{plan.strategy || "—"}</div>
        <div style={{ fontSize:12, color:C.text, lineHeight:1.5 }}>{plan.rationale}</div>
      </div>

      {/* Key numbers — pure math. No capacity judgement. */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginTop:12 }}>
        <StatCard label="Retorno típico" value={`${((plan.assumedReturn || 0) * 100).toFixed(1)}%`} sub="anual estimado" C={C}/>
        <StatCard label="Aporte mensual" value={`${sym(currency)}${fmtNum(monthlyNeeded)}`} sub={`para llegar en ${horizon}a`} C={C}/>
      </div>

      {/* Allocation */}
      {alloc.length > 0 && (
        <div style={{ marginTop:14 }}>
          <div style={{ fontSize:11, fontWeight:700, color:C.textMd, letterSpacing:1, textTransform:"uppercase", marginBottom:6 }}>Asignación sugerida</div>
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

      {/* Inflation caveat */}
      <div style={{ marginTop:14, padding:"10px 12px", background:C.gold+"14", border:"1px solid "+C.gold+"55", borderRadius:12, fontSize:11, color:C.gold, lineHeight:1.5, display:"flex", gap:8, alignItems:"flex-start" }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0, marginTop:2 }}>
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <div>
          Las proyecciones son nominales. <strong>No ajustan por inflación</strong> del peso ni del dólar, así que el poder de compra real al vencimiento puede ser distinto al monto mostrado.
        </div>
      </div>

      <div style={{ marginTop:10, padding:"10px 12px", background:C.card, border:"1px solid "+C.border, borderRadius:12, fontSize:10, color:C.textLt, lineHeight:1.5 }}>
        {plan.disclaimer || "Esto es educativo, no asesoramiento financiero."}
      </div>
    </div>
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

// ------- shared currency input ----------------------------------------------

function CurrencyInput({ value, onChange, currency = "ARS", C }) {
  const prefix = currency === "USD" ? "u$s" : "$";
  const leftPad = currency === "USD" ? 40 : 26;
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
