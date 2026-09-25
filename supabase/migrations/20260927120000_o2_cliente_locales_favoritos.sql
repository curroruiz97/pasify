-- Pasify · app del cliente, ola 2: locales favoritos que se guardan (B2-03)
--
-- El corazón de los locales guardaba el id del PERFIL del local (el de la
-- vista public_partners y de /p/:id) en partner_favorites.org_id, que es una
-- FK a organizations: todos los INSERT fallaban con 23503, el error se
-- ignoraba y el corazón no cambiaba. En la Ola 1 se ocultó.
--
-- Ahora el favorito apunta al local tal como lo conoce el cliente:
-- partner_id → profiles(id), el mismo id que public_partners. Es lo más
-- simple y lo coherente con esa vista: no hay que resolver la organización
-- (un dueño puede tener varias y la ficha pública no la usa).
--
--   - org_id deja de ser obligatoria: ya no la escribe nadie. Las filas
--     antiguas se traducen a su local (el dueño de la organización); las que
--     no se puedan traducir se quedan donde están (no se ven en ninguna
--     parte) y la restricción NOT VALID exige partner_id solo a las nuevas.
--   - Sin duplicados: UNIQUE (user_id, partner_id). La app guarda con un
--     upsert que ignora duplicados, así que un doble toque no falla.
--   - RLS solo para el propio usuario: leer, guardar y quitar los suyos. Sale
--     la política de admin (nada la usa). Guardar exige que el local esté en
--     public_partners (aprobado y con nombre): no se guardan perfiles
--     cualesquiera ni se puede sondear si un id existe.
--   - Sin UPDATE: un favorito se guarda o se quita.

-- ============================================================================
-- 1) El local del favorito
-- ============================================================================
ALTER TABLE public.partner_favorites
  ADD COLUMN IF NOT EXISTS partner_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.partner_favorites ALTER COLUMN org_id DROP NOT NULL;

COMMENT ON COLUMN public.partner_favorites.partner_id IS
  'Local guardado: id del perfil del local, el mismo de la vista public_partners y de /p/:id.';
COMMENT ON COLUMN public.partner_favorites.org_id IS
  'Legado (antes de la Ola 2): ya no se escribe. El favorito es partner_id.';

-- Filas antiguas: de la organización a su dueño, una por usuario y local.
UPDATE public.partner_favorites f
   SET partner_id = x.owner_id
  FROM (
    SELECT DISTINCT ON (pf.user_id, o.owner_id) pf.id, o.owner_id
      FROM public.partner_favorites pf
      JOIN public.organizations o ON o.id = pf.org_id
      JOIN public.profiles p ON p.id = o.owner_id
     WHERE pf.partner_id IS NULL
     ORDER BY pf.user_id, o.owner_id, pf.created_at, pf.id
  ) x
 WHERE f.id = x.id;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.partner_favorites'::regclass
                    AND conname = 'partner_favorites_user_partner_key') THEN
    ALTER TABLE public.partner_favorites
      ADD CONSTRAINT partner_favorites_user_partner_key UNIQUE (user_id, partner_id);
  END IF;
  -- NOT VALID: obliga en cada fila nueva sin revisar (ni borrar) las antiguas.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.partner_favorites'::regclass
                    AND conname = 'partner_favorites_partner_required') THEN
    ALTER TABLE public.partner_favorites
      ADD CONSTRAINT partner_favorites_partner_required CHECK (partner_id IS NOT NULL) NOT VALID;
  END IF;
END $$;

-- Para el ON DELETE CASCADE cuando se borra la cuenta de un local.
CREATE INDEX IF NOT EXISTS idx_partner_favorites_partner ON public.partner_favorites(partner_id);

-- ============================================================================
-- 2) RLS: cada usuario, los suyos
-- ============================================================================
DROP POLICY IF EXISTS "partner_favorites_self_all" ON public.partner_favorites;
DROP POLICY IF EXISTS "partner_favorites_admin_all" ON public.partner_favorites;
DROP POLICY IF EXISTS "partner_favorites_self_read" ON public.partner_favorites;
DROP POLICY IF EXISTS "partner_favorites_self_insert" ON public.partner_favorites;
DROP POLICY IF EXISTS "partner_favorites_self_delete" ON public.partner_favorites;

CREATE POLICY "partner_favorites_self_read" ON public.partner_favorites
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "partner_favorites_self_insert" ON public.partner_favorites
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (SELECT 1 FROM public.public_partners pp WHERE pp.id = partner_favorites.partner_id)
  );

CREATE POLICY "partner_favorites_self_delete" ON public.partner_favorites
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));
