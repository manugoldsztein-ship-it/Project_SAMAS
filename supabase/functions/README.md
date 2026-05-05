# Supabase Edge Functions

Dos functions en Deno para el flow de verificación por WhatsApp:

- `send-otp` — arranca una verificación vía Twilio Verify (canal WhatsApp)
- `verify-otp` — chequea el código; si es válido, marca `profiles.phone_verified = true`

Ambas leen los tres secrets de Supabase (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`) y validan que el caller tenga una sesión JWT activa.

## Deploy (dos caminos)

### Camino A — Supabase CLI desde tu Mac (recomendado)

Instalá el CLI (una vez):

```bash
brew install supabase/tap/supabase
```

Logueate y linkeá el proyecto (una vez):

```bash
supabase login                           # abre el browser
supabase link --project-ref ldwqgcnhgwtedeealhmg
```

Deploy (cada vez que cambien las functions):

```bash
cd /path/to/Project_SAMAS
supabase functions deploy send-otp
supabase functions deploy verify-otp
```

El CLI se encarga de subir el código y bundlear las deps de Deno. Tardan ~30s cada una.

### Camino B — Copiar y pegar en el dashboard

1. Dashboard Supabase → **Edge Functions** → **Create a new function**.
2. Name: `send-otp` → Create.
3. Copiá el contenido de `send-otp/index.ts` y pegalo en el editor del dashboard.
4. Deploy (botón arriba a la derecha).
5. Repetí para `verify-otp`.

Más lento para iterar pero no requiere instalar nada.

## Probar manualmente

Desde la consola del browser con un user logueado:

```js
// Iniciar verificación
const { data: sessionData } = await supabase.auth.getSession();
const token = sessionData.session.access_token;
await fetch(
  "https://ldwqgcnhgwtedeealhmg.supabase.co/functions/v1/send-otp",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ phone: "+5491112345678" }),
  },
).then(r => r.json()).then(console.log);
// → { status: "pending", to: "+5491112345678" }
```

El código debería llegar por WhatsApp en segundos (siempre que el número esté joineado al sandbox durante dev).

```js
// Verificar el código recibido
await fetch(
  "https://ldwqgcnhgwtedeealhmg.supabase.co/functions/v1/verify-otp",
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ phone: "+5491112345678", code: "123456" }),
  },
).then(r => r.json()).then(console.log);
// → { verified: true, status: "approved" }
```
