-- ============================================================================
-- Pasify · 0004 support chat
-- Solo support: ogni cliente apre UNA conversazione con admin. Niente
-- chat user-to-user generale.
-- ============================================================================

CREATE TABLE public.support_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_message_at TIMESTAMPTZ,
  last_message_preview TEXT,
  unread_for_admin INTEGER NOT NULL DEFAULT 0,
  unread_for_client INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_support_conv_client ON public.support_conversations(client_id);
CREATE INDEX idx_support_conv_last_msg ON public.support_conversations(last_message_at DESC NULLS LAST);

ALTER TABLE public.support_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "support_conv_client_read_own"
  ON public.support_conversations FOR SELECT
  TO authenticated
  USING (client_id = auth.uid());

CREATE POLICY "support_conv_client_insert_own"
  ON public.support_conversations FOR INSERT
  TO authenticated
  WITH CHECK (client_id = auth.uid());

CREATE POLICY "support_conv_admin_all"
  ON public.support_conversations FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================================
-- support_messages
-- ============================================================================
CREATE TYPE public.support_sender_t AS ENUM ('client', 'admin');

CREATE TABLE public.support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.support_conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  sender_kind public.support_sender_t NOT NULL,
  body TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_support_msg_conv ON public.support_messages(conversation_id, created_at);

ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

-- Client legge/scrive solo la propria conversazione
CREATE POLICY "support_msg_client_read_own"
  ON public.support_messages FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.support_conversations c
      WHERE c.id = support_messages.conversation_id AND c.client_id = auth.uid()
    )
  );

CREATE POLICY "support_msg_client_insert_own"
  ON public.support_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_kind = 'client'
    AND sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.support_conversations c
      WHERE c.id = support_messages.conversation_id AND c.client_id = auth.uid()
    )
  );

-- Admin legge/scrive tutto
CREATE POLICY "support_msg_admin_all"
  ON public.support_messages FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============================================================================
-- Trigger: aggiorna last_message_* su nuovo message
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_support_conv_on_message()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.support_conversations
  SET last_message_at = NEW.created_at,
      last_message_preview = LEFT(NEW.body, 120),
      unread_for_admin = CASE WHEN NEW.sender_kind = 'client' THEN unread_for_admin + 1 ELSE unread_for_admin END,
      unread_for_client = CASE WHEN NEW.sender_kind = 'admin' THEN unread_for_client + 1 ELSE unread_for_client END
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_support_msg_update_conv
  AFTER INSERT ON public.support_messages
  FOR EACH ROW EXECUTE FUNCTION public.update_support_conv_on_message();

-- ============================================================================
-- Realtime
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'support_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.support_messages;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'support_conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.support_conversations;
  END IF;
END $$;
