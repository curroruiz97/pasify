-- Pasify · Ola 3, cuentas: de cliente a local (B3-01 / B4-07) y alta con
-- confirmación de email (B3-16, D-4)
--
-- 1) Datos del alta en el perfil, desde el servidor.
--    Con «Confirm email» activado, signUp no abre sesión: el formulario no
--    puede guardar el perfil (RLS) hasta que el usuario confirma y entra, y lo
--    que había escrito se perdía. Ahora viaja en los metadatos del alta
--    (options.data, como initial_role) y un trigger lo copia al perfil al
--    crearse el usuario, con o sin confirmación. Solo campos que el propio
--    usuario puede editar (nombre, teléfono, país, ciudad y los del negocio),
--    limpios y recortados. Si algo falla no se corta el alta.
--
-- 2) complete_partner_signup(): la organización y el plan del local.
--    Lo que RegisterPartner hacía desde el navegador con la sesión recién
--    abierta (create_organization con el nombre del negocio, datos de contacto
--    de la organización y del local, plan gratuito) pasa al servidor, de una
--    vez y sin duplicar: si ya tiene organización solo asegura el plan. La
--    llaman el alta (si hay sesión) y PartnerGate al entrar al panel (tras
--    confirmar el email), en lugar de claim_partner_free_plan, que nombraba la
--    organización con el email.
--
-- 3) De cliente a local. Quien entra con Apple o Google nace cliente
--    (handle_new_user_initial_role) y no tenía forma de pasar a local:
--    claim_initial_role rechaza si ya hay rol. convert_new_client_to_partner()
--    lo hace para uno mismo si la cuenta tiene menos de 30 días, su único rol
--    es client, no está desactivada y no tiene pedidos ni entradas (perdería
--    su cartera: el panel de local no la enseña). Cambia el rol y deja la
--    organización y el plan como el alta de local. partner_conversion_status()
--    dice a Ajustes si ofrecerlo.

