// ============================================================
// COHEN — client for the mtalazzar/SAMAS bridge service
// ============================================================
// Java/Spring Boot service that wraps Cohen's broker API.
// Auth: the service is an OAuth2 resource server — it validates
// the Supabase JWT from localStorage exactly like the Supabase
// edge-function clients (news.js, ai.js).
//
// Base URL: VITE_COHEN_API_BASE (e.g. http://100.x.x.x:8080)
// All calls throw when the env var is unset — module stays dormant.
//
// Endpoints wired:
//   Account:
//     getComitentes()                                      GET  /api/account/comitentes
//     getPositions(comitenteId)                            GET  /api/account/positions/{id}
//     getPosition(comitenteId, fecha?)                     GET  /api/account/position/{id}
//     getTenencia(comitenteId, fecha?)                     GET  /api/account/tenencia/{id}
//     getEvolution(comitenteId, fechaDesde, fechaHasta)    GET  /api/account/evolution/{id}
//   Orders (natural-language):
//     previewOrder({ order, comitenteId, monedaId? })      POST /api/orders/preview
//     executeOrder({ order, comitenteId, monedaId? })      POST /api/orders/execute
//   Contract analysis:
//     analyzeContract(file)                                POST /api/contract/analyze
//   Onboarding (no auth):
//     startOnboarding(req)                                 POST /api/onboarding/start
//   Transaction monitoring:
//     getMonitoringReport(comitenteId, desde, hasta)       GET  /api/monitoring/{id}
//   Bank credentials:
//     listCredentials(userId)                              GET  /api/users/{uid}/credentials
//     createCredential(userId, req)                        POST /api/users/{uid}/credentials
//     updateCredential(userId, credId, req)                PUT  /api/users/{uid}/credentials/{cid}
//     deleteCredential(userId, credId)                     DELETE /api/users/{uid}/credentials/{cid}
//     testCredentialToken(userId, credId)                  POST /api/users/{uid}/credentials/{cid}/token
// ============================================================

import { SUPABASE_URL } from "./supabase";

const COHEN_API_BASE = (import.meta.env.VITE_COHEN_API_BASE || "").replace(/\/+$/, "");

export const cohenConfigured = !!COHEN_API_BASE;

