// ============================================================
// objectives-plan — AI-classified investment goal plan
// ============================================================
// Takes a user's goal (text + horizon + optional target) and returns
// a structured plan: strategy classification + asset allocation +
// suggested monthly aporte + milestones + AI narrative.
//
// Strategy classification logic (deterministic baseline; Claude
// refines the narrative + can nudge the allocation but the base
// is rule-driven so the demo works without an API key):
//   - horizon < 24 months  → conservadora (capital preservation)
//   - horizon 24-72 months → moderada      (balanced)
//   - horizon > 72 months  → agresiva      (growth)
//   - target currency = USD AND horizon < 36 → bump one bucket
//     more conservative (USD short-term needs liquidity, less
//     volatility tolerance)
//
// Request body:
//   {
//     goal: string,            // free-text goal description
//     horizonMonths: number,   // 1-600
//     targetAmount?: number,   // optional
//     targetCurrency?: "ARS" | "USD",
//   }
// Response:
//   {
//     strategy: "conservadora" | "moderada" | "agresiva",
//     allocation: [{ category, pctOfBook }, ...],  // sums to 100
//     monthlyAporte: { amount, currency } | null,  // null if no target given
//     milestones: [{ atMonths, expectedValue, label }, ...],
//     narrative: string,       // 2-3 sentence Claude-written
//     generatedAt: string,
//   }
//
// USER-INITIATED → consumes quota (the wizard's "Generar plan" tap).
//
// HOW TO DEPLOY
//   Mac Terminal: supabase functions deploy objectives-plan \
//     --project-ref diulqkaorfqccipguiok --no-verify-jwt
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const ANTHROPIC_MODEL =
  Deno.env.get("ANTHROPIC_MODEL") ?? "claude-haiku-4-5-20251001";

// Allocation presets per strategy. Sum to 100. Hand-tuned for AR
// retail context (CEDEAR-heavy on growth, BONO-heavy on
// conservadora). Categories match the rest of the app.
type Allocation = { category: string; pctOfBook: number }[];
const PRESETS: Record<string, Allocation> = {
  conservadora: [
    { category: "BONO",   pctOfBook: 50 },
    { category: "ETF",    pctOfBook: 25 },
    { category: "ACCION", pctOfBook: 10 },
    { category: "CEDEAR", pctOfBook: 10 },
    { category: "CRYPTO", pctOfBook: 0  },
    { category: "COMMOD", pctOfBook: 5  },
  ],
  moderada: [
    { category: "BONO",   pctOfBook: 25 },
    { category: "ETF",    pctOfBook: 20 },
    { category: "ACCION", pctOfBook: 20 },
    { category: "CEDEAR", pctOfBook: 25 },
    { category: "CRYPTO", pctOfBook: 5  },
    { category: "COMMOD", pctOfBook: 5  },
  ],
  agresiva: [
    { category: "BONO",   pctOfBook: 5  },
    { category: "ETF",    pctOfBook: 15 },
    { category: "ACCION", pctOfBook: 15 },
    { category: "CEDEAR", pctOfBook: 45 },
    { category: "CRYPTO", pctOfBook: 15 },
    { category: "COMMOD", pctOfBook: 5  },
  ],
};

// Annual return expectations per strategy (USD-equivalent). Used
// to compute the monthly aporte needed to hit the target.
const ANNUAL_RETURN: Record<string, number> = {
  conservadora: 0.06,
  moderada:     0.10,
  agresiva:     0.14,
};

function fetchTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("timeout")), timeoutMs);
    fetch(url, init).then((r) => { clearTimeout(id); resolve(r); }).catch((e) => { clearTimeout(id); reject(e); });
  });
}

function classifyStrategy(horizonMonths: number, targetCurrency?: string): "conservadora" | "moderada" | "agresiva" {
  // Base classification by horizon.
  let s: "conservadora" | "moderada" | "agresiva";
  if (horizonMonths < 24) s = "conservadora";
  else if (horizonMonths <= 72) s = "moderada";
  else s = "agresiva";
  // USD short-term goals → one bucket more conservative.
  if (targetCurrency === "USD" && horizonMonths < 36 && s === "moderada") s = "conservadora";
  if (targetCurrency === "USD" && horizonMonths < 36 && s === "agresiva")  s = "moderada";
  return s;
}

// PMT formula — required monthly contribution to reach `target`
// from 0 in `nMonths` at monthly rate `r`.
//   target = pmt * ((1+r)^n - 1) / r
//   pmt = target * r / ((1+r)^n - 1)
function pmtForGoal(target: number, nMonths: number, annualReturn: number): number {
  if (target <= 0 || nMonths <= 0) return 0;
  const r = annualReturn / 12;
  if (r === 0) return target / nMonths;
  return (target * r) / (Math.pow(1 + r, nMonths) - 1);
}

