# รันซ้ำงาน tier rapid หลังแก้ overhead — 2026-10-19

[English](scenario-repeat-rapid-2026-10-19.md)

รายงานนี้ต่อจาก [checkpoint ของ `9f1c09bf2` วันที่ 2026-10-19](scenario-checkpoint-candidate-9f1c09bf2-2026-10-19.th.md)
ซึ่งพบว่างาน tier rapid ช้ากว่าแบบไม่มี harness 2.03 เท่า ขณะที่เป้าคือ 1.5 เท่า

- หลังแก้ overhead แล้ว รันซ้ำ **แถวละ 3 คู่** โดยสลับฝั่ง Change Loop กับฝั่งไม่มี harness
- จาก 42 run ที่นับ มี 41 run ที่ได้ oracle เต็ม ส่วนอีก 1 run ของฝั่ง Change Loop บน `0660d1329` ล้ม
- ตอนนี้ค่ากลางของ tier rapid อยู่ที่ **2.01 เท่า** ยังเกินเป้า
- maintainer ตัดสินใจให้บันทึกไว้ ไม่บล็อก release

## ขอบเขตการรัน

- source ทุกตัวไม่มีการแก้ค้าง และ sentinel ผ่าน 29/29 ทุกตัว
  - `0660d1329` (A, B, C4, C5): รันเฉพาะ `config-flag` แล้วหยุดหลังครบ 3 คู่แรก
  - `3fdea70b6` (ถอด C4 ออกแล้ว): รันครบทั้ง 5 แถว
  - `0131bc704` (fix E): รัน `regression-fix-with-fixes` ซ้ำ
- `ANTHROPIC_MODEL=claude-sonnet-5-5`, Claude Code 2.1.302, Node v26.11.1,
  macOS 26.7 arm64 ใช้ budget ของ matrix ตามเดิม รันทีละแถว และสลับฝั่งกันในแต่ละแถว
- full suite รันด้วย `FOUNDATION_TEST_JOBS=6`
  - ถ้าใช้ค่าตั้งต้น 24 ตัวพร้อมกัน จะมี suite หนัก 3 ตัวรันเกินเวลา เพราะเครื่องโหลดหนัก
  - suite ทั้ง 3 ตัวผ่านเมื่อรันเดี่ยว
  - ชุด suite และเพดานเวลาไม่ได้เปลี่ยน
- ค่าใช้จ่ายที่วัดได้: **US$13.5001** จาก 42 run ที่นับ
- มี `regression-fix-with-fixes` 1 run ที่ถูกตัดกลางคัน
  - ตัดเพราะถ้าปล่อยไว้จะรันแถวอื่นเกินจากที่อนุมัติ
  - ไม่มีค่าใช้จ่ายที่วัดได้ น่าจะไม่เกินประมาณ US$0.5
  - ย้ายออกไปไว้นอกชุดผลแล้ว
- เกณฑ์หยุดของ maintainer: ถ้าค่ากลางของ Change Loop ในแถวไหนช้ากว่า v3.6.5 เกิน 30% ให้หยุดถาม
  - หยุดถามที่ `config-flag` บน `0660d1329` และที่ `library-cli-flag`
  - หลังจากนั้น maintainer เลือกรันต่อโดยไม่ต้องหยุดถามอีก

## สิ่งที่แก้และนำมาทดสอบ

| ID | สิ่งที่เปลี่ยน | Commit |
|---|---|---|
| A | outcome ที่ระบบเติมเองไม่เอาข้อความจาก scenario ที่หน้าตาเหมือน placeholder มาใช้ | `d514458` |
| B | ถ้าใส่ `--through` แต่ไม่มี `--approve-spec` ข้อความ error จะบอกคำสั่งที่ถูกต้อง และ `change.md` กับ template ใส่ flag ไว้ใน `change start` ครั้งเดียวกัน | `7a09960`, `cbff509` |
| C4 | ให้งาน rapid ที่ประกาศ `input-domain` ใช้ model ระดับ fast ในการ review: **ถอดออกแล้ว** ใน `3fdea70` ตามที่ maintainer ตัดสินใจ | `cbff509` → `3fdea70` |
| C5 | บันทึก risk signal ก่อนขั้น resolve บรรทัดตอนเริ่มจึงบอก review ระดับ medium ถูกต้อง | `cbff509` |
| E | requirement แบบ `modified` ที่ไม่ได้ระบุชื่อ ระบบจะจับคู่กับ requirement เดิมให้เอง ถ้าจับไม่ได้ ข้อความ repair จะบอกชื่อที่เลือกได้ | `0131bc7` |

ไม่ได้ทำ C3 (ตัด template ของ rapid ให้บางลง)
- ส่วนที่ตัดได้อย่างปลอดภัยมีแค่ตัวอย่างขนาด 600 byte ซึ่งมี contract test ตรวจอยู่
- ตัวอย่างของแต่ละ work type เป็นที่มาของ section ที่ระบบบังคับ ถ้าตัดออก draft จะต้องถูก repair เพิ่มอีกหลายรอบ

## ผลลัพธ์

แต่ละช่องแสดงเวลา (วินาที) ของ Change Loop ในแต่ละรอบ ตามด้วยค่ากลางของ Change Loop ค่ากลางของฝั่งไม่มี harness และอัตราส่วนของทั้งสอง ทุก run ของ Change Loop ถึง archived และได้ oracle เต็ม ยกเว้นที่มีหมายเหตุ

