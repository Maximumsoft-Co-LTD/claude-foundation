# Design

## Work type

bugfix

## Bugfix analysis

| ส่วน | รายละเอียด |
|---|---|
| วิธีทำให้เกิดซ้ำ | test provider ที่ chain นานกว่า 120 วินาที ได้ test:error โดยไม่บอกว่า timeout และ suite ที่เรียก harness ซ้อน (installer, apply conflict, mutation, seams) ล้มเฉพาะตอนรันใน proof |
| ผลที่ควรเป็น | provider ที่ timeout บอกเวลาที่จำกัดและวิธีตั้ง timeoutMs และ suite ให้ผลเดียวกันทั้งในและนอก proof |
| สาเหตุที่แท้จริง | ค่า timeoutMs เริ่มต้น 120000 ใน adapter-runtime.mjs และ providerExecutionEnvironment ส่งตัวแปรสถานะของ session เช่น FOUNDATION_WORKSPACE_ROOT ต่อให้ provider |
| ขอบเขตผลกระทบ | ทุก consumer ที่มี test provider ยาวหรือ test ที่เรียก claude-foundation ซ้อน |
| หลักฐาน regression | test ระดับ adapter และ proof outcome พร้อมรัน run-all.sh --affected ใน test provider ของ change นี้ |

## Decisions

- **Decision ID:** DEC-001
  - **Status:** accepted
  - **Decision:** timeoutMs เริ่มต้นของ provider แบบ command เป็น 600000 (10 นาที)
  - **Why:** ผู้ใช้เลือก 10 นาที ตรงกับค่าที่ change เก่าตั้งให้ test suite ยาว
  - **Rejected:** none
  - **Consequences:** provider ที่ค้างจะถูกตัดช้าลง แต่ suite ปกติไม่ timeout โดยไม่ตั้งใจ
  - **Decided by:** user
- **Decision ID:** DEC-002
  - **Status:** accepted
  - **Decision:** work type ที่ขัดกับสัญญาณ typed ได้ EDIT ที่ระบุ type ที่ขาด
  - **Why:** ผู้ใช้เลือก EDIT เพื่อให้ได้หัวข้อของประเภทงานจริง โดยไม่เดาจาก prose
  - **Rejected:** none
  - **Consequences:** draft ที่ประกาศ integrations หรือ riskSignals ต้องประกาศ work type ที่ตรงกันก่อนเริ่ม
  - **Decided by:** user
- **Decision ID:** DEC-003
  - **Status:** accepted
  - **Decision:** ใช้คำตอบที่เสนอสำหรับ spec gap ทั้ง 6 ข้อ และ merge revision เปลี่ยน version ของ draft ไม่ได้
  - **Why:** ผู้ใช้อนุมัติคำตอบทั้งชุด การห้ามเปลี่ยน version ใน merge ตามแนวเดียวกับการ revise ทั้ง draft
  - **Rejected:** none
  - **Consequences:** การย้าย change จาก v4 เป็น v5 ต้องใช้ change revise ทั้ง draft
  - **Decided by:** user

## ตารางความล้มเหลว

| Failure | User sees | Recovery | Covers |
|---|---|---|---|
| timeout บอกสาเหตุ | ผลลัพธ์ระบุ provider, timed out after เวลาที่จำกัด และให้ตั้ง timeoutMs ใน evidence.yaml | No separate step; the outcome is the handling | provider-timeout |
| integration ที่ประกาศเป็น feature | harness คืน EDIT ให้เพิ่ม workType integration โดยไม่เริ่ม change | No separate step; the outcome is the handling | work-type-signals |
| protocol ผิด | claim ล้มและระบุ protocol ที่ได้กับที่ต้องการ | No separate step; the outcome is the handling | evaluation-output |
| amend หัวข้อที่ harness สร้าง | harness คืน EDIT ที่บอกว่า File map ถูกสร้างโดย harness | No separate step; the outcome is the handling | outline-heading-rules |
| merge เปลี่ยน version | harness ปฏิเสธและบอกให้ revise ทั้ง draft | No separate step; the outcome is the handling | v5-merge-revision |

## แผนที่ไฟล์

