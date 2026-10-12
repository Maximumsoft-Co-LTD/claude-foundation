# ผลทดสอบ Order/inventory กับโมเดล — 2026-10-12

[English](scenario-order-inventory-2026-10-12.md)

ผู้ใช้อนุมัติ Change Loop หนึ่ง workload รวมการทำต่อ ภายในงบรวม US$25
ตัวผลิตภัณฑ์ผ่าน hidden oracle ครบ 19 กลุ่ม แต่ **benchmark ยังไม่เป็น green**:
runtime ถึง `archived` แล้ว ขณะที่งานทั้งสามใน `tasks.md` ที่ archive ยังเป็น `[ ]`
ไม่ได้แก้ receipt, proof, runtime JSON หรือ task ledger ย้อนหลังเพื่อให้ผลผ่าน

## ผลที่วัดได้

| การตรวจ | ผล |
|---|---|
| Oracle ก่อน Land จาก repository sandboxes ที่ประกอบเป็นสำเนา | PASS 19/19 |
| Oracle หลัง Land จากโค้ดที่ส่งมอบ | PASS 19/19 |
| `npm test` ปกติ | PASS 21/21 |
| ติดตั้งใหม่แบบ offline | PASS |
| `npm test` หลังติดตั้งใหม่ | PASS 21/21 |
| คุณภาพ JavaScript | วัดได้ 47 functions; pass 46, warning 1, fail 0 |
| Coverage | ค่าเฉลี่ยต่อ function 95.93%, ต่ำสุด 33.33%; ใช้ branch และ function fallback |
| CRAP | สูงสุด 22.02; warning ที่ `execute` ใน `backend/server.mjs` |
| Git ของ target | HEAD และ byte ของ index ไม่เปลี่ยนทั้ง backend, SDK และ web |
| สถานะ runtime | `archived`; `advance` รายงานว่าส่งมอบแล้ว |
| Task ledger ที่ archive | FAIL: T001, T002 และ T003 ยังไม่ถูกติ๊ก |
| ผลตามเกณฑ์เข้มงวด | `incomplete`, `required-work-or-proof-incomplete`, pendingTasks=3 |

Oracle ยิงคำขอจองสต็อก 50 ครั้งผ่าน HTTP สอง process ที่ใช้ SQLite ไฟล์เดียวกัน
ตรวจ key ซ้ำพร้อมกัน, tenant/role, persistence หลัง restart, expiry, cancel,
event ซ้ำและผิดลำดับ, SDK และ web state รวมถึงพิสูจน์ว่า test ของแต่ละส่วนจับ
implementation เดิมที่ยังไม่ครบได้ ยังไม่ได้วัด coverage ของ Python transport
หรือการตรวจ UI ที่ render ใน browser

## Source และค่าใช้จ่าย

Runtime ที่ติดตั้งคือ v3.6.3 จาก HEAD
`2fd46b4e3b29a2ac602e5d318a0571bae02ef244` โดย working tree มีการแก้ lab
ที่เป็น repository-only ระหว่างการทดลอง เก็บ snapshot ก่อนเริ่ม ก่อนทำต่อ
และของ observer ท้ายรัน พร้อม source patches ไว้ครบ ผลนี้จึงไม่ใช่ release
checkpoint จาก immutable source และไม่ได้เปรียบเทียบกับ baseline

Digest ของ product seed:
`sha256:16d697f6b2fda062bdfc8a07bb6a8084cbb36d9f7276b3fee22c2f0d63a8f1a9`.
Control root ใช้ copy isolation ส่วน child ทั้งสามมี Git seed และ worktree
ของตัวเอง Requirement อยู่ใน `ORDER-INVENTORY.md` ของ seed

| การใช้โมเดลที่วัดได้ | US$ ที่ CLI รายงาน |
|---|---:|
| Host แรกที่ติดเรื่อง repository setup | 0.3202295 |
| Host ที่ implement งาน | 0.9259364 |
| Oracle continuation ที่ไม่ได้แก้ product code | 0.1575998 |
| Configured reviewer (`opus` alias) | 0.6801810 |
| รวม | **2.0839467** |

