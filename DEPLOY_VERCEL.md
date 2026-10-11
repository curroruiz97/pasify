# Pasify · Despliegue de la web en Vercel

Vercel sirve la web (`dist/`, la SPA) y las dos funciones de `api/`. La base de
datos y las edge functions **no** salen desde aquí: van por
`.github/workflows/deploy-production.yml` (tests de BD → migraciones →
funciones; ver [README](./README.md#cicd)).

Hoy la web está en `https://pasifyy.vercel.app`; el paso a `pasify.es` está en
la sección 6.

---

## 1 · Cómo sale a producción

- El proyecto de Vercel está conectado al repo de GitHub: **cada push a `main`
  se despliega en producción**; cada PR tiene su preview en `*.vercel.app`.
- `vercel.json` fija el build (`npm run build`), la salida (`dist`) y el
  framework (Vite). Las dependencias se instalan con npm desde
  `package-lock.json`.
- El CI compila con Node 20: usa la misma versión en Vercel (Settings →
  General → Node.js Version).
- El build se aborta si `VITE_SUPABASE_URL` o `VITE_SUPABASE_PUBLISHABLE_KEY`
  faltan o son un placeholder (guardia de `vite.config.ts`). `.env.production`,
  versionado, trae los valores públicos de producción; las variables del
  dashboard de Vercel mandan sobre él.
- El release de Sentry es el SHA del commit (`VERCEL_GIT_COMMIT_SHA`).

`vercel.json` también define:

- Reescrituras: `/e/:id` → `/api/e/:id`, `/p/:id` → `/api/p/:id` y todo lo que
  no sea `api/` ni `assets/` → `/index.html` (la SPA usa `HashRouter`).
- Caché: `/assets/*` y los estáticos, un año `immutable`; `index.html` y
  `sw.js`, `max-age=0, must-revalidate` (el service worker se actualiza);
  `manifest.webmanifest`, una hora.
- Cabeceras: `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`,
  `X-Frame-Options: SAMEORIGIN` y `Content-Security-Policy-Report-Only` (ver
  1.1). HSTS no está en `vercel.json` a propósito: según la documentación de
  Vercel (Encryption and TLS) lo envía por defecto, con `max-age=63072000` y,
  en `*.vercel.app`, además `includeSubDomains; preload`; repetirlo aquí con
  otro valor lo pisaría. Se comprueba con
  `curl -sI https://pasifyy.vercel.app | grep -i strict-transport`. Si algún
  día no saliera (por ejemplo en el dominio propio), el valor a añadir al
  bloque `/(.*)` es `Strict-Transport-Security: max-age=63072000`.

### 1.1 · Content-Security-Policy (solo informe)

`Content-Security-Policy-Report-Only` **no bloquea nada**: el navegador
comprueba cada recurso contra la política y, si no encaja, lo deja en la
consola de DevTools (`[Report Only] Refused to load …`) y en el evento
`securitypolicyviolation`. Sirve para ver qué se rompería antes de pasarla a
`Content-Security-Policy`. No hay endpoint de informes: se mira abriendo la web
con DevTools (consola, filtrando por «Report Only», o la pestaña Issues). Las
del service worker salen en su propia consola (Application → Service Workers →
inspect).

| Directiva | Admite | Por qué |
|---|---|---|
| `script-src` | `'self'`, el hash de cada script en línea y `https://challenges.cloudflare.com` | `index.html` (2 scripts), `404.html` y las páginas de `public/landing/` llevan scripts en línea; Turnstile carga su `api.js` |
| `style-src` | `'self'`, `'unsafe-inline'`, `https://fonts.googleapis.com` | Estilos en línea (Radix, Sonner, las páginas estáticas) y la hoja de Google Fonts |
| `font-src` | `'self'`, `https://fonts.gstatic.com` | Inter, Instrument Serif y Geist |
| `img-src` | `'self'`, `data:`, `blob:`, el Supabase de producción (Storage), `https://images.unsplash.com` | QR como `data:`, previsualización de fotos (`blob:`), portadas y avatares del Storage, y el carrusel del hero de `/#/calendar` (`HERO_MARQUEE_IMAGES` de `Calendar.tsx`, imágenes temporales de Unsplash: cuando se cambien por carteles propios sobra el host) |
| `connect-src` | `'self'`, el Supabase de producción (`https` y `wss`), `*.ingest.sentry.io` (también `.de.` y `.us.`), `https://challenges.cloudflare.com`, `https://fonts.googleapis.com` y `https://fonts.gstatic.com` | API, Auth, Realtime y funciones; envío de errores a Sentry. Las dos de Google Fonts son por el service worker: Workbox pide las fuentes con `fetch()` y ahí el navegador las mide contra `connect-src`, no contra `font-src` |
| `frame-src` | `'self'`, `https://challenges.cloudflare.com` | La landing y la política de privacidad se cargan en un `<iframe>` propio; el widget de Turnstile |
| `worker-src` | `'self'`, `blob:` | El service worker; `qr-scanner` crea su worker desde un `blob:` |
| el resto | `manifest-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'self'` | |

Stripe no aparece: el pago es una redirección a Checkout (`window.location.href`),
la web no carga Stripe.js.

Qué mantener a mano:

- El host de Supabase (`ixkyfwzkknehvsqpopof`) está escrito en `img-src` y
  `connect-src`: si cambia `VITE_SUPABASE_URL`, cámbialo también en
  `vercel.json`.
- Si el DSN de Sentry (`VITE_SENTRY_DSN`) usa otro host que `*.ingest.sentry.io`,
  `.de.` o `.us.`, añádelo a `connect-src`.
- Los scripts en línea entran por su hash. Si cambias uno (`index.html`,
  `404.html`, `public/landing/**`), tras `npm run build` ejecuta
  `node scripts/csp-hashes.mjs`: lista los hashes y `--check` falla si alguno
  falta en el `script-src` de `vercel.json`.

Para pasar a bloquear: primero recoger informes de usuarios reales durante unos
días (Sentry da un endpoint en el proyecto → Settings → Security Headers; se
añade `; report-uri <endpoint>` a la política) y, con la lista limpia,
renombrar la cabecera a `Content-Security-Policy`.

---

## 2 · Variables de entorno en Vercel

Settings → Environment Variables, para Production y Preview. Las `VITE_*` se
meten en el bundle en el build: no son secretas y cambiarlas exige volver a
desplegar.

### 2.1 Las que lee la web

| Variable | Para qué | Producción |
|---|---|---|
| `VITE_SUPABASE_URL` | Cliente de Supabase (también `/api`) | `https://ixkyfwzkknehvsqpopof.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Clave pública del cliente (también `/api`) | la de `.env.production` (`sb_publishable_…`) |
| `VITE_PUBLIC_WEB_URL` (o `VITE_APP_BASE_URL`) | URL pública de la web: enlaces para compartir (`/e/…`, `/p/…`, referidos) y URL de vuelta de Stripe desde la app nativa | `https://pasifyy.vercel.app` |
| `VITE_SENTRY_DSN` | Errores a Sentry; vacía, sin Sentry | DSN del proyecto |
| `VITE_ENABLE_SUPER_ADMIN_SWITCHER` | `true`: el super-admin puede saltar entre paneles | según se quiera |
| `VITE_TURNSTILE_SITE_KEY` | Clave pública de Cloudflare Turnstile: captcha en el alta y en «¿Olvidaste tu contraseña?» (solo web). Vacía, sin captcha. Antes, el secreto `TURNSTILE_SECRET_KEY` en Supabase: si no, el alta web falla con 503 | site key del widget |

`VITE_DEV_PREVIEW` solo tiene efecto en `npm run dev`. El resto de `VITE_*`
de `.env.example` (`VITE_SUPABASE_PROJECT_ID`, `VITE_STRIPE_*`,
`VITE_MAPBOX_PUBLIC_TOKEN`, `VITE_GOOGLE_OAUTH_CLIENT_ID`,
`VITE_FCM_VAPID_KEY`, `VITE_POSTHOG_*`, `VITE_APP_NAME`,
`VITE_DEFAULT_LOCALE`, `VITE_SUPPORT_EMAIL`) no las lee ningún fichero de
`src/`: no hace falta configurarlas.

### 2.2 Las de `api/` (Open Graph)

`api/e/[id].ts` y `api/p/[id].ts` sirven las tarjetas de vista previa
(WhatsApp, Telegram, redes) de `/e/<evento>` y `/p/<local>`; a un navegador lo
mandan directo a la página de la app.

| Variable | Para qué |
|---|---|
| `SITE_URL` | URL de la web a la que redirigen (`https://pasifyy.vercel.app`) |
| `SUPABASE_URL` · `SUPABASE_ANON_KEY` | Solo si faltan las `VITE_SUPABASE_*` de arriba, que se leen primero |

### 2.3 Build (opcionales)

- `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`: suben los source maps al
  release. Hace falta además `@sentry/vite-plugin`, que no está en
  `package.json`: sin él, el build avisa y sigue sin subirlos.
- `VITE_BASE_PATH`: base de Vite (por defecto `/`).

---

## 3 · Supabase Auth: Site URL y Redirect URLs

Sin esto, los emails de recuperar contraseña, el alta con Google y la
confirmación de email vuelven a `localhost`.

[Authentication → URL Configuration](https://supabase.com/dashboard/project/ixkyfwzkknehvsqpopof/auth/url-configuration):

- **Site URL:** `https://pasifyy.vercel.app`
- **Redirect URLs:**
  ```
  https://pasifyy.vercel.app
  https://pasifyy.vercel.app/**
  https://pasifyy.vercel.app/#/**
  https://*.vercel.app/**
  http://localhost:8080
  http://localhost:8080/**
  ```
  `https://*.vercel.app/**` cubre las previews de los PR.

---

## 4 · Google OAuth

En [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials),
en el OAuth Client ID web:

- **Authorized JavaScript origins:** `https://pasifyy.vercel.app`
- **Authorized redirect URIs:** `https://ixkyfwzkknehvsqpopof.supabase.co/auth/v1/callback`

El callback es de Supabase, no de Vercel. Los client IDs de Google están en
`src/components/auth/GoogleAuthButton.tsx`.

---

## 5 · Stripe: webhooks

Los dos endpoints apuntan a la edge function, no a Vercel:
`https://ixkyfwzkknehvsqpopof.supabase.co/functions/v1/stripe-webhook`.

- **Endpoint de la plataforma** (su signing secret en el secreto
  `STRIPE_WEBHOOK_SECRET`): `checkout.session.completed`,
  `checkout.session.async_payment_succeeded`, `checkout.session.expired`,
  `checkout.session.async_payment_failed`, `charge.refunded`,
  `refund.updated`, `charge.dispute.created`, `charge.dispute.closed`,
  `customer.subscription.created`, `customer.subscription.updated`,
  `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`.
- **Endpoint de Connect** (eventos de las cuentas de los locales; secreto
  `STRIPE_CONNECT_WEBHOOK_SECRET`): `account.updated`, `payout.paid`,
  `payout.failed`.

La función prueba la firma con los dos secretos y es idempotente: un evento
repetido no duplica nada.

Los secretos se cargan con `supabase secrets set` o
`scripts/02-set-secrets.ps1` (ver [scripts/README.md](./scripts/README.md)).
Lista completa en [supabase/functions/README.md](./supabase/functions/README.md#secretos).

---

## 6 · Paso al dominio definitivo (`pasify.es`)

| Dónde | Hoy | Después |
|---|---|---|
| Vercel → Domains | — | `pasify.es` y `www.pasify.es`, con los registros DNS que indique Vercel |
| Vercel env `VITE_PUBLIC_WEB_URL` / `VITE_APP_BASE_URL` | `https://pasifyy.vercel.app` | `https://pasify.es` (y volver a desplegar) |
| Vercel env `SITE_URL` | `https://pasifyy.vercel.app` | `https://pasify.es` |
| `.env.production` | `https://pasifyy.vercel.app` | `https://pasify.es` (lo usan los builds de Android) |
| Supabase Auth → Site URL | `https://pasifyy.vercel.app` | `https://pasify.es` |
| Supabase Auth → Redirect URLs | — | añadir `https://pasify.es/**` y `https://pasify.es/#/**`; mantener las de Vercel |
| Secreto de edge functions `APP_BASE_URL` | `https://pasifyy.vercel.app` | `https://pasify.es` |
| Google OAuth → JavaScript origins | `https://pasifyy.vercel.app` | añadir `https://pasify.es` |

Quedan valores por defecto con el dominio temporal (solo se usan si falta la
variable): `src/lib/redirect-url.ts`, `api/e/[id].ts`, `api/p/[id].ts`,
`supabase/functions/_shared/email-templates.ts`; y
`supabase/functions/_shared/urls.ts` acepta los dos dominios como vuelta de
Stripe. `smoke.yml` prueba `https://pasifyy.vercel.app` por defecto y
`public/eliminar-cuenta.html` lo tiene como canonical.

---

## 7 · Después de un despliegue

`smoke.yml` corre solo cuando Vercel confirma el despliegue de producción: la
home responde 200 con «pasify», `health-check` contesta y las funciones
protegidas dan 401/403 sin sesión. A mano:

1. `https://pasifyy.vercel.app` carga la home.
2. Entrar con una cuenta de cada rol lleva a su panel (`/#/client-dashboard`,
   `/#/partner-dashboard`, `/#/admin`).
3. `/#/calendar` lista los eventos publicados.
4. Un enlace `https://pasifyy.vercel.app/e/<id>` abre el evento (y en
   WhatsApp muestra su tarjeta).

Si algo falla: la consola del navegador; Vercel → Deployments → el despliegue
→ Functions para los logs de `/api`; Supabase → Logs para la base de datos y
las edge functions.
