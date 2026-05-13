-- Pasify · 0038 marketplace top-10 reenfoque + CoverManager
--
-- La sección "App Marketplace" del partner pasa de ser una tienda generica
-- (30+ apps de todas las categorias) a un Top 10 enfocado al negocio real
-- de Pasify: importar clientes, vender mas, medir, cobrar fisicamente,
-- facturar y automatizar. El frontend solo muestra los codes de este Top 10,
-- ordenados por la sort_order que aqui marcamos. El resto de apps quedan
-- en BD (no las borramos) pero con featured=false y sort_order alto para
-- que un futuro "explorar todo" sea posible sin perder el seed.
--
-- 1) Anade CoverManager como app destacada #1 (UPSERT por code).
-- 2) Actualiza el Top 10 con descripciones claras, categorias orientadas
--    a caso de uso y status realista (no prometemos OAuth donde no lo hay).
-- 3) Baja el sort_order y limpia featured/popular del resto.
--
-- Idempotente: usa ON CONFLICT (code) DO UPDATE para no duplicar y poder
-- reaplicar la migracion sin perder estado.

-- ============================================================================
-- 1) CoverManager — INSERT/UPSERT como integracion destacada #1
-- ============================================================================
INSERT INTO public.marketplace_apps (
  code, name, category, short_description, description,
  icon_slug, icon_color,
  oauth_provider, official, monthly_price_cents,
  popular, featured, status, sort_order
) VALUES (
  'covermanager',
  'CoverManager',
  'customer_data',
  'Importa clientes, reservas, cumpleaños, preferencias y segmentos para activar campañas y listas VIP.',
  'CoverManager es el sistema de reservas líder en restauración y locales de ocio en España. Conecta tu cuenta para importar tu base de clientes (con cumpleaños, preferencias, historial de reservas, no-shows, gasto medio) y úsala en Pasify para crear listas VIP, lanzar campañas segmentadas, detectar clientes frecuentes y reactivar a los que llevan tiempo sin venir.',
  'covermanager',
  '#E8542A',
  NULL,
  TRUE,
  NULL,
  TRUE,
  TRUE,
  'coming_soon',
  1
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  short_description = EXCLUDED.short_description,
  description = EXCLUDED.description,
  icon_slug = EXCLUDED.icon_slug,
  icon_color = EXCLUDED.icon_color,
  oauth_provider = EXCLUDED.oauth_provider,
  official = EXCLUDED.official,
  popular = EXCLUDED.popular,
  featured = EXCLUDED.featured,
  status = EXCLUDED.status,
  sort_order = EXCLUDED.sort_order;

-- ============================================================================
-- 2) Top 10 — actualiza el resto con copy útil, categoría orientada a caso
--    de uso y estado realista.
-- ============================================================================

-- WhatsApp Business — comunicacion
UPDATE public.marketplace_apps SET
  category = 'comms',
  short_description = 'Envía confirmaciones, recordatorios, mensajes VIP y campañas segmentadas con opt-in.',
  icon_slug = 'whatsapp',
  icon_color = '#25D366',
  featured = TRUE, popular = TRUE,
  status = 'beta', sort_order = 2
WHERE code = 'whatsapp';

-- Brevo — comunicacion (email/SMS)
UPDATE public.marketplace_apps SET
  category = 'comms',
  short_description = 'Crea newsletters, campañas SMS/email y automatizaciones para clientes recurrentes.',
  icon_slug = 'brevo',
  icon_color = '#0B996E',
  featured = TRUE, popular = FALSE,
  status = 'available', sort_order = 3
WHERE code = 'brevo';

-- Meta Ads / Instagram — marketing
UPDATE public.marketplace_apps SET
  category = 'ads',
  short_description = 'Crea audiencias y conversiones basadas en compradores y asistentes reales.',
  icon_slug = 'meta',
  icon_color = '#1877F2',
  featured = TRUE, popular = TRUE,
  status = 'available', sort_order = 4
WHERE code = 'meta-ads';

-- TikTok Ads — marketing
UPDATE public.marketplace_apps SET
  category = 'ads',
  short_description = 'Optimiza campañas para eventos, fiestas y público joven con eventos reales de compra.',
  icon_slug = 'tiktok',
  icon_color = '#000000',
  featured = TRUE, popular = TRUE,
  status = 'available', sort_order = 5
WHERE code = 'tiktok-ads';

-- Stripe Terminal — cobros físicos
UPDATE public.marketplace_apps SET
  category = 'payments_physical',
  short_description = 'Cobra en puerta, taquilla y barra con pagos presenciales conectados a Pasify.',
  icon_slug = 'stripe',
  icon_color = '#635BFF',
  featured = TRUE, popular = TRUE,
  status = 'available', sort_order = 6
