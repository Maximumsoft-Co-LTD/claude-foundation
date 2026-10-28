# Tailwind Design System — Component Patterns

Read for the shape of a shared component: CVA variants, compound parts, and
form controls. `cn()` comes from [utilities-and-advanced](utilities-and-advanced.md).

## Pattern 1: CVA variants

```typescript
// components/ui/button.tsx
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border border-border bg-background hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'size-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  ref?: React.Ref<HTMLButtonElement> // React 19: ref is a prop, no forwardRef
}

export function Button({ className, variant, size, asChild = false, ref, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button'
  return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
}

// <Button variant="destructive" size="lg">Delete</Button>
// <Button asChild><Link href="/home">Home</Link></Button>
```

Rules: every state the contract promises (focus-visible, disabled, loading,
invalid) lives in the base string or a variant, never in call sites; `className`
is the only override seam.

## Pattern 2: Compound components

Each part is a plain function taking `ref` as a prop; all parts share one token
vocabulary so a consumer can restyle a part without breaking the others.

```typescript
// components/ui/card.tsx
import { cn } from '@/lib/utils'

type DivProps = React.HTMLAttributes<HTMLDivElement> & { ref?: React.Ref<HTMLDivElement> }

export function Card({ className, ref, ...props }: DivProps) {
  return <div ref={ref} className={cn('rounded-lg border border-border bg-card text-card-foreground shadow-sm', className)} {...props} />
}
export function CardHeader({ className, ref, ...props }: DivProps) {
  return <div ref={ref} className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />
}
export function CardTitle({ className, ref, ...props }: React.HTMLAttributes<HTMLHeadingElement> & { ref?: React.Ref<HTMLHeadingElement> }) {
  return <h3 ref={ref} className={cn('text-2xl font-semibold leading-none tracking-tight', className)} {...props} />
}
export function CardContent({ className, ref, ...props }: DivProps) {
  return <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
}
export function CardFooter({ className, ref, ...props }: DivProps) {
  return <div ref={ref} className={cn('flex items-center p-6 pt-0', className)} {...props} />
}
```

## Pattern 3: Form controls

The control owns its invalid state and the error's accessible wiring
(`aria-invalid`, `aria-describedby`, `role="alert"`); the form library only
supplies the message.

```typescript
// components/ui/input.tsx
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string
  ref?: React.Ref<HTMLInputElement>
}

export function Input({ className, type, error, ref, ...props }: InputProps) {
  const errorId = error ? `${props.id}-error` : undefined
  return (
    <div className="relative">
      <input
        type={type}
        ref={ref}
        aria-invalid={!!error}
        aria-describedby={errorId}
        className={cn(
          'flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          error && 'border-destructive focus-visible:ring-destructive',
          className
        )}
        {...props}
      />
      {error && <p id={errorId} role="alert" className="mt-1 text-sm text-destructive">{error}</p>}
    </div>
  )
}

// Usage with react-hook-form + zod: pass errors.email?.message as `error`
// and keep <Label htmlFor="email"> paired with id="email".
```

Prove each pattern with the project's browser or accessibility provider:
keyboard focus ring visible, error announced, disabled state not clickable.
