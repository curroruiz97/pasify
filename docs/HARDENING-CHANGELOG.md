# Pasify · Hardening sessions changelog (mayo 2026)

Resumen de todas las pasadas de hardening pre-producción aplicadas en
mayo 2026. Cada bloque corresponde a un commit en `main`.

## Migrations aplicadas (en orden cronológico)

| # | Timestamp | Nombre | Resumen |
|---|---|---|---|
| 0042 | 20260514100000 | `partner_branding_bucket_public_read` | Bucket público para logo/cover |
| 0043 | 20260514110000 | `revoke_anon_admin_rpcs` | REVOKE EXECUTE de admin_* a anon |
| 0044 | 20260514120000 | `partner_branding_restrict_listing` | Permite URL directa pero bloquea LIST API |
| 0045 | 20260514130000 | `public_partners_view` | View con security_invoker, listing público de partners |
| 0046 | 20260514140000 | `revoke_anon_security_definer_blanket` | (no-op, ver 0047) |
| 0047 | 20260514150000 | `revoke_public_security_definer` | REVOKE FROM PUBLIC + GRANT explícito a authenticated/service_role + whitelist anon (9 funciones) |
| 0048 | 20260514160000 | `perf_fk_indexes_and_dedup` | +8 índices FK, −6 índices duplicados |
| 0049 | 20260514170000 | `extensions_to_dedicated_schema` | pg_trgm/unaccent/btree_gin → schema `extensions` |
| 0050 | 20260514180000 | `perf_rls_initplan_wrap_auth_uid` | Wrap `auth.uid()` → `(SELECT auth.uid())` en 150 policies |
| 0051 | 20260514190000 | `apply_pricing_proposal_rpc` | RPC atómica para aprobar pricing proposal (A2) |
| 0052 | 20260514200000 | `referrals` | Backend refer-a-friend (códigos + claims + 2 RPCs) |
| 0053 | 20260514210000 | `drop_redundant_permissive_policies` | Drop 2 policies subset (venues, brands) |

## Commits de código (en orden cronológico)

```
3fa6beb feat(partner): onboarding obligatorio + Configuracion multi-local
53c372b fix(hardening): bugs y riesgos pre-produccion (P0 + P1)
35aac99 chore(hardening): fase P2 + P3 - calidad y observabilidad
13fbac3 perf(hardening): indices, extensions, fallbacks, docs pendientes
2a679ee perf+test(hardening): wrap auth.uid() en RLS + 3 e2e smoke tests
cb6eeb3 feat(honesty): cablear features mock + badges Beta honestos
<NEXT>  feat(referrals): backend mínimo + UI real + drop policies redundantes
```

## Resumen de impacto

### Seguridad (advisor 28 — anon executable SECURITY DEFINER)

| Antes | Después | Status |
|---|---|---|
| 83 funciones anon-callable | 9 (whitelist intencional) | ✅ |
| `admin_grant_partner_access` anon | bloqueado | ✅ |
| `request_refund` anon | bloqueado | ✅ |
| Verificado via `has_function_privilege` | OK | ✅ |

### Seguridad (advisor 25 — public bucket listing)

| Antes | Después |
|---|---|
| `partner-branding` LIST público | LIST restringido a org members |
| Display de logos via URL directa | Sigue funcionando (CDN bypass RLS) |

### Performance (advisor 0001/0003/0009)

| Lint | Antes | Después |
|---|---|---|
| `auth_rls_initplan` | 111 ocurrencias | 0 ✅ |
| `unindexed_foreign_keys` | 8 | 0 ✅ |
| `duplicate_index` | 6 | 0 ✅ |
| `multiple_permissive_policies` | 171 | ~167 (top redundantes dropeadas; resto documentado) |
| `unused_index` | 177 | 183 (esperado: 8 nuevos sin tráfico todavía) |

### Calidad de producto

- **Eliminados DEMO_PARTNERS** de ClientDashboard y PublicPartnerPage (Pacha, Razzmatazz, etc. ya no aparecen en producción real).
- **Fallbacks silenciosos sustituidos**: usePartnerContext y ClientDashboard ahora muestran banner explícito "No pudimos cargar · Reintentar" en lugar de fingir éxito.
- **JSDoc engañoso corregido**: `usePartnerSubscription.admin_granted_until=null` ahora documenta "sin grant" (coherente con código). `useOrganization` ya no promete "realtime" que no implementa.
- **Push event bug corregido**: `pasify:push-received` → `foreground-push` para que el listener en App.tsx lo reciba.

