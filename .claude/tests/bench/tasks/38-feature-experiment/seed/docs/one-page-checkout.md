# Experiment: one-page checkout

Key: `one-page-checkout`. Hypothesis: a single-page layout raises completed
orders. Variants: `control` renders the `"classic"` layout, `treatment` renders
the `"one-page"` layout.

## Assignment

- Signed-in shoppers are split 50/50 by a hash of experiment key and user id.
  The same user must always get the same variant, across requests, processes
  and deploys (no randomness, no stored state).
- Guests (no user id) always get `"classic"` and are not in the experiment.

## Exposure

When `render` shows a signed-in shopper their assigned layout, send exactly
one exposure event per user per checkout instance:

```json
{ "event": "experiment_exposure", "experiment": "one-page-checkout", "variant": "treatment", "userId": "u-123" }
```

Later renders for the same user send nothing. Guests send nothing.

## Kill switch

If `flags.isEnabled("one-page-checkout-kill")` is true at render time, every
shopper gets `"classic"` and no exposure event is sent. Turning the flag off
again resumes the original assignments.
