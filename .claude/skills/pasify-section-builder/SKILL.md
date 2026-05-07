---
name: pasify-section-builder
description: Scaffold a new subpage in the Pasify project under soluciones/, sectores/, recursos/, nosotros/, operacion/, or data/, reusing the existing _shared.css + _template.js + _header.js infrastructure. Use this whenever the user asks to "crea una nueva página de", "añade una solución/sector/recurso", "nueva subpágina", "monta la página de [X]", "scaffolding para", "create a new page for", "add a section page", or describes a new product feature/sector/resource that needs its own page in the site. Also triggers when the user wants to duplicate-and-adapt one of the existing subpages (e.g. "como entradas.html pero para [X]"). This skill ensures the new page wires correctly into the megamenu (via _header.js), inherits the dark Pasify shell (grain + header injection), uses the canonical hero+stats+features+CTA structure, and links breadcrumbs back to pasify.html — instead of writing a one-off page that drifts from the rest of the site.
---

# Pasify Section Builder

Subpages in Pasify follow a strict, repeatable scaffold. Every page under `soluciones/`, `sectores/`, `recursos/`, `nosotros/`, `operacion/`, or `data/` shares:

- The dark theme tokens from `<folder>/_shared.css` (or root `_shared.css` if at root level).
- The injected sitewide header from `<folder>/_header.js` (auto-renders the megamenu into `<div id="site-header"></div>`).
- A grain overlay `<div class="grain"></div>` as the first child of `<body>`.
- A breadcrumb `nav.crumbs` pattern.
- A hero → stats → features → CTA → footer structure.

**Don't write a subpage from scratch.** Either use the `PASIFY_T()` template factory in `_template.js`, or copy the structure from a sibling page. This skill walks through both paths.

## Two paths

### Path A — Use the `PASIFY_T()` template factory (fastest)

`soluciones/_template.js` exports `window.PASIFY_T(cfg)` which returns the full HTML string. The config shape is:

```js
{
  title: "Entradas",                              // <title> and breadcrumb leaf
  slug: "entradas",                               // body[data-current] for active nav highlight
  section: "Soluciones",                          // breadcrumb middle link text
  eyebrow: "Ticketing core",                      // small terracota label above H1
  h1: "Vende entradas como te dé la gana.",       // hero H1 (the only place to use Instrument Serif <em>)
  lede: "Una sola URL. Saltos de precio automáticos. Aforo en tiempo real.",
  cardLabel: "Live · sin fricción",
  cardTitle: "Tu link, tu venta, tu data.",
  cardCopy: "Comparte el evento por WhatsApp y empieza a cobrar en 90 segundos.",
  cardChips: ["Stripe", "Bizum", "QR scan", "Apple Wallet"],
  stats: [
    { num: "23s", lab: "tiempo medio de checkout" },
    { num: "+34%", lab: "vs. competencia legacy" },
    { num: "0%", lab: "comisión a tu cliente" }
  ],
  featureH2: "Lo que ya está dentro.",
  features: [
    { h: "Saltos de precio", p: "Configura early bird, late entry y precios por franja sin abrir Excel." },
    { h: "Aforo vivo", p: "Cierra venta automáticamente cuando llegues al límite. Sin sustos." },
    // ... 3-6 features ideal
  ],
  ctaH: "El primer evento gratis. Después tú decides.",
  ctaP: "Sin contrato, sin alta, sin tarjeta para empezar.",
  ctaBullets: [
    "Onboarding en 15 minutos con un humano de Pasify.",
    "Migración de tu base de clientes desde Eventbrite o Fourvenues.",
    "Soporte por WhatsApp dentro del horario que vendes (incluido viernes 03:00)."
  ]
}
```

Then a one-liner page becomes:
```html
<script src="_template.js"></script>
<script>document.write(PASIFY_T({...config...}));</script>
```

But the existing pages (`entradas.html`, `vip.html`, etc.) inline the rendered HTML directly — that's fine and probably preferable for SEO and direct viewing. **Use the template as a reference for structure, then write the HTML inline.**

### Path B — Copy a sibling page and adapt

