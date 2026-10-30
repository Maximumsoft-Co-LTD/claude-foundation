# Smoke ของ candidate: `8913c2da9` เทียบแถวยุค v3.6.8 ที่เก็บไว้ และไม่มี harness — 2026-10-30

**สถานะ:** หลักฐาน smoke ที่สังเกตได้ n=1 ต่อช่อง แปด lane (เจ็ด gate เล็ก
และ lane lifecycle) รายงานแยกราย lane เจ็ด lane เป็น strict green ส่วน lane
lifecycle ถูกบันทึกเป็น gap ของ checkpoint หลังรันสามครั้งที่เก็บไว้ครบ นี่คือ
exception ที่ระบุชัดต่อ checkpoint ครบทุก paid lane ใน
[RELEASING.md](../../RELEASING.md) ไม่ใช่การรับรองแบบรันซ้ำ รายงานนี้ไม่บันทึก
การตัดสินใจออกเวอร์ชัน [English](scenario-smoke-candidate-8913c2da9-2026-10-30.md)

## ขอบเขตและเงื่อนไข

| รายการ | ค่า |
|---|---|
| Candidate | `8913c2da9f59817b958165e5662094af1d5f9284` (สะอาด) การแก้ความต่อเนื่องของ authority สี่รายการหลัง v3.6.8: approval ผูกกับเนื้อหาข้าม amendment และ bookkeeping, Land รับ replay ที่ landed แล้วด้วย identity bridge, session lease ที่ค้างถูก park แทนที่จะ deadlock, child-only Land archive packet ของ sandbox ที่ amend แล้ว รวมทั้ง allowlist สิทธิ์อ่านอย่างเดียวที่ ship ไป |
| แหล่งของ lifecycle run 3 | `6005e473e` = candidate บวกการแก้ bench อย่างเดียวหนึ่งรายการ (prompt ของ oracle-repair ให้สิทธิ์ AI review wave เพิ่มหนึ่งรอบ) ไม่มีไฟล์ที่ ship ต่างจาก candidate แต่ tree ตอนรัน `dirty` จากไฟล์ skill และ change ที่ session อื่นสร้างค้างไว้ run นี้จึงไม่ใช่ baseline ที่เปลี่ยนแปลงไม่ได้ |
| Previous | แถว Change Loop ที่เก็บไว้จาก `9e612cbb7` (2026-10-22 ก่อน tag `v3.6.8` `402a2eb7c` เจ็ด commit) ห้า lane ไม่ได้รันซ้ำวันนี้ lab และโมเดลเดียวกัน |
| ไม่มี harness | แถว `--arm baseline` ที่เก็บไว้จาก `0bd8c578e` (2026-10-15) และ `3eb57e95d` (2026-10-16): seed และ oracle เดียวกัน ไม่มี Change Loop ไม่ได้รันสลับกับวันนี้ |
| โมเดล | ค่าเริ่มต้นของ host `claude-sonnet-5-5` สำหรับ implementation reviewer ที่ตั้งค่าไว้ของ lane lifecycle รันเป็น `claude-opus` พร้อม waiver ด้านความเป็นอิสระและความหลากหลายของ lab |
| Lane | `tiny-feature`, `owner-only-delete`, `idempotent-refund`, `speed-up-search`, `regression-fix-with-fixes`, `security-hotfix`, `ml-eval-threshold`, `order-inventory-lifecycle` |
| จำนวนรอบ | หนึ่งรอบต่อ lane เล็ก lane lifecycle รันสามครั้ง เก็บไว้ทั้งสาม |
| สิทธิ์ใช้จ่าย | ผู้ใช้อนุมัติ smoke แปด lane พร้อมบันทึก exception หลัง matrix ขยายเป็น 29 paid lane ประเมิน US$10–20 ยอดที่วัดได้ US$11.68 ทั้งหมดมาจาก host result envelope |
| Gate แบบ deterministic | suite เต็มผ่านบน VM สำหรับ `8913c2da9` (bench timing flake หนึ่งตัว เป็นของ repository เท่านั้น) sentinel ไม่มีค่าใช้จ่ายผ่าน release preflight ผ่านพร้อม advisory `release-portfolio-not-ready` upgrade matrix ผ่าน |
| Host | Claude Code เท่านั้น |

