# Design

## Work type

bugfix

## Current state

advance อ่าน proof cursor ตอนตัดสินใจโดยไม่มี lock (advance-runtime.mjs readAdvanceValue) แล้วเรียก proofAdvance ซึ่งอ่าน advanceStart ใหม่ใน lock และเทียบ progressFingerprint (proof-execution-runtime.mjs writeConvergentRepairStop). mutationInProgress ส่ง owner เป็น {pid} เท่านั้น; proofOperationAction ถือ owner ที่ไม่ใช่ process ที่ยังมีชีวิตเป็น REPAIR_PROOF_LOCK

## Bugfix analysis

- **Reproduction:** ยืนยันจากการอ่านโค้ด: process A รัน gate ที่ fail และเขียน fingerprint F; process B ที่ตัดสินใจ RUN_PROOF ก่อนหน้านั้นได้ lock ต่อและเทียบกับ F จึงได้ NO_PROGRESS_DECISION; owner state initializing หรือ null ถูกแปลงเป็น REPAIR_PROOF_LOCK
- **Root cause:** gate ไม่รู้ว่า cursor ที่ใช้เป็น baseline ถูกเขียนหลังจากผู้เรียกตัดสินใจรัน; owner ของ lock ถูกตัดข้อมูลก่อนถึง advance
- **Regression proof:** เทสต์ proof-advance ที่เรียก gate สองครั้งด้วย cursor token เก่า และเทสต์ advance-recovery ที่ owner เป็น null หรือ initializing

## Failure matrix

| Failure | User sees | Recovery | Covers |
|---|---|---|---|
| cursor เปลี่ยนหลังตัดสินใจ | ผลเป็น ACTION_REQUIRED ไม่ใช่ NO_PROGRESS_DECISION | agent ซ่อม findings แล้ว resume | stale-gate-baseline |
| owner ตายแล้ว | ยังได้ REPAIR_PROOF_LOCK | ตรวจและกู้ lock ตามคำสั่ง doctor | transient-proof-lock-owner |

## File map

| Path | Change | Responsibility | Tasks |
|---|---|---|---|
| .claude/harness/runtime/evidence/proof-execution-runtime.mjs | change | advance ส่ง cursor token และ gate ไม่นับ no-progress เมื่อ cursor เปลี่ยน | T001; T002 |
| .claude/harness/runtime/workflow/advance-runtime.mjs | change | advance ส่ง cursor token และ gate ไม่นับ no-progress เมื่อ cursor เปลี่ยน | T001; T002 |
| .claude/harness/tests/proof-advance.test.mjs | change | advance ส่ง cursor token และ gate ไม่นับ no-progress เมื่อ cursor เปลี่ยน | T001 |
| .claude/harness/tests/advance-recovery.test.mjs | change | advance ส่ง cursor token และ gate ไม่นับ no-progress เมื่อ cursor เปลี่ยน | T001; T002 |

`+` add · `~` change · `-` remove

```text
.
└── .claude/
    └── harness/
        ├── runtime/
        │   ├── evidence/
        │   │   └── ~ proof-execution-runtime.mjs
        │   └── workflow/
        │       └── ~ advance-runtime.mjs
        └── tests/
            ├── ~ advance-recovery.test.mjs
            └── ~ proof-advance.test.mjs
```

## Test map

| Scenario | Level | Check | Task |
|---|---|---|---|
| cursor เปลี่ยนหลังตัดสินใจ; ไม่มี pass อื่นแทรก; advance ส่ง token | task check | `node --test .claude/harness/tests/proof-advance.test.mjs .claude/harness/tests/advance-recovery.test.mjs` | T001 |
| owner เป็น null; owner กำลัง initialize; owner ตายแล้ว | task check | `node --test .claude/harness/tests/advance-recovery.test.mjs` | T002 |

## Decisions

- **Decision ID:** DEC-001
  - **Status:** accepted
  - **Decision:** ใช้ cursor token ที่ advance อ่านตอนตัดสินใจ แทนการล็อก advance ทั้งคำสั่ง
  - **Why:** proof มี lock อยู่แล้ว; race ที่ยืนยันได้คือ baseline ของ gate ถูกเขียนหลังการตัดสินใจ; การล็อกทั้งคำสั่งเปลี่ยนพฤติกรรมของ host ที่รัน advance เบื้องหลัง
  - **Rejected:** none
  - **Consequences:** gate pass ที่ซ้อนกันอาจรันซ้ำหนึ่งครั้งแต่ไม่สร้าง no-progress ปลอม; การนับซ้ำใน observe ยังเหลือ
  - **Decided by:** agent

## Compatibility and migration

ชื่อคำสั่งและ output ของ advance คงเดิม; flag ใหม่ภายในของ proof advance ใช้เฉพาะเมื่อ advance ส่งมา; ไม่เปลี่ยน protocol.json
