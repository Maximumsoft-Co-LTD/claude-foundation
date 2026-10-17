# Design

## Work type

bugfix

## Decisions

- **Decision ID:** DEC-001
  - **Status:** accepted
  - **Decision:** ระบุ skill ใน task ของ EDIT และเขียน description ของ 5 skill ที่ทดสอบแล้วด้วยคำของ spec
  - **Why:** ผู้ใช้สั่ง ทำเลย หลังเห็นผลทดสอบ 12/12
  - **Rejected:** none
  - **Consequences:** Not stated in the draft

## แผนที่ไฟล์

| Tasks | Paths |
|---|---|
| T001 | `.claude/harness/runtime/workflow/advance-runtime.mjs`, `.claude/harness/runtime/workflow/skill-routing.mjs`, `.claude/harness/tests/advance-runtime.test.mjs` |
| T001; T002 | `.claude/harness/tests/skill-routing.test.mjs` |
| T002 | `.claude/skills/testing-fundamentals/SKILL.md`, `.claude/skills/database-fundamentals/SKILL.md`, `.claude/skills/api-design-fundamentals/SKILL.md`, `.claude/skills/security-fundamentals/SKILL.md`, `.claude/skills/debug-fundamentals/SKILL.md` |

`+` add · `~` change · `-` remove

```text
.
└── .claude/
    ├── harness/
    │   ├── runtime/
    │   │   └── workflow/
    │   │       ├── ~ advance-runtime.mjs
    │   │       └── ~ skill-routing.mjs
    │   └── tests/
    │       ├── ~ advance-runtime.test.mjs
    │       └── ~ skill-routing.test.mjs
    └── skills/
        ├── api-design-fundamentals/
        │   └── ~ SKILL.md
        ├── database-fundamentals/
        │   └── ~ SKILL.md
        ├── debug-fundamentals/
        │   └── ~ SKILL.md
        ├── security-fundamentals/
        │   └── ~ SKILL.md
        └── testing-fundamentals/
            └── ~ SKILL.md
```

## แผนที่ test

| Scenario | Level | Check | Task |
|---|---|---|---|
| task ระบุ skill; ไม่มี skill | task check | `node --test .claude/harness/tests/advance-runtime.test.mjs .claude/harness/tests/skill-routing.test.mjs` | T001 |
| description อ้าง spec | task check | `node --test .claude/harness/tests/skill-routing.test.mjs` | T002 |
