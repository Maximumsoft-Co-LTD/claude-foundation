# Paid E2E: v3.6.8 เทียบ v3.6.9 เทียบ no-harness review — 2026-11-02

**สถานะ:** หลักฐานที่สังเกตได้จากการรันจริงแบบเสียเงิน n=1 ต่อช่อง ครบทั้ง 29 paid lane
โดย 28 lane รันครบทั้ง 3 arm ส่วน `order-inventory-lifecycle` รันเฉพาะ v3.6.9
รายงานแยกต่อ lane ไม่ใช่ assurance แบบรันซ้ำ และไม่มีการตัดสินเรื่อง release
v3.6.9 ถูกเผยแพร่ไปก่อนหน้านี้ภายใต้ข้อยกเว้นที่บันทึกไว้ (ดู
[release status](user-scenario-release-status.md)) การรันนี้ไม่ได้มาก่อน release นั้น
[English](scenario-paid-e2e-v3.6.8-v3.6.9-baseline-review-2026-11-02.md)

## ขอบเขตและเงื่อนไข

| รายการ | ค่า |
|---|---|
| Arm | Change Loop ที่ tag `v3.6.8` (`0848e86f4`), Change Loop ที่ tag `v3.6.9` (`62ce54106`) และ `--arm baseline-review` (ไม่มี harness: ทำงานตรงๆ แล้วรีวิวตัวเองอิสระหนึ่งรอบ) รันจาก tree ของ `v3.6.9` |
| Lane | paid lane ทั้ง 29 ของ `openspec-native-matrix.json` ที่ `v3.6.9` โดย `order-inventory-lifecycle` ไม่มีใน `v3.6.8` และ baseline arm ปฏิเสธ lifecycle lane จึงมี arm เดียว |
| จำนวนรอบ | หนึ่งรอบต่อ lane ต่อ arm ทั้ง 3 arm ของ lane เดียวกันรันพร้อมกัน แต่ละ lane รันต่อกัน |
| Model | host default `claude-sonnet-5-5` ฝั่ง implementation เพดานจาก matrix เดียวกันทุก arm |
| อำนาจอนุมัติ | ผู้ใช้อนุมัติรันครบ 29 lane x 3 arm และขยายเพดานเกิน US$100 รอบนี้ตั้ง hard stop ที่ US$150 ค่าใช้จ่ายที่วัดได้ US$42.60 ทั้งหมดมาจาก result envelope ของ host |
| ที่มาของโค้ด | Git worktree ชั่วคราวที่สอง tag โดยลิงก์ `node_modules` ของ repository เข้ามา lab ติดตั้งแต่ละ tree ลงใน consumer ชั่วคราว |
| Host | Claude Code เท่านั้น บนเครื่อง macOS เครื่องเดียวที่ RTK hook ส่วนกลางทำงานอยู่ใน host ที่ถูกสร้าง (ดูข้อจำกัด) |
| หลักฐานดิบ | อยู่นอก Git: `.claude/tests/bench/results/paid-e2e-v3.6.8-v3.6.9-baseline-review-2026-11-02/` (scorecard ต่อ run, `state.json`, สคริปต์ driver และ scan) |

## ผล: 28 lane ที่รันครบทั้ง 3 arm

| arm | oracle ผ่าน | ต้นทุนรวม | ต้นทุนกลาง | เวลากลาง | request กลาง |
|---|---|---|---|---|---|
| v3.6.8 | 27/28 | US$15.07 | US$0.45 | 99 s | 11 |
| v3.6.9 | 26/28 | US$14.88 | US$0.45 | 96 s | 11 |
| baseline-review | 27/28 | US$9.64 | US$0.29 | 79 s | 10 |