เพดานต่อ run มาจาก matrix: US$5 สำหรับ `tiny-feature` US$3 สำหรับ lane เล็กอีกหก
และ US$60 สำหรับ lane lifecycle

## ผล: เจ็ด lane เล็ก

ทุกช่องถึง `archived` ผ่าน hidden oracle ครบ quality ที่วัดได้ไม่มี fail และ strict
delivery (project command, clean install, project command หลังติดตั้ง) ค่าใช้จ่ายเป็น
US$ เวลาเป็นวินาที

| Lane | Oracle | ค่าใช้จ่าย | เวลา | Requests | Tool calls |
|---|---|---|---|---|---|
| `tiny-feature` | 8/8 | 0.3987 | 64.5 | 10 | 14 |
| `owner-only-delete` | 9/9 | 0.4571 | 94.1 | 12 | 21 |
| `idempotent-refund` | 12/12 | 0.5978 | 235.3 | 14 | 28 |
| `speed-up-search` | 11/11 | 0.4650 | 74.3 | 13 | 20 |
| `regression-fix-with-fixes` | 10/10 | 0.4397 | 65.7 | 13 | 20 |
| `security-hotfix` | 9/9 | 0.4472 | 85.0 | 13 | 22 |
| `ml-eval-threshold` | 9/9 | 0.4472 | 67.7 | 10 | 22 |
| **รวม** | 68/68 | 3.2527 | 686.6 | 85 | 147 |

`idempotent-refund` มี quality warning หนึ่งรายการ (ไม่ใช่ fail) ไม่มี run ใดเจอ
`CONTRACT_DECISION_REQUIRED` การปฏิเสธ overwrite หรือ verdict จาก self-review
ซึ่งเป็นอาการ block ที่การแก้ของ candidate มุ่งแก้

### เทียบกับแถวยุค v3.6.8 ที่เก็บไว้ (ห้า lane)

| Arm | ค่าใช้จ่าย | เวลา | Requests | Tool calls |
|---|---|---|---|---|
| Candidate `8913c2da9` | 2.4068 | 554.4 | 65 | 111 |
| ที่เก็บไว้ `9e612cbb7` (2026-10-22) | 2.2885 | 628.5 | 72 | 114 |

Candidate เทียบกับที่เก็บไว้: ค่าใช้จ่าย +5.2% เวลา −11.8% requests −9.7% tool calls
−2.6% ด้วย n=1 และ batch ที่ไม่ได้สลับกัน นี่แสดงว่าไม่มี regression ไม่ใช่การวัดว่าเร็วขึ้น
ราย lane: `security-hotfix` 85.0 s เทียบ 141.0 s และ `speed-up-search` 74.3 s เทียบ
99.8 s เร็วขึ้น `idempotent-refund` 235.3 s เทียบ 224.7 s และ `owner-only-delete`
94.1 s เทียบ 95.3 s ใกล้เคียง `regression-fix-with-fixes` 65.7 s เทียบ 67.7 s ใกล้เคียง
`tiny-feature` และ `ml-eval-threshold` ไม่มีแถวที่เก็บไว้จาก commit นั้น

### เทียบกับไม่มี harness (เจ็ด lane)

| Arm | ค่าใช้จ่าย | เวลา | Requests |
|---|---|---|---|
| Candidate `8913c2da9` | 3.2527 | 686.6 | 85 |
| ไม่มี harness (ที่เก็บไว้ ใช้ค่าเฉลี่ยเมื่อมีสอง run) | 1.5986 | 326.6 | 51.5 |

