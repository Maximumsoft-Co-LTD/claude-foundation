# All-functions refactoring plan

> Generated from the versioned CRAP inventory; do not edit function rows by hand.

- Production functions planned: 3011
- Source commit: `b544b3b575959834783a0baf86c1e42724f659b1`
- Coverage model: branch-with-function-fallback

Every measured production function has exactly one action. Test, generated and vendored functions are excluded by project quality policy.

## Execution waves

| Wave | Meaning | Functions |
|---|---|---:|
| W1 | Critical refactors and coverage-mapping gaps | 4 |
| W2 | High-risk refactors | 115 |
| W3 | Remaining CRAP failures | 191 |
| W4 | Warning functions: test and simplify when touched | 79 |
| W5 | Passing but below changed-code coverage floor | 1324 |
| Continuous | Healthy functions to preserve | 1298 |

## Surface plans

| Surface | Functions | Fail | Warn | Unmapped | Plan |
|---|---:|---:|---:|---:|---|
| runtime | 2448 | 243 | 55 | 0 | [Open](./runtime.md) |
| dashboard | 346 | 50 | 17 | 0 | [Open](./dashboard.md) |
| examples | 187 | 17 | 6 | 0 | [Open](./examples.md) |
| website | 30 | 0 | 1 | 0 | [Open](./website.md) |

## Delivery rule

Work in small test-hardening and structural-refactor batches. A function may move to a later wave after new coverage changes its measured risk, but it may not disappear from the manifest without being deleted from production.

For every changed function: branch coverage must be at least 80%, extracted functions must have CC <=30 and CRAP <30, mutation score must not regress, no new Survived/NoCoverage mutant is allowed, and all required semantic mutants must remain killed.

The machine-readable source of this plan is [`quality/refactoring-plan-v1.json`](../../../quality/refactoring-plan-v1.json).
