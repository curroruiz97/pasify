-- Pasify · 0035 alerting rule: unauthorized role escalation attempt
--
-- Fase 1 (mig 20260513120000) ya añadió:
--   - Endurecimiento de `user_roles_self_insert` policy (rechaza si el usuario
--     ya tiene rol previo).
--   - Trigger `audit_user_roles_change` que registra cualquier INSERT/UPDATE/
--     DELETE en `user_roles` dentro de `audit_logs`.
--
-- Esta migración añade la regla de alerting que el cron `evaluate-alerts`
-- (mig 0029) consume cada minuto. Cuando un usuario NO admin intenta operar
-- sobre `user_roles` de OTRO usuario, salta crítica.
--
-- La query del rule mide en los últimos 10 min cuántas filas de audit_logs
-- tienen action=*user_roles* + actor_role != admin + target_id != actor_user_id.
-- Si > 0 → alerta. En producción este número debería ser 0 SIEMPRE (RLS
-- bloquea estos intentos antes de que se ejecute el INSERT). Si llega un 1+,
-- significa que un actor con privilegios elevados (service role o admin
-- impostor) tocó user_roles ajeno.

INSERT INTO public.alerting_rules (
  code, name, description, query, threshold, comparator,
  window_seconds, severity, notify_channels, enabled
) VALUES (
  'unauthorized_role_escalation_attempt',
  'Intento no autorizado de escalada de rol',
  'Cualquier INSERT/UPDATE/DELETE en user_roles donde el actor no sea admin y el target no sea el propio actor. En producción debería ser 0 — si dispara, hay un bypass de RLS o un admin comprometido.',
  $sql$
    SELECT COUNT(*)
    FROM public.audit_logs
    WHERE target_kind = 'user_roles'
      AND action LIKE '%_user_roles'
      AND actor_role IS DISTINCT FROM 'admin'
      AND COALESCE(after->>'user_id', before->>'user_id') IS DISTINCT FROM actor_user_id::text
      AND created_at > now() - interval '10 minutes'
  $sql$,
  0,
  'gt',
  60,
  'critical',
  '["email","slack","sms"]'::jsonb,
  TRUE
)
ON CONFLICT (code) DO UPDATE SET
  name             = EXCLUDED.name,
  description      = EXCLUDED.description,
  query            = EXCLUDED.query,
  threshold        = EXCLUDED.threshold,
  comparator       = EXCLUDED.comparator,
  window_seconds   = EXCLUDED.window_seconds,
  severity         = EXCLUDED.severity,
  notify_channels  = EXCLUDED.notify_channels,
  enabled          = EXCLUDED.enabled,
  updated_at       = now();
