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
  "notes": string            // 1-2 oraciones en español con observaciones relevantes (ej: "dos suscripciones que podrias revisar", "gasto atipico en noviembre")
}

Reglas:
- Suma solo egresos. Ignora ingresos, transferencias entrantes, reintegros.
- Normaliza a un mes. Si el texto cubre 2 meses, dividi por 2 y aclaralo en notes.
- Los amounts deben ser enteros redondeados.
- Si el texto esta vacio o no parece un resumen, devolve total: 0 y notes explicando que no pudiste parsearlo.`;

const OBJECTIVES_SYSTEM = `Sos "SAMAS IA". Te van a pasar un objetivo de inversion: monto a alcanzar, horizonte en años, moneda (ARS o USD). Hay que:
1. CLASIFICAR el perfil como "conservadora", "moderada" o "agresiva" (en base al horizonte).
2. EVALUAR la dificultad intrinseca del objetivo, en "normal", "exigente" o "muy_exigente".
3. Proponer una asignacion por categoria coherente con el perfil.

SOBRE DIFICULTAD — es importante:
- Decis la verdad sobre lo dificil del objetivo, pero sin usar la palabra "imposible" y sin hacer sentir juzgado al usuario.
- Podes usar expresiones coloquiales rioplatenses como "la tenes jodida", "tenes que meterle nazi", "es medio surrealista", "va a costar". Evita "no vas a llegar", "es imposible".
- NUNCA sugieras al usuario que baje su meta ("reduci a X", "aputá a menos", "ajusta el objetivo a Y"). La meta es del usuario y no se toca.
- NUNCA sugieras un aporte mensual concreto en pesos o dolares (no digas "tendrias que aportar $X/mes"). Solo cualifica: "requiere aportes muy fuertes" o "requiere constancia firme".
- Juzga la dificultad solo a partir de la aritmetica: cuanto aporte mensual harian falta a una tasa razonable para la moneda (USD: ~6-8% anual; ARS: ~8-10% real). Si el aporte necesario es "gigante" respecto a ingresos tipicos (ej. > 3000 USD/mes o > 500k ARS/mes), es muy_exigente. Si es moderado (ej. 500-3000 USD/mes o 100k-500k ARS/mes), exigente. Si es razonable (< 500 USD/mes o < 100k ARS/mes), normal.
- NO conoces los ingresos del usuario. Tu evaluacion es sobre el objetivo en abstracto, no sobre la persona.

SAMAS opera estas categorias (usa solo estas):
- "Acciones" (acciones argentinas)
- "CEDEAR" (acciones internacionales via CEDEAR)
- "ETF" (ETFs globales como SPY/QQQ/GLD)
- "Bonos" (bonos soberanos argentinos AL30/GD30/CER/LEDES)
- "ON" (obligaciones negociables corporativas)
- "FCI" (fondos comunes: money market, renta fija, mixtos)
- "Crypto" (BTC)
- "Cash" (liquidez, reserva de emergencia)

DEVOLVE SOLAMENTE JSON VALIDO (sin markdown, sin texto fuera del JSON). Schema:
{
  "strategy": "conservadora" | "moderada" | "agresiva",
  "difficulty": "normal" | "exigente" | "muy_exigente",
  "rationale": string,          // 2-3 oraciones en español, tono rioplatense. Explica el perfil y, si difficulty != "normal", avisa con franqueza pero sin "imposible" y sin juzgar a la persona. Ej: "Con ese horizonte y monto va a ser jodidisimo, vas a tener que meterle nazi con los aportes."
  "assumedReturn": number,      // tasa anual tipica para ese perfil en esa moneda (decimal, ej 0.08)
  "allocation": [{ "name": string, "percent": number }], // percents enteros que suman 100
  "disclaimer": string          // menciona que las proyecciones no ajustan por inflacion de ARS ni USD. Cerra con "Esto es educativo, no asesoramiento financiero."
}

Como elegir la estrategia (guia principal: horizonte):
- Horizonte corto (< 3 años): conservadora. Mucho peso en FCI money market, ON en USD, Bonos cortos, Cash; poco o nada de Crypto y Acciones/CEDEAR.
- Horizonte medio (3-7 años): moderada. Mix balanceado entre renta fija y variable.
- Horizonte largo (7+ años): agresiva. Mayor peso en CEDEAR/ETF/Acciones, algo de Crypto opcional.

Si la moneda es USD: prioriza ETF/CEDEAR/ON USD/Bonos USD. Si es ARS: prioriza Acciones argentinas, Bonos CER/LEDES, FCI en pesos.

