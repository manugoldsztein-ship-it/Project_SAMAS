// ============================================================
// SAMAS v2 — Mock helpers shared across api/* modules
// ============================================================
// Small utilities so every mock feels consistent:
//   - sleep(ms)               — fake network latency
//   - jitter(min, max)        — random latency in a band
//   - maybeFail(rate, error)  — N% of calls reject with the error
//   - genId()                 — simple unique ID for fake records
//
// These get imported by wallet.js / card.js / etc. so calls feel like
// the network is involved (loading spinners actually show, optimistic
// UI gets exercised, etc.). The shape of the data they wrap is per-
// module and documented inside each file.
//
// When we replace mocks with real fetch() / SDK calls, these helpers
// stop being used — the real APIs bring their own latency.
// ============================================================

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const jitter = (min = 200, max = 600) =>
  sleep(min + Math.random() * (max - min));

// Default mock failure rate in % — kept low so happy-path testing is
// easy. Bump per-call when you want to exercise error UI.
const DEFAULT_FAIL_RATE = 0.02;

export async function maybeFail(rate = DEFAULT_FAIL_RATE, message = "Falló la operación. Probá de nuevo.") {
  if (Math.random() < rate) {
    const err = new Error(message);
    err.code = "MOCK_FAILURE";
    throw err;
  }
}

let _idCounter = 1;
export const genId = () => `mock_${Date.now()}_${_idCounter++}`;

// Pretty timestamps for txn rows. Returns "Hoy 14:32" / "Ayer 09:15"
// / "23 abr 18:40" depending on age. Locale fixed to es-AR so the
// mock output matches the legacy app's formatting.
export function relativeStamp(d) {
  const date = d instanceof Date ? d : new Date(d);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return `Hoy ${date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`;
  }
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `Ayer ${date.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`;
  }
  return date.toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
