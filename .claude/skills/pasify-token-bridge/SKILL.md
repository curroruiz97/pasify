---
name: pasify-token-bridge
description: Maps the existing application's design tokens (colors, typography, spacing, shadows, radii, transitions, z-index) to Pasify's canonical tokens. Use this whenever you're editing tailwind.config, tokens.css, theme.scss, :root variables, design-tokens.json, or any single source of truth that defines a palette, and you need to know "what should this become in Pasify". Also triggers when the user says "cambia los colores a Pasify", "mapea los tokens", "haz que las variables CSS sean las de Pasify". This skill provides the conversion tables. It does NOT touch individual components — that's pasify-app-components.
---

# Pasify Token Bridge

The job of this skill: take whatever token layer the existing app uses and rewrite it so the values are Pasify's. After this skill runs, the app should pick up the new palette automatically via cascade — without touching individual components.

## Find the source of truth first

Search the codebase in this order, stop at the first hit:

1. `tailwind.config.{js,ts,cjs,mjs}` → look at `theme.extend.colors`, `fontFamily`, `borderRadius`, `boxShadow`, `transitionTimingFunction`
2. `tokens.{css,scss,less,json}` or `design-tokens.{json,yaml}`
3. `theme.{css,scss}` or `variables.{css,scss}`
4. Global `:root` block in `index.css`, `globals.css`, `app.css`, `main.scss`
5. Styled-components/Emotion `theme` object exported from `theme.{ts,js}`
6. CSS Modules: rare to have a central source — fall back to grep `#[0-9a-fA-F]{3,6}` and find the most repeated colors

**Edit only the canonical source.** If the app has both `tailwind.config.js` AND a `:root` block with custom properties, edit both only if they're truly independent — usually one drives the other.

## Pasify canonical tokens (memorize these)

### Colors — dark mode (default for the app)

```css
--bg:        #13100E;   /* page background, deepest */
--bg-2:      #1A1612;   /* cards, panels */
--bg-3:      #221C17;   /* hover bg on bg-2, modal surfaces */
--ink:       #F4EEE2;   /* primary text, cream */
--ink-2:     #C9BFA8;   /* secondary text */
--ink-3:     #8A8275;   /* tertiary text, mono labels */
--ink-4:     #5A5048;   /* disabled text */
--line:      #26211C;   /* borders, dividers */
--line-2:    #332C25;   /* stronger borders on hover */
--accent:      #E8542A; /* terracota, the ONE brand color */
--accent-deep: #BF3F1D; /* pressed state */
--accent-soft: rgba(232,84,42,.10); /* hover bg tint */
--warm:        #FF8A5C; /* hero gradient warm side */
--success:   #4DB87A;   /* OK / valid */
--success-soft: #1A1F18;
--warning:   #E8B07A;   /* caution */
--danger:    #E8542A;   /* same as accent — Pasify uses terracota for danger too */
--info:      #7AD0D8;   /* info badges */
--rrpp:      #E8B07A;   /* RRPP category color (apps that reuse this concept) */
--vip:       #E8542A;
--press:     #7AD0D8;
--invitado:  #9D8AE8;
```

### Colors — light mode (rare in app; mostly for marketing/docs)

```css
--bg:        #F4EEE2;
--bg-2:      #ECE4D2;
--ink:       #1A1714;
--ink-2:     #3D3733;
--line:      #D9CFB8;
/* accent and semantic colors unchanged */
```

### Typography

```css
font-family: 'Geist', system-ui, -apple-system, sans-serif;   /* body + UI */
font-family: 'Geist Mono', ui-monospace, SFMono-Regular, monospace;  /* labels, code, KPIs */
font-family: 'Instrument Serif', Georgia, serif;  /* italic flourish for em inside headings */

/* Weights used (Geist) */
300  /* very light, rarely used */
400  /* body */
500  /* labels, micro-interactions */
600  /* headings */
700  /* hero wordmark only */
```

Scale (rems are NOT used — Pasify scales via `clamp()`):

```css
h1: clamp(44px, 5.6vw, 84px) / line-height .96 / weight 600 / letter-spacing -.045em
h2: clamp(34px, 4.5vw, 62px) / line-height 1.0 / weight 600 / letter-spacing -.04em
h3: clamp(28px, 3.4vw, 44px) / line-height 1.05 / weight 600 / letter-spacing -.035em
h4: 18px / line-height 1.25 / weight 600 / letter-spacing -.02em
body: 14-15px / line-height 1.55-1.7 / weight 400
lede: clamp(16px, 1.4vw, 19px) / line-height 1.55 / max-width 54-60ch
mono-label: 9-11px / line-height 1.45 / letter-spacing .14-.18em / text-transform uppercase
```

