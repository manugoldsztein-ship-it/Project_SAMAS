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

const COACH_SYSTEM = `Sos "SAMAS Coach", el coach de inversiones con IA dentro de la app SAMAS, un broker social para la proxima generacion de inversores en Argentina y LatAm.

Tu rol:
- Hablas en el mismo idioma que el usuario. Por defecto, espanol rioplatense, tono cercano pero profesional.
- Explicas conceptos en lenguaje simple. Si usas jerga (YTM, CER, CEDEAR, UVA, BADLAR, etc.) definila brevemente la primera vez.
- Respuestas compactas. Parrafo o 2-3 bullets maximo. Si el usuario quiere mas, que pregunte.
- SAMAS tiene: Acciones argentinas (GGAL, YPF, PAMP, BBAR, ALUA, MIRG), CEDEAR (AAPL, MSFT, NVDA, GOOGL, AMZN, TSLA), ETFs (SPY, QQQ, GLD), Crypto (BTC), Bonos (AL30, GD30, AL35, GD35, CER, LEDES), Obligaciones Negociables, y Fondos Comunes.
- NUNCA des ordenes directas tipo "compra X" o "vende Y". Si te presionan, redireccionas hacia un principio o estrategia.
- Si el usuario te pide un plan concreto, cerra con: "Esto es educativo, no asesoramiento financiero."
- Si te refieren al portafolio del usuario, asumi que se lo estan pasando vos como contexto y referilo de manera natural.
- NO inventes cotizaciones actuales. Si el usuario pregunta por precios, decile que mire la pestana Mercado.
- Responde en el idioma que uso el usuario en su ultimo mensaje.`;

const OBJECTIVES_SYSTEM = `Sos "SAMAS Coach". Te van a pasar la situacion financiera mensual del usuario (ingresos, gastos, sobrante), un objetivo concreto (monto + anios), y una proyeccion de cuanto va a acumular si invierte ese sobrante a distintas tasas. Tu tarea: ELEGIR la estrategia (conservadora / moderada / agresiva) y explicar brevemente por que.

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

const SENTIMENT_SYSTEM = `Sos el analizador de sentimiento del feed de noticias de SAMAS. Recibis una lista de titulares de mercado. Devolves SOLAMENTE JSON valido, sin markdown, sin texto fuera del JSON. Schema:
{
  "bullish": number,   // 0-100
  "bearish": number,   // 0-100
  "neutral": number,   // 0-100 — los tres deben sumar 100
  "hotTopics": string[], // 3-5 temas cortos en espanol
  "summary": string    // 2-3 oraciones en espanol, tono neutral y observacional
}

