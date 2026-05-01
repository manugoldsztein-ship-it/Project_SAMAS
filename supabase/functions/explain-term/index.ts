// ============================================================
// explain-term — AI glossary/dictionary in plain AR-Spanish
// ============================================================
// Takes a term the user typed (e.g. "MEP", "ratio CEDEAR",
// "stop-loss", "idóneo") and returns a 2-3 sentence definition
// tailored to AR retail context (voseo, no jargon-explaining-jargon,
// concrete examples).
//
// USER-INITIATED → consumes quota. Templated fallback when no API
// key — covers ~25 of the most common AR-retail terms hard-coded.
//
// Request body: { term: string, context?: string }
//   context is optional — caller can pass a sentence the term
//   appeared in, helps the LLM disambiguate (e.g. "ratio" alone is
//   ambiguous; "ratio CEDEAR" is specific).
//
// Response:
//   {
//     term:        string,    // echoed
//     definition:  string,    // 2-3 sentences, voseo, AR
//     example:     string,    // optional concrete example, may be ""
//     related:     string[],  // 0-3 related terms the user might also want to look up
//     generatedAt: string,
//   }
//
// HOW TO DEPLOY
//   Mac Terminal: supabase functions deploy explain-term \
//     --project-ref diulqkaorfqccipguiok --no-verify-jwt
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
};

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const ANTHROPIC_MODEL =
  Deno.env.get("ANTHROPIC_MODEL") ?? "claude-haiku-4-5-20251001";

