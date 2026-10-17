# Design

## Work type

bugfix

## Decisions

- **Decision ID:** DEC-001
  - **Status:** accepted
  - **Decision:** นำเฉพาะ task ที่ติ๊กกลับเข้า root packet
  - **Why:** root packet เป็นต้นฉบับของ agreement และ amendment สิ่งที่ sandbox มีเพิ่มคือความคืบหน้าของ task เท่านั้น
  - **Rejected:** none
  - **Consequences:** amendment ใน root ไม่ถูกเขียนทับ และไม่มีไฟล์อื่นของ sandbox ข้ามมาที่ root
  - **Decided by:** agent
- **Decision ID:** DEC-002
  - **Status:** accepted
  - **Decision:** แก้ ledger ก่อน release v3.6.4
  - **Why:** ผู้ใช้เลือกแก้ ledger ก่อนแล้วค่อย release
  - **Rejected:** none
  - **Consequences:** release เลื่อนไปจนกว่า order-inventory จะผ่านแบบ strict
  - **Decided by:** user

## แผนที่ไฟล์

| Tasks | Paths |
|---|---|
| T001 | `.claude/harness/runtime/workflow/apply-runtime.mjs`, `.claude/harness/foundation.mjs`, `.claude/harness/tests/child-only-ledger.test.mjs` (add), `.claude/tests/run-all.sh`, `.claude/tests/README.md`, `WORKFLOW.md` |

`+` add · `~` change · `-` remove

```text
.
├── .claude/
│   ├── harness/
│   │   ├── ~ foundation.mjs
│   │   ├── runtime/
│   │   │   └── workflow/
│   │   │       └── ~ apply-runtime.mjs
│   │   └── tests/
│   │       └── + child-only-ledger.test.mjs
│   └── tests/
│       ├── ~ README.md
│       └── ~ run-all.sh
└── ~ WORKFLOW.md
```

## แผนที่ test

| Scenario | Level | Check | Task |
|---|---|---|---|
| ทุก task เสร็จ; บรรทัดอื่นไม่เปลี่ยน; มี root | task check | `node --test .claude/harness/tests/child-only-ledger.test.mjs` | T001 |