Host ทั้งสามระบุโมเดล `claude-sonnet-5-5`; telemetry ของ reviewer ระบุ alias
`opus` ที่ร้องขอ Main envelopes รายงาน cost แบบ list price ไม่ใช่หลักฐาน
ว่ามี subscription invoice เพิ่ม ค่า reviewer แยกจาก host envelopes และนับ
รวมในตารางแล้ว การตรวจต่ออีกสองช่วงไม่ได้เรียกโมเดลและรายงาน measured zero
ยอดที่ใช้คำนวณรวมทุกตัวเป็นค่าที่วัดได้

Stopwatch ของ paid hosts รวม 490323.687 ms หรือ 8.172 นาที ซึ่งรวมเวลา
configured review ขณะที่ host ยังทำงาน ไม่รวมการเตรียมและแก้ observer
โดย operator หรือการตรวจส่งมอบภายหลัง เป็น n=1 และไม่มี no-harness baseline
จึงยังสรุปความเร็วที่คงที่หรือระดับ assurance ไม่ได้

## ปัญหา lab ที่แก้ระหว่างรัน

1. `external` ใน catalog ไม่ได้ยกเว้นข้อกำหนด Git ของ runtime จึงเพิ่มการเตรียม
   Git seed ให้ child ทั้งสามก่อน Build โดยเก็บ permission denials และผล
   ของ attempt ที่ไม่สำเร็จไว้
2. Observer ก่อน Land อ่าน seed เก่าใน shared sandbox แทน code ใน repository
   sandboxes จึงเปลี่ยนเป็นประกอบสำเนาสำหรับประเมิน โดยไม่เขียนทับ source
   ที่ proven หรือ target เก็บผลเดิม 1/19 ไว้ และ implementation จริงผ่าน
   19/19 โดยไม่ต้องแก้ product code การตรวจหลัง Land อ่าน delivered targets
3. รวมค่าใช้จ่ายของ host ทุก session ให้ session ซ่อมใช้เฉพาะงบ host ที่เหลือ
   และหยุดก่อนเปิด host เพิ่มถ้าค่าเดิม unknown หรือ partial ส่วนค่า native
   reviewer ตรวจแยกและนับรวมกับงบทั้งหมดของรอบนี้
4. เก็บ quality และ clean-install evidence ต่อเมื่อ archived แม้ ledger
   ไม่สอดคล้อง โดยยังคงผล benchmark เป็น incomplete

## ปัญหา runtime ที่พบ

Change id คือ
`extend-the-catalogue-into-a-multi-tenant-order-and-reservation-s`.
Selection มี backend, SDK และ web โดยไม่ได้เลือก root
Build ทำครบและติ๊กทั้งสามงานใน active execution packet แล้ว Land ส่งโค้ด
ที่ proven และ archive packet ไปที่
`openspec/changes/archive/2026-10-12-extend-the-catalogue-into-a-multi-tenant-order-and-reservation-s/tasks.md`
แต่ canonical file นี้ยังมีงานไม่ติ๊กสามรายการ Benchmark จึงปฏิเสธ completion
แม้ proof และ product oracle จะผ่าน

จุดที่ต้องแก้คือการ sync task packet ใน Land/archive แบบ multi-repository
ที่เลือกเฉพาะ child รายงานนี้ยังไม่ได้ยืนยัน internal cause ที่แน่นอน
ต้องเพิ่ม native deterministic regression แก้การ sync แล้ว replay consumer
ใหม่ก่อนประกาศ smoke-green ห้ามเขียนทับ ledger ที่เก็บไว้หรือใช้ runtime status
เพียงอย่างเดียวเพื่อกลบ finding รอบนี้ยังไม่ได้ patch source runtime

## หลักฐานที่เก็บไว้

Evidence root:
`~/.local/share/changeloop/scenarios/order-inventory-20261012-approved25-1791806599121/`.
มี authorization, scorecards/manifests ของทั้งสี่ช่วง, host streams/session
envelopes ต้นฉบับ, source snapshots, reviewer telemetry, proof, archive,
quality, clean-install checks, Git baselines/comparisons และ consumer ที่เก็บไว้
`run-audit.json` เป็น derived audit แยกจาก machine proof

Raw archive:
`~/.local/share/changeloop/scenarios/order-inventory-20261012-approved25-1791806599121.tar.gz`.
SHA-256:
`8762e29b86c569986b85db8355fd7663ca03c4f4fcb7d6d379068f9ac0216383`.

เกณฑ์ lifecycle และจำนวน repeat อ้างอิง
[scenario plan ฉบับหลัก](user-scenario-test-plan.md)
