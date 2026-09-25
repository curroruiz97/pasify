# Pasify

Ticketing y gestión de ocio nocturno en España: los locales publican eventos y
venden entradas, el cliente compra y guarda sus entradas, la puerta las valida
con QR, y un panel de admin supervisa la plataforma.

- **Web:** https://pasifyy.vercel.app (el dominio `pasify.es` está pendiente
  del cambio de DNS; ver [DEPLOY_VERCEL.md](./DEPLOY_VERCEL.md)).
- **Apps:** Android e iOS con Capacitor (`es.pasify.app`), el mismo bundle web.
- **Supabase de producción:** `ixkyfwzkknehvsqpopof`.

---

## Arquitectura

- **Frontend** (`src/`): Vite 5 + React 18 + TypeScript, Tailwind 3 con
  componentes shadcn/Radix (`src/components/ui`), TanStack Query 5 con caché
  por usuario en IndexedDB (`src/lib/cache`), `HashRouter` (rutas `/#/…`),
  i18next (solo `es`). En web es una PWA (`vite-plugin-pwa`); en móvil,
  Capacitor 7.
- **Backend:** Supabase. Postgres con RLS y RPC (`supabase/migrations/`),
  Auth, Storage, Realtime y 31 edge functions en Deno (`supabase/functions/`,
  ver su [README](./supabase/functions/README.md)). Tareas periódicas con
  `pg_cron`.
- **Pagos:** Stripe Checkout con Stripe Connect: el cobro va a la cuenta del
  local y Pasify se queda su comisión (`application_fee`). Emails con Resend,
  push con FCM, SMS con Twilio, errores con Sentry.
- **Vercel:** sirve `dist/` y dos funciones Node (`api/e/[id].ts`,
  `api/p/[id].ts`) que dan las tarjetas Open Graph de los enlaces
  `/e/<evento>` y `/p/<local>`.
- **Realtime:** la app escucha cambios de `tickets`, `ticket_orders`,
  `refund_requests`, `support_conversations`, `support_messages` y
  `ai_kill_switches`; son las únicas tablas de la publicación
  `supabase_realtime` (migración `20260928110000`). Una tabla nueva que se
  quiera escuchar hay que añadirla a la publicación en su migración.

### Roles

| Rol (`user_roles`) | Panel |
|---|---|
| `client` | `/#/client-dashboard`: entradas, reembolsos, transferencias, soporte |
| `partner` | `/#/partner-dashboard` (eventos, ventas, equipo, reembolsos…) y `/#/door` (modo puerta) |
| `admin` | `/#/admin`: locales, pedidos, reembolsos, liquidaciones, soporte, auditoría |

El rol inicial solo se reclama una vez (RPC `claim_initial_role`). El
super-admin lo define `public.is_super_admin()`; con
`VITE_ENABLE_SUPER_ADMIN_SWITCHER=true` puede saltar entre los tres paneles
(`PanelSwitcher`).

---

## Desarrollo local

```bash
npm ci
cp .env.example .env.local   # rellena VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY
npm run dev                  # http://localhost:8080
```

`npm run dev` necesita `.env.local`: sin él, el cliente de Supabase cae en
`https://placeholder.supabase.co` y nada funciona. Los valores públicos de
producción están en `.env.production`, que solo se lee en `npm run build`; si
los copias a `.env.local`, la app local habla con el **Supabase de
producción**. Para el Supabase local, usa la URL y la clave anon que da
`supabase status`.

| Comando | Qué hace |
|---|---|
| `npm run dev` | Vite con HMR en :8080 |
| `npm run build` | Build de producción en `dist/` (falla si faltan las variables de Supabase) |
| `npm run typecheck` | `tsc` sobre `tsconfig.app.json` y `tsconfig.node.json`; falla solo con errores que no estén en `scripts/typecheck-baseline.json` |
| `npm run typecheck:baseline` | Reescribe el baseline cuando se arreglan errores (nunca para esconder uno nuevo) |
| `npm run typecheck:full` | Todos los errores de `tsc`, incluidos los del baseline |
| `npm run lint` | ESLint en todo el repo |
| `npm run i18n:check` / `i18n:fix` | Detecta / arregla mojibake en `src/i18n/locales/*.json` |
| `npm run test:e2e:partner` | Playwright con el Supabase simulado (ver abajo) |
| `npm run test:e2e` | Playwright con la config general (Supabase simulado por defecto) |
| `npm run cap:sync` · `android:run` · `android:build:bundle` | Build + Capacitor Android |

