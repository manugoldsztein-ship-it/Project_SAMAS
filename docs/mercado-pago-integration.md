# Mercado Pago integration — spec

> Estado: **no implementado**. Este doc detalla qué hay que hacer
> para reemplazar el deposit mock por una integración real con MP.
> Pre-requisito: cuenta MP merchant (Manuel's o Cohen's, según
> quién quede como merchant of record).

## Decisión arquitectónica: Opción A — modelo unificado

Manuel decidió en samas-0.4.13 que SAMAS usa **una sola cuenta**
por usuario: la wallet ES la billetera de inversión. No existe el
concepto de "fondear el comitente" como paso explícito para el
usuario.

Eso significa que **el único flujo de "entrada de plata" para el
usuario es cargar pesos / dólares al wallet**. Una vez ahí, ya
puede operar sin pasos intermedios.

## Flujo de depósito vía MP (spec)

### El happy path desde el usuario

1. Usuario abre Wallet → tap "Cargar"
2. Elige Pesos / Dólares
3. Elige "Mercado Pago"
4. Ingresa monto
5. Tap "Ir a Mercado Pago"
6. SAMAS crea una `payment_preference` en MP, recibe un `init_point`
   URL, redirige al usuario a esa URL (en native: abre en Safari /
   in-app browser via `@capacitor/browser`)
7. Usuario completa el pago en la UI de MP (acepta términos, paga
   con tarjeta / saldo / etc.)
8. MP redirige al usuario de vuelta a SAMAS (`samas://` URL scheme)
9. **Mientras tanto** MP hace POST al webhook de SAMAS con
   `topic=payment` y el `id` del pago
10. Webhook valida la firma, llama a la API de MP para confirmar el
    pago (`GET /v1/payments/{id}`), inserta un row en `wallet_credits`
    con `source='manual'` (o nuevo `source='mp_deposit'`)
11. Trigger `wallet_credits_propagate` lo convierte en transactions
    row → trigger `transactions_to_balance` actualiza accounts
12. Realtime sub en Wallet (samas-0.4.10) recibe el INSERT y
    refresca → balance + Movimientos actualizados al instante

## Lo que hay que construir

### 1. Setup en MP

- Crear la app en `https://www.mercadopago.com.ar/developers`
- Obtener `ACCESS_TOKEN` (sandbox + producción)
- Whitelist el webhook URL: `https://diulqkaorfqccipguiok.supabase.co/functions/v1/mp-webhook`
- Whitelist los redirect URLs: `samas://payment/success`, `samas://payment/failure`, `samas://payment/pending`

Variables a setear en Supabase Dashboard → Edge Functions → Manage Secrets:
```
MP_ACCESS_TOKEN_PROD=APP_USR-...
MP_ACCESS_TOKEN_SANDBOX=TEST-...
MP_WEBHOOK_SECRET=...
```

### 2. Edge Function `mp-create-preference`

Reemplaza el mock `walletApi.deposit({source:'mp'})`. Cliente JWT-
authed; server crea la preferencia.