อัตราส่วน 2.03× ค่าใช้จ่าย 2.10× เวลา 1.65× requests baseline ผ่าน oracle เท่ากัน
แต่ไม่มี review, evidence receipt, clean-install proof หรือ archive อัตราส่วนนี้คือราคา
ของสิ่งเหล่านั้น lane ที่สั้นที่สุดมีอัตราส่วนสูงสุด (`owner-only-delete` 3.8× เวลา)
เพราะค่าคงที่ของ harness เด่น

## ผล: `order-inventory-lifecycle` (สาม run เก็บไว้ทั้งหมด ไม่มี strict)

lane นี้ฉีด SIGKILL กลาง Build, amendment ของ requirement กลางทาง, hidden oracle
ก่อน Land ที่รายงานความล้มเหลวในฐานะผู้ใช้, change ที่สองซ้อนกัน และ SIGKILL กลาง Land
ทั้งสาม run resume change เดิมหลังถูก kill และบันทึก amendment ได้ จากนั้นแต่ละ run
หยุดที่การตัดสินใจซึ่ง harness สงวนไว้ให้ผู้ใช้ ซึ่ง lane แบบ headless ตอบไม่ได้ ไม่มี
run ใดวนลูป เสีย approval หรือคืน repair ที่ทำไม่ได้ ทุกการหยุดมีเส้นทาง resume ที่แน่นอน

| Run | แหล่ง | ค่าใช้จ่าย | เวลา | Requests | หยุดที่ไหน | Oracle |
|---|---|---|---|---|---|---|
| 1 | `8913c2da9` สะอาด | 1.3998 | 1906 | 64 | reviewer ของ Prove พบว่า spec ที่ agent เขียนเองบอกว่า stock ศูนย์ไม่ถูกต้อง ขณะที่เอกสาร fixture บอกว่าถูกต้อง agent แทนที่ requirement นั้นด้วย amendment ที่สอง `advance` ขอ spec approval ของ agreement ที่เปลี่ยนไป | A 20/27 ก่อน Land; B ไม่ได้เริ่ม |
| 2 | `8913c2da9` สะอาด | 3.3895 | 2085 | 113 | wave 1 (เต็ม) พบ blocker wave 2 (delta) ผ่าน จากนั้น oracle ของ lane รายงาน defect agent แก้ และการ re-prove ต้องใช้ wave ที่สาม `advance` คืน `review-exhausted` (2/2 tier high) | A 24/24 หลัง repair หนึ่งครั้ง; B 7/7; ไม่มีอะไร Land สุดท้าย 7/27 |
| 3 | `6005e473e` dirty | 3.6418 | 2603 | 124 | ใช้สิทธิ์หนึ่ง wave จาก prompt (`authority extend-review`) wave 3 พบสอง finding ที่การแก้ oracle ทำให้ regress (`R1-cancel-expired-regressed-to-200`, `R2-tenant-claim-ignored-regressed`) agent แก้แต่ไม่เหลือ wave หรือ critical case ที่ประกาศไว้เพื่อปิด `advance` คืน `review-route-exhausted` การขอสิทธิ์ซ้ำด้วย reference เดิมถูกปฏิเสธ | A 18/24 หลัง repair สามครั้ง; oracle สุดท้าย timeout |

ค่าใช้จ่าย lifecycle US$8.4311 run สีเขียวก่อนหน้าของ lane นี้ (`3f472ee5e` 27/27,
`04e516576` 26/27 เมื่อ 2026-10-29) ไม่ต้อง repair จาก oracle จึงไม่เคยถึง wave ที่สาม

หลักฐานนี้บอกและไม่บอกอะไร:

- การแก้ของ candidate ยังคงอยู่: ไม่เสีย authority ข้าม amendment ไม่มี lease
  deadlock ไม่มี `CONTRACT_DECISION_REQUIRED` และใน run 3 harness รับ wave ที่ผู้ใช้
  ให้สิทธิ์หนึ่งครั้งและปฏิเสธการใช้ซ้ำตามที่ contract ระบุ
