# Change: หลัง Land เปลี่ยน dependency ของโปรเจกต์ ระบบติดตั้ง dependency ในโฟลเดอร์ของผู้ใช้ด้วยคำสั่งเดียวกับ sandbox

- **Change:** `land-dependency-dependency-sandbox` · **Lane:** standard (carries design content)
- **Review:** low tier · **Owner:** unassigned · **Created:** 2026-10-17

## เหตุผล

เมื่อ change เพิ่มหรือเปลี่ยน dependency ระบบติดตั้งให้ใน sandbox แต่หลัง Land โฟลเดอร์ของผู้ใช้ไม่มี dependency ใหม่ คำสั่งของโปรเจกต์จึงล้มทันที (dependency-upgrade: Cannot find module 'slugkit') ในขณะที่ agent แบบไม่มี harness ติดตั้งเองและผ่าน ผู้ใช้เลือกให้ Land ติดตั้งให้

## ขอบเขต

- **In scope (`sandbox-apply`):** หลัง Land ที่เพิ่ม dependency คำสั่งของโปรเจกต์ในโฟลเดอร์ของผู้ใช้หา dependency ใหม่เจอ
- **Out of scope:** edits outside `.claude/harness/runtime/workflow/apply-runtime.mjs`, `.claude/harness/runtime/workflow/sandbox-runtime.mjs`, `.claude/harness/tests/post-land-install.test.mjs`, `.claude/tests/run-all.sh`, `.claude/tests/README.md`, `WORKFLOW.md`; the authored Non-goals below

## Non-goals

- ไม่ติดตั้ง dependency ใน repository ลูกของ change แบบหลาย repository
- ไม่ย้อน Land กลับเมื่อการติดตั้งล้ม

## ผลกระทบและความเสี่ยง

- **Impact:** low
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| post-land-install | ติดตั้งล้ม | failure | T001 | test: `.claude/harness/tests/post-land-install.test.mjs`, `.claude/tests/run-all.sh` | — |
|  | lockfile เปลี่ยน | unclassified | T001 |  |  |
|  | dependency ไม่เปลี่ยน | unclassified | T001 |  |  |
|  | ปิดการติดตั้ง | unclassified | T001 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (4).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (low tier, fast model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Failure matrix:** read from scenarios that state a rejection or error (1); recovery is "No separate step; the outcome is the handling" where unstated.
- **Evidence capabilities:** defaulted to `test` (`static-analysis` for docs/chore) for post-land-install.

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | ไม่มีข้อค้นพบ | — | — | claude-opus |
