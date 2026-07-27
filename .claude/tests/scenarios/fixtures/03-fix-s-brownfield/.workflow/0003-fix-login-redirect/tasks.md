# Tasks: Fix login redirect loop

## Phase 1 — Reproduce

- [x] T001 [AC1] Write a failing regression test that reproduces the admin login loop — verify: the new test fails on current `main` for the documented reason.

## Phase 2 — Fix

- [x] T002 [AC1] Persist the session before the redirect decision — verify: T001's regression test now passes and no other auth spec regresses.
