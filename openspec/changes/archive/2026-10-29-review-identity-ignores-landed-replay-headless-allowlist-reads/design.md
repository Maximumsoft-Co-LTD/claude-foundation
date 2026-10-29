# Design

## Work type

bugfix

## Bugfix analysis

| ส่วน | รายละเอียด |
|---|---|
| วิธีทำให้เกิดซ้ำ | A land แล้ว; B ซ้อนบน A และ sync merge server.mjs ที่ทั้งคู่แก้ → review receipt ของ B stale (review-contribution-changed) แม้ B ไม่ได้แก้อะไรเพิ่ม → wave ใหม่ จน 4/4 หมด (run 29 ต.ค.); ใน run เดียวกัน find/grep/cat/ls ถูกปฏิเสธ 10 ครั้งเพราะ allowlist headless |
| สาเหตุที่แท้จริง | changeDiffCandidateRow diff ทุก path เทียบ baseHead ไม่ใช้ landedSynced ที่ sync บันทึก ขณะที่ review diff (landedBaseFiles) เทียบกับไฟล์ที่ land แล้ว; shipped permissions.allow ใน .claude/settings.json จงใจแคบและไม่มีกฎอ่าน |
| หลักฐาน regression | unit test: plan ให้ landed map และ exclude path ที่ merge แล้ว, row ต่อ digest ของ diff เทียบ landed file, identity เท่าเดิมเมื่อเฉพาะส่วนที่ land แล้วเปลี่ยน; installer test ยืนยัน allowlist ใหม่ exact |

## Decisions

- **Decision ID:** DEC-REVIEW-WAVE-POLICY
  - **Status:** accepted
  - **Decision:** ไม่นับ wave ใหม่เมื่อ diff ของ change เท่าเดิม โดยทำให้ identity ไม่นับงานที่ land แล้ว
  - **Why:** No alternative was open; recorded as settled
  - **Rejected:** none
  - **Consequences:** Not stated in the draft
  - **Decided by:** user
- **Decision ID:** DEC-ALLOWLIST-SCOPE
  - **Status:** accepted
  - **Decision:** เพิ่มกฎอ่านอย่างเดียวใน shipped allowlist
  - **Why:** No alternative was open; recorded as settled
  - **Rejected:** none
  - **Consequences:** Not stated in the draft
  - **Decided by:** user

## ตารางความล้มเหลว

| Failure | User sees | Recovery | Covers |
|---|---|---|---|
| identity เปลี่ยนเมื่อ B แก้ส่วนของตัวเองเพิ่ม | identity ต่างจากเดิมและ receipt review stale ด้วยเหตุ review-contribution-changed | review wave ใหม่ตามปกติ | landed-aware-diff-identity |
| diff เทียบ landed อ่านไม่ได้ | identity เป็น null (unavailable) ไม่ใช่ค่าที่เดาเอา | No separate step; the outcome is the handling | landed-aware-diff-identity |
| ไม่มีกฎเขียนหรือ git ที่เปลี่ยน state | ไม่มี rm, mv, git commit/push/reset/checkout หรือ Write นอก sandbox | No separate step; the outcome is the handling | headless-read-allowlist |

## แผนที่ไฟล์

| Tasks | Paths |
|---|---|
| T001 | `.claude/harness/runtime/workflow/sandbox-runtime.mjs`, `.claude/harness/tests/sandbox-diff-identity.test.mjs`, `.claude/harness/tests/concurrent-same-file.test.mjs`, `.claude/harness/tests/receipt-validity.test.mjs` |
| T002 | `.claude/settings.json`, `install.sh`, `.claude/tests/harness/run-installer-tests.sh`, `website/docs/src/content/docs/install.md`, `website/docs/src/content/docs/th/install.md` |
| T003 | `WORKFLOW.md`, `CHANGELOG.md` |

`+` add · `~` change · `-` remove

```text
.
├── .claude/
│   ├── harness/
│   │   ├── runtime/
│   │   │   └── workflow/
│   │   │       └── ~ sandbox-runtime.mjs
│   │   └── tests/
│   │       ├── ~ concurrent-same-file.test.mjs
│   │       ├── ~ receipt-validity.test.mjs
│   │       └── ~ sandbox-diff-identity.test.mjs
│   ├── ~ settings.json
│   └── tests/
│       └── harness/
│           └── ~ run-installer-tests.sh
├── ~ CHANGELOG.md
├── ~ install.sh
├── website/
│   └── docs/
│       └── src/
│           └── content/
│               └── docs/
│                   ├── ~ install.md
│                   └── th/
│                       └── ~ install.md
└── ~ WORKFLOW.md
```

## แผนที่ test

| Scenario | Level | Check | Task |
|---|---|---|---|
| identity ไม่เปลี่ยนเมื่อ sync เพิ่มเฉพาะงานที่ land แล้ว; identity เปลี่ยนเมื่อ B แก้ส่วนของตัวเองเพิ่ม; target เปลี่ยนหลัง sync; repository sandbox; diff เทียบ landed อ่านไม่ได้ | task check | `node --test .claude/harness/tests/sandbox-diff-identity.test.mjs .claude/harness/tests/concurrent-same-file.test.mjs .claude/harness/tests/receipt-validity.test.mjs` | T001 |
| installer ต่อท้ายกฎอ่าน; ไม่มีกฎเขียนหรือ git ที่เปลี่ยน state; opt-out | task check | `sh .claude/tests/harness/run-installer-tests.sh` | T002 |
| identity ไม่เปลี่ยนเมื่อ sync เพิ่มเฉพาะงานที่ land แล้ว; identity เปลี่ยนเมื่อ B แก้ส่วนของตัวเองเพิ่ม; target เปลี่ยนหลัง sync; repository sandbox; diff เทียบ landed อ่านไม่ได้; installer ต่อท้ายกฎอ่าน; ไม่มีกฎเขียนหรือ git ที่เปลี่ยน state; opt-out | task check | `bash .claude/tests/docs/run-doc-consistency.sh` | T003 |
