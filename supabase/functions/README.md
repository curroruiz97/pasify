# Pasify · Edge functions

32 funciones en Deno, una por carpeta (`supabase/functions/<nombre>/index.ts`).
`_shared/` es código común: no es una función y no se despliega sola.

- **Despliegue:** solo por `.github/workflows/deploy-production.yml`, después de
  los tests de BD y de las migraciones (ver [Despliegue](#despliegue)).
- **`verify_jwt = false` en todas** (`supabase/config.toml` y
  `--no-verify-jwt` en el despliegue): la app llama con la publishable key
  (`sb_publishable_…`), que no es un JWT, y el gateway rechazaría las llamadas
  sin sesión. La autorización la hace cada función en su código, con los
  helpers de `_shared/`.

## Funciones

Autorización: **sesión** = `requireUser` (JWT del usuario); **admin** =
admin de plataforma (`requireAdmin` o `isPlatformAdmin`); **servicio** =
`requireServiceRole` (service role o cabecera `x-pasify-internal`);
**pública** = sin sesión, con su propia credencial cuando la hay.

### Compra y entradas

| Función | Autorización | Qué hace · quién la llama |
|---|---|---|
| `stripe-create-checkout` | sesión | Crea la Checkout Session de Stripe de N entradas de un tipo (destination charge al local con comisión de Pasify) o emite gratis las de 0 €. `useTicketCheckout.ts` |
| `stripe-webhook` | firma de Stripe | Eventos de Stripe de la plataforma (`STRIPE_WEBHOOK_SECRET`) y de Connect (`STRIPE_CONNECT_WEBHOOK_SECRET`): pagos, caducidades, reembolsos, disputas, suscripciones, cuentas y payouts de los locales. Idempotente (`stripe_webhook_events`) |
| `confirm-checkout-session` | sesión, o `session_id` + `order_id` que casen | Red de seguridad si el webhook no llega: la vuelta de Stripe pregunta aquí y la función consulta a Stripe. `usePendingCheckoutResume.ts` |
| `cancel-checkout` | sesión | El comprador abandona el pago: caduca la sesión de Stripe y libera las plazas (o confirma si Stripe ya cobró). `usePendingCheckoutResume.ts` |
| `reconcile-pending-orders` | servicio | Pregunta a Stripe por los pedidos que siguen `pending`. `pg_cron` + `pg_net` cada 10 min, cuando está programada (ver [Tareas periódicas](#tareas-periódicas-pg_cron)) |
| `resend-tickets-email` | sesión (comprador) o admin | Reenvía el email con las entradas de un pedido pagado. Cartera del cliente y soporte del admin |
| `ticket-public` | pública (`access_url_token`) | Datos de la página pública de una entrada (`/#/entrada/:id`) |
| `ticket-qr` | pública (`access_url_token`) | PNG del QR de una entrada para los emails y la página pública |
| `send-ticket-transfer` | sesión (titular) | Envía una entrada a otra persona por email (`transfer_ticket`) |
| `accept-ticket-transfer` | token del enlace + sesión para aceptar | Página `/#/transferencia`: ver y aceptar la entrada recibida |

### Reembolsos y cancelaciones

| Función | Autorización | Qué hace · quién la llama |
|---|---|---|
| `decide-refund` | sesión (owner/admin/manager del local) o admin | Aprueba o rechaza una solicitud; si aprueba, reembolsa en Stripe. Bandeja del local y del admin |
| `process-refund` | sesión o admin | Ejecuta en Stripe un reembolso ya aprobado (reintentos del admin, aprobados automáticos por evento cancelado) |
| `partner-cancel-event` | sesión (local) o admin | Cancela un evento y devuelve el importe completo de lo vendido (`partner_cancel_event`) |

### Local

| Función | Autorización | Qué hace · quién la llama |
|---|---|---|
| `partner-onboard-stripe-connect` | sesión | Crea o reutiliza la cuenta de Stripe Connect de la organización y devuelve el enlace de alta. Sin llamador en el repo |
| `partner-stripe-refresh-account` | sesión | Sincroniza el estado de la cuenta de Connect en `organizations`. Sin llamador en el repo |
| `partner-stripe-create-portal-link` | sesión | Enlace al portal de Stripe del local. Sin llamador en el repo |
| `send-team-invitation` | sesión | Email de invitación a un miembro de la organización. Sin llamador en el repo |
| `accept-team-invitation` | token de la invitación | Acepta una invitación de equipo. Sin llamador en el repo (el email de `send-team-invitation` enlaza a `/#/accept-invitation`, ruta que la app no tiene) |
| `ai-forecast-event` | sesión (miembro del local) o admin | Previsión de venta con la media de eventos comparables del local (estadística, no IA). `PartnerForecast.tsx` |
| `ai-pricing-propose` | servicio o admin | Propuestas de precio por velocidad de venta en `pricing_proposals`. `PartnerDynamicPricing.tsx` (los locales reciben 403) |

### Cuentas y administración

| Función | Autorización | Qué hace · quién la llama |
|---|---|---|
| `delete-own-account` | sesión | Borra la cuenta de quien llama: 409 a los admins, con un reembolso en curso o si es un local con ventas futuras (antes cierra su actividad con `partner_close_account`); borra sus ficheros de Storage y revoca Sign in with Apple si hay secretos y código. `SettingsSheet.tsx` |
| `delete-user` | admin | Borra la cuenta de otro usuario. Sin llamador en el repo |
| `admin-cancel-partner-subscription` | admin | Cancela la suscripción de un local. Sin llamador en el repo |
| `gdpr-export-data` | sesión | JSON con los datos del usuario (columnas explícitas, sin tokens ni secretos), 5 al día. «Descargar mis datos» en `SettingsSheet.tsx` |
| `notify-new-registration` | sesión (el recién registrado) | Email de bienvenida a la cuenta nueva (cliente o local, según sus roles). `RegisterClient.tsx` |
| `verify-captcha` | pública (límite por IP) | Valida un token de Cloudflare Turnstile del alta y de «¿Olvidaste tu contraseña?» (solo web y con `VITE_TURNSTILE_SITE_KEY`). En producción, sin secreto falla cerrado (503) |

### Avisos (solo servidor → servidor)

| Función | Autorización | Qué hace |
|---|---|---|
| `dispatch-notification` | servicio | Envía los avisos pendientes de `notification_dispatches` por email, push o SMS según las preferencias (horas de silencio en la zona del usuario). Al momento desde `_shared/notify.ts` y en lotes cada minuto con `pg_cron` |
| `send-push` | servicio | Push de FCM a uno o varios tokens |
| `send-sms` | servicio | SMS por Twilio |
| `notify-admin-message` | servicio | Email a los admins cuando un usuario abre una conversación sin leer (trigger de `support_messages` con `pg_net`) |
| `retake-stale-refunds` | servicio | Retoma los reembolsos atascados en `processing` y los aprobados sin lanzar (lotes de 10). `pg_cron` + `pg_net` cada 10 min |

### Salud

| Función | Autorización | Qué hace |
|---|---|---|
| `health-check` | pública (completo con la cabecera interna) | Estado de la base de datos, Stripe, Resend (dominio incluido), FCM y la cola de avisos; guarda la foto en `service_status_snapshots` y avisa a los admins al cambiar de estado. Cada 15 min con `pg_cron`; también `deploy-production.yml` y `smoke.yml` |

"Sin llamador en el repo" quiere decir que nada en `src/`, `api/`, las otras
funciones ni las migraciones la invoca; puede llamarla un servicio externo o
estar a la espera de su pantalla.

## `_shared/`

| Módulo | Para qué |
|---|---|
| `cors.ts` | Cabeceras CORS y respuesta al preflight |
| `supabase.ts` | Cliente con service role (`supabaseAdmin`), cliente con el JWT del usuario, `requireUser`, `requireAdmin`, `isPlatformAdmin`, roles en la organización |
| `internal-auth.ts` | `requireServiceRole` (service role o `x-pasify-internal`), `HttpError` y respuestas de error seguras |
| `logger.ts` | Logs en JSON de una línea |
| `rate-limit.ts` | Límite por clave con la RPC `check_rate_limit` |
| `stripe.ts` | Cliente de Stripe, verificación de firmas del webhook y el guardia de pagos de prueba en producción |
| `order-paid.ts` | Confirmar un pedido pagado (entradas, email, avisos), común a webhook, vuelta del pago y conciliación |
| `refund.ts` | Ejecuta en Stripe un reembolso aprobado, una sola vez por solicitud (lo usan `decide-refund`, `process-refund`, `partner-cancel-event` y `order-paid.ts`) |
| `notify.ts` | `enqueueNotification` y disparo de `dispatch-notification` |
| `email-templates.ts` · `resend.ts` | Plantillas y envío de email con Resend |
| `gmail.ts` | Shim antiguo sobre `resend.ts` (lo usa `notify-new-registration`) |
| `firebase.ts` · `twilio.ts` | Push por FCM (HTTP v1) y SMS por Twilio |
| `urls.ts` | Orígenes permitidos para las URL de vuelta de Stripe |

## Secretos

Se cargan con `supabase secrets set NOMBRE=valor` (o
`scripts/02-set-secrets.ps1` desde `secrets.env`). `SUPABASE_URL`,
`SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` los pone Supabase.

| Secreto | Lo usa |
|---|---|
| `STRIPE_SECRET_KEY` | `_shared/stripe.ts`, `admin-cancel-partner-subscription`, `health-check` |
| `STRIPE_WEBHOOK_SECRET` · `STRIPE_CONNECT_WEBHOOK_SECRET` | Firma de los dos endpoints del webhook (plataforma y Connect) |
| `STRIPE_CONNECT_CLIENT_ID` | `_shared/stripe.ts` (opcional) |
| `PASIFY_ENV` | `"production"` en producción; si falta, se deduce de `SUPABASE_URL` |
| `PASIFY_ALLOW_TEST_PAYMENTS` | `"true"` solo mientras se prueba con tarjetas de test en producción; quitarlo al acabar |
| `PASIFY_INTERNAL_SECRET` | Cabecera `x-pasify-internal` (32+ caracteres). El mismo valor va en Vault como `pasify_internal_secret` para el cron de `reconcile-pending-orders` |
| `APP_BASE_URL` | URL de la web en emails y enlaces |
| `ALLOWED_RETURN_ORIGINS` | Orígenes extra para las URL de vuelta de Stripe, separados por comas (opcional) |
| `RESEND_API_KEY` · `EMAIL_FROM` · `EMAIL_REPLY_TO` · `SUPPORT_EMAIL` | Email transaccional |
| `ADMIN_EMAIL` | Destino de `notify-admin-message` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Push por FCM (`_shared/firebase.ts`, `health-check`); `FCM_SERVER_KEY` es el respaldo de la API antigua |
| `FIREBASE_ADMIN_SERVICE_ACCOUNT` | Push de `notify-new-registration` |
| `TWILIO_ACCOUNT_SID` · `TWILIO_AUTH_TOKEN` · `TWILIO_FROM_NUMBER` | SMS |
| `TURNSTILE_SECRET_KEY` | `verify-captcha` |

## Despliegue

- **Automático:** un push a `main` que cambie `supabase/functions/` o
  `supabase/config.toml` despliega **todas** las funciones (las carpetas con
  `index.ts` que no empiezan por `_`), en `deploy-production.yml`: primero los
  tests de BD (`db-tests.yml`), luego las migraciones (si las hay; si fallan,
  no se despliega ninguna función) y después las funciones, con
  `--no-verify-jwt`. Si una falla se siguen desplegando las demás y el job
  acaba en rojo. Al final llama a `health-check`.
- **Una sola, a mano:** Actions → *Deploy · producción* → *Run workflow*, con
  su nombre (pasa por los mismos tests).
- **Emergencia desde tu máquina:** `supabase functions deploy <nombre>
  --no-verify-jwt` (ver [scripts/README.md](../../scripts/README.md)).
- **Función nueva:** carpeta con `index.ts`, su entrada en
  `supabase/config.toml` y una de las comprobaciones de arriba (sin ella queda
  abierta). Si es protegida, añádela a la lista de `smoke.yml`, que exige 401 o
  403 sin sesión.
- **Retirar una función:** borrar la carpeta y su entrada de `config.toml` y,
  tras el despliegue, `supabase functions delete <nombre>` en producción (el
  despliegue nunca borra). `functions-drift.yml` avisa de lo que siga publicado
  sin carpeta, o al revés.

## Tareas periódicas (`pg_cron`)

| Job | Cuándo | Qué llama |
|---|---|---|
| `pasify-expire-pending-orders` | cada 10 min | `cron_expire_pending_orders()` |
| `pasify-mark-past-events` | cada 15 min | `cron_mark_past_events()` |
| `pasify-cleanup-rate-limits` | cada 30 min | `cron_cleanup_rate_limits()` |
| `pasify-expire-ticket-transfers` | cada 4 h | `cron_expire_ticket_transfers()` |
| `pasify-close-event-wallets` | 03:00 | `cron_close_event_wallets()` |
| `pasify-process-dsar` | 06:00 | `cron_process_dsar_deadlines()` |
| `pasify-cleanup-old-notifs` | domingos 04:00 | `cron_cleanup_old_notifications()` |
| `pasify-cleanup-logs` | domingos 05:00 | `cron_cleanup_logs()` |
| `pasify-reconcile-pending-orders` | cada 10 min | `POST` a `reconcile-pending-orders` con `pg_net`; solo si Vault tiene `pasify_internal_secret` (luego `SELECT public.schedule_reconcile_pending_orders();`) |
| `pasify-dispatch-notifications` | cada minuto | `POST` a `dispatch-notification` (lotes) con `pg_net`; mismo requisito (`SELECT public.schedule_dispatch_notifications();`) |
| `pasify-health-check` | cada 15 min | `POST` a `health-check` (completo) con `pg_net`; mismo requisito (`SELECT public.schedule_health_check();`) |
| `pasify-retake-stale-refunds` | cada 10 min | `POST` a `retake-stale-refunds` con `pg_net`; mismo requisito (`SELECT public.schedule_retake_stale_refunds();`) |

Horas en UTC (las de `pg_cron`).

## Probar en local

```bash
supabase start                                    # Postgres, Auth, Storage y edge runtime
supabase functions serve --env-file ./supabase/.env.local   # con los secretos que necesites
curl http://127.0.0.1:54321/functions/v1/health-check
```

`./supabase/.env.local` es un fichero tuyo, fuera de git, con los secretos de
la tabla de arriba. Los tests de BD (`tests/db/*.sql`) no necesitan las
funciones: ver la [verificación local](../../README.md#verificación-local) del
README principal.
