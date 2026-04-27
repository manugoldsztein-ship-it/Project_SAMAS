// ============================================================
// Refresh registry — tab-keyed handler map for pull-to-refresh
// ============================================================
// Tabs (WalletPage, NewsPage, etc.) register their refresh function
// on mount. Shell.jsx's pull-to-refresh handler calls the right one
// based on the active tab. This avoids prop-drilling refresh
// callbacks from leaf components up to the scroll container.
//
// Each `setRefreshHandler` returns a cleanup that unregisters, so
// useEffect can wire it idiomatically:
//
//   useEffect(() => setRefreshHandler("wallet", refresh), [refresh]);
// ============================================================

const handlers = Object.create(null);

export function setRefreshHandler(tabId, fn) {
  handlers[tabId] = fn;
  return () => {
    if (handlers[tabId] === fn) delete handlers[tabId];
  };
}

export async function callRefreshFor(tabId) {
  const fn = handlers[tabId];
  if (typeof fn !== "function") return;
  // Always return a promise so the PTR spinner can await even if the
  // handler is synchronous.
  return Promise.resolve(fn());
}
