# Supabase + Twilio setup

Backend de SAMAS. Postgres managed + auth + Edge Functions en Supabase.
Verificación por WhatsApp con OTP custom vía Twilio Messaging API.

## 1. Aplicar el schema

Una vez, desde el dashboard de Supabase → **SQL Editor** → **New query**:

1. Pegá el contenido completo de `schema.sql` → Run.
2. Pegá el contenido de `otp_codes.sql` → Run.
3. Pegá el contenido de `ui_mode.sql` → Run.

Deberías ver "Success. No rows returned" en cada uno. Verificá en **Table
Editor** que están: `profiles`, `accounts`, `holdings`, `orders`,
`transactions`, `watchlists`, `watchlist_tickers`, `plans`, `broker_links`,
`otp_codes` y la vista `portfolio_summary`.

Si re-corrés y tira "relation already exists", ignoralo — esos archivos
usan `create table if not exists` / `add column if not exists` cuando es
posible, pero algunos statements son idempotentes por error (el re-run
falla pero no daña nada).

## 2. Configurar auth email + URLs

En el dashboard:

- **Authentication → Providers → Email** → activado + "Confirm email" ON.
- **Authentication → URL Configuration:**
  - Site URL: `http://localhost:5173` (dev).
  - Redirect URLs: agregá `http://localhost:5173/**`.
  - Cuando tengas dominio de producción (ej. `app.samas.com.ar`), sumalo
    a Redirect URLs y cambiá Site URL.

## 3. WhatsApp OTP — sandbox (desarrollo)

Para desarrollar y demos internos usamos el sandbox compartido de Twilio.
Los códigos se mandan desde el número `+1 415 523 8886` con remitente
"Twilio" en WhatsApp (es un nombre genérico del sandbox — ver sección 4
para producción).

### 3.1 Crear cuenta Twilio trial

1. twilio.com/try-twilio → signup con email + verificación.
2. Anotá del dashboard de Twilio:
   - **Account SID** (`AC...`)
   - **Auth Token** (click Show para revelarlo)

### 3.2 Joinear el sandbox de WhatsApp

1. Twilio Console → **Messaging → Try it out → Send a WhatsApp message**.
2. Vas a ver un número (`+1 415 523 8886`) y un código `join <dos-palabras>`.
3. Desde tu WhatsApp, mandale ese texto exacto al número.
4. Twilio responde `"Twilio Sandbox: You are all set!"` = listo para recibir.

*Importante:* el sandbox solo entrega a números que hicieron `join`. En dev
solo vas a poder testear con tu número propio. Para producción real, ver
sección 4.

### 3.3 Cargar secrets en Supabase

Edge Functions → **Secrets** → agregar estos tres:

| Name | Value |
|---|---|
| `TWILIO_ACCOUNT_SID` | tu Account SID (empieza con `AC`) |
| `TWILIO_AUTH_TOKEN` | tu Auth Token |

Opcionalmente:

| Name | Value |
|---|---|
| `TWILIO_WHATSAPP_FROM` | dejalo vacío en sandbox (default: `whatsapp:+14155238886`) |

*Nota:* la versión vieja del código usaba Twilio Verify con un
`TWILIO_VERIFY_SERVICE_SID` secret. Ya no se usa — se puede borrar.

### 3.4 Deploy de las Edge Functions

Dos caminos:

**CLI (recomendado):**

```bash
brew install supabase/tap/supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase functions deploy send-otp
supabase functions deploy verify-otp
```

**Dashboard web editor:**

Edge Functions → **Deploy a new function** → Via Editor → name:
`send-otp` → pegar contenido de `functions/send-otp/index.ts` → Deploy.
Repetir para `verify-otp`.

## 4. WhatsApp OTP — producción (sender propio "SAMAS")

Para que el WhatsApp llegue con remitente **"SAMAS"** en vez de "Twilio"
genérico, hay que salir del sandbox y registrar un sender dedicado. Es
una restricción anti-impersonación de Meta — no se puede mover sin
certificación.

### 4.1 Pre-requisitos

