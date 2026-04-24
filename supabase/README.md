# Supabase setup

Este directorio contiene el schema y la configuración para el backend de SAMAS
(Postgres + auth managed por Supabase).

## 1. Correr el schema inicial

La primera vez:

1. Abrí el dashboard del proyecto → **SQL Editor** → **New query**.
2. Pegá el contenido completo de `schema.sql`.
3. Run (botón verde arriba a la derecha, o ⌘+Enter).

Deberías ver "Success. No rows returned" al pie. Si tira error de "relation
already exists", es porque ya corrió antes — no pasa nada, seguí adelante.

Para verificar que quedó bien, andá a **Table Editor** (ícono de tabla a la
izquierda) y confirmá que aparecen: `profiles`, `accounts`, `holdings`,
`orders`, `transactions`, `watchlists`, `watchlist_tickers`, `plans`,
`broker_links`.

## 2. Configurar auth por email

1. **Authentication → Providers → Email** → dejá activado, confirmá que
   "Enable email confirmations" esté en ON.
2. **Authentication → URL Configuration** → en "Site URL" poné
   `http://localhost:5173` (para dev). En "Redirect URLs" agregá la misma
   URL. Cuando tengas un dominio de producción lo sumás.

## 3. Configurar SMS OTP con Twilio

Necesitás una cuenta de Twilio (twilio.com/try-twilio). Del dashboard:

- Account SID (empieza con `AC...`)
- Auth Token
- Un número comprado o el trial number (de los settings de la cuenta)

En Supabase:

1. **Authentication → Providers → Phone** → Enable.
2. SMS Provider: Twilio.
3. Pegá Account SID, Auth Token, y el número en "Twilio Phone Number" (con
   formato internacional, ej. `+15551234567`).
4. Save.

**Importante sobre costos:** cada SMS a Argentina sale ~USD 0.06. Twilio te
da ~$15 USD de crédito inicial (unos 250 SMS a AR), alcanza para el demo y
early users.

## 4. (Opcional) Políticas de seguridad adicionales

Cuando tengas usuarios reales, vale la pena agregar en Supabase dashboard:

- **Authentication → Rate Limits** → bajá el límite de signups por IP si
  ves abuso.
- **Database → Backups** → encender backups diarios (requiere plan Pro).
- **Project Settings → API → Allowed Origins** → restringí a tus dominios
  cuando salgas a producción.

## 5. Rotar credenciales

Si alguna vez tenés que rotar las API keys:

1. **Project Settings → API → API Keys** → rotate.
2. Actualizá `src/lib/supabase.js` con la nueva publishable key.
3. Rebuild + redeploy.

La `secret_key` no toca el cliente nunca; si la necesitás (scripts, Edge
Functions) guardala en variables de entorno del server.