```ts
// supabase/functions/mp-create-preference/index.ts
serve(async (req) => {
  const { amount, currency } = await req.json();
  const userId = await getUserFromJWT(req);
  const idempotencyKey = crypto.randomUUID();

  const r = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${MP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({
      items: [{
        title: `SAMAS — Carga de saldo`,
        quantity: 1,
        unit_price: amount,
        currency_id: currency,
      }],
      back_urls: {
        success: `samas://payment/success`,
        failure: `samas://payment/failure`,
        pending: `samas://payment/pending`,
      },
      auto_return: "approved",
      external_reference: `samas:user:${userId}:${idempotencyKey}`,
      notification_url: `${SUPABASE_URL}/functions/v1/mp-webhook`,
      // Used by the webhook to know whose wallet to credit.
      metadata: {
        samas_user_id: userId,
        samas_amount: amount,
        samas_currency: currency,
      },
    }),
  });

  if (!r.ok) return new Response(JSON.stringify({ error: "MP rechazó" }), { status: 502 });
  const pref = await r.json();
  return new Response(JSON.stringify({
    initPoint: pref.init_point,
    preferenceId: pref.id,
  }));
});
```

### 3. Edge Function `mp-webhook`

Recibe los `topic=payment` notifications de MP, verifica el pago,
acredita.

Crítico: **siempre verificar contra la API de MP** — no confiar
en el body del webhook directamente, está sin firmar útilmente.
Tampoco acreditar más de una vez (idempotencia por
`payment.id`).

```ts
// supabase/functions/mp-webhook/index.ts
serve(async (req) => {
  // MP envía POST con query string ?topic=payment&id=PAYMENT_ID
  // o body { topic: "payment", id: "..." }. Aceptar ambos.
  const body = await req.json().catch(() => ({}));
  const url = new URL(req.url);
  const topic = body.topic || url.searchParams.get("topic");
  const paymentId = body.id || url.searchParams.get("id");

  if (topic !== "payment" || !paymentId) {
    return new Response("ok", { status: 200 }); // ignore non-payment
  }

  // Idempotency: skip if we've already processed this payment.
  const { data: existing } = await admin
    .from("mp_processed_payments")
    .select("id").eq("mp_payment_id", paymentId).maybeSingle();
  if (existing) return new Response("ok", { status: 200 });

  // Fetch authoritative payment data from MP.
  const r = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { "Authorization": `Bearer ${MP_ACCESS_TOKEN}` },
  });
  if (!r.ok) return new Response("err", { status: 502 });
  const payment = await r.json();

  if (payment.status !== "approved") {
    // Pending / rejected — log, don't credit.
    return new Response("ok", { status: 200 });
  }

  // Extract our metadata (set in mp-create-preference).
  const userId = payment.metadata?.samas_user_id;
  const amount = Number(payment.metadata?.samas_amount);
  const currency = payment.metadata?.samas_currency;
  if (!userId || !amount || !currency) {
    return new Response("missing-metadata", { status: 400 });
  }

  // Credit. wallet_credits trigger propagates to transactions +
  // accounts.balance. Realtime sub on the user's Wallet picks it
  // up live.
  await admin.from("wallet_credits").insert({
    user_id: userId,
    source: "manual",
    amount, currency,
    note: `MP payment ${paymentId}`,
  });
  await admin.from("mp_processed_payments").insert({
    mp_payment_id: paymentId,
    user_id: userId,
    amount, currency,
    processed_at: new Date().toISOString(),
  });

  return new Response("ok", { status: 200 });
});
```

### 4. New table `mp_processed_payments`

Idempotency log. One row per processed MP payment ID; webhook
checks before crediting to avoid double-charges on MP's
multiple-delivery webhook contract.

```sql
create table public.mp_processed_payments (
  id              uuid primary key default gen_random_uuid(),
  mp_payment_id   text not null unique,
  user_id         uuid not null references auth.users(id),
  amount          numeric(18,2) not null,
  currency        text not null check (currency in ('ARS','USD')),
  processed_at    timestamptz not null default now()
);
```

### 5. Client wiring

Update `src/v2/api/wallet.js` deposit:

```js
export async function deposit({ amount, ccy, source }) {
  if (source !== "mp") return depositTransfer({ amount, ccy }); // existing mock
  // Real MP flow.
  const { data, error } = await supabase.functions.invoke("mp-create-preference", {
    body: { amount, currency: ccy },
  });
  if (error) throw new Error(error.message);
  // Open MP checkout. Native: in-app browser. Web: redirect.
  if (window.Capacitor?.isNativePlatform()) {
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url: data.initPoint });
  } else {
    window.location.href = data.initPoint;
  }
  // Don't return a fake txnId — the webhook will credit when the
  // user completes the payment. The Wallet's realtime sub picks it up.
  return { redirectUrl: data.initPoint };
}
```

### 6. Deep-link handler

`samas://payment/success` should:
- Close the in-app browser
- Show a "Plata acreditándose…" toast
- The realtime sub on Wallet will fire when the webhook lands

Already have `appUrlOpen` listener in `src/lib/native.js` from the
0.1.5 OAuth wiring — just need to add a `samas://payment/...`
case.

## What the user sees

| Step | What happens |
|---|---|
| Tap "Cargar" → "Mercado Pago" → ingresar monto → "Ir a MP" | DepositModal closes, browser opens MP checkout |
| Pagar en MP | User completes the flow on MP's site |
| Volver | Browser auto-closes via `samas://payment/success` deep-link, toast "Plata acreditándose…" |
| ~5 segundos después | Webhook lands → wallet_credits insert → triggers fire → realtime sub on Wallet refreshes → balance + Movimientos updated. Toast "✓ Plata acreditada." |

## Costo MP

- **Comisión por pago aprobado**: ~3.5-5.5% por tarjeta de crédito (más + IVA)
- **Acreditación instantánea**: extra ~1.5%
- **Por dinero en cuenta MP / efectivo (RapiPago, PagoFácil)**: ~2-2.5%

Esto lo paga SAMAS o lo trasladamos al usuario. Para el demo
asumimos que SAMAS lo absorbe. En producción negociar con MP la
tarifa especial para fintechs / brokers.

## Tiempo estimado

- Setup MP merchant + sandbox testing: 2-4 horas
- mp-create-preference Edge Function: 1 hora
- mp-webhook Edge Function: 2-3 horas (lo más delicado)
- Idempotency table + migration: 30 min
- Client wiring: 30 min
- Deep-link handler: 30 min
- End-to-end testing en sandbox: 2-3 horas
- Producción rollout + smoke tests: 1 hora

**Total: ~1 día de trabajo concentrado.**

## Cuándo hacerlo

NO antes de la pitch a Cohen. Razones:
1. El demo con plata mock ya funciona (instantáneo, predecible).
2. MP en producción introduce un montón de variables nuevas
   (rate limits, falla de webhook, payment statuses raros) que no
   querés debugear durante la pitch.
3. Cohen probablemente prefiera que SU rail (no MP directo) sea
   el que acredite, ya que ellos son el ALyC. Construir esto
   ahora podría ser trabajo tirado.

Mejor approach: **mock que funciona** + **este doc bien
escrito** = demuestra a Cohen que entendemos la integración sin
quemar tiempo en código que tirás.
