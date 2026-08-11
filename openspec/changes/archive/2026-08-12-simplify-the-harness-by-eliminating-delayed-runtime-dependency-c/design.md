# Design

## Current state

- `.claude/harness/foundation.mjs` is 2,018 lines and declares eight runtime
  handles with `let`; callbacks close over several before assignment.
- `wiring-check.mjs` proves required factory keys are supplied and runtime
  modules are reachable, but it cannot prove initialization order.
- `change-validation.mjs` owns task/spec parsing, lifecycle validation,
  capability/evidence planning, and traceability. `apply-runtime.mjs` owns apply
  transactions, sandbox cleanup, spec synchronization, and archive.
- `run-harness-tests.sh` is 2,239 lines and covers change policy, evidence,
  telemetry, sandbox/apply/Land, multi-repository behavior, and leases.
- `sh .claude/tests/run-all.sh` passed before the first structural edit.

## Decisions

- **Decision:** Remove delayed runtime bindings by extracting their shared
  decisions and constructing factories in dependency order.
  - **Why:** This makes initialization safety explicit and statically
    checkable instead of relying on callbacks not firing during construction.
  - **Rejected:** A generic dependency container shortens signatures but hides
    the same coupling and weakens the existing wiring check.
- **Decision:** Split modules by owned policy or mechanism, not by line count.
  - **Why:** Task/spec interpretation, changed-surface policy, projection
    transactions, cleanup, and archive each have different callers and reasons
    to change.
  - **Rejected:** Moving arbitrary functions into helper files would add
    shallow pass-through layers.
- **Decision:** Use leaf-first, behavior-preserving slices and keep the public
  runner and CLI surfaces unchanged.
  - **Why:** Every slice remains releasable and can be reverted independently.
  - **Rejected:** A flag-day rewrite would obscure behavioral drift and make
    rollback all-or-nothing.

## Compatibility and migration

No public or persisted contract changes. New shipped module imports require all
four runtime API pins to move together so a mixed-revision install fails at
load. Rollback is per completed slice; no data migration is required.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| Initialization order changes expose a hidden construction-time call | Remove one cycle at a time and run wiring plus focused harness tests after each slice | static-analysis, test |
| Moving archive/apply code changes recovery or cleanup behavior | Preserve function bodies first, then rewire; exercise transaction, recovery, abandon, and Land scenarios | test |
| Splitting tests silently drops coverage | Move existing assertions unchanged and add runner floors/inventory checks | test |
| New modules create mixed-install failures | Bump and verify all runtime API pins and run upgrade compatibility tests | compatibility |
