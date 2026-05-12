---
name: pasify-app-states
description: Interaction states, micro-animations, loading patterns and feedback UI in Pasify style. Use this when working on hover/focus/active/disabled states, loading skeletons, empty states, error UI, toast notifications, transitions or any motion. Also triggers when the user says "el hover se siente raro", "las animaciones son muy bruscas", "el focus es feo", "ponle el ease de Pasify", or "esto se siente Material/Bootstrap". This skill specifies WHEN and HOW to apply Pasify's signature easing curve and timing. It does NOT cover component shapes (that's pasify-app-components).
---

# Pasify App States — Motion & Feedback

The single biggest difference between a Pasify-looking app and a Material/Bootstrap-looking app is **motion**. Material is snappy and rectangular; Pasify is springy, eased-out, and warm. This skill nails the motion side.

## The signature curve

Pasify uses **`cubic-bezier(0.16, 1, 0.3, 1)`** (ease-out-expo) for almost every transition with visible motion. Memorize this curve.

Why this one:
- Starts fast — feedback is immediate
- Decelerates strongly — the end feels luxurious, not mechanical
- Never overshoots — it's an ease-out, not a spring

When NOT to use it:
- Linear opacity fades (use `ease` instead)
- Loading shimmers (use `ease-in-out` for the back-and-forth)
- Crossfades between two equivalent states (use `ease`)

## Timing reference

| Interaction | Duration | Easing |
| --- | --- | --- |
| Button hover (color/transform) | 150-200 ms | cubic-bezier(0.16, 1, 0.3, 1) |
| Button active (press) | 80-120 ms | linear or ease-out |
| Input focus glow | 200-250 ms | ease |
| Card hover (lift + border) | 250 ms | cubic-bezier(0.16, 1, 0.3, 1) |
| Modal enter/exit | 300-350 ms | cubic-bezier(0.16, 1, 0.3, 1) |
| Drawer slide | 300 ms | cubic-bezier(0.16, 1, 0.3, 1) |
| Toast enter | 350 ms | cubic-bezier(0.16, 1, 0.3, 1) |
| Toast exit | 200 ms | ease |
| Tab/route change | 250 ms | ease (subtle fade) |
| Dropdown open | 200 ms | cubic-bezier(0.16, 1, 0.3, 1) |
| Tooltip show | 150 ms (delay 400 ms) | ease |
| Search dock expand | 350 ms | cubic-bezier(0.16, 1, 0.3, 1) |
| Skeleton shimmer | 1.4 s loop | ease-in-out |

## Hover

Three hover archetypes:

### Lift (cards, related items)

```css
.card {
  transition: transform .25s cubic-bezier(0.16, 1, 0.3, 1),
              border-color .2s ease,
              background .2s ease;
}
.card:hover {
  transform: translateY(-3px);
  border-color: var(--line-2);
  background: var(--bg-3); /* optional bg shift on cards that are clickable */
}
```

Don't translate by more than 4 px. Don't add box-shadow on hover unless the card already had one — adding a shadow on hover creates visual jitter.

### Tint (buttons, list items, table rows)

```css
.row {
  transition: background .15s ease, color .15s ease;
}
.row:hover {
  background: rgba(244,238,226,.04); /* cream at 4% */
  color: var(--ink);
}

.item--active-friendly {
  background: rgba(232,84,42,.06); /* terracota at 6% for hot items */
}
```

### Underline (links)

```css
.link {
  position: relative;
  color: var(--accent);
}
.link::after {
  content: ""; position: absolute;
  left: 0; right: 0; bottom: -2px;
  height: 1px;
  background: var(--accent);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform .25s cubic-bezier(0.16, 1, 0.3, 1);
}
.link:hover::after { transform: scaleX(1); }
```

## Focus

**Never use the browser default focus ring.** Always replace with the Pasify glow.

```css
*:focus-visible {
  outline: none;
  box-shadow: 0 0 0 4px rgba(232,84,42,.18);
  border-color: var(--accent);
  transition: box-shadow .2s ease, border-color .2s ease;
}
```

For elements that don't have a border to colorize (e.g., buttons, links), use the box-shadow alone:

