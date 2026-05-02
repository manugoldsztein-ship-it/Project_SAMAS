// ============================================================
// analyze-asset — Claude-generated insight for a single ticker
// ============================================================
// Twin of analyze-portfolio (0.0.83) but scoped to one asset.
// Triggered from AssetSheet's "Análisis IA" card when the user
// taps a ticker (NVDA / GGAL / AL30 / etc).
//
// Request body:  { ticker: string }
// Response:
//   {
//     headline:    string,            // one-line summary
//     bullets:     string[],          // 3 observations (fundamentals / news / technicals)
//     thesis:      string,            // concrete takeaway / decision support
//     sentiment:   "bullish" | "neutral" | "bearish",
//     generatedAt: string,
//   }
//
// FALLBACK
//   If ANTHROPIC_API_KEY isn't set, we build a templated insight
//   from the asset's static metadata (price, changePct, category)
//   so the demo works without an LLM call.
//
// HOW TO DEPLOY
//   Mac Terminal: supabase functions deploy analyze-asset
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  consumeRateLimit, RATE_LIMITS, buildBucket, rateLimit429, makeAdminClient,
} from "../_shared/rate-limit.ts";
import {
  readJsonBody, sanitizeString, validationErrorResponse,
} from "../_shared/validate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  // samas-0.4.18 security headers
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const ANTHROPIC_MODEL =
  Deno.env.get("ANTHROPIC_MODEL") ?? "claude-haiku-4-5-20251001";

// Asset universe — copy of broker.js ASSETS. Keep in sync by hand.
const ASSETS: Record<string, {
  name: string;
  category: string;
  currency: string;
  price: number;
  changePct: number;
}> = {
  AAPL: { name: "Apple",            category: "CEDEAR", currency: "USD", price: 215.40, changePct:  1.84 },
  NVDA: { name: "NVIDIA",           category: "CEDEAR", currency: "USD", price: 892.15, changePct:  4.21 },
  TSLA: { name: "Tesla",            category: "CEDEAR", currency: "USD", price: 248.30, changePct: -1.20 },
  MSFT: { name: "Microsoft",        category: "CEDEAR", currency: "USD", price: 432.10, changePct:  0.74 },
  GOOGL:{ name: "Alphabet",         category: "CEDEAR", currency: "USD", price: 184.20, changePct:  1.12 },
  GGAL: { name: "Grupo Galicia",    category: "ACCION", currency: "ARS", price: 4250,   changePct: -2.10 },
  YPF:  { name: "YPF",              category: "ACCION", currency: "ARS", price: 38500,  changePct:  3.45 },
  PAMP: { name: "Pampa Energía",    category: "ACCION", currency: "ARS", price: 5820,   changePct:  0.92 },
  IBIT:  { name: "iShares Bitcoin Trust", category: "CEDEAR", currency: "USD", price: 62.4, changePct: 0.9 },
  COIN:  { name: "Coinbase", category: "CEDEAR", currency: "USD", price: 247.3, changePct: 2.8 },
  MSTR:  { name: "MicroStrategy", category: "CEDEAR", currency: "USD", price: 358.4, changePct: 3.4 },
  MARA:  { name: "Marathon Digital", category: "CEDEAR", currency: "USD", price: 18.2, changePct: -1.2 },
  RIOT:  { name: "Riot Platforms", category: "CEDEAR", currency: "USD", price: 11.85, changePct: -0.8 },
  AL30: { name: "Bonar 2030",       category: "BONO",   currency: "USD", price: 56.70,  changePct:  0.40 },
  MMARS:  { name: "SAMAS Money Market ARS", category: "FCI", currency: "ARS", price: 100.42, changePct: 0.18 },
  MMUSD:  { name: "SAMAS Money Market USD", category: "FCI", currency: "USD", price: 102.18, changePct: 0.01 },
  RFAR:  { name: "SAMAS Renta Fija", category: "FCI", currency: "USD", price: 105.83, changePct: 0.04 },
  MIXTO:  { name: "SAMAS Mixta", category: "FCI", currency: "USD", price: 112.4, changePct: 0.32 },
  EQUITY:  { name: "SAMAS Renta Variable", category: "FCI", currency: "USD", price: 128.95, changePct: 0.84 },
  SPY:  { name: "S&P 500 ETF",      category: "ETF",    currency: "USD", price: 512.40, changePct:  0.62 },
  QQQ:  { name: "Nasdaq-100 ETF",   category: "ETF",    currency: "USD", price: 431.20, changePct:  0.88 },
  IWM:  { name: "Russell 2000 ETF", category: "ETF",    currency: "USD", price: 218.65, changePct: -0.34 },
  EWZ:  { name: "Brasil ETF",       category: "ETF",    currency: "USD", price:  29.40, changePct:  1.05 },
  GLD:  { name: "Oro (SPDR Gold)",  category: "COMMOD", currency: "USD", price: 228.60, changePct:  1.24 },
  SLV:  { name: "Plata (iShares)",  category: "COMMOD", currency: "USD", price:  27.85, changePct: -0.51 },
  USO:  { name: "Petróleo (USO)",   category: "COMMOD", currency: "USD", price:  81.30, changePct: -0.72 },
};

