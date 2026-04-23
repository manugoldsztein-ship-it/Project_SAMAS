import { useState } from "react";
import { callObjectives, hasAnthropicKey } from "./client.js";

// ============================================================
// OBJETIVOS WIZARD (AI)
// ============================================================
// 4-step wizard that collects goal / horizon / risk / monthly capacity,
// asks Claude for a personalized plan, and renders the result as a
// category-by-category allocation that maps 1:1 onto SAMAS's asset
// classes (Acciones, CEDEAR, ETF, Bonos, ON, FCI, Crypto, Cash).
//
// Entry point lives on PagePortfolio as a banner button.

const GOALS = [
  { id: "retire",    label: "Jubilacion",                icon: "🌅" },
  { id: "house",     label: "Comprar casa",              icon: "🏠" },
  { id: "freedom",   label: "Libertad financiera",       icon: "🔓" },
  { id: "education", label: "Educacion hijos/a",         icon: "🎓" },
  { id: "emergency", label: "Fondo de emergencia",       icon: "🛟" },
  { id: "wealth",    label: "Crecer capital",            icon: "📈" },
];

const RISKS = [
  { id: "conservador", label: "Conservador", desc: "Prefiero no perder" },
  { id: "moderado",    label: "Moderado",    desc: "Equilibrio riesgo/retorno" },
  { id: "agresivo",    label: "Agresivo",    desc: "Busco maximizar retorno" },
];

const HORIZONS = [
  { id: 1,  label: "1 anio" },
  { id: 3,  label: "3 anios" },
  { id: 5,  label: "5 anios" },
  { id: 10, label: "10 anios" },
  { id: 20, label: "20+ anios" },
];

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

