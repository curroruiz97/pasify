-- Pasify · 0037 events: festival multi-day support + metadata jsonb
--
-- Añade soporte para festivales multi-día como evento padre + sub-eventos
-- (un row por día) sin romper el modelo de evento individual existente:
--   - is_festival: si true es el "evento padre" del festival
--   - festival_parent_id: si se setea, el evento es un día concreto del
--     festival apuntado. NULL para eventos normales.
--   - metadata: jsonb libre para flags futuros, tags, headliner por día,
--     pase completo, etc. Evita más migraciones.
--
-- El partner dashboard renderiza estos campos en EventRowCard sólo cuando
-- aplica (badge "Festival multi-día" si is_festival=true). El checkout +
-- ticket_tiers + scan flow no cambian — un día del festival se compra y
-- valida como cualquier otro evento.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS is_festival BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS festival_parent_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_events_festival_parent
  ON public.events(festival_parent_id)
  WHERE festival_parent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_events_is_festival
  ON public.events(is_festival)
  WHERE is_festival = TRUE;