-- ============================================================================
-- 1) Datos del alta en el perfil
-- ============================================================================
-- Texto de los metadatos del alta: sin caracteres de control, sin espacios en
-- los extremos, recortado a _max y NULL si queda vacío.
CREATE OR REPLACE FUNCTION public.signup_meta_text(_value TEXT, _max INT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT NULLIF(left(btrim(regexp_replace(COALESCE(_value, ''), '[[:cntrl:]]', '', 'g')), _max), '');
$$;

-- Código de país de dos letras ("ES") o NULL.
CREATE OR REPLACE FUNCTION public.signup_meta_country(_value TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE SET search_path = public
AS $$
  SELECT CASE WHEN upper(btrim(COALESCE(_value, ''))) ~ '^[A-Z]{2}$' THEN upper(btrim(_value)) END;
$$;

REVOKE ALL ON FUNCTION public.signup_meta_text(TEXT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.signup_meta_country(TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user_signup_data()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  m JSONB := NEW.raw_user_meta_data;
BEGIN
  IF m IS NULL OR jsonb_typeof(m) <> 'object' THEN
    RETURN NEW;
  END IF;
  BEGIN
    -- El perfil acaba de nacer (on_auth_user_created) solo con su email y los
    -- valores por defecto (country = 'ES'): manda lo que venga del alta.
    UPDATE public.profiles p SET
      first_name        = COALESCE(public.signup_meta_text(m->>'first_name', 80),         p.first_name),
      last_name         = COALESCE(public.signup_meta_text(m->>'last_name', 120),         p.last_name),
      phone             = COALESCE(public.signup_meta_text(m->>'phone', 32),              p.phone),
      country           = COALESCE(public.signup_meta_country(m->>'country'),             p.country),
      city              = COALESCE(public.signup_meta_text(m->>'city', 80),               p.city),
      business_name     = COALESCE(public.signup_meta_text(m->>'business_name', 120),     p.business_name),
      business_category = COALESCE(public.signup_meta_text(m->>'business_category', 40),  p.business_category),
      business_address  = COALESCE(public.signup_meta_text(m->>'business_address', 200),  p.business_address),
      business_country  = COALESCE(public.signup_meta_country(m->>'business_country'),    p.business_country),
      business_city     = COALESCE(public.signup_meta_text(m->>'business_city', 80),      p.business_city),
      business_phone    = COALESCE(public.signup_meta_text(m->>'business_phone', 32),     p.business_phone)
    WHERE p.id = NEW.id;
  EXCEPTION WHEN OTHERS THEN
    -- Nunca se corta un alta por esto: el usuario puede completar su perfil.
    RAISE WARNING 'handle_new_user_signup_data(%): %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user_signup_data() FROM PUBLIC, anon, authenticated;

-- Después de on_auth_user_created (crea el perfil): los triggers del mismo
-- momento se disparan por orden alfabético.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'zz_on_auth_user_created_signup_data' AND tgrelid = 'auth.users'::regclass
  ) THEN
    CREATE TRIGGER zz_on_auth_user_created_signup_data
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_signup_data();
  END IF;
END $$;

-- ============================================================================
-- 2) Organización y plan del local
-- ============================================================================
CREATE OR REPLACE FUNCTION public.complete_partner_signup()
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_org     UUID;
  v_profile public.profiles%ROWTYPE;
  v_email   TEXT;
  v_name    TEXT;
  v_country TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF NOT public.has_role(v_uid, 'partner'::public.app_role) THEN
    RAISE EXCEPTION 'Solo las cuentas de local tienen organización' USING ERRCODE = '42501';
  END IF;

  -- El alta y PartnerGate pueden llegar a la vez: una sola organización.
  PERFORM pg_advisory_xact_lock(hashtextextended('complete_partner_signup:' || v_uid::text, 0));

  -- La que ya tenga, igual que claim_partner_free_plan: dueño, o owner/admin activo.
  SELECT o.id INTO v_org
    FROM public.organizations o
   WHERE o.owner_id = v_uid
   ORDER BY o.created_at ASC LIMIT 1;
  IF v_org IS NULL THEN
    SELECT m.org_id INTO v_org
      FROM public.organization_members m
     WHERE m.user_id = v_uid AND m.status = 'active' AND m.role IN ('owner', 'admin')
     ORDER BY m.created_at ASC LIMIT 1;
  END IF;

  IF v_org IS NULL THEN
    SELECT * INTO v_profile FROM public.profiles WHERE id = v_uid;
    SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid;
    v_name := COALESCE(
      public.signup_meta_text(v_profile.business_name, 120),
      public.signup_meta_text(split_part(COALESCE(v_email, ''), '@', 1), 120),
      'Mi local'
    );
    v_country := COALESCE(
      public.signup_meta_country(v_profile.business_country),
      public.signup_meta_country(v_profile.country),
      'ES'
    );

    -- Crea organización, marca y el local 'Principal' (en la ciudad del negocio).
    v_org := public.create_organization(v_name, v_country, NULL);

    UPDATE public.organizations o SET
      billing_email = COALESCE(o.billing_email, v_email),
      contact_email = COALESCE(o.contact_email, v_email),
      contact_phone = COALESCE(o.contact_phone, public.signup_meta_text(v_profile.business_phone, 32)),
      city          = COALESCE(o.city, public.signup_meta_text(v_profile.business_city, 80)),
      address       = COALESCE(o.address, public.signup_meta_text(v_profile.business_address, 200))
    WHERE o.id = v_org;

    UPDATE public.venues v SET
      business_category = COALESCE(v.business_category, public.signup_meta_text(v_profile.business_category, 40)),
      address           = COALESCE(v.address, public.signup_meta_text(v_profile.business_address, 200)),
      phone             = COALESCE(v.phone, public.signup_meta_text(v_profile.business_phone, 32)),
      email             = COALESCE(v.email, v_email)
    WHERE v.org_id = v_org;
  END IF;

  -- Plan gratuito (idempotente; la organización nueva ya nace con él).
  PERFORM public.claim_partner_free_plan();
  RETURN v_org;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_partner_signup() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_partner_signup() TO authenticated, service_role;

COMMENT ON FUNCTION public.complete_partner_signup() IS
  'Alta del local (quien llama, rol partner): si no tiene organización la crea con los datos del negocio de su perfil (o con su email) y asegura el plan gratuito. Idempotente. Devuelve la organización.';

-- ============================================================================
-- 3) De cliente a local
-- ============================================================================
-- Por qué no puede pasar a local (NULL = puede). Sin EXECUTE para el cliente:
-- solo la usan las dos funciones de abajo, siempre con auth.uid().
CREATE OR REPLACE FUNCTION public.partner_conversion_blocker(_uid UUID)
RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_created TIMESTAMPTZ;
  v_roles   TEXT[];
BEGIN
  SELECT u.created_at INTO v_created FROM auth.users u WHERE u.id = _uid;
  IF v_created IS NULL THEN
    RETURN 'not_authenticated';
  END IF;

  SELECT COALESCE(array_agg(ur.role::text ORDER BY ur.role::text), ARRAY[]::TEXT[])
    INTO v_roles
    FROM public.user_roles ur
   WHERE ur.user_id = _uid;
  IF v_roles <> ARRAY['client']::TEXT[] THEN
    RETURN 'not_client';
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _uid AND p.account_status = 'rejected') THEN
    RETURN 'account_disabled';
  END IF;

  IF v_created < now() - INTERVAL '30 days' THEN
    RETURN 'account_too_old';
  END IF;

  -- Pedidos (también uno a medio pagar) o entradas, compradas o recibidas.
  IF EXISTS (
       SELECT 1 FROM public.ticket_orders o
        WHERE o.buyer_user_id = _uid
          AND (o.paid_at IS NOT NULL OR o.status NOT IN ('failed', 'expired'))
     )
     OR EXISTS (
       SELECT 1 FROM public.tickets t
        WHERE (t.buyer_user_id = _uid OR t.transferred_to_user_id = _uid)
          AND t.status <> 'cancelled'
     ) THEN
    RETURN 'has_purchases';
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.partner_conversion_blocker(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.partner_conversion_status()
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_reason TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('eligible', FALSE, 'reason', 'not_authenticated');
  END IF;
  v_reason := public.partner_conversion_blocker(v_uid);
  RETURN jsonb_build_object('eligible', v_reason IS NULL, 'reason', v_reason);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.partner_conversion_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_conversion_status() TO authenticated;

COMMENT ON FUNCTION public.partner_conversion_status() IS
  '¿Puede quien llama pasar su cuenta de cliente a local? {eligible, reason}: reason es not_client, account_disabled, account_too_old o has_purchases.';

CREATE OR REPLACE FUNCTION public.convert_new_client_to_partner(_business_name TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_reason TEXT;
  v_name   TEXT := public.signup_meta_text(_business_name, 120);
  v_org    UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  -- Dos toques a la vez: el segundo espera y ya no es cliente.
  PERFORM 1 FROM public.user_roles WHERE user_id = v_uid FOR UPDATE;

  v_reason := public.partner_conversion_blocker(v_uid);
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'partner_conversion_not_allowed',
      DETAIL  = v_reason,
      ERRCODE = '42501';
  END IF;

  UPDATE public.user_roles SET role = 'partner'::public.app_role
   WHERE user_id = v_uid AND role = 'client'::public.app_role;

  -- Nombre del negocio (si lo da) y país y ciudad del cliente para su local.
  UPDATE public.profiles p SET
    business_name    = COALESCE(v_name, p.business_name),
    business_country = COALESCE(public.signup_meta_country(p.business_country), public.signup_meta_country(p.country), 'ES'),
    business_city    = COALESCE(public.signup_meta_text(p.business_city, 80), public.signup_meta_text(p.city, 80))
  WHERE p.id = v_uid;

  v_org := public.complete_partner_signup();
  RETURN jsonb_build_object('role', 'partner', 'org_id', v_org);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.convert_new_client_to_partner(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.convert_new_client_to_partner(TEXT) TO authenticated;

COMMENT ON FUNCTION public.convert_new_client_to_partner(TEXT) IS
  'Pasa la cuenta de quien llama de cliente a local si partner_conversion_status lo permite: rol partner, organización (con _business_name si llega) y plan gratuito, como el alta de local. Si no, 42501 partner_conversion_not_allowed con el motivo en DETAIL.';
