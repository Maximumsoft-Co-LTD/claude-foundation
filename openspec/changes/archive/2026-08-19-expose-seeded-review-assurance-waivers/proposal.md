# Change: Expose seeded review assurance waivers

## Why

Foundation labels its workflow risk-tiered while the seeded project policy permits self-review and same-model-family review. The waivers are documented and recorded in receipts, but an operator can still assume that the label itself guarantees independent diverse review before seeing a review packet.

## What changes

- Make doctor and change validation name when committed self-review or single-model waivers reduce review assurance.
- State the concrete consequence of each waiver before Prove without changing whether a review is required or valid.
- Pin JSON and human-readable diagnostics so future wording cannot silently imply independence or diversity.

## Impact

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** review policy diagnostics, doctor and change-validation output, operator documentation, review-policy tests
- **Security triggers:** review-trust-boundary

## Non-goals

- Change the seeded self or single-model policy values.
- Invalidate existing review receipts or alter their fingerprints.
- Require a human approval gate or a second model provider.
- Change reviewer dispatch or fallback behavior.
