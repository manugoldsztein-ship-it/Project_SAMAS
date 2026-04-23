// ============================================================
// SAMAS AI CLIENT — Anthropic (Claude)
// ============================================================
// Mirrors the existing Finnhub / EmailJS pattern: the user pastes their own
// Anthropic API key into the Profile sheet, we persist it in localStorage,
// and we call the Anthropic API *directly from the browser* using the
// anthropic-dangerous-direct-browser-access header.
//
// Why browser-direct and not a server route?
//   SAMAS is a single-file Vite build (vite-plugin-singlefile). Keeping the
//   AI plumbing 100% client-side preserves that: zero new infra to deploy
//   and the built dist/index.html still works when dropped on any static
//   host. If a user prefers to keep their key off the browser, they can run
//   a tiny proxy and point `samas_anthropic_endpoint` at it (see README).
//
// When no key is configured, every AI helper falls back to a small mock
// responder so the rest of the UI stays fully demoable.

// --- key + endpoint storage -------------------------------------------------

const KEY_STORAGE     = "samas_anthropic_key";
const MODEL_STORAGE   = "samas_anthropic_model";
const ENDPOINT_STORAGE = "samas_anthropic_endpoint"; // optional user override

export const DEFAULT_MODEL = "claude-sonnet-4-6";
export const DEFAULT_ENDPOINT = "https://api.anthropic.com/v1/messages";

export function loadAnthropicKey() {
  try { return typeof localStorage !== "undefined" ? localStorage.getItem(KEY_STORAGE) : null; }
  catch { return null; }
}
export function saveAnthropicKey(k) {
  try {
    if (k) localStorage.setItem(KEY_STORAGE, k);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {}
}

export function loadAnthropicModel() {
  try { return (typeof localStorage !== "undefined" && localStorage.getItem(MODEL_STORAGE)) || DEFAULT_MODEL; }
  catch { return DEFAULT_MODEL; }
}
export function saveAnthropicModel(m) {
  try {
    if (m && m !== DEFAULT_MODEL) localStorage.setItem(MODEL_STORAGE, m);
    else localStorage.removeItem(MODEL_STORAGE);
  } catch {}
}

export function loadAnthropicEndpoint() {
  try { return (typeof localStorage !== "undefined" && localStorage.getItem(ENDPOINT_STORAGE)) || DEFAULT_ENDPOINT; }
  catch { return DEFAULT_ENDPOINT; }
}
export function saveAnthropicEndpoint(url) {
  try {
    if (url && url !== DEFAULT_ENDPOINT) localStorage.setItem(ENDPOINT_STORAGE, url);
    else localStorage.removeItem(ENDPOINT_STORAGE);
  } catch {}
}

export function hasAnthropicKey() {
  return Boolean(loadAnthropicKey());
}

// --- core fetch wrapper ----------------------------------------------------

async function callAnthropic({ system, messages, maxTokens = 800, model }) {
  const apiKey = loadAnthropicKey();
  if (!apiKey) {
    throw new Error("NO_KEY");
  }
  const url = loadAnthropicEndpoint();
  const body = {
    model: model || loadAnthropicModel(),
    max_tokens: maxTokens,
    system,
    messages,
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      // Anthropic requires this explicit opt-in header for direct browser calls.
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.text()).slice(0, 300); } catch {}
    throw new Error(`Anthropic ${res.status}${detail ? ` — ${detail}` : ""}`);
  }
  const data = await res.json();
  const text = (data.content || [])
    .map(block => block.type === "text" ? block.text : "")
    .join("")
    .trim();
  return text || "(No response.)";
}

// Quick health check — used by the "Probar" button in ProfileSheet.
export async function testAnthropic() {
  const reply = await callAnthropic({
    system: "You are a health-check responder. Reply with exactly: OK",
    messages: [{ role: "user", content: "ping" }],
    maxTokens: 20,
  });
  return reply;
}

// --- system prompts --------------------------------------------------------

