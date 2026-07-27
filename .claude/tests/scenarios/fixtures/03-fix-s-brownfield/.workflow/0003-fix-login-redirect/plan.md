# Plan: Fix login redirect loop

**Type**: fix

## Summary

Persist the session before the post-login redirect so the auth guard observes it on the next request.

## Architecture diagram

```mermaid
flowchart LR
  Login[Login handler] --> Session[Persist session]
  Session --> Redirect[Redirect to dashboard]
  Redirect --> Guard[Auth guard sees session]
```

## Phases for this task

Matrix defaults for type=fix — no deviations. Task 1 is the failing regression test.

## Files to touch

- `app/auth/session_handler.rb` — set the session before issuing the redirect

## Rollback

Revert the single handler change; behaviour returns to the prior loop.
