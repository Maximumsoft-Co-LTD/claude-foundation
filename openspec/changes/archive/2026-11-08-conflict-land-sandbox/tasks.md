# Tasks

> This is the sole implementation ledger.

- [x] **T001** carryLandedOutput เก็บ digest ของ target ตอนคัดลอกไว้หลังการแก้ และ replayLandedChanges ถือ path นั้นเป็น resolved เมื่อ target ยังตรง [key:remember-carry-origin] [kind:implementation] [paths:.claude/harness/runtime/workflow/sandbox-runtime.mjs,.claude/harness/tests/landed-carry-sync.test.mjs,.claude/tests/run-all.sh,.claude/tests/README.md,CHANGELOG.md] [claims:landed-carry-no-false-conflict-advance-sync-land-sandbox,landed-carry-no-false-conflict-advance-sync,landed-carry-no-false-conflict-advance-sync-2] — verify: `node --test .claude/harness/tests/landed-carry-sync.test.mjs`
