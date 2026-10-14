# Change: เก็บ requirement และบทสนทนาระหว่าง Investigate อย่างต่อเนื่องและสร้าง Change ที่ละเอียดครบโดยไม่หยุดงานอิสระ

- **Change:** `investigation-requirement-continuity` · **Lane:** standard (impact or coupling above the rapid limit (see Impact))
- **Owner:** unassigned · **Created:** 2026-10-13 · **Status:** `claude-foundation changes`

## Why

ผู้ใช้เริ่ม Investigate เพื่อสำรวจความเป็นไปได้และทำ PoC แต่ record ปัจจุบันไม่มี requirement และประวัติคำแก้ไข จึงเสี่ยงสร้าง Change จากความเข้าใจที่คลาดเคลื่อน งานนี้รักษาบริบทและตรวจ coverage โดยไม่เพิ่ม approval ทุกขั้น

## User stories

- **P1** As ผู้ใช้ที่เริ่มงานจาก Investigate, I want ให้ agent เก็บเจตนาและคำแก้ไขระหว่างคุยโดยทำงานอิสระต่อ so that ไม่ต้องตอบซ้ำและ Change ไม่ใช้ความเข้าใจเก่า. Requirements: durable-intake, nonblocking-questions, fresh-handoff.
- **P1** As ผู้ใช้ที่ตรวจเอกสาร Change, I want เห็นข้อกำหนด ข้อยกเว้น เหตุผล ผลทดลอง และวิธีตรวจรับครบ so that ตรวจความเข้าใจและอนุมัติเอกสารที่ลงมือทำได้โดยไม่ต้องย้อนอ่านแชต. Requirements: experiment-coverage, readable-report, detailed-change, compiled-coverage, compatibility.

## Success criteria

- รายการสำคัญที่บันทึกไว้ทุกข้อมี target ใน compiled packet หรือมีเหตุผลการยกเลิกหรือไม่รวมที่ตรวจตามรอยได้
- fixtures หลายรอบสนทนาและ resume รักษา ID ประวัติและ requirement ล่าสุดครบ
- คำถามค้างไม่หยุดงานที่ไม่มี dependency ต่อคำตอบและไม่สร้างการยอมรับจากความเงียบ
- requirement เปลี่ยนหลัง handoff ทำให้ binding เก่าถูกปฏิเสธและมี agent-owned refresh route
- record รุ่นเก่าผ่าน compatibility tests และ authoritative full suite ผ่าน

## Scope

- **In scope (`investigation-intake`):** เก็บความต้องการและบทสนทนา; สอบถามโดยทำงานต่อได้; ทดลองตาม requirement; ส่งต่อข้อมูลล่าสุด; รายงานบริบทครบ; เอกสาร Change ละเอียด; ตรวจความครบใน packet; รองรับรุ่นเก่าและ shipping
- **Out of scope:** edits outside `.claude/harness/runtime/workflow/**`, `.claude/harness/tests/**`, `.claude/harness/protocol.json`, `.claude/harness/runtime/version.mjs`, `.claude/harness/foundation.mjs`, `cli.sh`, … +9 more; the authored Non-goals below

## Acceptance traceability

Tasks and checks: `tasks.md`.

