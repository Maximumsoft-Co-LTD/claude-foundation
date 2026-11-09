# Design

## Work type

bugfix

## Bugfix analysis

| ส่วน | รายละเอียด |
|---|---|
| วิธีทำให้เกิดซ้ำ | แก้ prototype/binding.json แบบ strict ให้ claims เป็นรายการว่าง หรือเป็น claim id ที่ไม่มีใน evidence.yaml แล้วรัน Prove การตรวจ visual ไม่ถูก required และ Prove ผ่านโดยไม่เทียบภาพ |
| สาเหตุที่แท้จริง | withVisualRequirement เพิ่ม visual เฉพาะ claim ที่ binding ระบุ และไม่ตรวจว่ารายการนั้นว่างหรืออ้าง claim ที่ contract ไม่มี |
| หลักฐาน regression | test binding strict ที่ claims ว่าง ที่ทุก claim ไม่รู้จัก และที่มีบาง claim ไม่รู้จัก แล้วตรวจว่าทุก claim ต้องการ visual และ provider คืน error โดยไม่เรียก reviewer |

## Decisions

- **Decision ID:** DEC-001
  - **Status:** accepted
  - **Decision:** binding ที่ไม่มี claim ที่ใช้ได้ หรือมี claim ที่ไม่รู้จัก ทำให้ทุก claim ต้องการ visual
  - **Why:** ไม่รู้ว่า claim ไหนตั้งใจผูก จึงต้อง fail-closed แบบเดียวกับ binding.json ที่อ่านไม่ได้
  - **Rejected:** none
  - **Consequences:** change ที่ binding ผิดจะ Prove ไม่ผ่านจนกว่าจะ revise แม้ claim ที่ไม่เกี่ยวกับ UI

## ตารางความล้มเหลว

| Failure | User sees | Recovery | Covers |
|---|---|---|---|
| claims ว่าง | ทุก claim ของ change ต้องการ visual และ receipt visual เป็น error ที่ระบุว่า binding ไม่มี claim | change revise ก่อน Build เพื่อเขียน binding ใหม่ | visual-binding-claims-fail-closed |
| claims ไม่รู้จักทั้งหมด | ทุก claim ต้องการ visual และ receipt visual เป็น error ที่ระบุ claim ที่ไม่รู้จัก | change revise ก่อน Build | visual-binding-claims-fail-closed |

## แผนที่ไฟล์

| Tasks | Paths |
|---|---|
| T001 | `.claude/harness/runtime/evidence/visual-review.mjs`, `.claude/harness/runtime/evidence/evidence-contract.mjs`, `.claude/harness/tests/visual-binding-claims.test.mjs` (add), `.claude/harness/tests/visual-binding-record.test.mjs`, `.claude/harness/EVIDENCE.md`, `.claude/tests/run-all.sh`, `.claude/tests/README.md`, `CHANGELOG.md` |

`+` add · `~` change · `-` remove

```text
.
├── .claude/
│   ├── harness/
│   │   ├── ~ EVIDENCE.md
│   │   ├── runtime/
│   │   │   └── evidence/
│   │   │       ├── ~ evidence-contract.mjs
│   │   │       └── ~ visual-review.mjs
│   │   └── tests/
│   │       ├── + visual-binding-claims.test.mjs
│   │       └── ~ visual-binding-record.test.mjs
│   └── tests/
│       ├── ~ README.md
│       └── ~ run-all.sh
└── ~ CHANGELOG.md
```

## แผนที่ test

| Scenario | Level | Check | Task |
|---|---|---|---|
| claims ว่าง; claims ไม่รู้จักทั้งหมด; claims ไม่รู้จักบางส่วน; claims ถูกต้อง | task check | `node --test .claude/harness/tests/visual-binding-claims.test.mjs .claude/harness/tests/visual-binding-record.test.mjs` | T001 |
