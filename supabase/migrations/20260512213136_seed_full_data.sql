-- Pasify · 0029 seed completo: ciudades ES (75+), planes, marketplace_apps, music_genres, business/event categories, app_settings, FAQ, errors_i18n

-- ============================================================================
-- CITIES: 75+ ciudades España (50 capitales provincia + destinos turísticos nightlife + autonomas/europeas top)
-- ============================================================================
INSERT INTO public.cities (name, slug, country, active) VALUES
  -- Andalucía
  ('Almería',                  'almeria',           'ES', TRUE),
  ('Cádiz',                    'cadiz',             'ES', TRUE),
  ('Córdoba',                  'cordoba',           'ES', TRUE),
  ('Granada',                  'granada',           'ES', TRUE),
  ('Huelva',                   'huelva',            'ES', TRUE),
  ('Jaén',                     'jaen',              'ES', TRUE),
  ('Málaga',                   'malaga',            'ES', TRUE),
  ('Sevilla',                  'sevilla',           'ES', TRUE),
  ('Marbella',                 'marbella',          'ES', TRUE),
  ('Tarifa',                   'tarifa',            'ES', TRUE),
  -- Aragón
  ('Huesca',                   'huesca',            'ES', TRUE),
  ('Teruel',                   'teruel',            'ES', TRUE),
  ('Zaragoza',                 'zaragoza',          'ES', TRUE),
  -- Asturias / Cantabria
  ('Oviedo',                   'oviedo',            'ES', TRUE),
  ('Gijón',                    'gijon',             'ES', TRUE),
  ('Santander',                'santander',         'ES', TRUE),
  -- Baleares
  ('Palma de Mallorca',        'palma',             'ES', TRUE),
  ('Ibiza',                    'ibiza',             'ES', TRUE),
  ('Magaluf',                  'magaluf',           'ES', TRUE),
  ('Mahón',                    'mahon',             'ES', TRUE),
  ('Formentera',               'formentera',        'ES', TRUE),
  -- Canarias
  ('Las Palmas de Gran Canaria','las-palmas',       'ES', TRUE),
  ('Santa Cruz de Tenerife',   'santa-cruz-tenerife','ES',TRUE),
  ('Playa de las Américas',    'playa-de-las-americas','ES',TRUE),
  ('Arrecife',                 'arrecife',          'ES', TRUE),
  ('Puerto del Rosario',       'puerto-del-rosario','ES', TRUE),
  ('Maspalomas',               'maspalomas',        'ES', TRUE),
  -- Castilla y León
  ('Ávila',                    'avila',             'ES', TRUE),
  ('Burgos',                   'burgos',            'ES', TRUE),
  ('León',                     'leon',              'ES', TRUE),
  ('Palencia',                 'palencia',          'ES', TRUE),
  ('Salamanca',                'salamanca',         'ES', TRUE),
  ('Segovia',                  'segovia',           'ES', TRUE),
  ('Soria',                    'soria',             'ES', TRUE),
  ('Valladolid',               'valladolid',        'ES', TRUE),
  ('Zamora',                   'zamora',            'ES', TRUE),
  -- Castilla-La Mancha
  ('Albacete',                 'albacete',          'ES', TRUE),
  ('Ciudad Real',              'ciudad-real',       'ES', TRUE),
  ('Cuenca',                   'cuenca',            'ES', TRUE),
  ('Guadalajara',              'guadalajara',       'ES', TRUE),
  ('Toledo',                   'toledo',            'ES', TRUE),
  -- Cataluña
  ('Barcelona',                'barcelona',         'ES', TRUE),
  ('Girona',                   'girona',            'ES', TRUE),
  ('Lleida',                   'lleida',            'ES', TRUE),
  ('Tarragona',                'tarragona',         'ES', TRUE),
  ('Sitges',                   'sitges',            'ES', TRUE),
  ('Lloret de Mar',            'lloret-de-mar',     'ES', TRUE),
  ('Salou',                    'salou',             'ES', TRUE),
  ('Tossa de Mar',             'tossa-de-mar',      'ES', TRUE),
  ('Castelldefels',            'castelldefels',     'ES', TRUE),
  -- Comunidad Valenciana
  ('Alicante',                 'alicante',          'ES', TRUE),
  ('Castellón',                'castellon',         'ES', TRUE),
  ('Valencia',                 'valencia',          'ES', TRUE),
  ('Benidorm',                 'benidorm',          'ES', TRUE),
  ('Gandía',                   'gandia',            'ES', TRUE),
  -- Extremadura
  ('Badajoz',                  'badajoz',           'ES', TRUE),
  ('Cáceres',                  'caceres',           'ES', TRUE),
  ('Mérida',                   'merida',            'ES', TRUE),
  -- Galicia
  ('A Coruña',                 'a-coruna',          'ES', TRUE),
  ('Lugo',                     'lugo',              'ES', TRUE),
  ('Ourense',                  'ourense',           'ES', TRUE),
  ('Pontevedra',               'pontevedra',        'ES', TRUE),
  ('Santiago de Compostela',   'santiago',          'ES', TRUE),
  ('Vigo',                     'vigo',              'ES', TRUE),
  -- La Rioja / Madrid / Murcia / Navarra
  ('Logroño',                  'logrono',           'ES', TRUE),
  ('Madrid',                   'madrid',            'ES', TRUE),
  ('Alcalá de Henares',        'alcala-de-henares', 'ES', TRUE),
  ('Móstoles',                 'mostoles',          'ES', TRUE),
  ('Murcia',                   'murcia',            'ES', TRUE),
  ('Cartagena',                'cartagena',         'ES', TRUE),
  ('Pamplona',                 'pamplona',          'ES', TRUE),
  -- País Vasco
  ('Bilbao',                   'bilbao',            'ES', TRUE),
  ('San Sebastián',            'san-sebastian',     'ES', TRUE),
  ('Vitoria-Gasteiz',          'vitoria',           'ES', TRUE),
  -- Ceuta, Melilla
  ('Ceuta',                    'ceuta',             'ES', TRUE),
  ('Melilla',                  'melilla',           'ES', TRUE)
