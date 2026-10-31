# Change: topology planning ไม่ถูก watchdog ฆ่าที่ 600 วินาทีบน macOS CI

- **Change:** `topology-planning-watchdog-600-macos-ci` · **Lane:** rapid (low risk)
- **Review:** not required · **Owner:** unassigned · **Created:** 2026-10-31

## เหตุผล

`harness contracts (topology planning)` รันเดี่ยวในเครื่อง 103 วินาที (163 assertion) แต่บน macOS runner ของ gate release ทำได้ 110 assertion ก่อนถูก watchdog ฆ่าที่ 600 วินาที ทั้งสองรอบ release ที่ผ่านมา (ประมาณว่าต้องใช้ราว 900 วินาที) release จึงถูกบล็อก change นี้ให้ suite นี้ได้ 1200 วินาที suite อื่นไม่เปลี่ยน

## ขอบเขต

- **In scope (`test-runner`):** topology planning ไม่ถูกฆ่ากลางทางบน macOS runner ที่โหลดสูง
- **Out of scope:** edits outside `.claude/tests/run-all.sh`, `.claude/harness/tests/run-all-timeout.test.mjs`, `.claude/tests/README.md`

## Work type

bugfix

## Bugfix analysis

- **Reproduction:** gate ของ release บน macOS runner: harness contracts (topology planning) ทำได้ 110 จาก 163 assertion ก่อนถูกฆ่าที่ 600 วินาที ทั้งรอบ release 41075351226 และ 41179945834
- **Root cause:** runner macOS ช้ากว่าเครื่องพัฒนาราว 6 เท่าเมื่อรัน 24 suite ขนาน ขีด 600 วินาทีจึงสั้นเกินสำหรับ suite นี้ที่ต้องใช้ราว 900 วินาที
- **Regression proof:** เทสต์ใน run-all-timeout.test.mjs ตรวจว่า topology planning ได้ 1200 วินาที suite ยาวอื่นยัง 600 และ suite ปกติยัง 300

## ผลกระทบและความเสี่ยง

- **Impact:** low
- **Coupling:** isolated

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| topology-planning-timeout | topology planning ได้ 1200 วินาที | success | T001 | test: `.claude/tests/run-all.sh`, `.claude/harness/tests/run-all-timeout.test.mjs` | — |
|  | suite ยาวอื่นยังได้ 600 วินาที | boundary | T001 |  |  |
|  | ตัวแปรสภาพแวดล้อมยังครอบทุก suite | boundary | T001 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (3).
- Changed tests fail on the original code.
- Review: not required (rapid lane, low tier: deterministic evidence only).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.