Reglas:
- Porcentajes enteros que suman 100.
- NO uses tickers especificos; solo categorias.
- NUNCA uses la palabra "imposible". Podes decir "la tenes jodida", "muy exigente", "va a costar", "medio surrealista".
- NUNCA sugieras bajar la meta del usuario ni un aporte mensual concreto en numeros.`;

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
  const target   = Number(profile.targetAmount)  || 0;
  const horizon  = Math.max(0.5, Number(profile.horizonYears) || 0);

  const cur = currency;
  const userPrompt = [
    "Clasifica la estrategia para este objetivo:",
    `- Moneda: ${cur}`,
    `- Objetivo: acumular ${target} ${cur} en ${horizon} años`,
    ``,
    `Recorda: no conoces ingresos ni gastos del usuario. Solo clasificas.`,
    `Devolve solo JSON.`,
  ].join("\n");

  const fallback = () => ({ ...mockObjectives({ target, horizon, currency }), _profile: profile });

  if (!hasAnthropicKey()) return fallback();
  const raw = await callAnthropic({
    system: OBJECTIVES_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
    maxTokens: 700,
  });
  const parsed = parseJson(raw);
  if (!parsed) return fallback();
  return { ...parsed, _profile: profile };
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

// Mock responder keeps the Objetivos flow demoable without an API key.
// Classifies by horizon + currency, and separately estimates difficulty of
// the goal itself based on the compound-interest math (what monthly aport
// it would take to hit the target at the typical rate for that profile).
function mockObjectives(ctx) {
  const { target = 0, horizon = 5, currency = "ARS" } = ctx;
  const strategy = horizon >= 7 ? "agresiva" : horizon <= 3 ? "conservadora" : "moderada";
  const assumedReturn = currency === "USD"
    ? { conservadora: 0.04, moderada: 0.07, agresiva: 0.10 }[strategy]
    : { conservadora: 0.06, moderada: 0.09, agresiva: 0.12 }[strategy];
  const allocationsArs = {
    conservadora: { Acciones: 5,  CEDEAR: 8,  ETF: 7,  Bonos: 30, ON: 15, FCI: 30, Crypto: 0, Cash: 5 },
    moderada:     { Acciones: 12, CEDEAR: 22, ETF: 16, Bonos: 15, ON: 12, FCI: 15, Crypto: 5, Cash: 3 },
    agresiva:     { Acciones: 15, CEDEAR: 32, ETF: 25, Bonos: 5,  ON: 8,  FCI: 5,  Crypto: 7, Cash: 3 },
  };
  const allocationsUsd = {
    conservadora: { Acciones: 0, CEDEAR: 5,  ETF: 15, Bonos: 25, ON: 30, FCI: 20, Crypto: 0, Cash: 5 },
    moderada:     { Acciones: 3, CEDEAR: 18, ETF: 30, Bonos: 15, ON: 20, FCI: 8,  Crypto: 3, Cash: 3 },
    agresiva:     { Acciones: 5, CEDEAR: 30, ETF: 40, Bonos: 5,  ON: 10, FCI: 3,  Crypto: 5, Cash: 2 },
  };
  const base = currency === "USD" ? allocationsUsd[strategy] : allocationsArs[strategy];
  const allocation = Object.entries(base).map(([name, percent]) => ({ name, percent }));
  const horizonLabel = horizon <= 3 ? "corto" : horizon >= 7 ? "largo" : "medio";

  // Difficulty heuristic — compute the monthly aport required and compare
  // against what a "typical" earner in that currency might set aside. This
  // is all client-side math; it doesn't know your income, just the shape.
  const monthlyNeeded = target > 0 && horizon > 0 ? pmtForGoal(target, horizon, assumedReturn) : 0;
  const thresholds = currency === "USD" ? { exigente: 500, muy: 3000 } : { exigente: 100000, muy: 500000 };
  let difficulty = "normal";
  if (monthlyNeeded > thresholds.muy)      difficulty = "muy_exigente";
  else if (monthlyNeeded > thresholds.exigente) difficulty = "exigente";

  const rationaleNormal = `Un horizonte ${horizonLabel} de ${horizon} años en ${currency} encaja con un perfil ${strategy}. Con aportes regulares y un retorno típico, el objetivo entra bien.`;
  const rationaleExigente = `Un horizonte ${horizonLabel} de ${horizon} años pide un perfil ${strategy}. La tenés jodida pero con constancia firme se puede. Hay que meterle.`;
  const rationaleMuy = `Un horizonte ${horizonLabel} de ${horizon} años y ese monto en ${currency} es medio surrealista con un perfil ${strategy}. La tenés jodida — le vas a tener que meter nazi.`;

  return {
    strategy,
    difficulty,
    rationale: difficulty === "muy_exigente" ? rationaleMuy : difficulty === "exigente" ? rationaleExigente : rationaleNormal,
    assumedReturn,
    allocation,
    disclaimer: "Esto es educativo, no asesoramiento financiero. Las proyecciones no contemplan la inflación del peso ni del dólar — los rendimientos reales pueden diferir sustancialmente. _(Modo demo — configura tu API key para un análisis hecho por SAMAS IA.)_"
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
    notes: `Modo demo: suma cruda de ${hits.length} montos detectados sin categorizar. Configura tu API key para que SAMAS IA los agrupe.`,
  };
}