| แถว (tier) | Source | รอบของ Change Loop | ค่ากลาง CL | ค่ากลาง NH | ×NH | เทียบ v3.6.5 |
|---|---|---|---|---|---|---|
| config-flag (rapid) | `0660d1329` | 111.9 / 76.0 / **284.3 (ล้ม 9/11)** | 111.9 | 52.1 | 2.15 | +37% |
| config-flag (rapid) | `3fdea70b6` | 102.1 / 111.1 / 94.6 | 102.1 | 54.7 | 1.87 | +25% |
| library-cli-flag (rapid) | `3fdea70b6` | 49.9 / 66.2 / 59.5 | 59.5 | 36.0 | 1.65 | +44% |
| regression-fix-with-fixes (rapid) | `3fdea70b6` | 109.6 / 106.9 / 136.0 | 109.6 | 27.8 | 3.94 | +39% |
| regression-fix-with-fixes (rapid) | `0131bc704` | 57.0 / 70.5 / 85.1 | **70.5** | 31.6 | 2.23 | **−11%** |
| tiny-feature (rapid) | `3fdea70b6` | 100.8 / 63.0 / 68.0 | 68.0 | 32.9 | 2.07 | +4% |
| refactor-no-reproduction (standard) | `3fdea70b6` | 69.5 / 111.7 / 70.2 | 70.2 | 47.4 | 1.48 | +69% |

ผลของ `time-gate.mjs` ใช้ `3fdea70b6` คู่กับ `0131bc704` สำหรับแถว regression-fix-with-fixes

| Tier | แถวที่จับคู่ได้ | ค่ากลาง CL | ค่ากลาง NH | อัตราส่วน | เป้า | ผล |
|---|---|---|---|---|---|---|
| Rapid | 4 | 69.3 s | 34.5 s | **2.01×** | 1.5× | ไม่ผ่าน |
| Standard | 1 | 70.2 s | 47.4 s | 1.48× | 1.8× | ผ่าน |

ค่าอ้างอิงของ v3.6.5 สำหรับ library-cli-flag (41.3 s) และ refactor-no-reproduction (41.5 s)
มาจากการรันรอบเดียวที่เร็วผิดปกติ ส่วน v3.6.4 ใช้ 56.8 s และ 82.3 s ในแถวเดียวกัน

## ข้อค้นพบ

1. **E ตัดส่วนที่เสียเวลาโดยไม่จำเป็นมากที่สุดใน portfolio นี้ออกได้**
   - บน `3fdea70b6` ทุก run ของ regression-fix ต้องผ่าน repair `cannot find canonical requirement` 1–3 รอบ
     เพราะ draft ประกาศ `operation: "modified"` และใช้ key อย่าง `loyalty-tiers` แต่ข้อความ repair
     ไม่ได้บอกว่ามีชื่อไหนให้เลือก
   - บน `0131bc704` ไม่มี run ไหนต้องผ่าน repair นี้เลย ค่ากลางลดจาก 109.6 s เหลือ 70.5 s
     และจำนวน request ลดจาก 17–22 เหลือ 12–16
2. **A และ B ลดรอบการ repair ได้ในกรณีที่เข้าเงื่อนไข** library-cli-flag ลดจาก 15 request (n=1) เหลือ 7–10
   และไม่มี repair placeholder ที่ผิดพลาดอีก
3. **ที่ `config-flag` ล้มเพราะ bug ในโค้ดที่ review ให้ผ่าน**
   - บน `0660d1329` รอบที่ 3 ไปถึง `proven` และ delta review ของ configured model (Opus) ก็ให้ผ่าน
   - hidden oracle จับได้ก่อน Land ว่า `CASE_DEFAULT` กับ `CASE_ENV_BEATS_FILE` ล้ม
   - 6 run ถัดมาผ่าน 11/11 ทุก run
4. **C4 ไม่ได้ทำงานตอน Prove และถูกถอดออกแล้ว**
   - ตอน Prove แถว `input-domain` มี `independence-waived-self-review` ติดมาด้วย กฎที่ให้ใช้ fast model จึงไม่ match
   - หลังเจอข้อ 3 maintainer เลือกใช้ model ระดับ standard ต่อไป แทนการลดความเข้มของ review
5. **overhead ที่เหลือของ rapid มาจากโครงสร้างของ lifecycle ไม่ได้มาจาก bug เฉพาะจุด**
   - การเขียน draft การอ่าน template และการเรียก start/advance ไปมา ยังเพิ่มเวลาราว 30–35 s ต่อแถว rapid
   - แถว `input-domain` ยังเสียเวลาเพิ่มจาก review ระดับ medium

## Run ที่เก็บไว้

```text
~/.local/share/changeloop/benchmarks/2026-10-19-repeat-rapid-0660d1329-3fdea70b6.tar.gz
sha256 bf639441b950ebc66f9cbc840a03218c8036035006418b17ca550abf77a87723
~/.local/share/changeloop/benchmarks/2026-10-19-repeat-regression-fix-0131bc704.tar.gz
sha256 391315d26f6a47da7b65f467c085347b129f8a07fc252a24ca94ea7fec10d514
```

ขั้นต่อไป: การลดโครงสร้างของ tier rapid ต่อ เช่น ให้ฟิลด์ของงาน rapid เป็น optional หรือรวม
`dev.md` กับ `change.md` ให้อ่านครั้งเดียว เป็นการตัดสินใจด้าน product สำหรับ release ถัดไป
และถ้าแถวไหนเปลี่ยน ต้องรันซ้ำก่อนจะอ้างเรื่องความเร็ว
