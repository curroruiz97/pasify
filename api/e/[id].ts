// Public shareable URL for an event:  https://studentslife.es/e/<event-id>
//
// WhatsApp / Telegram / Facebook / Twitter scrape the URL with a non-JS
// crawler and look at the HTML <meta og:*> tags to build the link card.
// Our app is a Vite SPA (no SSR) so we can't inject those tags from the
// React side — the bot would only see the static index.html.
//
// This serverless function fetches the event from Supabase REST, builds an
// HTML response with the right og:* / twitter:* tags pointing at the
// event image + a punchy copy, and immediately redirects real users to the
// React detail page (/calendar/:city/:id) via meta refresh + JS replace.
//
// Wired up in vercel.json:  /e/:id  →  /api/e/:id

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_ANON =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "";
const SITE_URL = (process.env.SITE_URL || "https://studentslife.es").replace(
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
  video_url: string | null;
  start_date: string;
  end_date: string;
  city: string | null;
  country: string | null;
  location_name: string | null;
  price: number | null;
}

export default async function handler(req: any, res: any) {
  const rawId = req.query?.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;

  if (!id || typeof id !== "string" || !SUPABASE_URL || !SUPABASE_ANON) {
    res.statusCode = 302;
    res.setHeader("Location", `${SITE_URL}/calendar`);
    return res.end();
  }

  let event: EventRow | null = null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/events?id=eq.${encodeURIComponent(
        id
      )}&select=id,title,description,image_url,video_url,start_date,end_date,city,country,location_name,price&limit=1`,
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
    res.setHeader("Location", `${SITE_URL}/calendar`);
    return res.end();
  }

  // Redirect target for real browsers — path-based without the hash.
  // index.html has a tiny rescue script that detects the path and
  // rewrites it into the /#/... form HashRouter expects. Going via
  // path is more robust than relying on Location's fragment because
  // some in-app browsers (notably WhatsApp's WebView) strip "#" from
  // Location headers, which would otherwise dump the user on the
  // landing.
  const targetUrl = `${SITE_URL}/calendar?event=${encodeURIComponent(event.id)}`;
  // og:url stays as the canonical /e/<id> (the short URL the user is
  // sharing). Cleaner for crawlers and stable for cache keys.
  const canonicalUrl = `${SITE_URL}/e/${encodeURIComponent(event.id)}`;
  const ogImage = event.image_url || `${SITE_URL}/logo.png`;
  const title = event.title || "Evento StudentsLife";
  // Single, punchy copy independent of the event — the title goes in og:title.
  const description = "¿Y tú qué haces? ¿No te unes? 🎉";

  // Detect link-preview crawlers (WhatsApp/Telegram/Meta/Twitter/LinkedIn/
  // Discord/Slack/Pinterest/Skype). They need the HTML with og:* tags to
  // build the preview card. Real browsers — including the in-app browser
  // that opens AFTER the user taps the WhatsApp link — get a plain 302
  // redirect, which is far more reliable than meta-refresh / JS-replace
  // (some in-app browsers silently strip JS or ignore meta refresh).
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
<title>${escapeHtml(title)} · StudentsLife</title>
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
<meta property="og:site_name" content="StudentsLife" />
<meta property="og:locale" content="es_ES" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeHtml(title)}" />
<meta name="twitter:description" content="${escapeHtml(description)}" />
<meta name="twitter:image" content="${escapeHtml(ogImage)}" />
<meta http-equiv="refresh" content="0; url=${escapeHtml(targetUrl)}" />
<script>window.location.replace(${JSON.stringify(targetUrl)})</script>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0b1220;color:#fff;margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:24px;text-align:center}
.card{max-width:420px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);border-radius:24px;padding:28px}
img{width:100%;aspect-ratio:1200/630;object-fit:cover;border-radius:16px;margin-bottom:16px}
h1{font-size:20px;margin:0 0 8px}
p{opacity:.8;margin:0 0 20px}
a{display:inline-block;padding:12px 24px;background:#6366f1;color:#fff;border-radius:999px;text-decoration:none;font-weight:600}
</style>
</head>
<body>
<div class="card">
${event.image_url ? `<img src="${escapeHtml(event.image_url)}" alt="" />` : ""}
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(description)}</p>
<a href="${escapeHtml(targetUrl)}">Abrir en StudentsLife</a>
</div>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // Short cache + SWR. Was 5min — too long: when we tweak og:* tags
  // (or an event's image changes) social scrapers keep getting the
  // stale HTML and the rich preview breaks for tens of minutes.
  // 60s + 5min SWR keeps it fresh while staying snappy.
  res.setHeader(
    "Cache-Control",
    "public, max-age=60, s-maxage=60, stale-while-revalidate=300"
  );
  res.statusCode = 200;
  return res.end(html);
}
