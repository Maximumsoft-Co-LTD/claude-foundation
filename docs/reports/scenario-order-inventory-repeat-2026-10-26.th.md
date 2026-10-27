# Order-inventory รันซ้ำ: `52c3e50c9` — 2026-10-26

**สถานะ:** หลักฐานจากการสังเกต 1 lane (`order-inventory`) รันจริง 4 ครั้ง
เป็น `repeated-green` เฉพาะ lane นี้ ไม่ใช่ checkpoint แบบเต็ม
[English](scenario-order-inventory-repeat-2026-10-26.md)

## ขอบเขตและเงื่อนไข

| รายการ | ค่า |
|---|---|
| Source | `52c3e50c9` รอบ 1 สะอาด รอบ 2–4 มี patch เฉพาะ bench ที่ยังไม่ commit 1 ตัว (`quality.mjs` ดูด้านล่าง) และใช้ patch digest เดียวกัน |
| Lane | `order-inventory`: brownfield `backend`/`sdk`/`web`, SQLite, tenant isolation, concurrency ข้าม process, oracle 19 เคส |
| เพดาน | ต่อรัน: 90 นาที, US$25, 400 model requests, 600 tool calls |
| สิทธิ์ใช้งบ | ผู้ใช้กำหนดเพดาน US$1000, 1 lane, consumer ใช้แล้วทิ้ง, ไม่ commit ไม่ push |
| Host | Claude Code เท่านั้น ไม่มีชื่อโมเดลที่ขอและที่ใช้จริง |

## ผลลัพธ์

| รอบ | Digest | Archived | Oracle | ต้นทุน | เวลา | Section ที่ขาด |
|---|---|---|---|---|---|---|
| 1 | สะอาด | ใช่ | 19/19 | US$1.4026 | 10.8 นาที | 4 (จากตัววัด) |
| 2 | มี patch | ใช่ | 19/19 | US$1.2550 | 10.0 นาที | 0 |
| 3 | มี patch | ใช่ | 19/19 | US$0.9967 | 6.6 นาที | 0 |
| 4 | มี patch | ใช่ | 19/19 | US$1.0220 | 6.8 นาที | 0 |

ทุกรอบ: task ค้าง 0, repair 0, `ASK_USER` 0, test ที่ส่งมอบ 30/30, clean offline
install ผ่าน, quality ของ product 64/64 ไม่มี fail ต้นทุนรวมราว US$4.68
release report จัด lane นี้เป็น `repeated-green` จากรอบ 2–4 (strict pass 3 ครั้ง
commit และ patch digest เดียวกัน): ต้นทุนมัธยฐาน US$1.022, เวลามัธยฐาน 407.6 วินาที,
model requests มัธยฐาน 21, resumption 0

## สิ่งที่พบ

- **Section ที่ขาดเป็นปัญหาของตัววัด** scorecard นับ Summary, Success criteria,
  Provenance และ Overview เป็น section บังคับ แต่ renderer ข้าม row ที่ว่าง และ
  draft validator ไม่เคยบังคับ ตอนนี้ `quality.mjs` ยกเว้นแล้วและมี regression test
  รอบ 1 ยังเก็บค่าเดิมคือ 4
- **Task ledger ครบ** `tasks.md` ที่ archive ของรอบ 1 มี T001–T003 เสร็จ พร้อม claims
  ปัญหา ledger ไม่ครบจาก audit 2026-10-12 ไม่เกิดซ้ำ
- **Review finding ที่ยัง open ตอน Land (รอบ 1)** minor 3 ข้อค้างใน packet ที่ archive:
  test concurrency ที่ส่งมอบรัน 2 server ใน process เดียว (`spawnSync`) request จึงไม่ทับซ้อนกัน
  (oracle ที่ใช้ 2 process จริงพิสูจน์ได้); SDK ส่ง `"null"` เป็น idempotency key เมื่อส่ง `null`;
  `setStock` แยก settle กับ upsert เป็นสอง transaction ยังไม่ได้ตรวจ review finding ของรอบ 2–4

## ข้อจำกัด

- 1 จาก 28 lane ที่ใช้โมเดลจริง report ทั้ง portfolio ยัง `blocked` (lane อื่นไม่มี paid smoke;
  time-gate advisory ไม่ผ่านที่ rapid 2.09× และ standard 1.88×)
- ชื่อโมเดล เวลา model active และ tooling quality ไม่มีข้อมูล ไม่ใช่ศูนย์ model requests ที่
  สังเกตได้ (21–24) ต่างจากที่ host รายงาน (42–53) ยังไม่ได้เทียบให้ตรงกัน
- Level 3–4 (amendment, stacked Land, interruption) ยังไม่ได้ทดสอบ
- หลักฐานดิบอยู่ใน `.claude/tests/bench/results/openspec-native-lab/`
  (`order-inventory-1792998061631`, `-1792999976780`, `-1793000657434`,
  `-1793001235384`) ยังไม่ได้ทำ archive พร้อม checksum นอก Git
