# Tasks

> This is the sole implementation ledger.

- [x] **T001** binding strict ที่ claims ว่างหรือมี claim ไม่รู้จักทำให้ทุก claim ต้องการ visual และ provider คืน error โดยไม่เรียก reviewer [key:fail-closed-binding-claims] [kind:implementation] [paths:.claude/harness/runtime/evidence/visual-review.mjs,.claude/harness/runtime/evidence/evidence-contract.mjs,.claude/harness/tests/visual-binding-claims.test.mjs,.claude/harness/tests/visual-binding-record.test.mjs,.claude/harness/EVIDENCE.md,.claude/tests/run-all.sh,.claude/tests/README.md,CHANGELOG.md] [claims:visual-binding-claims-fail-closed-prove-contract-provider-visual,visual-binding-claims-fail-closed-prove,visual-binding-claims-fail-closed-prove-2,visual-binding-claims-fail-closed-prove-3] — verify: `node --test .claude/harness/tests/visual-binding-claims.test.mjs .claude/harness/tests/visual-binding-record.test.mjs`
