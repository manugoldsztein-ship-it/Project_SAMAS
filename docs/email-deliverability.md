# Email deliverability — Resend + custom Supabase SMTP

> Stage: **plan, not yet executed**. Pre-requisite: own `samas.lat`
> (or your final domain). Once the domain DNS is configurable,
> this doc walks you through wiring Resend → Supabase Auth →
> branded SAMAS emails landing in user inboxes (not spam).

## Why this matters

Today, Supabase Auth sends signup confirmation + password reset
emails using its own SMTP relay. The "from" address looks like
`noreply@mail.app.supabase.io`. Two problems:

1. **Spam folder rate is meh.** Gmail accepts most of them but
   classifies a non-trivial chunk as spam. iCloud is worse.
2. **Branding is broken.** Email from "SAMAS" arriving from
   `supabase.io` looks like a phishing attempt to anyone paying
   attention. A Cohen dev opening that email = bad first impression.

The fix is custom SMTP via a transactional email provider. Resend
is the cleanest of the modern options (Postmark and SendGrid also
work, slightly more setup).

## Cost

| Item | Cost |
|---|---|
| Resend free tier | 0 (3,000 emails/month, 100/day) |
| Domain (`samas.lat` first year) | USD 1.80 |
| Domain (`samas.com.ar` peso-priced) | ~AR$ 8,000/year |

Total: ~USD 2 for first year if you stay on `.lat`. Migrate to
`.com.ar` once you have it; only DNS records change.

## End-to-end procedure

### 1. Resend account + sender domain

```
# Mac browser
open https://resend.com/signup
```

1. Sign up with your email (no card needed for free tier).
2. Once logged in, **Domains** → **Add Domain** → type `samas.lat`
   (or whatever you bought).
3. Resend shows you 4 DNS records you need to add to your domain.
   Don't close the page yet.

### 2. Add DNS records to your domain registrar

Each registrar has a different DNS UI. For Namecheap:
**Domain List → Manage → Advanced DNS → Add New Record**.

You'll add 4 records exactly as Resend dictates:

| Type | Host | Value | Notes |
|---|---|---|---|
| MX  | `send` | `feedback-smtp.us-east-1.amazonses.com` (priority 10) | Resend's bounce-handling domain |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | SPF for Resend |
| TXT | `resend._domainkey` | `p=MII...` (long Resend-generated key) | DKIM signing key |
| TXT | `_dmarc` | `v=DMARC1; p=none;` | DMARC tracking, permissive policy at start |

Save. DNS propagation: 5-30 minutes typically, can take up to 48h
worst case. Keep the Resend "Verify" button handy.

### 3. Verify domain in Resend

Back in Resend → Domains → Click "Verify" next to your domain.
If all 4 records propagated correctly, you'll see a green check.
If not, wait 10 min and try again.

### 4. Generate Resend API key

Resend → **API Keys** → **Create API Key**.
- Name: `SAMAS Supabase Auth`
- Permission: **Sending access**, restrict to your domain
- Copy the key (starts with `re_`). You won't see it again.

### 5. Configure Supabase Auth SMTP

Supabase Dashboard → your project → **Authentication → Settings →
SMTP Settings → Enable Custom SMTP**.

Fill exactly:

| Field | Value |
|---|---|
| Sender email | `noreply@samas.lat` (or your domain) |
| Sender name | `SAMAS` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` (literal string, not a variable) |
| Password | your `re_...` API key from step 4 |

Save. Supabase will run a sanity check; if creds are wrong it
errors immediately.

### 6. Customize email templates (this is the branding win)

Supabase Dashboard → **Authentication → Email Templates**. There
are 5 templates. Replace the default Supabase-branded HTML with
the SAMAS-branded versions below.

Each template uses Supabase's variable syntax (`{{ .ConfirmationURL }}`,
`{{ .Email }}`, etc.). Don't change the variable names — Supabase
substitutes them at send time.

#### Confirm signup template

**Subject**: `Confirmá tu cuenta SAMAS`

**Body** (HTML):

```html
<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>Confirmá tu cuenta</title></head>
<body style="margin:0; padding:32px 16px; background:#0D1117; font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif; color:#F7F7F5;">
  <table align="center" width="520" style="max-width:520px; margin:0 auto;">
    <tr><td>
      <div style="font-size:24px; font-weight:800; letter-spacing:-0.5px; color:#F7F7F5; margin-bottom:24px;">SAMAS</div>
      <h1 style="font-size:22px; font-weight:700; color:#F7F7F5; line-height:1.3; margin:0 0 12px;">Confirmá tu cuenta</h1>
      <p style="font-size:14px; line-height:1.6; color:#9CA3AF; margin:0 0 24px;">
        Hola, gracias por registrarte. Tocá el botón para confirmar tu email y empezar a usar SAMAS.
      </p>
      <a href="{{ .ConfirmationURL }}" style="display:inline-block; padding:14px 24px; background:#16C784; color:#06180c; text-decoration:none; font-weight:800; border-radius:12px; font-size:14px;">Confirmar mi cuenta</a>
      <p style="font-size:12px; line-height:1.5; color:#6B7280; margin:32px 0 0;">
        Si no creaste esta cuenta, podés ignorar este email — no se va a activar nada.
      </p>
      <p style="font-size:11px; line-height:1.4; color:#4B5563; margin:24px 0 0;">
        Si el botón no funciona, copiá este link en tu navegador:<br>
        <span style="word-break:break-all; color:#9CA3AF;">{{ .ConfirmationURL }}</span>
      </p>
      <hr style="border:none; border-top:1px solid #1F2937; margin:32px 0 16px;">
      <p style="font-size:10px; color:#4B5563; margin:0;">
        SAMAS — Inversiones en Argentina. Este email se envió a {{ .Email }} porque iniciaste el registro en la app.
      </p>
    </td></tr>
  </table>
