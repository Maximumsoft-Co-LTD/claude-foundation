# Tasks

> This is the sole implementation ledger. Check an item only when its verify
> condition passes. Group by coherent behavior, not workflow phase. Add
> `[claims:<claim-id>]` after each stable task ID once evidence claims exist.

- [x] **T001** Stale-proof refusal states the recovery order and prove command — `.claude/harness/runtime/workflow/land-runtime.mjs` — verify: suite sees the hint on a post-Prove edit [repo:root] [paths:.claude/harness/runtime/workflow/land-runtime.mjs] [claims:stale-proof-hint]
- [x] **T002** Stale-authority refusal states attest-last and the re-request command — `.claude/harness/runtime/workflow/authority-runtime.mjs` — verify: suite sees the hint on a post-request edit [repo:root] [paths:.claude/harness/runtime/workflow/authority-runtime.mjs] [claims:stale-authority-hint]
- [x] **T003** CLI-driving regression suite, TAP via node:test — `.claude/tests/harness/run-stale-recovery-tests.mjs` plus a `run` line and README row — verify: `node --test` passes locally and in run-all.sh [repo:root] [paths:.claude/tests/harness/run-stale-recovery-tests.mjs,.claude/tests/run-all.sh,.claude/tests/README.md] [claims:stale-proof-hint,stale-authority-hint,fresh-state-unchanged] [depends:T001,T002]
