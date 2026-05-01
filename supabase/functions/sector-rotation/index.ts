// ============================================================
// sector-rotation — IA sector rotation analysis
// ============================================================
// Reads the user's holdings, computes sector mix (CEDEAR / ACCION /
// CRYPTO / ETF / BONO / COMMOD), compares against three pre-set
// macro stances, and asks Claude to suggest concrete tilts.
//
// Distinct from rebalance-portfolio (0.1.4):
//   - Rebalance = TOTAL portfolio rebalance to a target risk profile
//     (conservador / equilibrado / agresivo) with concrete buy/sell
//     orders. Granular, ticker-level.
//   - Sector rotation = sector-level macro view. "Tu cartera está
//     60% tech, considerá energía o financials." No specific
//     orders — direction-only.
//
// The two complement: sector rotation tells you WHERE to look,
// rebalance tells you HOW to execute when you've decided.
//
// Stance presets (deterministic baseline — Claude refines the
// rationale, doesn't change the targets):
//   - "growth"      : tech/CEDEAR heavy, crypto OK, light bonds
//   - "balanced"    : mix CEDEAR + ACCION + ETF + some BONO
//   - "defensive"   : ACCION (utilities/cash-flow), heavy BONO,
//                     light tech
//
// Request body: { stance: "growth" | "balanced" | "defensive" }
//   defaults to "balanced".
// Response:
//   {
//     stance: "balanced",
//     currentMix:  [{ sector, pctOfBook }, ...],
//     targetMix:   [{ sector, pctOfBook }, ...],
//     deltas:      [{ sector, currentPct, targetPct, action: "increase" | "trim" | "hold" }, ...],
//     summary:     string,    // 1-2 sentences
//     suggestions: string[],  // 2-3 actionable lines, voseo
//     generatedAt: string,
//   }
//
// HOW TO DEPLOY
//   Mac Terminal: supabase functions deploy sector-rotation \
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

const ASSETS: Record<string, { name: string; category: string; currency: string; price: number; }> = {
  AAPL:  { name: "Apple",            category: "CEDEAR", currency: "USD", price: 215.40 },
  NVDA:  { name: "NVIDIA",           category: "CEDEAR", currency: "USD", price: 892.15 },
  TSLA:  { name: "Tesla",            category: "CEDEAR", currency: "USD", price: 248.30 },
  MSFT:  { name: "Microsoft",        category: "CEDEAR", currency: "USD", price: 432.10 },
  GOOGL: { name: "Alphabet",         category: "CEDEAR", currency: "USD", price: 184.20 },
  META:  { name: "Meta Platforms",   category: "CEDEAR", currency: "USD", price: 568.40 },
  AMZN:  { name: "Amazon",           category: "CEDEAR", currency: "USD", price: 198.20 },
  KO:    { name: "Coca-Cola",        category: "CEDEAR", currency: "USD", price: 71.10 },
  GGAL:  { name: "Grupo Galicia",    category: "ACCION", currency: "ARS", price: 4250 },
  YPF:   { name: "YPF",              category: "ACCION", currency: "ARS", price: 38500 },
  PAMP:  { name: "Pampa Energía",    category: "ACCION", currency: "ARS", price: 5820 },
  ALUA:  { name: "Aluar",            category: "ACCION", currency: "ARS", price: 1180 },
  BTC:   { name: "Bitcoin",          category: "CRYPTO", currency: "USD", price: 67400 },
  ETH:   { name: "Ethereum",         category: "CRYPTO", currency: "USD", price: 3580 },
  SPY:   { name: "S&P 500 ETF",      category: "ETF",    currency: "USD", price: 542.30 },
  QQQ:   { name: "Nasdaq-100 ETF",   category: "ETF",    currency: "USD", price: 478.20 },
  AL30:  { name: "Bonar 2030",       category: "BONO",   currency: "USD", price: 58.30 },
  GD30:  { name: "Global 2030",      category: "BONO",   currency: "USD", price: 56.10 },
  GLD:   { name: "Oro (SPDR Gold)",  category: "COMMOD", currency: "USD", price: 228.60 },
};

const ARS_TO_USD = 1 / 1245;

const SECTORS = ["CEDEAR", "ACCION", "ETF", "BONO", "CRYPTO", "COMMOD"] as const;
type Sector = typeof SECTORS[number];

