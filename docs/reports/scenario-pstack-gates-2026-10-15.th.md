# Paid E2E หลัง change evidence gate และ rollup ข้าม change — 2026-10-15

[English](scenario-pstack-gates-2026-10-15.md)

`change-pstack-agent` ที่ land แล้วแต่ยังไม่ commit (benchmark evidence,
access allow/deny แบบ typed, riskSignal `financial`, `constraints`/`fixes` ใน
draft, `outcomes`/`lessons`, review finding code, `experimentKeys` ของ
hypothesis) ถูกทดสอบด้วย paid scenario ทั้ง 11 ตัวสองรอบ: รอบแรกใช้ model
ค่าเริ่มต้นของ host และรอบสอง pin `claude-sonnet-5-5` รอบ Sonnet ได้
**strict delivery 10/11** รวมถึง Tracker 33/33 เป็นครั้งแรกในทุก cohort ที่เก็บไว้
ส่วน order/inventory ยัง archive โดยมี task ไม่ถูกติ๊ก 3 ตัว นี่เป็นหลักฐานจาก
source ที่ยังไม่ commit และ n=1 ต่อแถว จึงไม่ใช่ release checkpoint และไม่ใช่การยืนยันความเร็ว

## ขอบเขตการรัน

- Source: commit `0bd8c578ea1410d59b3606ad468ae6c3be579a63` บวก diff ของ change
  ที่ยังไม่ commit (`source.patchDigest`
  `sha256:6561c777e083eae6582562fc9b563a8bcb308633de5b456b824a7…` เหมือนกันทุก run
  ทั้งสองรอบ) `source.dirty: true`
- ตรวจ deterministic ก่อน: full suite ผ่าน 227/227 ชุดใน checkout หลักหลัง Land
  และ sentinel แบบไม่เสียเงินผ่านทั้ง 12 แถว
- งบที่ผู้ใช้อนุญาต: US$100 เพดานต่อ run มาจากสำเนา matrix เฉพาะการทดลอง
  (รอบ 1: 9 USD ต่อ run, tiny-feature 5, order-inventory 10 รวม 96; รอบ 2: 8 ต่อ run,
  tiny-feature 4, order-inventory 9 รวม 85 ซึ่งอยู่ในงบที่เหลือ) budget อื่นใน matrix คงเดิม
- Claude Code 2.1.300, Node v26.3.0, macOS 26.7 arm64 รัน tiny-feature เดี่ยวก่อนเป็น
  paid sentinel แล้วรันอีกสิบตัวพร้อมกันครั้งละสี่
- รอบ 2 pin model ผ่าน runner wrapper เฉพาะการทดลอง ซึ่งเพิ่ม
  `--model claude-sonnet-5-5` ให้ host และใน provenance ของ scorecard โดยไม่แก้ runner,
  fixture หรือ oracle ใน repo ทุก stream ของรอบ Sonnet เห็น model ตามที่ขอ รอบ 1 ไม่ได้ pin
  และทุก stream แสดง `claude-opus-5-5`
- ค่าใช้จ่าย host CLI ที่วัดได้: รอบ 1 **US$10.9925** รอบ 2 **US$6.0070** รวม
  **US$16.9995** ไม่มี run ใดที่ไม่รู้ค่าใช้จ่าย ไม่ได้วัดค่า reviewer ที่เรียกเก็บแยก
  ค่าเหล่านี้มาจาก CLI envelope ไม่ใช่ใบแจ้งหนี้

## ผล

แต่ละช่องคือวินาทีจาก stopwatch ของ runner / ค่าใช้จ่าย host / คะแนน oracle คอลัมน์
baseline คือการรัน Sonnet บน source สะอาดวันเดียวกันก่อน change นี้
([paid E2E 2026-10-15](continuity-paid-e2e-2026-10-15.th.md), source
`6211780127a69c2166d61a24cf8eed8a3ce3f20e`, Claude Code 2.1.299)

