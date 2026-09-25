# Pasify · Scripts (Windows)

Scripts PowerShell para preparar el backend de Pasify desde Windows.
Todo está en `scripts/` y se ejecuta desde la raíz del repo.

> **El despliegue a producción NO se hace desde aquí.** Migraciones y edge
> functions llegan a producción por un único camino: el workflow
> `.github/workflows/deploy-production.yml` (tests de BD → migraciones →
> funciones) al hacer push a `main`. Ver [CI/CD](#cicd).

## Pre-requisitos

1. **Supabase CLI** instalado, en la misma versión que el CI (2.117.0, fijada
   en `.github/workflows/db-tests.yml` y `deploy-production.yml`):
   ```powershell
   scoop install supabase    # vía Scoop
   # o
   winget install Supabase.cli
   ```
   Verifica: `supabase --version`

2. **PowerShell con permisos** para ejecutar scripts locales (una sola vez):
   ```powershell
   Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
   ```

3. **Cuenta Supabase con acceso al proyecto** `ixkyfwzkknehvsqpopof`. Si es la cuenta del dueño del proyecto Pasify, perfecto. Si no, el Owner debe añadirte como miembro de la organization.

Los `.ps1` se guardan en UTF-8 **con BOM**: PowerShell 5.1 lee un UTF-8 sin BOM
como ANSI y los acentos y emojis rompen el script.

## Paso 1 · Login & Link

```powershell
.\scripts\01-login-and-link.ps1
```

- Abre el navegador para login Supabase.
- Lista tus proyectos accesibles (verifica que `ixkyfwzkknehvsqpopof` aparece).
- Linkea el proyecto.

> **Si tu cuenta NO tiene acceso al proyecto** verás `Your account does not have the necessary privileges`. Pide al Owner que te añada como miembro: Dashboard → Project Settings → Team → Invite member.

## Paso 2 · Configurar secrets

```powershell
# Copia el template a un archivo no commiteable
Copy-Item secrets.template.env secrets.env

# Edita con tus claves reales (Stripe, Resend, FCM, etc.)
notepad secrets.env

# Manda todos los secrets al proyecto Supabase
.\scripts\02-set-secrets.ps1
```

`secrets.env` está en `.gitignore`. Nunca lo commitees.

**Mínimos para que cosas funcionen:**
- `APP_BASE_URL`, `SUPPORT_EMAIL` → general
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` → checkout + webhook
- `RESEND_API_KEY`, `EMAIL_FROM` → emails transaccionales

El resto (Twilio, FCM, Turnstile) puedes añadirlos cuando vayas activando esos módulos. Las edge functions degradan elegantemente a "fallback" (log-only) si las keys faltan.

## Desplegar una función a mano (solo emergencias)

Lo normal es el workflow: Actions → **Deploy · producción** → Run workflow, con
el nombre de la función (pasa por los tests de BD y queda registrado). Si de
verdad hay que hacerlo desde tu máquina:

```powershell
supabase functions deploy stripe-webhook --no-verify-jwt
```

`--no-verify-jwt` siempre: la app llama con la publishable key
(`sb_publishable_…`), que no es un JWT, y sin el flag el gateway rechaza toda
llamada sin sesión. `supabase/config.toml` también lo fija para cada función.

**Verificar deploys:**
```powershell
supabase functions list
```

**Retirar una función:** borra su carpeta y su entrada de `supabase/config.toml`
en un PR y, después, `supabase functions delete <nombre>` en producción. El
workflow **CI · funciones en producción vs repo** avisa de lo que quede
publicado sin carpeta.

## Configurar webhook Stripe

Después del primer deploy, el webhook está en:

```
https://ixkyfwzkknehvsqpopof.supabase.co/functions/v1/stripe-webhook
```

En Stripe Dashboard → Developers → Webhooks → Add endpoint:
- **URL**: pega la anterior
- **Events**: marca al menos
  - `checkout.session.completed`
  - `checkout.session.expired`
  - `charge.refunded`
  - `account.updated`
  - `payout.paid`, `payout.failed`
  - `customer.subscription.created/updated/deleted`
- **Copy signing secret** → ponlo en `secrets.env` como `STRIPE_WEBHOOK_SECRET` y re-ejecuta `02-set-secrets.ps1`.

## Troubleshooting

### `Your account does not have the necessary privileges`
Tu cuenta de Supabase NO está vinculada al proyecto Pasify. Soluciones:
1. Logueate con la cuenta correcta: `supabase logout && supabase login`
2. Pide al Owner que te añada como Member en la organization Supabase.

### `Invalid Function name`
Estás ejecutando una línea de bash en CMD (que la interpreta como comando). Usa **PowerShell** no CMD, y siempre los scripts `.ps1`.

### Cómo abrir PowerShell desde la carpeta
- Shift + Click derecho en la carpeta `pasify-main` → "Abrir ventana de PowerShell aquí"
- O en la barra de direcciones del Explorer escribe `powershell` y Enter

### Ver logs de una función
Dashboard → Edge Functions → seleccionar función → tab "Logs".
Filtrar por `level=error` o por `function=stripe-webhook`.

## CI/CD

| Workflow | Cuándo | Qué hace |
|---|---|---|
| `ci.yml` | PR y push a `main` | Lint, typecheck (sin errores nuevos), i18n, `vite build`, E2E del panel de local, gitleaks |
| `db-tests.yml` | Cada PR a `main` (y desde el despliegue) | `supabase start` + todos los `tests/db/*.sql` |
| `deploy-production.yml` | Push a `main` con cambios en `supabase/` o `tests/db/` | Tests de BD → `supabase db push` (sin `--include-all`) → edge functions; tipos regenerados |
| `functions-drift.yml` | Tras cada despliegue, a diario y a mano | Funciones publicadas vs carpetas de `supabase/functions/` |
| `smoke.yml` | Deploy de Vercel en producción | Web 200, health-check y funciones protegidas con 401/403 sin sesión |

Configuración en GitHub (Settings):
- **Secrets**: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD_PRODUCTION`, `SUPABASE_ANON_KEY`.
- **Variables**: `SUPABASE_PROJECT_REF_PRODUCTION=ixkyfwzkknehvsqpopof`.
- **Environment `production`** con revisores obligatorios (migraciones y funciones esperan aprobación).
- **Protección de `main`**: checks obligatorios `Lint + Typecheck + Build`, `DB · tests (tests/db/*.sql)` y `E2E · panel de local (Supabase simulado)`.
- **Integración de GitHub de Supabase**: sin despliegue automático, o migraciones y funciones llegan por dos caminos.
