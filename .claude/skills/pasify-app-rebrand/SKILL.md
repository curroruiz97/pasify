---
name: pasify-app-rebrand
description: Master orchestrator for porting an existing application's UI to Pasify's visual language. Use this whenever the user mentions "rediseñar la app", "portar la app a Pasify", "que la app tenga el mismo estilo que la landing", "rebrand", "unificar el diseño de la app y la web", or pastes/adds an existing app codebase that needs visual alignment with the landing. Also triggers when the user is starting a redesign of a non-Pasify codebase that needs to look like Pasify. This skill orchestrates pasify-token-bridge, pasify-app-components and pasify-app-states — invoke them as helpers when you need their detail. It also tells Claude what NOT to do (don't rewrite logic, don't rename props, don't restructure routes).
---

# Pasify App Rebrand — Master Plan

When the user adds an existing application to this repo and wants to make it look like the Pasify landing, **do NOT start editing files randomly**. Follow this plan.

## What this rebrand is and isn't

| Is | Isn't |
| --- | --- |
| Replacing colors, fonts, spacing, shadows, radii, transitions with Pasify tokens | Rewriting business logic or state management |
| Restyling components: buttons, inputs, cards, modals, tables, navs | Renaming React/Vue/Svelte props, refactoring data flow |
| Adjusting layout density to match Pasify's breathing room | Changing routes, URLs, or backend behavior |
| Replacing icon sets with consistent line icons (or keeping current + restyling) | Removing features the user depends on |
| Adding the `grain` overlay, blur veils, terracota accents where they belong | Polishing things the user didn't ask to touch |

**Golden rule:** behavior unchanged, surface re-skinned. If a change touches logic, ask before doing it.

## Phase 0 — Discover the existing app

Before touching anything, answer these:

1. **What framework?** React/Vue/Svelte/Angular/vanilla? What styling system — Tailwind, CSS Modules, styled-components, SCSS, plain CSS, CSS variables, design tokens config file?
2. **Where do colors live?** Search for `:root`, `theme`, `colors`, `tailwind.config.*`, `tokens.*`, `palette`. Locate the canonical source. There is usually exactly one.
3. **What's the typography source?** Find the font loading: `@import`, `<link>`, `next/font`, Tailwind `fontFamily`.
4. **What components exist?** Map the component library: list the buttons, inputs, cards, modals, sidebars, navbars, tables, forms found in the codebase. This is your work plan.
5. **What screens exist?** List the major routes/pages — this is the order you'll rebrand in (most-visible first).

Write the findings as a brief report to the user before changing anything. Confirm the plan before starting Phase 1.

## Phase 1 — Token bridge (the single most important step)

Most of the rebrand happens at the token layer. If you do this right, 60-80% of the UI updates automatically.

Invoke the **pasify-token-bridge** skill to map the existing app's tokens to Pasify tokens. The bridge handles:

- Color tokens (primary, secondary, accent, neutrals, semantic green/red/yellow)
- Typography stack (font families, weights, sizes, line-heights)
- Spacing scale
- Radii
- Shadows
- Transitions and easing

Edit the canonical source (usually `tailwind.config.*`, `theme.css`, `tokens.scss`, or `:root` in a global stylesheet). **Don't** sprinkle hex codes across components.

After Phase 1, the app should look "Pasify-flavored" but still have wrong details (component shapes, hover states, density). That's expected — fix them in Phase 2.

## Phase 2 — Component port

For each component identified in Phase 0, apply the Pasify pattern. Invoke **pasify-app-components** for the catalog: it tells you, per component type, what Pasify class/structure to use and what to throw away.

Order:
1. Buttons (touched everywhere)
2. Inputs and form controls
3. Cards and panels
4. Top navigation / sidebar / breadcrumbs
5. Tables, lists, pagination
6. Modals, dialogs, drawers
7. Toasts, notifications, banners
8. Tabs, accordions, dropdowns
9. Avatars, badges, tags
10. Empty states, skeleton loaders

**Keep the existing component API.** If the app has `<Button variant="primary" size="md">`, don't rename to `<PasifyButton>`. Just change the CSS that `variant="primary"` produces.

## Phase 3 — Interaction states and micro-animations

Pasify has specific motion: `cubic-bezier(0.16, 1, 0.3, 1)` ease-out-expo, 0.2-0.35s transitions, terracota glow on focus, hover lift `translateY(-3px)` on cards. The app probably has Material-ish or Bootstrap-ish snappy transitions — replace.

Invoke **pasify-app-states** for the detailed spec on hover, focus, active, disabled, loading, empty, error states.

## Phase 4 — Screen-by-screen audit

For each major screen, do a 5-minute walkthrough comparing to the landing:

- [ ] Background matches `#13100E` (dark) or `#F4EEE2` (light)
- [ ] Headings use Geist 600 with italic em accent where appropriate
- [ ] Body uses Geist 400, line-height 1.55-1.7
- [ ] Mono labels use Geist Mono with `letter-spacing:.16em; text-transform:uppercase`
- [ ] Primary CTAs use the glass terracota button
- [ ] All hovers use the Pasify cubic-bezier
- [ ] Spacing is generous (padding 24-32px in cards, 48-72px between sections)
- [ ] Icons are line-style, 1.6-2 stroke width
- [ ] No leftover Material/Bootstrap/Tailwind-default rounded corners (use 8/10/14/24 px Pasify radii)
- [ ] No leftover stock blue / indigo / purple — only Pasify palette

Screens fail items? Fix them. Don't move on until each screen is clean.

## Phase 5 — Dark/light mode coherence

If the app supports both modes, ensure both use the SAME Pasify palette in their respective mode (light beige base / dark `#13100E` base, both sharing terracota). Don't keep the app's old "dark mode" theme alongside Pasify's — pick one source of truth.

## Anti-patterns to refuse

- ❌ Building a parallel Pasify stylesheet without removing the old one (causes specificity wars)
- ❌ Adding `!important` to force colors — fix the cascade instead
- ❌ Renaming the app's components/props "to be more Pasify" — surface-only
- ❌ Removing icon libraries the app uses (lucide, heroicons, tabler, etc.) — restyle them instead
- ❌ Adding the "grain" overlay to every screen — it belongs on marketing-style hero blocks, not on dashboards full of data
- ❌ Forcing the Instrument Serif italic em accent on EVERY heading — it's a flourish for marketing copy, not for dashboard widget titles

## What to report when you finish a phase

After each phase, give the user:
- What you changed (files + summary)
- What's still inconsistent (screens you haven't gotten to)
- What needs their input (decisions you couldn't make alone, like "this app has a sidebar — the landing doesn't define one; pick option A/B/C")

## When the user pushes back

If the user says "esto no se parece a la landing", they likely mean one of:
- The token bridge missed something (a hardcoded color in a component) → grep for the wrong hex and fix
- The component port is incomplete (used the wrong Pasify class) → check pasify-app-components
- The motion feels off (sharp transitions, wrong duration) → check pasify-app-states
- The density is wrong (too tight or too airy) → adjust spacing to Pasify 24/32/48/64 rhythm

Ask which screen and which element, then triage to the right skill.
