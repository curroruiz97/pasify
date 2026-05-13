# Pasify · Configuración SEO externa

Documento operativo para SEO técnico y on-page de **Pasify** (`pasify.es`).
Sustituye la guía heredada de Students Life — el público objetivo, los
keywords y la estrategia son completamente distintos en Pasify.

> **Última actualización**: 2026-05-13 · Post Fase 4 cleanup (branding purge).

---

## 1. Public assets ya configurados en el repo

- `public/sitemap.xml` — 5 URLs canónicas con alternates `hreflang` ES/EN/FR/IT/PT/DE
- `public/CNAME` — `pasify.es` (Vercel custom domain target)
- `public/site.webmanifest` — name `Pasify`, theme `#0B0908`, bg `#F7F3EC`
- `public/.well-known/assetlinks.json` — pendiente de actualizar a
  `package_name: es.pasify.app` cuando se rebuildee el wrap móvil

---

## 2. Google Search Console

Pasos para registrar el dominio en GSC:

1. Vincula la propiedad **dominio** `pasify.es` (no URL prefix; permite
   cubrir todos los subdomains automáticamente).
2. Verifica via DNS TXT record (Vercel ya gestiona el A/AAAA).
3. Envía sitemap: `https://pasify.es/sitemap.xml`.
4. Configura usuario adicional para el equipo ops.
5. Revisa Coverage report semanalmente durante los primeros 2 meses tras
   cutover.

---

## 3. Bing Webmaster Tools

1. Importa la propiedad desde Google Search Console (un click).
2. Envía sitemap: `https://pasify.es/sitemap.xml`.

---

## 4. Open Graph & meta tags

`index.html` debe servir meta tags base para social cards:

```html
<meta property="og:site_name" content="Pasify" />
<meta property="og:type" content="website" />
<meta property="og:url" content="https://pasify.es/" />
<meta property="og:image" content="https://pasify.es/og/og-default.jpg" />
<meta property="og:locale" content="es_ES" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:site" content="@pasify_es" />
```

Las páginas dinámicas (eventos) deben sobreescribir `og:title`, `og:image`
y `og:url` con datos del evento. Pendiente: SSR/SSG para que crawlers no
JS-capable indexen contenido dinámico.

---

## 5. Estructura de URLs (post-HashRouter)

Pasify usa HashRouter (`/#/calendar`) que **no se indexa bien**. Para SEO:

- Las rutas críticas (landing, eventos populares) deberían exponerse
  como rutas sin hash mediante rewrite en `vercel.json` cuando el flujo
  móvil/PWA esté estable.
- Mientras tanto, el sitemap apunta a `https://pasify.es/calendar` y
  `vercel.json` ya tiene rewrites que sirven `index.html` para que el
  HashRouter tome control en el cliente.

---

## 6. Keywords objetivo

**Tier 1 (alta intent)**:
- `tickets discoteca <ciudad>`
- `entradas <local> ibiza|barcelona|madrid|valencia`
- `comprar entrada festival <nombre>`
- `lista vip <local>`
- `reservar mesa <local>`

**Tier 2 (descubrimiento)**:
- `app eventos noche españa`
- `tickets sin papel`
- `discoteca tonight`
- `donde salir esta noche <ciudad>`

**Tier 3 (B2B partner acquisition)**:
- `software ticketing discoteca`
- `tpv cashless evento`
- `stripe connect tickets`

---

## 7. Redes sociales y consistencia de handle

Reservar y poblar:

- Instagram: `@pasify_es`
- TikTok: `@pasify`
- X / Twitter: `@pasify_es`
- LinkedIn: company page `Pasify`

Link en bio: `pasify.es`.

---

## 8. KPIs SEO mensuales

Reportar a admin dashboard una vez al mes:

- **Search impressions** total (GSC)
- **CTR** medio
- **Posición media** para keywords Tier 1
- **Páginas con mejor performance** (top 10)
- **Errores de crawl** detectados
- **Nuevos enlaces entrantes**

---

## 9. Pendientes inmediatos (cutover Pasify)

- [ ] Crear cuenta GSC y verificar dominio `pasify.es`
- [ ] Crear cuenta Bing Webmaster
- [ ] Reservar handles en Instagram/TikTok/X/LinkedIn
- [ ] Crear imágenes OG default y por ciudad (`public/og/`)
- [ ] Implementar SSR/SSG selectivo para rutas críticas (Vercel Edge)
- [ ] Migrar 301 redirects desde `studentslife.es` → `pasify.es` (cuando
  el dominio legacy expire o quieras transferir tráfico)

---

## 10. Notas internas

- El old SEO playbook (Students Life, descuentos universitarios) está
  obsoleto. No reusar sus keywords ni audiences.
- El target de Pasify es **B2C tickets + B2B partners** — dos funnels
  separados, dos sitemaps en futuro si el contenido lo justifica.
- Cuando cambies un keyword o ranking, anota el delta + commit hash en
  este doc.