| Scenario | Baseline (Sonnet, ก่อน) | รอบ 2 (Sonnet, หลัง) | รอบ 1 (Opus, หลัง) |
|---|---|---|---|
| tiny-feature | 92.9 / $0.3715 / 8/8 | 49.7 / $0.3479 / 8/8 | 61.7 / $0.7025 / 8/8 |
| bare-node-boundary | 51.8 / $0.3438 / 6/6 | 44.9 / $0.3283 / 6/6 | 103.5 / $0.7947 / 6/6 |
| typescript-react-state | 51.8 / $0.3435 / 6/6 | 41.4 / $0.3200 / 6/6 | 79.4 / $0.6194 / 6/6 |
| python-api-validation | 41.2 / $0.3373 / 5/5 | 46.4 / $0.3356 / 5/5 | 62.6 / $0.7118 / 5/5 |
| database-migration-rollback | 72.9 / $0.3463 / 6/6 | 89.1 / $0.3443 / 6/6 | 101.5 / $0.7417 / 6/6 |
| refactor-no-reproduction | 60.1 / $0.3616 / 6/6 | 60.7 / $0.3784 / 6/6 | 74.6 / $0.7283 / 6/6 |
| multi-service-event-flow | 95.2 / $0.3626 / 6/6 | 119.6 / $0.4368 / 6/6 | 161.8 / $0.7693 / 6/6 |
| notes-api | 163.8 / $0.4604 / 13/13 | 148.5 / $0.5446 / 13/13 | 209.8 / $1.0614 / 13/13 |
| cart-coupons | 140.6 / $0.5978 / 11/11 | 119.4 / $0.5314 / 11/11 | 120.1 / $0.9344 / 11/11 |
| project-tracker-api | 337.5 / $0.9487 / 32/33, proven | 471.3 / $1.2208 / **33/33, archived** | 395.4 / $1.9736 / 32/33, proven |
| order-inventory | ไม่ได้รัน | 593.8 / $1.2189 / 19/19, incomplete | 520.7 / $1.9554 / 19/19, incomplete |

ทุก run ที่ archived สำเร็จในทั้งสองรอบผ่าน oracle ก่อน Land, quality ที่วัดได้,
project command ปกติ, clean install และ test หลังติดตั้ง โดยไม่มี task ค้าง

เทียบกับ baseline: เก้า scenario ที่สำเร็จทั้งสองฝั่งรวมกันใช้ 719.7 s เทียบ 770.3 s
และ US$3.5673 เทียบ US$3.5248 ทั้งสิบแถวที่มีร่วมกันรวม 1191.0 s เทียบ 1107.8 s และ
US$4.7881 เทียบ US$4.4735 ส่วนต่างนี้มาจาก Tracker ที่ทำต่อจนถึง Land เป็นหลัก
รอบ Opus แพงราวสองเท่าของรอบ Sonnet โดยผลเหมือนกันทุก scenario ยกเว้น Tracker
เพราะ n=1 ใช้ host version ต่างกัน และ batch ไม่ได้รันสลับกัน ส่วนต่างเหล่านี้จึงยังสรุปเป็น
สาเหตุหรือการเปลี่ยนแปลงความเร็วที่เสถียรไม่ได้

## เทียบราย scenario ข้าม cohort

ทุกคอลัมน์ใช้ `claude-sonnet-5-5` และ n=1 แต่ละช่องคือ วินาที / ค่าใช้จ่าย host / oracle
ค่า no harness มาจาก [การเทียบแบบ no harness](scenario-benchmark-no-harness-2026-10-08.th.md)
และ v3.6.3 มาจาก [candidate checkpoint](scenario-checkpoint-v3.6.3-2026-10-11.th.md)
ทั้งสองแหล่งรายงาน host seconds ส่วนสองคอลัมน์ขวาใช้ stopwatch ของ runner
คอลัมน์ผลเทียบ version นี้กับ source ก่อน change ของวันเดียวกัน ส่วนต่างภายใน ±10% ถือว่าใกล้เคียง

