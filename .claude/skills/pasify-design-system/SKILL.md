---
name: pasify-design-system
description: Apply Pasify's design tokens, typography, components, and brand voice when creating or editing any UI in the Pasify project (HTML/CSS/JS). Use this whenever the user asks to add a component, build a section, style something "in Pasify style", create cards, buttons, badges, hero blocks, panels, inputs, or any UI element — even if they don't say "design system". Also triggers on "usa los tokens", "estiliza", "que se vea Pasify", "mantén el estilo", "in keeping with the brand". The Pasify project has TWO modes (light beige and dark ink) sharing the same terracota accent — this skill ensures Claude picks the right mode and uses canonical tokens from the source files instead of inventing colors or fonts.
---

# Pasify Design System

Pasify is a static HTML site with a fully defined design system. **Never invent colors, fonts, spacing, or component shapes** — always use the canonical tokens already in the codebase.

## Two modes, one brand

The site has two coexisting modes that share the same accent (terracota `#E8542A`), typography (Geist + Instrument Serif + Geist Mono), and voice:

| Mode | When to use | Canonical source |
| --- | --- | --- |
| **Light** (beige `#F4EEE2` base, ink `#1A1714` text) | Marketing hero, design system reference, public-facing editorial pages, brand documentation | `design-system.html` (inline `<style>` at the top) |
| **Dark** (`#0B0908` base, cream `#F4EEE2` text) | All product pages, subpages under `soluciones/`, `sectores/`, `recursos/`, `nosotros/`, `operacion/`, the home `pasify.html` | `soluciones/_shared.css` (and equivalents in other section folders) |

**Before writing any CSS**, read the canonical source for the mode you're working in. The tokens there are authoritative — don't duplicate or paraphrase them inline.

## Detecting the mode

If the user asks for a new section/component and doesn't specify, decide based on context:

- File lives in `soluciones/`, `sectores/`, `recursos/`, `nosotros/`, `operacion/`, `data/`, or is part of `pasify.html`/its sub-experience → **dark**.
- File is `design-system.html` or a brand/style doc → **light**.
- Greenfield demo or one-off exploration → ask the user briefly which mode, defaulting to **dark** (it's the production lane).

## The non-negotiable tokens (both modes)

These never change:

- **Accent terracota:** `#E8542A` — CTAs, logo dot, the "y" swash, focus rings, hot states.
- **Accent deep:** `#B8381A` — hover/pressed on terracota.
- **Fonts:** `Geist` (UI/body, weights 300–700), `Instrument Serif italic` (editorial accents — 1–2 uses per page max, never for body), `Geist Mono` (eyebrows, prices, timestamps, codes, labels).
- **Logo lockup:** `<span>Pas</span><span class="dot"></span><span>if</span><span class="y">y</span>` (or `.y-swash` in light mode). The dot is terracota, the "y" is Instrument Serif italic terracota.
- **Letter-spacing:** Display headings always tight — `-0.035em` for H1, `-0.028em` for H2, `-0.02em` for H3.
- **Border radii:** 8px (small chips), 10–12px (inputs/buttons), 14–18px (cards/panels), 24px (hero blocks).
- **Grain texture:** SVG fractal noise overlay. In dark mode it's `mix-blend-mode:overlay` at 0.4 opacity; in light it's `multiply` at 0.5. The exact SVG data URI is in both source files — copy it, don't regenerate.

## Component primitives (use these, don't reinvent)

When you need a component, first check if it already exists by name in the canonical source. The taxonomy:

- **Buttons:** `.btn` + `.btn-primary` (terracota), `.btn-ink` (ink), `.btn-outline`, `.btn-ghost`. Always include `.arrow` span on CTAs that lead somewhere — it animates on hover.
- **Badges:** `.badge` + `.hot`, `.last`, `.free`, `.closed`, `.vip`, `.warm`. Geist Mono, 11px, uppercase, pill-shaped. Never use emoji as decoration except the `★` in `.hot`.
- **Cards:** Event cards (`.ev-card` in light, equivalent in dark) use 4:5 aspect image, full-bleed top, info below, hover lifts 3px with terracota shadow.
- **Panels:** `.panel`, `.panel.tinted` (coral background), `.panel.deep` (ink background). For section blocks of content.
- **Hero:** Multi-radial gradient background + grain overlay + meta pulse + eyebrow + display H1 with one `.highlight` (yellow/terracota underline) or one `<em>` in Instrument Serif. See `design-system.html` `.hero` block.
- **Inputs:** `.input`, with `.input-wrap` + `<label>`. Focus state is `border-color:var(--accent)` + `box-shadow:0 0 0 4px rgba(232,84,42,.15)`.
- **Eyebrow label:** `.eyebrow` — Geist Mono 11px, `.18em` letter-spacing, uppercase, `--accent-deep` color. Often paired with a numeric prefix `<span class="num">01 / </span>` for sectioning.
- **Editorial divider:** `<hr class="editorial">` with `*  *  *` content.

## Voice & copy

If you write copy, follow Pasify's voice — it's documented inline in `design-system.html` section 01:

- Speak as **tú**, never **usted**.
- Cálida, confiada, con criterio. Premium pero no fría.
- **Decimos:** "Pasa adentro." · "Domina la noche." · "Cero fila. Cero fricción." · "Sin papel, sin drama."
- **Nunca decimos:** "Solución innovadora" · "Empoderamos negocios" · "Sinergia 360°" · "Revolucionamos el sector". If you catch yourself writing buzzwords, rewrite.
- The tagline is **"El pase a tu mejor noche."** — uses the double sense of "pase" (access + step inside).

## Workflow when the user asks for a new component or section

1. **Read** the canonical source for the active mode (`design-system.html` or `soluciones/_shared.css`).
2. **Check** if a primitive already exists. If yes, compose with it. If no, add it to the shared CSS — don't inline duplicate styles in a one-off page.
3. **Match the mode's contrast philosophy.** Light mode uses warm beige + cream cards on top. Dark mode uses ink with subtle gradient panels (`linear-gradient(160deg,#1A0F08,#3D1F12)` is the canonical "tinted card" gradient in dark) and `--accent-soft` glows.
4. **Write the markup.** Use the Pasify HTML idiom: classes carry the design intent, inline styles only for one-off positional tweaks (like grid-column spans). Don't over-class.
5. **Verify the voice** if you wrote copy. Re-read it through the "decimos / no decimos" filter.

## Anti-patterns

- ❌ Hard-coding `#fff` for text on dark — use `var(--ink)` (cream).
- ❌ Hard-coding `#000` anywhere — Pasify never uses pure black; the deepest tone is `#0B0908` or `#1A1714`.
- ❌ Adding new fonts. The trinity is fixed.
- ❌ Using Instrument Serif for body text. It's an italic editorial accent, never paragraph type.
- ❌ Using emojis as content (only `★` in `.badge.hot` is sanctioned).
- ❌ Adding shadows in pure gray. Pasify shadows are warm: `rgba(232,84,42,.22)` lift, `rgba(184,56,26,.18)` hero, `rgba(26,23,20,.12)` card.
- ❌ Inventing border-radii outside the 8/10/12/14/18/24 ladder.
- ❌ Mixing modes on the same page (e.g. light card on dark background, or vice versa) without explicit reason.

## When in doubt

Open `design-system.html` in the browser (it's served at `/design-system.html` when the user runs the local server) and copy the pattern. The doc IS the source of truth for the light system. For dark, `pasify.html` is the source of truth.
