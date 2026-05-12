-- ============================================================================
-- Pasify · 0002 dominio: cities, events, tickets
-- ============================================================================

-- ============================================================================
-- cities — citta supportate. Per ora solo Spagna.
-- ============================================================================
CREATE TABLE public.cities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'ES',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (country, slug)
);

ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cities_public_read"
  ON public.cities FOR SELECT
  TO anon, authenticated
  USING (active = TRUE);

-- Seed iniziale citta Spagna
INSERT INTO public.cities (name, slug, country) VALUES
  ('Madrid', 'madrid', 'ES'),
  ('Barcelona', 'barcelona', 'ES'),
  ('Valencia', 'valencia', 'ES'),
  ('Sevilla', 'sevilla', 'ES'),
  ('Bilbao', 'bilbao', 'ES'),
  ('Málaga', 'malaga', 'ES'),
  ('Zaragoza', 'zaragoza', 'ES'),
  ('Granada', 'granada', 'ES'),
  ('Ibiza', 'ibiza', 'ES'),
  ('Palma de Mallorca', 'palma', 'ES'),
  ('Valladolid', 'valladolid', 'ES')
ON CONFLICT (country, slug) DO NOTHING;

-- ============================================================================
-- events — eventi creati dai locali (partner)
-- ============================================================================
CREATE TYPE public.event_status_t AS ENUM ('draft', 'published', 'cancelled', 'past');

CREATE TABLE public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,

  title TEXT NOT NULL,
  description TEXT,
  date_start TIMESTAMPTZ NOT NULL,
  date_end TIMESTAMPTZ,

  city TEXT NOT NULL,
  venue_name TEXT, -- nome locale visibile pubblicamente (override del business_name se serve)
  address TEXT,

  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'EUR',
  capacity INTEGER CHECK (capacity IS NULL OR capacity > 0),
  tickets_sold INTEGER NOT NULL DEFAULT 0,

  image_url TEXT,
  category TEXT, -- discoteca, festival, concierto, fiesta, ecc.

  status public.event_status_t NOT NULL DEFAULT 'draft',

  -- Stripe Connect: l'evento usa l'account del partner
  stripe_price_id TEXT, -- per checkout (lazy-created al primo acquisto)

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_events_partner ON public.events(partner_id);
CREATE INDEX idx_events_city_date ON public.events(city, date_start);
CREATE INDEX idx_events_status_date ON public.events(status, date_start);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

-- Lettura pubblica eventi published o past
CREATE POLICY "events_public_read"
  ON public.events FOR SELECT
  TO anon, authenticated
  USING (status IN ('published', 'past'));

-- Partner vede i propri eventi (anche draft)
CREATE POLICY "events_partner_read_own"
  ON public.events FOR SELECT
  TO authenticated
  USING (partner_id = auth.uid());

-- Partner crea/modifica solo i propri eventi
CREATE POLICY "events_partner_insert_own"
  ON public.events FOR INSERT
  TO authenticated
  WITH CHECK (partner_id = auth.uid());

CREATE POLICY "events_partner_update_own"
  ON public.events FOR UPDATE
  TO authenticated
  USING (partner_id = auth.uid())
  WITH CHECK (partner_id = auth.uid());

CREATE POLICY "events_partner_delete_own"
  ON public.events FOR DELETE
  TO authenticated
  USING (partner_id = auth.uid());

CREATE TRIGGER trg_events_updated_at
  BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================================
-- tickets — biglietti acquistati. Ogni ticket ha un QR univoco scansionabile.
-- ============================================================================
CREATE TYPE public.ticket_status_t AS ENUM ('pending', 'paid', 'used', 'refunded', 'cancelled');

CREATE TABLE public.tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE RESTRICT,

  -- Buyer: puo' essere registrato (buyer_user_id) o guest (solo email)
  buyer_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  buyer_email TEXT NOT NULL,
  buyer_first_name TEXT,
  buyer_last_name TEXT,
  buyer_phone TEXT,

  qr_token UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE, -- contenuto del QR

  status public.ticket_status_t NOT NULL DEFAULT 'pending',
  amount_paid_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',

  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT,

  used_at TIMESTAMPTZ, -- null finche' non scansionato in puerta
  used_by_partner_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ
);

CREATE INDEX idx_tickets_event ON public.tickets(event_id);
CREATE INDEX idx_tickets_buyer_user ON public.tickets(buyer_user_id) WHERE buyer_user_id IS NOT NULL;
CREATE INDEX idx_tickets_buyer_email ON public.tickets(buyer_email);
CREATE INDEX idx_tickets_qr_token ON public.tickets(qr_token);
CREATE INDEX idx_tickets_status ON public.tickets(status);

ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;

-- Buyer registrato vede i propri ticket
CREATE POLICY "tickets_buyer_read_own"
  ON public.tickets FOR SELECT
  TO authenticated
  USING (buyer_user_id = auth.uid());

-- Partner vede i ticket dei propri eventi
CREATE POLICY "tickets_partner_read_own_events"
  ON public.tickets FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = tickets.event_id AND e.partner_id = auth.uid()
    )
  );

-- Partner aggiorna i ticket solo per marcarli come 'used' (scansione)
CREATE POLICY "tickets_partner_mark_used"
  ON public.tickets FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = tickets.event_id AND e.partner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = tickets.event_id AND e.partner_id = auth.uid()
    )
  );

-- INSERT solo via service role (edge function checkout) — niente policy per authenticated
