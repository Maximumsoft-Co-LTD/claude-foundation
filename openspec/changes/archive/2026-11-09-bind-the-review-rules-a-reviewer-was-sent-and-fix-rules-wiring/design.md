# Design

## Work type

bugfix

## Bugfix analysis

| ส่วน | รายละเอียด |
|---|---|
| วิธีทำให้เกิดซ้ำ | รัน node .claude/tests/harness/run-risk-tiered-review-tests.mjs หลัง commit 1a2c008b ได้ TypeError: currentReviewRulesHash is not a function ใน CASE-REVIEW-REPAIR-CLOSURE |
| สาเหตุที่แท้จริง | createReceiptValidity ไม่มีค่า default ของ currentReviewRulesHash แต่ทุก review receipt มีฟิลด์ reviewRulesHash แล้ว และ receipt อ่าน hash ตอนบันทึกแทนที่จะใช้ค่าที่ส่งไปกับ dispatch |
| หลักฐาน regression | review-repair-closure.test.mjs สร้าง receipt validity โดยไม่ส่ง callback และบันทึก receipt ผ่าน dispatch attempt หลังแก้ REVIEW.md ระหว่างรีวิว |

## Decisions

- **Decision ID:** DEC-001
  - **Status:** accepted
  - **Decision:** เก็บ reviewRulesHash เป็นฟิลด์ระดับบนสุดของ dispatch attempt (version 2/3) โดยไม่เปลี่ยนเลขเวอร์ชัน attempt
  - **Why:** การจับคู่ receipt กับ attempt เทียบเฉพาะฟิลด์ที่ระบุชื่อ ฟิลด์ใหม่จึงไม่ทำให้ attempt เก่าหรือการจับคู่พัง
  - **Rejected:** none
  - **Consequences:** Not stated in the draft
- **Decision ID:** DEC-002
  - **Status:** accepted
  - **Decision:** currentReviewRulesHash มีค่า default เป็น () => null
  - **Why:** runtime ที่ฝังใช้ receipt validity โดยไม่ส่ง callback ถือว่าโปรเจกต์ไม่มีเกณฑ์ ตรงกับ receipt ที่บันทึก null
  - **Rejected:** none
  - **Consequences:** Not stated in the draft
- **Decision ID:** DEC-003
  - **Status:** accepted
  - **Decision:** รวมการแก้ bug, การผูก hash กับ dispatch, เทสต์ staging และ incident record เป็น change เดียว แล้ว push หลัง full suite ผ่าน
  - **Why:** branch มี commit ที่ทำให้ suite ล้มอยู่ จึงควรแก้ให้ครบในรอบเดียวก่อนเปิด PR
  - **Rejected:** none
  - **Consequences:** Not stated in the draft

## ตารางความล้มเหลว

| Failure | User sees | Recovery | Covers |
|---|---|---|---|
| แก้ REVIEW.md ระหว่างรีวิว | receipt บันทึก A และเป็น stale ด้วยเหตุผล review-rules-changed | Prove รันรีวิวใหม่ด้วยเกณฑ์ B | dispatched-review-binds-sent-rules |

## แผนที่ไฟล์

| Tasks | Paths |
|---|---|
| T001 | `.claude/harness/runtime/evidence/receipt-validity.mjs`, `.claude/harness/tests/receipt-validity.test.mjs` |
| T002 | `.claude/harness/runtime/evidence/review-attempt-store.mjs`, `.claude/harness/runtime/workflow/authority-runtime.mjs`, `.claude/harness/runtime/evidence/receipt-runtime.mjs`, `.claude/harness/tests/review-dispatch-helpers.test.mjs`, `.claude/harness/tests/review-repair-closure.test.mjs` |
| T003 | `install.sh`, `.claude/tests/harness/run-installer-tests.sh` |
| T004 | `openspec/incidents/2026-11-09-review-rules-callback-default.md` (add), `openspec/lessons.md` |

`+` add · `~` change · `-` remove

```text
.
├── .claude/
│   ├── harness/
│   │   ├── runtime/
│   │   │   ├── evidence/
│   │   │   │   ├── ~ receipt-runtime.mjs
│   │   │   │   ├── ~ receipt-validity.mjs
│   │   │   │   └── ~ review-attempt-store.mjs
│   │   │   └── workflow/
│   │   │       └── ~ authority-runtime.mjs
│   │   └── tests/
│   │       ├── ~ receipt-validity.test.mjs
│   │       ├── ~ review-dispatch-helpers.test.mjs
│   │       └── ~ review-repair-closure.test.mjs
│   └── tests/
│       └── harness/
│           └── ~ run-installer-tests.sh
├── ~ install.sh
└── openspec/
    ├── incidents/
    │   └── + 2026-11-09-review-rules-callback-default.md
    └── ~ lessons.md
```

## แผนที่ test

| Scenario | Level | Check | Task |
|---|---|---|---|
| ไม่ส่ง callback และ receipt บันทึก null; ไม่ส่ง callback แต่ receipt มี hash | task check | `node .claude/tests/harness/run-risk-tiered-review-tests.mjs` | T001 |
| บันทึก hash ที่ส่งไป; แก้ REVIEW.md ระหว่างรีวิว; dispatch ตอนไม่มีเกณฑ์; attempt รุ่นเก่าไม่มีฟิลด์; receipt ที่ไม่ผ่าน dispatch | task check | `node --test .claude/harness/tests/review-dispatch-helpers.test.mjs .claude/harness/tests/review-repair-closure.test.mjs` | T002 |
| installer สร้างไฟล์; ไฟล์ของโปรเจกต์ที่ยังไม่ commit | task check | `bash .claude/tests/harness/run-installer-tests.sh` | T003 |
| ไม่ส่ง callback และ receipt บันทึก null; ไม่ส่ง callback แต่ receipt มี hash | task check | `bash .claude/tests/docs/run-doc-consistency.sh` | T004 |
