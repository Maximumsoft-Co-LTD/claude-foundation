# Change: installer smoke ไม่ถูก watchdog ฆ่าที่ 300 วินาทีบน CI

- **Change:** `installer-smoke-watchdog-300-ci` · **Lane:** rapid (low risk)
- **Review:** not required · **Owner:** unassigned · **Created:** 2026-10-30

## เหตุผล

`installer smoke` ใช้เวลาเดี่ยว 108 วินาที แต่บน CI ที่รัน 24 suite ขนานเกิน 300 วินาทีบางรอบ watchdog ของ `run-all.sh` จึงฆ่ามันและ gate ของ release ล้ม โดย assertion ท้ายสุดที่ล้มทำให้เข้าใจผิดว่าเป็นบั๊กของ allowlist opt-out change นี้ขยาย timeout ของ suite นี้เป็น 600 วินาที และให้รายงานว่าล้มเพราะ timeout (investigation: `openspec/investigations/ci-installer-smoke-timeout.json`)

## ขอบเขต

- **In scope (`test-runner`):** installer smoke ไม่ถูกฆ่าบน CI ที่โหลดสูงเพราะขีด 300 วินาที; ผู้อ่าน log เห็นว่า suite ล้มเพราะ timeout ไม่ใช่เพราะ assertion
- **Out of scope:** edits outside `.claude/tests/run-all.sh`, `.claude/tests/harness/run-run-all-control-tests.sh`, `.claude/tests/README.md`

## Work type

bugfix

## Bugfix analysis

- **Reproduction:** รัน run-all.sh บน CI ที่โหลดสูง: installer smoke ใช้เกิน 300 วินาที watchdog ฆ่า install.sh กลางทาง assertion ท้ายสุด 2-3 ข้อ (allowlist opt-out) ล้ม และ gate ของ release ล้ม (workflow-tests รัน 41075327217 และ release รัน 41075351226)
- **Root cause:** ค่า watchdog เริ่มต้น 300 วินาทีสั้นเกินสำหรับ installer smoke บน CI และ kill_tree ฆ่าลูกก่อนแม่ จึงตายเงียบพร้อมผล assertion ที่ทำให้เข้าใจผิดว่าเป็นบั๊กของโค้ด opt-out
- **Regression proof:** เทสต์ใน run-run-all-control-tests.sh ตรวจว่า installer smoke ได้ timeout 600 วินาที suite อื่นยัง 300 และ suite ที่ถูกฆ่าถูกนับว่าล้มพร้อมข้อความ timed out

## Failure matrix

| Failure | User sees | Recovery | Covers |
|---|---|---|---|
| suite ที่ถูกฆ่ารายงาน timed out | ได้ข้อความ timed out after 300s | เพิ่มขีดของ suite ใน suite_timeout_seconds หรือทำให้ suite เร็วขึ้น | timeout-reported-as-cause |
| suite ที่ถูกฆ่านับว่าล้มแม้สถานะเป็น 0 | นับว่าล้ม | แก้สาเหตุที่ช้าแล้วรันใหม่ | timeout-reported-as-cause |

## ผลกระทบและความเสี่ยง

- **Impact:** low
- **Coupling:** isolated

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| installer-smoke-timeout | installer smoke ได้ 600 วินาที | success | T001 | test: `.claude/tests/run-all.sh`, `.claude/tests/harness/run-run-all-control-tests.sh` | — |
|  | suite อื่นยังได้ 300 วินาที | boundary | T001 |  |  |
|  | ตัวแปรสภาพแวดล้อมครอบทุก suite | boundary | T001 |  |  |
| timeout-reported-as-cause | suite ปกติไม่มีหมายเหตุ | boundary | T001 | test: `.claude/tests/run-all.sh`, `.claude/tests/harness/run-run-all-control-tests.sh` | — |
|  | suite ที่ถูกฆ่ารายงาน timed out | failure | T001 |  |  |
|  | suite ที่ถูกฆ่านับว่าล้มแม้สถานะเป็น 0 | failure | T001 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (6).
- Changed tests fail on the original code.
- Review: not required (rapid lane, low tier: deterministic evidence only).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## Appendix: Amendment history

- Revision 1 (2026-10-30): The test provider reads structured node:test output; the shell control test alone leaves the claims inconclusive at Prove, so the same checks need a node:test file
- Revision 2 (2026-10-30): Correct the verify command of task 'T001'
