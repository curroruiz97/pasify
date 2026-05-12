# Pasify · Scripts de Deploy (Windows)

Scripts PowerShell para deployar el backend Pasify desde Windows.
Todo está en `scripts/` y se ejecuta desde la raíz del repo.

## Pre-requisitos

1. **Supabase CLI** instalado:
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

## Flujo (3 pasos)

### Paso 1 · Login & Link

```powershell
.\scripts\01-login-and-link.ps1
```

- Abre el navegador para login Supabase.
- Lista tus proyectos accesibles (verifica que `ixkyfwzkknehvsqpopof` aparece).
- Linkea el proyecto.

> **Si tu cuenta NO tiene acceso al proyecto** verás `Your account does not have the necessary privileges`. Pide al Owner que te añada como miembro: Dashboard → Project Settings → Team → Invite member.

### Paso 2 · Configurar secrets

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

El resto (Twilio, FCM, OpenAI, Turnstile) puedes añadirlos cuando vayas activando esos módulos. Las edge functions degradan elegantemente a "fallback" (log-only) si las keys faltan.

### Paso 3 · Deploy de todas las edge functions

```powershell
.\scripts\03-deploy-all.ps1
```

Itera `supabase/functions/*` (excluyendo `_shared`) y deploya cada función. Reporta éxitos/fallos al final.

**Solo una función:**
```powershell
supabase functions deploy stripe-webhook
```

**Verificar deploys:**
```powershell
supabase functions list
```

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

### Re-deploy una función tras cambio
```powershell
supabase functions deploy stripe-webhook
```

### Ver logs de una función
Dashboard → Edge Functions → seleccionar función → tab "Logs".
Filtrar por `level=error` o por `function=stripe-webhook`.

## Paso 4 (opcional) · Limpieza legacy Students Life

Las rutas y referencias a las páginas Students Life (Social, Chats, Badges, etc.) ya están
desconectadas de `App.tsx` pero los archivos siguen en disco como código muerto.

Para eliminarlos del disco:

```powershell
# Primero revisa qué se va a borrar (sin tocar nada)
.\scripts\04-cleanup-legacy.ps1 -DryRun

# Luego ejecuta el borrado real
.\scripts\04-cleanup-legacy.ps1
```

Elimina:
- 5 páginas: Social, Chats, ChatConversation, Badges, UserProfile
- 3 carpetas: `components/social`, `components/chat`, `components/quiz`
- 3 componentes: UploadSheet, AdminChats, PartnerSocialProfile
- 11 hooks: useQuiz*, useChat, useTypingIndicator, useOnlinePresence, useGlobalTyping, useUnreadMessages, useUnreadNotifications, useNotificationSound

Después: `npx tsc --noEmit` para verificar que sigue compilando, y `git status` antes del commit.

## CI/CD (automático)

Una vez configurado todo lo anterior, los pushes a `main`/`staging` deployan automáticamente vía GitHub Actions. Ver `.github/workflows/deploy-edge-functions.yml`.

Necesitas configurar en GitHub repo Settings:
- **Secrets**: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD_PRODUCTION`, etc.
- **Variables**: `SUPABASE_PROJECT_REF_PRODUCTION=ixkyfwzkknehvsqpopof`, `APP_BASE_URL=https://pasify.es`, etc.
- **Environments**: crear `production` y `staging` con reviewers obligatorios.