async function authToken() {
  try {
    const ref = (SUPABASE_URL.match(/https:\/\/([^.]+)\./) || [])[1];
    if (!ref || typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(`sb-${ref}-auth-token`);
    if (!raw) return null;
    return JSON.parse(raw)?.access_token || null;
  } catch {
    return null;
  }
}

async function fetchTimeout(url, opts = {}, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function cohenFetch(path, { method = "GET", body, skipAuth = false } = {}) {
  if (!COHEN_API_BASE) throw new Error("Cohen API no configurada (falta VITE_COHEN_API_BASE).");

  const headers = {};
  if (!skipAuth) {
    const token = await authToken();
    if (!token) throw new Error("No hay sesión activa.");
    headers["Authorization"] = `Bearer ${token}`;
  }
  if (body && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const resp = await fetchTimeout(`${COHEN_API_BASE}${path}`, {
    method,
    headers,
    body: body instanceof FormData ? body : (body ? JSON.stringify(body) : undefined),
  });

  if (!resp.ok) {
    const detail = await resp.json().catch(() => null);
    const msg = detail?.detail || detail?.title || detail?.message || `HTTP ${resp.status}`;
    throw new Error(`Cohen: ${msg}`);
  }
  if (resp.status === 204) return null;
  return resp.json();
}

function qs(params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

// --- Account --------------------------------------------------

// Brokerage accounts (comitentes) visible to the signed-in user.
// -> [{ id, name, active }]
export async function getComitentes() {
  return cohenFetch("/api/account/comitentes");
}

// Full valued position list (listGeneral) for a comitente.
// -> [{ ticker, description, quantity, price, marketValue, currency, instrumentType }]
export async function getPositions(comitenteId) {
  return cohenFetch(`/api/account/positions/${encodeURIComponent(comitenteId)}`);
}

// Summarised position snapshot. fecha = "yyyy-MM-dd", defaults to today.
// -> { ... position summary fields ... }
export async function getPosition(comitenteId, fecha = "") {
  return cohenFetch(`/api/account/position/${encodeURIComponent(comitenteId)}${qs({ fecha })}`);
}

// Tenencia (asset breakdown) at a given date.
export async function getTenencia(comitenteId, fecha = "") {
  return cohenFetch(`/api/account/tenencia/${encodeURIComponent(comitenteId)}${qs({ fecha })}`);
}

// Portfolio evolution between two dates.
// -> { evolution: [...], ... }
export async function getEvolution(comitenteId, fechaDesde, fechaHasta) {
  return cohenFetch(`/api/account/evolution/${encodeURIComponent(comitenteId)}${qs({ fechaDesde, fechaHasta })}`);
}

// --- Orders (natural language) --------------------------------

// Parse a free-text order; does NOT execute. Shows the user what
// the system understood before they confirm.
// req: { order: string, comitenteId: number, monedaId?: number }
// -> { tipoOperacion, ticker, cantidad, precio, plazo, moneda, rawOrder, confirmation }
export async function previewOrder(req) {
  return cohenFetch("/api/orders/preview", { method: "POST", body: req });
}

// Parse and immediately execute the order via Cohen's API.
// Same shape as previewOrder — returns execution result.
export async function executeOrder(req) {
  return cohenFetch("/api/orders/execute", { method: "POST", body: req });
}

// --- Contract analysis ----------------------------------------

// Upload a PDF file, get a structured analysis from Claude.
// Returns a shape compatible with the existing ComplianceResult component.
export async function analyzeContract(file) {
  const fd = new FormData();
  fd.append("file", file);
  const raw = await cohenFetch("/api/contract/analyze", { method: "POST", body: fd });
  // Normalize ContractAnalysisResult → ComplianceResult shape
  return {
    kind: raw.contractType || "otro",
    summary: raw.plainSummary || raw.subject || "",
    parties: raw.parties || "",
    key_terms: raw.keyTerms || [],
    compliance_flags: (raw.risks || []).map((r) => ({ severity: "medium", issue: r, rule: null })),
    obligations: raw.obligations || [],
    dates: raw.expirationDate || null,
    amount: null,
  };
}

// --- Onboarding -----------------------------------------------

// Submit DNI photos for AI-powered KYC. No auth required.
// req: { dniFronteBase64, dniDorsoBase64, mediaType?, selfieBase64?, email, password, telefono }
// -> { status: "APPROVED"|"REJECTED"|"MANUAL_REVIEW", message, extractedName?, comitenteId? }
export async function startOnboarding(req) {
  return cohenFetch("/api/onboarding/start", { method: "POST", body: req, skipAuth: true });
}

// --- Transaction monitoring -----------------------------------

// AI compliance scan of a comitente's movements over a date range.
// -> { comitenteId, fechaDesde, fechaHasta, totalMovimientos, totalVolumen,
//      riskLevel: "LOW"|"MEDIUM"|"HIGH", alerts: string[], aiSummary }
export async function getMonitoringReport(comitenteId, fechaDesde, fechaHasta) {
  return cohenFetch(
    `/api/monitoring/${encodeURIComponent(comitenteId)}${qs({ fechaDesde, fechaHasta })}`
  );
}

// --- Bank credentials -----------------------------------------

// List all linked broker credentials for a user.
// -> [{ id, userId, bankName, username }]
export async function listCredentials(userId) {
  return cohenFetch(`/api/users/${encodeURIComponent(userId)}/credentials`);
}

// Link a new broker account.
// req: { bankName, username, password, totpSecret?, code? }
// -> { id, userId, bankName, username }
export async function createCredential(userId, req) {
  return cohenFetch(`/api/users/${encodeURIComponent(userId)}/credentials`, {
    method: "POST", body: req,
  });
}

// Update stored credentials (e.g. password rotation).
export async function updateCredential(userId, credentialId, req) {
  return cohenFetch(
    `/api/users/${encodeURIComponent(userId)}/credentials/${encodeURIComponent(credentialId)}`,
    { method: "PUT", body: req }
  );
}

// Remove a linked credential.
export async function deleteCredential(userId, credentialId) {
  return cohenFetch(
    `/api/users/${encodeURIComponent(userId)}/credentials/${encodeURIComponent(credentialId)}`,
    { method: "DELETE" }
  );
}

// Test that a stored credential can obtain a live broker token.
// -> { token: string }
export async function testCredentialToken(userId, credentialId) {
  return cohenFetch(
    `/api/users/${encodeURIComponent(userId)}/credentials/${encodeURIComponent(credentialId)}/token`,
    { method: "POST" }
  );
}
