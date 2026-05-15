// ============================================================
// productor.js — B2B back-office helpers (samas-0.4.94)
// ============================================================
// Wraps the compliance_b2b.sql tables: orgs, productores, clientes,
// cuentas, compliance_documents. All calls go through RLS-checked
// Supabase queries — service-role writes only happen server-side
// in parse-contract.
//
// Public surface used by the Productor sheet:
//   activateProductor()    — create a productores row for the
//                            current user, defaulting to the SAMAS
//                            host org. Idempotent (returns existing
//                            row if any).
//   getMyProductor()       — current productor row + org, or null.
//   listClientes()         — clientes scoped by RLS.
//   addCliente()           — insert.
//   getClienteWithCuentas()
//   addCuenta()
//   listClienteDocs()
// ============================================================

import { supabase } from "./supabase.js";

const HOST_ORG_NAME = "SAMAS (host)";

async function getHostOrgId() {
  const { data, error } = await supabase
    .from("orgs")
    .select("id, name")
    .eq("name", HOST_ORG_NAME)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer orgs: ${error.message}`);
  if (!data) throw new Error(`Org "${HOST_ORG_NAME}" no existe. Corré supabase/compliance_b2b.sql primero.`);
  return data.id;
}

export async function getMyProductor() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase
    .from("productores")
    .select("id, user_id, org_id, display_name, role, active, created_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    // PostgREST returns 200 with null for RLS-rejected reads; only
    // network/SQL errors throw. Surface them.
    throw new Error(`No se pudo leer productor: ${error.message}`);
  }
  if (!data) return null;
  // Best-effort org lookup so the UI can show "Bajo: <ALyC>".
  const { data: org } = await supabase
    .from("orgs")
    .select("id, name, alyc_number, brand_color")
    .eq("id", data.org_id)
    .maybeSingle();
  return { ...data, org: org || null };
}

export async function activateProductor({ displayName } = {}) {
  const existing = await getMyProductor();
  if (existing) return existing;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("No autenticado.");
  const orgId = await getHostOrgId();
  const fallbackName = (displayName
    || user.user_metadata?.full_name
    || user.email?.split("@")[0]
    || "Productor"
  ).slice(0, 80);
  const { data, error } = await supabase
    .from("productores")
    .insert({
      user_id: user.id,
      org_id: orgId,
      display_name: fallbackName,
      role: "productor",
    })
    .select("id, user_id, org_id, display_name, role, active, created_at")
    .single();
  if (error) throw new Error(`No se pudo activar productor: ${error.message}`);
  return await getMyProductor();
}

export async function listClientes() {
  const { data, error } = await supabase
    .from("clientes")
    .select("id, productor_id, org_id, cuit, display_name, email, phone, kyc_status, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`No se pudieron listar clientes: ${error.message}`);
  return data || [];
}

// Argentine CUIT: 11 digits, formatted XX-XXXXXXXX-X. Returns the
// normalized form or throws.
export function normalizeCuit(raw) {
  const digits = String(raw || "").replace(/\D+/g, "");
  if (digits.length !== 11) {
    throw new Error("CUIT debe tener 11 dígitos.");
  }
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}

export async function addCliente({ cuit, displayName, email, phone, notes }) {
  if (!cuit) throw new Error("CUIT requerido.");
  if (!displayName || !displayName.trim()) throw new Error("Nombre requerido.");
  const productor = await getMyProductor();
  if (!productor) throw new Error("Primero activá modo Productor.");
  const cleanCuit = normalizeCuit(cuit);
  const { data, error } = await supabase
    .from("clientes")
    .insert({
      productor_id: productor.id,
      org_id: productor.org_id,
      cuit: cleanCuit,
      display_name: displayName.trim().slice(0, 200),
      email: email?.trim() || null,
      phone: phone?.trim() || null,
      notes: notes?.trim() || null,
      kyc_status: "pending",
    })
    .select("id, productor_id, org_id, cuit, display_name, email, phone, kyc_status, created_at")
    .single();
  if (error) {
    if (error.code === "23505") throw new Error("Ya tenés un cliente con ese CUIT.");
    throw new Error(`No se pudo crear cliente: ${error.message}`);
  }
  return data;
}

export async function updateClienteKyc(clienteId, kycStatus) {
  if (!["pending", "in_review", "approved", "rejected"].includes(kycStatus)) {
    throw new Error("Estado KYC inválido.");
  }
  const { data, error } = await supabase
    .from("clientes")
    .update({ kyc_status: kycStatus })
    .eq("id", clienteId)
    .select("id, kyc_status")
    .single();
  if (error) throw new Error(`No se pudo actualizar KYC: ${error.message}`);
  return data;
}

export async function getClienteWithCuentas(clienteId) {
  const { data: cliente, error: e1 } = await supabase
    .from("clientes")
    .select("id, productor_id, org_id, cuit, display_name, email, phone, kyc_status, notes, created_at")
    .eq("id", clienteId)
    .single();
  if (e1) throw new Error(`No se pudo leer cliente: ${e1.message}`);
  const { data: cuentas, error: e2 } = await supabase
    .from("cuentas")
    .select("id, numero, currency, status, opened_at, created_at")
    .eq("cliente_id", clienteId)
    .order("created_at", { ascending: false });
  if (e2) throw new Error(`No se pudieron leer cuentas: ${e2.message}`);
  return { ...cliente, cuentas: cuentas || [] };
}

export async function addCuenta({ clienteId, numero, currency = "ARS" }) {
  if (!numero || !numero.trim()) throw new Error("Número requerido.");
  const cliente = await getClienteWithCuentas(clienteId);
  const { data, error } = await supabase
    .from("cuentas")
    .insert({
      cliente_id: clienteId,
      org_id: cliente.org_id,
      numero: numero.trim().slice(0, 40),
      currency: currency.toUpperCase().slice(0, 4),
    })
    .select("id, numero, currency, status, opened_at, created_at")
    .single();
  if (error) {
    if (error.code === "23505") throw new Error("Ya existe una cuenta con ese número y moneda.");
    throw new Error(`No se pudo crear cuenta: ${error.message}`);
  }
  return data;
}

export async function listClienteDocs(clienteId, { limit = 12 } = {}) {
  const { data, error } = await supabase
    .from("compliance_documents")
    .select("id, kind, flag_count, max_severity, parsed, created_at")
    .eq("cliente_id", clienteId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`No se pudieron leer documentos: ${error.message}`);
  return data || [];
}
