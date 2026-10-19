# Checkpoint ของ candidate หลัง v3.6.5 — 2026-10-19

[English](scenario-checkpoint-candidate-9f1c09bf2-2026-10-19.md)

Candidate `9f1c09bf2` คือ v3.6.5 บวกอีกเจ็ด commit ได้แก่ single Land gate,
blocking policy, scratch router approval package กับ preview และ role lanes
รันทั้ง 28 scenario แบบเสียเงิน scenario ละหนึ่งรอบ ในสองฝั่งคือ Change Loop และ
no-harness

- Strict delivery ได้ **27/28** โดย `dependency-upgrade` ค้างที่ `building`
  ถือเป็น **checkpoint blocker**
- เทียบกับ [checkpoint ของ v3.6.5](scenario-checkpoint-v3.6.5-2026-10-18.th.md)
  wall time รวม **+0.5%** (3281.2 s เทียบ 3266.2 s) และ host cost +0.9%
- n=1 ต่อแถว ผลนี้จึงเป็น smoke check ไม่ใช่ตัวเลขยืนยันความเร็วที่เสถียร

## ขอบเขตการรัน

- Source คือ `9f1c09bf2` ที่ไม่มีการแก้ค้าง (`source.dirty: false`) matrix
  `sha256:4522698635406f02…`
  - Full suite ผ่าน 251/251 ในรอบที่สอง รอบแรก test `notification deduplication
    is serialized across processes` ทำ session หายหนึ่งตัวขณะ full suite รันพร้อมกัน
  - ตอนรัน suite นั้นเดี่ยว ๆ ผ่าน 5/5
  - Zero-cost sentinel ผ่าน 29/29
- สภาพแวดล้อม: `ANTHROPIC_MODEL=claude-sonnet-5-5`, Claude Code 2.1.302,
  Node v26.11.1, macOS 26.7 arm64
  - รันทีละแถวด้วย budget ของ matrix ตามเดิม
  - รันฝั่ง Change Loop ก่อน แล้วจึงรันฝั่ง no-harness (`--arm baseline`)
    ไม่ได้รันสลับกัน
- คอลัมน์ v3.6.5 ใช้ผลของ checkpoint ที่เก็บไว้ ไม่ได้รันใหม่
  - model, CLI, Node และ budget ตรงกัน
  - แต่เป็นคนละ batch ที่รันบน `078e10ba8` และ `90cd46364`
- เกณฑ์หยุดที่ maintainer กำหนด: ถ้าแถวไหนช้ากว่า v3.6.5 เกิน 30% ให้หยุดถามก่อนรันต่อ
  - ใช้กับฝั่ง Change Loop เท่านั้น ฝั่ง no-harness บันทึกผลอย่างเดียว
  - หยุดถามไป 3 แถว และ maintainer เลือกรันต่อทุกครั้ง
- งบที่อนุมัติคือ US$100 ใช้จริงตาม host cost ที่วัดได้ **US$21.3012**
  แบ่งเป็น Change Loop US$13.5432 และ no-harness US$7.7579

## ผลลัพธ์

ตัวเลขในตารางเป็น runner wall seconds

- "vs v3.6.5" คือส่วนต่าง wall time ของ Change Loop เทียบ v3.6.5
- "×NH" คือ wall time ของ Change Loop หารด้วย wall time ของ no-harness
- ถ้าไม่มีหมายเหตุ แถว Change Loop นั้น `completed` ถึง archived และได้ oracle เต็ม

