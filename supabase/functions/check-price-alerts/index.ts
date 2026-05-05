// ============================================================
// check-price-alerts — cron that fires push notifications when a
// price alert's target is reached
// ============================================================
// Triggered by Supabase pg_cron every 1-2 minutes during market hours.
// No request body; no user auth (service-role only).
//
// Algorithm:
//   1. Pull every active, unfired row from public.price_alerts.
//   2. Group by ticker, dedupe — one quote lookup per unique ticker.
//   3. Fetch current quote per ticker from Finnhub (USD) and the
//      cotizaciones-ARG endpoint (ARS via dolarapi.com for FX, then
//      compute CEDEAR ARS price as the USD price * blue dolar / ratio).
//      For the v1 we keep it simple: only alerts in the same currency
//      as the quote source fire. ARS-currency alerts on USD-listed
//      tickers are skipped with a TODO marker.
//   4. For each match (above/below the target), update the row with
//      fired_at + fired_price and call the send-push function.
//   5. Return a summary so the cron logs are useful.
//
// Secrets required:
//   FINNHUB_API_KEY               — quotes for global tickers
//   SUPABASE_URL / SERVICE_ROLE_KEY — auto-provisioned
//
// The send-push function uses the same SERVICE_ROLE_KEY when invoked
// internally (no Authorization header), so we don't need additional
// secrets here.
// ============================================================

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FINNHUB_API_KEY = Deno.env.get("FINNHUB_API_KEY") ?? "";

interface AlertRow {
  id: string;
  user_id: string;
  ticker: string;
  direction: "above" | "below";
  target_price: number;
  currency: "USD" | "ARS";
  note: string | null;
}

// ----- quote fetcher -----
async function getQuoteUsd(ticker: string): Promise<number | null> {
  if (!FINNHUB_API_KEY) return null;
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${FINNHUB_API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const j = await res.json();
    // Finnhub returns 0 for unknown symbols rather than 404 — guard.
    if (typeof j?.c !== "number" || j.c === 0) return null;
    return j.c;
  } catch (e) {
    console.warn("[check-alerts] quote", ticker, e);
    return null;
  }
}

function alertFires(direction: string, current: number, target: number): boolean {
  if (direction === "above") return current >= target;
  if (direction === "below") return current <= target;
  return false;
}

// ----- handler -----
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: alerts, error } = await admin
      .from("price_alerts")
      .select("id, user_id, ticker, direction, target_price, currency, note")
      .eq("active", true)
      .is("fired_at", null);
    if (error) throw error;
    if (!alerts || alerts.length === 0) {
      return new Response(JSON.stringify({ checked: 0, fired: 0 }), {
        status: 200, headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    // One quote lookup per unique ticker.
    const tickers = [...new Set(alerts.map((a: AlertRow) => a.ticker))];
    const quotes: Record<string, number | null> = {};
    await Promise.all(tickers.map(async (t: string) => {
      quotes[t] = await getQuoteUsd(t);
    }));

    let fired = 0;
    let skippedNoQuote = 0;
    let skippedFx = 0;

    for (const a of alerts as AlertRow[]) {
      const usdPrice = quotes[a.ticker];
      if (usdPrice == null) { skippedNoQuote++; continue; }
      // v1: only USD-currency alerts compared against USD quotes.
      // Skip ARS alerts; we'll add FX when we wire dolarapi.
      if (a.currency !== "USD") { skippedFx++; continue; }

      if (!alertFires(a.direction, usdPrice, a.target_price)) continue;

      // Mark the row first so we don't double-fire if the cron
      // overlaps. The update is atomic — if another invocation got
      // here first, fired_at is already non-null and the WHERE clause
      // matches zero rows.
      const { data: updated, error: upErr } = await admin
        .from("price_alerts")
        .update({
          fired_at: new Date().toISOString(),
          fired_price: usdPrice,
          active: false,
        })
        .eq("id", a.id)
        .is("fired_at", null)
        .select("id");
      if (upErr) { console.warn("[check-alerts] update", upErr); continue; }
      if (!updated || updated.length === 0) continue; // raced

      // Fire and forget. We invoke send-push by calling its public URL
      // with the service role key in the Authorization header — same
      // mechanism a curl call would use.
      const dirWord = a.direction === "above" ? "subió a" : "bajó a";
      const title = `${a.ticker} ${dirWord} ${formatPrice(usdPrice, a.currency)}`;
      const body = a.note?.trim()
        ? a.note
        : `Tu alerta se disparó · objetivo ${formatPrice(a.target_price, a.currency)}`;

      // Drop a notification row regardless of whether the push goes
      // through — the in-app inbox is the durable record. The push is
      // best-effort delivery on top.
      try {
        await admin.from("notifications").insert({
          user_id: a.user_id,
          kind: "price_alert",
          title,
          body,
          data: { alertId: a.id, ticker: a.ticker, firedPrice: usdPrice },
        });
      } catch (e) {
        console.warn("[check-alerts] notif insert", e);
      }

      try {
        await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            // No Authorization header => service-role implicit
            "apikey": SERVICE_KEY,
            "Authorization": `Bearer ${SERVICE_KEY}`,
          },
          body: JSON.stringify({
            userId: a.user_id,
            title,
            body,
            data: { kind: "price_alert", alertId: a.id, ticker: a.ticker },
          }),
        });
        fired++;
      } catch (e) {
        console.warn("[check-alerts] push call", e);
      }
    }

    return new Response(JSON.stringify({
      checked: alerts.length,
      fired,
      skippedNoQuote,
      skippedFx,
    }), {
      status: 200, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e) {
    console.error("[check-alerts]", e);
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});

function formatPrice(n: number, ccy: "USD" | "ARS"): string {
  if (ccy === "USD") return `US$${n.toFixed(2)}`;
  return `$${Math.round(n).toLocaleString("es-AR")}`;
}
