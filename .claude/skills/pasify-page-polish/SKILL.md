---
name: pasify-page-polish
description: Elevate existing Pasify pages and components from "fine" to "premium AI-startup-quality" using micro-interactions, warm shadows, gradient backgrounds, smooth transitions, and editorial details that match the established Pasify visual language. Use this whenever the user says "pulir", "elevar", "más premium", "mejor diseño", "más vida", "se ve básico", "que se vea mejor", "polish this", "make it pop", "needs more", "elevate this page", "look more professional", or asks to improve the visual quality of any page in the Pasify project. Also triggers on requests for animations, hover effects, glassmorphism, gradients, shimmer, glow, and any visual enhancement on top of an existing layout. This skill is specifically about taking working-but-flat UI and adding the layered details (grain, blurs, radial glows, transition curves, mono labels, pulse dots) that make Pasify feel like a real product, not a template.
---

# Pasify Page Polish

This skill is for raising the visual quality of an existing page or component without changing what it's saying. The page already works; it just feels flat. Polish is the difference between "I built this last weekend" and "this is a real product."

## Mental model: what makes Pasify feel premium

Five layered moves — apply them progressively, not all at once:

1. **Surface depth.** Flat backgrounds are the cheapest tell of templated UI. Pasify uses *radial gradients stacked on each other* + a *grain SVG overlay* on every hero/feature block. The grain is the secret sauce — it kills the "CSS look" and makes surfaces feel like printed matter.

2. **Warm shadows.** Pasify shadows are never gray. They use terracota at low opacity. A card lifting on hover gets `0 22px 50px -18px rgba(232,84,42,.22)`, never `rgba(0,0,0,.1)`. The CTA glow is `0 12px 30px -10px rgba(232,84,42,.65)`. Hero shadow is `0 24px 60px -24px rgba(184,56,26,.18)`.

3. **Editorial labels.** Eyebrows in Geist Mono `.18em` letter-spacing uppercase, often with a numeric prefix `01 /`. A small "pulse" dot animation on live status. Bracket glyphs `[›` and `]` in mono on the wordmark. These tiny mono details signal "designed", not "themed".

4. **Motion that respects the reader.** Pasify animations are slow (200–400ms), eased (`cubic-bezier` not linear), and subtle. Hover lifts are 1–3px max. CTAs translate the arrow `translateX(3px)`. The pulse keyframe is a 2.4s loop. **Never bounce, never spin, never juddery.** Always honor `@media (prefers-reduced-motion: reduce)`.

5. **Italic editorial accent.** Instrument Serif italic appears once or twice per page, in the hero or a pull-quote — never more. It's the "designer was here" gesture. Looks like: `<em>pase</em>` inside a Geist H1.

## The polish checklist

When the user asks you to polish a page, walk through this in order:

### Hero block (always the first impression)
- Replace any solid background with the multi-radial pattern: `radial-gradient(60% 80% at 18% 20%, #FBE4D3 0%, transparent 60%), radial-gradient(45% 70% at 85% 30%, #FFE9C8 0%, transparent 60%), radial-gradient(50% 50% at 70% 90%, #F4DDC8 0%, transparent 60%), linear-gradient(180deg,#F7F3EC 0%, #F4EEE2 100%)` (light) or `linear-gradient(160deg,#1A0F08,#3D1F12)` with a `filter:blur(120px) opacity:.25` accent blob (dark).
- Add the grain overlay (canonical SVG in `design-system.html` and `_shared.css`).
- Add a `.meta` pulse status in the top-right: `<span class="pulse"></span><span>Phase 01 · v0.1</span>` in mono uppercase.
- One `.highlight` underline (skewed terracota bar) OR one Instrument Serif `<em>` — not both.
- Eyebrow above the H1.

### CTAs
- Primary CTA gets an animated `.arrow` that translates 3px on hover.
- Hover lifts the button 1px and deepens the warm shadow.
- Pressed state: opposite — translates down 1px, removes shadow.
- Never use system blue, never use generic gray buttons. The four variants are: `.btn-primary` / `.btn-ink` / `.btn-outline` / `.btn-ghost`.