```css
.btn:focus-visible { box-shadow: 0 0 0 4px rgba(232,84,42,.25); }
```

**Use `:focus-visible`, not `:focus`** — this restricts the glow to keyboard navigation, not mouse clicks (which is what users expect).

## Active / pressed

For buttons:

```css
.btn:active {
  transform: translateY(0);  /* cancel the hover lift */
  filter: brightness(.96);   /* subtle darken */
  transition-duration: .08s;
}
.btn-primary:active {
  box-shadow: inset 0 2px 4px rgba(80,20,5,.18), 0 4px 10px -4px rgba(0,0,0,.2);
}
```

The pressed state should be barely visible — it just confirms the click registered. Avoid heavy color changes.

## Disabled

```css
.btn:disabled, .input:disabled, .checkbox:disabled, .switch[aria-disabled="true"] {
  opacity: .5;
  cursor: not-allowed;
  pointer-events: none;
}
```

Don't restyle disabled with a different color palette. Just lower opacity. Pointer-events: none prevents tooltips/hovers from firing.

For form inputs, also set `background: var(--bg)` (one level darker) and `color: var(--ink-3)`.

## Loading

### Inline loading (button)

When clicking a button triggers a request:

```html
<button class="btn btn-primary" disabled aria-busy="true">
  <span class="spinner"></span>
  Guardando…
</button>
```

```css
.spinner {
  width: 14px; height: 14px;
  border: 1.5px solid rgba(255,255,255,.3);
  border-top-color: #fff;
  border-radius: 999px;
  animation: pasify-spin .8s linear infinite;
}
@keyframes pasify-spin {
  to { transform: rotate(360deg); }
}
```

**Use spinners only for short waits (< 2 s)**. For longer loads, use skeleton placeholders.

### Skeleton loaders

The default for >1 s waits. Mirror the actual content layout:

```html
<!-- While fetching the list -->
<div class="card">
  <div class="skeleton skeleton--title"></div>
  <div class="skeleton skeleton--text"></div>
  <div class="skeleton skeleton--text" style="width:80%"></div>
</div>
```

```css
@keyframes pasify-shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position:  200% 0; }
}
.skeleton {
  background: linear-gradient(90deg, var(--bg-2) 0%, var(--bg-3) 50%, var(--bg-2) 100%);
  background-size: 200% 100%;
  animation: pasify-shimmer 1.4s ease-in-out infinite;
  border-radius: 6px;
}
.skeleton--title { height: 20px; width: 60%; margin-bottom: 14px; }
.skeleton--text  { height: 12px; margin-bottom: 8px; }
.skeleton--card  { height: 120px; border-radius: 14px; }
.skeleton--avatar { width: 36px; height: 36px; border-radius: 999px; }
```

### Progress bar (long determinate operations)

```css
.progress {
  width: 100%; height: 4px;
  background: var(--line);
  border-radius: 999px;
  overflow: hidden;
}
.progress .bar {
  height: 100%;
  background: var(--accent);
  border-radius: 999px;
  transition: width .35s cubic-bezier(0.16, 1, 0.3, 1);
}
```

## Empty states

When a list/view has zero items, **never show a blank screen**. Show:

- A small icon in a 56 px terracota-tinted square
- A 1-line title ("Aún no hay X")
- A 1-2 line description with the next step
- A CTA button to take that step

Pattern available in pasify-app-components.

## Error states

### Form-level error

When the user submits and the request fails:

```html
<div class="alert alert--error">
  <svg class="icon" .../>
  <div>
    <div class="alert-title">No se ha podido guardar</div>
    <div class="alert-desc">Inténtalo de nuevo en unos segundos. Si persiste, escríbenos a soporte@pasify.com.</div>
  </div>
</div>
```

