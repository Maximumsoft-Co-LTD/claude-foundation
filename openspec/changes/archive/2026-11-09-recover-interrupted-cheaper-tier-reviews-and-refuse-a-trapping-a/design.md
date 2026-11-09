# Design

## Work type

bugfix

## Bugfix analysis

| ส่วน | รายละเอียด |
|---|---|
| วิธีทำให้เกิดซ้ำ | Configured AI review round 1 runs on the standard model (sonnet); recording its receipt is interrupted; advance recovery then fails with 'configured review result integrity or reviewer provenance does not match'; authority abort of that request then makes every later advance fail with 'a completed AI response has no matching recorded receipt' |
| สาเหตุที่แท้จริง | Recovery recomputes the expected reviewer model from the delivered-attempt count, which now includes the completed attempt itself, so it expects the configured model (opus) instead of the dispatched standard model; and authority abort leaves a completed, unrecorded delivered attempt that the anti-repeat guard blocks forever |
| หลักฐาน regression | A test recovers a checkpointed standard-tier round-one result after completion, and a test shows authority abort refusing a request whose AI result completed without a receipt |

## Decisions

- **Decision ID:** DEC-001
  - **Status:** accepted
  - **Decision:** การกู้คืนผลรีวิวเทียบ identity, providerFamily, modelFamily และ modelId กับ request.dispatch.reviewer ที่บันทึกตอน dispatch
  - **Why:** สิ่งที่รันจริงถูกบันทึกไว้แล้ว การคำนวณใหม่จากจำนวน attempt เปลี่ยนไปเมื่อ attempt นั้นเสร็จเอง
  - **Rejected:** none
  - **Consequences:** Not stated in the draft
- **Decision ID:** DEC-002
  - **Status:** accepted
  - **Decision:** authority abort ปฏิเสธ request ที่ attempt เสร็จแล้วแบบ delivered และยังไม่มี receipt พร้อมบอก authority record หรือ advance
  - **Why:** abort ตรงนั้นไม่มีทางกลับ ส่วน record ยังกู้ผลที่มีอยู่ได้ และไม่เปิดช่องให้รีวิวซ้ำ
  - **Rejected:** none
  - **Consequences:** Not stated in the draft

## ตารางความล้มเหลว

| Failure | User sees | Recovery | Covers |
|---|---|---|---|
| รอบแรก standard ถูกขัดจังหวะ | receipt ของรีวิวถูกบันทึกด้วยผล pass และ provenance ของ model standard | ไม่ต้องทำอะไร advance ทำต่อเอง | interrupted-review-recovers-dispatched-model |
| คำตอบไม่ตรงกับที่ dispatch | ยังปฏิเสธด้วย configured review result integrity or reviewer provenance does not match | รีวิวไม่ถูกบันทึกจากข้อมูลที่ไม่ตรง | interrupted-review-recovers-dispatched-model |
| abort หลังผลเสร็จแต่ยังไม่บันทึก | คำสั่งถูกปฏิเสธโดยไม่เปลี่ยน request หรือ attempt history และบอกให้ใช้ authority record หรือ advance | advance หรือ authority record บันทึกผลที่มีอยู่ | abort-refuses-unrecorded-result |

## แผนที่ไฟล์

| Tasks | Paths |
|---|---|
| T001; T002 | `.claude/harness/runtime/workflow/authority-runtime.mjs`, `.claude/harness/tests/` |
| T001 | `.claude/harness/runtime/evidence/review-result-recovery.mjs` |
| T003 | `openspec/incidents/`, `openspec/lessons.md`, `.claude/tests/evals/cases/`, `.claude/harness/EVIDENCE.md`, `WORKFLOW.md`, `CHANGELOG.md` |

`+` add · `~` change · `-` remove

```text
.
├── .claude/
│   ├── harness/
│   │   ├── ~ EVIDENCE.md
│   │   ├── runtime/
│   │   │   ├── evidence/
│   │   │   │   └── ~ review-result-recovery.mjs
│   │   │   └── workflow/
│   │   │       └── ~ authority-runtime.mjs
│   │   └── ~ tests/
│   └── tests/
│       └── evals/
│           └── ~ cases/
├── ~ CHANGELOG.md
├── openspec/
│   ├── ~ incidents/
│   └── ~ lessons.md
└── ~ WORKFLOW.md
```

## แผนที่ test

| Scenario | Level | Check | Task |
|---|---|---|---|
| รอบแรก standard ถูกขัดจังหวะ; รอบแรก fast ถูกขัดจังหวะ; รอบ configured ยังกู้ได้; คำตอบไม่ตรงกับที่ dispatch | task check | `node --test .claude/harness/tests/workflow-policy.test.mjs .claude/harness/tests/configured-reviewer.test.mjs .claude/harness/tests/review-guard-reconciliation.test.mjs` | T001 |
| abort หลังผลเสร็จแต่ยังไม่บันทึก; abort ระหว่างรีวิวยังรัน; abort request ที่ยังไม่ dispatch; abort หลังบันทึกแล้ว | task check | `node --test .claude/harness/tests/authority-request-operation.test.mjs .claude/harness/tests/workflow-policy.test.mjs` | T002 |
| รอบแรก standard ถูกขัดจังหวะ; รอบแรก fast ถูกขัดจังหวะ; รอบ configured ยังกู้ได้; คำตอบไม่ตรงกับที่ dispatch; abort หลังผลเสร็จแต่ยังไม่บันทึก; abort ระหว่างรีวิวยังรัน; abort request ที่ยังไม่ dispatch; abort หลังบันทึกแล้ว | task check | `node .claude/tests/evals/run-evals.mjs` | T003 |
