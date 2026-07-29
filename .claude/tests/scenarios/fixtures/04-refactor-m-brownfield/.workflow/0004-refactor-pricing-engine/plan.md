# Plan: Extract the pricing engine

**Type**: refactor

## Summary

Introduce `PricingEngine` and delegate from `OrderService`, moving the math in small green steps guarded by a golden master.

## Technical Context

Coverage over the pricing path is thin today, so a characterization baseline is captured before any code moves.

## Current state

- Entry point — `app/services/order_service.rb#total`.
- Flow — `order_service.rb#total` → `order_service.rb#apply_discount` → `order_service.rb#round_tax` → returns cents.
- Blast radius — `order_service.rb#total` is called by the checkout controller and the nightly invoice job; both must see identical output.
- Anti-goals (behaviour that stays identical) — rounding direction in `order_service.rb#round_tax`, discount ordering in `order_service.rb#apply_discount`, and the integer-cents return shape of `order_service.rb#total`.

## Architecture diagram

```mermaid
flowchart LR
  Order[OrderService.total] --> Engine[PricingEngine]
  Engine --> Discount[applyDiscount]
  Engine --> Tax[roundTax]
```

## Phases for this task

Matrix defaults for type=refactor — no deviations. Task 1 captures the baseline before the move.

## Files to touch

- `app/services/order_service.rb` — delegate pricing to the engine
- `app/pricing/pricing_engine.rb` — new home for the math

## Risks

- A fixture may expose a latent bug; pin it, do not fix inline.

## Rollback

Inline the engine back into `OrderService`; the golden master still passes.
