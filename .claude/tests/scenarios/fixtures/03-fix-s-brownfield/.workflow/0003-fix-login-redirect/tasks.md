# Tasks: Fix login redirect loop

## Guardrails

- `` `app/auth/guard.rb#call` `` — deny-by-default on a missing session; the fix must write the session earlier, never loosen this check.
- `` `app/auth/session_handler.rb#after_login` `` — shared by password login and the SSO callback; both paths must keep working after the reorder.

## Phase 1 — Reproduce

- [x] T001 [AC1] Write a failing regression test that reproduces the admin login loop — verify: the new test fails on current `main` for the documented reason.

## Phase 2 — Fix

- [x] T002 [AC1] Persist the session before the redirect decision — verify: T001's regression test now passes and no other auth spec regresses.
