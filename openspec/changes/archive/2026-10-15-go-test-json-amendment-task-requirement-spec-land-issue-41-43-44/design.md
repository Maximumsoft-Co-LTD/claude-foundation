# Design

## Work type

bugfix

## Current state

evidence-results.mjs ไม่มี parser ของ go test -json; parseJsonOutput parse ทั้งก้อนจึงล้มกับ NDJSON. taskContractOnlyAmendment ตัด addTasks ออก ทำให้ addTasks ต้องมาพร้อม add/revise/removeRequirements. ข้อความ updateTasks ที่ถูกปฏิเสธบอกแค่ add a new task or set reopen. runOpenSpecArchive เรียก openspec archive (1.7.0) ซึ่งเขียน spec ที่ลงท้ายด้วย \n\n

## Bugfix analysis

- **Reproduction:** go test -json ./... ที่ผ่าน exit 0 ได้ structured test count unavailable; amendment {addTasks:[{covers:[requirement เดิม]}]} ถูกปฏิเสธด้วย requires a non-empty addRequirements; Land change-code-repository-submodule-prove-amend-waive-recovery-issu ทิ้ง openspec/specs/change/spec.md และ prove/spec.md ที่ลงท้ายด้วย \n\n
- **Root cause:** ไม่มี parser ของ go test event stream; addTasks ถูกนับเป็น requirement change; ไม่มีขั้น normalize ท้ายไฟล์หลัง openspec archive
- **Regression proof:** เทสต์ unit ของ parser, amendment และ apply-runtime ที่ fail บนโค้ดเดิม

## Failure matrix

| Failure | User sees | Recovery | Covers |
|---|---|---|---|
| เทสต์ล้มและข้าม | totalTests 3, passed 1, failed 1 | แก้เทสต์ที่ล้มแล้วรัน Prove ใหม่ | go-test-json-count |
| package build fail ไม่มี test event | failed อย่างน้อย 1 จึงไม่นับเป็นผ่าน | แก้ build แล้วรัน Prove ใหม่ | go-test-json-count |
| covers requirement ที่ไม่มี | amend ปฏิเสธว่า covers unknown requirement | แก้ covers หรือเพิ่ม requirement ด้วย addRequirements | amend-add-task-existing-requirement |
| ไม่มี covers | amend ปฏิเสธว่า task ต้อง covers requirement | ระบุ covers | amend-add-task-existing-requirement |
| task ไม่ติ๊กแต่มี receipt ผ่าน | ข้อความระบุว่า T001 ถือว่าเสร็จเพราะ claim มี passing receipt และเสนอ addTasks หรือ reopen | ใช้ reopen: true หรือ addTasks | amend-refusal-names-task-state |
| task ติ๊กแล้ว | ข้อความระบุว่า T001 ติ๊กแล้วใน tasks.md ของ agreement | ใช้ reopen: true หรือ addTasks | amend-refusal-names-task-state |

## File map

| Path | Change | Responsibility | Tasks |
|---|---|---|---|
| .claude/harness/runtime/evidence/evidence-results.mjs | change | parser ของ go test -json และการเลือกใน adapter | T001 |
| .claude/harness/runtime/evidence/adapter-runtime.mjs | change | parser ของ go test -json และการเลือกใน adapter | T001 |
| .claude/harness/tests/evidence-results.test.mjs | change | parser ของ go test -json และการเลือกใน adapter | T001 |
| .claude/harness/runtime/workflow/semantic-amendment.mjs | change | addTasks-only amendment และข้อความสถานะ task | T002 |
| .claude/harness/tests/semantic-draft.test.mjs | change | addTasks-only amendment และข้อความสถานะ task | T002 |
| .claude/harness/runtime/workflow/apply-runtime.mjs | change | normalize ท้ายไฟล์ spec ที่ archive เขียน | T003 |
| .claude/harness/tests/apply-runtime-archive.test.mjs | change | normalize ท้ายไฟล์ spec ที่ archive เขียน | T003 |
| .claude/harness/EVIDENCE.md | change | เอกสาร evidence formats และ amendment | T004 |
| WORKFLOW.md | change | เอกสาร evidence formats และ amendment | T004 |
| .claude/harness/README.md | change | เอกสาร evidence formats และ amendment | T004 |

