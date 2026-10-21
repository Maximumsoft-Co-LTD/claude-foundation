# Smoke ของ candidate: `2af6788` เทียบ v3.6.6 และไม่มี harness — 2026-10-21

**สถานะ:** หลักฐาน smoke ที่สังเกตได้ n=1 ห้า scenario ไม่ใช่ checkpoint แบบจ่ายเงินครบชุด
และไม่ใช่การรับรองแบบรันซ้ำ [English](scenario-smoke-candidate-2af6788-2026-10-21.md)

## ขอบเขตและเงื่อนไข

| รายการ | ค่า |
|---|---|
| Candidate | `2af6788` (สะอาด) แปดการแก้เพื่อเครื่องมือที่ไม่ใช่ Claude: reviewer fallback, Codex ผ่าน API key, คำสั่งถัดไป, `current`, installer ไม่ส่งเทสต์ของ harness, ตัวอย่างใน error, ตัวตนของ host |
| Previous | `f63e34e86` (v3.6.6) สะอาด ใช้ worktree แยกพร้อม installer ของตัวเอง |
| ไม่มี harness | `--arm baseline` จาก tree ของ candidate: seed, oracle, โมเดลและเพดานเหมือนกัน ไม่มี Change Loop |
| โมเดล | `claude-sonnet-5-5` ผ่าน `ANTHROPIC_MODEL` เหมือนกันทุก arm |
| Scenario | `owner-only-delete`, `idempotent-refund`, `speed-up-search`, `regression-fix-with-fixes`, `tiny-feature` |
| จำนวนรอบ | หนึ่งรอบต่อช่อง สลับลำดับ arm ในแต่ละ scenario |
| สิทธิ์ใช้จ่าย | ผู้ใช้กำหนดเพดาน US$100 หนึ่งรอบต่อช่อง |
| Host | Claude Code เท่านั้น ไม่ได้ทดสอบ OpenCode, Cursor, Gemini |

## ผล

Oracle: ทั้ง 15 ช่องผ่าน hidden oracle (แต่ละ arm ผ่าน 5/5)

| Arm | ค่าใช้จ่าย | เวลา | model requests | tool calls |
|---|---|---|---|---|
| Candidate | US$2.1226 | 542.4 s | 60 | 102 |
| v3.6.6 | US$2.1940 | 603.7 s | 60 | 98 |
| ไม่มี harness | US$1.0936 | 273.5 s | 35 | 56 |

- Candidate เทียบ v3.6.6: ถูกกว่า 3.3% เร็วกว่า 10.2% requests เท่ากัน ที่ n=1 อยู่ในช่วง
  ความแปรปรวนปกติ แสดงว่าไม่ถดถอย ไม่ได้แสดงว่าดีขึ้น
- Candidate เทียบไม่มี harness: ค่าใช้จ่าย 1.94 เท่า เวลา 1.98 เท่า เป็น overhead ของ review และ Land
  กับงานเล็ก สอดคล้องกับอัตราส่วน rapid-tier ก่อนหน้า
- ใช้จ่ายจริงประมาณ US$5.41 จากเพดาน US$100 การรัน v3.6.6 ครั้งแรกล้มก่อนเรียกโมเดล
  (worktree ไม่มี `node_modules`) ไม่เสียเงิน และรันใหม่หลัง `npm ci`

## ข้อจำกัด

- ห้าจาก 28 scenario แบบจ่ายเงิน ไม่ได้รันแถวความเสี่ยงสูงและหลาย repository
- การแก้มุ่งไปที่เครื่องมือที่ไม่ใช่ Claude (issue: เสียรอบประมาณ 70% บน OpenCode) smoke บน
  Claude Code นี้วัดประโยชน์นั้นไม่ได้
- ข้อมูลดิบเก็บนอก Git sha256
  `e770de234ab9228d75d61c63299823fb15c47d07f0122619c40b99b3325bcf35`
  (`ab-c-phase1-2af6788-vs-f63e34e86-vs-noharness.tgz`)

## การตัดสินใจออกเวอร์ชัน

ผู้ดูแลสั่งออก v3.6.7 หลัง smoke นี้ เป็นข้อยกเว้นที่ระบุชัดจาก checkpoint ครบทุก scenario ใน
[RELEASING.md](../../RELEASING.md) ไม่ได้เปลี่ยนค่าเริ่มต้นของ checkpoint
