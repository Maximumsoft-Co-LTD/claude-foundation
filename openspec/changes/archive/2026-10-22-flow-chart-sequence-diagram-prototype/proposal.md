# Change: แสดงแผนภาพและ prototype บนการ์ด และตัดแถบตัดสินใจท้ายหน้าออก

- **Change:** `flow-chart-sequence-diagram-prototype` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** medium tier · **Owner:** unassigned · **Created:** 2026-10-22

## เหตุผล

หน้า approval package วาด flow chart และ sequence diagram ได้ แต่ change แรกของหน้านี้ย้ายแผนภาพไปไว้ในส่วนรายละเอียดผู้ตรวจที่พับปิดไว้ และการ์ดแบบ A แสดงแค่ข้อความ ผู้อนุมัติที่ไม่ได้กางส่วนนั้นจึงไม่เห็นแผนภาพหรือ prototype เลย change นี้ย้ายแผนภาพขึ้นไปอยู่ในการ์ดที่เกี่ยวข้องและวาง prototype ไว้บนสุดของตัวอย่าง โดยไม่เพิ่ม gate ใหม่

## User story

- **P1** ในฐานะ ผู้อนุมัติที่ไม่เขียนโค้ด ฉันต้องการ เห็นเส้นทางผู้ใช้ ลำดับการทำงาน และต้นแบบหน้าจอโดยไม่ต้องกางอะไร เพื่อ เข้าใจสิ่งที่กำลังอนุมัติจากภาพก่อนอ่านตาราง Requirement: flow-in-card-a, sequence-in-cards, prototype-visible.
- **P2** ในฐานะ ผู้อนุมัติที่ใช้มือถือ ฉันต้องการ ดูแผนภาพที่กว้างได้โดยเลื่อนแนวนอน เพื่อ ไม่ถูกตัดหรือทำให้หน้าล้น Requirement: diagram-layout.

## เกณฑ์ความสำเร็จ

- draft ที่มี userFlow.source และ diagrams แสดง SVG ของแต่ละแผนภาพภายในการ์ดที่เกี่ยวข้องโดยไม่ต้องกางส่วนใด ตามที่ test ตรวจ th และ en
- ไม่มีแผนภาพใดซ้ำสองที่ และไม่มี gate ใหม่ที่กั้นอนุมัติ Build หรือ Land

## ขอบเขต

- **In scope (`approval-package`):** ผู้อนุมัติเห็นเส้นทางผู้ใช้เป็นภาพในการ์ดโดยไม่ต้องกางอะไร; แผนภาพแต่ละรูปอยู่ในการ์ดที่ผู้อนุมัติกำลังอ่านเรื่องนั้น; ผู้อนุมัติเห็นต้นแบบหน้าจอก่อนตัวอย่างอื่น หรือรู้ว่ายังไม่มี; แผนภาพกว้างไม่ทำให้หน้าล้นบนมือถือ; การ์ดก่อน-หลังตรงตามแบบที่ออกแบบ และหัวข้อไม่ซ้ำ; ผู้อนุมัติไม่เห็นส่วนตัดสินใจซ้ำซ้อนกับการถามในแชท; ผู้ตรวจรู้ว่าใครยังไม่อนุมัติโดยไม่ต้องมีส่วนตัดสินใจ; ไม่มีแถบตัดสินใจบนหน้า package; ผู้อนุมัติรู้ความเสี่ยงและสิ่งที่ได้ก่อนอ่านตารางเทคนิค; ผู้อนุมัติเห็นว่าอะไรเปลี่ยนและต้องตอบอะไรก่อนอนุมัติ; ผู้อนุมัติเห็นระดับความเสี่ยงชัดจากสีและข้อความ และไม่มีองค์ประกอบล้นหรือยืดผิดรูป
- **Out of scope:** edits outside `.claude/harness/runtime/workflow/approval-package.mjs`, `.claude/harness/runtime/workflow/approval-cards.mjs`, `.claude/harness/runtime/workflow/scratch-blocks.mjs`, `.claude/harness/tests/approval-package.test.mjs`, `.claude/harness/tests/scratch-blocks.test.mjs`, `.claude/harness/tests/approval-lanes.test.mjs`, … +3 more; the authored Non-goals below

## Non-goals

- ไม่เปลี่ยน draft schema หรือ protocol.json
- ไม่บังคับให้มี prototype หรือแผนภาพ
- ไม่เพิ่ม script นอกจากตัวโหลด Mermaid เดิม
- ไม่ทำ prototype ให้เองจากโค้ด
- ไม่เปลี่ยนการถามอนุมัติในแชทหรือคำสั่ง advance --approve-spec

## ผลกระทบและความเสี่ยง

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected

## การสื่อสาร การดูแลหลังปล่อย และ release note

### Release note