```css
.alert {
  display: flex; gap: 12px; align-items: flex-start;
  padding: 14px 16px;
  background: rgba(232,84,42,.06);
  border: 1px solid rgba(232,84,42,.25);
  border-left: 3px solid var(--accent);
  border-radius: 10px;
}
.alert .icon { width: 18px; height: 18px; color: var(--accent); flex-shrink: 0; margin-top: 2px; }
.alert-title { font-size: 13.5px; font-weight: 600; color: var(--ink); line-height: 1.4; }
.alert-desc  { font-size: 12.5px; color: var(--ink-2); margin-top: 4px; line-height: 1.5; }

.alert--success { background: rgba(77,184,122,.06); border-color: rgba(77,184,122,.25); border-left-color: var(--success); }
.alert--success .icon { color: var(--success); }
.alert--info    { background: rgba(122,208,216,.06); border-color: rgba(122,208,216,.25); border-left-color: var(--info); }
.alert--info .icon { color: var(--info); }
```

### Field-level error

Inline below the input, see pasify-app-components form section.

### Error boundary (entire view crashed)

Full-page state with the empty-state pattern but with the warning icon, "Algo se ha roto" title, and a "Recargar" button.

## Toasts / snackbars

Use sparingly. Confirm critical actions and surface errors that need attention.

- Position: bottom-right (16 px margin), stacking upward
- Auto-dismiss: 4 s for success, 6 s for info, persistent for errors until clicked
- Max 3 visible — extras queue
- Enter: slide-in from right + fade
- Exit: slide-out to right + fade (faster, 200 ms)

```css
.toast {
  /* shell — see pasify-app-components */
  animation: pasify-toast-in .35s cubic-bezier(0.16, 1, 0.3, 1) both;
}
.toast.dismissing {
  animation: pasify-toast-out .2s ease both;
}
@keyframes pasify-toast-in {
  from { transform: translateX(110%); opacity: 0; }
  to   { transform: translateX(0);    opacity: 1; }
}
@keyframes pasify-toast-out {
  to { transform: translateX(110%); opacity: 0; }
}
```

## Reveal on scroll (for marketing-ish app screens)

Pasify uses a subtle fade-up reveal on scroll. Don't apply on dashboards or data-heavy UIs — only on landing-style pages embedded in the app (onboarding, success screens, marketing dialogs).

```css
.reveal {
  opacity: 0;
  transform: translateY(20px);
  transition: opacity .8s ease, transform .8s cubic-bezier(0.16, 1, 0.3, 1);
}
.reveal.in {
  opacity: 1;
  transform: translateY(0);
}
```

```js
const io = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
}, { threshold: .12, rootMargin: '0px 0px -60px 0px' });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));
```

## Modal / dialog motion

```css
.modal-backdrop {
  opacity: 0;
  transition: opacity .25s ease;
}
.modal-backdrop.open { opacity: 1; }

.modal {
  opacity: 0;
  transform: translate(-50%, -48%) scale(.96);
  transition: opacity .25s ease, transform .35s cubic-bezier(0.16, 1, 0.3, 1);
}
.modal.open {
  opacity: 1;
  transform: translate(-50%, -50%) scale(1);
}
```

Exit: same in reverse, 200 ms each.

## Drawer motion

```css
.drawer {
  transform: translateX(100%);
  transition: transform .35s cubic-bezier(0.16, 1, 0.3, 1);
}
.drawer.open { transform: translateX(0); }
```

For mobile fullscreen, drop the backdrop opacity to `.7` (more solid) since the drawer covers most of the screen.

## Anti-patterns

- ❌ Default Bootstrap/Material `ease-in-out` at 300 ms — feels mechanical
- ❌ Spring physics (overshoot/bounce) — Pasify is restrained, not playful
- ❌ Spinning loaders on cards or tables — use skeletons
- ❌ Stock browser focus ring (default 2px solid) — always replace
- ❌ Multiple simultaneous animations on the same element (slide + rotate + fade) — pick one
- ❌ Hover effects that change layout (margin/padding shifts) — only transform/opacity/color
- ❌ Transitions on EVERY property: `transition: all .3s ease` — explicitly list properties
- ❌ Pulse animations on buttons by default — only on "alert" CTAs with a real reason
- ❌ Ripple effects (Material) — Pasify uses subtle filter:brightness on press, not ripples

## Reduced motion respect

For users with `prefers-reduced-motion`, kill non-essential animations:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Keep transitions on focus/active for accessibility — those are functional, not decorative.
