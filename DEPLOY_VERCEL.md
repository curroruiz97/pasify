# Pasify · Deploy en Vercel (dominio temporal)

Guía paso a paso para desplegar Pasify en `https://pasifyy.vercel.app` antes de pasar al dominio definitivo `pasify.es`.

---

## 1 · Variables de entorno en Vercel

Ve a **Vercel Dashboard → tu proyecto → Settings → Environment Variables** y añade estas variables para los environments `Production`, `Preview` y `Development`:

### 1.1 Cliente (VITE_*) — embebidas en el bundle

| Key | Value | Sensible |
| --- | --- | --- |
| `VITE_SUPABASE_PROJECT_ID` | `ixkyfwzkknehvsqpopof` | No |
| `VITE_SUPABASE_URL` | `https://ixkyfwzkknehvsqpopof.supabase.co` | No |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_yZbJzRlZfQY0iMtloEr86Q_uSUiuxNY` | No |
| `VITE_APP_BASE_URL` | `https://pasifyy.vercel.app` | No |
| `VITE_PUBLIC_WEB_URL` | `https://pasifyy.vercel.app` | No |
| `VITE_APP_NAME` | `Pasify` | No |
| `VITE_DEFAULT_LOCALE` | `es` | No |
| `VITE_SUPPORT_EMAIL` | `hola@pasify.es` | No |
| `VITE_DEV_PREVIEW` | `false` | No |
| `VITE_STRIPE_TEST_MODE` | `true` (mientras pruebas) | No |
| `VITE_STRIPE_PUBLISHABLE_KEY` | `pk_test_...` (de dashboard.stripe.com) | No |

Opcionales (deja vacíos hasta que los provisionéis):
- `VITE_MAPBOX_PUBLIC_TOKEN`
- `VITE_GOOGLE_OAUTH_CLIENT_ID`
- `VITE_FCM_VAPID_KEY`
- `VITE_SENTRY_DSN`
- `VITE_POSTHOG_KEY`
- `VITE_TURNSTILE_SITE_KEY`

### 1.2 Serverless functions (Node runtime, `/api/*`)

| Key | Value | Sensible |
| --- | --- | --- |
| `SITE_URL` | `https://pasifyy.vercel.app` | No |
| `SUPABASE_URL` | `https://ixkyfwzkknehvsqpopof.supabase.co` | No |
| `SUPABASE_ANON_KEY` | `sb_publishable_yZbJzRlZfQY0iMtloEr86Q_uSUiuxNY` | No |

Estas tres alimentan `/api/e/[id].ts` que renderiza Open Graph para WhatsApp/Telegram/Twitter cuando alguien comparte `https://pasifyy.vercel.app/e/<event-id>`.

> 💡 Marcando "All environments" cuando añades una variable, se aplica a Production + Preview + Development. Útil para los valores que no cambian entre entornos (project id, URL pública).

---

## 2 · Supabase · Site URL + Redirect URLs

**Sin este paso, los emails de password reset, las callbacks de Google OAuth y la confirmación de email redirigen a `localhost:3000` y NO funcionan.**

