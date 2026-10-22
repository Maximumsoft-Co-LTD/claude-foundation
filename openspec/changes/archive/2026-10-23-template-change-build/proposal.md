# Change: ฝังแนวทางความพอของเทสต์ใน template ของ Change และคำสั่ง Build

- **Change:** `template-change-build` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** medium tier · **Owner:** unassigned · **Created:** 2026-10-22

## เหตุผล

ใน /dev agent ไม่เคยโหลด skill (0 จาก 13 run) แต่เนื้อหาเรื่องความพอของเทสต์ยังมีผล: tracker ตก CASE_TESTS_EXIST เมื่อ spec มี scenario น้อย (9, 7, 12) และผ่านเมื่อมี 16 ขึ้นไป change นี้ฝังแนวทางเดียวกันตรงๆ ในข้อความที่ agent อ่านอยู่แล้ว คือ template ของ change start และคำสั่ง Build EDIT โดยไม่พึ่งการโหลด skill

## เกณฑ์ความสำเร็จ

- tracker ผ่าน CASE_TESTS_EXIST อย่างน้อย 2 ใน 3 run ใหม่ เทียบกับ 3 run ก่อนแก้ที่รันบน commit เดียวกันเป็น baseline

## ขอบเขต

- เพิ่มแนวทางเขียน scenario ต่อกฎใน minimalDraftWriting
- เพิ่มบรรทัดจำนวน scenario และกฎเขียนเทสต์ที่ fail ก่อนแก้ ใน Build EDIT ของงานที่เปลี่ยนพฤติกรรม
- ไม่เพิ่ม field skills ไม่ระบุชื่อ skill ไม่กำหนดจำนวนเทสต์ขั้นต่ำ และไม่เพิ่ม gate ใหม่
- การวัดผลบน tracker (รันจริงแบบเสียเงิน) แยกต่างหากและต้องได้รับอนุญาตงบก่อน

- **In scope:** agent ที่คัดลอกจาก template ได้ spec ที่มี scenario ต่อกฎ ไม่ใช่ต่อหัวข้อกว้างๆ; agent รู้จำนวน scenario ของ task และเขียนเทสต์ครบก่อนส่งต่อ Prove
- **Out of scope:** edits outside `.claude/harness/runtime/workflow/semantic-draft.mjs`, `.claude/harness/tests/semantic-draft.test.mjs`, `.claude/harness/runtime/workflow/advance-runtime.mjs`, `.claude/harness/tests/advance-runtime.test.mjs`

## Capability ที่เปลี่ยน

| Capability | Requirements | Tasks |
|---|---|---|
| change | template-scenario-coverage | T001 |
| agent-contract | build-edit-test-adequacy | T002 |

## ผลกระทบและความเสี่ยง

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected

## การสื่อสาร การดูแลหลังปล่อย และ release note

### Release note

Change template และ Build EDIT มีแนวทางให้เขียน scenario และเทสต์ครบทุกกฎ

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| template-scenario-coverage | template มีแนวทาง scenario | success | T001 | test: `.claude/harness/tests/semantic-draft.test.mjs` | — |
|  | ไม่มีโควตาและไม่มีชื่อ skill | boundary | T001 |  |  |
| build-edit-test-adequacy | task เปลี่ยนพฤติกรรมและมี claim | success | T002 | test: `.claude/harness/tests/advance-runtime.test.mjs` | — |
|  | งานไม่เปลี่ยนพฤติกรรม | boundary | T002 |  |  |
|  | task ไม่มี claim | boundary | T002 |  |  |
|  | ไม่ระบุชื่อ skill | failure | T002 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (6).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, standard model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Failure matrix:** read from the failure scenarios (1); recovery is "No separate step; the outcome is the handling" where unstated.
- **Evidence capabilities:** defaulted to `test` (`static-analysis` for docs/chore) for template-scenario-coverage, build-edit-test-adequacy.

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | f1: Work type is change-wide (`changeWorkTypes(changePath(id))`), not per task. In a change that mixes feature and docs/refactor tasks, a docs task that links claims also gets a 'covers N scenarios' line. The agreement describes a per-task condition. Not blocking, since docs tasks rarely link claims. (root/.claude/harness/runtime/workflow/advance-runtime.mjs:1088) | minor | ยังเปิดอยู่ | claude-opus |
| 1 | f2: The `[claims:…]` regex is case-sensitive, while `semantic-amendment.mjs` parses it with `/i`. A hand-edited `[Claims:…]` tag would yield no adequacy line. This is harmless because the harness writes the tag in lowercase. (root/.claude/harness/runtime/workflow/advance-runtime.mjs:79) | minor | ยังเปิดอยู่ | claude-opus |