const EXPENSE_PARSER_SYSTEM = `Sos un parser de gastos mensuales para SAMAS.

Recibes texto pegado de un resumen bancario, resumen de tarjeta, extracto de Mercado Pago o similar. Tu tarea: calcular el TOTAL mensual de gastos y categorizarlos.

Devolves SOLAMENTE JSON valido (sin markdown ni texto fuera del JSON):
{
  "total": number,           // suma total de gastos del periodo, en la misma moneda que el texto
  "currency": "ARS" | "USD", // moneda detectada
  "categories": [{ "name": string, "amount": number }],  // 3-8 categorias, nombres cortos (Alquiler, Comida, Transporte, Suscripciones, Salud, Entretenimiento, etc.)
  "notes": string            // 1-2 oraciones en espanol con observaciones relevantes (ej: "dos suscripciones que podrias revisar", "gasto atipico en noviembre")
}

Reglas:
- Suma solo egresos. Ignora ingresos, transferencias entrantes, reintegros.
- Normaliza a un mes. Si el texto cubre 2 meses, dividi por 2 y aclaralo en notes.
- Los amounts deben ser enteros redondeados.
- Si el texto esta vacio o no parece un resumen, devolve total: 0 y notes explicando que no pudiste parsearlo.`;

const OBJECTIVES_SYSTEM = `Sos "SAMAS Coach". Te van a pasar la situacion financiera mensual del usuario (ingresos, gastos, sobrante), un objetivo concreto (monto + anios, en ARS o USD), y una proyeccion de cuanto va a acumular si invierte ese sobrante a distintas tasas razonables para esa moneda. Tu tarea: ELEGIR la estrategia (conservadora / moderada / agresiva) y explicar brevemente por que.

SAMAS opera estas categorias de activos (usa solo estas en la asignacion):
- "Acciones" (acciones argentinas)
- "CEDEAR" (acciones internacionales via CEDEAR)
- "ETF" (ETFs globales como SPY/QQQ/GLD)
- "Bonos" (bonos soberanos argentinos AL30/GD30/CER/LEDES)
- "ON" (obligaciones negociables corporativas)
- "FCI" (fondos comunes de inversion: money market, renta fija, mixtos)
- "Crypto" (BTC)
- "Cash" (liquidez, reserva de emergencia)

DEVOLVE SOLAMENTE JSON VALIDO, sin markdown, sin texto fuera del JSON. Schema:
{
  "strategy": "conservadora" | "moderada" | "agresiva",
  "rationale": string,          // 2-3 oraciones en espanol explicando POR QUE esa estrategia, citando el gap entre objetivo y proyeccion, el horizonte y la capacidad mensual
  "assumedReturn": number,      // tasa anual esperada (decimal, ej 0.08 para 8%)
  "allocation": [{ "name": string, "percent": number }], // usar solo las categorias de arriba, percents enteros que sumen 100
  "monthlyNeeded": number,      // aporte mensual en ARS necesario para alcanzar el objetivo a la tasa assumedReturn
  "feasibility": "holgado" | "ajustado" | "inviable",  // comparando monthlyNeeded vs el sobrante del usuario
  "advice": string,             // 1-2 oraciones con un consejo concreto (subir aportes, bajar gastos, alargar horizonte, ajustar objetivo)
  "disclaimer": string          // "Esto es educativo, no asesoramiento financiero."
}

Como elegir la estrategia:
- Horizonte corto (<3 anios) o gap pequeno: conservadora (mas FCI money market, Bonos, ON, Cash; menos Acciones/CEDEAR/Crypto).
- Horizonte medio (3-7 anios) o gap moderado: moderada (mix balanceado).
- Horizonte largo (7+ anios) o gap grande: agresiva (mas CEDEAR/ETF/Crypto, menos renta fija).
- Si el objetivo es claramente inviable con la capacidad actual, igual elegi la estrategia mas adecuada y marca feasibility "inviable" con advice claro.

Reglas:
- Porcentajes enteros que suman 100.
- No recomendes tickers especificos en allocation.name — solo categorias.
- Tono claro, directo, rioplatense.`;

