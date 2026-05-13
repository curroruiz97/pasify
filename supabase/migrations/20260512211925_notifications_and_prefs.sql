-- Pasify · 0018 notifications + user_notification_prefs

CREATE TYPE public.notification_channel_t AS ENUM ('push','email','sms','in_app');
CREATE TYPE public.notification_status_t  AS ENUM ('pending','sent','failed','skipped','delivered','read');

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  icon TEXT,
  link TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','critical')),
  read_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications(user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_user_all ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_category ON public.notifications(category);
CREATE INDEX IF NOT EXISTS idx_notifications_kind ON public.notifications(kind);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifications_self_read" ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "notifications_self_update" ON public.notifications FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "notifications_admin_all" ON public.notifications FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.user_notification_prefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  channel public.notification_channel_t NOT NULL,
  category TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  timezone TEXT NOT NULL DEFAULT 'Europe/Madrid',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, channel, category)
);

CREATE INDEX IF NOT EXISTS idx_user_notification_prefs_user ON public.user_notification_prefs(user_id);

ALTER TABLE public.user_notification_prefs ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER trg_user_notification_prefs_updated_at BEFORE UPDATE ON public.user_notification_prefs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "user_notification_prefs_self_all" ON public.user_notification_prefs FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "user_notification_prefs_admin_all" ON public.user_notification_prefs FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.notification_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
  channel public.notification_channel_t NOT NULL,
  status public.notification_status_t NOT NULL DEFAULT 'pending',
  provider TEXT,
  provider_message_id TEXT,
  error_message TEXT,
  attempt_count INT NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  dispatched_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_dispatches_notification ON public.notification_dispatches(notification_id);
CREATE INDEX IF NOT EXISTS idx_notification_dispatches_status ON public.notification_dispatches(status);

ALTER TABLE public.notification_dispatches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notification_dispatches_admin_read" ON public.notification_dispatches FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.enqueue_notification(
  _user_id UUID, _category TEXT, _kind TEXT, _title TEXT, _body TEXT DEFAULT NULL, _link TEXT DEFAULT NULL, _payload JSONB DEFAULT '{}'::jsonb, _priority TEXT DEFAULT 'normal'
) RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_notification_id UUID;
BEGIN
  INSERT INTO public.notifications (user_id, category, kind, title, body, link, payload, priority)
  VALUES (_user_id, _category, _kind, _title, _body, _link, _payload, _priority)
  RETURNING id INTO v_notification_id;
  RETURN v_notification_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.enqueue_notification(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) TO authenticated;

-- Default prefs en signup: trigger on profile insert
CREATE OR REPLACE FUNCTION public.seed_default_notification_prefs()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_notification_prefs (user_id, channel, category, enabled, quiet_hours_start, quiet_hours_end) VALUES
    (NEW.id, 'push',  'events',      TRUE,  '23:00','09:00'),
    (NEW.id, 'push',  'tickets',     TRUE,  NULL, NULL),
    (NEW.id, 'push',  'promos',      TRUE,  '23:00','09:00'),
    (NEW.id, 'push',  'loyalty',     TRUE,  NULL, NULL),
    (NEW.id, 'push',  'security',    TRUE,  NULL, NULL),
    (NEW.id, 'email', 'events',      TRUE,  NULL, NULL),
    (NEW.id, 'email', 'tickets',     TRUE,  NULL, NULL),
    (NEW.id, 'email', 'promos',      TRUE,  NULL, NULL),
    (NEW.id, 'email', 'loyalty',     FALSE, NULL, NULL),
    (NEW.id, 'email', 'security',    TRUE,  NULL, NULL),
    (NEW.id, 'email', 'newsletter',  FALSE, NULL, NULL),
    (NEW.id, 'sms',   'security',    FALSE, NULL, NULL),
    (NEW.id, 'sms',   'critical',    TRUE,  NULL, NULL),
    (NEW.id, 'in_app','events',      TRUE,  NULL, NULL),
    (NEW.id, 'in_app','tickets',     TRUE,  NULL, NULL),
    (NEW.id, 'in_app','support',     TRUE,  NULL, NULL),
    (NEW.id, 'in_app','system',      TRUE,  NULL, NULL)
  ON CONFLICT (user_id, channel, category) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_notification_prefs ON public.profiles;
CREATE TRIGGER trg_seed_notification_prefs AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.seed_default_notification_prefs();
