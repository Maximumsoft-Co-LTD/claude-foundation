# Design

## Work type

bugfix

## Bugfix analysis

| ส่วน | รายละเอียด |
|---|---|
| วิธีทำให้เกิดซ้ำ | paid lane visual-prototype-drift: draft ประกาศ capability browser และวาง execution.yaml ใน draft folder; change start ตอบ configured browser provider requires a valid inputMode ทุกครั้งและ rollback |
| สาเหตุที่แท้จริง | loadDraftFolder อ่านแค่ change.json, proposal.md และ design.md จึงไม่เห็น execution.yaml; ข้อความ inputMode และ executable evidence wiring ไม่บอกรูปแบบหรือที่ตั้งค่า |
| หลักฐาน regression | test โหลด draft folder ที่มี execution.yaml, test ข้อความ inputMode ที่ระบุ provider และค่าที่ใช้ได้, test ข้อความ execution ที่ขาด version |

## Decisions

- **Decision ID:** DEC-001
  - **Status:** accepted
  - **Decision:** ไม่เติม inputMode ให้ browser provider ที่สร้างจาก verify อัตโนมัติ แต่ทำให้ error บอกวิธีต่อ provider เอง
  - **Why:** คำสั่ง verify ไม่ใช่การรัน browser การเติม inputMode อัตโนมัติจะเป็นหลักฐานที่ไม่ตรงความจริง
  - **Rejected:** none
  - **Consequences:** draft ที่ใช้ browser ต้องต่อ provider เองใน change.json หรือ execution.yaml

## ตารางความล้มเหลว

| Failure | User sees | Recovery | Covers |
|---|---|---|---|
| ประกาศ execution สองที่ | ได้ issue ที่บอกให้เก็บ execution ไว้ที่เดียว | ลบที่ใดที่หนึ่ง | draft-folder-execution |
| execution.yaml ไม่ใช่ JSON | ได้ issue ที่ระบุไฟล์และบอกว่าต้องเป็น JSON | แก้ไฟล์ให้เป็น JSON | draft-folder-execution |
| browser provider ไม่มี inputMode | error ระบุชื่อ provider ค่า browser-automation, dom-event, os-input, both และบอกให้ตั้งใน execution ของ draft หรือ execution.yaml | เพิ่ม inputMode ให้ provider | actionable-wiring-errors |
| execution ของ draft ไม่มี version | issue บอกรูปแบบ {version: 1, providers: {...}} | เพิ่ม version 1 | actionable-wiring-errors |

## แผนที่ไฟล์

| Tasks | Paths |
|---|---|
| T001 | `.claude/harness/runtime/workflow/draft-folder.mjs`, `.claude/harness/runtime/evidence/evidence-contract.mjs`, `.claude/harness/runtime/workflow/change-lifecycle.mjs`, `.claude/harness/tests/draft-execution-wiring.test.mjs` (add), `.claude/tests/harness/run-evidence-contract-tests.mjs`, `.claude/skills/change/references/workflow.md`, `.claude/tests/run-all.sh`, `.claude/tests/README.md`, `CHANGELOG.md` |

`+` add · `~` change · `-` remove

```text
.
├── .claude/
│   ├── harness/
│   │   ├── runtime/
│   │   │   ├── evidence/
│   │   │   │   └── ~ evidence-contract.mjs
│   │   │   └── workflow/
│   │   │       ├── ~ change-lifecycle.mjs
│   │   │       └── ~ draft-folder.mjs
│   │   └── tests/
│   │       └── + draft-execution-wiring.test.mjs
│   ├── skills/
│   │   └── change/
│   │       └── references/
│   │           └── ~ workflow.md
│   └── tests/
│       ├── harness/
│       │   └── ~ run-evidence-contract-tests.mjs
│       ├── ~ README.md
│       └── ~ run-all.sh
└── ~ CHANGELOG.md
```

## แผนที่ test

| Scenario | Level | Check | Task |
|---|---|---|---|
| draft folder มี execution.yaml; ประกาศ execution สองที่; execution.yaml ไม่ใช่ JSON; browser provider ไม่มี inputMode; execution ของ draft ไม่มี version; browser provider ที่ถูกต้อง | task check | `node --test .claude/harness/tests/draft-execution-wiring.test.mjs` | T001 |
