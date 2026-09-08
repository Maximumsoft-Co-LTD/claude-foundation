# Tasks

> This is the sole implementation ledger.

- [x] **T001** Implement mode-complete conservative review identity, no-op sync preservation and precise invalidation; add deterministic regressions and align canonical EN/TH documentation and protocol compatibility where required. [key:implement-and-verify] [kind:implementation] [paths:.claude/harness/**,.claude/tests/**,.claude/cli.sh,README.md,README.th.md,WORKFLOW.md] [claims:copy-review-reuse,preserve-noop-proof,explain-review-invalidation] — verify: `rtk test bash .claude/tests/run-all.sh`
- [x] **T002** Align CLI/runtime API pins and documented invalidation semantics with the new additive diagnostics. [key:align-compatibility] [paths:cli.sh,.claude/harness/**,.claude/tests/**,README.md,README.th.md,WORKFLOW.md] [claims:reuse-wire-compatibility] — verify: `rtk test bash .claude/tests/run-all.sh`
- [x] **T003** Align the runtime API label in public website documents and verify the documentation build. [key:align-public-docs] [paths:website/index.html,website/docs/**] [claims:public-api-docs-alignment] — verify: `rtk npm --prefix website/docs run build`
- [x] **T004** Keep internal API guidance and shipping mutation fixtures aligned, and update the stale-review explanation assertion to the new precise contract. [key:repair-upgrade-detectors] [paths:scripts/quality/run-shipping-semantic-mutation.mjs,.claude/harness/AGENT.md,.claude/harness/DEVELOPER-SETUP.md,.claude/tests/harness/run-feedback-review-tests.sh] [claims:upgrade-detector-preservation] — verify: `rtk test bash .claude/tests/run-all.sh`
