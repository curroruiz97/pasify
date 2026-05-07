---
name: pasify-accessibility
description: Audit and fix accessibility issues in Pasify pages — color contrast on the dark/cream theme, focus rings that survive the warm palette, ARIA labels for the megamenu and icon-only buttons, keyboard navigation through nav and forms, prefers-reduced-motion, semantic HTML, screen-reader landmarks — without breaking the editorial visual style. Use this whenever the user says "accesibilidad", "a11y", "lighthouse", "contraste", "WCAG", "lector de pantalla", "screen reader", "navegación por teclado", "keyboard nav", "tab order", "aria", "alt text", "focus", "audit accessibility", "hazlo accesible", or asks to fix issues from a Lighthouse/axe report. Also triggers when the user mentions specific failures (e.g. "el menú no se abre con teclado", "el grain interfiere con el lector"). The Pasify dark theme has specific contrast risks (terracota on dark, cream-on-cream-card, ink-3 secondary text) — this skill ensures fixes pick the right tokens to keep AA compliance without flattening the brand.
---

# Pasify Accessibility

The Pasify aesthetic — warm palette, mono labels, italic accents, glassmorphic megamenu — has accessibility traps that gray-on-white sites don't. This skill walks through the checks, the Pasify-specific risk areas, and the fixes that don't break the brand.

## The non-negotiable checks (in order)

1. **Color contrast** at 4.5:1 (normal text) and 3:1 (large text 18pt+ / 14pt+ bold) per WCAG AA.
2. **Visible focus indicator** on every interactive element.
3. **Keyboard reach** — every interactive control reachable via Tab, escapable via Esc, activatable via Space/Enter.
4. **ARIA landmarks** — `<header>`, `<nav>`, `<main>`, `<footer>` semantic. Megamenu has `aria-expanded`, `aria-controls`, `role="menu"` where appropriate.
5. **Image alt text** — descriptive for content images, `alt=""` for decorative.
6. **Form labels** — every input has a `<label for>` or `aria-label`.
7. **Reduced motion** — animations respect `prefers-reduced-motion: reduce`.
8. **Heading order** — exactly one H1 per page, then logical H2 → H3 nesting.

## Pasify-specific contrast risks

The brand palette has ratios you need to know cold. Here are the canonical ones:

