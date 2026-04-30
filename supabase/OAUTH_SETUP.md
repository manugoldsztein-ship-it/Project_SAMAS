# OAuth Setup — Continuar con Google / Continuar con Apple

The auth screen has both buttons wired (samas-0.1.3) but the providers
need to be configured server-side before they actually work. Until
then, tapping the buttons surfaces "Próximamente — habilitando…"
inline.

This doc is the complete walk-through for flipping them on.

---

## What's already done

- `OAuthButtons` component in `src/auth/SupabaseAuth.jsx` — Apple
  (black, official glyph) + Google (white, multi-color G logo) with
  inline error handling.
- Wired into both `LoginView` and `SignupView`.
- Calls `supabase.auth.signInWithOAuth({ provider, options: { redirectTo } })`.
- Catches "provider not enabled" and shows a friendly "próximamente"
  message instead of a raw Supabase error.

## What you need to do

### 1. Google OAuth (~15 min)

1. Go to <https://console.cloud.google.com/>.
2. Create a new project (or pick the existing SAMAS one).
3. APIs & Services → OAuth consent screen.
   - User type: **External**.
   - App name: **SAMAS**.
   - Support email + developer email: yours.
   - Save & continue through Scopes and Test users (just save and continue).
4. APIs & Services → Credentials → **Create Credentials → OAuth client ID**.
   - Application type: **Web application**.
   - Name: `SAMAS Supabase OAuth`.
   - Authorized redirect URIs:
     ```
     https://diulqkaorfqccipguiok.supabase.co/auth/v1/callback
     ```
5. Save. Copy the **Client ID** and **Client secret**.
6. In Supabase Dashboard:
   - Authentication → Providers → **Google**.
   - Toggle **Enable**.
   - Paste the Client ID + Client secret.
   - Save.

After that, "Continuar con Google" works in the web preview AND in any
WebView that can load `https://accounts.google.com`.

### 2. Apple Sign-In (~30 min, requires Apple Developer membership)

Apple's App Store guideline 4.8 says any iOS app with third-party
login MUST also offer Sign in with Apple. So if Google is on, Apple
must be on.

1. <https://developer.apple.com/account>.
2. Certificates, Identifiers & Profiles → **Identifiers** → **+**.
3. Pick **Services IDs** → continue.
4. Description: `SAMAS Web Auth`. Identifier: `app.samas.broker.web`.
5. Enable **Sign in with Apple** → Configure.
   - Primary App ID: `app.samas.broker` (the iOS app).
   - Domains: `diulqkaorfqccipguiok.supabase.co`.
   - Return URLs: `https://diulqkaorfqccipguiok.supabase.co/auth/v1/callback`.
   - Save.
6. Back in Identifiers, create a **Key** for Sign in with Apple:
   - Keys → **+**.
   - Name: `SAMAS Apple Sign-In`.
   - Enable **Sign in with Apple** → Configure → Primary App ID
     `app.samas.broker`.
   - Continue → Register.
   - **Download the `.p8` key file** — you can only do this once.
7. Note your **Team ID** (top-right of the dev portal) and the **Key ID**
   (shown when you created the key).
8. Build the JWT secret. Apple's signing flow requires a JWT signed
   with your `.p8` key. Easiest path: use Supabase's auto-generation —
   in Supabase Dashboard → Auth → Providers → Apple, you can paste:
   - Services ID: `app.samas.broker.web`
   - Team ID: from step 7
   - Key ID: from step 7
   - Private Key: paste the contents of the `.p8` file
   Supabase signs the JWT for you.
9. Toggle **Enable**. Save.

### 3. Update Supabase Site URL

Authentication → URL Configuration → **Site URL**.

Currently: `http://localhost:5173/`.

Set to your production domain (or leave localhost for now if you're
still demoing locally). The OAuth providers redirect to
`{site_url}/...` after auth, so this needs to match your deployment.

For the Capacitor-built iOS app, the native flow needs a URL scheme —
see "Native iOS deep linking" below.

---

## Native iOS deep linking (post-Cohen, when needed)

Web OAuth via Capacitor's WKWebView technically works (Google/Apple
load fine), but the polished native experience uses the system browser
+ a deep link back to the app:

1. Install `@capacitor/browser` (`npm i @capacitor/browser`).
2. Add to `ios/App/App/Info.plist`:
   ```xml
   <key>CFBundleURLTypes</key>
   <array>
     <dict>
       <key>CFBundleURLName</key>
       <string>app.samas.broker</string>
       <key>CFBundleURLSchemes</key>
       <array><string>samas</string></array>
     </dict>
   </array>
   ```
3. In `OAuthButtons`, change `redirectTo` to `samas://auth/callback`.
4. Add a Capacitor `App.addListener('appUrlOpen', ...)` handler at
   the SamasShell root that calls
   `supabase.auth.exchangeCodeForSession(code)` when the URL opens.
5. Add `samas://auth/callback` to the Supabase project's
   "Additional Redirect URLs" allow-list.

This gives you a native Sign-in-with-Apple sheet (the Apple credential
manager) instead of the WebView form. Worth doing before App Store
submission but not blocking the Cohen demo.

---

## Smoke test

1. Open the app, tap **Crear cuenta** (or **Iniciá sesión**).
2. Tap **Continuar con Google**.
   - Before config: inline message "Próximamente — habilitando…".
   - After config: redirects to Google login → back to SAMAS signed in.
3. Same for **Continuar con Apple**.
