# Design

## Work type

bugfix

## Bugfix analysis

| ส่วน | รายละเอียด |
|---|---|
| วิธีทำให้เกิดซ้ำ | Land change A โดยไม่ commit แล้วเริ่ม change B: sandbox ของ B ไม่มีไฟล์ของ A; verdict ของคนหมดอายุทุกครั้งที่ base ขยับ; AI review ครบแล้วได้ WAIT ที่ไม่บอกทางต่อ; authority record ล้มทีละเงื่อนไขและ template ของ delta บันทึกไม่ผ่าน; แก้ timeoutMs ของ provider ต้องอนุมัติ spec ใหม่ |
| ผลที่ควรเป็น | Build และ Prove ของ B เห็นงานของ A, verdict คงอยู่เมื่อส่วนของ change ไม่เปลี่ยน, ทุกทางตันมีทางต่อที่ระบุ และการแก้ config ของ provider ไม่ต้องอนุมัติ spec ใหม่ |
| สาเหตุที่แท้จริง | preexistingDirty นับงานที่ Land แล้วเป็นของเดิมและ createSingle สร้างจาก HEAD; การ rebind หลัง base ขยับครอบเฉพาะ AI; ทาง WAIT ไม่แยก exhausted; ตรวจ record เป็นลำดับและ template ตั้ง verified-findings เป็น 0; agreementIdentity hash ทุกไฟล์รวม execution.yaml |
| ขอบเขตผลกระทบ | ทุก consumer ที่ทำหลาย change ต่อกันโดยไม่ commit ระหว่าง Land หรือใช้ human review |
| หลักฐาน regression | test ระดับ sandbox, receipt, authority และ user-decisions ของแต่ละ requirement |

## Decisions

- **Decision ID:** DEC-001
  - **Status:** accepted
  - **Decision:** sandbox ใหม่นำงานที่ Land แล้วแต่ยังไม่ commit เข้าไปด้วย
  - **Why:** ผู้ใช้เลือกให้ Build และ Prove ทำบนโค้ดที่มีงานก่อนหน้าครบ
  - **Rejected:** none
  - **Consequences:** ไม่ต้อง commit ระหว่าง Land และ proof ครอบ change ที่ต่อกัน
  - **Decided by:** user
- **Decision ID:** DEC-002
  - **Status:** accepted
  - **Decision:** การแก้ config ของ provider ไม่ทำให้การอนุมัติ spec หมดอายุ แต่การเพิ่มหรือถอด provider ยังต้องอนุมัติ
  - **Why:** ผู้ใช้เลือกตาม EVIDENCE.md ที่ว่ากระทบเฉพาะ fingerprint ของ provider
  - **Rejected:** none
  - **Consequences:** evidence ของ provider นั้นต้องรันใหม่ แต่ไม่ต้องอนุมัติ spec ซ้ำ
  - **Decided by:** user
- **Decision ID:** DEC-003
  - **Status:** accepted
  - **Decision:** verdict ของคนคงอยู่เมื่อ base ขยับแต่ hunk ของ change เหมือนเดิมทุกไบต์
  - **Why:** ผู้ใช้เลือกให้เหมือนที่ AI review rebind อยู่แล้ว
  - **Rejected:** none
  - **Consequences:** ผู้ใช้ไม่ต้องให้ verdict ซ้ำเมื่อ upstream เปลี่ยนเฉพาะไฟล์อื่น
  - **Decided by:** user
- **Decision ID:** DEC-004
  - **Status:** accepted
  - **Decision:** เมื่อ AI review ครบ คืน ASK_USER ที่มี verdict ของคน, AI เพิ่มหนึ่งครั้ง และ pause โดยไม่มีการ waive review
  - **Why:** ผู้ใช้เลือก และตรงกับกฎที่ review มีทางของตัวเอง
  - **Rejected:** none
  - **Consequences:** WORKFLOW.md ต้องเลิกสัญญาเรื่อง waive review
  - **Decided by:** user
- **Decision ID:** DEC-005
  - **Status:** accepted
  - **Decision:** ไม่รวม test ทั้ง project เข้า Prove ให้รัน full suite แยกก่อน release
  - **Why:** ผู้ใช้เลือกให้ Prove เร็วเท่าเดิม
  - **Rejected:** none
  - **Consequences:** เอกสารต้องบอกว่า Prove รันเฉพาะ verify ของ task
  - **Decided by:** user

## ตารางความล้มเหลว

| Failure | User sees | Recovery | Covers |
|---|---|---|---|
| upstream แก้ไฟล์ของ change | harness เปิด review request ใหม่ | No separate step; the outcome is the handling | human-verdict-rebind |
| หลายปัญหาพร้อมกัน | ข้อความ BLOCKED ระบุทั้งสองปัญหาในครั้งเดียว | No separate step; the outcome is the handling | authority-record-issues |
| task ที่โค้ดอยู่นอก path | EDIT ระบุว่าไม่มีการเปลี่ยนใน path ของ task และให้แก้ path หรือถอน task | No separate step; the outcome is the handling | amended-task-tick |
| ถอด provider | harness ขออนุมัติ spec ใหม่ | No separate step; the outcome is the handling | provider-config-approval |
| แก้ claim | harness ขออนุมัติ spec ใหม่ | No separate step; the outcome is the handling | provider-config-approval |
| dependency ไม่แยก | ข้อความระบุ route ที่มีใน commands.json และไม่มีคำว่า recreate the sandbox | No separate step; the outcome is the handling | land-dead-end-route |