// Target mixes per stance — must sum to 100. Hand-tuned so each
// stance reads as a coherent macro thesis, not random buckets.
const STANCES: Record<string, Record<Sector, number>> = {
  growth: {
    CEDEAR: 45, ACCION: 10, ETF: 15, BONO: 5,  CRYPTO: 20, COMMOD: 5,
  },
  balanced: {
    CEDEAR: 30, ACCION: 20, ETF: 20, BONO: 15, CRYPTO: 10, COMMOD: 5,
  },
  defensive: {
    CEDEAR: 15, ACCION: 25, ETF: 10, BONO: 35, CRYPTO: 5,  COMMOD: 10,
  },
};

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

    const body = await req.json().catch(() => ({}));
    const stance = (body?.stance && STANCES[body.stance]) ? body.stance : "balanced";
    const targetMix = STANCES[stance];

    // --- read holdings ---
    const { data: rawHoldings } = await userClient
      .from("holdings").select("ticker, qty").gt("qty", 0);
    const holdings = rawHoldings || [];

    if (holdings.length === 0) {
      return new Response(JSON.stringify({
        stance,
        currentMix: [],
        targetMix: SECTORS.map((s) => ({ sector: s, pctOfBook: targetMix[s] })),
        deltas: [],
        summary: "Sin posiciones todavía. Acá te muestro el mix sugerido para que lo uses como referencia cuando empieces.",
        suggestions: [],
        generatedAt: new Date().toISOString(),
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let totalUsd = 0;
    const sectorUsd: Record<Sector, number> = {
      CEDEAR: 0, ACCION: 0, ETF: 0, BONO: 0, CRYPTO: 0, COMMOD: 0,
    };
    for (const h of holdings) {
      const meta = ASSETS[h.ticker];
      if (!meta) continue;
      const qty = Number(h.qty) || 0;
      const valueLocal = qty * meta.price;
      const valueUsd = meta.currency === "ARS" ? valueLocal * ARS_TO_USD : valueLocal;
      totalUsd += valueUsd;
      const cat = meta.category as Sector;
      if (cat in sectorUsd) sectorUsd[cat] += valueUsd;
    }

    const currentMix = SECTORS.map((s) => ({
      sector: s,
      pctOfBook: totalUsd > 0 ? Number(((sectorUsd[s] / totalUsd) * 100).toFixed(1)) : 0,
    }));

    const deltas = SECTORS.map((s) => {
      const currentPct = totalUsd > 0 ? (sectorUsd[s] / totalUsd) * 100 : 0;
      const targetPct = targetMix[s];
      const gap = targetPct - currentPct;
      let action: "increase" | "trim" | "hold" = "hold";
      if (gap >= 5) action = "increase";
      else if (gap <= -5) action = "trim";
      return {
        sector: s,
        currentPct: Number(currentPct.toFixed(1)),
        targetPct: Number(targetPct.toFixed(1)),
        gap: Number(gap.toFixed(1)),
        action,
      };
    });

    // --- templated narrative (fallback) ---
    function templatedSuggestions() {
      const tilts = deltas.filter((d) => d.action !== "hold")
        .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
        .slice(0, 3);
      const suggestions = tilts.map((d) => {
        if (d.action === "increase") {
          return `Subir exposición a ${d.sector}: hoy estás en ${d.currentPct.toFixed(0)}%, objetivo ${d.targetPct.toFixed(0)}%.`;
        }
        return `Bajar exposición a ${d.sector}: hoy estás en ${d.currentPct.toFixed(0)}%, objetivo ${d.targetPct.toFixed(0)}%.`;
      });
      const overweight = deltas.find((d) => d.action === "trim");
      const underweight = deltas.find((d) => d.action === "increase");
      let summary = `Tu mix actual está cerca del perfil ${stance}.`;
      if (overweight && underweight) {
        summary = `Estás sobreexpuesto a ${overweight.sector} (${overweight.currentPct.toFixed(0)}% vs ${overweight.targetPct.toFixed(0)}% objetivo) y subexpuesto a ${underweight.sector}. ${tilts.length} tilts sugeridos.`;
      } else if (overweight) {
        summary = `Estás sobreexpuesto a ${overweight.sector} (${overweight.currentPct.toFixed(0)}% vs ${overweight.targetPct.toFixed(0)}% objetivo) para un perfil ${stance}.`;
      } else if (underweight) {
        summary = `Te falta exposición a ${underweight.sector} (${underweight.currentPct.toFixed(0)}% vs ${underweight.targetPct.toFixed(0)}% objetivo) para un perfil ${stance}.`;
      }
      return { summary, suggestions };
    }

    let summary = "";
    let suggestions: string[] = [];

    if (ANTHROPIC_API_KEY) {
      const userPrompt = [
        `Sos SAMAS, asistente de inversiones para retail argentino. El usuario eligió postura macro: ${stance}.`,
        ``,
        `Mix actual de su cartera (% del book por sector):`,
        JSON.stringify(currentMix, null, 2),
        ``,
        `Mix objetivo para postura ${stance} (% del book):`,
        JSON.stringify(SECTORS.map((s) => ({ sector: s, pctOfBook: targetMix[s] })), null, 2),
        ``,
        `Deltas (gap entre actual y objetivo):`,
        JSON.stringify(deltas, null, 2),
        ``,
        `Devolvé un JSON con esta forma EXACTA, sin markdown:`,
        `{`,
        `  "summary":     "1-2 oraciones, ≤200 caracteres, en castellano voseo",`,
        `  "suggestions": ["array de 2-3 sugerencias accionables, ≤140 caracteres cada una"]`,
        `}`,
        ``,
        `Reglas:`,
        `- Voseo (vos), profesional, sereno. Cero emojis, cero hype.`,
        `- En summary: una oración sobre overall fit + una sobre el principal desbalance.`,
        `- En suggestions: 2-3 tilts concretos. Mencioná el sector + dirección + magnitud aproximada.`,
        `- Solo sugerí tilts donde |gap| >= 5%. Si no hay desbalances materiales, devolvé summary diciendo que está bien alineado y suggestions vacías.`,
        `- No menciones tickers específicos — esto es VISTA SECTORIAL, no recomendación de instrumento.`,
        `- No uses "deberías"; usá "podés" o "considerá".`,
      ].join("\n");

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
          summary = String(parsed.summary || "").slice(0, 280);
          if (Array.isArray(parsed.suggestions)) {
            suggestions = parsed.suggestions.map((s: unknown) => String(s).slice(0, 200));
          }
        }
      } catch (_e) { /* fall through */ }
    }

    if (!summary) {
      const t = templatedSuggestions();
      summary = t.summary;
      suggestions = t.suggestions;
    }

    return new Response(JSON.stringify({
      stance,
      currentMix,
      targetMix: SECTORS.map((s) => ({ sector: s, pctOfBook: targetMix[s] })),
      deltas,
      summary,
      suggestions,
      generatedAt: new Date().toISOString(),
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[sector-rotation] threw:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