- การหยุดคือพฤติกรรมตาม contract ที่ด่านของผู้ใช้ (approval ของ agreement ที่เปลี่ยน
  และ AI review ที่หมด) ส่วน change tier high ควรมี AI wave เริ่มต้นสองรอบหรือไม่เมื่อ
  เกิดทั้ง amendment และ defect ที่ผู้ใช้รายงาน เป็นคำถามนโยบายผลิตภัณฑ์ของผู้ดูแล
  บันทึกไว้เป็นประเด็นเปิด
- คุณภาพการแก้ของ agent เป็นตัวขับ run 1 และ 3 (scenario ที่ขัดกันเอง; regression
  ที่เกิดขณะแก้ oracle case) เป็นข้อสังเกตด้าน agent/โมเดล ไม่ใช่ finding ของ harness
- change 4 ของ candidate (archive packet ของ sandbox ที่ amend แล้วตอน child-only
  Land) มี deterministic test ครอบ แต่ยังไม่ถูกสังเกตใน paid lane:
  `amendment-in-archived-packet` เป็น `unavailable` ทั้งสาม run เพราะ change A ไม่เคย archive

## ข้อจำกัด

- แปดจาก 29 paid lane แถว portfolio tier standard (`notes-api`, `cart-coupons`,
  `project-tracker-api`, `order-inventory` และ gate สามดอลลาร์อีกสิบหกที่ไม่ได้ระบุข้างต้น)
  ไม่ได้รัน นี่คือ smoke ระดับ exception ไม่ใช่ checkpoint ครบทุก scenario
- arm ของ release ก่อนหน้าและไม่มี harness เป็นแถวที่เก็บไว้จากวันก่อน ไม่ได้รันสลับกัน
  n=1 ต่อช่อง ความต่างในทิศทางใดก็ตามไม่ใช่ผลที่คงที่
- lifecycle run 3 รันจาก tree ที่งานอื่นทำให้ dirty ไฟล์ที่ ship เท่ากับ candidate แต่
  run นี้เปิดเผยว่าไม่ใช่ baseline ที่เปลี่ยนแปลงไม่ได้
- self-review ใน lab ใช้แล้วทิ้งสำหรับ lane เล็ก หมายความว่าค่า review และความเป็น
  อิสระของโปรเจกต์จริงไม่ได้ถูกแทน
- Claude Code เท่านั้น

## หลักฐานดิบ

bundle ของ run ทั้งสิบ (scorecard, manifest, `integrity.json`, source patch, host
stream, ผล oracle และ quality, evidence tree ที่เก็บไว้) ถูก archive นอก Git และนอก
state ใช้แล้วทิ้ง:

```text
~/.local/share/changeloop/benchmarks/2026-10-30-candidate-8913c2da9-smoke.tar.gz
sha256 b9cbfc8557e6c6e48d180546def3075c44497db3eb32b725a2aabeeab3039937
```

archive มี 653 ไฟล์ รวม `integrity.json` ต่อ run สิบรายการที่ผูกเนื้อหา artifact ของ
แต่ละ run manifest ของแต่ละ run บันทึก source commit, flag `dirty` และ digest ของ seed
ที่ freeze ไว้

## ทำซ้ำ

```bash
# gate ไม่มีค่าใช้จ่ายก่อน
npm run bench:openspec-native:sentinel
# lane เล็กหนึ่งรายการ เพิ่ม --arm baseline สำหรับ arm ไม่มี harness
node .claude/tests/bench/openspec-native/lab.mjs --scenario owner-only-delete
# lane lifecycle
node .claude/tests/bench/openspec-native/lab.mjs --scenario order-inventory-lifecycle
```

run ที่มีค่าใช้จ่ายต้องมีสิทธิ์จากผู้ใช้อย่างชัดเจนและเพดานการใช้จ่าย
