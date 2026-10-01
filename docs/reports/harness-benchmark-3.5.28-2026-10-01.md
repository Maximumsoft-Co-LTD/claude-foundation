# ผล benchmark ก่อน release 3.5.28 (2026-10-01)

สถานะ: **บันทึกผลวัด** ของ commit `53eb91d7d` (เนื้อหาเดียวกับ release 3.5.28)
เอกสารนี้เป็นหลักฐานตามวันที่ ไม่ใช่สถานะปัจจุบัน

## วิธีวัด

- รัน headless `claude -p "/dev <โจทย์>. I approve the spec. Land it when proven."`
  ด้วย `--permission-mode acceptEdits --allowedTools "Bash(claude-foundation *)" ...`
  และจำกัดงบ $6 ต่อรอบ ($10 สำหรับงานใหญ่)
- consumer แยกกันทุกงาน ติดตั้ง harness จาก snapshot ของ working tree ที่กลายเป็น
  `53eb91d7d`
- ฝั่งไม่ใช้ harness ใช้โจทย์เดียวกัน โดยสั่งว่า "implement, add tests, verify"
- ตัดสินผลด้วย oracle ที่ซ่อนไว้ใน `.claude/tests/bench/tasks/<task>/oracle`
- รันพร้อมกันครั้งละ 3 งาน เวลาในตารางเป็น wall-clock รวมเวลาที่ต้องรอเพราะเครื่องมีงานอื่น
- **แต่ละงานรันเพียงรอบเดียว** ต่างกันไม่ถึง 20% จึงยังสรุปไม่ได้

## งานเดิม 6 งาน

เวลา (นาที:วินาที) · ค่าใช้จ่าย · คะแนน oracle

| งาน | 3.5.27 | `f4f0dc6a4` | `53eb91d7d` | ไม่ใช้ harness |
|---|---|---|---|---|
| bare-node-boundary | 14:47 · $3.45 | 1:47 · $0.62 | 2:10 · $0.77 · 5/6 | 0:45 · $0.39 |
| typescript-react-state | 15:20 · $3.33 | 1:20 · $0.61 | 2:05 · $0.57 · 6/6 | 0:41 · $0.38 |
| python-api-validation | 18:17 · $3.63 ค้าง | 1:46 · $0.70 ค้างที่ Land | 3:55 · $1.25 · 5/5 | 0:40 · $0.37 |
| database-migration-rollback | 7:22 · $2.71 | 3:36 · $0.95 ค้างที่ review | 1:56 · $0.60 · 6/6 | 0:34 · $0.32 |
| refactor-no-reproduction | 6:58 · $2.28 ค้าง | 1:56 · $0.80 | 1:46 · $0.85 · 6/6 | 0:36 · $0.32 |
| multi-service-event-flow | 9:31 · $3.18 ค้าง | 1:43 · $0.65 | 1:57 · $0.71 · 6/6 | 1:06 · $0.46 |
| **รวม** | **72 นาที · $18.58 · จบ 3/6** | **12 นาที · $4.33 · จบ 4/6** | **13.8 นาที · $4.75 · archived 6/6, ถูกครบ 5/6** | **4.4 นาที · $2.23 · ถูกครบ 6/6** |

จำนวน tool call ของ `53eb91d7d`: 20, 24, 49, 23, 26, 30 ตามลำดับ

## งานที่ใหญ่ขึ้น

| งาน | ใช้ harness (`53eb91d7d`) | ไม่ใช้ harness | oracle | ช้ากว่า |
|---|---|---|---|---|
| 21-notes-api | 2:38 · $0.81 · 22 calls | 1:49 · $0.63 · 10 calls | 13/13 ทั้งคู่ | 1.4 เท่า |
| 22-cart-coupons | 2:44 · $0.93 · 31 calls | 1:27 · $0.58 · 15 calls | 11/11 ทั้งคู่ | 1.9 เท่า |
| 23-project-tracker-api | 6:46 · $1.83 · 34 calls | 4:12 · $1.18 · 10 turns | 33/33 ทั้งคู่ | 1.6 เท่า |

ทุกงานที่ใช้ harness จบที่ `archived` และ Land เป็น diff ที่ยังไม่ commit ใน main checkout

## สิ่งที่พบ

1. **ไม่มีงานค้างอีกแล้ว** 2 งานที่ค้างใน `f4f0dc6a4` จบได้ในรอบนี้ ได้แก่
   review closure loop และ Land ชนกับไฟล์ `.pyc`
2. **ยิ่งงานใหญ่ ส่วนต่างยิ่งลดลง** งานเล็กช้ากว่าไม่ใช้ harness ประมาณ 3 เท่า
   ส่วนงานใหญ่ (33 กรณี) ช้ากว่าประมาณ 1.6 เท่า เพราะต้นทุนของ spec และ review
   เกือบคงที่
3. **bare-node พลาด AC4 เพราะ spec ขาดกรณี ไม่ใช่เพราะ review หลุด**
   - `lastN(items, 0.4)` ยังคืนทุกแถว
   - review ได้ checklist ครบ 7 scenario และตอบ `covered-by-test` ทุกข้อ
   - แต่ spec ไม่มีกรณีค่าทศนิยม checklist ตรวจได้เฉพาะสิ่งที่อยู่ใน spec
4. **python-api-validation ช้าที่สุดใน harness arm** (49 calls, 7 errors) สาเหตุ:
   - `npx claude-foundation change start --template` ถูก phase guard บล็อก
   - verify command ใน draft ผิด การแก้ต้องผ่าน `change amend` ที่บังคับให้มี
     requirement, evidence และ task ใหม่ ใช้ไปประมาณ 6 calls
   - ทั้งสองเรื่องจะแก้ใน release ถัดไป
5. hook `rtk` ในเครื่องที่วัดทำให้ `grep` บางคำสั่งต้องขออนุญาตในโหมด headless
   เรื่องนี้เป็นสภาพแวดล้อมของเครื่อง ไม่ใช่ harness

## การตรวจสอบ deterministic

- `bash .claude/tests/run-all.sh`: ALL SUITES PASS (210 suites)
- `bash .claude/tests/docs/run-doc-consistency.sh`: 138/138
- `git diff --check`: สะอาด

## ข้อจำกัด

- n = 1 ต่องาน
- ผล "ไม่ใช้ harness" ของ 6 งานเดิมมาจากรอบก่อนหน้า (2026-09-30) ไม่ได้รันใหม่
- ค่าใช้จ่ายมาจาก `total_cost_usd` ของ session หลัก ถ้า harness เรียก AI reviewer
  เป็น process แยก ค่าใช้จ่ายส่วนนั้นอาจไม่ได้นับรวมในตัวเลขนี้
