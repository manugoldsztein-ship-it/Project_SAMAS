// ============================================================
// verify-otp — validate code against otp_codes table
// ============================================================
// Body (JSON): { phone: "+5491126022504", code: "123456" }
//
// Looks up the stored hash in public.otp_codes, compares against
// the submitted code's hash. On match: updates profiles and
// deletes the OTP row. On miss: increments attempts counter.
//
// Returns:
//   200 { verified: true }                     — code matched
//   200 { verified: false, reason: "..." }     — wrong/expired/exhausted
//   400 { error: "..." }                       — bad input
//   401 { error: "..." }                       — missing/invalid JWT
//   500 { error: "..." }                       — unexpected failure
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_ATTEMPTS = 5;

function looksLikePhone(input: string): boolean {
  if (typeof input !== "string") return false;
  const cleaned = input.replace(/\s+/g, "");
  return /^\+?[1-9]\d{7,14}$/.test(cleaned);
}

function normalizePhone(input: string): string {
  const cleaned = input.replace(/\s+/g, "");
  return cleaned.startsWith("+") ? cleaned : "+" + cleaned;
}

function looksLikeCode(input: string): boolean {
  return typeof input === "string" && /^\d{4,8}$/.test(input.trim());
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
      console.error("[verify-otp] getUser error:", userErr);
      return new Response(
        JSON.stringify({ error: "Not authenticated" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- body ---
    const { phone, code } = await req.json();
    if (!looksLikePhone(phone)) {
      return new Response(
        JSON.stringify({ error: "Invalid phone" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!looksLikeCode(code)) {
      return new Response(
        JSON.stringify({ error: "Invalid code" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const to = normalizePhone(phone);
    const submittedHash = await sha256(code.trim());

    // --- load stored OTP (service_role bypasses RLS) ---
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: otp, error: lookupErr } = await supabaseAdmin
      .from("otp_codes")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (lookupErr) {
      console.error("[verify-otp] lookup error:", lookupErr);
      return new Response(
        JSON.stringify({ error: "Lookup failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!otp) {
      return new Response(
        JSON.stringify({ verified: false, reason: "no_code" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (otp.phone !== to) {
      // Code was issued for a different phone number than the one
      // submitted — refuse. Prevents binding a different phone to
      // a user by reusing someone else's code attempt.
      return new Response(
        JSON.stringify({ verified: false, reason: "phone_mismatch" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (new Date(otp.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ verified: false, reason: "expired" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (otp.attempts >= MAX_ATTEMPTS) {
      return new Response(
        JSON.stringify({ verified: false, reason: "too_many_attempts" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (otp.code_hash !== submittedHash) {
      // Wrong code — bump attempts, keep the row so user can retry.
      await supabaseAdmin
        .from("otp_codes")
        .update({ attempts: otp.attempts + 1 })
        .eq("user_id", user.id);
      return new Response(
        JSON.stringify({ verified: false, reason: "wrong_code" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- match! update profile + delete the otp row ---
    // Profile update goes through the user's JWT so RLS enforces
    // "user can only modify own profile" at the DB level.
    const { error: profErr } = await supabaseUser
      .from("profiles")
      .update({
        phone: to,
        phone_verified: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);
    if (profErr) {
      console.error("[verify-otp] profile update error:", profErr);
      // Not fatal for the user — they verified, just log it.
    }

    await supabaseAdmin.from("otp_codes").delete().eq("user_id", user.id);

    return new Response(
      JSON.stringify({ verified: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[verify-otp] crash:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message ?? "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