| Tasks | Paths |
|---|---|
| T001; T002; T005 | `.claude/harness/runtime/evidence/adapter-runtime.mjs` |
| T001 | `.claude/harness/runtime/evidence/proof-execution-runtime.mjs`, `.claude/harness/tests/proof-execution-boundaries.test.mjs`, `.claude/harness/tests/process-runtime.test.mjs`, `website/docs/src/content/docs/evidence/adapters.md`, `website/docs/src/content/docs/th/evidence/adapters.md` |
| T001; T002 | `.claude/harness/EVIDENCE.md` |
| T002 | `.claude/harness/tests/evidence-bootstrap.test.mjs` |
| T003 | `.claude/harness/runtime/workflow/validation/dev-document.mjs`, `.claude/harness/runtime/workflow/validation/design-blueprints.mjs`, `.claude/harness/runtime/workflow/semantic-draft.mjs`, `.claude/harness/tests/work-type-fields.test.mjs`, `WORKFLOW.md` |
| T004 | `.claude/harness/runtime/workflow/change-validation.mjs`, `.claude/harness/runtime/evidence/proof-runtime.mjs`, `.claude/harness/runtime/workflow/apply-runtime.mjs`, `.claude/harness/foundation.mjs`, `.claude/harness/tests/required-providers.test.mjs`, `.claude/harness/tests/archive-appendices.test.mjs` |
| T005 | `.claude/harness/runtime/evidence/provider-catalog.mjs`, `.claude/harness/runtime/evidence/evidence-results.mjs`, `.claude/harness/tests/new-capabilities.test.mjs` |
| T006 | `.claude/harness/runtime/workflow/draft-folder.mjs`, `.claude/harness/runtime/workflow/semantic-amendment.mjs`, `.claude/harness/runtime/workflow/validation/outline-contract.mjs`, `.claude/harness/tests/draft-folder.test.mjs`, `.claude/harness/tests/amendment-invalidation.test.mjs` |
| T007 | `.claude/harness/runtime/workflow/change-lifecycle.mjs`, `.claude/harness/tests/change-revise.test.mjs` |

`+` add · `~` change · `-` remove

```text
.
├── .claude/
│   └── harness/
│       ├── ~ EVIDENCE.md
│       ├── ~ foundation.mjs
│       ├── runtime/
│       │   ├── evidence/
│       │   │   ├── ~ adapter-runtime.mjs
│       │   │   ├── ~ evidence-results.mjs
│       │   │   ├── ~ proof-execution-runtime.mjs
│       │   │   ├── ~ proof-runtime.mjs
│       │   │   └── ~ provider-catalog.mjs
│       │   └── workflow/
│       │       ├── ~ apply-runtime.mjs
│       │       ├── ~ change-lifecycle.mjs
│       │       ├── ~ change-validation.mjs
│       │       ├── ~ draft-folder.mjs
│       │       ├── ~ semantic-amendment.mjs
│       │       ├── ~ semantic-draft.mjs
│       │       └── validation/
│       │           ├── ~ design-blueprints.mjs
│       │           ├── ~ dev-document.mjs
│       │           └── ~ outline-contract.mjs
│       └── tests/
│           ├── ~ amendment-invalidation.test.mjs
│           ├── ~ archive-appendices.test.mjs
│           ├── ~ change-revise.test.mjs
│           ├── ~ draft-folder.test.mjs
│           ├── ~ evidence-bootstrap.test.mjs
│           ├── ~ new-capabilities.test.mjs
│           ├── ~ process-runtime.test.mjs
│           ├── ~ proof-execution-boundaries.test.mjs
│           ├── ~ required-providers.test.mjs
│           └── ~ work-type-fields.test.mjs
├── website/
│   └── docs/
│       └── src/
│           └── content/
│               └── docs/
│                   ├── evidence/
│                   │   └── ~ adapters.md
│                   └── th/
│                       └── evidence/
│                           └── ~ adapters.md
└── ~ WORKFLOW.md
```

## แผนที่ test

| Scenario | Level | Check | Task |
|---|---|---|---|
| ค่าเริ่มต้น 10 นาที; timeout บอกสาเหตุ; ตั้งเองยังใช้ค่าที่ตั้ง | task check | `node --test .claude/harness/tests/proof-execution-boundaries.test.mjs .claude/harness/tests/process-runtime.test.mjs` | T001 |
| ตัวแปร session ถูกถอด; ตัวแปร contract ยังอยู่; suite ที่เรียก harness ซ้อนผ่านใน proof | task check | `node --test .claude/harness/tests/evidence-bootstrap.test.mjs` | T002 |
| integration ที่ประกาศเป็น feature; ประกาศถูกแล้วผ่าน; ไม่ประกาศ workType ใช้การเดาเดิม | task check | `node --test .claude/harness/tests/work-type-fields.test.mjs` | T003 |
| release-health ที่ถูก waive; proof เก่าไม่มี rolloutGates; gate ตาม work type ไม่มี provider | task check | `node --test .claude/harness/tests/required-providers.test.mjs .claude/harness/tests/archive-appendices.test.mjs` | T004 |
| stdout มี log ปน; protocol ผิด | task check | `node --test .claude/harness/tests/new-capabilities.test.mjs` | T005 |
| heading ไทยของ Decisions; amend หัวข้อที่ harness สร้าง | task check | `node --test .claude/harness/tests/draft-folder.test.mjs .claude/harness/tests/amendment-invalidation.test.mjs` | T006 |
| merge เพิ่ม requirement ใน minimal v5; merge เปลี่ยน version | task check | `node --test .claude/harness/tests/change-revise.test.mjs` | T007 |