| Requirement › scenario | Kind | Task | Tests |
|---|---|---|---|
| durable-intake › requirement-session | happy | T001, T004, T005 | .claude/harness/tests/**, .claude/tests/** |
| durable-intake › 2 | edge | T001, T004, T005 | .claude/harness/tests/**, .claude/tests/** |
| durable-intake › missing-history | failure | T001, T004, T005 | .claude/harness/tests/**, .claude/tests/** |
| durable-intake › partial-correction | happy | T001, T004, T005 | .claude/harness/tests/**, .claude/tests/** |
| durable-intake › history-gap | edge | T001, T004, T005 | .claude/harness/tests/**, .claude/tests/** |
| nonblocking-questions › 1 | happy | T002, T004, T005 | .claude/harness/tests/**, .claude/tests/** |
| nonblocking-questions › 2 | edge | T002, T004, T005 | .claude/harness/tests/**, .claude/tests/** |
| nonblocking-questions › open-question | happy | T002, T004, T005 | .claude/harness/tests/**, .claude/tests/** |
| nonblocking-questions › independent-work | happy | T002, T004, T005 | .claude/harness/tests/**, .claude/tests/** |
| nonblocking-questions › no-silent-consent | failure | T002, T004, T005 | .claude/harness/tests/**, .claude/tests/** |
| nonblocking-questions › reuse-answer | happy | T002, T004, T005 | .claude/harness/tests/**, .claude/tests/** |
| experiment-coverage › requirement-prototype | happy | T002, T004, T005 | .claude/harness/tests/**, .claude/tests/** |
| experiment-coverage › 2 | edge | T002, T004, T005 | .claude/harness/tests/**, .claude/tests/** |
| experiment-coverage › selective-staleness | edge | T002, T004, T005 | .claude/harness/tests/**, .claude/tests/** |
| experiment-coverage › prototype-not-proof | edge | T002, T004, T005 | .claude/harness/tests/**, .claude/tests/** |
| fresh-handoff › requirement-handoff | happy | T002, T004, T005 | .claude/harness/tests/**, .claude/tests/** |
| fresh-handoff › 2 | edge | T002, T004, T005 | .claude/harness/tests/**, .claude/tests/** |
| fresh-handoff › ready-not-confirmation | happy | T002, T004, T005 | .claude/harness/tests/**, .claude/tests/** |
| fresh-handoff › stale-request | failure | T002, T004, T005 | .claude/harness/tests/**, .claude/tests/** |
| readable-report › record | happy | T003, T004, T005 | .claude/harness/tests/**, .claude/tests/** |
| readable-report › 2 | edge | T003, T004, T005 | .claude/harness/tests/**, .claude/tests/** |
| readable-report › report-recovery | failure | T003, T004, T005 | .claude/harness/tests/**, .claude/tests/** |
| detailed-change › compile-draft-requirement-design | happy | T003, T004, T005 | .claude/harness/tests/**, .claude/tests/** |
| detailed-change › 2 | edge | T003, T004, T005 | .claude/harness/tests/**, .claude/tests/** |
| detailed-change › preserve-details | happy | T003, T004, T005 | .claude/harness/tests/**, .claude/tests/** |
| detailed-change › no-empty-design | edge | T003, T004, T005 | .claude/harness/tests/**, .claude/tests/** |
| compiled-coverage › change-target | happy | T003, T004, T005 | .claude/harness/tests/**, .claude/tests/** |
| compiled-coverage › 2 | edge | T003, T004, T005 | .claude/harness/tests/**, .claude/tests/** |
| compiled-coverage › missing-target | failure | T003, T004, T005 | .claude/harness/tests/**, .claude/tests/** |
| compiled-coverage › many-to-many | happy | T003, T004, T005 | .claude/harness/tests/**, .claude/tests/** |
| compiled-coverage › amendment-coverage | edge | T003, T004, T005 | .claude/harness/tests/**, .claude/tests/** |
| compatibility › record-activechange | happy | T001, T004, T005 | .claude/harness/tests/**, .claude/tests/** |
| compatibility › 2 | edge | T001, T004, T005 | .claude/harness/tests/**, .claude/tests/** |
| compatibility › legacy-binding | happy | T001, T004, T005 | .claude/harness/tests/**, .claude/tests/** |
| compatibility › stale-sandbox | failure | T001, T004, T005 | .claude/harness/tests/**, .claude/tests/** |

## Definition of done

- Fresh evidence for every claim (35).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, configured model).
- Land archives it; Land never commits.
- Success: ทุก scenario ของ retained-intent, nonblocking routing, revision-bound handoff และ compiled coverage ผ่าน deterministic tests พร้อม full suite และ version compatibility.

## Impact

- **Impact:** medium
- **Coupling:** coupled
- **Affected surfaces:** code
- **Security triggers:** none detected

## Non-goals

- ไม่เก็บ transcript อัตโนมัติทุก host และไม่อ้างว่าเข้าถึงประวัติที่หาย
- ไม่เพิ่มการอนุมัติทุก requirement หรือแทน spec approval เดิม
- ไม่เปลี่ยนชื่อคำสั่ง arguments หรือใช้ prototype เป็น proof
- ไม่สร้าง interview/context/coverage ledger คู่ขนาน
- ไม่ commit push publish PR หรือใช้ paid scenarios
