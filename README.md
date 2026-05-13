# Pasify

> SaaS multi-tenant para ticketing, hospitalidad y operaciones nocturnas en España.

Pasify gestiona discotecas, festivales, clubs y salas con tres dashboards
(Admin · Partner · Client), Stripe Connect para payouts directos a partners,
edge functions para cashless / refunds / soporte tri-direccional, y una capa
de AI para forecast, pricing dinámico y autopilot.

**Producción:** https://pasifyy.vercel.app (dominio final `pasify.es` pendiente
de cutover DNS).

---

## Quick start (desarrollo local)

```bash
npm install
cp .env.example .env.local  # edita VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY
npm run dev                 # http://localhost:8080
```

Para el backend local:

```bash
supabase start              # arranca postgres + auth + storage + edge runtime en :54321/2/3
supabase db reset           # aplica las 35 migrations + seed
```

Scripts útiles:

| Comando            | Acción |
|--------------------|--------|
| `npm run dev`      | Vite dev server (HMR) |
| `npm run build`    | Build producción + PWA service worker |
| `npm run typecheck`| `tsc --noEmit` |
| `npm run lint`     | ESLint sobre `src/` |
| `npm run i18n:check` | Detecta mojibake (UTF-8 doble encoding) en `src/i18n/locales/*.json` |
| `npm run i18n:fix`   | Arregla mojibake en sitio |
| `npm run test:e2e`   | Playwright (smoke + login + role-hardening) |

---

## Arquitectura

- **Frontend**: Vite + React + TypeScript + Tailwind. HashRouter (`/#/admin`),
  PWA con service worker, Capacitor para wraps Android/iOS.
- **Backend**: Supabase Postgres + Auth + Storage + Realtime + Edge Functions.
  Proyecto producción: `ixkyfwzkknehvsqpopof.supabase.co`.
- **Schema**: 35 migrations en `supabase/migrations/`, modelo enterprise
  `organizations → brands → venues` + `partner_subscriptions` (1:1 con org).
- **Roles**: 3 roles canónicos en `user_roles` (admin / partner / client).
  Modo **super-admin/dev** exclusivo para `francisco@avenuemedia.io`
  (validado SQL via `is_super_admin()`).
- **Pagos**: Stripe Connect Standard. Tickets via `ticket_orders` +
  `ticket_tiers`. Application fee Pasify configurable en
  `app_settings.application_fee_pct`.
- **Observabilidad**: Sentry con release tag = git SHA. Audit trail global
  en `audit_logs` con trigger en `user_roles`. Alerting rules en
  `alerting_rules` evaluadas cada minuto por edge `evaluate-alerts`.

---

## Workflows CI/CD

| Workflow | Trigger | Función |
|----------|---------|---------|
| `ci.yml` | push/PR → main | Lint + typecheck + security scan + i18n:check |
| `deploy-edge-functions.yml` | push main, paths `supabase/functions/**` | Deploy 39 edge functions (skip `_legacy`, `_shared`, `_tests`) |
| `db-migrate-production.yml` | push main, paths `supabase/migrations/**` | Aplica migrations vía environment `production` (approval gate) |
| `db-policy-tests.yml` | push main · PR con label `db-test` · manual | pgTAP-style RLS tests via `supabase start` local |
| `smoke.yml` | `deployment_status` Production success | Verifica routes + health-check + admin RLS guard |

Vercel se encarga del deploy web por su propio webhook nativo (no
gestionamos workflow propio para evitar conflictos con auto-deploy).

---

## Edge functions activas (39)

Organizadas en 7 grupos:

- **Stripe**: `stripe-create-checkout`, `stripe-webhook`, `stripe-create-portal`,
  `partner-onboard-stripe-connect`, `partner-stripe-refresh-account`,
  `partner-stripe-create-portal-link`, `process-refund`,
  `admin-cancel-partner-subscription`, `admin-resync-stripe-subs`,
  `debug-stripe-config`
- **Email / SMS / Push**: `send-event-confirmation`, `send-approval-email`,
  `send-password-reset`, `send-marketing-email`, `send-partner-reminder`,
  `send-inactive-notification`, `send-chat-notification`,
  `send-city-notification`, `send-team-invitation`, `send-ticket-transfer`,
  `notify-admin-message`, `notify-new-registration`, `dispatch-notification`,
  `send-push`, `send-sms`
- **AI**: `ai-forecast-event`, `ai-pricing-propose`, `ai-anomaly-detector`,
  `ai-concierge-reply`, `industry-benchmarks-recompute`
