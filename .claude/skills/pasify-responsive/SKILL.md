---
name: pasify-responsive
description: Make Pasify pages and components work cleanly on mobile and tablet, following the project's existing breakpoint conventions and mobile patterns (burger nav, mega-wrap collapse, fluid clamps, single-column reflow). Use this whenever the user mentions "responsive", "mobile", "móvil", "tablet", "que funcione en el móvil", "se rompe en el móvil", "adapt to mobile", "mobile-first", "breakpoint", "media query", "this overflows", "touch", or asks to fix a layout that breaks at smaller widths. Also triggers when the user uploads a screenshot of broken mobile layout, or describes a hero/grid/megamenu that doesn't reflow. The Pasify site uses a clear breakpoint hierarchy (1024 → 920 → 720 → 480) and specific mobile idioms for the megamenu — this skill ensures Claude reuses those instead of inventing new breakpoints or mobile behaviors that fight the existing CSS.
---

# Pasify Responsive

Pasify is built desktop-first (the design-system.html and pasify.html are large editorial layouts), but every page MUST work on mobile down to 360px. This skill captures the existing responsive conventions so new and edited pages collapse the same way as the rest of the site.

## Breakpoint hierarchy

Pasify uses these breakpoints consistently — don't introduce new ones:

| Breakpoint | What collapses |
| --- | --- |
| `max-width: 1024px` | Megamenu becomes burger nav. Header gap tightens. CTAs may shorten. |
| `max-width: 920px` | Multi-column grids → 1-column. `.hero` padding reduces. Hero meta hides. Form rows stack. |
| `max-width: 720px` | Type scale steps down (clamp() handles most of this automatically). Hero padding shrinks further. Cards become full-width. |
| `max-width: 480px` | Buttons full-width in CTAs row. Crumbs may truncate to last segment. Footer columns stack. |

Most layouts only need the 920px breakpoint thanks to `clamp()` on type and `auto-fit minmax()` on grids. Reach for smaller breakpoints only when something specific breaks.

## The fluid-first toolkit (use these BEFORE adding media queries)

Pasify type and spacing already scale fluidly. Before writing a `@media` rule, ask: can `clamp()` or `auto-fit` solve this?

- **Type:** Use `font-size: clamp(MIN, PREFERRED, MAX)`. Examples in the codebase:
  - H1 hero: `clamp(40px, 6vw, 72px)` (or `clamp(44px, 7vw, 84px)` for the giant brand hero).
  - H2: `clamp(28px, 3.4vw, 42px)`.
  - Section H2: `clamp(36px, 4.4vw, 56px)` for marketing-strong moments.
- **Grids:** Use `grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))` for feature grids — they reflow naturally without media queries.
- **Padding:** Use `padding: clamp(48px, 8vw, 96px) clamp(24px, 4vw, 56px)` for hero blocks.
- **Width caps:** `.wrap { max-width: 1340px; padding: 0 28px }` — keep this. On mobile, the 28px gutter is fine, no need to shrink.

## The megamenu / mobile nav contract

This is the trickiest piece. The desktop nav is a megamenu; mobile is a slide-down panel triggered by a burger button. Both live in `_header.js`. The CSS contract:

```css
@media (max-width: 1024px){
  .nav { display: none; }            /* hide desktop nav links */
  .header .login { display: none; }  /* compress header */
  .burger { display: inline-flex; }  /* show burger */
  .mega-wrap { display: none; }      /* close any open megamenu */
}

@media (max-width: 720px){
  .header .cta { display: none; }    /* hide CTA from header — there are CTAs in body */
  .header-inner { padding: 12px 20px; }
}
```

When you add new nav items, they need to appear in BOTH the desktop megamenu AND the mobile collapsed panel. `_header.js` builds both — make sure your new entry is in both data structures.

## Hero collapse pattern

The two-column hero (text left, gradient card right) collapses at 920px:

```css
@media (max-width: 920px){
  .page-hero .inner { grid-template-columns: 1fr; gap: 32px; }
  .page-hero .right-card { min-height: 240px; }  /* reduce so it doesn't dominate */
  .hero { padding: 48px 28px; }                    /* reduce internal padding */
  .hero .meta { display: none; }                   /* hide live status pulse on mobile */
}
```

The right-side card stacks BELOW the text on mobile. Keep its border-radius and grain; just reduce min-height.