ON CONFLICT (country, slug) DO NOTHING;

-- ============================================================================
-- SUBSCRIPTION PLANS
-- ============================================================================
INSERT INTO public.subscription_plans (code, name, tagline, monthly_price_cents, yearly_price_cents, max_venues, max_team_members, max_events_per_month, ai_capabilities_included, features, sort_order, trial_days) VALUES
  ('starter', 'Starter', 'Para locales que empiezan en Pasify', 4900, 49000,
    1, 5, 20, ARRAY['forecast']::TEXT[],
    '{"white_label": false, "custom_domain": false, "support_level": "email", "api_access": false}'::jsonb, 1, 14),
  ('business', 'Business', 'Para grupos en crecimiento', 14900, 149000,
    5, 20, 100, ARRAY['forecast','pricing','marketing']::TEXT[],
    '{"white_label": true, "custom_domain": false, "support_level": "priority", "api_access": true}'::jsonb, 2, 14),
  ('enterprise', 'Enterprise', 'Para grupos consolidados y festivales', 49900, 499000,
    NULL, NULL, NULL, ARRAY['forecast','pricing','marketing','autopilot','door_vision','concierge']::TEXT[],
    '{"white_label": true, "custom_domain": true, "support_level": "dedicated_csm", "sla": "99.95%", "api_access": true, "custom_integrations": true}'::jsonb, 3, 30)
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- APP SETTINGS defaults
-- ============================================================================
INSERT INTO public.app_settings (key, value, description) VALUES
  ('partner_trial_enabled',      'true'::jsonb,  'Nuevos partners reciben trial automático'),
  ('partner_trial_days',         '14'::jsonb,    'Duración trial gratuito'),
  ('maintenance_mode',           'false'::jsonb, 'Modo mantenimiento global'),
  ('signup_enabled',             'true'::jsonb,  'Permitir signups públicos'),
  ('application_fee_pct',        '5.0'::jsonb,   'Fee Pasify sobre tickets (%)'),
  ('refund_grace_period_hours',  '168'::jsonb,   'Horas antes evento para auto-aprobar refunds (7d)'),
  ('default_currency',           '"EUR"'::jsonb, 'Moneda por defecto'),
  ('default_country',            '"ES"'::jsonb,  'País por defecto'),
  ('platform_name',              '"Pasify"'::jsonb, 'Nombre plataforma'),
  ('support_email',              '"hola@pasify.es"'::jsonb, 'Email soporte público'),
  ('support_phone',              '"+34 900 000 042"'::jsonb, 'Teléfono soporte público'),
  ('ai_autopilot_default_band_pct', '15'::jsonb, 'Banda default pricing +/-%'),
  ('ai_autopilot_min_confidence', '0.78'::jsonb, 'Confianza mínima para auto-aprobar'),
  ('captcha_required',           'true'::jsonb,  'Captcha obligatorio en signup/login'),
  ('twofa_required_for_admin',   'true'::jsonb,  '2FA obligatorio para admins')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- FEATURE FLAGS
