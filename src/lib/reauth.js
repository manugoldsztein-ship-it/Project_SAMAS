// ============================================================
// REAUTH — password-confirm gate for sensitive actions.
// ============================================================
// Used before account deletion + outbound withdrawals (samas-0.0.98).
// Re-validates the user's password against Supabase Auth without
// signing them out — even if a session token leaked, the attacker
// would still need the password to proceed.
//
// Why bother re-validating an already-authenticated session?
//   - Phone left unlocked: another person can't withdraw if they
//     don't know the password.
//   - Stolen device: PIN lock + biometric protect the app, but
//     financial actions deserve a second proof.
//   - App Store reviewers reading our security posture in the
//     privacy questionnaire: this is a real defense, not theater.
// ============================================================

import { supabase } from "./supabase.js";

/**
 * reauthWithPassword(password) — verifies the supplied password
 * against the current user's auth credentials. Returns true on
 * success, throws on failure. Does NOT clobber the existing
 * session (signInWithPassword refreshes it but keeps the user
 * signed in).
 */
export async function reauthWithPassword(password) {
  if (!password || password.length < 1) {
    throw new Error("Ingresá tu contraseña.");
  }
  const { data: { user }, error: getErr } = await supabase.auth.getUser();
  if (getErr || !user?.email) {
    throw new Error("Sesión inválida. Volvé a iniciar sesión.");
  }
  const { error } = await supabase.auth.signInWithPassword({
    email: user.email,
    password,
  });
  if (error) {
    // Don't echo Supabase's exact error string — could leak whether
    // the email exists, etc. Just say password wrong.
    throw new Error("Contraseña incorrecta.");
  }
  return true;
}
