# Checkpoint ของ release candidate หลัง v3.6.3 — 2026-10-18

[English](scenario-checkpoint-candidate-2026-10-18.md)

Candidate `8410d517cea3c3f1a9d60c3c1a62e1c2c7742d5b` ซึ่งเป็น commit ที่สะอาด
ได้รันทุก paid scenario ใน matrix (28 รายการ) รายการละหนึ่งครั้งด้วย
`claude-sonnet-5-5` ผลคือ **ส่งมอบแบบ strict ได้ 27/28**

- **Order/inventory:** ถึง archived และ oracle 19/19 แต่ยังมี 3 tasks
  ที่ไม่ได้ติ๊ก ซึ่งเป็นข้อบกพร่องเดิมของ archived ledger ผลแบบ strict
  จึงเป็น `incomplete`
- **Project tracker:** ผ่าน 33/33
- **Dependency upgrade:** ก่อน candidate นี้ล้มเฉพาะตอนใช้ harness
  ตอนนี้ผ่านแล้ว เพราะ Land ติดตั้ง dependency ในโฟลเดอร์ของผู้ใช้ให้
- **เทียบกับ v3.6.3 (10 scenario ที่มีร่วมกัน):** candidate ใช้เวลามากกว่า 44%
  และค่าใช้จ่ายมากกว่า 27% คะแนน oracle เท่ากัน

แต่ละแถวรันครั้งเดียว (n=1) ผลนี้จึงเป็น smoke check ไม่ใช่ข้อสรุปเรื่องความเร็วที่เชื่อถือได้

## ขอบเขตการรัน

- **Source:** `8410d517c` บน `main` ทุกรันมี `source.dirty: false` ประกอบด้วยทุกอย่างหลัง
  v3.6.3 ที่อยู่ใต้ `[Unreleased]` ใน changelog และการแก้เทสต์ของ dashboard
- **Gate แบบ deterministic รันก่อน:** full suite ผ่าน 241/241 และ sentinel
  ที่ไม่มีค่าใช้จ่ายผ่าน
  - รอบแรกบน `94996e3d4` หยุดที่ full suite ก่อนรัน paid ใดๆ
  - สาเหตุ: เทสต์ presence นับ heartbeat สองครั้งที่คร่อมรอยต่อนาทีระหว่างที่ suite รันหนัก
  - แก้เฉพาะเทสต์ได้เป็น `8410d517c` จากนั้น gate ผ่าน
- **สภาพแวดล้อม:** ล็อกโมเดลด้วย `ANTHROPIC_MODEL=claude-sonnet-5-5`, Claude
  Code 2.1.302, Node v26.11.1, macOS 26.7 arm64 งบใน matrix ไม่เปลี่ยน
- **การรันพร้อมกัน:** แต่ละชุดรันทีละรายการ
  - candidate 10 รายการแรกรันคู่กับ v3.6.3 อีก 10 รายการ (สองรายการพร้อมกัน)
  - candidate อีก 18 รายการรันเดี่ยว
  - การเทียบกับ v3.6.3 จึงเป็นแบบสลับกันรันในช่วงเวลาเดียวกัน
    ส่วนคอลัมน์ no-harness เป็นคนละชุด
- **ฐานเทียบ:** tag `v3.6.3` (`055770b23`) ใน worktree แยก ใช้ lab และ matrix ของตัวเอง
  fixture และ oracle ของ 10 paid scenario ตรงกับของ candidate ทุก byte
- **คอลัมน์ no-harness:** มาจาก baseline arm บน `main` วันที่ 2026-10-16 (23 แถว)
  order/inventory และ 4 lane ที่วัดว่าระบบตรวจหลักฐานแบบใหม่ทำงานหรือไม่ไม่มี baseline
- **ค่าใช้จ่ายที่วัดจาก host:**

  | รายการ | ค่าใช้จ่าย |
  |---|---|
  | candidate 28 รัน | US$15.1315 |
  | feature-experiment รอบแรกที่ล้ม | US$0.3029 |
  | v3.6.3 10 รัน | US$4.5552 |
  | **รวม** | **US$19.9896** |

  ค่าใช้จ่ายของ infra-config ฝั่ง candidate มาจาก foundation metrics ไม่ใช่
  host envelope ค่าอื่นทั้งหมดเป็น CLI envelope ไม่ใช่ใบแจ้งหนี้
  ไม่ได้วัดค่าใช้จ่ายของ reviewer แยก

## ผล

