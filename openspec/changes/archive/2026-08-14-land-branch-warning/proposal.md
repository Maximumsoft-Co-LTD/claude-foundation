# Change: land-branch-warning

## Why

The harness verifies that a landed commit matches the proven evidence but
never looks at which branch it lands on. In a consumer round (Hydra dashboard,
2026-08-14) both repositories' commits were created directly on `main` against
the project's branch-first rule; nothing warned, and the work had to be moved
retroactively after the user noticed. The shipped `no-direct-main-commit.sh`
guard is opt-in, unwired, and `doctor` mentions that only at `info` level.

## What changes

- `land record` warns — without blocking — when the target repository's
  checked-out branch is `main` or `master`, naming the repository and branch.
- `land check` prints a `branch:` line alongside the existing `LAND READY`
  output when the root target is checked out on `main`/`master`.
- `doctor` reports `no-direct-main: disabled` at `warn` level instead of
  `info`, so the unwired guard is visible before it costs a retroactive move.

## Impact

- **Impact:** medium
- **Coupling:** coupled
- **Affected surfaces:** shipped runtime (`land-runtime.mjs`,
  `diagnostics-runtime.mjs`), deterministic tests.
- **Security triggers:** none.

## Non-goals

- No blocking gate and no policy change: `no-direct-main-commit.sh` stays
  opt-in and unwired; wiring it by default is a separate decision.
- No branch detection for detached HEADs — a detached target stays silent.
