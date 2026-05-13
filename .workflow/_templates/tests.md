# Tests: <title>

**Plan**: [./plan.md](./plan.md)
**Status**: pending | passing | failing | skipped
**Cycle**: 1 of max 3

## Type-aware mode
Pick one. The rest of this doc is filled out only for the active mode.

- [ ] **Full** (type = feat / refactor)
- [ ] **Fix** (type = fix — regression test mandatory)
- [ ] **Skipped** (type = chore / docs / spike) — write the reason in `Skipped` and leave the rest blank.

## Coverage plan
- **Unit**: ...
- **Integration**: ...
- **E2E**: ...

## Regression test <!-- REQUIRED for type=fix -->
The test that pins the bug from coming back.

- **Path**: `path/to/test.ext`
- **Reproduces spec.md > Reproduction**: yes / no (explain)
- **Pre-fix verification**: how QA confirmed it fails on the old code (e.g., `git stash && npm test` → ❌; pop stash → ✅)

## Acceptance-criteria coverage
Every checkbox in `spec.md > Acceptance criteria` maps to at least one test below. If a criterion can't be tested, justify it here and tag the line for `retro`.

| Spec criterion | Test(s) | Verified |
|----------------|---------|----------|
| Criterion 1    | `path:line` | yes/no |

## Results
| Suite | Run | Pass | Fail | Notes |
|-------------|-----|------|------|-------|
| unit | 0 | 0 | 0 | — |
| integration | 0 | 0 | 0 | — |
| e2e | 0 | 0 | 0 | — |

## Failing
- `path:line` — symptom + root cause + fix attempt

## Skipped <!-- REQUIRED when mode = Skipped -->
- **Reason**: chore | docs | spike — and why no tests apply
- **Risk accepted**: <one line>

## Commands
```bash
# How to re-run locally
```
