# Tasks

> This is the sole implementation ledger.

- [x] **T001** rapidStartTemplate เพิ่ม minimalDraftRiskSignals และ minimalDraftFixes [key:template-guidance] [kind:implementation] [paths:.claude/harness/runtime/workflow/change-lifecycle.mjs,.claude/harness/tests/change-atomic-start.test.mjs] [claims:template-risk-guidance-change-start-template,template-risk-guidance-change-start-template-2,template-risk-guidance-change-start-template-3] — verify: `node --test .claude/harness/tests/change-atomic-start.test.mjs`
- [x] **T002** benchmark วัดยืนยันด้วย runs สองเท่าก่อนตัดสิน regression และเก็บ confirmation ใน receipt [key:benchmark-confirmation] [kind:implementation] [paths:.claude/harness/runtime/evidence/benchmark-runtime.mjs,.claude/harness/tests/benchmark-evidence.test.mjs,.claude/harness/EVIDENCE.md] [claims:benchmark-confirms-regression-prove-provider,benchmark-confirms-regression-prove-provider-2,benchmark-confirms-regression-prove-provider-3] — verify: `node --test .claude/harness/tests/benchmark-evidence.test.mjs`
