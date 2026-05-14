# Pasify · Hardening pendiente

Tracking de items que NO se aplicaron en la pasada de mayo 2026 y la razón.

## P4 — Refactor masivo `auth_rls_initplan` (111 policies)

**Estado**: pendiente, próximo sprint.

**Qué**: el advisor 0003 marca 111 RLS policies que llaman `auth.uid()` o
`current_setting()` directamente. Postgres re-evalúa esas funciones por cada
fila evaluada → cuello de botella a escala (especialmente en tablas grandes
con realtime, ej. `tickets`, `events`, `notifications`).

**Fix**: reemplazar `auth.uid()` por `(SELECT auth.uid())` y
`current_setting('x')` por `(SELECT current_setting('x'))` en cada USING /
WITH CHECK. Postgres cachea el resultado por query.

**Por qué no en esta pasada**:
- Volumen alto (111 policies → 60+ tablas).
- Riesgo: una policy mal regenerada rompe RLS de la tabla.
- Necesita testing por tabla (smoke RLS por rol).
- Aproach correcto: generar SQL automático con plpgsql que itere
  `pg_policies`, reescriba `qual`/`with_check` y emita DROP+CREATE.
  Pero hay edge cases: roles array, permissive flag, with_check NULL, etc.

**Top tablas con más policies a re-escribir** (priorizar):
1. `user_blocks` (4)
2. `refund_request_messages` (4)
3. `organizations`, `support_conversations`, `ticket_transfers`,
   `pricing_proposals`, `compliance_dsar_requests`, `compliance_consents`,
   `bug_reports` (3 cada una)
4. 15 tablas con 2 policies
5. ~40 tablas con 1 policy

**Plan**:
1. Generar un dump de `pg_policies` filtrado con las 111 entradas.
2. Por tabla, hacer un DROP + CREATE script revisado manualmente.
3. Aplicar en staging primero. Smoke test E2E por rol.
4. Aplicar en producción durante baja carga.

## Leaked Password Protection (Auth setting)

**Estado**: pendiente, requiere toggle manual.

**Qué**: el advisor 0004 (`auth_leaked_password_protection`) flagea que la
opción "Protect against pwned passwords" está desactivada. Cuando se
activa, Supabase Auth comprueba las contraseñas nuevas contra HaveIBeenPwned
en signup/reset.

**Por qué no en esta pasada**: la configuración solo se cambia desde el
Dashboard → Authentication → Settings → "Leaked Password Protection".
No hay endpoint público en la Management API (al menos en la versión
actual MCP) que lo cambie. **Activar manualmente** desde:
https://supabase.com/dashboard/project/ixkyfwzkknehvsqpopof/auth/providers

Toggle "Prevent sign-ups with leaked passwords" → ON.

## `pg_net` extension en schema `public`

**Estado**: aceptado como ruido del advisor.

**Qué**: el advisor 0014 (`extension_in_public`) seguía flageando `pg_net`
tras la migration 0049 (que movió pg_trgm/unaccent/btree_gin a `extensions`).
Razón: `pg_net` NO soporta `ALTER EXTENSION ... SET SCHEMA` (devuelve
SQLSTATE 0A000 "extension does not support SET SCHEMA").

**Mitigación**: las funciones públicas de pg_net viven en su propio schema
`net`, así que mover la extension no cambiaría dónde se invocan. El advisor
es ruidoso aquí — esta entrada queda como aceptada.

## `multiple_permissive_policies` (171 ocurrencias)

**Estado**: aceptado como deuda — consolidación caro.

**Qué**: advisor 0002 marca tablas con varias policies PERMISSIVE para el
mismo (role, command). Postgres tiene que OR-ear todas → coste de query.

**Por qué no se toca**: requiere análisis caso por caso, fusionando policies
en una sola con OR explícito en `USING`. Riesgo similar a P4: una fusión
mal hecha rompe RLS. Documentado para futura iteración.

## `unused_index` (177 índices)

**Estado**: aceptado — falsos positivos esperados.

**Qué**: pg_stat_user_indexes reports indices con 0 scans desde el último
restart de stats. Muchos de estos índices son legítimos:
- Índices recién creados (sin tráfico todavía)
- Índices que se usan solo en queries de admin/cron poco frecuentes
- Índices que cubren constraints (UNIQUE, FK)

Dropear sin más es peligroso. Revisar manualmente solo cuando un índice
muestre 0 scans durante 30+ días en producción.

## E2E coverage gaps

**Pendiente añadir**:
- `tests/e2e/onboarding-flow.spec.ts`: signup partner → wizard 5 pasos →
  dashboard activo
- `tests/e2e/checkout-flow.spec.ts`: client compra ticket (Stripe test card
  4242…) → wallet muestra ticket con QR
- `tests/e2e/admin-grant.spec.ts`: admin concede acceso a partner → partner
  ve `isAdminGranted=true` en `usePartnerSubscription`

El test push-foreground (P2.4) sienta la base — replicar el patrón.