| Scenario | Change Loop | v3.6.5 | vs v3.6.5 | No-harness | ×NH | CL cost | NH cost | Oracle CL / NH |
|---|---|---|---|---|---|---|---|---|
| bare-node-boundary | 73.2 | 55.8 | **+31.2%** | 46.1 | 1.59 | $0.3899 | $0.2263 | 6/6 / 6/6 |
| typescript-react-state | 52.6 | 45.6 | +15.3% | 26.7 | 1.97 | $0.3613 | $0.1746 | 6/6 / 6/6 |
| python-api-validation | 76.5 | 65.7 | +16.4% | 25.2 | 3.04 | $0.3397 | $0.1691 | 5/5 / 5/5 |
| database-migration-rollback | 80.5 | 84.8 | −5.1% | 38.7 | 2.08 | $0.3640 | $0.2030 | 6/6 / 6/6 |
| refactor-no-reproduction | 82.8 | 41.5 | **+99.5%** | 33.2 | 2.49 | $0.4003 | $0.1984 | 6/6 / 6/6 |
| multi-service-event-flow | 104.2 | 116.9 | −10.9% | 35.9 | 2.90 | $0.3950 | $0.2055 | 6/6 / 6/6 |
| tiny-feature | 46.3 | 65.1 | −28.9% | 29.5 | 1.57 | $0.3640 | $0.1841 | 8/8 / 8/8 |
| notes-api | 156.5 | 138.3 | +13.2% | 107.0 | 1.46 | $0.6031 | $0.4211 | 13/13 / 13/13 |
| cart-coupons | 103.9 | 116.2 | −10.6% | 74.4 | 1.40 | $0.5462 | $0.3086 | 11/11 / 11/11 |
| project-tracker-api | 438.0 | 400.3 | +9.4% | 681.7 | 0.64 | $1.0418 | $0.8613 | 33/33 / 33/33 (project command ฝั่ง NH ไม่ผ่าน) |
| order-inventory | 603.0 | 508.2 | +18.7% | 281.9 | 2.14 | $1.3814 | $0.8303 | 19/19 / 19/19 |
| owner-only-delete | 87.5 | 85.0 | +3.0% | 26.3 | 3.33 | $0.3702 | $0.1844 | 9/9 / 9/9 |
| idempotent-refund | 191.5 | 182.3 | +5.0% | 75.5 | 2.53 | $0.5741 | $0.3340 | 12/12 / 12/12 |
| speed-up-search | 60.9 | 57.8 | +5.3% | 53.6 | 1.14 | $0.3983 | $0.2352 | 11/11 / 11/11 |
| regression-fix-with-fixes | 52.6 | 79.0 | −33.4% | 26.1 | 2.02 | $0.3988 | $0.1704 | 10/10 / 10/10 |
| library-cli-flag | 66.4 | 41.3 | **+60.8%** | 29.3 | 2.27 | $0.4481 | $0.1841 | 8/8 / 8/8 |
| platform-migration | 59.1 | 60.6 | −2.5% | 55.4 | 1.07 | $0.4089 | $0.2544 | 10/10 / 10/10 |
| webhook-integration | 160.4 | 343.0 | −53.2% | 73.6 | 2.18 | $0.5309 | $0.2930 | 13/13 / 13/13 |
| config-flag | 70.7 | 81.5 | −13.3% | 41.3 | 1.71 | $0.3350 | $0.2226 | 11/11 / 11/11 |
| dependency-upgrade | 90.9 | 79.7 | +14.1% | 38.9 | 2.34 | $0.4599 | $0.2281 | **ค้างที่ `building`** / 8/8 (project command ฝั่ง NH ไม่ผ่าน) |
| deprecate-option | 105.1 | 98.1 | +7.2% | 64.8 | 1.62 | $0.4825 | $0.2759 | 8/8 / 8/8 |
| infra-config | 66.1 | 98.4 | −32.8% | 51.7 | 1.28 | $0.4306 | $0.2466 | 9/9 / 9/9 |
| add-metrics | 52.6 | 65.0 | −19.1% | 37.6 | 1.40 | $0.3453 | $0.2124 | 8/8 / 8/8 |
| privacy-erasure | 79.0 | 64.9 | +21.7% | 38.3 | 2.06 | $0.4174 | $0.2130 | 9/9 / 9/9 |
| feature-experiment | 72.5 | 73.4 | −1.3% | 48.9 | 1.48 | $0.4476 | $0.2295 | 8/8 / 8/8 |
| client-version-gate | 99.3 | 80.3 | +23.7% | 50.5 | 1.97 | $0.4847 | $0.2531 | 9/9 / 9/9 |
| ml-eval-threshold | 69.4 | 61.1 | +13.6% | 43.4 | 1.60 | $0.4371 | $0.2293 | 9/9 / 9/9 |
| security-hotfix | 79.7 | 76.5 | +4.2% | 40.2 | 1.98 | $0.3871 | $0.2094 | 9/9 / 9/9 |
| **รวม** | **3281.2** | **3266.2** | **+0.5%** | **2175.6** | **1.51** | **$13.5432** | **$7.7579** | CL 27/28 |