-- ============================================================================
INSERT INTO public.feature_flags (code, name, description, enabled, rollout_pct) VALUES
  ('ai_autopilot',          'AutoPilot IA',          'Agente IA autónomo (beta)',             FALSE, 0),
  ('ai_door_vision',        'Door Vision IA',        'Computer vision en puerta (beta)',      FALSE, 0),
  ('ai_concierge_replies',  'Concierge IA replies',  'Auto-respuestas IA en soporte',         TRUE,  100),
  ('marketplace_apps',      'App Marketplace',       'Integraciones OAuth con apps externas', TRUE,  100),
  ('whitelabel',            'White-label',           'Subdominios y custom domain partners',  TRUE,  50),
  ('industry_benchmarks',   'Industry Benchmarks',   'Inteligencia anónima cross-tenant',     TRUE,  100),
  ('cashless_nfc',          'Cashless NFC',          'Pulseras NFC en evento',                FALSE, 0),
  ('mobile_app',            'App móvil nativa',      'Capacitor Android+iOS',                 FALSE, 0),
  ('multi_currency',        'Multi-moneda',          'Soporte EUR/GBP/USD',                   FALSE, 0)
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- BUSINESS CATEGORIES
-- ============================================================================
INSERT INTO public.business_categories (code, label_es, label_en, icon, sort_order) VALUES
  ('discoteca',     'Discoteca',     'Nightclub',      'disc',         1),
  ('club',          'Club',          'Club',           'music',        2),
  ('bar',           'Bar',           'Bar',            'beer',         3),
  ('bar-musica',    'Bar musical',   'Music bar',      'mic',          4),
  ('sala',          'Sala',          'Music venue',    'building',     5),
  ('sala-concierto','Sala conciertos','Concert hall',  'music-note',   6),
  ('festival',      'Festival',      'Festival',       'party-popper', 7),
  ('rooftop',       'Rooftop',       'Rooftop',        'sun',          8),
  ('beachclub',     'Beach Club',    'Beach Club',     'waves',        9),
  ('chiringuito',   'Chiringuito',   'Beach bar',      'umbrella',    10),
  ('restaurante',   'Restaurante',   'Restaurant',     'utensils',    11),
  ('teatro',        'Teatro',        'Theatre',        'theater',     12),
  ('coworking',     'Coworking',     'Coworking',      'building-2',  13),
  ('otro',          'Otro',          'Other',          'more',        99)
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- EVENT CATEGORIES
-- ============================================================================
INSERT INTO public.event_categories (code, label_es, label_en, icon, sort_order) VALUES
  ('club_night',    'Noche de club',         'Club night',         'disc-3',       1),
  ('concierto',     'Concierto',             'Concert',            'mic-2',        2),
  ('festival',      'Festival',              'Festival',           'party-popper', 3),
  ('after',         'Afterparty',            'Afterparty',         'sunrise',      4),
  ('especial',      'Evento especial',       'Special event',      'sparkles',     5),
  ('residencia',    'Residencia DJ',         'DJ residency',       'headphones',   6),
  ('open_air',      'Open air',              'Open air',           'cloud-sun',    7),
  ('pool_party',    'Pool party',            'Pool party',         'waves',        8),
  ('boat_party',    'Boat party',            'Boat party',         'ship',         9),
  ('warehouse',     'Warehouse',             'Warehouse',          'warehouse',   10),
  ('private',       'Evento privado',        'Private',            'lock',        11),
  ('corporate',     'Corporate',             'Corporate',          'briefcase',   12)
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- MUSIC GENRES
-- ============================================================================
INSERT INTO public.music_genres (code, label_es, label_en, parent_code, color, sort_order) VALUES
  ('electronic',    'Electrónica',         'Electronic',     NULL, '#A78BFA', 1),
  ('techno',        'Techno',              'Techno',         'electronic', '#FF7A4D', 11),
  ('house',         'House',               'House',          'electronic', '#8B5CF6', 12),
  ('tech-house',    'Tech-House',          'Tech-House',     'electronic', '#7C3AED', 13),
  ('progressive',   'Progressive',         'Progressive',    'electronic', '#6D28D9', 14),
  ('trance',        'Trance',              'Trance',         'electronic', '#EC4899', 15),
  ('drum-bass',     'Drum & Bass',         'Drum & Bass',    'electronic', '#A78BFA', 16),
  ('hardstyle',     'Hardstyle',           'Hardstyle',      'electronic', '#DC2626', 17),
  ('minimal',       'Minimal',             'Minimal',        'electronic', '#71717A', 18),
  ('urban',         'Urbano',              'Urban',          NULL, '#EC4899', 2),
  ('reggaeton',     'Reggaetón',           'Reggaeton',      'urban', '#EC4899', 21),
  ('latin-urban',   'Latin Urban',         'Latin Urban',    'urban', '#F472B6', 22),
  ('hip-hop',       'Hip-Hop',             'Hip-Hop',        'urban', '#E8B04C', 23),
  ('trap',          'Trap',                'Trap',           'urban', '#FB923C', 24),
  ('rnb',           'R&B',                 'R&B',            'urban', '#FBBF24', 25),
  ('comercial',     'Comercial',           'Mainstream',     NULL, '#3B82F6', 3),
  ('top40',         'Top 40',              'Top 40',         'comercial', '#3B82F6', 31),
  ('eighties',      'Años 80',             '80s',            'comercial', '#6366F1', 32),
  ('nineties',      'Años 90',             '90s',            'comercial', '#6366F1', 33),
  ('2000s',         '2000s',               '2000s',          'comercial', '#6366F1', 34),
  ('rock',          'Rock',                'Rock',           NULL, '#DC2626', 4),
  ('indie',         'Indie',               'Indie',          'rock', '#4DB87A', 41),
  ('alternative',   'Alternativo',         'Alternative',    'rock', '#10B981', 42),
  ('metal',         'Metal',               'Metal',          'rock', '#7F1D1D', 43),
  ('punk',          'Punk',                'Punk',           'rock', '#991B1B', 44),
  ('latin',         'Latino',              'Latin',          NULL, '#F59E0B', 5),
  ('salsa',         'Salsa',               'Salsa',          'latin', '#F59E0B', 51),
  ('bachata',       'Bachata',             'Bachata',        'latin', '#F97316', 52),
  ('flamenco',      'Flamenco',            'Flamenco',       'latin', '#EF4444', 53),
  ('jazz-blues',    'Jazz / Blues',        'Jazz / Blues',   NULL, '#0EA5E9', 6),
  ('classical',     'Clásica',             'Classical',      NULL, '#64748B', 7),
  ('disco-funk',    'Disco / Funk',        'Disco / Funk',   NULL, '#E8B04C', 8),
  ('regional',      'Regional español',    'Spanish folk',   NULL, '#84CC16', 9)
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- MARKETPLACE APPS (30+ integraciones)
-- ============================================================================
INSERT INTO public.marketplace_apps (code, name, category, short_description, icon_slug, icon_color, oauth_provider, official, monthly_price_cents, popular, featured, status, sort_order) VALUES
  ('mailchimp',       'Mailchimp',           'marketing',    'Email + audiencias automáticas con segmentación CRM',          'M', '#FFE100', 'mailchimp',    TRUE,  NULL, FALSE, TRUE, 'available', 1),
  ('klaviyo',         'Klaviyo',             'marketing',    'Flows email + SMS avanzados con segmentación por LTV',         'K', '#000000', 'klaviyo',      TRUE,  NULL, TRUE,  FALSE, 'available', 2),
  ('hubspot',         'HubSpot CRM',         'marketing',    'CRM + scoring + deal pipeline sincronizado con Pasify',        'H', '#FF7A59', 'hubspot',      TRUE,  NULL, FALSE, FALSE, 'available', 3),
  ('brevo',           'Brevo',               'marketing',    'Email + SMS unificado, ideal newsletters fin de semana',       'B', '#0B996E', 'brevo',        TRUE,  NULL, FALSE, FALSE, 'available', 4),
  ('meta-ads',        'Meta Ads',            'marketing',    'Conversion API + lookalike de tus compradores reales',         'f', '#1877F2', 'meta',         TRUE,  NULL, TRUE,  TRUE,  'available', 5),
  ('tiktok-ads',      'TikTok Ads',          'marketing',    'Pixel + Events API para retargeting nocturno',                 'T', '#000000', 'tiktok',       TRUE,  NULL, TRUE,  FALSE, 'available', 6),
  ('google-ads',      'Google Ads',          'marketing',    'Conversiones con tus eventos reales',                          'G', '#4285F4', 'google',       TRUE,  NULL, FALSE, FALSE, 'available', 7),
  ('ga4',             'Google Analytics 4',  'analytics',    'Funnel de compra completo en GA4',                             'G', '#F9AB00', 'google',       TRUE,  NULL, FALSE, FALSE, 'available', 8),
  ('amplitude',       'Amplitude',           'analytics',    'Cohortes y funnels enterprise',                                'A', '#1F4DCA', 'amplitude',    FALSE, NULL, FALSE, FALSE, 'available', 9),
  ('mixpanel',        'Mixpanel',            'analytics',    'Analytics producto end-to-end',                                'M', '#7856FF', 'mixpanel',     FALSE, NULL, FALSE, FALSE, 'available', 10),
  ('segment',         'Segment CDP',         'analytics',    'Reenvía datos limpios a 200+ destinos',                        'S', '#52BD94', 'segment',      FALSE, 4900, FALSE, FALSE, 'available', 11),
  ('posthog',         'PostHog',             'analytics',    'Product analytics + session replay open-source',               'P', '#1D4AFF', 'posthog',      FALSE, NULL, FALSE, FALSE, 'available', 12),
  ('spotify',         'Spotify for Artists', 'music',        'Auto-genera playlist colaborativa del evento',                 'S', '#1DB954', 'spotify',      TRUE,  NULL, TRUE,  FALSE, 'available', 13),
  ('songkick',        'Songkick',            'music',        'Sincroniza eventos con concertgoers Songkick',                 'S', '#F80046', 'songkick',     TRUE,  NULL, FALSE, FALSE, 'available', 14),
  ('bandsintown',     'Bandsintown',         'music',        'Difunde eventos a 60M+ fans',                                  'B', '#00CEC8', 'bandsintown',  TRUE,  NULL, FALSE, FALSE, 'available', 15),
  ('shazam',          'Shazam for Artists',  'music',        'Detecta picos Shazam y notifica al DJ',                        'S', '#0066FF', 'shazam',       FALSE, NULL, FALSE, FALSE, 'beta',      16),
  ('soundcloud',      'SoundCloud Pro',      'music',        'Sube los sets DJ al perfil del local',                         'S', '#FF5500', 'soundcloud',   FALSE, NULL, FALSE, FALSE, 'available', 17),
  ('stripe-terminal', 'Stripe Terminal',     'hardware',     'Datáfonos Stripe para puerta y barra',                         'S', '#635BFF', 'stripe',       TRUE,  NULL, TRUE,  TRUE,  'available', 18),
  ('sumup',           'SumUp',               'hardware',     'Datáfonos económicos para puerta y taquilla',                  'S', '#00C292', 'sumup',        TRUE,  NULL, FALSE, FALSE, 'available', 19),
  ('izettle',         'Zettle by PayPal',    'hardware',     'TPV portátil con sync a Pasify',                               'Z', '#00457C', 'paypal',       FALSE, NULL, FALSE, FALSE, 'available', 20),
  ('zapier',          'Zapier',              'productivity', 'Automatiza Pasify ↔ 5000+ apps',                               'Z', '#FF4A00', 'zapier',       TRUE,  NULL, FALSE, FALSE, 'available', 21),
  ('make',            'Make (Integromat)',   'productivity', 'Automatización visual con escenarios',                         'M', '#6D00CC', 'make',         TRUE,  NULL, FALSE, FALSE, 'available', 22),
  ('slack',           'Slack',               'productivity', 'Notificaciones de ventas y alertas en tu workspace',           'S', '#4A154B', 'slack',        TRUE,  NULL, FALSE, FALSE, 'available', 23),
  ('discord',         'Discord',             'productivity', 'Webhook a tu servidor Discord',                                'D', '#5865F2', 'discord',      TRUE,  NULL, FALSE, FALSE, 'available', 24),
  ('google-calendar', 'Google Calendar',     'productivity', 'Sincroniza eventos con tu calendario',                         'G', '#4285F4', 'google',       TRUE,  NULL, FALSE, FALSE, 'available', 25),
  ('notion',          'Notion',              'productivity', 'Exporta reports a tu workspace Notion',                        'N', '#000000', 'notion',       TRUE,  NULL, FALSE, FALSE, 'available', 26),
  ('quickbooks',      'QuickBooks',          'finance',      'Sync de facturas y reconciliación contable',                   'Q', '#2CA01C', 'quickbooks',   TRUE,  NULL, FALSE, FALSE, 'available', 27),
  ('xero',            'Xero',                'finance',      'Contabilidad cloud con sync diario',                           'X', '#13B5EA', 'xero',         TRUE,  NULL, FALSE, FALSE, 'available', 28),
  ('facturascripts',  'FacturaScripts',      'finance',      'ERP español open-source con sync Pasify',                      'F', '#003366', NULL,           FALSE, NULL, FALSE, FALSE, 'available', 29),
  ('whatsapp',        'WhatsApp Business',   'social',       'Mensajería 1-a-1 con clientes desde el dashboard',             'W', '#25D366', 'whatsapp',     TRUE,  NULL, TRUE,  FALSE, 'beta',      30),
  ('instagram',       'Instagram Business',  'social',       'Auto-publica eventos en feed/stories',                         'I', '#E4405F', 'instagram',    TRUE,  NULL, FALSE, FALSE, 'available', 31),
  ('twilio',          'Twilio SMS',          'marketing',    'SMS transaccional y campañas push',                            'T', '#F22F46', 'twilio',       FALSE, NULL, FALSE, FALSE, 'available', 32),
  ('sendgrid',        'SendGrid',            'marketing',    'Email transaccional empresarial',                              'S', '#1A82E2', 'sendgrid',     FALSE, NULL, FALSE, FALSE, 'available', 33),
  ('typeform',        'Typeform',            'productivity', 'Encuestas y feedback post-evento',                             'T', '#262626', 'typeform',     TRUE,  NULL, FALSE, FALSE, 'available', 34)
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- HELP FAQ
-- ============================================================================
INSERT INTO public.help_faq (role, slug, title, body, tag, sort_order) VALUES
  ('all',    'change-email',         '¿Cómo cambio el email o teléfono?',         'Entra en Configuración → Cuenta → Email (o Teléfono). Te enviaremos un código de verificación al nuevo contacto antes de actualizar.', 'Cuenta', 1),
  ('all',    'forgot-password',      'He olvidado mi contraseña',                 'Ve a la pantalla de login y pulsa ¿Olvidaste tu contraseña?. Recibirás un enlace firmado por email; caduca en 60 minutos y solo funciona una vez.', 'Seguridad', 2),
  ('all',    'enable-2fa',           '¿Cómo activo la verificación en 2 pasos?',   'Configuración → Seguridad → Verificación en 2 pasos. Soportamos SMS y apps authenticator (Google Authenticator, 1Password, Authy).', 'Seguridad', 3),
  ('client', 'refund-transfer',      '¿Puedo transferir o reembolsar mi ticket?', 'Sí. Desde Mis tickets pulsa el ticket y elige Transferir (gratis) o Reembolsar (hasta 7 días antes del evento, según política del local).', 'Tickets', 10),
  ('client', 'pasify-points',        '¿Qué son los Pasify Points y cómo se ganan?','Ganas 1 punto por cada euro gastado en tickets y cashless. Al alcanzar 500 puntos subes a Gold; 1500 a Platinum.', 'Loyalty', 11),
  ('client', 'live-mode',            '¿Cómo funciona el modo evento en vivo?',     'Cuando llegas al local con un ticket válido, Pasify detecta tu ubicación y activa el modo evento con line-up, mapa interior, cashless NFC y muro de fotos.', 'Live', 12),
  ('client', 'cashless-refund',      '¿Mi pulsera cashless se reembolsa al final?','Sí. El saldo no consumido se reembolsa automáticamente a tu tarjeta original en 24h tras el cierre del evento.', 'Pagos', 13),
  ('client', 'add-calendar',         '¿Cómo añado un evento al calendario?',       'Desde Favoritos o Mis tickets, pulsa Añadir al calendario. Generamos un .ics compatible con Apple/Google/Outlook.', 'Calendario', 14),
  ('partner','stripe-connect',       '¿Cómo conecto Stripe para cobrar?',         'Configuración → Operación → Stripe Connect. El onboarding completo dura 10 minutos. Para activar payouts diarios necesitas KYC verificado.', 'Pagos', 20),
  ('partner','pricing-ai',           '¿Cómo funciona el Pricing IA?',              'El módulo Pricing IA propone subidas/bajadas dentro de la banda que tú configuras (por defecto +0/+15%). Puedes auto-aceptar o requerir aprobación humana siempre.', 'IA', 21),
  ('partner','autopilot',            '¿Qué es AutoPilot y qué hace por mí?',       'AutoPilot ejecuta pricing, marketing, soporte y reembolsos 24/7 dentro de tus políticas. Tú firmas las decisiones grandes; el agente se ocupa del resto.', 'IA', 22),
  ('partner','team-invite',          '¿Cómo invito a mi equipo?',                  'Sección Equipo → Invitar miembro. Roles: Owner, Manager, RRPP, Door Staff, POS Staff, Read-only. Cada rol tiene permisos granulares.', 'Equipo', 23),
  ('partner','white-label',          '¿Puedo usar mi propio dominio?',             'Sí. En el módulo White-label configuras tu subdominio (gratis: tu-marca.pasify.es) o tu dominio propio (plan Enterprise).', 'Marca', 24),
  ('admin',  'ai-kill-switch',       '¿Cómo desactivo una capability de IA?',      'AI Safety Console → kill-switch por capability. Detiene la capability en TODOS los tenants instantáneamente y queda en audit trail.', 'Trust', 30),
  ('admin',  'refunds-queue',        '¿Cómo gestiono reembolsos pendientes?',      'Sección Reembolsos. Cada solicitud muestra evidencia, cliente, importe y razón. Acciones: Aprobar, Rechazar (justificación obligatoria) o Escalar.', 'Operación', 31),
  ('admin',  'gdpr-dsar',            '¿Cómo respondo a una solicitud GDPR?',       'Compliance → DSAR. Tienes 30 días naturales. Pasify auto-genera el ZIP con los datos del usuario (perfil, eventos, tickets, transacciones).', 'Compliance', 32),
  ('admin',  'benchmarks',           '¿Cómo funcionan los Industry Benchmarks?',   'Datos agregados k-anonimato 15 + ruido diferencial. Ningún corte se publica con menos de 15 tenants. Partners pueden opt-out granular.', 'Datos', 33)
