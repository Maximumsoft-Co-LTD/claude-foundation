# Tasks

> This is the sole implementation ledger. Check an item only when its verify
> condition passes. Group by coherent behavior, not workflow phase. Add
> `[claims:<claim-id>]` after each stable task ID once evidence claims exist.

- [x] **T001** Warn on default-branch targets in `land record` and print a `branch:` line in `LAND READY` — `.claude/harness/runtime/workflow/land-runtime.mjs` — verify: suite sees the warning on `main`, silence on a feature branch and detached HEAD [repo:root] [paths:.claude/harness/runtime/workflow/land-runtime.mjs] [claims:record-warns-on-main,feature-branch-silent,check-reports-branch]
- [x] **T002** Escalate doctor `no-direct-main: disabled` to warn level — `.claude/harness/runtime/core/diagnostics-runtime.mjs` — verify: suite sees `WARN` with unchanged exit code [repo:root] [paths:.claude/harness/runtime/core/diagnostics-runtime.mjs] [claims:doctor-warns-unwired]
- [x] **T003** CLI-driving regression suite with a git superproject fixture, TAP via node:test — `.claude/tests/harness/run-branch-warning-tests.mjs` plus a `run` line and README row — verify: `node --test` passes locally and in run-all.sh [repo:root] [paths:.claude/tests/harness/run-branch-warning-tests.mjs,.claude/tests/run-all.sh,.claude/tests/README.md] [claims:record-warns-on-main,feature-branch-silent,check-reports-branch,doctor-warns-unwired] [depends:T001,T002]