### Cards
- Default state: 1px border in `--border-subtle` / `--line`, no shadow.
- Hover: lifts 3px, gains terracota shadow `0 22px 50px -18px rgba(232,84,42,.22)`. Transition `.25s ease` on both transform and box-shadow.
- Image cards (events, sectores) use `aspect-ratio: 4/5` (taller than square — premium tell).
- Information hierarchy: mono uppercase venue/category line → display title → row with mono price + accent badge.

### Section transitions
- Editorial divider `<hr class="editorial">` (mono `*  *  *`) between major sections, never plain horizontal rules.
- Section eyebrows numbered `01 /`, `02 /`, etc. — gives the page editorial spine.
- Bottom of a section: subtle border-top in `--line`, never a hard divider.

### Mono accents
- Prices, timestamps, dates, codes, stat numbers → Geist Mono.
- Stat blocks: large mono number + small mono uppercase label below.
- Live data lines (e.g. `23:45 · 14.2K€ · 1.836 entradas · +34%`) in mono — feels like a terminal, fits the brand.

### Glassmorphism (sparingly)
- Sticky header on scroll: `background:rgba(11,9,8,.85);backdrop-filter:blur(20px);border-bottom:1px solid var(--line)`.
- Megamenu panel: `background:rgba(15,13,11,.96);backdrop-filter:blur(24px)`.
- Don't apply blur to body backgrounds or random cards — only to floating overlay surfaces.

### Idle motion (one per page max)
- A `pulse` dot on a "live" indicator (the keyframe is in `design-system.html`).
- Optionally: a slow shimmer on a "loading" / "syncing" badge. Don't add multiple animated elements — one ambient motion is enough.

### Focus states
- Inputs: terracota border + 4px terracota glow at 15% opacity. Never browser-default blue.
- Buttons get a visible focus ring matching their context (light: ink ring, dark: cream ring) + 2px offset.

## Workflow when polishing

1. **Read the page first**, then read the canonical source (`design-system.html` for light, `soluciones/_shared.css` for dark) so you know what primitives exist.
2. **Identify the lowest-hanging fruit.** Usually: missing grain, flat hero background, gray shadows, no eyebrow, no mono accents, hover-less buttons. Fix those first.
3. **Apply changes incrementally and tell the user what you changed.** Don't dump a wall of CSS — name each polish (e.g. "added grain overlay to hero", "swapped gray shadow for warm terracota lift", "added animated arrow on primary CTA").
4. **Verify in the browser.** If a local server is running, navigate to the page. If not, ask the user to spin one up. Static type-checking won't catch a flat hero.
5. **Stop before overdoing it.** Pasify is *editorial premium*, not maximalist. If you've added 4 polishes already and it looks great, ship it. Resist the urge to also add gradient borders, shimmer skeletons, parallax, particles, etc.

## What NOT to add

- ❌ Generic glassmorphism on every card. Glass = floating overlays only.
- ❌ Pulsating CTAs ("call attention" buttons). One pulse per page, on a status dot.
- ❌ Background videos.
- ❌ Cursor trails, magnetic buttons, mouse-following highlights.
- ❌ Gradient text that's not terracota (the only sanctioned text gradient is `--accent` → `--accent-deep`).
- ❌ Border gradients on cards. The Pasify card border is solid `--line`; depth comes from shadow + bg, not from rainbow borders.
- ❌ Multiple Instrument Serif italics per page.
- ❌ Drop shadows in pure black.

## Why these choices

Pasify is the "primo nocturno de Claude" — premium but warm, editorial but not cold. The polish vocabulary mirrors that: warm shadows over cold, restrained motion over flashy, mono details over decoration. When in doubt, ask "would this look at home in the design-system.html?". If the answer is no, it's wrong for this brand.