| Scenario | No harness | v3.6.3 | ก่อน change | Version นี้ | เทียบก่อน change |
|---|---|---|---|---|---|
| tiny-feature | 51.1 / $0.19 / 8/8 | 33.7 / $0.29 / 8/8 | 92.9 / $0.37 / 8/8 | 49.7 / $0.35 / 8/8 | ดีขึ้น: เวลา −47%, เงินใกล้เคียง (−6%) |
| bare-node-boundary | 41.7 / $0.22 / 6/6 | 50.6 / $0.34 / 6/6 | 51.8 / $0.34 / 6/6 | 44.9 / $0.33 / 6/6 | ดีขึ้น: เวลา −13%, เงินใกล้เคียง |
| typescript-react-state | 28.9 / $0.17 / 6/6 | 42.5 / $0.32 / 6/6 | 51.8 / $0.34 / 6/6 | 41.4 / $0.32 / 6/6 | ดีขึ้น: เวลา −20%, เงินใกล้เคียง (−7%) |
| python-api-validation | 23.9 / $0.17 / 5/5 | 39.5 / $0.31 / 5/5 | 41.2 / $0.34 / 5/5 | 46.4 / $0.34 / 5/5 | แย่ลงเล็กน้อย: เวลา +13%, เงินเท่าเดิม |
| database-migration-rollback | 62.9 / $0.21 / 6/6 | 80.8 / $0.32 / 6/6 | 72.9 / $0.35 / 6/6 | 89.1 / $0.34 / 6/6 | แย่ลง: เวลา +22%, เงินเท่าเดิม |
| refactor-no-reproduction | 33.8 / $0.16 / 6/6 | 45.3 / $0.32 / 6/6 | 60.1 / $0.36 / 6/6 | 60.7 / $0.38 / 6/6 | ใกล้เคียง (+1% / +5%) |
| multi-service-event-flow | 37.0 / $0.19 / 6/6 | 96.7 / $0.35 / 6/6 | 95.2 / $0.36 / 6/6 | 119.6 / $0.44 / 6/6 | แย่ลง: เวลา +26%, เงิน +20% |
| notes-api | 124.1 / $0.43 / 13/13 | 135.2 / $0.50 / 13/13 | 163.8 / $0.46 / 13/13 | 148.5 / $0.54 / 13/13 | ปนกัน: เวลาใกล้เคียง (−9%), เงิน +18% |
| cart-coupons | 76.2 / $0.32 / 11/11 | 103.7 / $0.50 / 11/11 | 140.6 / $0.60 / 11/11 | 119.4 / $0.53 / 11/11 | ดีขึ้น: เวลา −15%, เงิน −11% |
| project-tracker-api | 187.2 / $0.63 / 32/33 ไม่ผ่าน | 390.0 / $1.11 / 32/33 ไม่ผ่าน | 337.5 / $0.95 / 32/33 ไม่ผ่าน | 471.3 / $1.22 / **33/33** | ดีขึ้น: ผ่านครั้งแรก (เวลา +40%, เงิน +29% เพราะทำต่อจนถึง Land และ delivery check) |
| order-inventory | — | — | — (audit 2026-10-12: 490 / $2.08 / 19/19 incomplete) | 593.8 / $1.22 / 19/19 incomplete | ผลเหมือนเดิม ยังมี task ที่ archive ไว้ไม่ถูกติ๊ก |

เทียบกับ source ก่อน change: ดีขึ้นห้า แย่ลงสาม ปนกันหนึ่ง และเท่าเดิมสอง ไม่มี scenario ใดที่
คะแนน oracle ลดลง ส่วนต่าง ±20–25% ยังอยู่ในช่วงความแปรปรวนของการรันครั้งเดียว
(tiny-feature เคยแกว่งจาก 33.7 s ถึง 92.9 s บนโค้ดเดิม) และ change นี้ไม่ได้แตะเส้นทางหลัก
ของ scenario เหล่านี้ จึงยังไม่ระบุว่าส่วนต่างเรื่องเวลามาจาก change นี้จนกว่าจะรันซ้ำ

