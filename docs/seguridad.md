# SAMAS — Matriz de responsabilidades de ciberseguridad

> Estado: **prototipo previo a integración con broker.** Documento vivo.
> Última actualización: 2026-05-01.

Este documento lista cada superficie de seguridad de la app SAMAS, dónde
está implementada técnicamente, y quién es responsable. La columna
**Estado** marca lo que ya está implementado vs. gaps conocidos.

**Convenciones de "Quién":**
- **SAMAS** = nosotros (este equipo / código en el repo)
- **Supabase** = proveedor de Postgres + Auth + Edge Functions + Storage
- **Apple** = proveedor de plataforma iOS / APNs
- **Broker** = ALyC (Cohen u otro) una vez integrado. Hoy todo está mockeado en cliente.
- **Anthropic** = proveedor de las llamadas LLM (Claude Haiku) en las funciones IA

---

## 1. Identidad y autenticación

| Capacidad | Dónde vive | Quién | Estado |
|---|---|---|---|
| Login email + password | Supabase Auth (GoTrue) | Supabase + SAMAS | ✅ Hashes bcrypt manejados por Supabase. Política mínima de password no aplicada todavía (gap). |
| OTP por WhatsApp | Edge Functions `send-otp` / `verify-otp`, tabla `otp_codes` | SAMAS | ✅ Códigos hasheados en DB, expiración 10 min, 3 intentos. Provider WhatsApp Business API (cuenta de SAMAS). |
| MFA TOTP | Endpoints raw GoTrue REST (cliente: `src/auth/Mfa.jsx`) | Supabase + SAMAS | ✅ Opcional por usuario. Backup codes pendientes (gap). |
| PIN local en app | `src/auth/PinLock.jsx` + Capacitor Preferences | SAMAS | ✅ 4 dígitos. PIN se hashea localmente con SHA-256 antes de guardar. |
| Biométrica (FaceID / TouchID) | Plugin `@aparajita/capacitor-biometric-auth` | Apple + SAMAS | ✅ Como fallback al PIN. Datos biométricos nunca salen del dispositivo. |
| Sesiones / refresh tokens | Supabase JWT, persistencia en Capacitor Preferences | Supabase | ✅ Auto-refresh activo. Expiración 1 h, refresh 30 días. |
| OAuth Google / Apple | Supabase Auth + plugin `@capacitor/browser` + URL scheme `samas://` | Supabase + SAMAS | ⚠️ Código wired (0.1.5). Falta: Manuel agregue `samas://auth/callback` al allow-list de Supabase. |

---

## 2. Autorización (control de acceso)

| Capacidad | Dónde vive | Quién | Estado |
|---|---|---|---|
| Row-Level Security (RLS) | 98 policies sobre 30+ tablas en `supabase/*.sql` | SAMAS | ✅ Todas las tablas con datos de usuario tienen `auth.uid() = user_id`. Auditado tabla por tabla. |
| Service-role key (admin) | Solo en Edge Functions del lado server, nunca expuesto al cliente | SAMAS | ✅ Almacenado en `SUPABASE_SERVICE_ROLE_KEY` env de Edge Functions. |
| JWT verificación en Edge Functions | Cada función llama `auth.getUser(jwt)` antes de cualquier operación con datos del usuario | SAMAS | ✅ Verificado en las 14 funciones IA + delete-user-account + export-user-data. |
| Privilege escalation paths | N/A | SAMAS | ✅ El service-role solo lo usan funciones de mantenimiento (cron de price-alerts, aportes recurrentes, social_notifications). |

---

## 3. Datos del usuario en reposo

| Tipo de dato | Dónde se guarda | Quién | Estado |
|---|---|---|---|
| Identidad básica (nombre, email, teléfono) | `profiles` (Supabase Postgres) | Supabase (cifrado at-rest gestionado) + SAMAS | ✅ |
| Perfil social (handle, bio, university) | `profiles_social` | Supabase + SAMAS | ✅ |
| Posts / réplicas / likes / follows | `posts`, `replies`, `likes`, `follows` | Supabase + SAMAS | ✅ |
| Mensajes directos (DMs) | `dm_threads`, `dm_messages` | Supabase + SAMAS | ⚠️ Hoy almacenados en plaintext en DB (con RLS). Sin E2E encryption — gap conocido. |
| Holdings / cost basis / cantidades | `holdings` (qty, avg_cost, currency) | Supabase + SAMAS (en prototipo) → **Broker** (en producción) | ⚠️ En producción el source-of-truth pasa al broker. Hoy es mock. |
| Imágenes de posts | Storage bucket `post-images`, lectura pública, escritura scopeada por carpeta de usuario | Supabase + SAMAS | ✅ |
| Avatares de usuario | **NO se guardan** — solo iniciales + color generado | N/A | ✅ Decisión de producto: bloqueamos uploads para evitar pipeline de moderación de fotos (Apple). |
| Datos de pago (CBU/CVU/CC) | **NO se guardan en SAMAS** | **Broker** | ✅ por diseño: SAMAS no toca datos bancarios. Esos datos viven en el broker. |
| Documentos KYC (DNI, foto) | **NO se guardan en SAMAS** | **Broker** | ✅ por diseño: el broker es el ALyC y le corresponde el KYC regulatorio. |