</body>
</html>
```

#### Reset password template

**Subject**: `Reseteá tu contraseña SAMAS`

**Body**:

```html
<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>Reseteá tu contraseña</title></head>
<body style="margin:0; padding:32px 16px; background:#0D1117; font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif; color:#F7F7F5;">
  <table align="center" width="520" style="max-width:520px; margin:0 auto;">
    <tr><td>
      <div style="font-size:24px; font-weight:800; letter-spacing:-0.5px; color:#F7F7F5; margin-bottom:24px;">SAMAS</div>
      <h1 style="font-size:22px; font-weight:700; color:#F7F7F5; line-height:1.3; margin:0 0 12px;">Reseteá tu contraseña</h1>
      <p style="font-size:14px; line-height:1.6; color:#9CA3AF; margin:0 0 24px;">
        Recibimos un pedido para resetear la contraseña de tu cuenta SAMAS. Tocá el botón para elegir una nueva.
      </p>
      <a href="{{ .ConfirmationURL }}" style="display:inline-block; padding:14px 24px; background:#16C784; color:#06180c; text-decoration:none; font-weight:800; border-radius:12px; font-size:14px;">Elegir nueva contraseña</a>
      <p style="font-size:12px; line-height:1.5; color:#6B7280; margin:32px 0 0;">
        Si no pediste resetear tu contraseña, ignorá este email. La actual sigue funcionando.
      </p>
      <p style="font-size:12px; line-height:1.5; color:#6B7280; margin:8px 0 0;">
        Por seguridad, este link expira en 1 hora.
      </p>
      <hr style="border:none; border-top:1px solid #1F2937; margin:32px 0 16px;">
      <p style="font-size:10px; color:#4B5563; margin:0;">
        SAMAS — Inversiones en Argentina. Email enviado a {{ .Email }}.
      </p>
    </td></tr>
  </table>
</body>
</html>
```

#### Magic link template

**Subject**: `Tu link de acceso a SAMAS`

**Body**:

```html
<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>Link de acceso</title></head>
<body style="margin:0; padding:32px 16px; background:#0D1117; font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif; color:#F7F7F5;">
  <table align="center" width="520" style="max-width:520px; margin:0 auto;">
    <tr><td>
      <div style="font-size:24px; font-weight:800; letter-spacing:-0.5px; color:#F7F7F5; margin-bottom:24px;">SAMAS</div>
      <h1 style="font-size:22px; font-weight:700; color:#F7F7F5; line-height:1.3; margin:0 0 12px;">Entrá a SAMAS</h1>
      <p style="font-size:14px; line-height:1.6; color:#9CA3AF; margin:0 0 24px;">
        Tocá el botón para entrar a tu cuenta. No necesitás contraseña.
      </p>
      <a href="{{ .ConfirmationURL }}" style="display:inline-block; padding:14px 24px; background:#16C784; color:#06180c; text-decoration:none; font-weight:800; border-radius:12px; font-size:14px;">Entrar a SAMAS</a>
      <p style="font-size:12px; line-height:1.5; color:#6B7280; margin:32px 0 0;">
        Este link expira en 1 hora y solo se puede usar una vez. Si vos no pediste entrar, ignorá este email.
      </p>
      <hr style="border:none; border-top:1px solid #1F2937; margin:32px 0 16px;">
      <p style="font-size:10px; color:#4B5563; margin:0;">
        SAMAS — Inversiones en Argentina. Email enviado a {{ .Email }}.
      </p>
    </td></tr>
  </table>
</body>
</html>
```

Other templates (`Invite user`, `Change email`) — leave at defaults
for now. We don't currently surface those flows.

### 7. Test deliverability

After saving the SMTP config + templates:

1. Sign out of SAMAS (if logged in).
2. Sign up with a fresh email (a real Gmail you control + a "+test"
   alias is the easiest: `you+samas-test1@gmail.com`).
3. Check inbox within 30 seconds.
4. Verify:
   - Sender shows as `SAMAS <noreply@samas.lat>`
   - Lands in inbox, not spam
   - Confirm button works → opens SAMAS app via deep link
   - Branded styling renders (green button on dark background)
5. Repeat with iCloud (most aggressive spam filter) and Yahoo.

If any go to spam: check **mxtoolbox.com** for SPF/DKIM/DMARC
alignment. Resend's domain page also shows you which records are
verified vs failed.

## Production hardening (post-pitch)

When you go from prototype to launch, also do:

- **DMARC strict policy**: change `p=none` → `p=quarantine` after
  2-4 weeks of monitoring (the `none` mode lets you see who's
  spoofing your domain without blocking them; `quarantine` then
  starts pushing spoofers to spam folders).
- **BIMI** (Brand Indicators for Message Identification): adds
  your logo next to the email in Gmail. Requires a verified
  trademark or a verified company. Skip until launch.
- **Reply-to address**: if you want users to be able to reply (e.g.
  to a support address), set `reply-to: hola@samas.lat` in
  Supabase. Currently default is no-reply.
- **Plaintext fallback**: Supabase's template editor only takes
  HTML. Most modern clients render HTML fine; if you ever see
  "this email is HTML-only" warnings, you'd need to add
  `text/plain` versions. Not urgent.

## When you migrate to `samas.com.ar`

DNS records are identical — re-add the 4 Resend records to the
new domain's DNS, verify in Resend, then in Supabase Dashboard
update the **Sender email** field from `noreply@samas.lat` →
`noreply@samas.com.ar`. Save. New emails immediately come from
the new domain. Existing reset-password / signup links sent before
the change still work (their tokens are valid, they're just stamped
with the older sender).

15-second config change. The two domains can coexist (forward
both to the same content) for as long as you want.
