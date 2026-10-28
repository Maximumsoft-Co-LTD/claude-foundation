# Tailwind Design System — Utilities & Advanced v4

Read for the class-merging helper, `@utility`, theme modifiers, and the do/don't list.

## `cn()` helper

```typescript
// lib/utils.ts
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
export const disabled = "disabled:pointer-events-none disabled:opacity-50";
```

One merging convention per project; `twMerge` resolves conflicting utilities so
`className` overrides win predictably.

## `@utility` — custom utilities

```css
@utility text-gradient {
  @apply bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent;
}
```

Use `@utility` instead of a JS plugin for anything expressible in CSS.

## Theme modifiers

```css
/* reference other CSS variables without resolving them */
@theme inline { --font-sans: var(--font-inter), system-ui; }

/* always emit the variable, even when no utility uses it */
@theme static { --color-brand: oklch(65% 0.15 240); }

/* or globally: */
@import "tailwindcss" theme(static);
```

## Namespace overrides and derived colors

```css
@theme {
  --color-*: initial;                 /* drop every default color */
  --color-primary: oklch(45% 0.2 260);
  --color-primary-50: color-mix(in oklab, var(--color-primary) 5%, transparent);
  --color-primary-100: color-mix(in oklab, var(--color-primary) 10%, transparent);

  --container-sm: 24rem;              /* container-query breakpoints */
  --container-md: 28rem;
}
```

## Do / Don't

| Do | Don't |
|---|---|
| Configure in `@theme` blocks | Keep `tailwind.config.ts` or `@tailwind` directives |
| Use semantic tokens (`bg-primary`) | Hardcode palette colors (`bg-blue-500`) or arbitrary values that bypass tokens |
| Prefer OKLCH for new tokens | Mix color spaces inside one role |
| Compose variants with CVA | Encode variants as ad hoc `className` strings at call sites |
| Use `size-*` for square boxes | Repeat `h-* w-*` pairs |
| Ship focus, disabled, reduced-motion, and dark states | Leave a token without its `.dark` override |
