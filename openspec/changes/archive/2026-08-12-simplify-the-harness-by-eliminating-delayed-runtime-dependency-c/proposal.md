# Change: Simplify the harness by eliminating delayed runtime dependency cycles, slimming the composition root, and splitting the monolithic harness contract suite while preserving all observable behavior

## Why

The shipped runtime is domain-split, but its composition root still closes over
eight runtime objects before they are initialized. Those delayed references
hide dependency cycles that the wiring checker cannot validate. Independent
policies also remain in the entrypoint, while the main harness contract suite
combines unrelated domains in one 2,239-line script. The desired outcome is a
topologically constructed runtime, a composition-focused entrypoint, and
domain-focused test suites without changing observable behavior.

## What Changes

- Extract shared task/spec and changed-surface policy behind cohesive modules so
  packet, validation, and evidence construction no longer depend cyclically.
- Separate sandbox cleanup, apply transactions, archive orchestration, and
  transaction discovery so sandbox, Apply, Land, diagnostics, and abandon can be
  constructed in dependency order.
- Move command/config/budget/telemetry orchestration out of `foundation.mjs`
  where an existing runtime domain can own it.
- Split the harness contract script into domain suites behind the unchanged
  `run-all.sh` entrypoint.
- Preserve CLI output, validation, errors, persisted state, evidence semantics,
  installer behavior, and test coverage.

## Impact

- **Impact:** medium
- **Coupling:** coupled
- **Affected surfaces:** shipped runtime composition and repository-owned tests
- **Security triggers:** none

## Non-goals

- New commands, capabilities, validations, or user-visible behavior.
- Grouping dependencies into a generic context/service-locator object.
- Removing standalone installer parsing or ignored scratch directories.
- Fixing unrelated defects discovered during the restructure.