หน้า approval package แสดง flow chart, sequence diagram และ prototype บนการ์ดโดยไม่ต้องกางส่วนที่พับ

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| flow-in-card-a | มี userFlow | success | T001, T002 | test: `.claude/harness/tests/approval-package.test.mjs`, `.claude/harness/tests/scratch-blocks.test.mjs`, `.claude/harness/tests/approval-lanes.test.mjs` | — |
|  | ไม่มี source | boundary | T001, T002 |  |  |
|  | วาดไม่ได้ | failure | T001, T002 |  |  |
| sequence-in-cards | sequence กับ api | success | T001, T002 | test: `.claude/harness/tests/approval-package.test.mjs`, `.claude/harness/tests/scratch-blocks.test.mjs`, `.claude/harness/tests/approval-lanes.test.mjs` | — |
|  | state กับ async | success | T001, T002 |  |  |
|  | ไม่มีการ์ดที่ตรง | boundary | T001, T002 |  |  |
|  | ไม่มีการ์ดเลย | failure | T001, T002 |  |  |
| prototype-visible | prototype ไม่ใช่ตัวแรก | success | T001, T002 | test: `.claude/harness/tests/approval-package.test.mjs`, `.claude/harness/tests/scratch-blocks.test.mjs`, `.claude/harness/tests/approval-lanes.test.mjs` | — |
|  | ไม่มี prototype | boundary | T001, T002 |  |  |
|  | งานที่ไม่ใช่แบบ A | boundary | T001, T002 |  |  |
|  | ไม่กั้นการเริ่ม | failure | T001, T002 |  |  |
| diagram-layout | กรอบเลื่อนได้ | success | T001, T002 | test: `.claude/harness/tests/approval-package.test.mjs`, `.claude/harness/tests/scratch-blocks.test.mjs`, `.claude/harness/tests/approval-lanes.test.mjs` | — |
|  | ไม่มี script เพิ่ม | boundary | T001, T002 |  |  |
| visual-fixes | ป้ายกะทัดรัด | success | T002 | test | — |
|  | หัวข้อต่างกัน | success | T002 |  |  |
| no-decision-bar | ไม่มีส่วนตัดสินใจ | success | T001, T002 | test: `.claude/harness/tests/approval-package.test.mjs`, `.claude/harness/tests/scratch-blocks.test.mjs`, `.claude/harness/tests/approval-lanes.test.mjs` | — |
|  | ไม่มี form หรือ script | boundary | T001, T002 |  |  |
|  | ถามในแชทเหมือนเดิม | boundary | T001, T002 |  |  |
| approval-status-line | อนุมัติแล้ว | success | T001, T002 | test: `.claude/harness/tests/approval-package.test.mjs`, `.claude/harness/tests/scratch-blocks.test.mjs`, `.claude/harness/tests/approval-lanes.test.mjs` | — |
|  | lane ยังไม่ครบ | success | T001, T002 |  |  |
|  | ไม่มีอะไรต้องบอก | boundary | T001, T002 |  |  |
| decision-first-page | สรุปมาก่อน | success | T001, T002 | test: `.claude/harness/tests/approval-package.test.mjs`, `.claude/harness/tests/scratch-blocks.test.mjs`, `.claude/harness/tests/approval-lanes.test.mjs` | — |
|  | ไม่ทราบตัวเลขขอบเขต | boundary | T001, T002 |  |  |
|  | ไม่มี scratch | failure | T001, T002 |  |  |
| before-after-and-questions | มีคำถามค้าง | success | T001, T002 | test: `.claude/harness/tests/approval-package.test.mjs`, `.claude/harness/tests/scratch-blocks.test.mjs`, `.claude/harness/tests/approval-lanes.test.mjs` | — |
|  | ไม่มีคำถามค้าง | boundary | T001, T002 |  |  |
|  | คำถามเป็นข้อความอันตราย | failure | T001, T002 |  |  |
|  | ไม่มีสรุปก่อน-หลัง | failure | T001, T002 |  |  |
| visual-polish | แถบความเสี่ยงมีสีตามระดับ | success | T001 | test: `.claude/harness/tests/approval-package.test.mjs`, `.claude/harness/tests/scratch-blocks.test.mjs`, `.claude/harness/tests/approval-lanes.test.mjs` | — |
|  | ชิปยาวไม่ล้น | boundary | T001 |  |  |
|  | แท็กก่อนหลังพอดีตัว | boundary | T001 |  |  |
|  | โหมดมืด | failure | T001 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (32).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, standard model).
- Land archives it; Land never commits.
- Success: the Success criteria above hold.

## ภาคผนวก: ความครอบคลุมของการสำรวจ

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| current-behavior | covered | flow-in-card-a, sequence-in-cards, visual-fixes, no-decision-bar, approval-status-line, visual-polish |  |  |
| input-boundary | covered | sequence-in-cards, prototype-visible |  |  |
| compatibility | not-applicable |  |  | หน้า HTML เป็นผลลัพธ์อ่านอย่างเดียว ไม่มี consumer ที่อ่านโครงของหน้า และไม่เปลี่ยน draft schema หรือ protocol.json |
| non-goals | covered | diagram-layout, prototype-visible |  |  |

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Failure matrix:** read from the failure scenarios (7); recovery is "No separate step; the outcome is the handling" where unstated.
- **Evidence capabilities:** defaulted to `test` (`static-analysis` for docs/chore) for copyable-decision-bar, mobile-decision-bar, decision-first-page, before-after-and-questions.

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | minor-status-class-collision: The new status line uses class `status`, which the older `.status { font-weight: 700 }` rule (HTTP status) also matches. The 'quiet' approval line likely renders bold. Use a distinct class such as `approval-status`. (root/.claude/harness/runtime/workflow/approval-package.mjs:546) | minor | ยังเปิดอยู่ | claude-opus |
| 1 | minor-stale-comment: A leftover comment still refers to the copy-only decision bar, which this change removes. (root/.claude/harness/tests/approval-package.test.mjs:319) | minor | ยังเปิดอยู่ | claude-opus |
| 1 | minor-duplicate-frame: The diagram frame markup is duplicated inline here and in `diagramFrame` in approval-cards.mjs, so the two can drift apart. Export and reuse one helper. (root/.claude/harness/runtime/workflow/approval-package.mjs:430) | minor | ยังเปิดอยู่ | claude-opus |
