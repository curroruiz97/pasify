-- Pasify · 0049 mover extensions a schema `extensions`
--
-- El advisor 0014 (`extension_in_public`) marca 4 extensions instaladas
-- en el schema `public`: pg_net, pg_trgm, unaccent, btree_gin. Práctica
-- recomendada Supabase: vivir en schema dedicado `extensions`.
--
-- Compatibilidad:
--   - `search_path` cluster-default ya incluye `extensions` (verificado
--     con SHOW search_path en producción). Las llamadas sin qualifier
--     (e.g. `unaccent(x)`) siguen resolviendo tras el ALTER.
--   - `pg_net` expone funciones en el schema `net` (creado por la
--     extension), NO en el schema donde se instala. Mover la extension
--     no afecta `net.http_post()` etc.
--   - Las funciones con `SET search_path = public` en su body podrían
--     no resolver extensions tras el move. Verificado: ninguna migration
--     usa unaccent/similarity/pg_trgm/btree_gin con qualifier ni nombre
--     simple — extensions están instaladas pero no usadas activamente.
--
-- Idempotente: si la extension ya está en `extensions`, el ALTER es no-op.

CREATE SCHEMA IF NOT EXISTS extensions;
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;

-- Mover las 4 flageadas. pg_cron lo dejamos donde está (Supabase lo
-- gestiona en su propio schema y no aparecía en el advisor).
--
-- Nota: `pg_net` NO soporta SET SCHEMA (la propia extension lo marca
-- como unsupported, SQLSTATE 0A000). Sus funciones públicas viven en
-- el schema `net` independientemente de dónde se instale la extension,
-- así que mover no añade beneficio funcional ni de seguridad. Se queda
-- en `public` y se reconoce el advisor como ruido aceptado para pg_net.
ALTER EXTENSION pg_trgm SET SCHEMA extensions;
ALTER EXTENSION unaccent SET SCHEMA extensions;
ALTER EXTENSION btree_gin SET SCHEMA extensions;