`tsc --noEmit` a secas no comprueba nada (`tsconfig.json` solo tiene
`references`): usa `npm run typecheck`.

---

## Verificación local

### Base de datos: Supabase en Docker + tests con `psql`

Con Docker y el Supabase CLI en la versión del CI (2.117.0):

```bash
supabase start     # Postgres en 127.0.0.1:54322, API en :54321; aplica supabase/migrations (no hay seed)
supabase db reset  # vuelve a crear la base con todas las migraciones
```

Los tests de BD son `tests/db/*.sql`. Cada uno abre su transacción, crea datos
sintéticos y acaba en `ROLLBACK`; un fallo es un `RAISE EXCEPTION 'FAIL …'` y
`psql` termina con error. Todos, como en el CI:

```bash
export PGPASSWORD=postgres
for f in tests/db/*.sql; do
  psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -X -v ON_ERROR_STOP=1 -q -f "$f" || echo "FALLA $f"
done
```

Para probar migraciones nuevas sin aplicarlas a la base local, cárgalas en la
misma transacción que el test y deshaz todo al final (PowerShell; la cabecera
de cada test trae su versión):

```powershell
$env:PGPASSWORD='postgres'; $m = Get-ChildItem supabase\migrations\*.sql | ? { $_.Name -gt '20260925110000' } | Sort-Object Name; $a=@('-h','127.0.0.1','-p','54322','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-q','-c','BEGIN;'); foreach($f in $m){$a+=@('-f',$f.FullName)}; $a+=@('-f','tests\db\o3_plataforma.sql','-c','ROLLBACK;'); & psql @a
```

El filtro carga las migraciones a partir de `20260925110000`, las que esa base
local aún no tenía; ajústalo a lo que le falte a la tuya
(`select max(version) from supabase_migrations.schema_migrations`).

### E2E con el Supabase simulado

`tests/e2e/support/fake-supabase.ts` contesta con `page.route` a las
peticiones que la app hace a un puerto local donde no escucha nadie: ningún
test sale a un Supabase real.

```bash
npm run test:e2e:partner                  # panel de local, puerta, cuentas, cliente, vuelta del pago, transferencias (Vite propio en :8090)
PW_CHANNEL=chrome npm run test:e2e:partner   # con el Chrome del sistema
npx playwright test                       # el resto de specs (Vite propio en :8091)
PW_SUPABASE=local PW_LOCAL_SUPABASE_KEY=<clave anon de `supabase status`> npx playwright test   # contra el Supabase local
```

Las configs (`playwright.partner.config.ts`, `playwright.config.ts`) arrancan
siempre su propio Vite y se niegan a apuntar a un Supabase remoto.

---

## CI/CD

| Workflow | Cuándo | Qué hace |
|---|---|---|
| `ci.yml` | PR y push a `main` | Lint (no bloquea), typecheck contra el baseline, `i18n:check`, `vite build` y tamaño del chunk principal; E2E con el Supabase simulado (`test:e2e:partner`); en PR, gitleaks (bloquea) y `npm audit` (no bloquea) |
| `db-tests.yml` | Cada PR a `main`, y como primer paso del despliegue | `supabase start` con todas las migraciones y todos los `tests/db/*.sql` |
| `deploy-production.yml` | Push a `main` que toque `supabase/migrations`, `supabase/functions`, `supabase/config.toml`, `tests/db`, `deploy-production.yml` o `db-tests.yml`; o a mano | Único camino a producción de la BD y las funciones: **tests de BD → migraciones → edge functions** |
| `functions-drift.yml` | Tras cada despliegue, cada mañana y a mano | Compara las funciones publicadas con las carpetas de `supabase/functions/` |
| `smoke.yml` | Despliegue de Vercel en producción, o a mano | La web responde 200, `health-check` funciona y las funciones protegidas dan 401/403 sin sesión |