- **GDPR / 2FA / Captcha**: `gdpr-export-data`, `enable-2fa`,
  `verify-2fa-code`, `verify-captcha`
- **Account**: `delete-own-account`, `delete-user`,
  `accept-team-invitation`, `accept-ticket-transfer`
- **Health**: `health-check`

Las funciones `_legacy/` están aisladas para arqueología (Students Life
heritage) y NO se deployan. Ver
[`supabase/functions/_legacy/`](./supabase/functions/_legacy/).

---

## Roles & autorización

| Rol | Acceso |
|-----|--------|
| `client` | `/client-dashboard` — comprar tickets, ver historial, refunds, loyalty points |
| `partner` | `/partner-dashboard` — gestionar eventos, ventas en vivo, TPV, cashless, equipo |
| `admin` | `/admin` — orgs, subscriptions, refunds queue, support inbox, audit trail |
| `super-admin/dev` | Francisco con `VITE_ENABLE_SUPER_ADMIN_SWITCHER=true` — alterna entre los tres paneles vía `PanelSwitcher` |

Hardening en backend (mig `20260513120000`):
- `user_roles_self_insert` policy rechaza si el usuario ya tiene rol previo
- RPC `claim_initial_role` es el único camino legítimo para reclamar rol
- Trigger `audit_user_roles_change` registra cualquier mutación

---

## Variables de entorno

```bash
# Cliente (Vite, prefijo VITE_)
VITE_SUPABASE_URL=https://ixkyfwzkknehvsqpopof.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=...
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...
VITE_STRIPE_TEST_MODE=false
VITE_SENTRY_DSN=https://...@o.../...
VITE_ENABLE_SUPER_ADMIN_SWITCHER=true    # solo para Francisco/dev mode

# Server-side (Supabase project secrets — NO VITE_)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
RESEND_API_KEY=re_...
GMAIL_USER=hola@pasify.es                # legacy fallback
GMAIL_APP_PASSWORD=...
ADMIN_EMAIL=hola@pasify.es
OPENAI_API_KEY=sk-...                    # AI features
GEMINI_API_KEY=...                       # moderate-content legacy
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
SUPABASE_SERVICE_ROLE_KEY=...
```

---

## Estructura del repo

```
.
├── src/
│   ├── pages/                    # Route components (HashRouter)
│   ├── components/               # UI reusable
│   │   ├── admin/                # AdminDashboard subsecciones
│   │   ├── client/               # ClientDashboard subsecciones
│   │   ├── partner/              # PartnerDashboard subsecciones
│   │   └── shared/               # NavTree, PanelSwitcher, etc.
│   ├── hooks/                    # useAuth, useOrganization, usePartnerSubscription, useLoyalty, ...
│   ├── integrations/supabase/    # client + typed schema (generado)
│   ├── i18n/locales/             # es/en/fr/it/pt/de.json
│   └── lib/                      # utilidades (sentry, openWebAuth, ...)
├── supabase/
│   ├── migrations/               # 35 migrations (cronológicas, autoritarias)
│   ├── functions/                # edge functions
│   │   ├── _shared/              # módulos compartidos (resend, stripe, supabase, ...)
│   │   └── _legacy/              # Students Life heritage, NO deployadas
│   ├── migrations.legacy-backup/ # 16 migrations placeholder pre-reconciliación (gitignored)
│   └── config.toml               # config CLI + project_id + verify_jwt overrides
├── tests/
│   ├── e2e/                      # Playwright (smoke, login, role-hardening)
│   └── db/                       # SQL policy tests (db-policy-tests.yml)
├── public/                       # static assets + PWA manifest + sitemap + CNAME
├── scripts/                      # scripts útiles (fix-i18n-mojibake, ...)
└── .github/workflows/            # CI/CD pipelines
```

---

## Historia & deuda técnica

Este repo nació como **Students Life** (descuentos universitarios) y se
pivotó a **Pasify** (ticketing nightlife). El branding está purgado del
código activo (Fase 4 PR #7) pero quedan artefactos heredados:

- `public/.well-known/assetlinks.json` con `package_name: es.studentslife.app`
  → requiere rebuild Android con bundle id `es.pasify.app`.
- `backend/google-services.json` apunta al proyecto Firebase legacy → nuevo
  Firebase pendiente.
- `supabase/migrations.legacy-backup/` conserva 16 SQL placeholder
  pre-reconciliación, gitignored.

---

## License

UNLICENSED — propietario. No distribuir sin permiso explícito.