1. Abre [Supabase Dashboard → Authentication → URL Configuration](https://supabase.com/dashboard/project/ixkyfwzkknehvsqpopof/auth/url-configuration).
2. En **Site URL** pon:
   ```
   https://pasifyy.vercel.app
   ```
3. En **Redirect URLs**, añade (uno por línea):
   ```
   https://pasifyy.vercel.app
   https://pasifyy.vercel.app/**
   https://pasifyy.vercel.app/#/**
   https://*.vercel.app/**
   http://localhost:8080
   http://localhost:8080/**
   ```
   El `https://*.vercel.app/**` cubre las URLs de preview de Vercel (`pasifyy-xxx-curroruiz97s-projects.vercel.app`) que cambian con cada PR.

4. Guarda.

Cuando pases a `pasify.es` definitivo, añades esa URL a la lista y opcionalmente cambias Site URL a `https://pasify.es`. No borres las URLs de Vercel: vienen bien para staging.

---

## 3 · Google OAuth (si lo usas)

Si activas "Continuar con Google" hay que actualizar el redirect en Google Cloud Console:

1. [console.cloud.google.com → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials) → abre tu OAuth Client ID.
2. En **Authorized JavaScript origins** añade:
   - `https://pasifyy.vercel.app`
3. En **Authorized redirect URIs** añade:
   - `https://ixkyfwzkknehvsqpopof.supabase.co/auth/v1/callback`

(El callback va a Supabase, no a tu dominio. Pasify pasa por Supabase como broker.)

---

## 4 · Stripe webhook endpoint

1. [dashboard.stripe.com → Developers → Webhooks → Add endpoint](https://dashboard.stripe.com/test/webhooks)
2. URL del endpoint:
   ```
   https://ixkyfwzkknehvsqpopof.supabase.co/functions/v1/stripe-webhook
   ```
   (apunta al edge function de Supabase, no a Vercel)
3. Eventos a suscribir:
   - `checkout.session.completed`
   - `checkout.session.expired`
   - `payment_intent.succeeded`
   - `charge.refunded`
   - `account.updated`
   - `payout.paid`
   - `payout.failed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
4. Una vez creado, copia el **Signing secret** (empieza con `whsec_...`) y guárdalo en `secrets.env` como `STRIPE_WEBHOOK_SECRET`. Re-ejecuta `.\scripts\02-set-secrets.ps1` para empujarlo al proyecto Supabase.

---

## 5 · Edge functions Supabase

Ver `scripts/README.md` y ejecutar:

```powershell
.\scripts\01-login-and-link.ps1   # una vez (ya hecho)
.\scripts\02-set-secrets.ps1      # tras editar secrets.env
.\scripts\03-deploy-all.ps1       # despliega las 23+ funciones
```

Sin las edge functions:
- Checkout Stripe **no funciona** (Calendar.tsx Participar y PartnerSubscribe muestran toast "Checkout próximamente").
- Refund processing **no funciona**.
- Emails transaccionales **no salen**.
- Push notifications **no se reparten**.

El frontend ya degrada con mensajes de "próximamente" cuando el function devuelve 404 — no crashea.

---

## 6 · Build settings en Vercel

Vercel auto-detecta Vite. La configuración correcta (ya en `vercel.json`):

| Setting | Value |
| --- | --- |
| Framework Preset | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `npm install` |
| Node.js Version | 20.x |

Vercel también respeta `vercel.json` que ya tiene:
- SPA fallback (`/((?!api/).*)` → `/index.html`)
- Cache headers agresivos en `/assets/*` (1 año immutable)
- Cache `no-store` en `index.html` y `sw.js` (Service Worker actualizable)
- Headers de seguridad básicos (`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`)
- Rewrite `/e/:id` → `/api/e/:id` para Open Graph cards

---

## 7 · Después del deploy · checklist de smoke test

Cuando Vercel termine el build (~1-2 min):

1. Abre `https://pasifyy.vercel.app` → debe cargar la landing Pasify con grain + warm shadows.
2. Click en login → introduce credenciales → debe redirigir al dashboard correspondiente.
3. Ve a `/calendar` → debe listar el evento "Saturday loco" (o el que hayas creado).
4. Como partner, intenta crear un evento → debe aparecer en Mis eventos.
5. Como cliente, click en "Participar" → si el edge `stripe-create-checkout` no está desplegado verás toast "Checkout próximamente" (no crash).
6. PanelSwitcher (cuenta multi-rol) → debe funcionar el cambio entre Admin/Partner/Client.

Si algo rompe:
- Mira la consola del navegador (F12 → Console).
- Revisa **Vercel Dashboard → Deployments → tu último deploy → Functions** para logs del serverless `/api/e/[id]`.
- Revisa **Supabase Dashboard → Logs** para errores RLS / edge function.

---

## 8 · Cuando pases al dominio definitivo (`pasify.es`)

Search-replace estos valores:

| Variable / archivo | Valor temporal | Valor definitivo |
| --- | --- | --- |
| Vercel env `VITE_APP_BASE_URL` | `https://pasifyy.vercel.app` | `https://pasify.es` |
| Vercel env `VITE_PUBLIC_WEB_URL` | `https://pasifyy.vercel.app` | `https://pasify.es` |
| Vercel env `SITE_URL` | `https://pasifyy.vercel.app` | `https://pasify.es` |
| Supabase Auth Site URL | `https://pasifyy.vercel.app` | `https://pasify.es` |
| Supabase Auth Redirect URLs | añadir `https://pasify.es/**` | mantener ambos durante migración |
| Vercel Domains → Add domain | — | `pasify.es` + `www.pasify.es` |
| DNS de `pasify.es` | — | apuntar a Vercel (CNAME / A records que te indique Vercel) |
| `secrets.env` → `APP_BASE_URL` | `https://pasifyy.vercel.app` | `https://pasify.es` → re-deploy edge functions |
| Copy de `PartnerChoosePlan.tsx`, `PartnerSubscribe.tsx`, `PartnerManage.tsx` | `pasifyy.vercel.app` | `pasify.es` (search/replace global) |
| `src/lib/openWebAuth.ts` fallback hardcoded | `pasifyy.vercel.app` | `pasify.es` |

> El switch global lleva ~10 min y se puede automatizar con un script `sed` o un commit que cambie todas las ocurrencias a la vez.
