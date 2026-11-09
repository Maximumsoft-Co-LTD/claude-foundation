# Tasks

> This is the sole implementation ledger.

- [x] **T001** planVisualRepair บันทึก drift เมื่อ workspace ไม่เปลี่ยนจาก batch ล่าสุด และข้อความ repair บอกทาง resume โดยไม่แก้ [key:unchanged-resume-drift] [kind:implementation] [paths:.claude/harness/runtime/evidence/repair-runtime.mjs,.claude/harness/runtime/evidence/proof-execution-runtime.mjs,.claude/harness/tests/visual-repair.test.mjs,.claude/harness/tests/visual-drift-decision.test.mjs,.claude/harness/EVIDENCE.md,WORKFLOW.md,CHANGELOG.md] [claims:visual-declined-repair-escalates-resume-workspace-hash-repair,visual-declined-repair-escalates-prove,visual-declined-repair-escalates-prove-2,visual-declined-repair-escalates-prove-3] — verify: `node --test .claude/harness/tests/visual-repair.test.mjs .claude/harness/tests/visual-drift-decision.test.mjs`