// --- public helpers --------------------------------------------------------

/**
 * Compound interest helpers — the math is client-side so the AI only has
 * to pick the strategy. `fvAnnuity` returns the future value of investing
 * `monthly` per month for `years` at annual rate `r` (decimal). `pmtForGoal`
 * returns the monthly contribution needed to reach a target in that time.
 */
export function fvAnnuity(monthly, years, annualRate) {
  const n = Math.max(0, Math.round(years * 12));
  if (n === 0) return 0;
  const m = annualRate / 12;
  if (m === 0) return monthly * n;
  return monthly * (Math.pow(1 + m, n) - 1) / m;
}
export function pmtForGoal(target, years, annualRate) {
  const n = Math.max(1, Math.round(years * 12));
  const m = annualRate / 12;
  if (m === 0) return target / n;
  return target * m / (Math.pow(1 + m, n) - 1);
}

/**
 * Strategy picker. Input = monthly income/expenses/goal/horizon. The
 * compound-interest projections are computed here and passed to Claude,
 * which picks the strategy and explains why.
 */
export async function callObjectives(profile) {
  const currency = profile.currency === "USD" ? "USD" : "ARS";
  const income   = Number(profile.monthlyIncome)   || 0;
  const expenses = Number(profile.monthlyExpenses) || 0;
  const invest   = Math.max(0, income - expenses);
  const target   = Number(profile.targetAmount)    || 0;
  const horizon  = Math.max(0.5, Number(profile.horizonYears) || 0);

  // Rate expectations differ dramatically between ARS (high nominal due to
  // inflation) and USD (real-ish). Use reasonable ranges for each.
  const rates = currency === "USD"
    ? [0.05, 0.07, 0.10]                         // USD: savings / balanced / equity
    : [0.06, 0.09, 0.12];                        // ARS: kept from prior spec; represents real return net of inflation
  const projections = rates.map(r => ({
    annualRate: r,
    finalAmount: Math.round(fvAnnuity(invest, horizon, r)),
    monthlyNeeded: Math.round(pmtForGoal(target, horizon, r)),
  }));

  const cur = currency;
  const userPrompt = [
    "Decidi la estrategia para este usuario.",
    `- Moneda: ${cur}`,
    `- Ingreso mensual (${cur}): ${income}`,
    `- Gastos mensuales (${cur}): ${expenses}`,
    `- Sobrante invertible mensual (${cur}): ${invest}`,
    `- Objetivo: acumular ${target} ${cur} en ${horizon} anios`,
    ``,
    `Proyecciones (invirtiendo el sobrante de ${invest} ${cur}/mes durante ${horizon} anios):`,
    ...projections.map(p => `  - a ${(p.annualRate * 100).toFixed(0)}% anual: acumula ~${p.finalAmount} ${cur}; para llegar al objetivo necesitarias aportar ~${p.monthlyNeeded} ${cur}/mes a esa tasa`),
    ``,
    `Devolve solo JSON.`,
  ].join("\n");

  const fallback = () => ({ ...mockObjectives({ income, expenses, invest, target, horizon, projections, currency }), _projections: projections, _invest: invest, _profile: profile });

  if (!hasAnthropicKey()) return fallback();
  const raw = await callAnthropic({
    system: OBJECTIVES_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
    maxTokens: 900,
  });
  const parsed = parseJson(raw);
  if (!parsed) return fallback();
  return { ...parsed, _projections: projections, _invest: invest, _profile: profile };
}

/**
 * Parse a pasted bank/card statement into a monthly expense total +
 * category breakdown. Used by the wizard's step 2 as an alternative to
 * manually typing a number. Without an API key, best-effort regex.
 */
