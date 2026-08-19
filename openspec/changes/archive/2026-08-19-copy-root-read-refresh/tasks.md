# Tasks

> This is the sole implementation ledger.

- [x] **T001** Add source-aware repository selection so root packet validation uses target paths and its own repositories.yaml while active validation retains sandbox paths [claims:root-source-validation,multi-repository-source-selection] [repo:root] [kind:implementation] [paths:.claude/harness/runtime/workflow/repository-topology.mjs,.claude/harness/runtime/workflow/change-validation.mjs] — verify: `node --test .claude/harness/tests/repository-topology.test.mjs .claude/harness/tests/grounding-policy.test.mjs`
- [x] **T002** Bind sandbox sync root validation to the source-aware selection and cover the stale-root-read regression plus unchanged target-conflict behavior [claims:root-source-validation,multi-repository-source-selection] [repo:root] [kind:tests] [paths:.claude/harness/tests/repository-topology.test.mjs,.claude/harness/tests/grounding-policy.test.mjs,.claude/tests/harness/run-root-source-validation-tests.sh,.claude/tests/harness/run-target-drift-tests.sh] [depends:T001] — verify: `sh .claude/tests/harness/run-root-source-validation-tests.sh`