ค่ามัธยฐานจาก `time-gate.mjs` (ไม่นับสองแถวที่ฝั่ง no-harness ล้ม)

| Tier | อัตราส่วน | เป้าหมาย | ผล | จำนวนแถวที่จับคู่ได้ |
|---|---|---|---|---|
| rapid | **2.03×** | 1.5× | **ไม่ผ่าน** | 4 |
| standard | **1.69×** | 1.8× | ผ่าน | 22 |

## ข้อค้นพบ

1. **`dependency-upgrade` ล้มเพราะช่องโหว่ของ harness ที่มีมาก่อน candidate นี้**
   - sandbox setup (`npm ci`) รันแค่ครั้งเดียวตอนสร้าง sandbox
     (`workflow/sandbox-runtime.mjs`)
   - `retryFailedSandboxSetups` รัน setup ซ้ำเฉพาะเมื่อ setup ล้ม
   - จุดเดียวที่เทียบ manifest/lockfile คือ `postLandInstall`
     (`workflow/apply-runtime.mjs:37`) ซึ่งทำงานหลัง Land
   - ผลคือเมื่อ Build แก้ `package.json` การตรวจจะรันกับ `node_modules` เดิม
   - รอบ v3.6.5 ผ่านได้เพราะ agent รัน `npm install --offline` เอง
   - รอบนี้ agent ใช้ `ln -sfn ../vendor/slugkit-2.0.0 node_modules/slugkit` แทน
     แล้วโดน `obviousWorkspaceEscape` (`core/shell-mutation-policy.mjs:265`)
     ปฏิเสธ เพราะฟังก์ชันนี้ถือว่า operand ที่มี `..` ออกนอก workspace ทุกกรณี
     โดยไม่ resolve path ทั้งที่ปลายทางอยู่ใน sandbox
   - ข้อความปฏิเสธแนะนำให้แก้ `foundation.json` agent จึงหยุดถาม user
     ซึ่งขัดกับหลักที่ harness ต้องจัดการ setup recovery เอง
   - ทั้งเจ็ด commit ไม่ได้แตะไฟล์เหล่านี้
2. **แถวที่ช้ากว่า v3.6.5 เกิน 30% ดูเป็นความแปรปรวนของเส้นทางที่ model เลือก
   ไม่ใช่ต้นทุนของ harness**
   - `bare-node-boundary` เรียกคำสั่งชุดเดียวกัน 18 ครั้งในทั้งสองเวอร์ชัน
     และ harness ใช้เวลาต่อคำสั่งเท่ากัน มีเพียง API time ที่ขึ้นจาก 49 s เป็น 71 s
   - `refactor-no-reproduction` ส่ง `change start --through` โดยไม่ใส่
     `--approve-spec` จึงโดน `cli-router.mjs:131` บล็อก ซึ่งเป็นเงื่อนไขที่มีมาก่อน v3.6.5
     และยังแยกขั้นตอนเขียน test ออกมา ทำให้ใช้ 12 requests เทียบกับ 7
   - รอบของ `8410d517c` ที่เก็บไว้ใช้ 84.0 s ด้วยรูปแบบเดียวกัน แปลว่ารอบ 41.5 s
     ของ v3.6.5 เป็นค่าที่ผิดปกติ
   - `library-cli-flag` ใช้ 15 requests เทียบกับ 8 และไม่ได้โดนบล็อกเรื่อง approval
     รอบของ v3.6.4 ใช้ 56.8 s ยังไม่ได้วิเคราะห์ turn ของแถวนี้
