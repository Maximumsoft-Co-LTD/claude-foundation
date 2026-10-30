# Tasks

> This is the sole implementation ledger.

- [x] **T001** child-only Land แทนที่ root packet ด้วย sandbox packet เมื่อ amendment ตรง; unit + seam tests [key:project-amended-packet] [kind:implementation] [paths:.claude/harness/runtime/workflow/apply-runtime.mjs,.claude/harness/tests/child-only-ledger.test.mjs,.claude/harness/tests/concurrent-repositories.test.mjs] [claims:child-only-ledger-land-apply-archive,child-only-ledger-land-apply-archive-2,child-only-ledger-land-apply,child-only-ledger-land-apply-archive-3,child-only-ledger-land-apply-2] — verify: `node --test .claude/harness/tests/child-only-ledger.test.mjs .claude/harness/tests/concurrent-repositories.test.mjs`
- [x] **T002** WORKFLOW.md และ CHANGELOG อธิบายว่า child-only Land archive packet ที่ amend แล้ว [key:docs] [kind:implementation] [paths:WORKFLOW.md,CHANGELOG.md] [claims:child-only-ledger-land-apply-archive,child-only-ledger-land-apply-archive-2,child-only-ledger-land-apply,child-only-ledger-land-apply-archive-3,child-only-ledger-land-apply-2] — verify: `bash .claude/tests/docs/run-doc-consistency.sh`