### Spacing — Pasify rhythm

Pasify uses a 4-based scale but with breathing room. Memorize these milestones:

- `4 / 8 / 12` — micro (within a small chip or icon)
- `16 / 20 / 24` — within a card
- `28 / 32 / 40` — between sibling cards, around buttons
- `48 / 56 / 64` — minor section internal padding
- `72 / 96 / 120` — between sections on the page

If the existing app uses a 4-step Tailwind scale (4/8/12/16/20/24...), it's compatible. If it uses an 8-step or 5-step scale, harmonize gradually — don't break the layout, just adjust the most cramped spots first.

### Radii

```css
--r-xs:  4px;    /* badges, chips, mono-labels */
--r-sm:  6-8px;  /* small buttons, inputs */
--r-md:  10-12px; /* normal buttons, secondary cards */
--r-lg:  14-18px; /* primary cards, mockups */
--r-xl:  24px;   /* cta banners, hero containers */
--r-full: 999px; /* pills, avatars, glass buttons */
```

Anti-pattern: don't use `border-radius: 4px` everywhere like Material does — Pasify prefers larger, softer radii (10-14 px is the sweet spot).

### Shadows

Pasify uses subtle shadows + glass + glow. NOT material elevation.

```css
/* Card shadow — soft and deep */
box-shadow: 0 30px 80px -30px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.02) inset;

/* Glass button shadow */
box-shadow:
  inset 0 1px 0 rgba(255,255,255,.9),
  inset 0 -1px 0 rgba(80,20,5,.18),
  0 6px 16px -4px rgba(0,0,0,.25),
  0 14px 32px -10px rgba(80,20,5,.45);

/* Dropdown shadow */
box-shadow: 0 12px 40px -12px rgba(0,0,0,.6);

/* Hover lift (used with translateY) */
box-shadow: 0 10px 22px -4px rgba(0,0,0,.3), 0 22px 44px -10px rgba(80,20,5,.5);
```

### Transitions

The Pasify signature: `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out-expo).

```css
transition: transform .25s cubic-bezier(0.16, 1, 0.3, 1),
            background .2s ease,
            border-color .2s ease,
            color .2s ease;

/* Hover lift on cards */
transition: transform .25s cubic-bezier(0.16, 1, 0.3, 1), border-color .2s ease, background .2s ease;
&:hover { transform: translateY(-3px); border-color: var(--line-2); }

