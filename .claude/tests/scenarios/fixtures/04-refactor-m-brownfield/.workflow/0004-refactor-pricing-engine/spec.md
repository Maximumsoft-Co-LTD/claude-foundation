# Spec: Extract the pricing engine from OrderService

**ID**: 0004-refactor-pricing-engine
**Type**: refactor
**Status**: approved
**Field**: brownfield

## Goal

Move the pricing math out of `OrderService` into a dedicated `PricingEngine`, with output that stays identical.

## Equivalence contract

Pricing output — subtotal, discount, tax, and total — MUST stay byte-identical for every existing order fixture before and after the extraction. This change has no observable behaviour.

**Acceptance scenarios**

- [x] **AC1** — **Given** the eight golden order fixtures, **When** each is priced through the extracted engine, **Then** every field matches the pre-refactor baseline exactly.

## Out of scope

The known rounding quirk on split discounts is not fixed here — it is pinned as a follow-up so the baseline stays honest.
