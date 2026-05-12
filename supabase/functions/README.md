# Pasify · Edge Functions

Enterprise edge functions deployment guide and architecture reference.

## Architecture

All functions follow the same pattern:

```
supabase/functions/
├── _shared/                    # Shared utilities (imported by every fn)
│   ├── cors.ts                 # CORS headers + preflight
│   ├── supabase.ts             # Admin + user-scoped clients, requireUser
│   ├── stripe.ts               # Stripe SDK init
│   ├── resend.ts               # Resend (email transaccional)
│   ├── firebase.ts             # FCM HTTP v1 + OAuth service account
│   ├── twilio.ts               # SMS (2FA, alertas críticas)
│   ├── openai.ts               # OpenAI Chat completion
│   ├── logger.ts               # JSON-line structured logging
│   ├── rate-limit.ts           # check_rate_limit RPC wrapper
│   ├── notify.ts               # enqueueNotification helper
│   ├── email-templates.ts      # Pasify-branded email HTML
│   └── gmail.ts                # @deprecated shim → resend
├── stripe-create-checkout/     # Compra de tickets · Connect destination
├── stripe-webhook/             # Procesa events Stripe (idempotente)
├── partner-onboard-stripe-connect/
├── partner-stripe-refresh-account/
├── partner-stripe-create-portal-link/
├── process-refund/             # Ejecuta refund Stripe tras decide_refund
├── dispatch-notification/      # Fan-out push/email/sms desde notifications
├── send-push/                  # FCM helper
├── send-sms/                   # Twilio helper
├── send-team-invitation/       # Email invitar miembro org
├── send-ticket-transfer/       # Email transferencia ticket
├── accept-team-invitation/     # Magic link público
├── accept-ticket-transfer/     # Magic link público
├── ai-concierge-reply/         # OpenAI auto-respuesta soporte
├── ai-forecast-event/          # Predicción asistencia
├── ai-pricing-propose/         # Cron: propuestas pricing
├── ai-anomaly-detector/        # Cron: drift detection AI
├── industry-benchmarks-recompute/ # Cron: agregados k-anonimato 15
├── gdpr-export-data/           # ZIP/JSON con todos los datos del user
├── health-check/               # Status público de DB + Stripe + Resend + FCM
├── verify-captcha/             # Turnstile siteverify
├── enable-2fa/                 # TOTP setup
└── verify-2fa-code/            # TOTP/backup code verify
```

## Required Supabase secrets

Configura via `supabase secrets set KEY=value` o el dashboard:

### Core (Supabase auto-injected)
- `SUPABASE_URL` (auto)
- `SUPABASE_SERVICE_ROLE_KEY` (auto)
- `SUPABASE_ANON_KEY` (auto)

### App
- `APP_BASE_URL` — `https://pasify.es`
- `SUPPORT_EMAIL` — `hola@pasify.es`

### Stripe
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_CONNECT_CLIENT_ID` (opcional)

### Email (Resend)
- `RESEND_API_KEY`
- `EMAIL_FROM` — `Pasify <noreply@pasify.es>`
- `EMAIL_REPLY_TO` — `hola@pasify.es`

### Push (FCM)
- `FIREBASE_SERVICE_ACCOUNT_JSON` — JSON completo del service account

### SMS (Twilio)
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_FROM_NUMBER`

### AI (OpenAI)
- `OPENAI_API_KEY`
- `OPENAI_MODEL_DEFAULT` (opcional, default `gpt-4o-mini`)

### Captcha (Cloudflare Turnstile)
- `TURNSTILE_SECRET_KEY`

### Admin notifications
- `ADMIN_EMAIL` — `admin@pasify.es`

## Deploy

### Manual (CLI)
```bash
# Link project (1 vez)
supabase link --project-ref ixkyfwzkknehvsqpopof

# Deploy all
for fn in supabase/functions/*/; do
  name=$(basename "$fn")
  [[ "$name" == "_shared" ]] && continue
  supabase functions deploy "$name"
done

# Deploy una sola
supabase functions deploy stripe-webhook
```

### Auto (GitHub Actions)
Push a `staging` o `main` con cambios en `supabase/functions/**` dispara el workflow
`.github/workflows/deploy-edge-functions.yml` que:
1. Linka el proyecto correcto (staging vs prod por branch).
2. Deploya todas las funciones modificadas.
3. Hace smoke test del `health-check`.

## Idempotencia y retries

- **Stripe webhook**: idempotencia vía `stripe_webhook_events.event_id UNIQUE`. Retries seguros sin duplicar trabajo.
- **Order/ticket creation**: `request_id` UUID en `ticket_orders` previene duplicados desde el cliente.
- **Email**: header `Idempotency-Key` en Resend (e.g. `order-${order_id}`).
- **Notifications**: misma row en `notifications` con UNIQUE indirecto por contexto.

## Observabilidad

Cada function logguea JSON-lines con campos estructurados:
```json
{ "level": "info", "message": "checkout_session_created", "ts": "...",
  "function": "stripe-create-checkout", "user_id": "...", "order_id": "...", "duration_ms": 234 }
```

Logs visibles en Supabase Dashboard → Edge Functions → Logs. Filtrar por `function` y `level`.

Para producción, configurar drain a Datadog / LogDNA / Better Stack.

## Verify JWT toggle

`verify_jwt = false` (en `config.toml`) está habilitado solo para:
- `stripe-webhook` (verificamos firma Stripe en el body)
- `health-check` (público)
- `verify-captcha` (público pre-login)
- `accept-ticket-transfer`, `accept-team-invitation` (magic links sin sesión)
- `resolve-whitelabel-host` (frontend resuelve branding antes de login)

El resto requiere JWT válido y el código llama `requireUser(req)` para extraerlo.

## Rate limits aplicados

| Endpoint | Límite |
|---|---|
| `stripe-create-checkout` | 20/hora/user |
| `send-sms` | 5/hora/teléfono |
| `verify-2fa-code` | 5/15min/user |
| `partner-onboard-stripe-connect` | 10/hora/user |

Backend persistido en tabla `rate_limits` + RPC `check_rate_limit`.

## Cron jobs (pg_cron, NO edge functions)

Los siguientes corren en Postgres pg_cron, no edge functions:

| Schedule | Job |
|---|---|
| `*/15 * * * *` | mark_past_events |
| `*/30 * * * *` | cleanup_rate_limits |
| `*/10 * * * *` | expire_pending_orders |
| `0 */4 * * *` | expire_ticket_transfers |
| `0 3 * * *` | close_event_wallets |
| `0 6 * * *` | process_dsar_deadlines |
| `0 4 * * 0` | cleanup_old_notifications (weekly) |
| `0 5 * * 0` | cleanup_logs (weekly) |

Para los AI cron schedules (`ai-pricing-propose`, `ai-anomaly-detector`,
`industry-benchmarks-recompute`), enchufar pg_cron → `pg_net.http_post`
con header `Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}`.

Ejemplo:
```sql
SELECT cron.schedule(
  'pasify-ai-pricing-propose',
  '0 * * * *',
  $$
    SELECT net.http_post(
      url := 'https://ixkyfwzkknehvsqpopof.supabase.co/functions/v1/ai-pricing-propose',
      headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key'))
    );
  $$
);
```

## Testing local

```bash
supabase start                          # arranca DB + edge runtime local
supabase functions serve --env-file .env.local
curl -X POST http://localhost:54321/functions/v1/health-check
```
