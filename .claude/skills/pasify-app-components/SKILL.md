---
name: pasify-app-components
description: Catalog of how each app UI component (buttons, inputs, cards, modals, tables, navs, sidebars, breadcrumbs, tabs, toasts, badges, tooltips, dropdowns, pagination, avatars, empty states, skeleton loaders, charts) should look in Pasify style. Use this when porting a specific component from the existing app, or when the user says "el botón no se parece a Pasify", "rediseña la sidebar", "haz que las tablas se vean Pasify", "los inputs siguen siendo Material", or any complaint about a specific component being off-brand. This skill has the patterns. It does NOT touch the token layer (that's pasify-token-bridge) or interaction states (pasify-app-states).
---

# Pasify App Components — Pattern Catalog

For each app component type, this skill tells you the Pasify rendering: structure, classes/tokens to use, and what to throw away from the original Material/Bootstrap/AntD/Chakra defaults.

## How to use this skill

For each component the app already has:

1. Find the component file (e.g., `Button.tsx`, `Card.vue`, `_modal.scss`)
2. Look up the pattern below
3. Replace styles to match — **keep the component's API (props/slots) unchanged**
4. Test in 2-3 screens where it's used before moving on

## Buttons

Pasify has three button variants. Map any app variant to one of these:

### Primary — terracota glass

The signature button. Used for the single most important action on a view. **Use sparingly** — one per screen.

```css
.btn-primary {
  display: inline-flex; align-items: center; gap: 10px;
  padding: 13px 22px;
  background: linear-gradient(180deg, #FF8A5C 0%, #E8542A 50%, #C73E1B 100%);
  color: #fff;
  border-radius: 999px;
  font-size: 14px; font-weight: 500; letter-spacing: -.005em;
  border: 1px solid transparent;
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.35),
    inset 0 -1px 0 rgba(80,20,5,.4),
    0 6px 16px -4px rgba(232,84,42,.45),
    0 14px 32px -10px rgba(232,84,42,.4);
  transition: transform .15s cubic-bezier(0.16,1,0.3,1), box-shadow .25s ease, filter .15s ease;
  cursor: pointer;
}
.btn-primary:hover  { transform: translateY(-2px); filter: brightness(1.04); }
.btn-primary:active { transform: translateY(0); filter: brightness(.96); }
```

Use for: "Solicita demo", "Guardar", "Crear evento", "Enviar".

### Outline — bordered cream

The fallback. Used when you have multiple non-primary actions in a group, or for secondary actions next to a primary.

```css
.btn-outline {
  display: inline-flex; align-items: center; gap: 10px;
  padding: 13px 22px;
  background: transparent;
  color: var(--ink);
  border: 1px solid var(--line-2);
  border-radius: 10px;
  font-size: 14px; font-weight: 500;
  transition: background .2s ease, border-color .2s ease, transform .15s cubic-bezier(0.16,1,0.3,1);
}
.btn-outline:hover { background: rgba(244,238,226,.04); border-color: var(--ink-3); }
```

Use for: "Cancelar", "Ver más", "Volver", any non-final action.

### Ghost — no chrome

Used inline in dense UIs (table rows, list items) where a bordered button would be visually heavy.

```css
.btn-ghost {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 8px 14px;
  background: transparent;
  color: var(--ink-2);
  border: 0;
  font-size: 13px;
  border-radius: 8px;
  transition: background .2s ease, color .2s ease;
}
.btn-ghost:hover { background: rgba(244,238,226,.06); color: var(--ink); }
```

Use for: row actions, icon buttons, "Volver" in headers, "X" close.

### Anti-patterns

- ❌ Don't keep Material's rectangular fills with `border-radius: 4px`
- ❌ Don't add hover backgrounds that shift hue dramatically
- ❌ Don't put 3 primary buttons in a row — pick one, demote the rest
- ❌ Don't use full-width buttons except in modals/mobile where width is constrained

## Form inputs

Pasify forms are dark, soft, and roomy.

### Text input

```css
.input {
  display: block; width: 100%;
  background: var(--bg-2);
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 12px 14px;
  color: var(--ink);
  font-family: 'Geist', sans-serif;
  font-size: 14px; line-height: 1.4;
  transition: border-color .2s ease, background .2s ease, box-shadow .2s ease;
}
.input::placeholder { color: var(--ink-3); }
.input:hover    { border-color: var(--line-2); }
.input:focus    { outline: none; border-color: var(--accent); box-shadow: 0 0 0 4px rgba(232,84,42,.12); }
.input:disabled { opacity: .6; cursor: not-allowed; }
.input.invalid  { border-color: var(--accent); box-shadow: 0 0 0 4px rgba(232,84,42,.12); }
```

### Label

```css
.label {
  display: block;
  font-family: 'Geist Mono', monospace;
  font-size: 10px;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: var(--ink-3);
  margin-bottom: 8px;
}
.label .req { color: var(--accent); }
```

### Select

Same shell as input. Add a chevron SVG positioned absolute right, padding-right 36px.

### Checkbox / radio

```css
.checkbox {
  width: 18px; height: 18px;
  border: 1.5px solid var(--line-2);
  border-radius: 4px;
  background: var(--bg-2);
  cursor: pointer;
  transition: border-color .2s ease, background .2s ease;
}
.checkbox:hover { border-color: var(--ink-3); }
.checkbox:checked {
  background: var(--accent);
  border-color: var(--accent);
}
.checkbox:checked::after {
  content: ""; display: block;
  width: 100%; height: 100%;
  background-image: url("data:image/svg+xml;utf8,<svg ..>"); /* check icon */
}
```

Radio same shape but `border-radius: 999px` and inner dot via `::after`.

### Switch / toggle

```css
.switch {
  width: 36px; height: 20px;
  background: var(--line-2);
  border-radius: 999px;
  position: relative;
  cursor: pointer;
  transition: background .2s ease;
}
.switch::after {
  content: ""; position: absolute;
  top: 2px; left: 2px;
  width: 16px; height: 16px;
  background: #fff;
  border-radius: 999px;
  transition: transform .2s cubic-bezier(0.16,1,0.3,1);
}
.switch[aria-checked="true"] { background: var(--accent); }
.switch[aria-checked="true"]::after { transform: translateX(16px); }
```

### Field group structure

Wrap each field in:

```html
<div class="field">
  <label class="label">Email <span class="req">*</span></label>
  <input class="input" type="email" />
  <p class="help">Te enviaremos un código de confirmación</p>
  <p class="error">Formato inválido</p> <!-- only when invalid -->
</div>
```

```css
.field { margin-bottom: 20px; }
.field .help  { font-size: 12px; color: var(--ink-3); margin-top: 6px; }
.field .error { font-size: 12px; color: var(--accent); margin-top: 6px; }
```

## Cards / panels

Three flavors depending on the role:

### Standard card

```css
.card {
  background: var(--bg-2);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 24px;
  transition: transform .25s cubic-bezier(0.16,1,0.3,1), border-color .2s ease, background .2s ease;
}
.card:hover { transform: translateY(-3px); border-color: var(--line-2); background: var(--bg-3); }
```

Use for: list items in a grid, dashboard widgets, sector cards.

### Mockup card (with glow)

For cards that visualize app content (e.g., a snippet of UI inside a marketing or dashboard preview):

```css
.mockup {
  position: relative;
  background: linear-gradient(180deg, #1A1612 0%, #0F0D0B 100%);
  border: 1px solid var(--line-2);
  border-radius: 18px;
  box-shadow: 0 30px 80px -30px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.02) inset;
  padding: 24px;
}
.mockup::before { /* the glow */
  content: ""; position: absolute; inset: -1px;
  border-radius: 18px;
  background: linear-gradient(135deg, rgba(232,84,42,.12), transparent 60%);
  opacity: .6; pointer-events: none;
}
```

### Surface card (no hover)

For static panels in dashboards (filters, info, settings):

```css
.surface {
  background: var(--bg-2);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 20px;
}
```

## Navigation

### Top bar (app shell)

Sticky 64px, brand on left, nav links center-left, actions right.

```css
.app-bar {
  position: sticky; top: 0; z-index: 50;
  height: 64px;
  background: rgba(11,9,8,.85);
  backdrop-filter: blur(20px);
  border-bottom: 1px solid var(--line);
  display: flex; align-items: center;
  padding: 0 24px;
  gap: 32px;
}
.app-bar .brand { font-size: 28px; font-weight: 700; letter-spacing: -.04em; }
.app-bar .nav   { display: flex; gap: 4px; }
.app-bar .nav a { padding: 8px 14px; color: var(--ink-2); border-radius: 8px; transition: color .2s, background .2s; font-size: 14px; }
.app-bar .nav a:hover    { color: var(--ink); background: rgba(244,238,226,.04); }
.app-bar .nav a.current  { color: var(--accent); }
```

### Sidebar (vertical app nav)

If the app uses a sidebar (most do), here's the pattern:

```css
.sidebar {
  width: 240px;
  background: var(--bg-2);
  border-right: 1px solid var(--line);
  padding: 24px 16px;
  display: flex; flex-direction: column; gap: 4px;
  min-height: 100vh;
}
.sidebar .group-label {
  font-family: 'Geist Mono', monospace;
  font-size: 10px; letter-spacing: .14em; text-transform: uppercase;
  color: var(--ink-3);
  padding: 16px 12px 8px;
}
.sidebar .item {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  color: var(--ink-2); font-size: 14px;
  cursor: pointer;
  transition: background .2s ease, color .2s ease;
}
.sidebar .item:hover { background: rgba(244,238,226,.04); color: var(--ink); }
.sidebar .item.active {
  background: rgba(232,84,42,.08);
  color: var(--accent);
}
.sidebar .item.active::before {
  content: ""; width: 2px; height: 18px;
  background: var(--accent);
  border-radius: 2px;
  margin-left: -14px; margin-right: 12px;
}
.sidebar .item .icon { width: 16px; height: 16px; flex-shrink: 0; }
```

### Breadcrumbs

```css
.crumbs {
  padding: 24px 0 8px;
  font-family: 'Geist Mono', monospace;
  font-size: 11px;
  letter-spacing: .16em;
  text-transform: uppercase;
  color: var(--ink-3);
}
.crumbs a { color: var(--ink-3); transition: color .2s ease; }
.crumbs a:hover { color: var(--accent); }
.crumbs .sep { margin: 0 10px; color: var(--line-2); }
.crumbs .here { color: var(--ink); }
```

### Tabs

```css
.tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); }
.tab {
  padding: 12px 16px;
  color: var(--ink-3);
  font-size: 13px;
  font-weight: 500;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  cursor: pointer;
  transition: color .2s ease, border-color .2s ease;
}
.tab:hover     { color: var(--ink-2); }
.tab.active    { color: var(--accent); border-bottom-color: var(--accent); }
```

## Tables

```css
.table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.table th {
  text-align: left;
  font-family: 'Geist Mono', monospace;
  font-size: 10px;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: var(--ink-3);
  padding: 12px 16px;
  border-bottom: 1px solid var(--line-2);
  background: var(--bg-2);
  font-weight: 500;
}
.table td {
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
  color: var(--ink);
  line-height: 1.45;
  vertical-align: middle;
}
.table tr:hover td { background: rgba(244,238,226,.02); }
.table tr:last-child td { border-bottom: none; }

/* Compact variant */
.table--compact td, .table--compact th { padding: 8px 12px; font-size: 12.5px; }

/* Sort indicator on TH */
.table th.sortable { cursor: pointer; user-select: none; }
.table th.sortable:hover { color: var(--ink-2); }
.table th.sortable.asc::after  { content: " ↑"; color: var(--accent); }
.table th.sortable.desc::after { content: " ↓"; color: var(--accent); }
```

## Modals / dialogs

```css
.modal-backdrop {
  position: fixed; inset: 0; z-index: 50;
  background: rgba(0,0,0,.6);
  backdrop-filter: blur(8px);
}
.modal {
  position: fixed; left: 50%; top: 50%; z-index: 60;
  transform: translate(-50%, -50%);
  width: min(560px, calc(100vw - 32px));
  max-height: calc(100vh - 64px);
  background: var(--bg-2);
  border: 1px solid var(--line-2);
  border-radius: 18px;
  box-shadow: 0 30px 80px -30px rgba(0,0,0,.7);
  display: flex; flex-direction: column;
  overflow: hidden;
}
.modal-header {
  padding: 24px 28px 18px;
  border-bottom: 1px solid var(--line);
  display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
}
.modal-header h3 { font-size: 20px; font-weight: 600; letter-spacing: -.02em; line-height: 1.2; }
.modal-header .sub { color: var(--ink-3); font-size: 13px; margin-top: 6px; }
.modal-body { padding: 24px 28px; overflow-y: auto; flex: 1; }
.modal-footer {
  padding: 18px 28px;
  border-top: 1px solid var(--line);
  display: flex; justify-content: flex-end; gap: 10px;
  background: var(--bg-2);
}
```

For drawers, use the same body but slide from right with `transform: translateX(100%)` → `0`.

## Toasts / notifications

Bottom-right stack, max 3 visible.

```css
.toast {
  display: flex; align-items: flex-start; gap: 12px;
  background: var(--bg-2);
  border: 1px solid var(--line-2);
  border-left: 3px solid var(--accent);
  border-radius: 10px;
  padding: 14px 16px;
  width: 320px;
  box-shadow: 0 12px 40px -12px rgba(0,0,0,.6);
  transition: transform .35s cubic-bezier(0.16,1,0.3,1), opacity .25s ease;
}
.toast.success { border-left-color: var(--success); }
.toast.warning { border-left-color: var(--warning); }
.toast.error   { border-left-color: var(--danger); }
.toast .icon { width: 18px; height: 18px; flex-shrink: 0; margin-top: 2px; }
.toast .title { font-size: 13px; font-weight: 600; color: var(--ink); line-height: 1.4; }
.toast .desc  { font-size: 12.5px; color: var(--ink-2); margin-top: 4px; }
.toast .close { width: 24px; height: 24px; border: 0; background: transparent; color: var(--ink-3); cursor: pointer; }
```

## Badges / tags / chips

```css
.badge {
  display: inline-flex; align-items: center;
  font-family: 'Geist Mono', monospace;
  font-size: 9px;
  letter-spacing: .14em;
  text-transform: uppercase;
  padding: 3px 8px;
  border-radius: 4px;
  background: rgba(232,84,42,.10);
  color: var(--accent);
}
.badge--success { background: rgba(77,184,122,.12); color: var(--success); }
.badge--info    { background: rgba(122,208,216,.12); color: var(--info); }
.badge--neutral { background: rgba(244,238,226,.06); color: var(--ink-3); }

/* Dot variant */
.badge--dot::before {
  content: ""; width: 6px; height: 6px;
  background: currentColor; border-radius: 999px;
  margin-right: 6px;
}
```

## Tooltips

```css
.tooltip {
  position: absolute;
  background: var(--bg-3);
  border: 1px solid var(--line-2);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--ink);
  white-space: nowrap;
  box-shadow: 0 6px 20px -6px rgba(0,0,0,.5);
  pointer-events: none;
}
.tooltip::before {
  content: ""; position: absolute;
  /* arrow pointing to trigger — adjust position per placement */
}
```

## Dropdowns / popovers

Use the search-results pattern from the header: dark surface, blur, 14 px radius.

```css
.popover {
  position: absolute;
  background: rgba(20,17,14,.96);
  backdrop-filter: blur(14px);
  border: 1px solid var(--line-2);
  border-radius: 14px;
  padding: 6px;
  min-width: 200px;
  box-shadow: 0 12px 40px -12px rgba(0,0,0,.6);
  z-index: 60;
}
.popover .item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  color: var(--ink-2);
  font-size: 13px;
  cursor: pointer;
  transition: background .15s ease, color .15s ease;
}
.popover .item:hover { background: rgba(232,84,42,.10); color: var(--ink); }
.popover .separator { height: 1px; background: var(--line); margin: 4px 8px; }
```

## Pagination

```css
.pagination { display: flex; gap: 4px; align-items: center; }
.pagination .page {
  min-width: 32px; height: 32px;
  padding: 0 8px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--ink-2);
  font-family: 'Geist Mono', monospace;
  font-size: 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all .2s ease;
}
.pagination .page:hover { border-color: var(--line-2); color: var(--ink); }
.pagination .page.active { background: var(--accent); border-color: var(--accent); color: #fff; }
.pagination .page:disabled { opacity: .4; cursor: not-allowed; }
```

## Avatars

```css
.avatar {
  width: 36px; height: 36px;
  border-radius: 999px;
  background: var(--bg-3);
  display: grid; place-items: center;
  color: var(--ink);
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
}
.avatar img { width: 100%; height: 100%; object-fit: cover; }

/* Sizes */
.avatar--sm { width: 24px; height: 24px; font-size: 11px; }
.avatar--lg { width: 56px; height: 56px; font-size: 18px; }

/* Group with overlap */
.avatar-group { display: flex; }
.avatar-group .avatar { margin-left: -8px; border: 2px solid var(--bg); }
.avatar-group .avatar:first-child { margin-left: 0; }
```

## Empty states

Centered, 320 px max, soft.

```html
<div class="empty">
  <div class="empty-icon"><svg .../></div>
  <h4 class="empty-title">Aún no hay nada por aquí</h4>
  <p class="empty-desc">Crea tu primer evento para empezar.</p>
  <button class="btn btn-primary">Crear evento →</button>
</div>
```

```css
.empty { text-align: center; padding: 64px 24px; max-width: 320px; margin: 0 auto; }
.empty-icon { width: 56px; height: 56px; margin: 0 auto 20px;
  background: var(--accent-soft); border: 1px solid rgba(232,84,42,.25);
  border-radius: 14px; display: grid; place-items: center; color: var(--accent); }
.empty-icon svg { width: 22px; height: 22px; }
.empty-title { font-size: 16px; font-weight: 600; color: var(--ink); margin-bottom: 8px; }
.empty-desc { font-size: 13.5px; color: var(--ink-3); line-height: 1.55; margin-bottom: 20px; }
```

## Skeleton loaders

Shimmering placeholder, NOT the spinning circle.

```css
@keyframes pasify-shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.skeleton {
  background: linear-gradient(90deg, var(--bg-2) 0%, var(--bg-3) 50%, var(--bg-2) 100%);
  background-size: 200% 100%;
  animation: pasify-shimmer 1.4s ease-in-out infinite;
  border-radius: 6px;
}
.skeleton--text { height: 12px; margin-bottom: 8px; }
.skeleton--title { height: 20px; width: 60%; margin-bottom: 12px; }
.skeleton--avatar { width: 36px; height: 36px; border-radius: 999px; }
.skeleton--card { height: 120px; border-radius: 14px; }
```

## Charts / data viz

Pasify uses warm dark backgrounds with terracota as the primary series.

Series palette (in order):

1. `#E8542A` — terracota (primary)
2. `#E8B07A` — warm sand (secondary)
3. `#9D8AE8` — violet (tertiary)
4. `#7AD0D8` — teal (info)
5. `#7DD17F` — green (success/positive)
6. `#FF8A5C` — warm orange (highlight)

Grid lines: `var(--line)` `#26211C`, dashed.
Axis labels: `var(--ink-3)` `#8A8275`, Geist Mono 10 px.
Tooltips: use the `.tooltip` pattern.
Sparkline strokes: 1.5-2 px, no fills.
Bars: rounded top corners 3 px, gap 4-6 px between bars.

## Search input (in app — different from header dock)

```css
.search-input {
  display: flex; align-items: center; gap: 8px;
  background: var(--bg-2);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 8px 14px;
  width: 100%;
  max-width: 360px;
  transition: border-color .2s ease, background .2s ease;
}
.search-input:hover, .search-input:focus-within { border-color: var(--line-2); background: var(--bg-3); }
.search-input svg { width: 14px; height: 14px; color: var(--ink-3); }
.search-input input { flex: 1; background: transparent; border: 0; outline: 0; color: var(--ink); font-size: 13px; font-family: 'Geist'; }
.search-input input::placeholder { color: var(--ink-3); }
.search-input .kbd {
  font-family: 'Geist Mono', monospace;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--bg-3);
  border: 1px solid var(--line-2);
  color: var(--ink-3);
}
```

## Anti-patterns across all components

- ❌ `border-radius: 4px` everywhere — Material does this, Pasify doesn't
- ❌ Hard shadows like `0 2px 4px rgba(0,0,0,.1)` — replace with the soft, deep card shadow
- ❌ Blue or indigo focus rings — always terracota glow `0 0 0 4px rgba(232,84,42,.12)`
- ❌ `text-transform: uppercase` on body text — use mono labels for that effect
- ❌ Spinner loaders — use skeletons unless action is genuinely short (< 1 s)
- ❌ Animations slower than 400 ms or sharper than 150 ms — keep in the 200-350 ms band
- ❌ Adding Material Icons / FontAwesome on top of existing icons — pick one icon system (lucide preferred) and restyle, don't mix
- ❌ Glass effects on dense data UIs (tables, dashboards) — glass is for marketing CTAs and modals, not row backgrounds
