# Design

## Work type

bugfix

## Current state

provider ที่ derive ไม่มี repository (semantic-draft.mjs derivedExecution); amend เพิ่ม provider ตามชื่อ capability ถ้าชื่อว่าง (semantic-amendment.mjs:984-988); waive ตัดทุก provider ของ capability และ finalize เขียน PROVEN ได้แม้ receipts ว่าง แต่ audit ปฏิเสธเป็น missing-receipt-manifest; decision repair-no-progress ของ proof gate ไม่ถูกบันทึกเป็น pending ของ advance; REPAIR_REVIEW_INFRASTRUCTURE ไม่บอก authority reset-infra; change amend ไม่รายงาน waiver ที่หลุด

## Bugfix analysis

- **Reproduction:** PoC .foundation/prototypes/issues-39-40/poc-d1.test.mjs และ poc-round2.test.mjs: compileSemanticAmendment ได้ providers test-svc และ test ที่ไม่มี repository; normalizeSemanticDraft ที่ task ผูก repository svc ได้ provider ไม่มี repository; requiredProvidersOperation หลัง waive test คืน []; advance-recovery.observe ไม่บันทึก pending ให้ repair-no-progress ของ proof gate และ resolve throw stale or absent
- **Root cause:** derivedExecution ไม่ส่งต่อ task repository ไปที่ provider และ compileSemanticAmendment เพิ่ม provider ตามชื่อโดยไม่ดู capability; finalize ไม่ตรวจ receipts ว่างทั้งที่ proofEnvelopeIssue ปฏิเสธ; repair-no-progress ของ proof gate ไม่อยู่ใน ADVANCE_DECISIONS และ resumeCommand ชี้ packet ที่ไม่บันทึกคำตอบ
- **Regression proof:** เทสต์ระดับ unit ใน semantic-draft, waive-gate, proof-finalize, advance-recovery, advance-runtime และ amendment-invalidation ที่ fail บนโค้ดเดิมและผ่านหลังแก้

## Failure matrix

| Failure | User sees | Recovery | Covers |
|---|---|---|---|
| สอง provider ให้บริการ test | amend คืน issue ที่ระบุ capability test และชื่อ provider ทั้งสอง | ผู้ใช้หรือ agent ระบุ provider ใน execution ของ change ให้ไม่กำกวม แล้ว amend ใหม่ | amend-ambiguous-provider-fails |
| waive test ที่เป็นหลักฐานเดียว | คำสั่งล้มด้วยข้อความว่าไม่เหลือหลักฐานที่รันจริงและ Land จะปฏิเสธ proof ที่ไม่มี receipt | แก้ provider ที่ fail หรือ amend agreement | waive-keeps-executed-evidence |
| finalize โดยไม่มี required provider | ไม่เขียน proof pass และรายงานว่าไม่มี receipt manifest | ถอน waiver ด้วย change waive --revoke หรือ amend agreement | finalize-refuses-empty-proof |
| fingerprint ไม่ตรง | ปฏิเสธว่า decision stale | ดู action ปัจจุบันแล้วตอบใหม่ | proof-gate-decision-answerable |
| request หมด fallback | envelope REPAIR_REVIEW_INFRASTRUCTURE มีคำสั่ง authority reset-infra ของ change นั้นพร้อม --decision-ref | ซ่อมหรือสลับ reviewer แล้ว reset-infra และ advance | review-infra-recovery-names-reset |
| ไม่มี authority run | reason ระบุว่าไม่มี configured reviewer ที่เริ่มได้ และ requestId กับคำสั่ง authority status | configure reviewer หรือบันทึก external verdict | requested-review-wait-diagnostic |
| waiver ผูก revision เดิม | ผลลัพธ์ AMENDED มีบรรทัด waivers no longer apply ที่ระบุ test | บันทึก waiver ใหม่ถ้ายังต้องการ | amend-reports-invalidated-waivers |

## File map

