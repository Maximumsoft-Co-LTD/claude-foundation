---
name: frontend-design
description: "Use when implementing or polishing web UI — layout, typography, motion, responsive states — after UX direction is settled. Skip unresolved interaction decisions (use ux-ui-principles)."
license: Complete terms in LICENSE.txt
---

# Frontend design

Build working, distinctive UI that fits the product; a screenshot alone cannot
prove the interaction worked.

## Steps

1. Inspect the existing product: rendered UI, framework, components, tokens,
   content, responsive behavior, and accessibility conventions.
2. State one visual thesis grounded in purpose and audience. Preserve an
   established brand unless a redesign was requested.
3. Set hierarchy before decoration: content order, grid, typography, spacing,
   color roles, responsive transformations. Reuse repository primitives and
   tokens before adding dependencies or one-off values.
4. Implement real behavior: semantic HTML, keyboard/focus, loading, empty,
   error, disabled states, reduced motion.
5. Add a few intentional signatures (composition, type, imagery, motion) that
   reinforce the thesis; prefer authentic product data over generic card grids.
6. Render representative desktop and mobile widths; check action, resulting
   state, and persisted effects; fix overflow, clarity, a11y, and rhythm.

## Harness

Record consequential visual decisions in the active OpenSpec design. Browser
and accessibility providers supply evidence; do not claim quality from source
inspection alone. Keep unrelated refactors out of the diff.

## References

- Use `ux-ui-principles` for unresolved interaction, IA, or accessibility
  decisions; `ui-ux-pro-max` to look up style, palette, or typography guidance;
  `tailwind-design-system` when shared Tailwind v4 tokens or component APIs change.