Reglas:
- Tono neutral. Nada de consejos de inversion.
- Usa enteros.`;

// --- public helpers --------------------------------------------------------

/**
 * Chat turn for the Coach. `portfolio` is an optional array of
 * { ticker, qty, value } rows that we inject into the system prompt so the
 * coach can reference the user's holdings naturally.
 */
export async function callCoachChat(messages, { portfolio } = {}) {
  let system = COACH_SYSTEM;
  if (portfolio && portfolio.length) {
    const ctx = portfolio
      .slice(0, 20)
      .map(p => `- ${p.ticker}: ${p.qty} unidades${p.value ? ` (~$${Math.round(p.value).toLocaleString("es-AR")} ARS)` : ""}`)
      .join("\n");
    system += `\n\n---\nPORTAFOLIO ACTUAL DEL USUARIO (para referencia; no lo menciones salvo que venga al caso):\n${ctx}`;
  }
  if (!hasAnthropicKey()) return mockCoach(messages);
  const trimmed = messages.slice(-12);
  return callAnthropic({ system, messages: trimmed, maxTokens: 800 });
}

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
  const income   = Number(profile.monthlyIncome)   || 0;
  const expenses = Number(profile.monthlyExpenses) || 0;
  const invest   = Math.max(0, income - expenses);
  const target   = Number(profile.targetAmount)    || 0;
  const horizon  = Math.max(0.5, Number(profile.horizonYears) || 0);

  // Project what happens if the user invests their current surplus at
  // representative rates. The AI can reference these numbers directly.
  const rates = [0.06, 0.09, 0.12];
  const projections = rates.map(r => ({
    annualRate: r,
    finalAmount: Math.round(fvAnnuity(invest, horizon, r)),
    monthlyNeeded: Math.round(pmtForGoal(target, horizon, r)),
  }));

  const userPrompt = [
    "Decidi la estrategia para este usuario.",
    `- Ingreso mensual (ARS): ${income}`,
    `- Gastos mensuales (ARS): ${expenses}`,
    `- Sobrante invertible mensual (ARS): ${invest}`,
    `- Objetivo: acumular ${target} ARS en ${horizon} anios`,
    ``,
    `Proyecciones (invirtiendo el sobrante de ${invest} ARS/mes durante ${horizon} anios):`,
    ...projections.map(p => `  - a ${(p.annualRate * 100).toFixed(0)}% anual: acumula ~${p.finalAmount} ARS; para llegar al objetivo necesitarias aportar ~${p.monthlyNeeded} ARS/mes a esa tasa`),
    ``,
    `Devolve solo JSON.`,
  ].join("\n");

  const fallback = () => ({ ...mockObjectives({ income, expenses, invest, target, horizon, projections }), _projections: projections, _invest: invest, _profile: profile });

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
 * Summarize / score a list of news or forum items.
 * posts: [{ title: string, body?: string }]
 */
export async function callSentiment(posts) {
  const sample = posts.slice(0, 30).map((p, i) => `${i + 1}. ${(p.title || "").replace(/\s+/g, " ").trim()}${p.body ? " — " + p.body.slice(0, 140).replace(/\s+/g, " ").trim() : ""}`).join("\n");
  const userPrompt = [
    "Analiza el sentimiento de estos titulares del feed de SAMAS:",
    "",
    sample,
    "",
    "Devolve solo JSON."
  ].join("\n");
  if (!hasAnthropicKey()) return mockSentiment(posts);
  const raw = await callAnthropic({
    system: SENTIMENT_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
    maxTokens: 600,
  });
  return parseJson(raw) || mockSentiment(posts);
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

// Mock responders keep the UI usable without an API key.
function mockCoach(messages) {
  const last = (messages[messages.length - 1]?.content || "").toLowerCase();
  const tag = (body) => body + "\n\n_(Modo demo — pega tu API key de Anthropic en Perfil → Coach IA para respuestas reales.)_";
  if (last.includes("cedear")) return tag("Los CEDEAR son certificados que replican acciones del exterior (ej. AAPL, NVDA) y se operan en pesos en Argentina. Pro: acceso a Wall Street sin tener cuenta afuera. Contra: menor liquidez y spreads mas anchos que el subyacente.");
  if (last.includes("dolariz") || last.includes("dolar")) return tag("Para dolarizar dentro de SAMAS tenes tres caminos tipicos: bonos soberanos en USD (AL30, GD30), obligaciones negociables corporativas en USD, o un FCI de renta fija USD. Cada uno cambia el perfil riesgo/retorno — ONs pagan mas pero con mas riesgo de credito.");
  if (last.includes("retirar") || last.includes("jubil")) return tag("Arranque simple para largo plazo: 1) fondo de emergencia de 3-6 meses en un money market en pesos, 2) aporte mensual automatico a un mix de CEDEAR/ETF segun tu tolerancia, 3) revisa la asignacion una vez al ano. Esto es educativo, no asesoramiento financiero.");
  if (last.includes("compound") || last.includes("interes compuesto") || last.includes("interés")) return tag("Interes compuesto = interes sobre interes. $100.000 a 10% anual se convierten en ~$259.000 en 10 anios, y en ~$672.000 en 20 anios si lo dejas tranquilo. El tiempo importa mas que el monto inicial.");
  return tag("Lo pensaria en tres palancas: horizonte temporal, tolerancia al riesgo y consistencia del aporte mensual. Cual de las tres es tu limite mas fuerte hoy?");
}

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

function mockSentiment(posts) {
  return {
    bullish: 58,
    bearish: 22,
    neutral: 20,
    hotTopics: ["IA e infraestructura de chips", "Politica monetaria global", "Energia argentina", "Crypto y Bitcoin"],
    summary: "El feed de hoy inclina levemente alcista, impulsado por chips/IA y recuperacion de energia local. Una minoria marca riesgo de valuacion y tono cauto del banco central. _(Modo demo — configura tu API key para un analisis en vivo.)_"
  };
}
