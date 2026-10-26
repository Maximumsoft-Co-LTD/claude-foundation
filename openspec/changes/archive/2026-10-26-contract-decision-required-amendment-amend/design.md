# Design

## Work type

bugfix

## Bugfix analysis

| ส่วน | รายละเอียด |
|---|---|
| วิธีทำให้เกิดซ้ำ | ให้ review รอบ delta สุดท้ายล้ม แล้ว change amend ที่เปลี่ยน contract จากนั้นรัน advance --through archived |
| ผลที่ควรเป็น | ผลลัพธ์ระบุว่าต้องมี Decision Sheet revision ที่ lock แล้ว พร้อมคำสั่งที่เปิดมัน และ change amend เตือนเรื่องเดียวกันทันที |
| สาเหตุที่แท้จริง | recordDeterministicReviewClosureOperation คืน route CONTRACT_DECISION_REQUIRED โดยไม่มีคำสั่ง และ proof-execution-runtime ใส่ command ของ next เป็น packet --phase build เสมอ; amendChangeUnlocked ไม่ตรวจสถานะ review ที่ล้มอยู่ |
| ขอบเขตผลกระทบ | ทุก change ที่ amend หลัง AI review รอบสุดท้ายล้ม ทั้งแบบ grounding และ non-grounding |
| หลักฐาน regression | test ของ closure helper, advance envelope และ output ของ change amend |

## ตารางความล้มเหลว

| Failure | User sees | Recovery | Covers |
|---|---|---|---|
| change แบบ grounding | ผลลัพธ์เป็น ASK_USER และมีคำสั่ง change resolve <change> --reopen-grounding --decision-ref <ref> --reopen-reason <why> | No separate step; the outcome is the handling | decision-route-command |
| change แบบ non-grounding | ผลลัพธ์เป็น ASK_USER และมีคำสั่ง advance <change> --approve-spec --decision-ref <ref> | No separate step; the outcome is the handling | decision-route-command |

## แผนที่ไฟล์

| Tasks | Paths |
|---|---|
| T001 | `.claude/harness/runtime/evidence/receipt-runtime.mjs`, `.claude/harness/runtime/evidence/proof-execution-runtime.mjs`, `.claude/harness/runtime/workflow/advance-runtime.mjs`, `.claude/harness/tests/review-closure-helpers.test.mjs`, `.claude/harness/tests/review-repair-closure.test.mjs`, `.claude/harness/tests/advance-runtime.test.mjs` |
| T002 | `.claude/harness/runtime/workflow/change-lifecycle.mjs`, `.claude/harness/tests/amendment-invalidation.test.mjs`, `WORKFLOW.md` |

`+` add · `~` change · `-` remove

```text
.
├── .claude/
│   └── harness/
│       ├── runtime/
│       │   ├── evidence/
│       │   │   ├── ~ proof-execution-runtime.mjs
│       │   │   └── ~ receipt-runtime.mjs
│       │   └── workflow/
│       │       ├── ~ advance-runtime.mjs
│       │       └── ~ change-lifecycle.mjs
│       └── tests/
│           ├── ~ advance-runtime.test.mjs
│           ├── ~ amendment-invalidation.test.mjs
│           ├── ~ review-closure-helpers.test.mjs
│           └── ~ review-repair-closure.test.mjs
└── ~ WORKFLOW.md
```

## แผนที่ test

| Scenario | Level | Check | Task |
|---|---|---|---|
| change แบบ grounding; change แบบ non-grounding; gate ไม่ถูกผ่อน | task check | `node --test .claude/harness/tests/review-closure-helpers.test.mjs .claude/harness/tests/review-repair-closure.test.mjs .claude/harness/tests/advance-runtime.test.mjs` | T001 |
| amend หลัง delta ที่ล้ม; amend ที่ไม่มี review ล้ม; amend ที่ไม่เปลี่ยน contract | task check | `node --test .claude/harness/tests/amendment-invalidation.test.mjs` | T002 |
