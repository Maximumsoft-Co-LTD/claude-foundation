---
name: tailwind-design-system
description: "Build or maintain Tailwind CSS v4 design-system mechanics: CSS-first `@theme` tokens, semantic color/radius/spacing variables, reusable component variants, dark mode, responsive patterns, and v3-to-v4 migration. Use when the task specifically touches Tailwind v4 configuration, shared tokens, component-library APIs, CVA-style variants, or standardizing repeated UI primitives. Do not use for ordinary one-off UI styling; use [[frontend-design]] for visual implementation and [[ui-ux-pro-max]] for UX/design decisions before translating them into Tailwind tokens."
---

# Tailwind Design System (v4)

> **Note**: This skill targets Tailwind CSS v4 (2024+). For v3 projects, refer to the [upgrade guide](https://tailwindcss.com/docs/upgrade-guide).

## When to Use

Only when Tailwind v4 itself is part of the work: tokens, variants, CSS-first config, component APIs, dark mode, responsive systems, or v3→v4 migration. Skip for one-off class tweaks, copy-only changes, plain CSS, or pure visual composition.

- [[ui-ux-pro-max]] first when deciding what the interface should feel like.
- [[frontend-design]] when the design is settled and no shared Tailwind system change is needed.
- In `/dev`: lead planning for design-system work; engineer for shared primitive changes.

## Key v4 Changes

| v3 Pattern                            | v4 Pattern                                                            |
| ------------------------------------- | --------------------------------------------------------------------- |
| `tailwind.config.ts`                  | `@theme` in CSS                                                       |
| `@tailwind base/components/utilities` | `@import "tailwindcss"`                                               |
| `darkMode: "class"`                   | `@custom-variant dark (&:where(.dark, .dark *))`                      |
| `theme.extend.colors`                 | `@theme { --color-*: value }`                                         |
| `require("tailwindcss-animate")`      | CSS `@keyframes` in `@theme` + `@starting-style` for entry animations |

## Structure

| Section | Essence | Reference |
|---|---|---|
| Quick Start | `app.css` CSS-first `@theme` config: semantic OKLCH color tokens, radius/animation tokens, `@custom-variant dark`, base layer | `references/setup-and-migration.md` |
| Core Concepts | Token hierarchy (brand → semantic → component); component architecture (base → variants → sizes → states → overrides) | `references/setup-and-migration.md` |
| Pattern 1: CVA Components | `cva()` variants + `Slot`/`asChild`, no `forwardRef` (React 19) — e.g. `Button` | `references/component-patterns.md` |
| Pattern 2: Compound Components | Multi-part component family (`Card`/`CardHeader`/`CardContent`/...) sharing one `cn()` convention | `references/component-patterns.md` |
| Pattern 3: Form Components | `Input`/`Label` with `react-hook-form` + `zod` validation, ARIA error wiring | `references/component-patterns.md` |
| Pattern 4: Responsive Grid System | `cva`-driven `Grid`/`Container` with breakpoint-aware `cols`/`gap`/`size` variants | `references/layout-motion-theming.md` |
| Pattern 5: Native CSS Animations | v4 `@starting-style` + `@theme` keyframes for dialog/popover entry-exit, no JS animation lib | `references/layout-motion-theming.md` |
| Pattern 6: Dark Mode with CSS | `ThemeProvider`/`useTheme` (system/light/dark), class toggling, `<meta theme-color>` sync | `references/layout-motion-theming.md` |
| Utility Functions | `cn()` (`clsx` + `tailwind-merge`), shared `focusRing`/`disabled` class strings | `references/utilities-and-advanced.md` |
| Advanced v4 Patterns | `@utility` custom utilities, `@theme inline/static`, namespace overrides (`--color-*: initial`), `color-mix()` alpha variants, container queries | `references/utilities-and-advanced.md` |
| v3 to v4 Migration Checklist | 10-item checklist: config→CSS, `@import`, dark variant, keyframes, `size-*`, drop `forwardRef`/plugins | `references/setup-and-migration.md` |
| Best Practices | Do's (theme blocks, OKLCH, CVA, semantic tokens, `size-*`, a11y) / Don'ts (config file, `@tailwind`, `forwardRef`, arbitrary values, hardcoded colors, skipping dark mode) | `references/utilities-and-advanced.md` |

## Reference files

| File | Read when |
|---|---|
| `references/setup-and-migration.md` | Scaffolding a v4 project's `@theme` CSS, or migrating an existing v3 config |
| `references/component-patterns.md` | Building a CVA variant component, a compound component family, or a validated form |
| `references/layout-motion-theming.md` | Building responsive grids/containers, native CSS entry animations, or dark-mode theming |
| `references/utilities-and-advanced.md` | Need the `cn()` helper, `@utility`/`@theme` power patterns, or the do/don't checklist |
