# Tasks

> This is the sole implementation ledger.

- [x] **T001** Exit hook logs based on pre-command status: successful archive logs its row; commands on already-archived changes do not [kind:implementation] [paths:.claude/harness/foundation.mjs] — verify: `node --test --test-reporter=tap .claude/tests/harness/run-archive-telemetry-tests.mjs`
- [x] **T002** Regression tests pin both behaviors in the archive-telemetry suite [kind:test] [paths:.claude/tests/harness/run-archive-telemetry-tests.mjs] — verify: `node --test --test-reporter=tap .claude/tests/harness/run-archive-telemetry-tests.mjs`
