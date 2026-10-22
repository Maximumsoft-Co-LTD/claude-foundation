# Design

## Work type

test, docs

## แผนที่ไฟล์

| Tasks | Paths |
|---|---|
| T001 | `.claude/tests/bench/openspec-native/aggregate.mjs`, `.claude/tests/bench/tests/openspec-native-aggregate.test.mjs` |
| T002 | `.claude/harness/tests/advance-runtime.test.mjs` |

`+` add · `~` change · `-` remove

```text
.
└── .claude/
    ├── harness/
    │   └── tests/
    │       └── ~ advance-runtime.test.mjs
    └── tests/
        └── bench/
            ├── openspec-native/
            │   └── ~ aggregate.mjs
            └── tests/
                └── ~ openspec-native-aggregate.test.mjs
```

## แผนที่ test

| Scenario | Level | Check | Task |
|---|---|---|---|
| ผสมวัดได้และวัดไม่ได้; วัดได้แต่ไม่มีใครโหลด; ไม่มี host stream เลย | task check | `node --test .claude/tests/bench/tests/openspec-native-aggregate.test.mjs` | T001 |
| EDIT ไม่ระบุ skill | task check | `node --test .claude/harness/tests/advance-runtime.test.mjs` | T002 |
