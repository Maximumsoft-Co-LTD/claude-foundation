# Design

## Work type

bugfix

## Bugfix analysis

| ส่วน | รายละเอียด |
|---|---|
| วิธีทำให้เกิดซ้ำ | advance ออก session lease ให้ T002 (sdk ซึ่ง dependsOn T001) → change amend reopen T001 (backend) → advance: T001 ชน scope 'contract:…' ที่ lease ของ T002 ถือ (WAIT lease-resource) และ T002 ถูก block โดย T001 (REPAIR) วนจน no-progress |
| สาเหตุที่แท้จริง | settle ใน session-lease.mjs ปล่อยเฉพาะ session lease ที่ task ผ่าน check แล้ว ไม่ปล่อย lease ที่ authority stale (leaseAuthorityIsStale: graph/contract เปลี่ยน) และ dispatch ไม่ถือว่า lease ของ session ตัวเองที่ stale เป็นว่าง |
| หลักฐาน regression | unit test ใน session-lease.test: settle discard session lease ที่ contractFingerprint/graph ไม่ตรง plan ปัจจุบัน และไม่แตะ lease ของ owner ภายนอกหรือ lease ที่ยังตรง |

## ตารางความล้มเหลว

| Failure | User sees | Recovery | Covers |
|---|---|---|---|
| lease ของ agent ภายนอกไม่ถูก discard | ไม่ถูก discard (agent นั้นต้อง re-acquire เองตามข้อความ stale เดิม) | No separate step; the outcome is the handling | stale-session-lease-discarded |

## แผนที่ไฟล์

| Tasks | Paths |
|---|---|
| T001 | `.claude/harness/runtime/workflow/session-lease.mjs`, `.claude/harness/foundation.mjs`, `.claude/harness/tests/session-lease.test.mjs` |
| T002 | `WORKFLOW.md`, `CHANGELOG.md` |

`+` add · `~` change · `-` remove

```text
.
├── .claude/
│   └── harness/
│       ├── ~ foundation.mjs
│       ├── runtime/
│       │   └── workflow/
│       │       └── ~ session-lease.mjs
│       └── tests/
│           └── ~ session-lease.test.mjs
├── ~ CHANGELOG.md
└── ~ WORKFLOW.md
```

## แผนที่ test

| Scenario | Level | Check | Task |
|---|---|---|---|
| lease stale หลัง amend ถูก discard; lease ที่ยังตรง plan ไม่ถูกแตะ; lease ของ agent ภายนอกไม่ถูก discard; deadlock หลัง reopen หายไป | task check | `node --test .claude/harness/tests/session-lease.test.mjs .claude/harness/tests/advance-runtime.test.mjs` | T001 |
| lease stale หลัง amend ถูก discard; lease ที่ยังตรง plan ไม่ถูกแตะ; lease ของ agent ภายนอกไม่ถูก discard; deadlock หลัง reopen หายไป | task check | `bash .claude/tests/docs/run-doc-consistency.sh` | T002 |
