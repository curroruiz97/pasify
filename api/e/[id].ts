// Public shareable URL for an event:  https://pasify.es/e/<event-id>
// (publicEventUrl / shareEventLink en src/lib/eventLinks.ts).
//
// WhatsApp / Telegram / Facebook / Twitter / LinkedIn scrape the URL with a
// non-JS crawler and look at the HTML <meta og:*> tags to build the link card.
// Pasify es una SPA Vite (sin SSR) → desde React no podemos inyectar esas tags;
// el bot sólo vería el index.html vacío. Por eso el enlace va sin `#`: lo que
// hay detrás del `#` nunca llega al servidor.
//
// Este serverless function (Vercel):
//   - Navegadores reales: 302 directo a la página del evento en la app,
//     /#/e/<id> (PublicEvent), sin consultar nada. Antes iba a
//     /#/calendar?event=<id>, que filtra por la ciudad de quien abre el
//     enlace: si no era la del evento, no lo veía.
//   - Rastreadores de vista previa: consulta el evento desde Supabase REST y
//     sirve HTML con las tags og:* / twitter:* (imagen + título +
//     descripción), con meta-refresh + JS replace por si lo abre un navegador.
//   - Evento inexistente o retirado: también a /#/e/<id>, que ya dice "no
//     disponible" y ofrece ver otros. Id que no es un UUID: al calendario.
//
// Wired en vercel.json:  /e/:id  →  /api/e/:id

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_ANON =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "";
// `SITE_URL` se puede fijar en Vercel Dashboard → Settings → Environment
// Variables; si falta, vale el dominio definitivo (pasify.es).
const SITE_URL = (process.env.SITE_URL || "https://pasify.es").replace(
  /\/$/,
  ""
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Link-preview crawlers (WhatsApp/Telegram/Meta/Twitter/LinkedIn/Discord/
// Slack/Pinterest/Skype). Solo a ellos servimos el HTML con og:*.
const LINK_PREVIEW_BOT_RE =
  /WhatsApp|TelegramBot|facebookexternalhit|facebookcatalog|Facebot|Twitterbot|LinkedInBot|Slackbot|Discordbot|SkypeUriPreview|Pinterest|GoogleBot|bingbot|Embedly|Iframely|Applebot/i;

interface VercelRequest {
  query?: Record<string, string | string[] | undefined>;
  headers?: Record<string, string | string[] | undefined>;
}

interface VercelResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

const escapeHtml = (s: string) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );

interface EventRow {
  id: string;
  title: string | null;
  description: string | null;
  image_url: string | null;
  date_start: string;
  date_end: string | null;
  city: string | null;
  venue_name: string | null;
  price_cents: number | null;
}

function redirect(res: VercelResponse, location: string, cacheControl: string) {
  res.statusCode = 302;
  res.setHeader("Cache-Control", cacheControl);
  res.setHeader("Location", location);
  return res.end();
}

/** El evento con la clave pública (RLS: solo publicados o pasados). null si no está o falla. */
async function fetchEvent(id: string): Promise<EventRow | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON) return null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/events?id=eq.${id}&select=id,title,description,image_url,date_start,date_end,city,venue_name,price_cents&limit=1`,
      {
        headers: {
          apikey: SUPABASE_ANON,
          Authorization: `Bearer ${SUPABASE_ANON}`,
        },
      }
    );
    if (!r.ok) return null;
    const arr = (await r.json()) as EventRow[];
    return Array.isArray(arr) && arr.length > 0 ? arr[0] : null;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const rawId = req.query?.id;
  const id = (Array.isArray(rawId) ? rawId[0] : rawId) ?? "";

  // Enlace roto o recortado: no hay evento que enseñar.
  if (!UUID_RE.test(id)) {
    return redirect(res, `${SITE_URL}/#/calendar`, "public, max-age=60");
  }

  // Redirect target — Pasify usa HashRouter, así que la ruta real es /#/e/<id>
  // (no /e/<id> sin hash). WhatsApp/Telegram in-app browsers respetan el #
  // en Location si va en la URL completa. El index.html además tiene un script
  // de rescate por si algún browser strips el hash.
  const targetUrl = `${SITE_URL}/#/e/${id}`;

  // Browsers reales: 302 limpio (más robusto que meta-refresh) y sin esperar
  // a Supabase; la página del evento ya carga sus datos.
  const ua = String(req.headers?.["user-agent"] ?? "");
  if (!LINK_PREVIEW_BOT_RE.test(ua)) {
    return redirect(res, targetUrl, "public, max-age=0, must-revalidate");
  }

  const event = await fetchEvent(id);
  // Unknown / retirado: sin tarjeta propia (el bot se queda con la genérica
  // del index.html); quien lo abra verá "Este evento no está disponible".
  if (!event) {
    return redirect(res, targetUrl, "public, max-age=60");
  }

  // og:url se queda como la URL corta canonical (lo que el user comparte).
  const canonicalUrl = `${SITE_URL}/e/${id}`;
  const ogImage = event.image_url || `${SITE_URL}/logo.png`;
  const title = event.title || "Evento Pasify";
  const description = "¿Y tú qué haces? ¿No te unes? 🎉";

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · Pasify</title>
<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
<meta name="description" content="${escapeHtml(description)}" />
<meta property="og:type" content="website" />
<meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:image" content="${escapeHtml(ogImage)}" />
<meta property="og:image:secure_url" content="${escapeHtml(ogImage)}" />
<meta property="og:image:type" content="image/jpeg" />
<meta property="og:image:alt" content="${escapeHtml(title)}" />
<meta property="og:site_name" content="Pasify" />
<meta property="og:locale" content="es_ES" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeHtml(title)}" />
<meta name="twitter:description" content="${escapeHtml(description)}" />
<meta name="twitter:image" content="${escapeHtml(ogImage)}" />
<meta http-equiv="refresh" content="0; url=${escapeHtml(targetUrl)}" />
<script>window.location.replace(${JSON.stringify(targetUrl)})</script>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0B0908;color:#F4EEE2;margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:24px;text-align:center}
.card{max-width:420px;background:rgba(244,238,226,.04);border:1px solid rgba(244,238,226,.08);border-radius:24px;padding:28px}
img{width:100%;aspect-ratio:1200/630;object-fit:cover;border-radius:16px;margin-bottom:16px}
h1{font-size:20px;margin:0 0 8px}
p{opacity:.8;margin:0 0 20px}
a{display:inline-block;padding:12px 24px;background:linear-gradient(180deg,#FF7A4D,#E8542A 55%,#B8381A);color:#fff;border-radius:999px;text-decoration:none;font-weight:600}
</style>
</head>
<body>
<div class="card">
${event.image_url ? `<img src="${escapeHtml(event.image_url)}" alt="" />` : ""}
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(description)}</p>
<a href="${escapeHtml(targetUrl)}">Abrir en Pasify</a>
</div>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Cache-Control",
    "public, max-age=60, s-maxage=60, stale-while-revalidate=300"
  );
  res.statusCode = 200;
  return res.end(html);
}