## แผนที่ไฟล์

| Tasks | Paths |
|---|---|
| T001 | `.claude/harness/runtime/workflow/sandbox-runtime.mjs`, `.claude/harness/runtime/core/state-runtime.mjs`, `.claude/harness/runtime/workflow/change-lifecycle.mjs`, `.claude/harness/tests/sandbox-create-phases.test.mjs`, `.claude/harness/tests/sandbox-runtime-sync.test.mjs` |
| T001; T003; T005 | `.claude/harness/foundation.mjs` |
| T001; T003; T005; T006; T007 | `WORKFLOW.md` |
| T002; T004 | `.claude/harness/runtime/evidence/receipt-runtime.mjs` |
| T002 | `.claude/harness/runtime/evidence/receipt-validity.mjs`, `.claude/harness/tests/receipt-validity.test.mjs`, `.claude/harness/README.md` |
| T002; T003 | `.claude/harness/runtime/evidence/review-attempt-store.mjs` |
| T003 | `.claude/harness/runtime/workflow/advance-runtime.mjs`, `.claude/harness/tests/advance-runtime.test.mjs`, `.claude/harness/commands.json` |
| T003; T004 | `.claude/harness/runtime/workflow/authority-runtime.mjs`, `.claude/harness/tests/authority-request-operation.test.mjs` |
| T004 | `.claude/harness/tests/authority-response-validation.test.mjs` |
| T004; T006 | `.claude/harness/EVIDENCE.md` |
| T005 | `.claude/harness/runtime/workflow/task-change.mjs`, `.claude/harness/runtime/workflow/session-lease.mjs`, `.claude/harness/tests/task-change.test.mjs` (add), `.claude/commands/build.md` |
| T006 | `.claude/harness/runtime/core/user-decisions.mjs`, `.claude/harness/tests/user-decisions.test.mjs` |
| T007 | `.claude/harness/runtime/workflow/land-runtime.mjs`, `.claude/harness/tests/land-check-phases.test.mjs` |

`+` add · `~` change · `-` remove

```text
.
├── .claude/
│   ├── commands/
│   │   └── ~ build.md
│   └── harness/
│       ├── ~ commands.json
│       ├── ~ EVIDENCE.md
│       ├── ~ foundation.mjs
│       ├── ~ README.md
│       ├── runtime/
│       │   ├── core/
│       │   │   ├── ~ state-runtime.mjs
│       │   │   └── ~ user-decisions.mjs
│       │   ├── evidence/
│       │   │   ├── ~ receipt-runtime.mjs
│       │   │   ├── ~ receipt-validity.mjs
│       │   │   └── ~ review-attempt-store.mjs
│       │   └── workflow/
│       │       ├── ~ advance-runtime.mjs
│       │       ├── ~ authority-runtime.mjs
│       │       ├── ~ change-lifecycle.mjs
│       │       ├── ~ land-runtime.mjs
│       │       ├── ~ sandbox-runtime.mjs
│       │       ├── ~ session-lease.mjs
│       │       └── ~ task-change.mjs
│       └── tests/
│           ├── ~ advance-runtime.test.mjs
│           ├── ~ authority-request-operation.test.mjs
│           ├── ~ authority-response-validation.test.mjs
│           ├── ~ land-check-phases.test.mjs
│           ├── ~ receipt-validity.test.mjs
│           ├── ~ sandbox-create-phases.test.mjs
│           ├── ~ sandbox-runtime-sync.test.mjs
│           ├── + task-change.test.mjs
│           └── ~ user-decisions.test.mjs
└── ~ WORKFLOW.md
```

## แผนที่ test

| Scenario | Level | Check | Task |
|---|---|---|---|
| change ที่ต่อกัน; ไฟล์ที่ผู้ใช้แก้เองไม่ถูกนำเข้า; Land ของ B ไม่ทับงาน A | task check | `node --test .claude/harness/tests/sandbox-create-phases.test.mjs .claude/harness/tests/sandbox-runtime-sync.test.mjs` | T001 |
| upstream แก้ไฟล์อื่น; upstream แก้ไฟล์ของ change | task check | `node --test .claude/harness/tests/receipt-validity.test.mjs` | T002 |
| AI review ครบ; AI เพิ่มหนึ่งครั้ง; ไม่มี reviewer | task check | `node --test .claude/harness/tests/advance-runtime.test.mjs .claude/harness/tests/authority-request-operation.test.mjs` | T003 |
| หลายปัญหาพร้อมกัน; template ของ delta ใช้ได้; request ยังไม่ dispatch | task check | `node --test .claude/harness/tests/authority-response-validation.test.mjs .claude/harness/tests/authority-request-operation.test.mjs` | T004 |
| task ที่โค้ดอยู่นอก path | task check | `node --test .claude/harness/tests/task-change.test.mjs` | T005 |
| แก้ timeoutMs; ถอด provider; แก้ claim | task check | `node --test .claude/harness/tests/user-decisions.test.mjs` | T006 |
| dependency ไม่แยก | task check | `node --test .claude/harness/tests/land-check-phases.test.mjs` | T007 |