## Scenario สำหรับ gate ใหม่ (สามแขน)

paid scenario ใหม่สี่ตัวมุ่งทดสอบ gate ใหม่: `owner-only-delete` (allow/deny),
`idempotent-refund` (financial), `speed-up-search` (benchmark) และ
`regression-fix-with-fixes` (`fixes`) prompt ระบุเฉพาะความต้องการของ product
แต่ละแขนรันสองรอบด้วย `claude-sonnet-5-5` ที่ concurrency หก โดยทุก batch มีทั้งสามแขนปนกัน:
no harness, commit ก่อน change `0bd8c578` (worktree แยกที่มีไฟล์ benchmark ชุดเดียวกัน)
และ version นี้ แต่ละช่องคือ จำนวน run ที่ผ่าน / วินาทีเฉลี่ย / ค่าใช้จ่ายเฉลี่ย

| Scenario | No harness | ก่อน change | Version นี้ |
|---|---|---|---|
| owner-only-delete | 2/2 / 24.1 / $0.177 | 2/2 / 46.8 / $0.340 | 2/2 / 41.9 / $0.323 |
| idempotent-refund | 2/2 / 77.6 / $0.324 | 2/2 / 158.8 / $0.516 | 2/2 / 201.6 / $0.534 |
| speed-up-search | 2/2 / 51.3 / $0.243 | 2/2 / 62.6 / $0.369 | 2/2 / 66.4 / $0.364 |
| regression-fix-with-fixes | 2/2 / 28.1 / $0.186 | 0/2 (9/10, `CASE_UPPER_BOUNDARY`) / 61.1 / $0.488 | 1/2 (หนึ่งรอบ 9/10 ที่ case เดิม) / 51.3 / $0.405 |

ค่าใช้จ่ายที่วัดได้ของ 24 runs นี้: US$8.5385 ไม่มี run ใดที่ไม่รู้ค่าใช้จ่าย

**gate ใหม่ไม่ทำงานเลยในทุก run** ไม่มี draft ของ Change Loop ใดที่ประกาศ `riskSignals`,
tag `access` หรือ `fixes` change เรื่องสิทธิ์เฉพาะเจ้าของถูก compile เป็น rapid ความเสี่ยงต่ำ
และไม่มี review gate เหล่านี้ทำงานเมื่อมีการประกาศแบบ typed เท่านั้น และ agent ไม่ประกาศเอง
version นี้จึงทำงานเหมือน source ก่อน change ในงานเหล่านี้ ส่วนต่างของผลลัพธ์จึงไม่ได้มาจาก gate
ทั้งสองแขนที่ใช้ harness แก้เฉพาะขอบเขต 1000 แต้มที่ถูกรายงาน และพลาดขอบเขต 5000 แต้มที่คล้ายกัน
สองครั้ง ส่วนแขน no harness แก้ทั้งสองขอบเขต นี่เป็นข้อสังเกตเรื่องการกำหนดขอบเขตงาน n=2

## Checkpoint บน commit ที่สะอาดหลัง change คำแนะนำใน template

commit `ef8ac0e2e` เพิ่มคำแนะนำใน start template สำหรับ `riskSignals`, access tag และ
`fixes` และให้ benchmark ยืนยัน regression ด้วยรอบที่สอง full suite ผ่าน 227/227 ทุก run ด้านล่าง
ใช้ `source.dirty: false` pin Sonnet และ sentinel แบบไม่เสียเงินผ่านก่อนเริ่ม ค่าใช้จ่ายที่วัดได้:
**US$9.8322** สำหรับ 19 runs (รวมทั้งรายงานนี้ US$35.3707)

