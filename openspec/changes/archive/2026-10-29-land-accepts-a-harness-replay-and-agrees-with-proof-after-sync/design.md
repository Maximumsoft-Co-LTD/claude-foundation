# Design

## Work type

bugfix

## Bugfix analysis

| ส่วน | รายละเอียด |
|---|---|
| วิธีทำให้เกิดซ้ำ | A land แล้ว (uncommitted) → B ที่ branch ก่อน A land สั่ง advance --through archived → harness sync merge A เข้า sandbox ของ B สะอาด → Land ปฏิเสธ 'would overwrite an uncommitted target edit' ซ้ำจน HANDOFF; ต่อมา advance --through proven ตอบ 'proof is current; Land authority required' แต่ --through archived ตอบ 'Land requires current passing proof; lifecycle is building' |
| สาเหตุที่แท้จริง | targetEditCarried ตรวจด้วยการ merge base→target เข้า sandbox อีกรอบ ซึ่ง conflict เมื่อ hunk ของสอง change อยู่ติดกัน แม้ sandbox มีงานที่ land แล้วครบ (sync เป็นคนสร้าง bytes นั้น); landedResolved บันทึกเฉพาะ conflict จึงไม่ช่วย clean merge; sync ไม่ลบ proof-advance.json และ advance ถือ cursor PASS ที่ hash เดิมเป็น proof current ทั้งที่ sync เพิ่งตั้ง lifecycle เป็น building |
| หลักฐาน regression | unit test: saga preflight ผ่านเมื่อ landedReplay ตรงกับ sandbox และ landedSynced.target ตรงกับ target; seam test สอง change แก้บรรทัดติดกันในไฟล์เดียว land ซ้อนกันถึง archived; advance test: status building + cursor PASS → RUN_EXTERNAL proof advance ไม่ใช่ ASK_USER land-authority; sync test: invalidation ลบ proof-advance.json |

## ตารางความล้มเหลว

| Failure | User sees | Recovery | Covers |
|---|---|---|---|
| target เปลี่ยนหลัง sync | ยังปฏิเสธด้วย overwrite และเสนอ sync อีกครั้ง (landedSync) เพราะ bytes ไม่ตรงกับที่ sync เห็น | harness sync ใหม่แล้ว prove | replay-carries-landed |
| sync รายงาน conflict ที่ยังไม่ resolve | ปฏิเสธเหมือนเดิม ไม่ถือว่า carry | agent resolve แล้ว sync --resolve | replay-carries-landed |

## แผนที่ไฟล์

| Tasks | Paths |
|---|---|
| T001 | `.claude/harness/runtime/workflow/target-edits.mjs`, `.claude/harness/runtime/workflow/repository-delivery-saga.mjs`, `.claude/harness/runtime/workflow/apply-runtime.mjs`, `.claude/harness/tests/repository-delivery-saga.test.mjs`, `.claude/harness/tests/target-edits.test.mjs`, `.claude/harness/tests/concurrent-same-file.test.mjs`, `.claude/harness/tests/fixtures/concurrent-changes.mjs` |
| T002 | `.claude/harness/runtime/workflow/advance-runtime.mjs`, `.claude/harness/runtime/workflow/sandbox-runtime.mjs`, `.claude/harness/foundation.mjs`, `.claude/harness/tests/advance-runtime.test.mjs`, `.claude/harness/tests/sandbox-runtime-sync.test.mjs` |
| T003 | `WORKFLOW.md`, `CHANGELOG.md` |

`+` add · `~` change · `-` remove

```text
.
├── .claude/
│   └── harness/
│       ├── ~ foundation.mjs
│       ├── runtime/
│       │   └── workflow/
│       │       ├── ~ advance-runtime.mjs
│       │       ├── ~ apply-runtime.mjs
│       │       ├── ~ repository-delivery-saga.mjs
│       │       ├── ~ sandbox-runtime.mjs
│       │       └── ~ target-edits.mjs
│       └── tests/
│           ├── ~ advance-runtime.test.mjs
│           ├── ~ concurrent-same-file.test.mjs
│           ├── fixtures/
│           │   └── ~ concurrent-changes.mjs
│           ├── ~ repository-delivery-saga.test.mjs
│           ├── ~ sandbox-runtime-sync.test.mjs
│           └── ~ target-edits.test.mjs
├── ~ CHANGELOG.md
└── ~ WORKFLOW.md
```

## แผนที่ test

| Scenario | Level | Check | Task |
|---|---|---|---|
| insertion ติดกันใน repository sandbox; insertion ติดกันใน root workspace; target เปลี่ยนหลัง sync; sync รายงาน conflict ที่ยังไม่ resolve | task check | `node --test .claude/harness/tests/repository-delivery-saga.test.mjs .claude/harness/tests/target-edits.test.mjs .claude/harness/tests/concurrent-same-file.test.mjs` | T001 |
| cursor PASS แต่ lifecycle building; lifecycle proven และ cursor ตรง; sync ที่ invalidate ลบ checkpoint; sync ที่ไม่ invalidate คง checkpoint | task check | `node --test .claude/harness/tests/advance-runtime.test.mjs .claude/harness/tests/sandbox-runtime-sync.test.mjs` | T002 |
| insertion ติดกันใน repository sandbox; insertion ติดกันใน root workspace; target เปลี่ยนหลัง sync; sync รายงาน conflict ที่ยังไม่ resolve; cursor PASS แต่ lifecycle building; lifecycle proven และ cursor ตรง; sync ที่ invalidate ลบ checkpoint; sync ที่ไม่ invalidate คง checkpoint | task check | `bash .claude/tests/docs/run-doc-consistency.sh` | T003 |