WHERE code = 'stripe-terminal';

-- Google Analytics 4 — medicion
UPDATE public.marketplace_apps SET
  category = 'measurement',
  short_description = 'Mide visitas, checkout, compras y campañas desde el funnel completo de Pasify.',
  icon_slug = 'ga4',
  icon_color = '#F9AB00',
  featured = TRUE, popular = FALSE,
  status = 'available', sort_order = 7
WHERE code = 'ga4';

-- Holded — finanzas
UPDATE public.marketplace_apps SET
  category = 'finance',
  short_description = 'Exporta ventas, comisiones, IVA, reembolsos y facturación para contabilidad.',
  icon_slug = 'holded',
  icon_color = '#0066FF',
  featured = TRUE, popular = TRUE,
  status = 'coming_soon', sort_order = 8
WHERE code = 'holded';

-- Zapier — automatizacion
UPDATE public.marketplace_apps SET
  category = 'automation',
  short_description = 'Automatiza tareas conectando Pasify con miles de herramientas sin código.',
  icon_slug = 'zapier',
  icon_color = '#FF4A00',
  featured = TRUE, popular = TRUE,
  status = 'available', sort_order = 9
WHERE code = 'zapier';

-- Make — automatizacion
UPDATE public.marketplace_apps SET
  category = 'automation',
  short_description = 'Automatización visual sin código con escenarios para Pasify.',
  icon_slug = 'make',
  icon_color = '#6D00CC',
  featured = TRUE, popular = FALSE,
  status = 'available', sort_order = 10
WHERE code = 'make';

-- ============================================================================
-- 3) Apps adicionales del Top 10 que NO existen en el seed previo:
--    - Google Tag Manager
--    - Google Maps / Business Profile
--    Las anadimos via UPSERT.
-- ============================================================================
INSERT INTO public.marketplace_apps (
  code, name, category, short_description, description,
  icon_slug, icon_color,
  oauth_provider, official, monthly_price_cents,
  popular, featured, status, sort_order
) VALUES
  (
    'google-tag-manager',
    'Google Tag Manager',
    'measurement',
    'Despliega tags, pixels y eventos de medición sin tocar el código del sitio.',
    'GTM permite añadir y modificar pixels y scripts de medición (GA4, Meta Pixel, TikTok Pixel, etc.) sin tocar el código de Pasify. Imprescindible si trabajas con varias plataformas de ads o tienes una agencia gestionando tu medición.',
    'gtm',
    '#246FDB',
    NULL,
    TRUE,
    NULL,
    FALSE,
    TRUE,
    'available',
    11
  ),
  (
    'google-maps',
    'Google Maps',
    'location',
    'Mejora la ubicación, mapa de cómo llegar y descubrimiento desde búsquedas.',
    'Integración con la API de Google Maps para mostrar mapas precisos en el ticket del cliente y en la página pública del evento.',
    'googlemaps',
    '#34A853',
    NULL,
    TRUE,
    NULL,
    FALSE,
    TRUE,
    'available',
    12
  ),
  (
    'google-business-profile',
    'Google Business Profile',
    'location',
    'Sincroniza tu ficha de Google (fotos, eventos, reviews) con tu local en Pasify.',
    'Conecta tu Google Business Profile para mantener actualizada la ficha del local, publicar eventos en Google Search/Maps y leer reviews directamente desde el dashboard de Pasify.',
    'googlebusiness',
    '#4285F4',
    NULL,
    TRUE,
    NULL,
    FALSE,
    TRUE,
    'coming_soon',
    13
  )
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  short_description = EXCLUDED.short_description,
  description = EXCLUDED.description,
  icon_slug = EXCLUDED.icon_slug,
  icon_color = EXCLUDED.icon_color,
  popular = EXCLUDED.popular,
  featured = EXCLUDED.featured,
  status = EXCLUDED.status,
  sort_order = EXCLUDED.sort_order;

-- ============================================================================
-- 4) Mover el resto de apps fuera del Top 10: featured = FALSE y sort_order
--    >= 100 para que jamas se mezclen en una vista "destacadas". Mantenemos
--    los datos por si el partner-admin quiere reactivar alguna en el futuro
--    o si hacemos una vista "explorar todas".
-- ============================================================================
UPDATE public.marketplace_apps
SET featured = FALSE, popular = FALSE, sort_order = sort_order + 100
WHERE code NOT IN (
  'covermanager',
  'whatsapp',
  'brevo',
  'meta-ads',
  'tiktok-ads',
  'stripe-terminal',
  'ga4',
  'google-tag-manager',
  'holded',
  'zapier',
  'make',
  'google-maps',
  'google-business-profile'
);
