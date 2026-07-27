# Tasks: Extract the pricing engine

## Phase 1 — Lock

- [x] T001 [AC1] Capture a characterization baseline (golden master) over the eight order fixtures — verify: the baseline is green on unchanged code and committed alone.

## Phase 2 — Extract

- [x] T002 [AC1] Move pricing math into `PricingEngine` and delegate from `OrderService` — verify: the golden-master baseline stays green after each step.