### Features mock → real (commit `cb6eeb3` y siguiente)

| Feature | Antes | Después |
|---|---|---|
| Partner Forecast | mock local `forecastFor()` | `ai-forecast-event` + `forecast_predictions` |
| Dynamic Pricing | seed event.id | `pricing_proposals` + RPC `apply_pricing_proposal` |
| Partner Reports BI | `buildSeries()` mock | Queries reales sobre `tickets` |
| Partner Cashless | array `ACCOUNTS` fijo | `cashless_wallets` + agregados |
| Client Concierge | `generateConciergeReply` local | Wrapper SupportChat real |
| Refer-a-friend | CTA disabled | RPCs + UI con código compartible + canje |
| Door Vision | "Computer Vision · Activo" hardcoded | BetaBadge honesto |
| AutoPilot | seed actions | BetaBadge honesto |
| Live Experience | activación demo | BetaBadge honesto |
| SupportChat fallback | `generateDemoReply` local | Empty state honest si no hay session |

### Componentes nuevos

- `src/components/shared/BetaBadge.tsx` — pill + tooltip Radix
- `src/components/shared/PartnerImageUploader.tsx` (sesión partner onboarding)
- `src/components/ui/spanish-city-select.tsx` (sesión partner onboarding)
- `src/components/client/ReferAFriendCard.tsx`
- `src/lib/redirect-url.ts`

### E2E tests añadidos

- `tests/e2e/push-foreground.spec.ts` — regresión bug P0.1
- `tests/e2e/onboarding-flow.spec.ts` — register partner
- `tests/e2e/checkout-flow.spec.ts` — no demo data, no crash en /ticket/success
- `tests/e2e/admin-grant-revoke.spec.ts` — regresión migs 0047 y 0050

## Pendientes documentados (no urgentes)

### Roadmap externo

- **AutoPilot agente autónomo** — backend de policies/decisions existe, falta lógica que itere.
- **Door Vision real** — requiere cámaras IP + OCR + modelo edad.
- **Live Experience real del cliente** — requiere geolocalización in-venue + push.
- **Cashless RFID provisioning** — requiere SDK hardware.

### Deuda técnica

- **`multiple_permissive_policies`** restante (~167). Refactor caso por caso; muchas son patrón intencional (member + admin escape hatch) y no se deben merge.
- **`authenticated_security_definer_function_executable`** (83). Refactor a SECURITY INVOKER cuando la función no requiera bypass RLS. Baja prioridad — están protegidas por `auth.uid()` interno.
- **`unused_index`** (183). Revisar tras 30 días de tráfico real.
- **`pg_net` en schema `public`**. Limitación de la extension (no soporta SET SCHEMA). Aceptado.

### Setting manual

- ✅ **Leaked Password Protection** — activado por el usuario en Dashboard Supabase Auth → Attack Protection.

## Verificación end-to-end

Cualquiera puede verificar el estado actual del proyecto:

```bash
# Type + lint
npx tsc --noEmit
npm run lint

# Build
npm run build

# E2E (necesita VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY)
npm run test:e2e

# Advisors Supabase
# (vía MCP get_advisors o Supabase Dashboard → Database → Advisors)
```

Resultado esperado: 0 errores TypeScript, 0 errores ESLint, build verde,
e2e smoke tests verdes, advisor security con solo whitelist + deuda
documentada.

## Notas finales

El proyecto pasa de:

- 83 funciones admin/critical ejecutables sin auth → 9 (whitelist token-based)
- 111 policies con `auth.uid()` re-evaluado por fila → 0
- 14 buckets/policies de seguridad flageados → 1 (pg_net, limitación de la extension)
- 10 features mock que engañaban al usuario → 6 cableadas a backend real + 4 con BetaBadge honesto
- 0 e2e tests específicos de regresión → 4 spec files

Lo que no se pudo hacer queda **documentado, no escondido**.
