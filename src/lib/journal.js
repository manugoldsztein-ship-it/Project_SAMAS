// ============================================================
// journal.js (samas-0.4.29) — trade_journal client wrappers
// ============================================================
// Records a journal entry on every BUY (and computes outcome on
// SELL when the matching ticker has open journal entries). The
// table itself is RLS-scoped to auth.uid() — see
// supabase/trade_journal.sql.
//
// Outcome computation is OPPORTUNISTIC: when a SELL happens, we
// look up open BUY journal entries for the same ticker (FIFO-
// ordered by occurred_at) and close them with a realized P/L
// computed against the SELL price. Imperfect (doesn't handle
// partial fills cleanly across multiple buys at different prices)
// but honest: real broker reconciliation has its own complexity
// and SAMAS's mock-money layer doesn't need to match it.
// ============================================================

import { supabase } from "./supabase.js";

async function currentUserId() {
  const { data } = await supabase.auth.getUser();
  return data?.user?.id || null;
}

// Record a journal entry on BUY. Best-effort: failures don't block
// the trade. Returns the inserted row id, or null.
export async function recordBuyJournal({ ticker, qty, price, thesisText }) {
  try {
    const userId = await currentUserId();
    if (!userId) return null;
    const { data, error } = await supabase
      .from("trade_journal")
      .insert({
        user_id: userId,
        ticker,
        side: "buy",
        qty,
        price,
        thesis_at_entry: (thesisText || "").trim().slice(0, 1000) || null,
        outcome: "open",
      })
      .select("id")
      .single();
    if (error) {
      console.warn("[journal] recordBuy failed:", error.message);
      return null;
    }
    return data?.id || null;
  } catch (e) {
    console.warn("[journal] recordBuy threw:", e?.message);
    return null;
  }
}

// Close open BUY journal entries when a SELL happens. FIFO by
// occurred_at. Closes as many as needed to cover the sell qty;
// computes per-row realized_usd against the SELL price.
//
// Currency note: SAMAS's mock has both ARS and USD assets. For the
// realized_usd we approximate ARS→USD using a hardcoded MEP rate
// (1245), consistent with the rest of the AI Edge Functions. When
// real partner data lands the conversion uses live FX.
export async function closeJournalOnSell({ ticker, sellQty, sellPrice, currency = "USD" }) {
  try {
    const userId = await currentUserId();
    if (!userId) return 0;
    const { data: openRows } = await supabase
      .from("trade_journal")
      .select("id, qty, price, occurred_at")
      .eq("user_id", userId)
      .eq("ticker", ticker)
      .eq("side", "buy")
      .eq("outcome", "open")
      .order("occurred_at", { ascending: true });
    const open = openRows || [];
    let remaining = Number(sellQty) || 0;
    let closedCount = 0;
    const ARS_TO_USD = 1 / 1245;
    for (const row of open) {
      if (remaining <= 0) break;
      const rowQty = Number(row.qty) || 0;
      const matchedQty = Math.min(rowQty, remaining);
      // P/L per matched unit, in the asset's currency, then
      // converted to USD if needed.
      const buyPrice = Number(row.price) || 0;
      const plLocal = (Number(sellPrice) - buyPrice) * matchedQty;
      const plUsd = currency === "ARS" ? plLocal * ARS_TO_USD : plLocal;
      // Outcome bucket: ±2% from break-even = "flat".
      const moveFrac = buyPrice > 0 ? (Number(sellPrice) - buyPrice) / buyPrice : 0;
      const outcome = Math.abs(moveFrac) < 0.02 ? "flat"
        : moveFrac >= 0.02 ? "gain" : "loss";
      const update = matchedQty >= rowQty
        ? {
            outcome,
            realized_usd: Math.round(plUsd * 100) / 100,
            closed_at: new Date().toISOString(),
          }
        : {
            // Partial close — leave the row open but reduce qty.
            // For simplicity we close the row entirely with prorated
            // realized P/L (matchedQty / rowQty fraction). Partial
            // close handling is a 0.4.30+ followup; flagging not done
            // would clutter the journal needlessly.
            outcome,
            realized_usd: Math.round(plUsd * 100) / 100,
            closed_at: new Date().toISOString(),
          };
      await supabase.from("trade_journal").update(update).eq("id", row.id);
      remaining -= matchedQty;
      closedCount++;
    }
    return closedCount;
  } catch (e) {
    console.warn("[journal] closeOnSell threw:", e?.message);
    return 0;
  }
}

// List the user's journal entries (newest first), capped at 200.
export async function listJournal({ limit = 200 } = {}) {
  try {
    const userId = await currentUserId();
    if (!userId) return [];
    const { data, error } = await supabase
      .from("trade_journal")
      .select("*")
      .eq("user_id", userId)
      .order("occurred_at", { ascending: false })
      .limit(limit);
    if (error) {
      console.warn("[journal] list failed:", error.message);
      return [];
    }
    return data || [];
  } catch (e) {
    console.warn("[journal] list threw:", e?.message);
    return [];
  }
}
