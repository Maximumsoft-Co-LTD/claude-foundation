# Checkpoint ของ candidate v3.6.5 — 2026-10-18

[English](scenario-checkpoint-v3.6.5-2026-10-18.md)

candidate v3.6.5 เปลี่ยน template ของ change start สองเรื่อง
([ผลการสืบ](../../openspec/investigations/v364-slowdown.report.md)):
- คำแนะนำ `input-domain` แคบลง
- บอก coverage row ที่แต่ละความเสี่ยงบังคับ

และ draft ที่ประกาศ `fixes` ต้องมี coverage ด้าน input-boundary ด้วย

| ผล | ค่า |
|---|---|
| paid scenario ส่งมอบแบบ strict | **28/28** |
| เทียบ [checkpoint v3.6.4](scenario-checkpoint-candidate-2026-10-18.th.md) ทั้ง 28 แถว | เวลา **−18%** ค่าใช้จ่าย host **−12%** |
| เทียบ v3.6.3 บน 10 scenario ที่มีร่วมกัน | ส่วนต่างลดจาก +44% เวลา / +28% ค่าใช้จ่าย เหลือ **+9% / +6%** |

แต่ละแถวรันครั้งเดียว (n=1) ผลนี้จึงเป็น smoke check ไม่ใช่ข้อสรุปเรื่องความเร็วที่เชื่อถือได้

## ขอบเขตการรัน

- **candidate `078e10ba8`** (มีแค่การแก้ template) รัน:
  - full suite ผ่าน 242/242
  - sentinel ที่ไม่มีค่าใช้จ่ายผ่าน
  - paid ทั้ง 28 scenario ทีละ lane ด้วย `ANTHROPIC_MODEL=claude-sonnet-5-5` และ `source.dirty: false`
- **regression-fix-with-fixes ล้มบน `078e10ba8`:**
  - ได้ oracle 9/10 ไม่ผ่าน `CASE_UPPER_BOUNDARY`
  - สาเหตุ: พอ `input-domain` แคบลง draft จึงไม่ประกาศความเสี่ยง และ coverage ครอบคลุมแค่ boundary ที่ 1000 ซึ่งเป็นตัวที่ถูกรายงาน
  - `90cd46364` ทำให้ `fixes` บังคับ coverage ด้าน input-boundary แล้ว full suite ผ่าน 242/242 และ sentinel ผ่าน
  - รัน scenario นี้ซ้ำ 2 ครั้งบน `90cd46364` ที่สะอาด ได้ 10/10 ทั้งสองครั้ง
- **ที่มาของแต่ละแถว:** การแก้รอบที่สองกระทบเฉพาะ draft ที่ประกาศ `fixes` ซึ่งใน matrix มีแค่ regression-fix-with-fixes ตัวเดียว อีก 27 แถวจึงใช้ผลจาก `078e10ba8`
- **คอลัมน์ v3.6.4:** ผล checkpoint ของ v3.6.4 ที่เก็บไว้ 26 แถวมาจาก `8410d517c` และ 2 แถวแบบหลาย repository มาจาก `dde4a619e` ใช้โมเดลและ fixture เดียวกัน แต่รันเป็นคนละชุด ไม่ได้รันสลับกันในช่วงเวลาเดียวกัน
- **สภาพแวดล้อม:** Claude Code 2.1.302, Node v26.11.1, macOS 26.7 arm64 งบใน matrix ไม่เปลี่ยน
- **ค่าใช้จ่ายที่วัดจาก host ของทั้ง 30 รัน:** **US$14.5801** ค่าใช้จ่ายของ security-hotfix มาจาก foundation metrics ไม่ใช่ host envelope

## ผล

แต่ละช่องคือ วินาทีของ runner / ค่าใช้จ่ายที่วัดจาก host / คะแนน oracle

ทุกแถวเป็น `completed` และ archived ไม่มี task ค้าง และผ่านทั้งคำสั่งปกติของโปรเจกต์และ clean install

