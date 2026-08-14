# Tasks

> This is the sole implementation ledger. Check an item only when its verify
> condition passes. Group by coherent behavior, not workflow phase. Add
> `[claims:<claim-id>]` after each stable task ID once evidence claims exist.

- [x] **T001** Archive runs one quiet telemetry sync before the destructive step and warns when no model usage was ever imported — `.claude/harness/runtime/workflow/apply-runtime.mjs` — verify: suite sees imported rows with a bound transcript and the warning without one [repo:root] [paths:.claude/harness/runtime/workflow/apply-runtime.mjs] [claims:archive-imports-telemetry,archive-warns-when-empty,telemetry-never-gates]
- [x] **T002** Expose a model-usage probe from the telemetry runtime and wire both dependencies at the composition root — `.claude/harness/runtime/observability/telemetry-runtime.mjs`, `.claude/harness/foundation.mjs` — verify: `run-wiring-tests.sh` passes [repo:root] [paths:.claude/harness/runtime/observability/telemetry-runtime.mjs,.claude/harness/foundation.mjs] [claims:archive-imports-telemetry] [depends:T001]
- [x] **T003** Regression suite driving the CLI through prove and archive with and without a bound transcript, TAP via node:test — `.claude/tests/harness/run-archive-telemetry-tests.mjs` plus a `run` line and README row — verify: `node --test` passes locally and in run-all.sh [repo:root] [paths:.claude/tests/harness/run-archive-telemetry-tests.mjs,.claude/tests/run-all.sh,.claude/tests/README.md] [claims:archive-imports-telemetry,archive-warns-when-empty,telemetry-never-gates] [depends:T001,T002]