| Path | Change | Responsibility | Tasks |
|---|---|---|---|
| .claude/harness/runtime/workflow/semantic-draft.mjs | change | derivedExecution ผูก repository เดียวที่ไม่ใช่ root | T001 |
| .claude/harness/tests/semantic-draft.test.mjs | change | derivedExecution ผูก repository เดียวที่ไม่ใช่ root | T001; T002 |
| .claude/harness/runtime/workflow/semantic-amendment.mjs | change | amend reuse provider ตาม capability และ fail เมื่อกำกวม | T002 |
| .claude/harness/runtime/workflow/change-validation.mjs | change | waive และ finalize ปฏิเสธ proof ที่ไม่มี required provider และ REPAIR ระบุสาเหตุ | T003 |
| .claude/harness/runtime/evidence/proof-runtime.mjs | change | waive และ finalize ปฏิเสธ proof ที่ไม่มี required provider และ REPAIR ระบุสาเหตุ | T003 |
| .claude/harness/runtime/workflow/advance-runtime.mjs | change | waive และ finalize ปฏิเสธ proof ที่ไม่มี required provider และ REPAIR ระบุสาเหตุ | T003; T004; T005 |
| .claude/harness/tests/waive-gate.test.mjs | change | waive และ finalize ปฏิเสธ proof ที่ไม่มี required provider และ REPAIR ระบุสาเหตุ | T003 |
| .claude/harness/tests/proof-finalize.test.mjs | change | waive และ finalize ปฏิเสธ proof ที่ไม่มี required provider และ REPAIR ระบุสาเหตุ | T003 |
| .claude/harness/runtime/workflow/advance-recovery.mjs | change | decision repair-no-progress ของ proof gate ตอบผ่าน advance --decision ได้ | T004; T005 |
| .claude/harness/runtime/evidence/proof-execution-runtime.mjs | change | decision repair-no-progress ของ proof gate ตอบผ่าน advance --decision ได้ | T004 |
| .claude/harness/tests/advance-recovery.test.mjs | change | decision repair-no-progress ของ proof gate ตอบผ่าน advance --decision ได้ | T004 |
| .claude/harness/runtime/workflow/change-lifecycle.mjs | change | ข้อความ recovery ของ review infra, requested review และ amend waiver | T005 |
| .claude/harness/tests/advance-runtime.test.mjs | change | ข้อความ recovery ของ review infra, requested review และ amend waiver | T005 |
| .claude/harness/tests/amendment-invalidation.test.mjs | change | ข้อความ recovery ของ review infra, requested review และ amend waiver | T005 |
| WORKFLOW.md | change | เอกสาร recovery และ amend อัปเดตตามพฤติกรรมใหม่ทั้งอังกฤษและไทย | T006 |
| .claude/harness/README.md | change | เอกสาร recovery และ amend อัปเดตตามพฤติกรรมใหม่ทั้งอังกฤษและไทย | T006 |
| .claude/harness/EVIDENCE.md | change | เอกสาร recovery และ amend อัปเดตตามพฤติกรรมใหม่ทั้งอังกฤษและไทย | T006 |
| README.md | change | เอกสาร recovery และ amend อัปเดตตามพฤติกรรมใหม่ทั้งอังกฤษและไทย | T006 |
| README.th.md | change | เอกสาร recovery และ amend อัปเดตตามพฤติกรรมใหม่ทั้งอังกฤษและไทย | T006 |
| website/ | change | เอกสาร recovery และ amend อัปเดตตามพฤติกรรมใหม่ทั้งอังกฤษและไทย | T006 |

`+` add · `~` change · `-` remove

```text
.
├── .claude/
│   └── harness/
│       ├── ~ EVIDENCE.md
│       ├── ~ README.md
│       ├── runtime/
│       │   ├── evidence/
│       │   │   ├── ~ proof-execution-runtime.mjs
│       │   │   └── ~ proof-runtime.mjs
│       │   └── workflow/
│       │       ├── ~ advance-recovery.mjs
│       │       ├── ~ advance-runtime.mjs
│       │       ├── ~ change-lifecycle.mjs
│       │       ├── ~ change-validation.mjs
│       │       ├── ~ semantic-amendment.mjs
│       │       └── ~ semantic-draft.mjs
│       └── tests/
│           ├── ~ advance-recovery.test.mjs
│           ├── ~ advance-runtime.test.mjs
│           ├── ~ amendment-invalidation.test.mjs
│           ├── ~ proof-finalize.test.mjs
│           ├── ~ semantic-draft.test.mjs
│           └── ~ waive-gate.test.mjs
├── ~ README.md
├── ~ README.th.md
├── ~ website/
└── ~ WORKFLOW.md
```

## Test map

