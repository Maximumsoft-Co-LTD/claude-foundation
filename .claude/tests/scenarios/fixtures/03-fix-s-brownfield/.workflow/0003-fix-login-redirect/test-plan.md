# Test plan: Fix login redirect loop

## Coverage plan

| AC | Level | Asserts |
|----|-------|---------|
| AC1 | integration | admin sign-in lands on the dashboard with no bounce back to login |

## Regression contract

The T001 test MUST fail before the fix and pass after it. It stays in the suite permanently so the loop cannot silently return.

## Edge cases

- A non-admin sign-in still lands on its own landing page.
- An invalid credential is rejected and stays on login.
