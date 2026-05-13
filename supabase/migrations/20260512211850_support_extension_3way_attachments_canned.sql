-- Pasify · 0017 support extension: kind tri-direccional + attachments + canned_replies

CREATE TYPE public.support_kind_t AS ENUM ('client_admin','partner_admin','client_partner');

ALTER TABLE public.support_conversations
  ADD COLUMN IF NOT EXISTS kind public.support_kind_t NOT NULL DEFAULT 'client_admin',
  ADD COLUMN IF NOT EXISTS partner_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_admin_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subject TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','snoozed','closed'));

-- Drop unique constraint legacy en client_id (puede tener varias conversaciones por kind)
ALTER TABLE public.support_conversations DROP CONSTRAINT IF EXISTS support_conversations_client_id_key;

CREATE INDEX IF NOT EXISTS idx_support_conv_kind ON public.support_conversations(kind);
CREATE INDEX IF NOT EXISTS idx_support_conv_partner ON public.support_conversations(partner_id) WHERE partner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_support_conv_event ON public.support_conversations(event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_support_conv_assigned ON public.support_conversations(assigned_admin_id) WHERE assigned_admin_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_support_conv_status ON public.support_conversations(status);

-- Refrescar policies con nuevos kinds
DROP POLICY IF EXISTS "support_conv_client_read_own" ON public.support_conversations;
DROP POLICY IF EXISTS "support_conv_client_insert_own" ON public.support_conversations;

CREATE POLICY "support_conv_client_read" ON public.support_conversations FOR SELECT TO authenticated
  USING (client_id = auth.uid() OR (kind IN ('partner_admin','client_partner') AND partner_id = auth.uid()));

CREATE POLICY "support_conv_client_insert" ON public.support_conversations FOR INSERT TO authenticated
  WITH CHECK (
    (kind = 'client_admin' AND client_id = auth.uid())
    OR (kind = 'partner_admin' AND partner_id = auth.uid())
    OR (kind = 'client_partner' AND client_id = auth.uid())
  );

CREATE POLICY "support_conv_partner_read" ON public.support_conversations FOR SELECT TO authenticated
  USING (kind = 'client_partner' AND org_id IS NOT NULL AND public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]));

-- support_sender_t: añadir 'partner' (ya hay client/admin)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel='partner' AND enumtypid='public.support_sender_t'::regtype) THEN
    ALTER TYPE public.support_sender_t ADD VALUE 'partner';
  END IF;
END $$;

-- support_attachments
CREATE TABLE IF NOT EXISTS public.support_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.support_messages(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  size_bytes BIGINT,
  virus_scanned BOOLEAN NOT NULL DEFAULT FALSE,
  virus_scan_result TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_support_attachments_message ON public.support_attachments(message_id);

ALTER TABLE public.support_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "support_attachments_read_conv_participant" ON public.support_attachments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.support_messages m JOIN public.support_conversations c ON c.id = m.conversation_id WHERE m.id = support_attachments.message_id AND (c.client_id = auth.uid() OR c.partner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))));

CREATE POLICY "support_attachments_admin_all" ON public.support_attachments FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- support_canned_replies
CREATE TABLE IF NOT EXISTS public.support_canned_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_role TEXT NOT NULL CHECK (owner_role IN ('admin','partner','client')),
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_canned_replies_owner ON public.support_canned_replies(owner_role, sort_order);
CREATE INDEX IF NOT EXISTS idx_canned_replies_org ON public.support_canned_replies(org_id) WHERE org_id IS NOT NULL;

ALTER TABLE public.support_canned_replies ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_canned_replies_updated_at BEFORE UPDATE ON public.support_canned_replies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "canned_replies_global_admin_read" ON public.support_canned_replies FOR SELECT TO authenticated
  USING (owner_role = 'admin' AND org_id IS NULL AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "canned_replies_global_client_read" ON public.support_canned_replies FOR SELECT TO authenticated
  USING (owner_role = 'client' AND org_id IS NULL);

CREATE POLICY "canned_replies_partner_read" ON public.support_canned_replies FOR SELECT TO authenticated
  USING (owner_role = 'partner' AND org_id IS NOT NULL AND public.is_member_of_org(org_id));

CREATE POLICY "canned_replies_admin_write" ON public.support_canned_replies FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "canned_replies_org_write" ON public.support_canned_replies FOR ALL TO authenticated
  USING (org_id IS NOT NULL AND public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]))
  WITH CHECK (org_id IS NOT NULL AND public.has_org_role(org_id, ARRAY['owner','admin','manager']::public.org_member_role_t[]));

-- RPC open_conversation
CREATE OR REPLACE FUNCTION public.open_conversation(_kind public.support_kind_t, _partner_id UUID DEFAULT NULL, _org_id UUID DEFAULT NULL, _event_id UUID DEFAULT NULL, _subject TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_conv_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF _kind = 'client_admin' THEN
    SELECT id INTO v_conv_id FROM public.support_conversations WHERE client_id = v_uid AND kind = 'client_admin' AND status = 'open' LIMIT 1;
    IF v_conv_id IS NULL THEN
      INSERT INTO public.support_conversations (client_id, kind, subject, status) VALUES (v_uid, 'client_admin', _subject, 'open') RETURNING id INTO v_conv_id;
    END IF;
  ELSIF _kind = 'partner_admin' THEN
    SELECT id INTO v_conv_id FROM public.support_conversations WHERE partner_id = v_uid AND kind = 'partner_admin' AND status = 'open' AND COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(_org_id, '00000000-0000-0000-0000-000000000000'::uuid) LIMIT 1;
    IF v_conv_id IS NULL THEN
      INSERT INTO public.support_conversations (client_id, kind, partner_id, org_id, subject, status) VALUES (v_uid, 'partner_admin', v_uid, _org_id, _subject, 'open') RETURNING id INTO v_conv_id;
    END IF;
  ELSE
    INSERT INTO public.support_conversations (client_id, kind, partner_id, org_id, event_id, subject, status) VALUES (v_uid, 'client_partner', _partner_id, _org_id, _event_id, _subject, 'open') RETURNING id INTO v_conv_id;
  END IF;

  RETURN v_conv_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.open_conversation(public.support_kind_t, UUID, UUID, UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.mark_conversation_read(_conversation_id UUID, _as_kind TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _as_kind = 'client' THEN
    UPDATE public.support_conversations SET unread_for_client = 0 WHERE id = _conversation_id AND client_id = v_uid;
  ELSIF _as_kind = 'admin' THEN
    UPDATE public.support_conversations SET unread_for_admin = 0 WHERE id = _conversation_id AND public.has_role(v_uid, 'admin');
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_admin_to_conversation(_conv_id UUID, _admin_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Admin only'; END IF;
  UPDATE public.support_conversations SET assigned_admin_id = _admin_id WHERE id = _conv_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.assign_admin_to_conversation(UUID, UUID) TO authenticated;
