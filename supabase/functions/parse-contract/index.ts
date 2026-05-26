// ============================================================
// parse-contract — Compliance AI for ALyC documents (samas-0.4.93)
// ============================================================
// Cohen meeting (2026-05-15) — ALyC onboarding, KYC, contratos por
// préstamo y compliance transaccional son muy manuales. Esta función
// es la cuña: el productor pega el texto de un contrato (préstamo,
// garantía, cuenta comitente, T&C) y devolvemos JSON estructurado
// + flags de cumplimiento para que el back-office no tenga que
// leerlo letra por letra.
//
// Request body:
//   { text: string, hint?: "prestamo" | "garantia" | "cuenta_comitente"
//                          | "termino_condiciones" | "otro" }
// Response:
//   {
//     kind:             string,
//     parties:          Array<{ name, role, cuit }>,
//     amount:           { value, currency } | null,
//     dates:            { signed, expires },
//     key_terms:        Array<{ term, value }>,
//     compliance_flags: Array<{ severity, issue, rule }>,
//     summary:          string,
//     generatedAt:      string,
//   }
//
// LLM provider via _shared/llm.ts (anthropic | ollama). Fallback
// when no provider: returns an empty-shape result with a flag noting
// "se requiere IA habilitada para análisis completo" so the UI can
// surface that clearly without crashing.
//
// HOW TO DEPLOY
//   Mac Terminal: supabase functions deploy parse-contract \
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
import { callLLM, parseLLMJson } from "../_shared/llm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

const MAX_TEXT_CHARS = 30000;
const VALID_KINDS = [
  "prestamo", "garantia", "cuenta_comitente", "termino_condiciones", "otro",
] as const;

interface ParsedContract {
  kind: string;
  parties: Array<{ name: string; role: string; cuit: string | null }>;
  amount: { value: number; currency: string } | null;
  dates: { signed: string | null; expires: string | null };
  key_terms: Array<{ term: string; value: string }>;
  compliance_flags: Array<{ severity: "low" | "medium" | "high"; issue: string; rule: string | null }>;
  summary: string;
  generatedAt: string;
}