---

## 4. Datos en tránsito

| Capa | Quién | Estado |
|---|---|---|
| HTTPS cliente ↔ Supabase | Supabase | ✅ Forzado, TLS 1.2+ |
| WSS Realtime (postgres_changes) | Supabase | ✅ |
| Capacitor WebView | Apple + SAMAS | ✅ El bundle se sirve desde el bundle de la app, no desde un origen remoto. |
| Llamadas a Anthropic (IA) | SAMAS | ✅ Server-to-server desde Edge Function. La key NO viaja al cliente. |
| Llamadas a Finnhub (precios) | SAMAS | ✅ Server-to-server. Key en env de Edge Function. |

---

## 5. Plata y transacciones

| Capacidad | Dónde vive | Quién | Estado |
|---|---|---|---|
| Carga de plata por usuario | Hoy: insert mock en `wallet_credits`. Producción: API del broker. | **Broker** (custodia regulatoria) | ⚠️ Prototipo. Cuando integremos con Cohen, todo el flujo de carga pasa por su cashier. |
| Custodia de cash y títulos | **Broker** (ALyC, regulado por CNV) | **Broker** | N/A para SAMAS por diseño |
| Ejecución de órdenes | Hoy: mock en `src/v2/api/broker.js`. Producción: order-routing del broker. | **Broker** | ⚠️ Prototipo |
| Settlement T+2 / liquidación | **Broker** + Caja de Valores | **Broker** | N/A para SAMAS |
| Historia de transacciones (para mostrar en la app) | Mirror local en tabla `orders` + sync desde el broker | **Broker** = source of truth, **SAMAS** = vista | A construir cuando empiece la integración. |
| Reporting fiscal (impuesto cedular, retenciones) | **Broker** | **Broker** | N/A |
| Anti-fraude / monitoreo de patrones | **Broker** + reglas internas del broker | **Broker** | N/A para SAMAS por diseño |
| Límites de operación / circuit breakers | **Broker** | **Broker** | N/A |

---

## 6. Notificaciones / dispositivo

| Capacidad | Dónde vive | Quién | Estado |
|---|---|---|---|
| Push tokens (APNs) | Tabla `user_push_tokens`, RLS por usuario | SAMAS + Apple (delivery) | ✅ Tokens guardados, dispatch por Edge Function `send-push`. |
| Certificado APNs | Apple Developer Account | Apple + SAMAS | ⚠️ Pendiente: emitir certificado de producción + subirlo a Supabase. Bloqueado por Apple Developer cert work. |
| Acceso al portapapeles / cámara / fotos | Solo cuando el usuario lo pide explícitamente para attach a un post | Apple (permisos) + SAMAS | ✅ Permisos solicitados al momento, no al instalar. |
| Almacenamiento local en device | Capacitor Preferences (settings, PIN hash) + WebView localStorage (UI state) | Apple (sandbox) + SAMAS | ✅ Sandboxed por iOS app container. |

---

## 7. Lifecycle de cuenta

| Capacidad | Dónde vive | Quién | Estado |
|---|---|---|---|
| Alta de usuario | Supabase Auth + trigger BEFORE INSERT en `profiles_social` (validación de university email) | SAMAS | ✅ |
| Recuperación de password | Supabase Auth (email link) | Supabase | ✅ |
| Borrado de cuenta ("Borrar mi cuenta") | Edge Function `delete-user-account` | SAMAS | ✅ Cumple Apple Guideline 5.1.1(v). Borrado en cascada de todos los datos del usuario. |
| Exportación de datos ("Descargar mis datos") | Edge Function `export-user-data` | SAMAS | ✅ Devuelve JSON con todos los registros del usuario. Cumple GDPR-style data portability. |
| Cierre de sesión remoto (revocar device) | Pendiente | SAMAS | ❌ Gap. No hay UI para "cerrar sesión en mi otro iPhone". |

---

## 8. Anti-phishing / abuso (red social)

| Capacidad | Dónde vive | Quién | Estado |
|---|---|---|---|
| Verificación de universidad | BEFORE INSERT trigger en `profiles_social` valida domain del email contra allowlist | SAMAS | ✅ Auto-flip, sin intervención manual. |
| Verificación CNV idóneo | Update manual contra el registro público de CNV | SAMAS (manual) | ✅ Flag flippeable solo por service-role. |
| Reportar contenido / usuarios | Tabla `reports` | SAMAS | ✅ Tabla wired. ⚠️ Workflow de revisión humana NO existe todavía (gap). |
| Bloquear usuario / mutear | Pendiente | SAMAS | ❌ Gap. |
| Filtro anti-spam en posts/DMs | Pendiente | SAMAS | ❌ Gap. Sin rate-limiting de mensajes ni filtros de URL maliciosas. |
| Avatares fake (suplantación) | Mitigado por NO permitir uploads de foto — solo iniciales | SAMAS | ✅ Decisión de producto. |