ตารางรายละเอียดต่อ lane (✓ oracle ผ่าน, ✗ ไม่ผ่าน; ต้นทุน, เวลา) อยู่ในฉบับ
[English](scenario-paid-e2e-v3.6.8-v3.6.9-baseline-review-2026-11-02.md#results-28-lanes-in-all-three-arms)
ตัวเลขเหมือนกันทุกช่อง

`order-inventory-lifecycle`: v3.6.9 ✓ US$3.01, 1590 s ไม่มี arm อื่นที่รัน lane นี้ได้

## ที่ไม่ผ่าน

- **`project-tracker-api` ทั้ง v3.6.8 และ v3.6.9:** ไปถึง `proven` และ proof ผ่านทั้งคู่
  แล้วหยุดที่ `awaiting-user` oracle ลับได้ 32/33 ตกข้อเดียวคือ `CASE_TESTS_EXIST`
  เหมือนกันทั้งสองเวอร์ชัน จึงไม่ได้เกิดจาก v3.6.9 ยังไม่ได้สืบว่าทำไมเทสต์ที่ต้องมีจึงหาย
  ส่วน baseline arm ผ่าน
- **`infra-config` v3.6.9:** agent ร่าง change แล้ว `start --through proven` ถูกบล็อกเพราะไม่มี
  `--approve-spec` agent จึงหยุดขอ spec approval workflow ค้างที่ `change` oracle จึง
  `unavailable` (`task-oracle-unavailable`) เป็นขอบเขตอำนาจตามที่เอกสารกำหนด ไม่ใช่ความผิดพลาด
  ของ harness เกิด 1 ครั้งจาก 28 run ของ v3.6.9 ส่วนข้อสมมติฐานว่า NOTE เรื่องหน้าอนุมัติใน
  v3.6.9 ทำให้ agent ระวังมากขึ้นนั้น ยังไม่มีหลักฐาน และไม่ได้รันซ้ำ
- **`dependency-upgrade` baseline-review:** `CASE_TESTS_PASS` ไม่ผ่าน (7/8) เทสต์ของโปรเจกต์ไม่ผ่านหลังอัปเกรด
- **`client-version-gate` v3.6.9:** ผ่าน แต่ใช้ 289 s เทียบกับ 103 s ของ v3.6.8 (US$0.66 เทียบ
  US$0.48) ยังไม่ได้เปิด log ดู

## ข้อมูลนี้รองรับอะไรได้บ้าง

- v3.6.9 ไม่ต่างจาก v3.6.8 เรื่องต้นทุนหรือเวลาเกินสัญญาณรบกวนที่ n=1 (ค่ากลางเท่ากัน
  ความต่างรายลานขยับทั้งสองทาง)
- arm ที่มี harness มีต้นทุนราว 1.5 เท่า และเวลาราว 1.2 เท่าของ arm รีวิวแบบไม่มี harness ที่ค่ากลาง
  อัตราส่วนสูงสุดที่ lane เล็ก (`owner-only-delete` เวลา 2.5 เท่า) ซึ่งงานคงที่ของ harness เด่น
- ความถูกต้องใกล้กันทุก arm (27, 26, 27 จาก 28) แต่ละ arm ตกคนละ lane ยกเว้นคู่
  `project-tracker-api` ที่ตกเหมือนกัน

## Tool call ที่ error (สแกน log)

สแกน `host.stream.jsonl` ของ 38 run ที่จบแล้วตอนนั้น: arm ที่มี harness 581 call, error 30 (5%);
baseline-review 221 call, error 53 (24%) error ฝั่ง harness ราว 20 รายการคือ `find` ที่ใช้
`-prune`/`-not` เพื่อ list ไฟล์ ซึ่งถูกปฏิเสธว่า "requires approval" ที่ v3.6.8 และได้
"rtk find does not support compound predicates" ที่ v3.6.9 ส่วนฝั่ง baseline ส่วนใหญ่เป็นคำสั่ง
shell ต่อกันที่ถูกปฏิเสธโดย allowlist แคบๆ ของ lab ไม่ได้วัดเวลาที่เสียต่อ error

## ข้อจำกัด

- n=1 ต่อช่อง ไม่ได้รันซ้ำ lane ที่ไม่ผ่านเลย ความต่างเล็กๆ คือสัญญาณรบกวน
- allowlist ของ lab และ RTK hook ของเครื่องเป็นต้นเหตุของ tool error ข้างบน และอยู่ในเวลาและต้นทุนของ
  ทุก arm ไม่ใช่พฤติกรรมของ harness
- baseline arm รันจาก tree ของ `v3.6.9` จึงไม่ได้แยกเวอร์ชันของ harness (ไม่ได้ติดตั้ง harness)
- ผล lifecycle ของ v3.6.9 ไม่มี arm เทียบเคียง
- นี่ไม่ใช่ checkpoint ทุก lane ของ [RELEASING.md](../../RELEASING.md) สำหรับ candidate ใหม่ และไม่ได้
  เปลี่ยนสถานะที่บันทึกไว้ของ v3.6.9
- ต้นทุนใน scorecard มาจาก result envelope ของ host เท่านั้น ไม่ได้คำนวณจากราคา