/* Search dock expanding */
transition: transform .35s cubic-bezier(0.16, 1, 0.3, 1), opacity .25s ease;
```

Avoid `ease`, `ease-in-out`, or jQuery-default `swing`. Always cubic-bezier(0.16, 1, 0.3, 1) for noticeable motion.

### Z-index scale

```
0   — base content
1   — sticky elements (header at top of section)
2   — overlapping cards
5   — search dropdowns, tooltips
10  — header sticky
50  — modals backdrop
60  — modals content
70  — toast/notification
98  — mobile drawer
99  — system alerts (rare)
```

## Tailwind config bridge (most common case)

If the app uses Tailwind, edit `tailwind.config.{js,ts}` like this:

```js
// theme.extend
colors: {
  background: '#13100E',
  surface: { DEFAULT: '#1A1612', hover: '#221C17' },
  ink: { DEFAULT: '#F4EEE2', 2: '#C9BFA8', 3: '#8A8275', 4: '#5A5048' },
  line: { DEFAULT: '#26211C', 2: '#332C25' },
  accent: { DEFAULT: '#E8542A', deep: '#BF3F1D', soft: 'rgba(232,84,42,.10)' },
  success: '#4DB87A',
  warning: '#E8B07A',
  danger:  '#E8542A',
  info:    '#7AD0D8',
},
fontFamily: {
  sans: ['Geist', 'system-ui', 'sans-serif'],
  mono: ['"Geist Mono"', 'ui-monospace', 'monospace'],
  serif: ['"Instrument Serif"', 'Georgia', 'serif'],
},
borderRadius: {
  xs: '4px', sm: '8px', md: '10px', lg: '14px', xl: '24px',
},
boxShadow: {
  card: '0 30px 80px -30px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.02) inset',
  glass: 'inset 0 1px 0 rgba(255,255,255,.9), inset 0 -1px 0 rgba(80,20,5,.18), 0 6px 16px -4px rgba(0,0,0,.25), 0 14px 32px -10px rgba(80,20,5,.45)',
  dropdown: '0 12px 40px -12px rgba(0,0,0,.6)',
},
transitionTimingFunction: {
  pasify: 'cubic-bezier(0.16, 1, 0.3, 1)',
},
```

Also delete or override Tailwind defaults that conflict: the default blue palette will keep showing up if components use `bg-blue-500`. Either grep for those usages or use `corePlugins: { preflight: true }` and Tailwind's color disable.

## CSS variables bridge

If the app uses `:root` custom properties:

```css
:root {
  --bg-page: #13100E;
  --bg-surface: #1A1612;
  --bg-surface-hover: #221C17;
  --text-primary: #F4EEE2;
  --text-secondary: #C9BFA8;
  --text-tertiary: #8A8275;
  --text-disabled: #5A5048;
  --border-subtle: #26211C;
  --border-strong: #332C25;
  --color-accent: #E8542A;
  --color-accent-deep: #BF3F1D;
  --color-success: #4DB87A;
  --color-warning: #E8B07A;
  --color-danger: #E8542A;
  --color-info: #7AD0D8;
  --radius-sm: 8px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-full: 999px;
  --shadow-card: 0 30px 80px -30px rgba(0,0,0,.7), 0 0 0 1px rgba(255,255,255,.02) inset;
  --shadow-dropdown: 0 12px 40px -12px rgba(0,0,0,.6);
  --ease-pasify: cubic-bezier(0.16, 1, 0.3, 1);
  --font-sans: 'Geist', system-ui, -apple-system, sans-serif;
  --font-mono: 'Geist Mono', ui-monospace, monospace;
  --font-serif: 'Instrument Serif', Georgia, serif;
}
```

**Keep the variable names the app uses.** If the app has `--brand-primary`, just give it the value `#E8542A`. Don't rename. Renaming forces editing every consumer.

## Decision rules for ambiguous mappings

- App has a "primary" color that's blue → becomes terracota `#E8542A`
- App has a "secondary" color → likely becomes `--ink-2` `#C9BFA8` (muted text) OR `--warm` `#FF8A5C` (warm accent) depending on usage; if secondary is used for "secondary buttons", keep it as an outline button (no fill) instead
- App has gray-50 / gray-100 / ... / gray-900 (Tailwind default) → map to the `--ink-*` and `--line-*` scale, but check which gray serves which role first
- App has multiple accent colors (purple + green + blue for different features) → reduce to terracota for actions and use the semantic colors (success/warning/info) for state; if the user insists on category colors, suggest the Pasify category palette (rrpp `#E8B07A`, vip `#E8542A`, press `#7AD0D8`, invitado `#9D8AE8`)
- App has a "danger" red — replace with `#E8542A` (Pasify uses terracota for danger too) UNLESS true danger needs differentiation, then use a slightly cooler red `#D03A1D`
- App has Tailwind's default `rounded-md` (6px) everywhere — uplift to 10 px globally
- App has shadow-sm/md/lg from Tailwind defaults — replace with the Pasify shadow ladder above

## Verifying the bridge worked

After editing the canonical source, reload the app and check:

1. The page background is `#13100E` (dark) — if it's still off, find the leftover hardcoded `background:` in `body` or `#root`
2. Primary buttons are terracota — if not, the button component has hardcoded color
3. Text is cream `#F4EEE2` — if it's stock gray, find the leftover `color:` in `body` or a global text rule
4. Borders look warm-tinted, not blue-gray — if not, search for stock `#e5e7eb`, `#d4d4d8`, etc.

When you find a hardcoded color still showing, fix it at the component level (not the token level). Report it to pasify-app-components as a known offender.

## What NOT to do here

- ❌ Don't grep-and-replace every hex code in the codebase. That breaks edge cases (data viz colors, marketing illustrations).
- ❌ Don't introduce new tokens not in this skill — if you need a color for a state Pasify hasn't defined yet, ASK the user before inventing one.
- ❌ Don't preserve the app's old token names AND add Pasify-named tokens alongside. Pick one naming and stick to it.
- ❌ Don't change the spacing scale unless density is clearly off — token-bridge mainly handles colors/typo/shadows/radii/motion.
