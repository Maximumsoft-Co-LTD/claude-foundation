# Epic: <title>

**ID**: NNNN-type-slug
**Date**: YYYY-MM-DD
**Status**: epic
**Triggered by**: `Ship as: staged` + ≥2 independently-shippable capabilities

## Problem
One paragraph: the user-facing problem this epic solves and why it needs staged releases (not one big drop).

## Slices
Each slice becomes its own `/dev` run with `Parent: <this-id>`. Each must be shippable on its own — a real user gets real value when only that slice lands.

1. **<slug>** — <one-liner>
   - Acceptance: <one observable behaviour>
   - Estimated size: small | medium | large

2. **<slug>** — ...

## Recommended starting slice
Which slice goes first and why (smallest risk, unblocks others, fastest user value, etc.).

## Dependencies
- Slice 2 needs `<thing>` from slice 1 — hard dependency.
- Slice 3 is independent of 1 & 2.
- (If all independent, write "none — slices can ship in any order".)

## Out of epic
What's NOT covered, even across all slices. Future epics or never-doing.

## Child runs
Appended as slices spawn:
- [ ] `0006-feat-<slice-1-slug>` — created YYYY-MM-DD
- [ ] `0007-feat-<slice-2-slug>` — created YYYY-MM-DD