| Scenario | Level | Check | Task |
|---|---|---|---|
| repository เดียวได้ provider ที่ผูก repository; root หรือไม่ระบุ repository คงเดิม; หลาย repository คงพฤติกรรมเดิม; execution ที่ผู้เขียนกำหนดไม่ถูกแตะ | task check | `node --test .claude/harness/tests/semantic-draft.test.mjs` | T001 |
| reuse provider ที่ประกาศไว้; ไม่มี provider ของ capability จึงเพิ่มตัวที่ derive; provider ชื่อเดียวกับ capability ยังตามคำสั่ง verify; สอง provider ให้บริการ test | task check | `node --test .claude/harness/tests/semantic-draft.test.mjs` | T002 |
| waive test ที่เป็นหลักฐานเดียว; waive ที่ยังเหลือหลักฐาน; finalize โดยไม่มี required provider; proof ปกติ | task check | `node --test .claude/harness/tests/waive-gate.test.mjs .claude/harness/tests/proof-finalize.test.mjs` | T003 |
| ตัวเลือกมีคำสั่งตอบ; ตอบ change-strategy; ตอบ pause; decision ที่ตัวเลือกมีคำสั่งเองคงเดิม; fingerprint ไม่ตรง | task check | `node --test .claude/harness/tests/advance-recovery.test.mjs` | T004 |
| request หมด fallback; ไม่มี authority run; waiver ผูก revision เดิม; ไม่มี waiver | task check | `node --test .claude/harness/tests/advance-runtime.test.mjs .claude/harness/tests/amendment-invalidation.test.mjs` | T005 |
| ตัวเลือกมีคำสั่งตอบ; ตอบ change-strategy; ตอบ pause; decision ที่ตัวเลือกมีคำสั่งเองคงเดิม; fingerprint ไม่ตรง; waive test ที่เป็นหลักฐานเดียว; waive ที่ยังเหลือหลักฐาน; repository เดียวได้ provider ที่ผูก repository; root หรือไม่ระบุ repository คงเดิม; หลาย repository คงพฤติกรรมเดิม; execution ที่ผู้เขียนกำหนดไม่ถูกแตะ | task check | `bash .claude/tests/docs/run-doc-consistency.sh` | T006 |

## Decisions

- **Decision ID:** DEC-001
  - **Status:** accepted
  - **Decision:** reject-empty-receipts: waive คงถอนทั้ง capability แต่ปฏิเสธเมื่อไม่เหลือ required provider
  - **Why:** ผู้ใช้ตัดสินใน investigation issues-39-40 (u4)
  - **Rejected:** none
  - **Consequences:** waive ที่เคยผ่านแต่ทำให้ proof ว่างจะถูกปฏิเสธทันที; ความหมาย waive เดิมคงอยู่
  - **Decided by:** user
- **Decision ID:** DEC-002
  - **Status:** accepted
  - **Decision:** fail-with-guidance เมื่อหลาย provider ให้บริการ capability เดียวกัน
  - **Why:** ผู้ใช้ตัดสินใน investigation issues-39-40 (u4)
  - **Rejected:** none
  - **Consequences:** ผู้ใช้ต้องแก้ execution providers เองในกรณีกำกวม แต่ไม่มีการผูก provider ผิดตัวแบบเงียบ
  - **Decided by:** user
- **Decision ID:** DEC-003
  - **Status:** accepted
  - **Decision:** ผูก repository เฉพาะกรณีทุก task อยู่ใน repository เดียวที่ไม่ใช่ root
  - **Why:** การแตก provider ตาม repository ต้องสร้าง discovery provider แยกและอาจทำลาย multi-repo change ที่รันที่ root ได้อยู่; กรณี #39/#40 เป็น repository เดียว
  - **Rejected:** none
  - **Consequences:** multi-repo change ที่ใช้ provider ที่ derive ยังรันที่ control root และต้องประกาศ execution providers เองถ้าต้องการ cwd ของ repository
  - **Decided by:** agent
- **Decision ID:** DEC-004
  - **Status:** accepted
  - **Decision:** ตอบผ่าน advance เฉพาะ decision ที่ตัวเลือกไม่มีคำสั่งของตัวเอง; คำตอบที่ไม่ใช่ pause ล้าง baseline no-progress ของ proof หนึ่งครั้ง
  - **Why:** ตัวเลือกที่มีคำสั่งเอง เช่น accept-review-risk ต้องคงคำสั่ง waive เดิม; การล้าง baseline ทำให้รอบถัดไปคืนงานซ่อมให้ agent ตามความหมายของ change-strategy
  - **Rejected:** none
  - **Consequences:** หลังตอบ ถ้า findings เดิมซ้ำอีก ระบบจะถามใหม่หลังรอบถัดไป ไม่วนเงียบ
  - **Decided by:** agent

## Compatibility and migration

ชื่อคำสั่งและอาร์กิวเมนต์ CLI คงเดิม. provider ที่ derive ยังชื่อตาม capability; เพิ่มเฉพาะ field repository เมื่อทุก task อยู่ใน repository เดียวที่ไม่ใช่ root. ไม่เปลี่ยน protocol.json หรือ runtime API pin. waive ที่เคยทำให้ proof ว่างเดิม land ไม่ได้อยู่แล้ว การปฏิเสธจึงไม่ทำให้เส้นทางที่เคยสำเร็จหายไป
