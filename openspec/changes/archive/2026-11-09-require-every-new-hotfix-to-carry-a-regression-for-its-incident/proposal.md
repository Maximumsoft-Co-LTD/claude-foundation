# Change: Require every new hotfix to carry a regression for its incident

- **Change:** `require-every-new-hotfix-to-carry-a-regression-for-its-incident` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** medium tier · **Owner:** unassigned · **Created:** 2026-11-09

## เหตุผล

ตอนนี้ช่อง `bugfix.regression` ของ hotfix เป็นแค่ข้อความ hotfix จึงถึง archived ได้โดยไม่มีเทสต์ที่จับ incident นั้น และโปรเจกต์ผู้ใช้ไม่มีที่บันทึก incident หรือบทเรียนที่ agent ใช้ต่อได้ change นี้บังคับ regression ที่รันได้และผูกกับ incident สำหรับ hotfix ที่สร้างหลังอัปเกรด และส่งที่บันทึก incident กับบทเรียนให้ทุกโปรเจกต์

## ขอบเขต

- **In scope (`work-type-catalog`):** hotfix ที่สร้างหลังอัปเกรดทุกตัวมี claim regression ที่ต้อง proven ก่อน archived; ทุกโปรเจกต์มีที่บันทึก incident และบทเรียน ไฟล์ที่มีอยู่ไม่ถูกแตะ; agent เห็นบทเรียนของโปรเจกต์ก่อนเริ่ม investigate และ change
- **Out of scope:** edits outside `.claude/harness/runtime/workflow/**`, `.claude/harness/tests/**`, `install.sh`, `.claude/harness/templates/**`, `.claude/tests/harness/run-installer-tests.sh`, `.claude/harness/runtime/core/**`, … +4 more; the authored Non-goals below

## Non-goals

- บังคับ regression กับ bugfix ทั่วไปหรือ change ชนิดอื่น
- บังคับกับ hotfix ที่สร้างก่อนอัปเกรด รวมเมื่อ revise หรือ amend
- เพิ่มฟิลด์ใน claim ของ evidence.yaml หรือ bump protocol
- eval runner ของ agent และ eval ที่เรียก model จริง (อยู่ใน change แยกเฉพาะ repo นี้)
- เพิ่มข้อความใน instruction ของ agent ที่งบ context เต็มแล้ว

## ผลกระทบและความเสี่ยง

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected

## บันทึกการตัดสินใจของผู้ใช้

ผู้ใช้ตัดสินเมื่อ 2026-11-09:

- hotfix ต้องมี regression ผูกกับ incident ก่อน archived (บังคับ)
- กฎใช้กับ hotfix ที่สร้างหลังอัปเกรดเท่านั้น
- ส่ง incident template และ lessons.md ให้โปรเจกต์ผู้ใช้

## การสื่อสาร การดูแลหลังปล่อย และ release note

### Release note

A new hotfix must name a regression scenario for its incident, proven before it can be archived. New and upgraded installs get an incident record template and an openspec/lessons.md that investigations and changes read as grounding.

## วิธีตรวจด้วยตัวเอง

1. ร่าง hotfix ที่มี `incident.link` แต่ไม่มี scenario `regressionOf` แล้วรัน `change start` ต้องได้ EDIT
2. เพิ่ม scenario `regressionOf` ใน requirement ที่มี capability test แล้วรันใหม่ ต้องสร้าง change ได้
3. ติดตั้งในโปรเจกต์ใหม่ ต้องได้ `openspec/incidents/` และ `openspec/lessons.md`

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| hotfix-regression-required | hotfix ครบ | success | T001, T004 | test: `.claude/harness/tests/**` | — |
|  | regressionOf ไม่ตรง incident | boundary | T001, T004 |  |  |
|  | regression ไม่มี capability ที่รันได้ | boundary | T001, T004 |  |  |
|  | bugfix ที่ไม่ใช่ hotfix | boundary | T001, T004 |  |  |
|  | revise hotfix ที่สร้างก่อนอัปเกรด | boundary | T001, T004 |  |  |
|  | hotfix ไม่มี regression | failure | T001, T004 |  |  |
|  | revise hotfix ที่สร้างหลังอัปเกรด | failure | T001, T004 |  |  |
| incident-and-lessons-seeded | ติดตั้งใหม่ | success | T002, T004 | test: `.claude/tests/harness/run-installer-tests.sh` | — |
|  | มีบางไฟล์อยู่แล้ว | boundary | T002, T004 |  |  |
|  | ติดตั้งล้มกลางทาง | failure | T002, T004 |  |  |
| lessons-read-as-grounding | มี lessons.md | success | T003, T004 | test: `.claude/harness/tests/**` | — |
|  | ไม่มี lessons.md | boundary | T003, T004 |  |  |
|  | แก้ lessons.md หลัง intake | boundary | T003, T004 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (13).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, standard model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ความครอบคลุมของการสำรวจ

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| current-behavior | covered | hotfix-regression-required |  |  |
| compatibility | covered | hotfix-regression-required, incident-and-lessons-seeded |  |  |
| input-boundary | covered | hotfix-regression-required |  |  |
| non-goals | covered | hotfix-regression-required |  |  |

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Failure matrix:** read from the failure scenarios (3); recovery is "No separate step; the outcome is the handling" where unstated.
- **Evidence capabilities:** defaulted to `test` (`static-analysis` for docs/chore) for hotfix-regression-required, incident-and-lessons-seeded, lessons-read-as-grounding.

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | minor-investigation-lessons-test: The lessons seed is tested at `inspectRepositoryIntelligence` and through change intake. No test covers `investigation-runtime.mjs` with a lessons file present. The scenario says investigation as well as change intake. The shared function makes it work by construction, so this is a coverage gap only. (root/.claude/harness/tests/repository-intelligence.test.mjs:322) | minor | ยังเปิดอยู่ | claude-opus |