ON CONFLICT (role, slug) DO NOTHING;

-- ============================================================================
-- ERRORS i18n (códigos comunes)
-- ============================================================================
INSERT INTO public.errors_i18n (code, en, es, fr, it, pt, de) VALUES
  ('auth.invalid_credentials',  'Invalid email or password',          'Email o contraseña incorrectos',         'Email ou mot de passe incorrect',          'Email o password errati',                 'Email ou senha inválidos',           'E-Mail oder Passwort falsch'),
  ('auth.email_taken',          'This email is already registered',   'Este email ya está registrado',          'Cet email est déjà enregistré',            'Email già registrato',                    'Este email já está registrado',      'Diese E-Mail ist bereits registriert'),
  ('auth.session_expired',      'Your session has expired',           'Tu sesión ha caducado',                  'Votre session a expiré',                   'La tua sessione è scaduta',               'Sua sessão expirou',                 'Ihre Sitzung ist abgelaufen'),
  ('auth.unauthorized',         'You are not authorized',             'No estás autorizado',                    'Vous n''êtes pas autorisé',                'Non sei autorizzato',                     'Você não está autorizado',           'Sie sind nicht berechtigt'),
  ('ticket.not_found',          'Ticket not found',                   'Ticket no encontrado',                   'Ticket introuvable',                       'Ticket non trovato',                      'Ingresso não encontrado',            'Ticket nicht gefunden'),
  ('ticket.already_used',       'Ticket already scanned',             'Ticket ya escaneado',                    'Ticket déjà scanné',                       'Ticket già scansionato',                  'Ingresso já escaneado',              'Ticket bereits gescannt'),
  ('ticket.not_transferable',   'Transfer not allowed for this tier', 'Este tipo de entrada no es transferible','Transfert non autorisé pour ce niveau',    'Trasferimento non consentito',            'Transferência não permitida',        'Übertragung nicht erlaubt'),
  ('refund.duplicate',          'Refund request already exists',      'Ya existe una solicitud de reembolso',   'Demande de remboursement déjà existante',  'Richiesta di rimborso già esistente',     'Solicitação de reembolso já existe', 'Rückerstattungsantrag existiert bereits'),
  ('refund.too_late',           'Refund period has expired',          'El plazo de reembolso ha expirado',      'Délai de remboursement expiré',            'Termine di rimborso scaduto',             'Prazo de reembolso expirado',        'Rückerstattungsfrist abgelaufen'),
  ('payment.failed',            'Payment failed',                     'El pago ha fallado',                     'Le paiement a échoué',                     'Pagamento fallito',                       'Pagamento falhou',                   'Zahlung fehlgeschlagen'),
  ('payment.declined',          'Card declined',                      'Tarjeta rechazada',                      'Carte refusée',                            'Carta rifiutata',                         'Cartão recusado',                    'Karte abgelehnt'),
  ('event.sold_out',            'Event sold out',                     'Evento agotado',                         'Événement complet',                        'Evento esaurito',                         'Evento esgotado',                    'Veranstaltung ausverkauft'),
  ('event.not_published',       'Event not published',                'Evento no publicado',                    'Événement non publié',                     'Evento non pubblicato',                   'Evento não publicado',               'Veranstaltung nicht veröffentlicht'),
  ('rate_limit.exceeded',       'Too many requests, slow down',       'Demasiadas peticiones, espera un momento','Trop de requêtes, ralentissez',           'Troppe richieste, rallenta',              'Muitas requisições, aguarde',        'Zu viele Anfragen'),
  ('captcha.required',          'Captcha verification required',      'Verificación captcha requerida',         'Vérification captcha requise',             'Verifica captcha richiesta',              'Captcha obrigatório',                'Captcha-Überprüfung erforderlich'),
  ('2fa.required',              '2FA verification required',          'Verificación 2FA requerida',             'Vérification 2FA requise',                 'Verifica 2FA richiesta',                  '2FA obrigatório',                    '2FA-Überprüfung erforderlich'),
  ('2fa.invalid_code',          'Invalid 2FA code',                   'Código 2FA inválido',                    'Code 2FA invalide',                        'Codice 2FA non valido',                   'Código 2FA inválido',                'Ungültiger 2FA-Code'),
  ('cashless.insufficient',     'Insufficient cashless balance',      'Saldo cashless insuficiente',            'Solde cashless insuffisant',               'Saldo cashless insufficiente',            'Saldo cashless insuficiente',        'Cashless-Guthaben nicht ausreichend'),
  ('upload.too_large',          'File too large',                     'Archivo demasiado grande',               'Fichier trop volumineux',                  'File troppo grande',                      'Arquivo muito grande',               'Datei zu groß'),
  ('upload.invalid_format',     'Invalid file format',                'Formato de archivo no válido',           'Format de fichier invalide',               'Formato file non valido',                 'Formato de arquivo inválido',        'Ungültiges Dateiformat'),
  ('subscription.required',     'Active subscription required',       'Suscripción activa requerida',           'Abonnement actif requis',                  'Abbonamento attivo richiesto',            'Assinatura ativa obrigatória',       'Aktives Abonnement erforderlich'),
  ('venue.no_access',           'No access to this venue',            'Sin acceso a este local',                'Pas d''accès à ce lieu',                   'Nessun accesso a questo locale',          'Sem acesso a este local',            'Kein Zugriff auf diesen Ort'),
  ('maintenance.active',        'Platform under maintenance',         'Plataforma en mantenimiento',            'Plateforme en maintenance',                'Piattaforma in manutenzione',             'Plataforma em manutenção',           'Plattform in Wartung')
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- ALERTING RULES
-- ============================================================================
INSERT INTO public.alerting_rules (code, name, description, query, threshold, comparator, window_seconds, severity, notify_channels) VALUES
  ('stripe_webhook_failure_rate', 'Stripe Webhook Failure Rate',
    'Tasa de fallos webhooks Stripe > 5% en 10min',
    'SELECT COUNT(*) FILTER (WHERE status=''failed'')::float / NULLIF(COUNT(*),0) FROM public.stripe_webhook_events WHERE received_at > now() - interval ''10 minutes''',
    0.05, 'gt', 600, 'high', '["email","slack"]'::jsonb),
  ('refunds_backlog',             'Refunds backlog',
    'Refunds pending > 50 durante 1h',
    'SELECT COUNT(*) FROM public.refund_requests WHERE status=''pending'' AND created_at < now() - interval ''1 hour''',
    50, 'gt', 3600, 'medium', '["email"]'::jsonb),
  ('ai_critical_anomalies',       'AI anomalies críticas abiertas',
    'Cualquier anomaly critical abierta',
    'SELECT COUNT(*) FROM public.ai_anomalies WHERE severity=''critical'' AND resolved=FALSE',
    0, 'gt', 60, 'critical', '["email","slack","sms"]'::jsonb),
  ('support_response_time',       'Support response time SLA',
    'Mensajes cliente sin respuesta > 30min',
    'SELECT COUNT(*) FROM public.support_conversations WHERE unread_for_admin > 0 AND last_message_at < now() - interval ''30 minutes''',
    5, 'gt', 1800, 'medium', '["email"]'::jsonb),
  ('dsar_deadline_approaching',   'DSAR deadline approaching',
    'DSAR requests con deadline en menos de 7 días',
    'SELECT COUNT(*) FROM public.compliance_dsar_requests WHERE status=''pending'' AND deadline_at < now() + interval ''7 days''',
    0, 'gt', 86400, 'high', '["email"]'::jsonb)
ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- SERVICE STATUS inicial
-- ============================================================================
INSERT INTO public.service_status_snapshots (service, status, recorded_at) VALUES
  ('database', 'operational', now()),
  ('auth',     'operational', now()),
  ('storage',  'operational', now()),
  ('realtime', 'operational', now()),
  ('stripe',   'operational', now()),
  ('email',    'operational', now()),
  ('push',     'maintenance', now());

-- ============================================================================
-- LOYALTY levels (asegurar que están)
-- ============================================================================
INSERT INTO public.loyalty_levels (code, name, min_points, color, sort_order, perks) VALUES
  ('bronze',  'Bronze',   0,    '#B8763C', 1, '["Acceso a eventos exclusivos","Newsletter prioritaria"]'::jsonb),
  ('silver',  'Silver',   500,  '#C9C9C9', 2, '["10% descuento puerta","Entrada prioritaria"]'::jsonb),
  ('gold',    'Gold',     1500, '#E8B04C', 3, '["20% descuento puerta","Drink de bienvenida","Acceso anticipado a venta"]'::jsonb),
  ('platinum','Platinum', 5000, '#E8E1D4', 4, '["Acceso VIP gratis","Concierge dedicado","Mesa reservada en eventos especiales"]'::jsonb)
ON CONFLICT (code) DO NOTHING;
