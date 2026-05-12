// Public shareable URL for an event:  https://pasifyy.vercel.app/e/<event-id>
//
// WhatsApp / Telegram / Facebook / Twitter / LinkedIn scrape the URL with a
// non-JS crawler and look at the HTML <meta og:*> tags to build the link card.
// Pasify es una SPA Vite (sin SSR) → desde React no podemos inyectar esas tags;
// el bot sólo vería el index.html vacío.
//
// Este serverless function (Vercel) consulta el evento desde Supabase REST,
// construye HTML con las tags og:* / twitter:* correctas (imagen + título +
// descripción) y luego redirige a los browsers reales a /calendar?event=<id>
// vía 302 + fallback meta-refresh + JS replace.
//
// Wired en vercel.json:  /e/:id  →  /api/e/:id

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_ANON =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "";
// `SITE_URL` lo configuras en Vercel Dashboard → Settings → Environment Variables.
// Temporal: pasifyy.vercel.app. Cuando uses el dominio definitivo (pasify.es)
// solo cambias la env var, no toca código.
const SITE_URL = (process.env.SITE_URL || "https://pasifyy.vercel.app").replace(
  /\/$/,
  ""
);

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

export default async function handler(req: any, res: any) {
  const rawId = req.query?.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;

  if (!id || typeof id !== "string" || !SUPABASE_URL || !SUPABASE_ANON) {
    res.statusCode = 302;
    res.setHeader("Location", `${SITE_URL}/#/calendar`);
    return res.end();
  }

  let event: EventRow | null = null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/events?id=eq.${encodeURIComponent(
        id
      )}&select=id,title,description,image_url,date_start,date_end,city,venue_name,price_cents&limit=1`,
      {
        headers: {
          apikey: SUPABASE_ANON,
          Authorization: `Bearer ${SUPABASE_ANON}`,
        },
      }
    );
    if (r.ok) {
      const arr = (await r.json()) as EventRow[];
      event = Array.isArray(arr) && arr.length > 0 ? arr[0] : null;
    }
  } catch {
    event = null;
  }

  // Unknown / deleted event → bounce to the Calendar landing.
  if (!event) {
    res.statusCode = 302;
    res.setHeader("Cache-Control", "public, max-age=60");
    res.setHeader("Location", `${SITE_URL}/#/calendar`);
    return res.end();
  }

  // Redirect target — Pasify usa HashRouter, así que la ruta real es /#/calendar?...
  // (no /calendar?... sin hash). WhatsApp/Telegram in-app browsers respetan el #
  // en Location si va en el path completo. El index.html además tiene un script
  // de rescate por si algún browser strips el hash.
  const targetUrl = `${SITE_URL}/#/calendar?event=${encodeURIComponent(event.id)}`;
  // og:url se queda como la URL corta canonical (lo que el user comparte).
  const canonicalUrl = `${SITE_URL}/e/${encodeURIComponent(event.id)}`;
  const ogImage = event.image_url || `${SITE_URL}/logo.png`;
  const title = event.title || "Evento Pasify";
  const description = "¿Y tú qué haces? ¿No te unes? 🎉";

  // Detect link-preview crawlers (WhatsApp/Telegram/Meta/Twitter/LinkedIn/
  // Discord/Slack/Pinterest/Skype). Solo a ellos servimos el HTML con og:*.
  // Browsers reales obtienen un 302 limpio (más robusto que meta-refresh).
  const ua = String(req.headers?.["user-agent"] ?? "");
  const isLinkPreviewBot =
    /WhatsApp|TelegramBot|facebookexternalhit|facebookcatalog|Facebot|Twitterbot|LinkedInBot|Slackbot|Discordbot|SkypeUriPreview|Pinterest|GoogleBot|bingbot|Embedly|Iframely|Applebot/i.test(
      ua
    );

  if (!isLinkPreviewBot) {
    res.statusCode = 302;
    res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    res.setHeader("Location", targetUrl);
    return res.end();
  }

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