| Scenario | candidate v3.6.5 | v3.6.4 |
|---|---|---|
| bare-node-boundary | 55.8 / $0.3821 / 6/6 | 81.5 / $0.4488 / 6/6 |
| typescript-react-state | 45.6 / $0.3627 / 6/6 | 42.5 / $0.3624 / 6/6 |
| python-api-validation | 65.7 / $0.3803 / 5/5 | 67.4 / $0.4090 / 5/5 |
| database-migration-rollback | 84.8 / $0.3623 / 6/6 | 113.4 / $0.4307 / 6/6 |
| refactor-no-reproduction | 41.5 / $0.3544 / 6/6 | 82.3 / $0.4469 / 6/6 |
| multi-service-event-flow | 116.9 / $0.5170 / 6/6 | 103.6 / $0.4886 / 6/6 |
| tiny-feature | 65.1 / $0.3753 / 8/8 | 89.3 / $0.4997 / 8/8 |
| notes-api | 138.3 / $0.5442 / 13/13 | 160.0 / $0.6557 / 13/13 |
| cart-coupons | 116.2 / $0.5515 / 11/11 | 192.7 / $0.5768 / 11/11 |
| project-tracker-api | 400.3 / $1.0108 / 33/33 | 557.3 / $1.5270 / 33/33 |
| order-inventory | 508.2 / $1.2004 / 19/19 | 570.4 / $1.4103 / 19/19 |
| owner-only-delete | 85.0 / $0.3763 / 9/9 | 105.6 / $0.4508 / 9/9 |
| idempotent-refund | 182.3 / $0.5610 / 12/12 | 267.1 / $0.6226 / 12/12 |
| speed-up-search | 57.8 / $0.3601 / 11/11 | 106.1 / $0.4940 / 11/11 |
| regression-fix-with-fixes | 79.0 / $0.5105 / 10/10 | 115.9 / $0.4726 / 10/10 |
| library-cli-flag | 41.3 / $0.3539 / 8/8 | 56.8 / $0.3858 / 8/8 |
| platform-migration | 60.6 / $0.4132 / 10/10 | 94.1 / $0.4719 / 10/10 |
| webhook-integration | 343.0 / $0.6715 / 13/13 | 161.2 / $0.5370 / 13/13 |
| config-flag | 81.5 / $0.4216 / 11/11 | 110.4 / $0.5106 / 11/11 |
| dependency-upgrade | 79.7 / $0.4687 / 8/8 | 117.0 / $0.5349 / 8/8 |
| deprecate-option | 98.1 / $0.5415 / 8/8 | 126.8 / $0.4985 / 8/8 |
| infra-config | 98.4 / $0.4227 / 9/9 | 96.3 / $0.2590 (foundation metrics) / 9/9 |
| add-metrics | 65.0 / $0.4325 / 8/8 | 85.8 / $0.4661 / 8/8 |
| privacy-erasure | 64.9 / $0.3923 / 9/9 | 74.0 / $0.4251 / 9/9 |
| feature-experiment | 73.4 / $0.4547 / 8/8 | 87.1 / $0.4395 / 8/8 |
| client-version-gate | 80.3 / $0.3923 / 9/9 | 111.4 / $0.5103 / 9/9 |
| ml-eval-threshold | 61.1 / $0.4012 / 9/9 | 120.5 / $0.5135 / 9/9 |
| security-hotfix | 76.5 / $0.2104 (foundation metrics) / 9/9 | 102.1 / $0.4415 / 9/9 |
| **รวม** | **3266.2 / $13.4255 / 28/28** | **3999.0 / $15.2899 / 28/28** |

10 แถวที่มีร่วมกับ v3.6.3: 1130.2 วินาที US$4.8407 เทียบกับ v3.6.3 ที่ 1037.8 วินาที US$4.5552

## ข้อค้นพบ

1. **คำแนะนำที่แคบลงตัด overhead ส่วนใหญ่ของ v3.6.4 ได้**
   - 22 จาก 28 แถวเร็วขึ้น
   - project tracker ลดลง 157 วินาที และ cart-coupons ลดลง 77 วินาที
2. **ทำคำแนะนำให้แคบอย่างเดียว ทำให้งานแก้ regression พลาด boundary ข้างเคียง**
   - การให้ `fixes` บังคับ coverage ด้าน input-boundary แก้ปัญหานี้ได้ ผ่าน 10/10 ทั้ง 2 ครั้ง
   - ไม่ทำให้มี review เพิ่ม
3. **webhook-integration ช้าลงจาก 161 เป็น 343 วินาที**
   - แถวนี้ประกาศ external integration จริง จึงยังต้องมี review และ coverage เหมือนเดิม
   - รันครั้งเดียวยังแยกไม่ได้ว่าช้าลงจริง หรือเป็นความแกว่งปกติของการรันครั้งเดียว ซึ่งเคยเห็นมาแล้ว

## รันที่เก็บไว้

```text
~/.local/share/changeloop/benchmarks/2026-10-18-candidate-v3.6.5-90cd46364.tar.gz
sha256 d6146fc80a846550eb3a1a8f3864ccbf947b4fa8c194d53979291df034ebb2fe
```

ค่า SHA-256 ของ `integrity.json` แต่ละรันอยู่ใน[ฉบับภาษาอังกฤษ](scenario-checkpoint-v3.6.5-2026-10-18.md#retained-runs)

ขั้นต่อไป:
- รันซ้ำก่อนอ้างว่าความเร็วต่างกัน
- ถ้า webhook-integration ยังช้าอยู่ ให้ตรวจดูสาเหตุ
