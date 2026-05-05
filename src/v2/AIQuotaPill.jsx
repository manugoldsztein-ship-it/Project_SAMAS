// ============================================================
// AIQuotaPill (samas-0.2.8)
// ============================================================
// Compact "X/5 IA hoy" badge for the AI Chat sheet header (and
// future quota'd surfaces). Hides itself when the user is on
// Plus (no cap). Listens for samas:ai-quota-changed broadcasts so
// it refreshes the moment a call is consumed without re-polling
// the RPC.
//
// Color logic:
//   - count < 80% of limit → muted gray pill
//   - count >= 80% of limit → amber (warning)
//   - count >= limit       → red (next call will block)
//
// Tap behavior: opens the Plus upsell modal via the global
// samas:open-pro-upsell event so the user can convert without
// hunting for the entry point in Settings.
// ============================================================

import React, { useEffect, useState, useCallback } from "react";
import { getAIQuotaStatus } from "../lib/ai.js";
import { t as tr } from "../lib/i18n.js";
import { FONT } from "./theme.js";

export function AIQuotaPill({ T, lang = "es" }) {
  const [status, setStatus] = useState(null); // null = unknown / loading

  const fetchStatus = useCallback(async () => {
    const s = await getAIQuotaStatus();
    setStatus(s);
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Subscribe to the global broadcast — gateOnQuota fires this after
  // every consume + activatePlus fires on subscription. Either way we
  // just adopt the new payload directly (no extra RPC call needed).
  useEffect(() => {
    function onChange(e) {
      const detail = e?.detail;
      if (!detail) return;
      // The gate broadcast may not always include isPlus; merge with
      // current state so we don't accidentally flip back to free tier.
      setStatus((prev) => ({
        isPlus: detail.isPlus ?? prev?.isPlus ?? false,
        count: detail.count ?? prev?.count ?? 0,
        limit: detail.limit ?? prev?.limit ?? null,
      }));
    }
    window.addEventListener("samas:ai-quota-changed", onChange);
    return () => window.removeEventListener("samas:ai-quota-changed", onChange);
  }, []);

  // Plus users + unknown state → no pill. Plus has no limit; unknown
  // means the migration hasn't run, in which case showing "—/—" would
  // be confusing. Hide silently.
  if (!status || status.isPlus || status.limit == null) return null;

  const { count, limit } = status;
  const ratio = limit > 0 ? count / limit : 0;
  let tint = T.textMute;
  let bg = T.surface;
  let border = T.border;
  if (ratio >= 1) {
    tint = T.danger;
    bg = T.dangerSoft;
    border = `${T.danger}55`;
  } else if (ratio >= 0.8) {
    tint = "#F59E0B";
    bg = "rgba(245, 158, 11, 0.14)";
    border = "rgba(245, 158, 11, 0.40)";
  }

  function openUpsell() {
    try {
      window.dispatchEvent(new CustomEvent("samas:open-pro-upsell", {
        detail: { reason: "quota_pill", count, limit },
      }));
    } catch (_) { /* SSR */ }
  }

  return (
    <button
      onClick={openUpsell}
      title={tr("ai.quota.tooltip", lang)}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        padding: "3px 9px", borderRadius: 999,
        background: bg, border: `1px solid ${border}`,
        color: tint, cursor: "pointer",
        fontFamily: FONT.mono, fontSize: 10, fontWeight: 700,
        letterSpacing: 0.4,
      }}
    >
      <span style={{ fontSize: 11, lineHeight: 1 }}>✦</span>
      <span>{tr("ai.quota.count", lang, { n: count, max: limit })}</span>
    </button>
  );
}
