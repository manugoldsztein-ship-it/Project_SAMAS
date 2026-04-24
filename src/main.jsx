import React from "react";
import { createRoot } from "react-dom/client";
import SAMASApp from "./App.jsx";

// Demo-reset hook: ?reset=1 wipes all SAMAS-persisted state before the app
// mounts (holdings, orders, balance, watchlists, plan, tutorial flag, etc.).
// Useful for recording a clean demo.
try {
  const params = new URLSearchParams(window.location.search);
  if (params.get("reset") === "1" || params.get("fresh") === "1") {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("samas_")) toRemove.push(k);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
    // Strip the query param so a page refresh doesn't keep re-resetting.
    const clean = window.location.pathname + window.location.hash;
    window.history.replaceState(null, "", clean);
  }
} catch {}

createRoot(document.getElementById("root")).render(<SAMASApp />);