3. **สิ่งที่ commit ใหม่เพิ่มเข้ามาจริงและวัดได้**
   - output ของ `change start --template` ยาวขึ้นประมาณ 1.5 KB
   - `change start` พิมพ์บรรทัด `approval package:` เพิ่มหนึ่งบรรทัด
   - ในแถวเหล่านี้ไม่มีอันไหนเพิ่ม turn และกระทบ input token ไม่ถึง 1%
4. **อัตราส่วนเทียบ no-harness ของ tier rapid ไม่ถึงเป้า** (2.03× เทียบกับ 1.5×)
   บันทึกไว้ประกอบการตัดสินใจ ไม่ได้ใช้เป็นเกณฑ์หยุด

## รัน dependency-upgrade ซ้ำหลังแก้

- `e1518a1` เปลี่ยนการทำงานของ setup ดังนี้
  - setup บันทึก digest ของ `package.json` และ lockfile ไว้
  - ระหว่าง Build ถ้า digest เปลี่ยน ทุก `exec`, task check และ proof run จะรัน setup เดิมซ้ำก่อน
  - ข้อความปฏิเสธเรื่อง borrow ไม่แนะนำให้แก้ `foundation.json` อีกต่อไป
- ก่อนรันซ้ำ: full suite ผ่าน, website build ผ่าน, sentinel ผ่าน 29/29 บน `f3ad30df0`
  ที่ไม่มีการแก้ค้าง
- รันซ้ำแบบเสียเงินหนึ่งรอบบน `f3ad30df0` (`source.dirty: false`)
  - ผลคือ `completed` ถึง archived, ไม่มี task ค้าง, oracle 8/8
  - ใช้ 70.3 s, ค่าใช้จ่ายที่วัดได้ US$0.4423, 12 requests
- agent ไม่ได้ install หรือ link dependency เอง และไปถึง proven ด้วย
  `advance --through proven` ครั้งเดียว
- digest ที่ setup บันทึกไว้ (`sha256:df125ccc…`) ไม่ตรงกับ digest ของ manifest ใน
  seed (`sha256:5eca5cd7…`) แปลว่า harness ติดตั้งใหม่เองหลังมีการแก้
- ผลนี้ปลด checkpoint blocker ของแถวนี้ (n=1)
  - อีก 27 แถวมาจาก `9f1c09bf2`
  - การแก้นี้มีผลเฉพาะเมื่อ Build แก้ manifest หรือ lockfile และใน matrix มีแค่
    dependency-upgrade ที่ทำแบบนั้น
- ค่าใช้จ่ายที่วัดได้ทั้ง checkpoint รวมรอบรันซ้ำ: **US$21.7435**

```text
~/.local/share/changeloop/benchmarks/2026-10-19-rerun-dependency-upgrade-f3ad30df0.tar.gz
sha256 65d1911a6761e27409104ffa7c23a17deb1dc26ee57048d29d490b0c74b0e92c
```

## Run ที่เก็บไว้

```text
~/.local/share/changeloop/benchmarks/2026-10-19-candidate-9f1c09bf2.tar.gz
sha256 f33eddc21992cae8472f9d9766ec8e19c771295ceb382cc7ca95360bbebafe3d
```

ในไฟล์มี `checkpoint-9f1c09bf2-candidate/` และ `checkpoint-9f1c09bf2-baseline/`
รวม 56 run bundle แต่ละ bundle มี `integrity.json` ของตัวเอง

ขั้นต่อไป:

1. เสร็จแล้วใน `e1518a1`: Build refresh dependency ให้เอง และแก้ข้อความปฏิเสธแล้ว
   ส่วนการตรวจ operand ของ `ln` ยังเหมือนเดิม เพราะกฎ isolation ตั้งใจให้ปฏิเสธการ link
2. เสร็จแล้ว: `dependency-upgrade` ถึง `archived` บน `f3ad30df0` ที่ไม่มีการแก้ค้าง
3. รัน `refactor-no-reproduction`, `library-cli-flag` และ `bare-node-boundary`
   ซ้ำก่อนอ้างว่าความเร็วต่างกัน
4. ตัดสินใจว่าอัตราส่วนของ tier rapid จะบล็อก release หรือไม่
