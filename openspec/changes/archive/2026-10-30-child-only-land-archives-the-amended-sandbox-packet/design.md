# Design

## Work type

bugfix

## Bugfix analysis

| ส่วน | รายละเอียด |
|---|---|
| วิธีทำให้เกิดซ้ำ | change เลือก backend/sdk/web (root read-only) → change amend เพิ่ม requirement + task ใน Build → advance --through archived → archived tasks.md มีแค่ task เดิม 3 ข้อ ไม่มี task ที่ amend และ proposal ไม่มี Appendix: Amendment history (lane order-inventory-lifecycle ทุก run 26–30 ต.ค.) |
| สาเหตุที่แท้จริง | applyArchiveWorkspace ใน apply-runtime.mjs เรียก syncChildOnlyTaskProgress ซึ่ง merge เฉพาะ checkbox จาก sandbox tasks.md เข้า root tasks.md ตามข้อกำหนด child-only-ledger เดิม ที่ถือว่า root packet คือ agreement แต่หลัง amend agreement คือ sandbox packet (approval ผูก identity ของมัน) แล้ว openspec archive ใช้ root packet |
| หลักฐาน regression | unit test: child-only Land ที่มี amendment แทนที่ root packet ด้วย sandbox packet ทั้งชุด (tasks.md, proposal.md, specs/) และไม่มี amendment ยัง merge เฉพาะ tick; seam test ใน concurrent-repositories หรือ child-only-ledger |

## ตารางความล้มเหลว

| Failure | User sees | Recovery | Covers |
|---|---|---|---|
| sandbox packet ไม่ตรง amendment | ไม่แทนที่ root packet และ Land หยุดด้วย drift ตามกติกาเดิม | agent แสดงเจตนาด้วย change amend หรือ harness restore | child-only-ledger |

## แผนที่ไฟล์

| Tasks | Paths |
|---|---|
| T001 | `.claude/harness/runtime/workflow/apply-runtime.mjs`, `.claude/harness/tests/child-only-ledger.test.mjs`, `.claude/harness/tests/concurrent-repositories.test.mjs` |
| T002 | `WORKFLOW.md`, `CHANGELOG.md` |

`+` add · `~` change · `-` remove

```text
.
├── .claude/
│   └── harness/
│       ├── runtime/
│       │   └── workflow/
│       │       └── ~ apply-runtime.mjs
│       └── tests/
│           ├── ~ child-only-ledger.test.mjs
│           └── ~ concurrent-repositories.test.mjs
├── ~ CHANGELOG.md
└── ~ WORKFLOW.md
```

## แผนที่ test

| Scenario | Level | Check | Task |
|---|---|---|---|
| ทุก task เสร็จ; บรรทัดอื่นไม่เปลี่ยน; มี root; amendment ทำให้ packet ทั้งชุดถูกแทนที่; sandbox packet ไม่ตรง amendment | task check | `node --test .claude/harness/tests/child-only-ledger.test.mjs .claude/harness/tests/concurrent-repositories.test.mjs` | T001 |
| ทุก task เสร็จ; บรรทัดอื่นไม่เปลี่ยน; มี root; amendment ทำให้ packet ทั้งชุดถูกแทนที่; sandbox packet ไม่ตรง amendment | task check | `bash .claude/tests/docs/run-doc-consistency.sh` | T002 |