// Templated glossary — covers the most common AR retail terms so
// the demo works without an Anthropic key. Keys are normalized
// (lowercase, no accents). Values are { definition, example, related }.
const TEMPLATED: Record<string, { definition: string; example: string; related: string[] }> = {
  "cedear": {
    definition: "Certificado de Depósito Argentino. Cotiza en BYMA y representa una acción de una empresa extranjera (típicamente listada en NYSE/Nasdaq). Te da exposición al precio de la acción extranjera operando desde tu cuenta en pesos.",
    example: "Comprar el CEDEAR de AAPL te da exposición al precio de la acción de Apple sin tener que abrir cuenta en EE.UU.",
    related: ["ratio CEDEAR", "MEP", "ALyC"],
  },
  "ratio cedear": {
    definition: "Cuántos certificados argentinos equivalen a una acción real del exterior. AAPL tiene ratio 20:1 — necesitás 20 CEDEARs para tener una acción de Apple equivalente. El precio del CEDEAR ya está ajustado por el ratio.",
    example: "Si AAPL cotiza a US$200 en NYSE y el ratio es 20:1, el CEDEAR debería cotizar cerca de US$10 más conversión.",
    related: ["CEDEAR", "MEP"],
  },
  "mep": {
    definition: "Dólar MEP (Mercado Electrónico de Pagos). Tipo de cambio implícito que surge de comprar un bono en pesos y venderlo en dólares dentro de la misma operación. Es legal y es el dólar de referencia para CEDEARs y bonos.",
    example: "Si AL30 cotiza a $50.000 en pesos y a US$50 en dólares, el dólar MEP implícito es $1.000.",
    related: ["dólar oficial", "CCL", "AL30"],
  },
  "ccl": {
    definition: "Contado con Liquidación. Tipo de cambio implícito de comprar un activo en pesos en BYMA y venderlo en dólares en el exterior (NYSE típicamente). Suele estar levemente arriba del MEP por el costo de transferencia de títulos.",
    example: "Si comprás GD30 en BYMA y lo vendés en NYSE para sacar dólares afuera, el tipo de cambio implícito es el CCL.",
    related: ["MEP", "dólar oficial", "GD30"],
  },
  "alyc": {
    definition: "Agente de Liquidación y Compensación. Es un broker registrado y regulado por la CNV. Es el intermediario que ejecuta las órdenes en BYMA, custodia los títulos y reporta a AFIP. Cohen, IOL, Cocos, Bull, Balanz son ALyCs.",
    example: "Cuando comprás un CEDEAR en SAMAS, la operación se ejecuta a través de la ALyC integrada (Cohen, en producción).",
    related: ["CNV", "BYMA", "Caja de Valores"],
  },
  "cnv": {
    definition: "Comisión Nacional de Valores. Es el regulador del mercado de capitales argentino. Autoriza brokers, fondos, emisores y supervisa que cumplan la ley.",
    example: "Para operar en bolsa el broker tiene que estar registrado en la CNV. El idóneo CNV es la persona física certificada para asesorar.",
    related: ["ALyC", "idóneo CNV", "BYMA"],
  },
  "idoneo": {
    definition: "Persona certificada por la CNV para asesorar sobre productos financieros. Pasó un examen y está en el registro público. En SAMAS los usuarios verificados como idóneos tienen un check azul en el feed social.",
    example: "Si querés recomendaciones formales necesitás hablar con un idóneo CNV. Cualquiera puede opinar; solo el idóneo puede asesorar.",
    related: ["CNV", "ALyC"],
  },
  "idoneo cnv": {
    definition: "Persona certificada por la CNV para asesorar sobre productos financieros. Pasó un examen y está en el registro público. En SAMAS los usuarios verificados como idóneos tienen un check azul en el feed social.",
    example: "Si querés recomendaciones formales necesitás hablar con un idóneo CNV. Cualquiera puede opinar; solo el idóneo puede asesorar.",
    related: ["CNV", "ALyC"],
  },
  "stop loss": {
    definition: "Orden automática que vende tu posición cuando el precio cae a un nivel que vos defiis. Sirve para limitar pérdidas si la tesis se rompe y vos no estás mirando la pantalla.",
    example: "Comprás NVDA a US$890 y ponés un stop-loss en US$800. Si baja a 800 se vende automático y limitás la pérdida a ~10%.",
    related: ["take profit", "limit order", "market order"],
  },
  "stop-loss": {
    definition: "Orden automática que vende tu posición cuando el precio cae a un nivel que vos definís. Sirve para limitar pérdidas si la tesis se rompe y vos no estás mirando la pantalla.",
    example: "Comprás NVDA a US$890 y ponés un stop-loss en US$800. Si baja a 800 se vende automático y limitás la pérdida a ~10%.",
    related: ["take profit", "orden límite", "orden mercado"],
  },
  "orden mercado": {
    definition: "Orden que se ejecuta inmediatamente al mejor precio disponible en el libro. Garantiza ejecución pero no precio — si el activo es ilíquido podés terminar pagando arriba del último cierre.",
    example: "Compra mercado de 10 GGAL: se ejecuta al toque al mejor ask del libro, sea cual sea.",
    related: ["orden límite", "stop-loss", "spread"],
  },
  "orden limite": {
    definition: "Orden que solo se ejecuta si el precio toca el nivel que vos definís. Garantiza precio pero no ejecución — si el mercado nunca llega a tu límite, la orden queda pendiente.",
    example: "Compra límite de 10 GGAL a $4.000: la orden queda pendiente hasta que alguien venda a 4.000 o menos.",
    related: ["orden mercado", "stop-loss"],
  },
  "byma": {
    definition: "Bolsas y Mercados Argentinos. Es la bolsa argentina, donde se operan acciones, CEDEARs, bonos y opciones. Sucesora del Merval como infraestructura de mercado.",
    example: "Cuando comprás GGAL o un CEDEAR de AAPL, la orden se ejecuta en BYMA.",
    related: ["MERVAL", "Caja de Valores", "ALyC"],
  },
  "merval": {
    definition: "Índice referencial de las acciones argentinas líderes. Es el equivalente local del S&P 500 — mide el desempeño promedio del mercado de acciones argentinas.",
    example: "Si el MERVAL sube 2% hoy, las acciones argentinas en promedio subieron 2%.",
    related: ["BYMA", "ACCION"],
  },
  "drawdown": {
    definition: "Caída desde el pico más reciente. Si tu posición valía US$1.000 y ahora vale US$700, tu drawdown es 30%. Es la métrica clásica de cuánto está sufriendo una posición vs. su mejor momento.",
    example: "BTC tuvo un drawdown del 50% en 2022 desde el pico de noviembre 2021.",
    related: ["volatilidad", "riesgo"],
  },
  "tesis": {
    definition: "La razón concreta por la que comprás un activo. Una buena tesis es específica, falsable y temporal — dice qué tendría que pasar para confirmarla y qué tendría que pasar para romperla.",
    example: "Mala tesis: 'Apple es buena empresa'. Buena tesis: 'AAPL reporta el viernes y los servicios crecen 14% YoY; si confirma, puede empujar 5%+'.",
    related: ["validar tesis", "drawdown"],
  },
  "ratio": {
    definition: "Sin contexto el término es ambiguo. Puede ser ratio CEDEAR (cuántos certificados equivalen a una acción), ratio P/E (precio sobre ganancias), ratio de Sharpe (retorno sobre riesgo). ¿Cuál te interesa?",
    example: "",
    related: ["ratio CEDEAR", "P/E", "Sharpe"],
  },
  "p/e": {
    definition: "Price-to-Earnings ratio. Cuántas veces ganancia anual de la empresa estás pagando por la acción. P/E de 20 = pagás 20 años de ganancias actuales. Bajo = barato relativo a sus ganancias; alto = caro o creciendo rápido.",
    example: "Apple cotiza a P/E ~28. Tesla cotizó a P/E 150+ en su pico. Un P/E bajo no significa que sea buena compra.",
    related: ["EPS", "P/B", "fundamentos"],
  },
  "sharpe": {
    definition: "Sharpe ratio. Mide cuánto retorno extra obtenés por cada unidad de riesgo que tomás. Sharpe arriba de 1 es bueno, arriba de 2 es excelente, abajo de 0 significa que perdiste plata ajustada a riesgo.",
    example: "Una cartera con 8% retorno y 10% volatilidad tiene Sharpe ~0.8 (asumiendo tasa libre de riesgo 0). Otra con 12% retorno y 30% volatilidad tiene Sharpe 0.4 — peor pese a más retorno absoluto.",
    related: ["volatilidad", "beta"],
  },
  "beta": {
    definition: "Sensibilidad de un activo al mercado. Beta 1 = se mueve igual que el índice de referencia. Beta 1.5 = amplifica los movimientos del mercado en 50%. Beta 0.5 = se mueve la mitad. Beta negativo = inverso al mercado.",
    example: "TSLA típicamente tiene beta 2+ (muy sensible). KO suele tener beta 0.6 (defensiva). El oro tiene beta cerca de 0.",
    related: ["volatilidad", "Sharpe"],
  },
  "volatilidad": {
    definition: "Cuánto se mueve el precio del activo, típicamente medido como desviación estándar anualizada de los retornos diarios. Más volatilidad = más swings = más riesgo de drawdown grande, pero también más oportunidad de retorno.",
    example: "Bonos tienen volatilidad ~5%. Acciones argentinas ~30%. Cripto ~80%+. Lo mismo no es lo mismo arriba que abajo.",
    related: ["beta", "Sharpe", "drawdown"],
  },
  "afip": {
    definition: "Administración Federal de Ingresos Públicos. Es el organismo que cobra impuestos en Argentina. Tu broker (ALyC) reporta tus operaciones a AFIP automáticamente.",
    example: "Cuando vendés con ganancia, AFIP te cobra impuesto cedular del 15% (regla simplificada). El broker hace la retención.",
    related: ["impuesto cedular", "ALyC"],
  },
  "impuesto cedular": {
    definition: "Impuesto a las ganancias de capital sobre activos financieros para personas físicas residentes. La regla simplificada es 15% sobre ganancias en moneda extranjera (USD-sourced) y 5% sobre ganancias en pesos. El ALyC retiene.",
    example: "Comprás AAPL a US$100, vendés a US$120. Ganancia de US$20 → impuesto cedular ~US$3.",
    related: ["AFIP", "ALyC", "tax-loss"],
  },
  "tax-loss": {
    definition: "Tax-loss harvesting. Vender una posición perdedora antes del cierre del año fiscal para crystallizar la pérdida y compensar ganancias realizadas en otras posiciones, reduciendo el impuesto cedular.",
    example: "Si ganaste US$1000 vendiendo AAPL pero NVDA está -US$500, vender NVDA antes del 31/12 te hace pagar impuesto sobre US$500 (no 1000).",
    related: ["impuesto cedular", "drawdown"],
  },
  "spread": {
    definition: "Diferencia entre la mejor punta compradora (bid) y la mejor punta vendedora (ask) en el libro de órdenes. Spread chico = activo líquido, fácil entrar y salir. Spread grande = activo ilíquido, costo implícito al operar.",
    example: "GGAL típicamente tiene spread de 0.1%. Un CEDEAR poco operado puede tener spread de 1-2% — esa diferencia la perdés en cada round-trip.",
    related: ["liquidez", "orden mercado"],
  },
  "ggal": {
    definition: "Grupo Financiero Galicia. Holding del Banco Galicia. Es una de las acciones argentinas más operadas (alta liquidez) y suele moverse junto al MERVAL.",
    example: "GGAL es típicamente top-3 por volumen en BYMA. La cotización en pesos puede ser muy distinta a la del ADR (GGAL US) por la brecha cambiaria.",
    related: ["MERVAL", "ACCION", "ADR"],
  },
};