`+` add · `~` change · `-` remove

```text
.
├── .claude/
│   └── harness/
│       ├── ~ EVIDENCE.md
│       ├── ~ README.md
│       ├── runtime/
│       │   ├── evidence/
│       │   │   ├── ~ adapter-runtime.mjs
│       │   │   └── ~ evidence-results.mjs
│       │   └── workflow/
│       │       ├── ~ apply-runtime.mjs
│       │       └── ~ semantic-amendment.mjs
│       └── tests/
│           ├── ~ apply-runtime-archive.test.mjs
│           ├── ~ evidence-results.test.mjs
│           └── ~ semantic-draft.test.mjs
└── ~ WORKFLOW.md
```

## Test map

| Scenario | Level | Check | Task |
|---|---|---|---|
| เทสต์ผ่านทั้งหมด; subtest นับแยก; เทสต์ล้มและข้าม; package build fail ไม่มี test event; รูปแบบอื่นคงเดิม | task check | `node --test .claude/harness/tests/evidence-results.test.mjs` | T001 |
| เพิ่ม task ให้ requirement เดิม; covers requirement ที่ไม่มี; ไม่มี covers; task ไม่ติ๊กแต่มี receipt ผ่าน; task ติ๊กแล้ว | task check | `node --test .claude/harness/tests/semantic-draft.test.mjs` | T002 |
| openspec archive ทิ้งบรรทัดว่าง; spec ที่ไม่ได้อยู่ใน change; recovery หลัง archive ค้าง | task check | `node --test .claude/harness/tests/apply-runtime-archive.test.mjs` | T003 |
| เทสต์ผ่านทั้งหมด; subtest นับแยก; เทสต์ล้มและข้าม; package build fail ไม่มี test event; รูปแบบอื่นคงเดิม; เพิ่ม task ให้ requirement เดิม; covers requirement ที่ไม่มี; ไม่มี covers | task check | `bash .claude/tests/docs/run-doc-consistency.sh` | T004 |

## Decisions

- **Decision ID:** DEC-001
  - **Status:** accepted
  - **Decision:** อนุญาต addTasks-only ที่ covers requirement เดิม โดยไม่ต้องมี intake
  - **Why:** ผู้ใช้ตัดสินสำหรับ #43
  - **Rejected:** none
  - **Consequences:** task ใหม่ invalidate claim ที่ครอบ; requirement change ยังต้องผ่าน intake ตามเดิม
  - **Decided by:** user
- **Decision ID:** DEC-002
  - **Status:** accepted
  - **Decision:** normalize ท้ายไฟล์ spec ฝั่ง harness หลัง openspec archive เฉพาะ capability ของ change
  - **Why:** บรรทัดว่างมาจาก OpenSpec CLI 1.7.0 ซึ่งอยู่นอก repo; การแก้ spec อื่นเป็นงานที่ไม่เกี่ยวข้อง
  - **Rejected:** none
  - **Consequences:** spec เดิม 16 ไฟล์ที่ลงท้ายด้วยบรรทัดว่างยังคงอยู่จนกว่าจะถูก change แตะ
  - **Decided by:** agent
- **Decision ID:** DEC-003
  - **Status:** accepted
  - **Decision:** นับผลสุดท้ายของแต่ละ (Package, Test) รวม subtest; skip นับใน total; package fail ที่ไม่มี test fail นับ failed อย่างน้อย 1
  - **Why:** สอดคล้องกับที่ go test -v พิมพ์ --- PASS ต่อ subtest และ fail-closed เมื่อ build fail
  - **Rejected:** none
  - **Consequences:** จำนวนเทสต์ของ Go รวม subtest
  - **Decided by:** agent

## Compatibility and migration

ชื่อคำสั่งและอาร์กิวเมนต์คงเดิม; รูปแบบรายงานเดิม (TAP, node spec, runner summary, JSON object) ยังถูกเลือกเหมือนเดิม; amendment ที่มี requirement change ทำงานเหมือนเดิม; ไม่เปลี่ยน protocol.json
