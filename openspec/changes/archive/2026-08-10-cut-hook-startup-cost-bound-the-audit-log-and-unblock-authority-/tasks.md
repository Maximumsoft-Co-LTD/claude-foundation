# Tasks

> This is the sole implementation ledger. Check an item only when its verify
> condition passes.

- [x] **T001** shell prefilter answers the no-phase case without starting Node and delegates otherwise — `.claude/hooks/phase-mutation-guard.sh` — verify: `sh .claude/tests/hooks/run-phase-mutation-guard-tests.sh` [claims:prefilter-skips-only-what-the-guard-skips] [repo:root] [paths:.claude/hooks/phase-mutation-guard.sh]
- [x] **T002** enforcement is unchanged through the prefilter, including block mode — `.claude/hooks/phase-mutation-guard.sh` — verify: `sh .claude/tests/hooks/run-phase-mutation-guard-tests.sh` [claims:guard-still-enforces-through-the-prefilter] [repo:root] [paths:.claude/hooks/phase-mutation-guard.sh,.claude/settings.json]
- [x] **T003** installer retires the previously wired `.mjs` guard command so an upgrade runs one guard — `install.sh` — verify: `sh .claude/tests/harness/run-installer-tests.sh` [claims:upgrade-runs-one-guard-not-two] [repo:root] [paths:install.sh,.claude/settings.json]
- [x] **T004** `recordAudit` rotates the guardrail audit log at a size cap keeping one generation — `.claude/hooks/phase-mutation-guard.mjs` — verify: `sh .claude/tests/hooks/run-phase-mutation-guard-tests.sh` [claims:audit-log-stays-bounded] [repo:root] [paths:.claude/hooks/phase-mutation-guard.mjs]
- [x] **T005** review response template carries reviewer and subject provenance, and the receipt error names the response file for authority-bridge recording — `.claude/harness/runtime/workflow/authority-runtime.mjs`, `.claude/harness/runtime/evidence/receipt-runtime.mjs` — verify: `sh .claude/tests/harness/run-changeloop-seam-tests.sh` [claims:authority-review-response-records] [repo:root] [paths:.claude/harness/runtime/workflow/authority-runtime.mjs,.claude/harness/runtime/evidence/receipt-runtime.mjs,.claude/tests/harness/run-changeloop-seam-tests.sh]