## Stats strip collapse

```css
@media (max-width: 720px){
  .stats { grid-template-columns: repeat(2, 1fr) !important; gap: 20px; }
}
@media (max-width: 480px){
  .stats { grid-template-columns: 1fr !important; }
}
```

Pasify stats strips often use `grid-template-columns: repeat(N, 1fr)` inline. When N > 2, force a 2-up at 720px and 1-up at 480px. The `!important` is acceptable here because the inline style was a layout hint, not a design statement.

## Form rows and inputs

Form rows are 2-column on desktop and stack at 920px:

```css
@media (max-width: 920px){
  .form-row { grid-template-columns: 1fr; }
  .input-wrap[style*="grid-column"] { grid-column: auto !important; }
}
```

Inputs themselves don't need to change — `width:100%` on `.input` handles mobile fine.

## CTAs

On mobile, CTA rows often need to stack so each button hits the 44px touch-target minimum and isn't cramped:

```css
@media (max-width: 480px){
  .ctas { flex-direction: column; align-items: stretch; }
  .ctas .btn { justify-content: center; width: 100%; }
}
```

Never let a button shrink below 44px tall. Pasify default `.btn` is `padding: 13px 20px` which gives ~46px — safe.

## Touch and pointer interactions

- Hover lifts (`transform: translateY(-3px)`) feel weird on touch devices because the hover sticks after tap. Wrap them in `@media (hover: hover)`:

  ```css
  @media (hover: hover) {
    .ev-card:hover { transform: translateY(-3px); box-shadow: ... }
  }
  ```

- For touch, replace hover-only feedback with `:active` press states (`transform: scale(0.98); transition: 100ms`).

## Cards aspect ratios

The 4:5 event card aspect is great on desktop but tall on mobile when the image fills the viewport width. At 480px, you may want to relax to 16:9 or square:

```css
@media (max-width: 480px){
  .ev-card .img { aspect-ratio: 16/10; }
}
```

Or leave 4:5 if it's a single-card per row (still readable). Test before deciding.

## Megamenu drawer (mobile)

When the burger is tapped, the panel slides down. The CSS class is `.menu-open` on the header. The drawer should:
- Fill the viewport width.
- Have a dark glassmorphism background (`rgba(11,9,8,.92)` + `backdrop-filter: blur(24px)`).
- Show ALL sections expanded (no nested "tap to expand" — keep it flat, scrollable).
- Have a tappable close X in the corner.

The pattern is in `_header.js` — don't reinvent.

## Workflow when fixing responsive issues

1. **See the breakage.** Open the page in the local server and use the browser's responsive mode (or resize). Identify exact viewport widths where layout breaks.
2. **Check what's missing.** Is a clamp() type doing its job? Is the grid `auto-fit` or fixed `repeat(N,1fr)`? Is there a `@media (max-width: 920px)` block?
3. **Try fluid first.** If a clamp or auto-fit can fix it without a media query, do that.
4. **Add the media query at the right breakpoint.** Match the hierarchy (1024 / 920 / 720 / 480). Don't introduce 850px or 1100px.
5. **Verify on actual mobile dimensions.** 360 / 375 / 390 (iPhone) and 412 (Pixel) at minimum. Tablet 768 and 820.
6. **Check the megamenu** still opens/closes correctly.
7. **Check that hero meta pulse hides at 920px** — if it doesn't, it overlaps the H1.

## Anti-patterns

- ❌ Adding random breakpoints (768px, 1200px). Stick to 1024 / 920 / 720 / 480.
- ❌ `display: none` to hide content on mobile when you should reflow it. Hiding content costs SEO and accessibility.
- ❌ Using `vw` units for padding without clamping — produces huge gutters on ultrawide.
- ❌ Forcing horizontal scroll on mobile (e.g. tables, wide hero). Either reflow or use a scrollable container with explicit `overflow-x: auto` and a visible scroll affordance.
- ❌ `transform: scale()` to "shrink" a desktop layout. Use proper layout, not zooming.
- ❌ Hover states that stick on touch (test with the device emulator's "touch" mode).

## When you're done

State which breakpoints you touched, what you changed at each, and ask the user to test on their actual device. Browser dev tools are an approximation — they don't have the touch latency or the OS keyboard popping up.