export function ObjectivesWizard({ onClose, C }) {
  const [step, setStep] = useState(1);
  const [profile, setProfile] = useState({
    goal: "retire",
    horizonYears: 10,
    risk: "moderado",
    monthlyCapacity: 50000,
  });
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState(null);

  async function generate() {
    setBusy(true);
    setErr(null);
    try {
      const p = await callObjectives(profile);
      // Defensive normalization so the renderer stays simple.
      const allocation = Array.isArray(p?.allocation)
        ? p.allocation.filter(x => x && typeof x.name === "string" && typeof x.percent === "number")
        : [];
      setPlan({
        summary: p?.summary || "Plan personalizado generado.",
        monthlyContribution: Number(p?.monthlyContribution) || profile.monthlyCapacity || 0,
        allocation,
        milestones: Array.isArray(p?.milestones) ? p.milestones : [],
        principles: Array.isArray(p?.principles) ? p.principles : [],
        disclaimer: p?.disclaimer || "Esto es educativo, no asesoramiento financiero.",
      });
      setStep(5);
    } catch (e) {
      setErr(e?.message || "Error al generar el plan");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ position:"absolute", inset:0, zIndex:45, background:"rgba(0,0,0,0.6)", display:"flex", flexDirection:"column" }}>
      <div onClick={onClose} style={{ flex:1 }}/>
      <div style={{ background:C.bg, borderRadius:"22px 22px 0 0", maxHeight:"92%", display:"flex", flexDirection:"column", border:"1px solid "+C.border, borderBottom:"none", overflow:"hidden" }}>
        {/* Handle */}
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
          <button onClick={onClose} style={{ background:"transparent", border:"none", cursor:"pointer", padding:4, color:C.textMd }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Progress */}
        {step < 5 && (
          <div style={{ padding:"10px 16px 0", display:"flex", gap:4 }}>
            {[1,2,3,4].map(s => (
              <div key={s} style={{ flex:1, height:4, borderRadius:2, background: s <= step ? C.accent : C.creamDk }}/>
            ))}
          </div>
        )}

        <div style={{ flex:1, overflowY:"auto", padding:"14px 16px 8px" }}>
          {step === 1 && (
            <StepCards
              title="Cual es tu objetivo principal?"
              options={GOALS}
              selected={profile.goal}
              onSelect={v => setProfile(p => ({ ...p, goal: v }))}
              C={C}
            />
          )}
          {step === 2 && (
            <StepCards
              title="En que horizonte lo queres?"
              options={HORIZONS.map(h => ({ id: h.id, label: h.label, icon: "⏳" }))}
              selected={profile.horizonYears}
              onSelect={v => setProfile(p => ({ ...p, horizonYears: v }))}
              C={C}
            />
          )}
          {step === 3 && (
            <StepCards
              title="Cual es tu tolerancia al riesgo?"
              options={RISKS.map(r => ({ id: r.id, label: r.label, desc: r.desc, icon: r.id === "conservador" ? "🐢" : r.id === "moderado" ? "⚖️" : "🚀" }))}
              selected={profile.risk}
              onSelect={v => setProfile(p => ({ ...p, risk: v }))}
              C={C}
            />
          )}
          {step === 4 && (
            <StepCapacity profile={profile} setProfile={setProfile} C={C}/>
          )}
          {step === 5 && plan && (
            <PlanView plan={plan} profile={profile} C={C}/>
          )}
          {err && <div style={{ marginTop:10, background:C.red+"18", border:"1px solid "+C.red+"44", color:C.red, borderRadius:10, padding:"8px 10px", fontSize:11 }}>{err}</div>}
        </div>

        {/* Footer */}
        <div style={{ padding:"10px 16px 14px", borderTop:"1px solid "+C.border, display:"flex", gap:8, background:C.bg }}>
          {step > 1 && step < 5 && (
            <button onClick={() => setStep(s => s - 1)} style={{ flex:1, background:C.creamDk, color:C.textMd, border:"1.5px solid "+C.border, borderRadius:12, padding:"11px", fontWeight:600, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
              Atras
            </button>
          )}
          {step < 4 && (
            <button onClick={() => setStep(s => s + 1)} style={{ flex:2, background:C.accent, color:"#fff", border:"none", borderRadius:12, padding:"11px", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
              Siguiente
            </button>
          )}
          {step === 4 && (
            <button onClick={generate} disabled={busy} style={{ flex:2, background: busy ? C.creamDk : C.accent, color: busy ? C.textLt : "#fff", border:"none", borderRadius:12, padding:"11px", fontWeight:700, fontSize:13, cursor: busy ? "not-allowed" : "pointer", fontFamily:"inherit" }}>
              {busy ? "Pensando…" : "Generar plan"}
            </button>
          )}
          {step === 5 && (
            <>
              <button onClick={() => { setPlan(null); setStep(1); }} style={{ flex:1, background:C.creamDk, color:C.textMd, border:"1.5px solid "+C.border, borderRadius:12, padding:"11px", fontWeight:600, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
                Nuevo
              </button>
              <button onClick={onClose} style={{ flex:2, background:C.accent, color:"#fff", border:"none", borderRadius:12, padding:"11px", fontWeight:700, fontSize:13, cursor:"pointer", fontFamily:"inherit" }}>
                Guardar y cerrar
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- sub-components --------------------------------------------------------

function StepCards({ title, options, selected, onSelect, C }) {
  return (
    <div>
      <div style={{ fontSize:18, fontWeight:700, color:C.text, marginBottom:12 }}>{title}</div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
        {options.map(o => {
          const active = selected === o.id;
          return (
            <button
              key={String(o.id)}
              onClick={() => onSelect(o.id)}
              style={{
                background: active ? C.accent + "18" : C.card,
                border: "1.5px solid " + (active ? C.accent : C.border),
                borderRadius: 14,
                padding: "12px 10px",
                textAlign: "left",
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "all 0.15s",
              }}
            >
              <div style={{ fontSize:22, marginBottom:4 }}>{o.icon}</div>
              <div style={{ fontSize:13, fontWeight:700, color: active ? C.accent : C.text, marginBottom: o.desc ? 2 : 0 }}>{o.label}</div>
              {o.desc && <div style={{ fontSize:10, color:C.textLt }}>{o.desc}</div>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StepCapacity({ profile, setProfile, C }) {
  return (
    <div>
      <div style={{ fontSize:18, fontWeight:700, color:C.text, marginBottom:12 }}>Tu capacidad y contexto</div>

      <Field label="Capacidad mensual de inversion (ARS)" C={C}>
        <input
          type="number"
          min={0}
          step={1000}
          value={profile.monthlyCapacity}
          onChange={e => setProfile(p => ({ ...p, monthlyCapacity: Number(e.target.value) || 0 }))}
          style={inputStyle(C)}
        />
      </Field>
      <Field label="Ingreso mensual aprox. (ARS) — opcional" C={C}>
        <input
          type="number"
          min={0}
          step={10000}
          value={profile.income || ""}
          placeholder="Opcional"
          onChange={e => setProfile(p => ({ ...p, income: Number(e.target.value) || 0 }))}
          style={inputStyle(C)}
        />
      </Field>
      <Field label="Ahorros actuales (ARS) — opcional" C={C}>
        <input
          type="number"
          min={0}
          step={10000}
          value={profile.savings || ""}
          placeholder="Opcional"
          onChange={e => setProfile(p => ({ ...p, savings: Number(e.target.value) || 0 }))}
          style={inputStyle(C)}
        />
      </Field>
      <Field label="Tu edad — opcional" C={C}>
        <input
          type="number"
          min={0}
          max={100}
          value={profile.age || ""}
          placeholder="Opcional"
          onChange={e => setProfile(p => ({ ...p, age: Number(e.target.value) || 0 }))}
          style={inputStyle(C)}
        />
      </Field>

      <div style={{ marginTop:12, padding:"10px 12px", background:C.card, border:"1px dashed "+C.border, borderRadius:12, fontSize:11, color:C.textMd, lineHeight:1.5 }}>
        Cuanta mas informacion das, mas calibrado es el plan. Nada se guarda fuera de tu navegador.
      </div>
    </div>
  );
}

function Field({ label, children, C }) {
  return (
    <div style={{ marginBottom:10 }}>
      <div style={{ fontSize:10, fontWeight:700, color:C.textMd, letterSpacing:1, marginBottom:5, textTransform:"uppercase" }}>{label}</div>
      {children}
    </div>
  );
}

function inputStyle(C) {
  return {
    background: C.bg,
    border: "1.5px solid " + C.border,
    borderRadius: 10,
    padding: "10px 12px",
    fontSize: 14,
    fontFamily: "Sora,sans-serif",
    color: C.text,
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
  };
}

function PlanView({ plan, profile, C }) {
  const total = plan.allocation.reduce((s, a) => s + a.percent, 0) || 1;
  return (
    <div>
      <div style={{ fontSize:11, fontWeight:700, color:C.accent, letterSpacing:1, marginBottom:6, textTransform:"uppercase" }}>Tu plan</div>
      <div style={{ fontSize:14, color:C.text, lineHeight:1.5, marginBottom:12 }}>{plan.summary}</div>

      {/* Monthly contribution */}
      <div style={{ background:C.card, border:"1px solid "+C.border, borderRadius:14, padding:"12px 14px", marginBottom:12, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <div style={{ fontSize:10, fontWeight:700, color:C.textMd, letterSpacing:1, textTransform:"uppercase" }}>Aporte mensual sugerido</div>
          <div style={{ fontSize:20, fontWeight:800, color:C.text, fontFamily:"monospace", marginTop:2 }}>${Math.round(plan.monthlyContribution).toLocaleString("es-AR")}</div>
        </div>
        <div style={{ background:C.accent+"22", color:C.accent, borderRadius:10, padding:"6px 10px", fontSize:10, fontWeight:700, textTransform:"uppercase" }}>{profile.risk}</div>
      </div>

      {/* Allocation bar */}
      <div style={{ fontSize:11, fontWeight:700, color:C.textMd, letterSpacing:1, marginBottom:6, textTransform:"uppercase" }}>Asignacion</div>
      <div style={{ display:"flex", height:12, borderRadius:6, overflow:"hidden", marginBottom:8, background:C.creamDk }}>
        {plan.allocation.map((a, i) => (
          <div key={i} title={`${a.name} ${a.percent}%`} style={{ width:((a.percent/total)*100)+"%", background: CATEGORY_COLORS[a.name] || "#6B7280" }}/>
        ))}
      </div>
      <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:14 }}>
        {plan.allocation.map((a, i) => (
          <div key={i} style={{ display:"flex", alignItems:"center", gap:5, background:C.card, border:"1px solid "+C.border, borderRadius:10, padding:"4px 9px" }}>
            <div style={{ width:9, height:9, borderRadius:2, background: CATEGORY_COLORS[a.name] || "#6B7280" }}/>
            <span style={{ fontSize:11, color:C.text, fontWeight:600 }}>{a.name}</span>
            <span style={{ fontSize:11, color:C.textMd, fontFamily:"monospace" }}>{a.percent}%</span>
          </div>
        ))}
      </div>

      {/* Milestones */}
      {plan.milestones.length > 0 && (
        <>
          <div style={{ fontSize:11, fontWeight:700, color:C.textMd, letterSpacing:1, marginBottom:6, textTransform:"uppercase" }}>Hitos</div>
          <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:14 }}>
            {plan.milestones.map((m, i) => (
              <div key={i} style={{ display:"flex", gap:8, alignItems:"flex-start" }}>
                <div style={{ width:18, height:18, borderRadius:9, background:C.accent+"22", color:C.accent, fontSize:11, fontWeight:800, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>{i+1}</div>
                <div style={{ fontSize:12, color:C.text, lineHeight:1.5 }}>{m}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Principles */}
      {plan.principles.length > 0 && (
        <>
          <div style={{ fontSize:11, fontWeight:700, color:C.textMd, letterSpacing:1, marginBottom:6, textTransform:"uppercase" }}>Principios</div>
          <ul style={{ margin:0, paddingLeft:18, color:C.text, fontSize:12, lineHeight:1.6 }}>
            {plan.principles.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </>
      )}

      <div style={{ marginTop:16, padding:"10px 12px", background:C.card, border:"1px solid "+C.border, borderRadius:12, fontSize:10, color:C.textLt, lineHeight:1.5 }}>
        {plan.disclaimer}
      </div>
    </div>
  );
}