---

## 9. Secretos / claves / config

| Secreto | Dónde vive | Quién rota | Estado |
|---|---|---|---|
| `SUPABASE_ANON_KEY` | En el bundle del cliente (es público por diseño) | Supabase | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | Env de cada Edge Function | SAMAS | ⚠️ **Pendiente rotación** — leak previo en transcript de Claude. |
| Password de la DB | Supabase Dashboard | SAMAS | ⚠️ **Pendiente rotación** — leak previo en transcript de Claude. |
| `ANTHROPIC_API_KEY` | Env de Edge Functions IA | SAMAS | ⚠️ Pendiente: setear en producción cuando Cohen apruebe presupuesto. |
| `FINNHUB_API_KEY` | Env de Edge Function `check-price-alerts` | SAMAS | ✅ |
| Apple Developer cert (build) | macOS Keychain del developer | SAMAS | ✅ |
| Push notification cert (APNs) | Pendiente emitir | SAMAS | ❌ |

---

## 10. Logs / auditoría

| Capacidad | Dónde vive | Quién | Estado |
|---|---|---|---|
| Logs de Edge Functions | Supabase Dashboard, retención 1 semana (plan free) | Supabase | ✅ |
| Logs de Auth (logins, signups, MFA) | Supabase Auth logs | Supabase | ✅ |
| Logs de aplicación (acciones de usuario en app) | ❌ No hay log custom de usuario-acciones (ej. quién compró qué cuándo) | SAMAS | ❌ Gap. En producción esto debería loguearse para cumplimiento + investigación de incidentes. |
| Logs del broker (órdenes ejecutadas) | **Broker** | **Broker** | N/A para SAMAS |
| Alertas de seguridad (fail-login burst, etc.) | Pendiente | SAMAS | ❌ Gap. |

---

## 11. Compliance / regulatorio

| Item | Quién | Estado |
|---|---|---|
| Privacy Manifest (`PrivacyInfo.xcprivacy`) | SAMAS | ❌ Pendiente — requerido por Apple para enviar a App Store. |
| Política de privacidad + Términos | SAMAS | ⚠️ Texto borrador en `LegalSheet`. Necesita pase de abogado antes de soft-launch. |
| Pen test / auditoría externa | SAMAS | ❌ No realizado. |
| Bug bounty program | SAMAS | ❌ No existe. |
| SOC 2 / ISO 27001 | Supabase ya tiene SOC 2 Type II | Supabase | ✅ A nivel proveedor. SAMAS-app-level: no. |
| Cumplimiento CNV (RG broker) | **Broker** | **Broker** | N/A para SAMAS. |
| Régimen de Información (RG AFIP) | **Broker** | **Broker** | N/A para SAMAS. |
| Ley 25.326 de protección de datos personales (AR) | SAMAS + Supabase | ⚠️ Necesita registro de la base ante la Dirección Nacional de Protección de Datos antes del soft-launch. |
| GDPR (si hay usuarios EU) | SAMAS | ⚠️ Tenemos export + delete; falta DPA con Supabase formalizado. |

---

## Resumen: qué hace cada parte

**SAMAS-app es responsable de:**
- Identidad y autenticación de cuenta de la app (no de la cuenta del broker — eso lo maneja el broker)
- Datos de la red social (posts, follows, DMs, perfiles)
- Watchlists, alertas, plan AI
- Datos de presentación de la cartera (vista) — el source-of-truth lo tiene el broker
- Notificaciones push y comunicación con el dispositivo
- Borrado y exportación de datos del usuario (Apple/GDPR)

**El broker (ALyC) es responsable de:**
- KYC / AML / onboarding regulatorio
- Custodia de la plata y los títulos
- Ejecución de órdenes y settlement
- Reporte fiscal y retenciones
- Anti-fraude transaccional
- Cumplimiento ante CNV / AFIP / UIF

**Supabase es responsable de:**
- Cifrado at-rest, backups de DB
- Disponibilidad y patching de Postgres + Edge Function runtime
- Auth (hashing de passwords, MFA TOTP, JWT)
- SOC 2 Type II del proveedor

**Apple es responsable de:**
- Sandboxing de la app en iOS
- Cifrado del Keychain y Secure Enclave (FaceID)
- Delivery de push notifications via APNs

---

## Gaps prioritarios antes del soft-launch

1. **Rotar service-role key + password de DB** (leak conocido)
2. **Privacy Manifest** para App Store
3. **Pase de abogado** sobre política de privacidad y términos
4. **Registro de la base** ante la DNPDP (Ley 25.326)
5. **Workflow de moderación** de los reportes en la red social
6. **Rate limiting** de DMs y posts
7. **Cierre de sesión remoto** desde otro device
8. **Log de acciones de usuario** (auditoría de aplicación)

---

*Doc para revisar antes de la reunión. Si Mattia o el equipo de seguridad
del broker pregunta por algo que no está acá, agregalo y commiteá.*
