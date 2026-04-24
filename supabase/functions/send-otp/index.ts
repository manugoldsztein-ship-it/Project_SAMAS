// ============================================================
// send-otp — generate a code + send via Twilio WhatsApp Sandbox
// ============================================================
// Body (JSON): { phone: "+5491126022504" }
//
// We no longer use Twilio Verify (trial account restrictions on
// LATAM). Instead we:
//   1. Generate a random 6-digit code
//   2. Hash it with SHA-256 and store in public.otp_codes
//   3. Send the plain code via Twilio's Messaging API to the
//      user's WhatsApp (sandbox, since user joined with `join xyz`)
//
// Secrets required (already in Supabase project):
//   - TWILIO_ACCOUNT_SID
//   - TWILIO_AUTH_TOKEN
//   - TWILIO_WHATSAPP_FROM (optional — defaults to global sandbox)
//   - SUPABASE_SERVICE_ROLE_KEY (auto-provisioned)
//
// Returns:
//   200 { status: "sent" }  — message queued
//   400 { error: "..." }    — bad phone
//   401 { error: "..." }    — missing/invalid JWT
//   500 { error: "..." }    — Twilio or storage failure
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TWILIO_ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID")!;
const TWILIO_AUTH_TOKEN  = Deno.env.get("TWILIO_AUTH_TOKEN")!;
// The global WhatsApp Sandbox number — same for every Twilio trial
// account. If you get a dedicated WhatsApp sender later, set the
// TWILIO_WHATSAPP_FROM secret and this will pick it up.
const TWILIO_WHATSAPP_FROM = Deno.env.get("TWILIO_WHATSAPP_FROM") ?? "whatsapp:+14155238886";

function looksLikePhone(input: string): boolean {
  if (typeof input !== "string") return false;
  const cleaned = input.replace(/\s+/g, "");
  return /^\+?[1-9]\d{7,14}$/.test(cleaned);
}

function normalizePhone(input: string): string {
  const cleaned = input.replace(/\s+/g, "");
  return cleaned.startsWith("+") ? cleaned : "+" + cleaned;
}

function randomCode(): string {
  // 6-digit zero-padded. Crypto-random to avoid predictable codes.
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 1_000_000).padStart(6, "0");
}

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // --- auth gate ---
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await supabaseUser.auth.getUser(jwt);
    if (userErr || !user) {
      console.error("[send-otp] getUser error:", userErr);
      return new Response(
        JSON.stringify({ error: "Not authenticated" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- body ---
    const { phone } = await req.json();
    if (!looksLikePhone(phone)) {
      return new Response(
        JSON.stringify({ error: "Invalid phone. Use international format, e.g. +5491112345678." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const to = normalizePhone(phone);

    // --- generate + store code ---
    const code = randomCode();
    const codeHash = await sha256(code);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

    // service_role client to bypass RLS on otp_codes (deny-all for clients).
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Upsert so a second send for the same user replaces the old code.
    const { error: upErr } = await supabaseAdmin
      .from("otp_codes")
      .upsert({
        user_id: user.id,
        phone: to,
        code_hash: codeHash,
        expires_at: expiresAt,
        attempts: 0,
      }, { onConflict: "user_id" });

    if (upErr) {
      console.error("[send-otp] otp upsert error:", upErr);
      return new Response(
        JSON.stringify({ error: "Failed to store code" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- send WhatsApp via Twilio Messaging API ---
    const basic = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
    const messageBody =
      `SAMAS: tu codigo de verificacion es ${code}. ` +
      `Expira en 10 minutos. Si no lo pediste, ignora este mensaje.`;

    const twilioResp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Authorization": `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          From: TWILIO_WHATSAPP_FROM,
          To: `whatsapp:${to}`,
          Body: messageBody,
        }),
      },
    );

    const twilioBody = await twilioResp.json();
    if (!twilioResp.ok) {
      console.error("[send-otp] Twilio Messaging error:", twilioBody);
      return new Response(
        JSON.stringify({
          error: twilioBody.message || "Twilio error",
          twilio_code: twilioBody.code,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ status: "sent", message_sid: twilioBody.sid, to }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[send-otp] crash:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message ?? "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