When the user says "como X pero para Y", the cleanest move is:
1. `Read` the sibling (e.g. `soluciones/entradas.html`).
2. Identify the swap surface: title, breadcrumb leaf, hero copy, stats, features, CTA copy.
3. Rewrite ONLY those — keep the structure, classes, and inline styles untouched.
4. Update `body[data-current]` to the new slug.

Both paths produce the same canonical structure. Use B if a sibling is closer in tone to the new page; use A if you're inventing something genuinely new.

## The required scaffold (every subpage MUST have)

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>[Page title] · Pasify</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="_shared.css">
</head>
<body data-current="[slug]">
  <div class="grain"></div>
  <div id="site-header"></div>
  <main>
    <div class="wrap">
      <nav class="crumbs">
        <a href="../pasify.html">Inicio</a>
        <span class="sep">/</span>
        <a href="../pasify.html#productos">[Section]</a>
        <span class="sep">/</span>
        <span class="here">[Page title]</span>
      </nav>
      <!-- hero -->
      <!-- stats strip -->
      <!-- features grid -->
      <!-- CTA block -->
    </div>
  </main>
  <footer><!-- standard footer --></footer>
  <script src="_header.js"></script>
</body>
</html>
```

Critical bits:

- **`body[data-current="[slug]"]`** drives the active state in the megamenu. The slug must match the `data-key` used in `_header.js` for that nav item, or the link will appear inactive.
- **`<div class="grain"></div>`** must be the first child of body, before the header injection target.
- **`<div id="site-header"></div>`** is where `_header.js` injects the megamenu.
- **`<script src="_header.js"></script>`** at the end of body, no `defer` — the script auto-detects depth from the URL path.
- **Path prefix:** `_header.js` figures out `../` automatically by detecting subfolder names. Don't hard-code `../` in the header script — it handles that itself.

## Wiring into the megamenu

If the new page is a *new entry* in the megamenu (not a replacement for an existing one), you need to edit `_header.js` (the file in the section folder; there's a copy per folder for resilience but they should stay in sync). Find the relevant `data-menu="[section]"` block and add a new mega-link.

If the page is just a new article/sub-item *inside* an existing megamenu section (e.g. a new resource under "Recursos"), you might also want to add it to the listing on `pasify.html` and the resource hub if one exists.

**Always ask the user** before editing `_header.js` — they may want to keep the page unlinked (e.g. as a draft) until ready.

## Hero variants

The default hero is the two-column "left = text+CTAs, right = gradient card with chips". Some pages may want:
- **Single-column hero** — when the page is more editorial (manifesto, about). Drop the right card, center-align text, keep eyebrow + H1 + lede + CTAs.
- **Hero with media** — for case studies. Replace the right gradient card with an `<img>` or video, keep the same border/radius/padding.
- **Hero with metric** — for landing pages. Replace right card with a single big mono number + label (e.g. `+34%` over `vs. competencia`).

Pick based on intent. Default to the standard two-column unless there's a clear editorial reason.

## Workflow

1. **Confirm intent** with the user: which folder (soluciones / sectores / recursos / nosotros / operacion / data), what's the page about, and is it net-new or a replacement.
2. **Read** `_shared.css` and one neighboring page to absorb the local conventions.
3. **Choose Path A or Path B** based on similarity to existing pages.
4. **Write the page** inline (don't leave `document.write` in production — render the HTML directly).
5. **Update `body[data-current]`** to the new slug.
6. **If linking from the megamenu**, edit `_header.js` and confirm with the user first.
7. **Open the page in the running local server** to verify the header injects, the grain renders, the hover states work, and the breadcrumb resolves correctly.
8. **Verify the breadcrumb path** works — `../pasify.html` from a sub-folder, `pasify.html` from root.

## Common pitfalls

- ❌ Forgetting `data-current` → nav looks dead, no active highlight.
- ❌ Putting `<script src="_header.js">` in `<head>` with no `defer` → script runs before DOM exists, header doesn't inject.
- ❌ Hard-coding `/soluciones/foo.html` paths → breaks when served from a non-root subdirectory.
- ❌ Using a different `--accent` or font-stack than `_shared.css` → page looks "off-brand" even if all other tokens match.
- ❌ Skipping the grain → page looks flat, breaks visual continuity with the rest of the site.
- ❌ Writing the hero copy in formal "usted" Spanish → off-voice. Pasify speaks tú.
