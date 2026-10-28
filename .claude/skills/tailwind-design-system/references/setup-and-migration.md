# Tailwind Design System — Setup & Migration

Read when scaffolding a v4 project's CSS-first config or migrating a v3 project.

## Minimal v4 setup

```css
/* app.css */
@import "tailwindcss";

@theme {
  /* Semantic tokens in OKLCH; one light default per role */
  --color-background: oklch(100% 0 0);
  --color-foreground: oklch(14.5% 0.025 264);
  --color-primary: oklch(14.5% 0.025 264);
  --color-primary-foreground: oklch(98% 0.01 264);
  --color-secondary: oklch(96% 0.01 264);
  --color-secondary-foreground: oklch(14.5% 0.025 264);
  --color-muted: oklch(96% 0.01 264);
  --color-muted-foreground: oklch(46% 0.02 264);
  --color-accent: oklch(96% 0.01 264);
  --color-accent-foreground: oklch(14.5% 0.025 264);
  --color-destructive: oklch(53% 0.22 27);
  --color-destructive-foreground: oklch(98% 0.01 264);
  --color-border: oklch(91% 0.01 264);
  --color-ring: oklch(14.5% 0.025 264);
  --color-ring-offset: oklch(100% 0 0);
  --color-card: oklch(100% 0 0);
  --color-card-foreground: oklch(14.5% 0.025 264);

  --radius-sm: 0.25rem;
  --radius-md: 0.375rem;
  --radius-lg: 0.5rem;
  --radius-xl: 0.75rem;

  /* Keyframes inside @theme are emitted when an --animate-* token references them */
  --animate-fade-in: fade-in 0.2s ease-out;
  --animate-fade-out: fade-out 0.2s ease-in;
  @keyframes fade-in { from { opacity: 0 } to { opacity: 1 } }
  @keyframes fade-out { from { opacity: 1 } to { opacity: 0 } }
}

/* Class-based dark mode */
@custom-variant dark (&:where(.dark, .dark *));

.dark {
  --color-background: oklch(14.5% 0.025 264);
  --color-foreground: oklch(98% 0.01 264);
  --color-primary: oklch(98% 0.01 264);
  --color-primary-foreground: oklch(14.5% 0.025 264);
  --color-secondary: oklch(22% 0.02 264);
  --color-secondary-foreground: oklch(98% 0.01 264);
  --color-muted: oklch(22% 0.02 264);
  --color-muted-foreground: oklch(65% 0.02 264);
  --color-accent: oklch(22% 0.02 264);
  --color-accent-foreground: oklch(98% 0.01 264);
  --color-destructive: oklch(42% 0.15 27);
  --color-destructive-foreground: oklch(98% 0.01 264);
  --color-border: oklch(22% 0.02 264);
  --color-ring: oklch(83% 0.02 264);
  --color-ring-offset: oklch(14.5% 0.025 264);
  --color-card: oklch(14.5% 0.025 264);
  --color-card-foreground: oklch(98% 0.01 264);
}

@layer base {
  * { @apply border-border; }
  body { @apply bg-background text-foreground antialiased; }
}
```

Every semantic role declared in `@theme` needs a `.dark` override, or the dark
theme silently falls back to the light value.

## Core concepts

- **Token hierarchy:** brand (abstract) → semantic (`--color-primary`) →
  component usage (`bg-primary`).
- **Component architecture:** base styles → variants → sizes → states → one
  override seam (`className`).

## v3 → v4 migration checklist

- [ ] Replace `tailwind.config.ts` with a CSS `@theme` block.
- [ ] Change `@tailwind base/components/utilities` to `@import "tailwindcss"`.
- [ ] Move color definitions to `@theme { --color-*: value }`.
- [ ] Replace `darkMode: "class"` with `@custom-variant dark`.
- [ ] Move `@keyframes` inside `@theme` so they ship with their tokens.
- [ ] Replace `require("tailwindcss-animate")` with native CSS animations.
- [ ] Update `h-10 w-10` to `size-10`.
- [ ] Remove `forwardRef` where React 19 passes `ref` as a prop.
- [ ] Consider OKLCH for new color tokens.
- [ ] Replace custom plugins with `@utility` directives
  (see [utilities-and-advanced](utilities-and-advanced.md)).

Verify the migration with the project build and the generated CSS, then remove
v3 paths only after every consumer has moved.
