// ============================================================
// ALERTS — price-alert CRUD backed by Supabase
// ============================================================
// Persists price alerts to public.price_alerts so they survive across
// devices and so the check-price-alerts cron can see them. The mock
// version lived inline in broker.js with an in-memory state object;
// this replaces the storage layer while keeping the same public
// surface (setPriceAlert / removePriceAlert / getPriceAlerts) so
// nothing in the UI changes.
//
// Schema mapping (DB column → JS field):
//   id            → id
//   ticker        → ticker
//   direction     → direction      ('above' | 'below')
//   target_price  → targetPrice
//   currency      → currency       ('USD' | 'ARS')
//   note          → note
//   active        → active
//   created_at    → createdAt      (ISO string)
//   fired_at      → firedAt        (ISO string | null)
//   fired_price   → firedPrice     (number | null)
//
// We do NOT include user_id in the JS object — RLS already restricts
// every query to the caller's own rows.
// ============================================================

import { supabase } from "../../lib/supabase.js";

function rowToAlert(r) {
  return {
    id: r.id,
    ticker: r.ticker,
    direction: r.direction,
    targetPrice: Number(r.target_price),
    currency: r.currency,
    note: r.note || null,
    active: !!r.active,
    createdAt: r.created_at,
    firedAt: r.fired_at,
    firedPrice: r.fired_price != null ? Number(r.fired_price) : null,
  };
}

/**
 * setPriceAlert({ ticker, targetPrice, direction, currency, note }) →
 *   creates a new active alert. Multiple alerts on the same ticker
 *   are allowed (e.g. one above, one below). Returns the created
 *   alert.
 */
export async function setPriceAlert({
  ticker, targetPrice, direction = "above",
  currency = "USD", note = null,
}) {
  if (!ticker) throw new Error("Ticker requerido.");
  if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
    throw new Error("Precio objetivo inválido.");
  }
  if (direction !== "above" && direction !== "below") {
    throw new Error("Dirección debe ser 'above' o 'below'.");
  }

  const { data: u } = await supabase.auth.getUser();
  const userId = u?.user?.id;
  if (!userId) throw new Error("Sesión no encontrada.");

  const { data, error } = await supabase
    .from("price_alerts")
    .insert({
      user_id: userId,
      ticker,
      direction,
      target_price: targetPrice,
      currency,
      note,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return rowToAlert(data);
}

/**
 * removePriceAlert(idOrTicker) — delete an alert. Accepts either
 *   the alert's UUID (preferred) OR a ticker symbol (deletes ALL
 *   alerts for that ticker — backward-compat with the mock that
 *   keyed by ticker).
 */
export async function removePriceAlert(idOrTicker) {
  if (!idOrTicker) return;
  // Heuristic: UUIDs have hyphens at fixed positions.
  const isUuid = typeof idOrTicker === "string" && /^[0-9a-f-]{36}$/i.test(idOrTicker);
  let q = supabase.from("price_alerts").delete();
  q = isUuid ? q.eq("id", idOrTicker) : q.eq("ticker", idOrTicker);
  const { error } = await q;
  if (error) throw new Error(error.message);
}

/**
 * getPriceAlerts({ activeOnly }) — list alerts for the current user.
 *   Default activeOnly=true so the Órdenes tab shows only what's still
 *   armed. Pass false to include fired/disabled history.
 */
export async function getPriceAlerts({ activeOnly = true } = {}) {
  let q = supabase
    .from("price_alerts")
    .select("*")
    .order("created_at", { ascending: false });
  if (activeOnly) q = q.eq("active", true).is("fired_at", null);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || []).map(rowToAlert);
}

/**
 * getFiredAlerts() — recent alerts that have already fired. Used by
 *   the "Recientes" section in Settings.
 */
export async function getFiredAlerts(limit = 20) {
  const { data, error } = await supabase
    .from("price_alerts")
    .select("*")
    .not("fired_at", "is", null)
    .order("fired_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data || []).map(rowToAlert);
}