`deploy-production.yml`, en orden:

1. **Tests de BD** (`db-tests.yml`). Si fallan, no se toca producción.
2. **Migraciones**, si cambiaron desde el último despliegue correcto:
   `supabase db push` sin `--include-all` en el environment `production`
   (con aprobación). Después regenera `src/integrations/supabase/types.ts` y lo
   sube a `main`.
3. **Edge functions**, si cambiaron `supabase/functions/` o `config.toml` (y
   solo si las migraciones fueron bien o no había): todas las carpetas con
   `index.ts` que no empiezan por `_`, con `--no-verify-jwt`; al final,
   `health-check`. A mano (Actions → *Deploy · producción* → *Run workflow*)
   se puede desplegar una sola.

La web la despliega Vercel desde `main` con su integración de GitHub (sin
workflow propio): cada push a `main` sale a producción.

**Tamaño del bundle.** `ci.yml` falla si el chunk principal (el
`dist/assets/index-*.js` que carga `index.html`) pasa de `MAX_MAIN_CHUNK_KB`
(850 KB de 1024 bytes, sin comprimir; en septiembre de 2026 pesaba ~792 KB).
El umbral está al principio de `ci.yml`; se sube solo a propósito, en el PR que
lo justifique.

Configuración en GitHub: secretos `SUPABASE_ACCESS_TOKEN`,
`SUPABASE_DB_PASSWORD_PRODUCTION` y `SUPABASE_ANON_KEY`; variable
`SUPABASE_PROJECT_REF_PRODUCTION`; environment `production` con revisores; y el
despliegue automático de la integración de GitHub de Supabase desactivado. Más
detalle en [scripts/README.md](./scripts/README.md).

---

## Variables de entorno

Cliente (`VITE_*`, van dentro del bundle; no son secretas): ver
`.env.example`. Las imprescindibles son `VITE_SUPABASE_URL` y
`VITE_SUPABASE_PUBLISHABLE_KEY`; los valores públicos de producción están en
`.env.production`. En Vercel se configuran en el dashboard
([DEPLOY_VERCEL.md](./DEPLOY_VERCEL.md)).

Servidor (secretos de Supabase para las edge functions, nunca con `VITE_`):
lista completa en [supabase/functions/README.md](./supabase/functions/README.md#secretos).
Se cargan con `supabase secrets set` o con `scripts/02-set-secrets.ps1` a
partir de `secrets.template.env`.

---

## Estructura

```
.
├── src/
│   ├── pages/                 # Pantallas (rutas de App.tsx)
│   ├── components/            # admin/, partner/, client/, shared/, support/, ui/ (shadcn), …
│   ├── hooks/                 # useAuth, useOrganization, queries/ (TanStack Query), …
│   ├── lib/                   # cache/ (React Query + IndexedDB), sentry, redirect-url, …
│   ├── integrations/supabase/ # cliente y tipos generados (los regenera el CI)
│   └── i18n/                  # config + locales/es.json
├── api/                       # Funciones de Vercel (Open Graph de /e/:id y /p/:id)
├── supabase/
│   ├── migrations/            # Migraciones (orden por versión; las aplica el CI)
│   ├── functions/             # Edge functions; _shared/ es código común, no se despliega
│   └── config.toml            # verify_jwt = false de cada función
├── tests/
│   ├── db/                    # Tests SQL (db-tests.yml)
│   └── e2e/                   # Playwright; support/fake-supabase.ts
├── scripts/                   # typecheck-baseline, i18n, gradle, scripts de Supabase en PowerShell
├── android/ · ios/            # Proyectos de Capacitor
└── .github/workflows/         # ci, db-tests, deploy-production, functions-drift, smoke
```

---

## Licencia

UNLICENSED: propietario. No distribuir sin permiso explícito.