- **Cuenta Twilio paga.** Upgrade desde Console → Billing → Upgrade. Un
  depósito mínimo (~$20 USD) desbloquea el envío sin Verified Caller IDs.
- **Facebook Business Manager account** a nombre del negocio.
  business.facebook.com → Create Account → llenar datos (nombre, email,
  sitio web si lo tenés). Gratis.
- **Número de teléfono dedicado** — o uno que comprás a Twilio (Console
  → Phone Numbers → Buy a number), o uno propio que quieras portar. No
  puede tener WhatsApp personal previamente registrado en él (si sí,
  desregistralo antes).
- **Documentación del negocio** — algún comprobante (factura de servicios
  a nombre de la empresa, registro público, etc.) que Meta pueda usar
  para verificar existencia.

### 4.2 Solicitar el sender

1. Twilio Console → **Messaging → Senders → WhatsApp senders** →
   **Request Access** o **Create new**.
2. Elegís el número dedicado.
3. Completás el form:
   - **Display name:** `SAMAS` (este es el nombre que va a aparecer en
     los chats como remitente)
   - **Category:** Financial services
   - **Profile picture:** logo de SAMAS (cuadrado, >640×640px)
   - **Business description:** qué hace SAMAS en una línea
   - **Website:** URL pública del producto (obligatorio)
   - **Facebook Business Manager ID:** el ID de tu Business Manager
     (aparece en Business Settings → Business info)
4. Submit. Twilio reenvía la solicitud a Meta.

### 4.3 Verificación de Meta

Meta revisa:
- Que el negocio exista (checkeo contra tu Facebook Business).
- Que el display name no imita marca ajena.
- Que la categoría sea correcta.
- A veces pide documentos adicionales — suben por un portal que te
  abre Meta en tu email.

**Tiempo de aprobación:** 24hs a 2 semanas según complejidad. Historial
típico argentino: ~5-7 días hábiles.

### 4.4 Switch a producción

Cuando Meta aprueba, Twilio te avisa por email. En ese momento:

1. **Supabase → Edge Functions → Secrets** → agregá (o edit) el secret:
   ```
   TWILIO_WHATSAPP_FROM = whatsapp:+<tu-numero-aprobado>
   ```
   *(Con el `whatsapp:` prefix y el número en formato E.164.)*

2. Las Edge Functions no necesitan re-deploy — el código ya lee el env var:
   ```ts
   Deno.env.get("TWILIO_WHATSAPP_FROM") ?? "whatsapp:+14155238886"
   ```

3. Próximo OTP sale desde el número nuevo, con display name "SAMAS" + tu
   logo. Los usuarios ya **no** necesitan hacer `join <palabras>` — pueden
   recibir mensajes sin joinear nada.

### 4.5 Costos en producción

Precio por WhatsApp categoría "utility" (OTPs entran acá):
- **Argentina:** ~USD 0.005/mensaje
- **1000 OTPs/mes:** ~$5 USD
- **10k OTPs/mes:** ~$50 USD

Meta introduce cambios de pricing anuales — ver twilio.com/whatsapp/pricing
para el número al día.

## 5. Políticas de seguridad

Una vez en prod con usuarios reales:

- **Authentication → Rate Limits** → ajustar límite de signups por IP
  para prevenir abuso.
- **Database → Backups** → encender backups diarios (requiere plan Pro).
- **Project Settings → API → Allowed Origins** → restringir a los
  dominios de producción (ej. `https://app.samas.com.ar`).
- **Edge Functions → Secrets** → rotar `TWILIO_AUTH_TOKEN` cada 90 días.

## 6. Rotar credenciales Supabase

Si hay que rotar las API keys públicas:

1. **Project Settings → API → API Keys → Rotate**.
2. Actualizar `src/lib/supabase.js` con la nueva publishable key.
3. Rebuild + redeploy del front.
4. Rotar también `TWILIO_AUTH_TOKEN` en Twilio Console si el cambio se
   debe a una exposición (es sinergia: si la publishable key se
   comprometió, asumí que lo demás también).

La `secret_key` de Supabase (service_role) **nunca** va al cliente. Solo
en Edge Functions como env var auto-provisionada — no hay que cargarla
manualmente.