export async function callExpenseParser(text) {
  const input = (text || "").trim();
  if (!input) return { total: 0, currency: "ARS", categories: [], notes: "Texto vacio." };
  if (!hasAnthropicKey()) return mockExpenseParse(input);
  const raw = await callAnthropic({
    system: EXPENSE_PARSER_SYSTEM,
    messages: [{ role: "user", content: "Parsea este resumen:\n\n" + input.slice(0, 8000) }],
    maxTokens: 600,
  });
  return parseJson(raw) || mockExpenseParse(input);
}

// --- helpers ---------------------------------------------------------------

function parseJson(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch {}
  const first = s.indexOf("{");
  const last  = s.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return null;
  try { return JSON.parse(s.slice(first, last + 1)); } catch { return null; }
}

// Mock responder keeps the Objetivos wizard demoable without an API key.
function mockObjectives(ctx) {
  // Pick strategy based on horizon and gap (same heuristic Claude uses)
  const { horizon = 5, invest = 0, projections = [] } = ctx;
  const strategy = horizon >= 7 ? "agresiva" : horizon <= 3 ? "conservadora" : "moderada";
  const assumedReturn = { conservadora: 0.06, moderada: 0.09, agresiva: 0.12 }[strategy];
  const allocations = {
    conservadora: { Acciones: 5,  CEDEAR: 10, ETF: 10, Bonos: 30, ON: 15, FCI: 25, Crypto: 0, Cash: 5 },
    moderada:     { Acciones: 10, CEDEAR: 25, ETF: 20, Bonos: 15, ON: 12, FCI: 12, Crypto: 3, Cash: 3 },
    agresiva:     { Acciones: 15, CEDEAR: 32, ETF: 25, Bonos: 5,  ON: 10, FCI: 5,  Crypto: 5, Cash: 3 },
  };
  const allocation = Object.entries(allocations[strategy]).map(([name, percent]) => ({ name, percent }));
  // Find monthlyNeeded from projections at the chosen rate
  const proj = projections.find(p => Math.abs(p.annualRate - assumedReturn) < 0.001) || projections[1] || { monthlyNeeded: invest };
  const feasibility = invest === 0 ? "inviable" : proj.monthlyNeeded <= invest * 1.05 ? "holgado" : proj.monthlyNeeded <= invest * 1.5 ? "ajustado" : "inviable";
  return {
    strategy,
    rationale: `Con un horizonte de ${horizon} anios y tu sobrante actual, la estrategia ${strategy} balancea el crecimiento esperado con el riesgo que te conviene asumir.`,
    assumedReturn,
    allocation,
    monthlyNeeded: proj.monthlyNeeded,
    feasibility,
    advice: feasibility === "holgado" ? "Vas sobrado — podes ser mas conservador o ampliar el objetivo." : feasibility === "ajustado" ? "Te da justo. Automatiza el aporte y no falles meses." : "El objetivo no entra con tu sobrante actual. Bajar gastos, subir ingresos, o alargar el horizonte.",
    disclaimer: "Esto es educativo, no asesoramiento financiero. _(Modo demo — configura tu API key para un analisis hecho por Claude.)_"
  };
}

// Fallback expense parser when no API key is configured. Greps for currency-
// looking numbers and returns a rough total. Not smart enough to categorize.
function mockExpenseParse(text) {
  // Matches $1.234,56 / $1,234.56 / ARS 1234 / USD 1234 / $1234
  const re = /\$?\s*([0-9]{1,3}(?:[.,][0-9]{3})+|[0-9]+)(?:[.,]([0-9]{1,2}))?/g;
  let total = 0;
  const hits = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const intPart = m[1].replace(/[.,]/g, "");
    const n = parseInt(intPart, 10);
    if (!Number.isFinite(n) || n < 100) continue;   // skip tiny numbers that are probably not amounts
    total += n;
    hits.push(n);
    if (hits.length > 200) break;
  }
  const currency = /USD|u\$s|\bdolar/i.test(text) ? "USD" : "ARS";
  return {
    total: Math.round(total),
    currency,
    categories: [],
    notes: `Modo demo: suma cruda de ${hits.length} montos detectados sin categorizar. Configura tu API key para que Claude los agrupe.`,
  };
}
