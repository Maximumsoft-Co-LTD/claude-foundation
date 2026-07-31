# Context: pricing extraction (current-state map)

## Current state

`OrderService.total` computes subtotal, discount, tax, and total inline across a four-hop call chain. The math is entangled with order persistence in the same class.

## Blast radius

- `OrderService.total` — the entry point that will delegate to the engine.
- `applyDiscount` / `roundTax` — the two helpers that move with the math.

## Test infrastructure

Unit specs cover order persistence but not the pricing math directly, so a golden master is captured first.