### Dark mode (bg `#0B0908`, ink `#F4EEE2`)
| Pair | Ratio | Status | Use for |
| --- | --- | --- | --- |
| `--ink` (#F4EEE2) on `--bg` (#0B0908) | 16.4:1 | ✅ AAA | Body text, headings |
| `--ink-2` (#C9BFA8) on `--bg` | 10.4:1 | ✅ AAA | Secondary body |
| `--ink-3` (#8A8275) on `--bg` | 4.8:1 | ✅ AA | Captions, meta — but NOT for body or links |
| `--ink-4` (#5C544A) on `--bg` | 2.4:1 | ❌ FAIL | Decorative only — never for any text the user must read |
| `--accent` (#E8542A) on `--bg` | 4.7:1 | ✅ AA | Eyebrows, link accents — borderline, watch for small sizes |
| `--accent` on `--bg-2` (#13100E) | 4.4:1 | ⚠️ Borderline | Use 16px+ only |

### Light mode (bg `#F4EEE2`, text `#1A1714`)
| Pair | Ratio | Status | Use for |
| --- | --- | --- | --- |
| `--text-primary` (#1A1714) on `--bg-base` | 16.7:1 | ✅ AAA | Body |
| `--text-secondary` (#5C544A) on `--bg-base` | 6.9:1 | ✅ AA | Lede, secondary copy |
| `--text-tertiary` (#8A8275) on `--bg-base` | 3.4:1 | ⚠️ Large only | Eyebrows (mono uppercase 11–12px ARE small — use --accent-deep instead) |
| `--accent-deep` (#B8381A) on `--bg-base` | 5.1:1 | ✅ AA | Eyebrows, links |
| `--accent` (#E8542A) on `--bg-base` | 3.6:1 | ❌ FAIL for text | Use only for solid CTAs (white text on accent), not for accent text |
| White on `--accent` | 4.6:1 | ✅ AA | Button labels |

**Rule of thumb:**
- For small text, prefer `--accent-deep` (light) or `--accent` (dark).
- Never use `--ink-4` for anything the user reads.
- The grain overlay reduces effective contrast by ~5%. If you're already borderline, drop the grain on that element or test with the grain rendered.

## Focus rings on the warm palette

Default browser focus is bright blue — clashes with terracota and beige. Pasify must define its own ring everywhere.

```css
*:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
  border-radius: 4px;
}

/* For dark backgrounds, increase contrast with double ring */
.header *:focus-visible,
.mega *:focus-visible {
  outline: 2px solid var(--ink);
  outline-offset: 3px;
  box-shadow: 0 0 0 5px rgba(232,84,42,.4);
}

/* Inputs already have a focus state — make sure box-shadow is the focus indicator */
.input:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 4px rgba(232,84,42,.25);  /* bumped from .15 to .25 for visibility */
}
```

Use `:focus-visible`, not `:focus` — that way mouse clicks don't show the ring (cleaner) but keyboard does.

## Megamenu keyboard behavior (the trickiest piece)

The megamenu is the most a11y-sensitive component. Required behavior:

- **Tab** moves focus into the nav-trigger buttons.
- **Enter / Space** on a `nav-trigger` opens that megamenu panel.
- **Down Arrow** when a panel is open moves into the first link.
- **Arrow keys** within the panel move between links (optional but nice).
- **Esc** closes the open panel and returns focus to the trigger.
- **Tab past the trigger** when panel is open: closes the panel and moves to the next nav item OR moves focus into the panel content (pick one consistently — recommend: Tab moves into panel, Shift+Tab leaves it).
- **Click outside or focus loss** closes the panel.

ARIA on each `nav-trigger`:
```html
<button class="nav-trigger" type="button"
        data-key="soluciones"
        aria-expanded="false"
        aria-controls="mega-soluciones"
        aria-haspopup="true">
  Soluciones <svg>...</svg>
</button>
```

And on the panel:
```html
<div id="mega-soluciones" class="mega-wrap" role="region" aria-label="Soluciones">
  ...
</div>
```

`aria-expanded` flips to `true` when open. The script in `_header.js` should toggle this — currently it likely only toggles classes, so this is often a fix you'll need to make.

## Burger button

The mobile burger needs:
```html
<button class="burger" type="button" aria-label="Abrir menú" aria-expanded="false" aria-controls="mobile-nav">
  <svg ...>...</svg>
</button>
```

When the drawer is open, flip `aria-label` to "Cerrar menú" and `aria-expanded` to `true`.

## Reduced motion

Pasify has these animations: pulse on status dot, hover lifts on cards, megamenu slide, button arrow translate, page-load fade. ALL should be wrapped:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Add this once at the bottom of `_shared.css` — it's a global escape hatch. The `0.01ms` (vs `0`) is intentional: it preserves transition completion events for any JS that listens to them.

## Image alt text

- **Content images** (event posters, sector photos, team headshots): `alt="describe the image and its purpose"`. E.g. `alt="Crowd at Mondo Disko, Madrid, 2024"`.
- **Decorative** (grain, gradient blobs, the .pulse dot): `aria-hidden="true"` or `alt=""` if it's an `<img>`.
- **Logo**: `aria-label="Pasify"` on the wrapping `<a>`, NOT on each span. Inner `.dot` and `.y` get `aria-hidden`.
- **Icon-only buttons** (close X, search): always `aria-label`.

## Form labels

Every `<input>` must have a programmatically-associated label. Pasify uses `.input-wrap > label > input` pattern which is fine if the label is a sibling with a `for` attribute:

```html
<div class="input-wrap">
  <label for="evt-name">Nombre del evento</label>
  <input class="input" id="evt-name" name="event_name" type="text">
</div>
```

If the design demands a label-less input (e.g. a search bar with placeholder only), use `aria-label` instead — but never rely on placeholder alone, it disappears on input.

## Heading hierarchy

Each page: exactly **one H1** (in the hero). Section heads are H2. Card titles inside sections are H3. Don't skip levels (H2 → H4 is wrong even if H4 looks visually right; restyle the H3 instead).

## Skip-to-content link

Every page should have:
```html
<a href="#main" class="skip-to-content">Saltar al contenido</a>
```
With CSS that hides it visually until focused:
```css
.skip-to-content {
  position: absolute;
  top: -40px;
  left: 12px;
  padding: 10px 16px;
  background: var(--accent);
  color: #fff;
  border-radius: 8px;
  font-size: 14px;
  z-index: 9999;
}
.skip-to-content:focus {
  top: 12px;
}
```

And the main content needs `id="main"`.

## Workflow when auditing

1. **Run a baseline scan.** Either:
   - Open the page in the local server and run Lighthouse (Accessibility category) in Chrome devtools.
   - Or use `axe-core` via the browser extension if installed.
2. **Categorize findings** into: contrast, focus, keyboard, ARIA, alt, labels, motion, structure.
3. **Fix in `_shared.css` (global) before fixing in individual pages.** Most contrast/focus/motion fixes belong in the shared stylesheet — fixing them once propagates everywhere.
4. **Test keyboard manually.** Tab through the entire page. Open and close the megamenu with keys only. Submit a form. Anything you can't reach is a bug.
5. **Re-run the scan.** Confirm the score improves and no regressions appeared.
6. **Verify with reduced-motion ON** in OS settings. The page should remain functional, just static.

## Anti-patterns

- ❌ Adding `outline: none` without a replacement focus indicator.
- ❌ Using `--ink-4` or `--text-tertiary` for anything except large captions on light bg.
- ❌ `tabindex="-1"` on interactive elements to "fix" tab order — fix the DOM order instead.
- ❌ `aria-label` that duplicates visible text (just don't add it; the visible text IS the label).
- ❌ Removing animations entirely instead of respecting prefers-reduced-motion. Motion is part of the brand.
- ❌ Replacing `<button>` with `<div onclick>`. Always use real semantic elements.
- ❌ Adding ARIA where semantic HTML would do (don't `role="button"` on a `<button>`).

## When in doubt

Pasify's brand goal is "premium, warm, editorial". Accessibility goal is "everyone can read and use it". These don't conflict — they reinforce each other. A page that's hard to read is not premium. A focus ring that fights the palette is not editorial. If a fix feels like it kills the vibe, the fix is wrong; find the version that does both.
