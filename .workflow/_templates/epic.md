# Epic: <title>

**ID**: NNNN-type-slug · **Date**: YYYY-MM-DD · **Status**: epic · **Triggered by**: `Ship as: staged` + ≥2 independently-shippable capabilities

## Problem
One paragraph: the user-facing problem this epic solves + why it needs staged releases (not one big drop).

## Slices
Each slice becomes its own `/dev` run with `Parent: <this-id>` and must be shippable on its own (a real user gets real value when only that slice lands).

1. **<slug>** — <one-liner> · Acceptance: <one observable behaviour> · Size: small | medium | large

## Recommended starting slice
Which slice goes first + why (smallest risk / unblocks others / fastest user value).

## Child runs
Appended as slices spawn:
- [ ] `NNNN-feat-<slice-slug>` — created YYYY-MM-DD

<!--
The sections above are always required for an epic. Add the sections below ONLY when they apply, then DELETE them if not:
- Dependencies — cross-slice ordering ("Slice 2 needs <thing> from slice 1 — hard dep"; write "none — slices can ship in any order" if all independent)
- Out of epic — what's NOT covered across all slices (future epics / never-doing), when scope-creep is a real risk
-->
