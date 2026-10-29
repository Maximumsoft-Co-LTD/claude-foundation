# Design

## Work type

bugfix

## Bugfix analysis

| ส่วน | รายละเอียด |
|---|---|
| วิธีทำให้เกิดซ้ำ | multi-repo change: amend verify ระหว่าง Prove → authority extend-review → advance ได้ CONTRACT_DECISION_REQUIRED → change resolve --reopen-grounding + validate → advance --approve-spec ลบ amendment ใน sandbox → test provider fail → amend อีก → วนซ้ำ (incident hpx-control-plane 2026-10-27/28) |
| สาเหตุที่แท้จริง | contractFingerprint รวม grantedAiWaveCap (budget) จึงเปลี่ยนเมื่อ user ให้สิทธิ์; approve-spec นับ amendment ว่าถูกต้องเฉพาะเมื่อ revision เท่ากับ contractRevision ปัจจุบัน ซึ่ง reopen-grounding bump ไปแล้ว; spec approval, waiver, lease, Decision Sheet ผูกกับตัวนับ contractRevision แทนเนื้อหา |
| หลักฐาน regression | unit test: grant หลัง final AI delta ไม่คืน CONTRACT_DECISION_REQUIRED; amend → reopen-grounding → validate → approve-spec คง tasks.md ที่ amend; reopen-grounding ไม่ทำให้ spec approval / waiver / lease หมดอายุเมื่อเนื้อหาข้อตกลงเท่าเดิม |

## Decisions

- **Decision ID:** DEC-001
  - **Status:** accepted
  - **Decision:** ตัด grantedAiWaveCap และฟิลด์ budget/authority อื่นออกจาก contractFingerprint; จำนวน wave ที่ได้สิทธิ์เพิ่มอ่านจาก reviewHistory ตอนรันเท่านั้น
  - **Why:** budget ไม่ใช่ข้อตกลง; receipt ที่ผูก fingerprint เดิมต้องยังใช้ได้หลังให้สิทธิ์
  - **Rejected:** none
  - **Consequences:** receipt และ plan ที่ผูก fingerprint ก่อน grant ยังใช้ได้; wave cap ที่เพิ่มขึ้นอ่านจาก reviewHistory ตอน dispatch และไม่ปรากฏใน fingerprint อีก

## ตารางความล้มเหลว

| Failure | User sees | Recovery | Covers |
|---|---|---|---|
| ข้อตกลงเปลี่ยนจริงยังถูกจับได้ | review closure ยังคืน CONTRACT_DECISION_REQUIRED พร้อม command เดิม | user ให้ decision revision ตาม command | budget-outside-fingerprint |
| แก้ packet นอก amendment ยังถูก restore | harness restore ข้อความที่ amend ไว้ล่าสุด (ไม่ใช่ root packet เก่า) และเก็บสำเนาที่แก้ไว้ใน .foundation/agreement-drift/<id>/ | agent แสดงเจตนาที่เปลี่ยนด้วย change amend | amendment-survives-approval |
| เนื้อหาเปลี่ยนยังต้องขอใหม่ | advance ขอ approve-spec ใหม่ และ waiver ที่ผูกเนื้อหาเดิมถูกรายงานว่าหมดอายุ | user approve หรือ waive ใหม่ด้วย decision-ref ใหม่ | authority-binds-to-content |

## แผนที่ไฟล์

| Tasks | Paths |
|---|---|
| T001 | `.claude/harness/runtime/evidence/evidence-contract.mjs`, `.claude/harness/runtime/evidence/review-attempt-store.mjs`, `.claude/harness/tests/authority-fingerprint.test.mjs` (add), `.claude/harness/tests/review-repair-closure.test.mjs`, `.claude/harness/tests/receipt-validity.test.mjs` |
| T001; T003 | `.claude/harness/runtime/evidence/receipt-runtime.mjs` |
| T001; T002; T003 | `.claude/tests/run-all.sh` |
| T002; T003 | `.claude/harness/runtime/workflow/change-lifecycle.mjs` |
| T002; T003; T004 | `.claude/harness/runtime/core/user-decisions.mjs` |
| T002 | `.claude/harness/runtime/workflow/sandbox-runtime.mjs`, `.claude/harness/tests/amendment-approval-survival.test.mjs` (add), `.claude/harness/tests/sandbox-runtime-sync.test.mjs` |
| T002; T004 | `.claude/harness/tests/user-decisions.test.mjs` |
| T003 | `.claude/harness/runtime/workflow/change-validation.mjs`, `.claude/harness/runtime/core/execution-contract.mjs`, `.claude/harness/runtime/workflow/lease-runtime.mjs`, `.claude/harness/runtime/workflow/approval-package.mjs`, `.claude/harness/runtime/workflow/apply-runtime.mjs`, `.claude/harness/tests/authority-continuity.test.mjs` (add), `.claude/harness/tests/approval-lanes.test.mjs`, `.claude/harness/tests/change-resolution.test.mjs`, `.claude/harness/tests/review-closure-helpers.test.mjs` |
| T005 | `WORKFLOW.md`, `.claude/harness/README.md`, `.claude/tests/README.md`, `CHANGELOG.md` |

