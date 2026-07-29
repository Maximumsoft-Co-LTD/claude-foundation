# Tasks: Extract the pricing engine

## Guardrails

- `` `app/services/order_service.rb#total` `` — returns integer cents to the checkout controller and the nightly invoice job; the return shape must not change.
- `` `app/services/order_service.rb#round_tax` `` — current rounding direction is the observed behaviour, latent bug or not; the golden master pins it, so do not "fix" it inline.
- `` `app/services/order_service.rb#apply_discount` `` — discount is applied before tax today; preserving that order is the equivalence claim.

## Phase 1 — Lock

- [x] T001 [AC1] Capture a characterization baseline (golden master) over the eight order fixtures — verify: the baseline is green on unchanged code and committed alone.

## Phase 2 — Extract

- [x] T002 [AC1] Move pricing math into `PricingEngine` and delegate from `OrderService` — verify: the golden-master baseline stays green after each step.