const CATEGORY_LABEL: Record<string, string> = {
  CEDEAR: "CEDEAR (acción extranjera)",
  ACCION: "acción argentina",
  BONO:   "bono soberano",
  ETF:    "ETF",
  COMMOD: "commodity",
};

function fetchTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    fetch(url, init).then((r) => { clearTimeout(id); resolve(r); }).catch((e) => { clearTimeout(id); reject(e); });
  });
}

// Templated insight — used when ANTHROPIC_API_KEY isn't set. Reads
// the asset's static metadata + a small per-ticker thesis library
// (curated below) to produce something demo-quality without an LLM.
function templatedInsight(ticker: string, meta: {
  name: string; category: string; currency: string; price: number; changePct: number;
}) {
  const upDay = meta.changePct >= 0;
  const sentiment: "bullish" | "neutral" | "bearish" =
    meta.changePct >  1.5 ? "bullish" :
    meta.changePct < -1.5 ? "bearish" : "neutral";
  const cat = CATEGORY_LABEL[meta.category] || meta.category.toLowerCase();

  // Curated per-ticker bullets. When the LLM isn't available these
  // give the demo flavor instead of generic boilerplate. Keep each
  // bullet short — 90 chars max — so the UI doesn't wrap awkwardly.
  const PER_TICKER: Record<string, { thesis: string; bullets: string[] }> = {
    AAPL: { thesis: "Servicios siguen creciendo doble dígito; el iPhone 17 fue bien recibido en China.",
            bullets: ["Margen bruto en Servicios sostenido sobre 70%, mejor mix de la última década.",
                      "Buyback agresivo: ~US$110B autorizados en 2025 mantienen el EPS al alza.",
                      "Riesgo principal: regulación antitrust del App Store en EU + EE.UU."] },
    NVDA: { thesis: "Sigue siendo el motor del CapEx de IA — earnings de mayo el catalizador clave.",
            bullets: ["Ingreso de Datacenter creció 78% YoY en el último trimestre.",
                      "Backlog de Blackwell extendido hasta H2 2026 según último call.",
                      "Multiplo elevado (~38x fwd) deja poco margen si entregas decepcionan."] },
    TSLA: { thesis: "Margen automotor bajo presión; Robotaxi sigue siendo la apuesta de upside.",
            bullets: ["Rebajas de precio en China comprimieron margen bruto auto a 17.6%.",
                      "Optimus + FSD v13 son las cartas de upside para 2026.",
                      "Riesgo regulatorio NHTSA sigue abierto sobre Autopilot."] },
    MSFT: { thesis: "Azure AI consumiendo CapEx récord — la métrica clave es ingresos por $1 invertido.",
            bullets: ["Azure creció 33% en el último trimestre, 12pp por IA.",
                      "Copilot adoption en Office 365: ~70% del base enterprise probó el feature.",
                      "CapEx 2026 estimado en US$80B — vigilar ROIC."] },
    GOOGL:{ thesis: "Search bajo presión por AI assistants, pero YouTube + Cloud compensan.",
            bullets: ["Cloud finalmente rentable: margen operativo 17% (vs -10% hace 2 años).",
                      "Gemini 2 cerró brecha con GPT-5 según benchmarks públicos.",
                      "Antitrust DOJ: el caso de búsqueda podría forzar desinversiones en 2027."] },
    GGAL: { thesis: "Beneficiada por desinflación y desregulación financiera del gobierno actual.",
            bullets: ["ROE últimos 12m: 28% — el más alto del sistema bancario AR.",
                      "Cartera de préstamos creciendo doble dígito real por primera vez en 5 años.",
                      "Riesgo: vuelta al cepo o cambio político en 2027 elecciones."] },
    YPF:  { thesis: "Vaca Muerta sigue sorprendiendo; producción 2026 podría romper récords históricos.",
            bullets: ["Producción shale Q1: 95K bbl/d, +30% YoY.",
                      "GNL plant en Bahía Blanca arranca operaciones H1 2026.",
                      "Beta alta vs ARS — un salto cambiario impacta inmediato."] },
    PAMP: { thesis: "Negocio diversificado (electricidad + gas + petróleo) protege en ciclos volátiles.",
            bullets: ["Generación eléctrica: 3,500 MW instalados, ~10% del SADI.",
                      "Sector hidrocarburos creciendo en Loma Campana + Rincón de Aranda.",
                      "Dividendo recurrente: ~5% yield estimado para 2026."] },
    // BTC + ETH per-ticker thesis entries removed in samas-0.4.21 —
    // Cohen doesn't operate crypto so they're never queried.
    AL30: { thesis: "Bono dolar más líquido del menú AR. Carry alto si la curva sigue normalizándose.",
            bullets: ["Yield al vencimiento: ~12% USD a precios actuales.",
                      "Argentina pagó cupón enero sin demora — credibilidad recuperándose.",
                      "Riesgo: rollover 2027 sigue siendo el muro de pagos a vigilar."] },
    SPY:  { thesis: "Exposición core al mercado US — diversificación instantánea en una compra.",
            bullets: ["P/E forward: ~22x — por encima del promedio histórico de 18x.",
                      "Concentración top-10: Mag 7 ya pesa ~32% del índice.",
                      "Para AR retail, vehículo más simple para dolarizar via CEDEAR."] },
    QQQ:  { thesis: "Tech-heavy versión del S&P. Mayor beta, más sensible a tasas y ciclo IA.",
            bullets: ["Top 5 holdings (AAPL/MSFT/NVDA/AMZN/META) = ~45% del fondo.",
                      "Volatilidad histórica 30% mayor que SPY.",
                      "Vehículo natural si tu tesis es 'IA va a seguir siendo el driver'."] },
  };

  const curated = PER_TICKER[ticker];
  const headline = upDay
    ? `${meta.name} sube ${meta.changePct.toFixed(1)}% hoy — ${cat} con momentum.`
    : `${meta.name} cede ${Math.abs(meta.changePct).toFixed(1)}% hoy — ${cat} bajo presión.`;
  const bullets = curated?.bullets || [
    `Precio actual: ${meta.currency === "USD" ? "US$" : "$"}${meta.price.toLocaleString("es-AR")}.`,
    `Categoría: ${cat}, moneda ${meta.currency}.`,
    upDay ? "Cierre de jornada en verde." : "Cierre de jornada en rojo.",
  ];
  const thesis = curated?.thesis || `${meta.name} está clasificado como ${cat}; revisá tus objetivos antes de operar.`;

  return {
    headline:    headline.slice(0, 200),
    bullets:     bullets.map((b) => b.slice(0, 200)),
    thesis:      thesis.slice(0, 240),
    sentiment,
    generatedAt: new Date().toISOString(),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // --- auth gate ---
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) {
      return new Response(JSON.stringify({ error: "missing token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await userClient.auth.getUser(jwt);
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- rate limit (samas-0.4.17): AI tier ---
    const _rl = await consumeRateLimit(makeAdminClient(), {
      bucket: buildBucket("analyze-asset", { userId: user.id }),
      ...RATE_LIMITS.AI,
    });
    if (!_rl.allowed) return rateLimit429(_rl, corsHeaders);

    // --- parse + validate ticker ---
    let _body: unknown;
    try {
      _body = await readJsonBody(req);
    } catch (e) {
      const ve = validationErrorResponse(e, corsHeaders);
      if (ve) return ve;
      throw e;
    }
    const body = _body as Record<string, unknown>;
    const tickerRaw = String(body?.ticker || "").trim().toUpperCase();
    if (!tickerRaw) {
      return new Response(JSON.stringify({ error: "ticker requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const meta = ASSETS[tickerRaw];
    if (!meta) {
      return new Response(JSON.stringify({ error: `ticker desconocido: ${tickerRaw}` }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- LLM path (or templated fallback) ---
    if (!ANTHROPIC_API_KEY) {
      console.log(`[analyze-asset] no API key — templated insight for ${tickerRaw}`);
      return new Response(JSON.stringify(templatedInsight(tickerRaw, meta)), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userPrompt = [
      `Analizá el activo ${tickerRaw} (${meta.name}) para un inversor argentino retail. Devolvé un JSON con esta forma EXACTA, sin markdown:`,
      `{`,
      `  "headline": "una línea, máximo 90 caracteres, en español",`,
      `  "bullets": ["3 observaciones cortas — fundamentos, novedades recientes, valuación — cada una máximo 100 caracteres, en español"],`,
      `  "thesis": "una frase concreta de tesis o takeaway, máximo 200 caracteres, en español",`,
      `  "sentiment": "bullish" | "neutral" | "bearish"`,
      `}`,
      ``,
      `Reglas:`,
      `- Profesional pero cercano (vos, no usted).`,
      `- Cero hype, cero términos en inglés innecesarios.`,
      `- No des recomendación de compra/venta directa; sí podés hablar de tesis, valuación, riesgos.`,
      `- No uses emojis.`,
      ``,
      `Datos del activo:`,
      `- Nombre: ${meta.name}`,
      `- Categoría: ${CATEGORY_LABEL[meta.category] || meta.category}`,
      `- Moneda: ${meta.currency}`,
      `- Precio actual: ${meta.price}`,
      `- Variación día: ${meta.changePct.toFixed(2)}%`,
    ].join("\n");

    const r = await fetchTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 700,
        messages: [{ role: "user", content: userPrompt }],
      }),
    }, 15000);

    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      console.warn(`[analyze-asset] anthropic ${r.status}:`, txt.slice(0, 300));
      // Soft-fail to templated — better than a hard error during a demo.
      return new Response(JSON.stringify(templatedInsight(tickerRaw, meta)), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const json = await r.json();
    const text = json?.content?.[0]?.text || "";
    const stripped = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
    let parsed: {
      headline?: string;
      bullets?: string[];
      thesis?: string;
      sentiment?: string;
    };
    try {
      parsed = JSON.parse(stripped);
    } catch {
      console.warn("[analyze-asset] non-JSON response:", text.slice(0, 200));
      return new Response(JSON.stringify(templatedInsight(tickerRaw, meta)), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sentiment = ["bullish", "neutral", "bearish"].includes(parsed.sentiment || "")
      ? (parsed.sentiment as "bullish" | "neutral" | "bearish")
      : "neutral";

    return new Response(JSON.stringify({
      headline:    String(parsed.headline || "").slice(0, 200),
      bullets:     Array.isArray(parsed.bullets) ? parsed.bullets.map((b) => String(b).slice(0, 200)).slice(0, 5) : [],
      thesis:      String(parsed.thesis || "").slice(0, 240),
      sentiment,
      generatedAt: new Date().toISOString(),
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[analyze-asset] threw:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