function emptyShape(reason: string): ParsedContract {
  return {
    kind: "otro",
    parties: [],
    amount: null,
    dates: { signed: null, expires: null },
    key_terms: [],
    compliance_flags: [{ severity: "low", issue: reason, rule: null }],
    summary: "",
    generatedAt: new Date().toISOString(),
  };
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

    const _rl = await consumeRateLimit(makeAdminClient(), {
      bucket: buildBucket("parse-contract", { userId: user.id }),
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

    const rawText = sanitizeString(body?.text, { maxLength: MAX_TEXT_CHARS, fieldName: "text" });
    if (!rawText || rawText.length < 40) {
      return new Response(JSON.stringify({ error: "text required (min 40 chars)" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const hintRaw = typeof body?.hint === "string" ? body.hint.toLowerCase().trim() : "";
    const hint = (VALID_KINDS as readonly string[]).includes(hintRaw) ? hintRaw : "";

    // Optional cliente_id (samas-0.4.94): only honor it if the caller's
    // RLS-scoped read of `clientes` returns the row. Anyone trying to
    // sneak a foreign cliente_id in via the body gets it dropped here.
    let clienteId: string | null = null;
    const reqClienteId = typeof body?.clienteId === "string" ? body.clienteId : "";
    if (reqClienteId && /^[0-9a-f-]{36}$/i.test(reqClienteId)) {
      const { data: ok } = await userClient
        .from("clientes")
        .select("id")
        .eq("id", reqClienteId)
        .maybeSingle();
      if (ok?.id) clienteId = ok.id;
    }

    const userPrompt = [
      `Sos un asistente de cumplimiento normativo para un ALyC argentino (Agente de`,
      `Liquidación y Compensación, regulado por CNV). Tu trabajo es leer un documento`,
      `legal/financiero y devolver JSON estructurado para que el back-office no tenga`,
      `que leerlo línea por línea.`,
      ``,
      hint ? `El productor sugiere que el documento es de tipo: ${hint}.` : `El tipo de documento no fue indicado — clasificalo vos.`,
      ``,
      `=== TEXTO DEL DOCUMENTO ===`,
      rawText,
      `=== FIN ===`,
      ``,
      `Devolvé JSON con esta forma EXACTA, sin markdown ni fences:`,
      `{`,
      `  "kind": "prestamo" | "garantia" | "cuenta_comitente" | "termino_condiciones" | "otro",`,
      `  "parties": [ { "name": string, "role": string, "cuit": string|null } ],`,
      `  "amount": { "value": number, "currency": "ARS"|"USD"|"EUR" } | null,`,
      `  "dates": { "signed": "YYYY-MM-DD"|null, "expires": "YYYY-MM-DD"|null },`,
      `  "key_terms": [ { "term": string, "value": string } ],`,
      `  "compliance_flags": [ { "severity": "low"|"medium"|"high", "issue": string, "rule": string|null } ],`,
      `  "summary": "2-3 oraciones en castellano rioplatense, neutro, ≤320 chars"`,
      `}`,
      ``,
      `Reglas:`,
      `- parties: cliente, garante, ALyC, productor, etc. CUIT con formato XX-XXXXXXXX-X si está.`,
      `- amount: el monto principal del contrato (préstamo, garantía o caución). Null si no aplica.`,
      `- key_terms: tasa, plazo, cláusulas de rescisión, jurisdicción, comisiones — máximo 8 items.`,
      `- compliance_flags: cosas que el back-office debería revisar — falta de CUIT, plazos atípicos,`,
      `  cláusulas no estándar, montos por encima de umbrales típicos UIF, falta de jurisdicción.`,
      `  Reglá referenciá la norma cuando puedas (ej "CNV NT 2013 art. 12", "UIF Res. 30/2017").`,
      `- summary: qué es y por qué importa, en una oración para skim rápido.`,
      `- Si el texto no parece ser un documento legal/financiero, devolvé kind="otro", flag con`,
      `  severity="medium" e issue="el texto no parece un contrato/T&C — revisar manualmente".`,
    ].join("\n");

    const llm = await callLLM({
      system: "Sos un especialista en cumplimiento ALyC y compliance financiero argentino. Devolvés solo JSON, nunca prosa ni markdown.",
      user: userPrompt,
      maxTokens: 1400,
      timeoutMs: 18000,
    });

    let parsed: ParsedContract;
    if (!llm) {
      parsed = emptyShape("IA no configurada — pedile al admin que setee ANTHROPIC_API_KEY o LLM_PROVIDER en Supabase Function secrets.");
    } else {
      const raw = parseLLMJson<Partial<ParsedContract> & { compliance_flags?: unknown }>(llm.text);
      if (!raw) {
        parsed = emptyShape("La IA no devolvió JSON parseable. Reintentá o revisá manualmente.");
      } else {
        parsed = normalize(raw);
      }
    }

    // Persist for productor history. Best-effort: table may not exist yet
    // in some environments — the migration `supabase/compliance_b2b.sql`
    // creates it. We swallow errors so the demo works pre-migration.
    try {
      const adminClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      await adminClient.from("compliance_documents").insert({
        user_id: user.id,
        cliente_id: clienteId,
        kind: parsed.kind,
        source_text: rawText.slice(0, 8000),
        parsed: parsed,
        flag_count: parsed.compliance_flags.length,
        max_severity: maxSeverity(parsed.compliance_flags),
      });
    } catch (_e) { /* table may not exist yet — non-fatal */ }

    return new Response(JSON.stringify(parsed), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[parse-contract] threw:", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function normalize(raw: Partial<ParsedContract> & { compliance_flags?: unknown }): ParsedContract {
  const kind = (VALID_KINDS as readonly string[]).includes(String(raw.kind))
    ? String(raw.kind) : "otro";
  const parties = Array.isArray(raw.parties) ? raw.parties.slice(0, 12).map((p: any) => ({
    name: String(p?.name || "").slice(0, 200),
    role: String(p?.role || "").slice(0, 80),
    cuit: p?.cuit ? String(p.cuit).slice(0, 13) : null,
  })) : [];
  const amount = raw.amount && typeof raw.amount === "object"
    && Number.isFinite(Number((raw.amount as any).value))
    ? {
      value: Number((raw.amount as any).value),
      currency: String((raw.amount as any).currency || "ARS").toUpperCase().slice(0, 4),
    } : null;
  const dates = {
    signed: raw.dates?.signed ? String(raw.dates.signed).slice(0, 10) : null,
    expires: raw.dates?.expires ? String(raw.dates.expires).slice(0, 10) : null,
  };
  const key_terms = Array.isArray(raw.key_terms) ? raw.key_terms.slice(0, 8).map((t: any) => ({
    term: String(t?.term || "").slice(0, 80),
    value: String(t?.value || "").slice(0, 240),
  })).filter((t) => t.term && t.value) : [];
  const compliance_flags = Array.isArray(raw.compliance_flags)
    ? raw.compliance_flags.slice(0, 10).map((f: any) => ({
      severity: ["low", "medium", "high"].includes(String(f?.severity))
        ? String(f.severity) as "low" | "medium" | "high" : "medium",
      issue: String(f?.issue || "").slice(0, 320),
      rule: f?.rule ? String(f.rule).slice(0, 120) : null,
    })).filter((f) => f.issue) : [];
  const summary = String(raw.summary || "").slice(0, 360);
  return {
    kind, parties, amount, dates, key_terms, compliance_flags, summary,
    generatedAt: new Date().toISOString(),
  };
}

function maxSeverity(flags: Array<{ severity: string }>): string {
  const rank = { low: 1, medium: 2, high: 3 } as Record<string, number>;
  let top = "low";
  for (const f of flags) if ((rank[f.severity] || 0) > (rank[top] || 0)) top = f.severity;
  return flags.length ? top : "none";
}