// FV of a series of monthly contributions at month m.
function fvAtMonth(pmt: number, m: number, annualReturn: number): number {
  if (pmt <= 0 || m <= 0) return 0;
  const r = annualReturn / 12;
  if (r === 0) return pmt * m;
  return pmt * ((Math.pow(1 + r, m) - 1) / r);
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

    const body = await req.json().catch(() => ({}));
    const goal = String(body?.goal || "").trim().slice(0, 200);
    const horizonMonths = Number(body?.horizonMonths) || 0;
    const targetAmount = Number(body?.targetAmount) || null;
    const targetCurrency = body?.targetCurrency === "ARS" ? "ARS"
      : body?.targetCurrency === "USD" ? "USD" : null;

    if (!goal || horizonMonths < 1 || horizonMonths > 600) {
      return new Response(JSON.stringify({ error: "goal + horizonMonths (1-600) required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const strategy = classifyStrategy(horizonMonths, targetCurrency || undefined);
    const allocation = PRESETS[strategy];
    const annualReturn = ANNUAL_RETURN[strategy];

    let monthlyAporte: { amount: number; currency: string } | null = null;
    let milestones: { atMonths: number; expectedValue: number; label: string }[] = [];

    if (targetAmount && targetCurrency) {
      const pmt = pmtForGoal(targetAmount, horizonMonths, annualReturn);
      monthlyAporte = {
        amount: Math.round(pmt * 100) / 100,
        currency: targetCurrency,
      };
      // Milestones at 25%, 50%, 75%, 100% of the horizon.
      const checkpoints = [0.25, 0.5, 0.75, 1.0];
      for (const c of checkpoints) {
        const m = Math.round(horizonMonths * c);
        const fv = fvAtMonth(pmt, m, annualReturn);
        milestones.push({
          atMonths: m,
          expectedValue: Math.round(fv * 100) / 100,
          label: c === 1.0 ? "Meta" : `${Math.round(c * 100)}%`,
        });
      }
    }

    // ----- templated narrative (fallback) -----
    function templatedNarrative(): string {
      const horizonYears = (horizonMonths / 12).toFixed(0);
      const sLabel = strategy === "conservadora" ? "conservadora"
        : strategy === "moderada" ? "moderada" : "agresiva";
      if (targetAmount && monthlyAporte) {
        const ccy = targetCurrency === "USD" ? "US$" : "$";
        return `Tu meta de ${ccy}${targetAmount.toLocaleString("es-AR")} en ${horizonYears} años encaja en una estrategia ${sLabel}. Con ${ccy}${monthlyAporte.amount.toLocaleString("es-AR", { maximumFractionDigits: 0 })} por mes y un retorno esperado de ${(annualReturn * 100).toFixed(0)}% anual, llegás al objetivo.`;
      }
      return `Para una meta de ${horizonYears} años, una estrategia ${sLabel} es lo más razonable. Definí un monto objetivo cuando puedas para que SAMAS calcule cuánto invertir por mes.`;
    }

    let narrative = "";
    if (ANTHROPIC_API_KEY) {
      const userPrompt = [
        `Sos SAMAS, asistente de inversiones para retail argentino. El usuario te plantea una meta de inversión y vas a darle una explicación corta de la estrategia recomendada.`,
        ``,
        `Meta: "${goal}"`,
        `Horizonte: ${horizonMonths} meses (~${(horizonMonths/12).toFixed(1)} años)`,
        targetAmount ? `Monto objetivo: ${targetCurrency} ${targetAmount.toLocaleString("es-AR")}` : `Sin monto objetivo definido`,
        `Estrategia clasificada: ${strategy}`,
        monthlyAporte ? `Aporte mensual sugerido: ${monthlyAporte.currency} ${monthlyAporte.amount.toLocaleString("es-AR", { maximumFractionDigits: 0 })}` : "",
        `Retorno anual esperado para ${strategy}: ${(annualReturn * 100).toFixed(0)}%`,
        ``,
        `Devolvé un JSON con esta forma EXACTA, sin markdown:`,
        `{`,
        `  "narrative": "2-3 oraciones, ≤280 caracteres, en castellano voseo, profesional y sereno"`,
        `}`,
        ``,
        `Reglas:`,
        `- Voseo (vos), profesional, sereno. Cero hype.`,
        `- Mencioná concretamente: el horizonte, la estrategia, el aporte mensual si está calculado.`,
        `- Si no hay monto objetivo, sugerí cómo definirlo (ej. "definí cuánto querés tener al final para calcular el aporte").`,
        `- No des recomendación de comprar/vender activos específicos.`,
      ].filter(Boolean).join("\n");

      try {
        const r = await fetchTimeout("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model: ANTHROPIC_MODEL, max_tokens: 400,
            messages: [{ role: "user", content: userPrompt }],
          }),
        }, 12000);
        if (r.ok) {
          const json = await r.json();
          const text = json?.content?.[0]?.text || "";
          const stripped = text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
          const parsed = JSON.parse(stripped);
          narrative = String(parsed.narrative || "").slice(0, 320);
        }
      } catch (_e) { /* fall back */ }
    }

    if (!narrative) narrative = templatedNarrative();

    return new Response(JSON.stringify({
      strategy,
      allocation,
      monthlyAporte,
      milestones,
      narrative,
      generatedAt: new Date().toISOString(),
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[objectives-plan] threw:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
