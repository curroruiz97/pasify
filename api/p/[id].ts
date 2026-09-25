// Enlace público de la ficha de un local:  https://pasifyy.vercel.app/p/<partner-id>
// (publicPartnerUrl / sharePartnerLink en src/lib/eventLinks.ts).
//
// Mismo patrón que api/e/[id].ts: los rastreadores de vista previa (WhatsApp,
// Telegram, Meta, Twitter…) no ejecutan JS y la SPA no puede darles etiquetas
// og:*; lo que va detrás del `#` ni siquiera llega al servidor.
//
//   - Navegadores reales: 302 directo a la ficha en la app, /#/p/<id>
//     (PublicPartnerPage), sin consultar nada.
//   - Rastreadores: HTML con og:* / twitter:* del local (nombre, imagen y
//     descripción) desde la vista pública `public_partners`, que ya filtra
//     locales aprobados y no expone datos personales. Con meta-refresh + JS
//     replace por si lo abre un navegador.
//   - Local inexistente o no aprobado: también a /#/p/<id>, que dice "Local
//     no encontrado". Id que no es un UUID: al calendario.
//
// Autocontenido a propósito (sin imports relativos): el proyecto es ESM
// ("type": "module") y cada función de api/ se despliega por separado.
//
// Wired en vercel.json:  /p/:id  →  /api/p/:id  (antes del catch-all).

const SUPABASE_URL =
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SUPABASE_ANON =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "";
// Igual que en api/e/[id].ts: `SITE_URL` en Vercel → Environment Variables.
const SITE_URL = (process.env.SITE_URL || "https://pasifyy.vercel.app").replace(
  /\/$/,
  ""
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Link-preview crawlers: la misma lista que api/e/[id].ts.
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

interface PartnerRow {
  id: string;
  business_name: string | null;
  business_description: string | null;
  city: string | null;
  avatar_url: string | null;
  cover_image_url: string | null;
}

const escapeHtml = (s: string) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );

/** Texto en una línea y como mucho `max` caracteres (las tarjetas cortan el resto). */
const summarize = (s: string | null, max = 200) => {
  const clean = (s ?? "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
};

function redirect(res: VercelResponse, location: string, cacheControl: string) {
  res.statusCode = 302;
  res.setHeader("Cache-Control", cacheControl);
  res.setHeader("Location", location);
  return res.end();
}

/** El local desde `public_partners` con la clave pública. null si no está o falla. */
async function fetchPartner(id: string): Promise<PartnerRow | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON) return null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/public_partners?id=eq.${id}&select=id,business_name,business_description,city,avatar_url,cover_image_url&limit=1`,
      {
        headers: {
          apikey: SUPABASE_ANON,
          Authorization: `Bearer ${SUPABASE_ANON}`,
        },
      }
    );
    if (!r.ok) return null;
    const arr = (await r.json()) as PartnerRow[];
    return Array.isArray(arr) && arr.length > 0 ? arr[0] : null;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const rawId = req.query?.id;
  const id = (Array.isArray(rawId) ? rawId[0] : rawId) ?? "";

  // Enlace roto o heredado ("demo-1"…): no hay local que enseñar.
  if (!UUID_RE.test(id)) {
    return redirect(res, `${SITE_URL}/#/calendar`, "public, max-age=60");
  }

  // HashRouter: la ruta real es /#/p/<id>.
  const targetUrl = `${SITE_URL}/#/p/${id}`;

  // Browsers reales: 302 limpio y sin esperar a Supabase.
  const ua = String(req.headers?.["user-agent"] ?? "");
  if (!LINK_PREVIEW_BOT_RE.test(ua)) {
    return redirect(res, targetUrl, "public, max-age=0, must-revalidate");
  }

  const partner = await fetchPartner(id);
  if (!partner) {
    return redirect(res, targetUrl, "public, max-age=60");
  }

  const canonicalUrl = `${SITE_URL}/p/${id}`;
  const name = summarize(partner.business_name, 90) || "Local en Pasify";
  const city = summarize(partner.city, 60);
  const description =
    summarize(partner.business_description) ||
    `Eventos y entradas de ${name}${city ? ` (${city})` : ""} en Pasify.`;
  // Para la tarjeta, mejor la portada (apaisada) que el avatar.
  const cardImage = partner.cover_image_url || partner.avatar_url;
  const ogImage = cardImage || `${SITE_URL}/logo.png`;

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(name)} · Pasify</title>
<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />
<meta name="description" content="${escapeHtml(description)}" />
<meta property="og:type" content="website" />
<meta property="og:url" content="${escapeHtml(canonicalUrl)}" />
<meta property="og:title" content="${escapeHtml(name)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:image" content="${escapeHtml(ogImage)}" />
<meta property="og:image:secure_url" content="${escapeHtml(ogImage)}" />
<meta property="og:image:alt" content="${escapeHtml(name)}" />
<meta property="og:site_name" content="Pasify" />
<meta property="og:locale" content="es_ES" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeHtml(name)}" />
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
${cardImage ? `<img src="${escapeHtml(cardImage)}" alt="" />` : ""}
<h1>${escapeHtml(name)}</h1>
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
