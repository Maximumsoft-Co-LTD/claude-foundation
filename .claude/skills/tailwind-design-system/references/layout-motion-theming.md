# Tailwind Design System — Layout, Motion & Theming

Read for responsive primitives, native v4 animation, and dark-mode wiring.

## Pattern 4: Responsive grid and container

Encode breakpoint ladders once in a variant so call sites never repeat
`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`.

```typescript
// components/ui/grid.tsx
const gridVariants = cva('grid', {
  variants: {
    cols: {
      1: 'grid-cols-1',
      2: 'grid-cols-1 sm:grid-cols-2',
      3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
      4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4',
    },
    gap: { none: 'gap-0', sm: 'gap-2', md: 'gap-4', lg: 'gap-6', xl: 'gap-8' },
  },
  defaultVariants: { cols: 3, gap: 'md' },
})

export function Grid({ className, cols, gap, ...props }: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof gridVariants>) {
  return <div className={cn(gridVariants({ cols, gap, className }))} {...props} />
}

const containerVariants = cva('mx-auto w-full px-4 sm:px-6 lg:px-8', {
  variants: { size: { sm: 'max-w-screen-sm', md: 'max-w-screen-md', lg: 'max-w-screen-lg', xl: 'max-w-screen-xl', full: 'max-w-full' } },
  defaultVariants: { size: 'xl' },
})

export function Container({ className, size, ...props }: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof containerVariants>) {
  return <div className={cn(containerVariants({ size, className }))} {...props} />
}
```

Prefer container queries (`--container-*` tokens, see
[utilities-and-advanced](utilities-and-advanced.md)) when a component must adapt
to its slot rather than the viewport.

## Pattern 5: Native CSS animation

Declare motion as `--animate-*` tokens with their keyframes, then reference them
through `data-[state=...]` or `[popover]` selectors; no animation plugin.

```css
@theme {
  --animate-dialog-in: dialog-fade-in 0.2s ease-out;
  --animate-dialog-out: dialog-fade-out 0.15s ease-in;
  @keyframes dialog-fade-in { from { opacity: 0; transform: scale(0.95) translateY(-0.5rem) } to { opacity: 1; transform: none } }
  @keyframes dialog-fade-out { from { opacity: 1; transform: none } to { opacity: 0; transform: scale(0.95) translateY(-0.5rem) } }
}

/* Native popover entry/exit with @starting-style */
[popover] { transition: opacity 0.2s, transform 0.2s, display 0.2s allow-discrete; opacity: 0; transform: scale(0.95); }
[popover]:popover-open { opacity: 1; transform: scale(1); }
@starting-style { [popover]:popover-open { opacity: 0; transform: scale(0.95); } }
```

```typescript
// components/ui/dialog.tsx (Radix primitive + token animations)
<DialogPrimitive.Overlay className={cn('fixed inset-0 z-50 bg-black/80', 'data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out')} />
<DialogPrimitive.Content className={cn(
  'fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 border border-border bg-background p-6 shadow-lg sm:rounded-lg',
  'data-[state=open]:animate-dialog-in data-[state=closed]:animate-dialog-out'
)} />
```

Gate every nonessential animation behind `motion-safe:` or a
`prefers-reduced-motion` check; the component contract includes reduced motion.

## Pattern 6: Dark mode

With `@custom-variant dark (&:where(.dark, .dark *))` in the stylesheet, the
provider only toggles the class and persists the choice.

```typescript
// providers/ThemeProvider.tsx
'use client'
type Theme = 'dark' | 'light' | 'system'

export function ThemeProvider({ children, defaultTheme = 'system', storageKey = 'theme' }) {
  const [theme, setTheme] = useState<Theme>(defaultTheme)
  const [resolvedTheme, setResolvedTheme] = useState<'dark' | 'light'>('light')

  useEffect(() => {
    const stored = localStorage.getItem(storageKey) as Theme | null
    if (stored) setTheme(stored)
  }, [storageKey])

  useEffect(() => {
    const resolved = theme === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme
    const root = document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add(resolved)
    setResolvedTheme(resolved)
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', resolved === 'dark' ? '#09090b' : '#ffffff')
  }, [theme])

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme: (t) => { localStorage.setItem(storageKey, t); setTheme(t) } }}>
      {children}
    </ThemeContext.Provider>
  )
}

// components/ThemeToggle.tsx
<Button variant="ghost" size="icon" onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
  <Sun className="size-5 dark:hidden" />
  <Moon className="hidden size-5 dark:block" />
  <span className="sr-only">Toggle theme</span>
</Button>
```

Test both themes for every state in the component contract; a token missing its
`.dark` override is the most common dark-mode defect.
