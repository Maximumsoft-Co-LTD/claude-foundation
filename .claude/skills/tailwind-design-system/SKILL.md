---
name: tailwind-design-system
description: "Use when maintaining shared Tailwind v4 tokens, variants, themes, or a v3 migration. Skip one-off styling (use frontend-design)."
---

# Tailwind design system (v4)

Confirm the installed major version first; generated CSS alone cannot prove
accessible behavior.

## Steps

1. Check the installed Tailwind version. For v3, use the official migration
   path instead of mixing models.
2. Define CSS-first tokens with `@theme`: raw brand values → semantic roles →
   component decisions.
3. Keep component APIs small: base, variants, sizes, states, one override seam.
   Use CVA-style machinery only for genuinely shared variants; one
   class-merging convention; no raw colors that bypass tokens.
4. Implement focus, disabled, loading, invalid, high-contrast, reduced-motion,
   and dark-mode states as part of the component contract.
5. Prefer responsive composition and container-aware primitives over repeating
   breakpoint lists.
6. Migrate incrementally: inventory config/plugins, translate tokens and
   variants, update utilities, verify generated CSS, then remove v3 paths after
   consumers move.

## Harness

Record shared token/API and migration compatibility decisions in the active
OpenSpec design. Prove representative components through browser and
accessibility providers and the project build.

## References

- `references/setup-and-migration.md` — `@theme`, quick start, v3→v4 checklist.
- `references/component-patterns.md` — CVA, compound, and form components.
- `references/layout-motion-theming.md` — responsive layout, animation, dark mode.
- `references/utilities-and-advanced.md` — helpers and advanced v4 features.