ทุก scenario ส่งมอบสำเร็จ (archived และ oracle เต็ม) ยกเว้น order-inventory ที่ oracle ผ่าน 19/19
แต่ยังติดปัญหา task ใน ledger ที่ archive ไม่ถูกติ๊ก 3 ตัว รวม 18/19 และ Tracker ผ่าน 33/33 อีกครั้ง
ตารางรายตัวอยู่ใน[ฉบับภาษาอังกฤษ](scenario-pstack-gates-2026-10-15.md#clean-commit-checkpoint-after-the-template-guidance-change)

เมื่อมีคำแนะนำใน template agent ประกาศความเสี่ยงแบบ typed เองแล้ว: `access-control` พร้อม scenario
allow/deny สำหรับ owner-only-delete, `financial` สำหรับ refund, `performance-slo` สำหรับ search และ
`fixes` ทั้งสองรอบของงานแก้ regression ซึ่งตอนนี้แก้ครอบขอบเขต 5000 แต้มที่ไม่ได้ถูกรายงานด้วย
(2/2 เทียบกับ 0/2 ก่อน change และ 1/2 หลัง change แรก) run ของ search ประกาศ `performance-slo`
แต่ยังไม่ได้ตั้ง adapter `benchmark`

ข้อจำกัด: n=1–2 ต่อแถว เวลาเทียบกับ batch ก่อนหน้าไม่ได้ เพราะเจ็ด run สุดท้ายเริ่มพร้อมกันข้าง
order/inventory หลังแก้การจัด batch lab ตั้งชื่อ run เป็น `<scenario>-<Date.now()>` รอบซ้ำของ
owner-only-delete และ idempotent-refund ที่เริ่มในมิลลิวินาทีเดียวกันจึงใช้ run directory เดียวกัน
scorecard เก็บครบทั้งสองแถว แต่ stream และ evidence ที่เก็บไว้เป็นของเพียงหนึ่งรอบในแต่ละคู่

## ข้อค้นพบ

1. **Tracker ผ่าน `CASE_TESTS_EXIST` หนึ่งครั้ง** v3.6.0–v3.6.3, baseline วันเดียวกัน
   และรอบ Opus ของ change นี้ หยุดที่ 32/33 ทั้งหมด การผ่านหนึ่งครั้งของ Sonnet ยังไม่แสดงว่า
   ข้อบกพร่องเรื่องความเพียงพอของ test ถูกแก้แล้ว และ change นี้ไม่ได้เปลี่ยนคำแนะนำเรื่องจำนวน
   test ต้องรันซ้ำก่อนสรุป
2. **ledger ที่ archive ของ order/inventory ยังมี task ไม่ถูกติ๊ก 3 ตัว** ทั้งสองรอบ
   (T001–T003 ผูก repository ไม่มี root) ตรงกับ [audit 2026-10-12](scenario-order-inventory-2026-10-12.th.md)
   oracle ผ่าน 19/19 และวัด quality ได้ ผลแบบ strict ยังเป็น `incomplete` ซึ่งถูกต้อง
   ข้อบกพร่องของ archive/ledger ยังเปิดอยู่
3. **ไม่พบ regression ที่เกิดจาก change นี้** ทุก scenario ที่เคยส่งมอบได้ยังส่งมอบได้
   ด้วยคะแนน oracle เท่าเดิม

## Run ที่เก็บไว้

bundle ดิบอยู่ที่ `.claude/tests/bench/results/openspec-native-lab/` ซึ่ง Git ไม่ track
แต่ละ run มี `manifest.json`, `source.patch` และ `integrity.json` รายการ run และ digest อยู่ใน
[ฉบับภาษาอังกฤษ](scenario-pstack-gates-2026-10-15.md#retained-runs)

ทำต่อ: commit change แล้วรันรอบ Sonnet ซ้ำบน commit ที่สะอาด เพื่อให้ได้หลักฐานระดับ
checkpoint และตรวจ ledger ที่ archive ของ order/inventory
