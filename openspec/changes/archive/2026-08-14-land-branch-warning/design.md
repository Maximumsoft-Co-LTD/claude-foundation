# Design

## Current state

- Nothing in `runtime/workflow/` or `runtime/evidence/` reads a branch name;
  every land guard is commit-SHA-based. `recordRepositoryLand`
  (`land-runtime.mjs:376–414`) verifies sandbox HEAD/commit parity and
  cleanliness; `landCheck` (:99–199) verifies target-HEAD staleness and prints
  `LAND READY` with a `waived:` line pattern already in place.
- `git` and `gitHead` are injected into `createLandRuntime`, so a
  `rev-parse --abbrev-ref HEAD` against the target path is one call.
- `doctor` (`diagnostics-runtime.mjs:423–430`) detects the unwired
  `no-direct-main-commit.sh` by settings substring and reports at `info`;
  exit code changes only on `error`, so raising to `warn` is exit-neutral.
- The shipped hook fails open by design and stays opt-in.

## Decisions

- **Decision:** read the target's branch with
  `git rev-parse --abbrev-ref HEAD` in the target path; treat exactly `main`
  and `master` as default branches; `HEAD` (detached) and errors stay silent.
  - **Why:** warning-only surface — a false negative costs nothing new, a
    false positive would train users to ignore it.
  - **Rejected:** resolving `origin/HEAD` (network/remote assumptions);
    blocking (a policy change this change explicitly does not make).
- **Decision:** warn in `recordRepositoryLand` after the parity assertions,
  and add a `branch:` line to `LAND READY` in `landCheck` for the root target.
  - **Why:** `record` is where the Hydra incident happened (child commits on
    `main`); `landCheck`'s output line follows the established `waived:`
    pattern with no new output channel.
- **Decision:** doctor `no-direct-main` level becomes `warn` when disabled,
  stays `info` when enabled.
  - **Why:** the report's "harness did not guard this" gap; `warn` never
    changes the exit code, so CI consumers are unaffected.
- **Decision:** regression as a CLI-driving `node:test` suite with its own
  git superproject fixture (per the archive-telemetry suite pattern),
  asserting warn-on-main, silence-on-feature-branch, and the doctor level.

## Compatibility and migration

Output additions only; no wire formats, pins, or exit-code changes. Rollback
is removing the warnings.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| Branch read fails in bare/detached targets | errors and `HEAD` treated as silent; suite covers detached sandbox | test |
| Doctor level change breaks consumers parsing output | level moves within the existing vocabulary; exit code proven unchanged | test |
