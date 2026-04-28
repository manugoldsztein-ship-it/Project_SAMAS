// ============================================================
// process-recurring-aportes — daily cron that fires monthly contributions
// ============================================================
// No request body. Service-role auth.
//
// Algorithm:
//   1. Compute "today" in Argentina/Buenos_Aires time (the user picks
//      day-of-month in their local frame). Postgres handles the date
//      math via timezone()/AT TIME ZONE.
//   2. Pull every active recurring_aporte where next_due <= today.
//   3. For each one:
//      a. Skip if last_credited_at is already today (idempotency —
//         the cron may re-fire if the previous run hit a transient
//         error).
//      b. Insert a wallet_credits row with source='aporte_recurring'.
//      c. Update the aporte: last_credited_at=now(), next_due=today+1 month
//         (clamped to day_of_month, with February falling back to day 28).
//   4. Return a summary so the cron logs are useful.
//
// What the cron does NOT do (yet):
//   - Send a push notification on success. That's a follow-up — wire
//     it through send-push once the user has APNs keys.
//   - Pull funds from a real linked bank. The credit is symbolic; the
//     wallet shows the new balance and the Movimientos list shows the
//     row. When we wire a real ACH/CVU integration, this is where it
//     plugs in.
//
// Secrets required:
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY   — auto-provisioned
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// "Today" in Argentina/Buenos_Aires (UTC-3, no DST since 2009). The
// user picks day-of-month in their local frame, so we compute the
// boundary the same way. If we ever need to support multiple
// timezones we'd persist the user's tz on their profile and use that.
function todayInAR(): string {
  const now = new Date();
  const ar = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const y = ar.getUTCFullYear();
  const m = String(ar.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ar.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Compute next_due date string given a current date (YYYY-MM-DD) and
// a day-of-month (1-28). Always lands one calendar month forward,
// clamped to day_of_month.
function advanceNextDue(currentDate: string, dayOfMonth: number): string {
  const [y, m, _d] = currentDate.split("-").map(Number);
  // Move to next month
  let nextY = y;
  let nextM = m + 1;
  if (nextM > 12) { nextM = 1; nextY = y + 1; }
  const day = Math.max(1, Math.min(28, dayOfMonth));
  return `${nextY}-${String(nextM).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

interface AporteRow {
  id: string;
  user_id: string;
  amount: number;
  currency: "ARS" | "USD";
  day_of_month: number;
  next_due: string;
  last_credited_at: string | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const today = todayInAR();

    // Pull due aportes. Index recurring_aportes_due makes this cheap
    // even at millions of rows.
    const { data: rows, error } = await admin
      .from("recurring_aportes")
      .select("id, user_id, amount, currency, day_of_month, next_due, last_credited_at")
      .eq("active", true)
      .lte("next_due", today);
    if (error) throw error;

    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({ today, fired: 0, skipped: 0 }), {
        status: 200, headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    let fired = 0;
    let skippedIdempotent = 0;
    const errors: Array<{ id: string; reason: string }> = [];

    for (const r of rows as AporteRow[]) {
      // Idempotency: if last_credited_at is already today (in AR
      // time), skip. This guards against the cron re-firing within
      // the same day after a transient failure.
      if (r.last_credited_at) {
        const lastDay = String(r.last_credited_at).slice(0, 10);
        if (lastDay === today) { skippedIdempotent++; continue; }
      }

      // 1) Insert the credit row.
      const { error: creditErr } = await admin
        .from("wallet_credits")
        .insert({
          user_id: r.user_id,
          source: "aporte_recurring",
          amount: r.amount,
          currency: r.currency,
          note: `Aporte mensual · ${r.currency} ${r.amount}`,
          aporte_id: r.id,
        });
      if (creditErr) {
        errors.push({ id: r.id, reason: `credit: ${creditErr.message}` });
        continue;
      }

      // 2) Advance next_due + stamp last_credited_at.
      const nextDue = advanceNextDue(today, r.day_of_month);
      const { error: updErr } = await admin
        .from("recurring_aportes")
        .update({
          last_credited_at: new Date().toISOString(),
          next_due: nextDue,
        })
        .eq("id", r.id);
      if (updErr) {
        errors.push({ id: r.id, reason: `update: ${updErr.message}` });
        continue;
      }

      // 3) In-app notification so the user sees the credit show up
      //    in their inbox even if push wasn't delivered.
      const sym = r.currency === "ARS" ? "$" : "US$";
      const fmtAmount = r.currency === "ARS"
        ? Math.round(r.amount).toLocaleString("es-AR")
        : r.amount.toFixed(2);
      try {
        await admin.from("notifications").insert({
          user_id: r.user_id,
          kind: "aporte",
          title: `Aporte acreditado · ${sym}${fmtAmount}`,
          body: `Tu aporte mensual ya está en tu cartera. Próximo: ${nextDue}.`,
          data: { aporteId: r.id, amount: r.amount, currency: r.currency, nextDue },
        });
      } catch (e) {
        console.warn("[process-aportes] notif insert", e);
      }

      fired++;
    }

    return new Response(JSON.stringify({
      today, fired, skippedIdempotent, errors,
    }), {
      status: 200, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e) {
    console.error("[process-aportes]", e);
    return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
