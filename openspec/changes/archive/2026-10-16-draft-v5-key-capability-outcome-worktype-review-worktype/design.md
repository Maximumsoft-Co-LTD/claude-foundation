# Design

## Work type

bugfix, feature

## Decisions

- **Decision ID:** DEC-001
  - **Status:** accepted
  - **Decision:** change เดียวรวม 3 ข้อ: draft v5 ที่มี key, workType ไม่ยก tier และผูกหลักฐาน 4 workType
  - **Why:** ผู้ใช้สั่ง /dev และ /land หลังเห็นข้อเสนอและผล POC
  - **Rejected:** none
  - **Consequences:** Not stated in the draft

## ตารางความล้มเหลว

| Failure | User sees | Recovery | Covers |
|---|---|---|---|
| draft v5 ที่มี key | harness เติม capability และ outcome และไม่คืน error ว่า capability หรือ outcome is required | No separate step; the outcome is the handling | v5-keyed-defaults |

## แผนที่ไฟล์

| Tasks | Paths |
|---|---|
| T001 | `.claude/harness/runtime/workflow/semantic-draft.mjs`, `.claude/harness/tests/draft-folder.test.mjs` |
| T002 | `.claude/harness/runtime/evidence/evidence-contract.mjs`, `.claude/harness/foundation.mjs`, `.claude/harness/tests/review-policy.test.mjs` |
| T002; T003 | `.claude/harness/EVIDENCE.md` |
| T003 | `.claude/harness/runtime/workflow/change-policy.mjs`, `.claude/harness/runtime/evidence/provider-catalog.mjs`, `.claude/harness/runtime/evidence/evidence-bootstrap.mjs`, `.claude/harness/tests/change-policy-surface.test.mjs` |

`+` add · `~` change · `-` remove

```text
.
└── .claude/
    └── harness/
        ├── ~ EVIDENCE.md
        ├── ~ foundation.mjs
        ├── runtime/
        │   ├── evidence/
        │   │   ├── ~ evidence-bootstrap.mjs
        │   │   ├── ~ evidence-contract.mjs
        │   │   └── ~ provider-catalog.mjs
        │   └── workflow/
        │       ├── ~ change-policy.mjs
        │       └── ~ semantic-draft.mjs
        └── tests/
            ├── ~ change-policy-surface.test.mjs
            ├── ~ draft-folder.test.mjs
            └── ~ review-policy.test.mjs
```

## แผนที่ test

| Scenario | Level | Check | Task |
|---|---|---|---|
| draft v5 ที่มี key; draft v5 แบบเต็มคงเดิม | task check | `node --test .claude/harness/tests/draft-folder.test.mjs` | T001 |
| api ที่ไม่มี risk อื่น; path บังคับ compatibility | task check | `node --test .claude/harness/tests/review-policy.test.mjs` | T002 |
| ประกาศ async; ประกาศ deprecation | task check | `node --test .claude/harness/tests/change-policy-surface.test.mjs` | T003 |
