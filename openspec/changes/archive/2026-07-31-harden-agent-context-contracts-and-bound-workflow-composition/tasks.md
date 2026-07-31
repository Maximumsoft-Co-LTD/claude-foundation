# Tasks

> This is the sole implementation ledger. Check an item only when its verify
> condition passes. Group by coherent behavior, not workflow phase.

- [x] **T001** Make agent output JSON-only and resume completed dependencies [kind:implementation] [paths:.claude/harness/foundation.mjs] [claims:agent-contract] — verify: `sh .claude/tests/harness/run-agent-contract-tests.sh`
- [x] **T002** Validate task claim authority and block unsafe dispatch [kind:security] [paths:.claude/harness/foundation.mjs] [claims:task-authority] — verify: `sh .claude/tests/harness/run-agent-contract-tests.sh`
- [x] **T003** Compact all plan and packet collections to exact emitted byte budgets [kind:architecture] [paths:.claude/harness/foundation.mjs] [depends:T001,T002] [claims:bounded-packets] — verify: `sh .claude/tests/harness/run-packet-scaling-tests.sh`
- [x] **T004** Scope task packet computation and route mixed model requirements honestly [kind:implementation] [paths:.claude/harness/foundation.mjs] [depends:T003] [claims:bounded-packets,model-routing] — verify: `sh .claude/tests/harness/run-agent-contract-tests.sh`
- [x] **T005** Make context telemetry non-blocking, concurrent-safe, tolerant, and bounded [kind:implementation] [paths:.claude/harness/foundation.mjs] [claims:context-accounting] — verify: `sh .claude/tests/harness/run-telemetry-concurrency-tests.sh`
- [x] **T006** Migrate only the legacy default packet policy and deep-merge partial policy [kind:migration] [paths:install.sh,foundation.json,.claude/harness/foundation.mjs,cli.sh] [claims:upgrade-compatibility] — verify: `sh .claude/tests/harness/run-upgrade-compat-tests.sh`
- [x] **T007** Bound hot-path skill composition and restore command resume semantics [kind:implementation] [paths:.claude/rules,.claude/skills,.claude/commands,.claude/harness/AGENT.md] [claims:bounded-skill-context] — verify: `sh .claude/tests/harness/run-context-budget-tests.sh`
- [x] **T008** Update public contracts and run deterministic regression [kind:test] [paths:README.md,README.th.md,WORKFLOW.md,CHANGELOG.md,.claude/harness/README.md,.claude/tests] [depends:T001,T002,T003,T004,T005,T006,T007] [claims:agent-contract,bounded-packets,task-authority,model-routing,context-accounting,upgrade-compatibility,bounded-skill-context] — verify: `sh .claude/tests/run-all.sh`
