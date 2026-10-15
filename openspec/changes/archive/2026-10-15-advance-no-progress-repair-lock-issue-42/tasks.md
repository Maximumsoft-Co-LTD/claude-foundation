# Tasks

> This is the sole implementation ledger.

- [x] **T001** advance ส่ง cursor token และ gate ไม่นับ no-progress เมื่อ cursor เปลี่ยน [key:cursor-token] [kind:implementation] [paths:.claude/harness/runtime/evidence/proof-execution-runtime.mjs,.claude/harness/runtime/workflow/advance-runtime.mjs,.claude/harness/tests/proof-advance.test.mjs,.claude/harness/tests/advance-recovery.test.mjs] [claims:stale-gate-baseline-b-gate,stale-gate-baseline-gate-fail-findings-fingerprint,stale-gate-baseline-advance-proof-run-proof] — verify: `node --test .claude/harness/tests/proof-advance.test.mjs .claude/harness/tests/advance-recovery.test.mjs`
- [x] **T002** owner ของ lock ส่งต่อครบ และ owner ชั่วคราวเป็น WORKING [key:lock-owner] [kind:implementation] [paths:.claude/harness/runtime/evidence/proof-execution-runtime.mjs,.claude/harness/runtime/workflow/advance-runtime.mjs,.claude/harness/tests/advance-recovery.test.mjs] [depends:T001] [claims:transient-proof-lock-owner-advance,transient-proof-lock-owner-advance-2,transient-proof-lock-owner-advance-3] — verify: `node --test .claude/harness/tests/advance-recovery.test.mjs`
