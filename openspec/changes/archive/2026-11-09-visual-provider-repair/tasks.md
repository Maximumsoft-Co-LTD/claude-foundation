# Tasks

> This is the sole implementation ledger.

- [x] **T001** visualRepairSplit วางแผนรอบเดียวต่อ Prove จาก finding ของทุก provider ที่ไม่ผ่าน และ drift เก็บ finding ระบุ provider [key:one-round-per-pass] [kind:implementation] [paths:.claude/harness/runtime/evidence/repair-runtime.mjs,.claude/harness/runtime/evidence/proof-execution-runtime.mjs,.claude/harness/runtime/evidence/visual-review.mjs,.claude/harness/runtime/workflow/change-validation.mjs,.claude/harness/tests/visual-repair.test.mjs,.claude/harness/tests/visual-drift-decision.test.mjs,.claude/harness/EVIDENCE.md,WORKFLOW.md,CHANGELOG.md] [claims:visual-multi-provider-one-round-prove,visual-multi-provider-one-round-resume-workspace,visual-multi-provider-one-round-prove-2,visual-multi-provider-one-round-prove-3,visual-multi-provider-one-round-advance] — verify: `node --test .claude/harness/tests/visual-repair.test.mjs .claude/harness/tests/visual-drift-decision.test.mjs`