แต่ละช่องคือ วินาทีของ runner / ค่าใช้จ่ายที่วัดจาก host / คะแนน oracle

ทุกแถวที่ archived ยกเว้น order/inventory ผ่านทุกข้อต่อไปนี้ และไม่มี task ค้าง:
- measured quality
- คำสั่งปกติของโปรเจกต์
- clean install
- เทสต์หลังติดตั้ง

| Scenario | Candidate | v3.6.3 | ไม่มี harness (2026-10-16) |
|---|---|---|---|
| bare-node-boundary | 81.5 / $0.4488 / 6/6 | 53.1 / $0.3607 / 6/6 | 60.3 / $0.1980 / 6/6 |
| typescript-react-state | 42.5 / $0.3624 / 6/6 | 70.2 / $0.3832 / 6/6 | 32.6 / $0.1785 / 6/6 |
| python-api-validation | 67.4 / $0.4090 / 5/5 | 50.3 / $0.3739 / 5/5 | 26.3 / $0.1710 / 5/5 |
| database-migration-rollback | 113.4 / $0.4307 / 6/6 | 78.3 / $0.3509 / 6/6 | 46.9 / $0.2147 / 6/6 |
| refactor-no-reproduction | 82.3 / $0.4469 / 6/6 | 46.6 / $0.3477 / 6/6 | 26.5 / $0.1757 / 6/6 |
| multi-service-event-flow | 108.2 / $0.4440 / 6/6 | 84.0 / $0.3564 / 6/6 | 37.1 / $0.2216 / 6/6 |
| tiny-feature | 89.3 / $0.4997 / 8/8 | 45.0 / $0.3355 / 8/8 | 38.2 / $0.2065 / 8/8 |
| notes-api | 160.0 / $0.6557 / 13/13 | 133.9 / $0.5637 / 13/13 | 115.0 / $0.4360 / 13/13 |
| cart-coupons | 192.7 / $0.5768 / 11/11 | 83.3 / $0.4779 / 11/11 | 69.4 / $0.3139 / 11/11 |
| project-tracker-api | 557.3 / $1.5270 / 33/33 | 393.1 / $1.0053 / 33/33 | 296.8 / $0.8661 / 33/33 |
| order-inventory | 574.1 / $1.2965 / 19/19, **ค้าง 3 tasks** | — | — |
| owner-only-delete | 105.6 / $0.4508 / 9/9 | — | — |
| idempotent-refund | 267.1 / $0.6226 / 12/12 | — | — |
| speed-up-search | 106.1 / $0.4940 / 11/11 | — | — |
| regression-fix-with-fixes | 115.9 / $0.4726 / 10/10 | — | — |
| library-cli-flag | 56.8 / $0.3858 / 8/8 | — | 51.4 / $0.1910 / 8/8 |
| platform-migration | 94.1 / $0.4719 / 10/10 | — | 58.4 / $0.2653 / 10/10 |
| webhook-integration | 161.2 / $0.5370 / 13/13 | — | 62.0 / $0.2822 / 13/13 |
| config-flag | 110.4 / $0.5106 / 11/11 | — | 56.8 / $0.2373 / 11/11 |
| dependency-upgrade | 117.0 / $0.5349 / 8/8 | — | 54.8 / $0.2410 / 8/8 |
| deprecate-option | 126.8 / $0.4985 / 8/8 | — | 79.3 / $0.2928 / 8/8 |
| infra-config | 96.3 / $0.2590 (foundation metrics) / 9/9 | — | 71.4 / $0.2667 / 9/9 |
| add-metrics | 85.8 / $0.4661 / 8/8 | — | 54.4 / $0.2475 / 8/8 |
| privacy-erasure | 74.0 / $0.4251 / 9/9 | — | 47.0 / $0.2163 / 9/9 |
| feature-experiment | 87.1 / $0.4395 / 8/8 (รอบที่สอง) | — | 48.4 / $0.2402 / 8/8 |
| client-version-gate | 111.4 / $0.5103 / 9/9 | — | 62.4 / $0.2847 / 9/9 |
| ml-eval-threshold | 120.5 / $0.5135 / 9/9 | — | 53.3 / $0.2442 / 9/9 |
| security-hotfix | 102.1 / $0.4415 / 9/9 | — | 54.0 / $0.2176 / 9/9 |

ผลรวม:

- **เทียบ v3.6.3 (10 แถวร่วม):** 1494.8 วินาที / US$5.8011 เทียบกับ
  1037.8 วินาที / US$4.5552 คือเวลา +44% ค่าใช้จ่าย +27%
  - ทั้งสองผ่าน 10/10 และ Tracker ผ่าน 33/33 ทั้งคู่
  - มีแค่ typescript-react-state ที่ candidate เร็วกว่า
- **เทียบแบบไม่มี harness (23 แถวร่วม):** 2838.3 วินาที / US$11.7949 เทียบกับ
  1502.7 วินาที / US$6.2090 คือเวลา 1.89 เท่า ค่าใช้จ่าย 1.90 เท่า
  oracle ผ่าน 23/23 ทั้งคู่

## ข้อค้นพบ

1. **Feature-experiment หยุดที่ Change หนึ่งครั้ง**
   - รอบแรก (`feature-experiment-1792258405144`) compile spec แล้ว
     แต่เอเจนต์จบเทิร์นเพื่อขอให้ผู้ใช้อนุมัติ
   - เหตุผลที่อ้างเป็นเรื่องที่เอเจนต์ตัดสินเอง คือนับ user id `0` หรือ `NaN`
     เป็นผู้ใช้ที่ล็อกอิน
   - `advance` ไม่ได้คืน `ASK_USER` และ 4 รันก่อนหน้าของ scenario นี้
     เมื่อ 2026-10-16 archived 8/8 ทั้งหมด
   - บันทึกเป็น `task-oracle-unavailable` ที่ `change` รันซ้ำเฉพาะแถวนี้หนึ่งครั้งได้ archived 8/8
   - สรุป: เป็นความแปรปรวนของเอเจนต์ที่ด่านอนุมัติ (n=1) ไม่ใช่ regression ของ
     harness แต่อาจเกิดซ้ำได้
2. **Archived ledger ของ order/inventory ยังมี 3 tasks ไม่ได้ติ๊ก**
   - เหมือนใน [การตรวจ 2026-10-12](scenario-order-inventory-2026-10-12.md) และ
     [รอบ 2026-10-15](scenario-pstack-gates-2026-10-15.th.md)
   - oracle ของผลงานผ่าน แต่ผล strict ยังเป็น `incomplete`
   - ยังเป็นตัวบล็อก checkpoint ตาม [RELEASING.md](../../RELEASING.md)
     เว้นแต่ maintainer จะบันทึกข้อยกเว้นไว้
3. **การติดตั้ง dependency หลัง Land ปิดปัญหา dependency-upgrade แล้ว**
   - ตอนนี้ scenario นี้ archived และผ่าน clean install
   - ก่อนแก้ ล้มเฉพาะตอนใช้ harness เพราะหลัง Land โฟลเดอร์ของผู้ใช้ไม่มี dependency ใหม่
4. **Candidate ช้ากว่าและแพงกว่า v3.6.3**
   - การวัดชุดก่อนๆ ในวันเดียวกันชี้ว่าส่วนใหญ่มาจากงาน Change และ review ที่เพิ่มขึ้น
     ได้แก่ change packet v5, review policy และ evidence gate
   - โค้ดเดิมที่ไม่เปลี่ยนก็ยังแกว่งได้ราว 13–21% ต่อการรันหนึ่งครั้ง
     ความต่างรายแถวจึงยังสรุปสาเหตุไม่ได้ถ้าไม่รันซ้ำ

## รันที่เก็บไว้

ไฟล์ผลดิบอยู่ในโฟลเดอร์ผล lab ที่ Git ไม่ track และถูกเก็บถาวรไว้นอก Git
และนอก state ที่ลบทิ้งได้:

```text
~/.local/share/changeloop/benchmarks/2026-10-18-candidate-8410d517c.tar.gz
sha256 2babbd878e4ad3ccd559826b1e0ae5e7b96ead1851d700cee321ef0bd4d2771d
```

ในไฟล์มี:
- bundle ของ candidate 29 ชุด รวมรอบที่ล้ม
- bundle ของ v3.6.3 10 ชุด
- JSON ผลการเทียบ
- progress log ทั้งสองชุด

ค่า SHA-256 ของ `integrity.json` แต่ละรันอยู่ใน[ฉบับภาษาอังกฤษ](scenario-checkpoint-candidate-2026-10-18.md#retained-runs)

ขั้นต่อไป: ก่อนเผยแพร่ ให้แก้ archived ledger ของ order/inventory แล้วรันแถวนั้นใหม่
หรือให้ maintainer บันทึกข้อยกเว้นไว้ และควรรันซ้ำก่อนอ้างว่าความเร็วต่างกัน
