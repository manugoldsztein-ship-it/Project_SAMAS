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

const OBJECTIVES_SYSTEM = `Sos "SAMAS Coach". Tu tarea es armar un plan de inversion personalizado dentro de la app SAMAS para el perfil que te van a pasar.

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
  "summary": string,           // 1-2 oraciones en espanol
  "monthlyContribution": number, // sugerido mensual en ARS
  "allocation": [{ "name": string, "percent": number }], // usar solo las categorias de arriba, percents enteros que sumen 100
  "milestones": string[],      // 3-5 hitos cortos en espanol
  "principles": string[],      // 3-5 principios cortos en espanol
  "disclaimer": string         // "Esto es educativo, no asesoramiento financiero."
}

Reglas:
- Los porcentajes deben ser enteros y sumar 100.
- El plan debe reflejar el horizonte, la tolerancia al riesgo y la capacidad mensual del usuario.
- Perfil conservador: mas FCI money market, bonos en dolares, cash; menos Acciones/CEDEAR/Crypto.
- Perfil moderado: mix balanceado.
- Perfil agresivo: mas CEDEAR/ETF/Crypto, menos renta fija.
- No recomiendes tickers especificos en "allocation.name" — solo categorias.
- Principios breves y universales (horizonte largo, diversificacion, costos bajos, no market timing).`;

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
 * Personalized investment plan. `profile` → plan JSON object.
 */
export async function callObjectives(profile) {
  const userPrompt = [
    "Arma un plan de inversion personalizado para este perfil:",
    `- Edad: ${profile.age || "sin especificar"}`,
    `- Ingreso mensual (ARS): ${profile.income || "sin especificar"}`,
    `- Ahorros actuales (ARS): ${profile.savings || "sin especificar"}`,
    `- Capacidad mensual de inversion (ARS): ${profile.monthlyCapacity || "sin especificar"}`,
    `- Tolerancia al riesgo: ${profile.risk || "moderado"}`,
    `- Horizonte (anios): ${profile.horizonYears || "sin especificar"}`,
    `- Objetivo: ${profile.goal || "crecer capital a largo plazo"}`,
    "",
    "Devolve solo JSON."
  ].join("\n");
  if (!hasAnthropicKey()) return mockObjectives(profile);
  const raw = await callAnthropic({
    system: OBJECTIVES_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
    maxTokens: 900,
  });
  return parseJson(raw) || mockObjectives(profile);
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

function mockObjectives(profile) {
  const risk = profile.risk || "moderado";
  const base = {
    conservador:  { Acciones: 5,  CEDEAR: 10, ETF: 10, Bonos: 35, ON: 15, FCI: 20, Crypto: 0,  Cash: 5 },
    moderado:     { Acciones: 10, CEDEAR: 20, ETF: 20, Bonos: 15, ON: 15, FCI: 15, Crypto: 2,  Cash: 3 },
    agresivo:     { Acciones: 15, CEDEAR: 30, ETF: 25, Bonos: 5,  ON: 10, FCI: 5,  Crypto: 7,  Cash: 3 },
  }[risk] || {};
  const allocation = Object.entries(base).map(([name, percent]) => ({ name, percent }));
  return {
    summary: `Plan ${risk} de largo plazo para tu horizonte y capacidad de aporte mensual.`,
    monthlyContribution: profile.monthlyCapacity || 50000,
    allocation,
    milestones: [
      "Construi un fondo de emergencia de 3 meses antes de subir aportes",
      "Automatiza el aporte mensual para sacar la emocion de la ecuacion",
      "Revisa la asignacion cada 12 meses, no cada dia"
    ],
    principles: [
      "El tiempo en el mercado le gana al timing",
      "Costos bajos se componen igual que los retornos",
      "Diversificar es la unica comida gratis"
    ],
    disclaimer: "Esto es educativo, no asesoramiento financiero. _(Modo demo — configura tu API key para un plan hecho por Claude.)_"
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
