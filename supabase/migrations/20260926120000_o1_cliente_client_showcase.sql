-- Pasify · app del cliente, ola 1: pantallas de demostración solo en modo demo
--
-- D-7 del dueño: las pantallas inventadas del cliente (En vivo, la home con
-- recomendaciones "de IA" y el Concierge) no se borran, pero solo las ve una
-- cuenta de demostración, en la web y con la franja "DEMO · datos ficticios".
--
-- Mismo mecanismo que `partner_showcase` (20260923120200_ticket_flow_v2.sql):
-- apagado para todos y una excepción por cuenta en tenant_overrides. Aquí la
-- clave es el id del USUARIO de demo (no una organización): el cliente
-- pregunta get_feature_flag('client_showcase', <su uid>).
--
--   Activar para una cuenta de demo (admin, desde SQL):
--     UPDATE public.feature_flags
--        SET tenant_overrides = tenant_overrides || jsonb_build_object('<uid>', true)
--      WHERE code = 'client_showcase';
--
-- Nunca se enciende con `enabled` ni `rollout_pct`: eso lo vería todo el mundo.

INSERT INTO public.feature_flags (code, name, description, enabled, rollout_pct, tenant_overrides)
SELECT 'client_showcase',
       'Pantallas demo de la app del cliente',
       'Enseña En vivo, la home con recomendaciones y el Concierge (con la franja DEMO) solo a los usuarios listados en tenant_overrides ({"<user_id>": true}). Nunca en la app nativa.',
       FALSE,
       0,
       '{}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM public.feature_flags WHERE code = 'client_showcase');