function normalize(s: string): string {
  // Strip combining diacritics after NFD decomposition. \p{M} is the
  // Unicode "Mark" category — matches any combining mark, more robust
  // than a literal U+0300..U+036F range.
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").trim();
}

function fetchTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    fetch(url, init).then((r) => { clearTimeout(id); resolve(r); }).catch((e) => { clearTimeout(id); reject(e); });
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
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
      bucket: buildBucket("explain-term", { userId: user.id }),
      ...RATE_LIMITS.AI,
    });
    if (!_rl.allowed) return rateLimit429(_rl, corsHeaders);

    let _body: unknown;
    try {
      _body = await readJsonBody(req);
    } catch (e) {
      const ve = validationErrorResponse(e, corsHeaders);
      if (ve) return ve;
      throw e;
    }
    const body = _body as Record<string, unknown>;
    const term = String(body?.term || "").trim();
    const context = String(body?.context || "").trim();
    if (!term || term.length > 80) {
      return new Response(JSON.stringify({ error: "term required (1-80 chars)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // --- LLM path (or templated) ---
    if (!ANTHROPIC_API_KEY) {
      const norm = normalize(term);
      const hit = TEMPLATED[norm];
      if (hit) {
        return new Response(JSON.stringify({
          term, ...hit,
          generatedAt: new Date().toISOString(),
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // Unknown term, no API key → soft fallback
      return new Response(JSON.stringify({
        term,
        definition: `No tengo una definición precargada para "${term}". Activá la API de Claude para que SAMAS pueda explicar cualquier término.`,
        example: "",
        related: [],
        generatedAt: new Date().toISOString(),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const userPrompt = [
      `Sos SAMAS, asistente de inversiones para retail argentino. Un usuario te pregunta qué significa un término financiero. Respondé en castellano voseo argentino, claro y concreto.`,
      ``,
      `Término: "${term}"`,
      context ? `Contexto donde aparece: "${context.slice(0, 300)}"` : "",
      ``,
      `Devolvé un JSON con esta forma EXACTA, sin markdown:`,
      `{`,
      `  "definition": "2-3 oraciones, máximo 280 caracteres total. Explicá el concepto sin usar más jargon.",`,
      `  "example":    "1 oración con un ejemplo concreto en contexto AR (puede ser numérico). Si no aplica, devolvé string vacío.",`,
      `  "related":    ["array de 0 a 3 términos relacionados que el usuario podría querer mirar después"]`,
      `}`,
      ``,
      `Reglas:`,
      `- Voseo (vos), profesional, sereno. Cero hype, cero emojis.`,
      `- Si el término es ambiguo (ej. "ratio" sin contexto), aclaralo en definition y dejá related con las posibles interpretaciones.`,
      `- Si es un ticker (ej. "GGAL", "AAPL"), describí brevemente la empresa + categoría (CEDEAR / acción AR / cripto / ETF / bono).`,
      `- Si no es un término financiero o no podés explicarlo razonablemente, devolvé definition diciendo que no aplica.`,
      `- example debe ser concreto y aterrizado a AR — usá pesos / USD según corresponda, mencioná tickers reales si aporta.`,
      `- No des recomendación de comprar / vender.`,
    ].filter(Boolean).join("\n");

    let definition = "";
    let example = "";
    let related: string[] = [];
    try {
      const r = await fetchTimeout("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: ANTHROPIC_MODEL, max_tokens: 600,
          messages: [{ role: "user", content: userPrompt }],
        }),
      }, 12000);
      if (r.ok) {
        const json = await r.json();
        const text = json?.content?.[0]?.text || "";
        const stripped = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
        const parsed = JSON.parse(stripped);
        definition = String(parsed.definition || "").slice(0, 360);
        example = String(parsed.example || "").slice(0, 240);
        if (Array.isArray(parsed.related)) {
          related = parsed.related.map((s: unknown) => String(s).slice(0, 60)).slice(0, 3);
        }
      }
    } catch (_e) { /* fall through to templated */ }

    if (!definition) {
      const norm = normalize(term);
      const hit = TEMPLATED[norm];
      if (hit) {
        definition = hit.definition;
        example = hit.example;
        related = hit.related;
      } else {
        definition = `No pude generar una definición para "${term}" en este momento. Probá de nuevo en un rato.`;
      }
    }

    return new Response(JSON.stringify({
      term,
      definition,
      example,
      related,
      generatedAt: new Date().toISOString(),
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[explain-term] threw:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
