# All-functions refactoring plan

> Generated from the versioned CRAP inventory; do not edit function rows by hand.

- Production functions planned: 3406
- Source commit: `5619a6e36c86686c9f498e7b3d8206cd6034735d`
- Coverage model: branch-with-function-fallback

Every measured production function has exactly one action. Test, generated and vendored functions are excluded by project quality policy.

## Execution waves

| Wave | Meaning | Functions |
|---|---|---:|
| W1 | Critical refactors and coverage-mapping gaps | 0 |
| W2 | High-risk refactors | 17 |
| W3 | Remaining CRAP failures | 63 |
| W4 | Warning functions: test and simplify when touched | 39 |
| W5 | Passing but below changed-code coverage floor | 770 |
| Continuous | Healthy functions to preserve | 2517 |

## Surface plans

| Surface | Functions | Fail | Warn | Unmapped | Plan |
|---|---:|---:|---:|---:|---|
| runtime | 2802 | 24 | 16 | 0 | [Open](./runtime.md) |
| dashboard | 387 | 39 | 16 | 0 | [Open](./dashboard.md) |
| examples | 187 | 17 | 6 | 0 | [Open](./examples.md) |
| website | 30 | 0 | 1 | 0 | [Open](./website.md) |

## Delivery rule

Work in small test-hardening and structural-refactor batches. A function may move to a later wave after new coverage changes its measured risk, but it may not disappear from the manifest without being deleted from production.

For every changed function: branch coverage must be at least 80%, extracted functions must have CC <=30 and CRAP <30, mutation score must not regress, no new Survived/NoCoverage mutant is allowed, and all required semantic mutants must remain killed.

The machine-readable source of this plan is [`quality/refactoring-plan-v1.json`](../../../quality/refactoring-plan-v1.json).