`+` add · `~` change · `-` remove

```text
.
├── .claude/
│   ├── harness/
│   │   ├── ~ README.md
│   │   ├── runtime/
│   │   │   ├── core/
│   │   │   │   ├── ~ execution-contract.mjs
│   │   │   │   └── ~ user-decisions.mjs
│   │   │   ├── evidence/
│   │   │   │   ├── ~ evidence-contract.mjs
│   │   │   │   ├── ~ receipt-runtime.mjs
│   │   │   │   └── ~ review-attempt-store.mjs
│   │   │   └── workflow/
│   │   │       ├── ~ apply-runtime.mjs
│   │   │       ├── ~ approval-package.mjs
│   │   │       ├── ~ change-lifecycle.mjs
│   │   │       ├── ~ change-validation.mjs
│   │   │       ├── ~ lease-runtime.mjs
│   │   │       └── ~ sandbox-runtime.mjs
│   │   └── tests/
│   │       ├── + amendment-approval-survival.test.mjs
│   │       ├── ~ approval-lanes.test.mjs
│   │       ├── + authority-continuity.test.mjs
│   │       ├── + authority-fingerprint.test.mjs
│   │       ├── ~ change-resolution.test.mjs
│   │       ├── ~ receipt-validity.test.mjs
│   │       ├── ~ review-closure-helpers.test.mjs
│   │       ├── ~ review-repair-closure.test.mjs
│   │       ├── ~ sandbox-runtime-sync.test.mjs
│   │       └── ~ user-decisions.test.mjs
│   └── tests/
│       ├── ~ README.md
│       └── ~ run-all.sh
├── ~ CHANGELOG.md
└── ~ WORKFLOW.md
```

## แผนที่ test

| Scenario | Level | Check | Task |
|---|---|---|---|
| grant หลัง final AI delta แล้วรัน wave ได้; grant ไม่ทำให้ receipt provider อื่น stale; ข้อตกลงเปลี่ยนจริงยังถูกจับได้ | task check | `node --test .claude/harness/tests/authority-fingerprint.test.mjs .claude/harness/tests/review-repair-closure.test.mjs .claude/harness/tests/receipt-validity.test.mjs` | T001 |
| amend แล้ว reopen grounding แล้ว approve; amendment หลายรอบคงรอบล่าสุด; แก้ packet นอก amendment ยังถูก restore | task check | `node --test .claude/harness/tests/amendment-approval-survival.test.mjs .claude/harness/tests/user-decisions.test.mjs .claude/harness/tests/sandbox-runtime-sync.test.mjs` | T002 |
| reopen grounding คง spec approval; reopen grounding คง waiver และ lease; approval lane ตาม identity; เนื้อหาเปลี่ยนยังต้องขอใหม่; state เดิมที่ไม่มี field ใหม่ | task check | `node --test .claude/harness/tests/authority-continuity.test.mjs .claude/harness/tests/approval-lanes.test.mjs .claude/harness/tests/change-resolution.test.mjs .claude/harness/tests/review-closure-helpers.test.mjs` | T003 |
| notice ระบุไฟล์; ไม่มีไฟล์ต่างกัน | task check | `node --test .claude/harness/tests/user-decisions.test.mjs` | T004 |
| reopen grounding คง spec approval; reopen grounding คง waiver และ lease; approval lane ตาม identity; เนื้อหาเปลี่ยนยังต้องขอใหม่; state เดิมที่ไม่มี field ใหม่; amend แล้ว reopen grounding แล้ว approve; amendment หลายรอบคงรอบล่าสุด; แก้ packet นอก amendment ยังถูก restore; grant หลัง final AI delta แล้วรัน wave ได้; grant ไม่ทำให้ receipt provider อื่น stale; ข้อตกลงเปลี่ยนจริงยังถูกจับได้ | task check | `bash .claude/tests/docs/run-doc-consistency.sh` | T005 |
