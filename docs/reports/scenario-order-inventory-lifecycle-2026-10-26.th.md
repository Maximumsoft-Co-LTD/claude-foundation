# Lane lifecycle ของ order-inventory: การรันจริงชุดแรก — 2026-10-26

**สถานะ:** หลักฐานจากการสังเกต การรันจริง 11 ครั้งแรกของ lane ใหม่ ไม่มีครั้งไหนผ่านแบบ strict
ยังไม่ใช่ smoke-green และไม่ใช่ repeated assurance ข้อค้นพบที่ 1 พิสูจน์สาเหตุได้ การแก้ carried-edit
และการแก้ replay/resolution ของ repository ภายหลัง (`281caac1b`) ผ่านเทสต์แบบ deterministic
และรันล่าสุดย้ายตัวบล็อกไปที่ข้อค้นพบที่ 6 (การระบุที่มาของ diff ใน review) ก่อนถึง Land
[English](scenario-order-inventory-lifecycle-2026-10-26.md)

## ขอบเขตและเงื่อนไข

| รายการ | ค่า |
|---|---|
| Source | `52c3e50c9` บวก bench tooling ที่ยังไม่ commit (`lifecycle.mjs`, ส่วนต่อ runner และ scorecard, seed/oracle/fixture ของ lane) |
| Lane | `order-inventory-lifecycle` (ดู [test plan](user-scenario-test-plan.md)) Claude Code เท่านั้น |
| การรัน | ก่อนแก้: รันเต็ม 4 ครั้ง (crash ทั้งใน Build และ Land) และ control 3 ครั้ง (crash เฉพาะ Build) หลังแก้: รันเต็ม 3 ครั้ง และอีก 1 ครั้งที่ถูกฆ่าตอนรีสตาร์ทเครื่องมือ |
| สิทธิ์ใช้งบ | เพดานผู้ใช้ US$300 เพดานต่อรัน US$60 |
| ต้นทุน | วัดได้ US$26.2 จาก 11 รันที่จบ session ที่ถูก SIGKILL ไม่มี envelope จึงไม่รู้ยอดรวมจริง มีแค่เพดานต่อ session และรันที่ถูกรีสตาร์ทฆ่าไม่ได้วัด |

## สิ่งที่ harness ทำได้

| พฤติกรรม | ที่สังเกตได้ |
|---|---|
| Resume change เดิมหลัง SIGKILL ใน Build | ได้ ทุกรันที่ไปถึง (7/7) ไม่สร้าง change ที่สอง |
| `change amend` หลัง crash | ได้ runtime state บันทึก amendment 1 รายการ และ change A ผ่าน oracle ชุด A 24/24 ใน 4 จาก 7 รัน |
| แตกกิ่ง change B ขณะ A อยู่ที่ proven และยังไม่ Land | ได้ (5 รันไปถึง) B ผ่าน oracle ชุด B 7/7 ใน 4 รัน |
| Resume Land ของ A หลัง SIGKILL เมื่อ repository หนึ่งลงแล้ว | ได้ จนถึง `archived` (4/4 รันเต็ม) crash จับได้ตอน `backend` ลงแล้วแต่ `sdk` และ `web` ยัง |

## ข้อค้นพบ (ยังเปิดอยู่)

1. **Land ของ B ถูกปฏิเสธหลัง A ลงแล้ว** ในทั้ง 4 รันเต็ม Land ของ B คืน
   `REPOSITORY_DELIVERY_FAILED: Land would overwrite an uncommitted target edit in 'backend': server.mjs`
   ทั้งที่ `WORKFLOW.md` (หัวข้อ stacked changes) ระบุว่า Land ทำได้เสมอและ replay edit ที่ลงแล้ว
   `sandbox sync` รายงานแค่ไฟล์ที่ fast-forward และ `backend/server.mjs` ใน sandbox ของ B
   ไม่มีโค้ดของ A agent ที่ถือสิทธิ์ Land รวมโค้ดของ A เข้า sandbox เอง (ตรงกับ target นอกส่วน paging)
   แต่ถูกปฏิเสธซ้ำ 8 ครั้ง **สาเหตุ (พิสูจน์แล้วโดยไม่ใช้โมเดลและไม่มี crash):**
   `assertChildTargetCompatible` ใน `repository-delivery-saga.mjs` ไม่เคยยกเว้น edit ใน target
   ที่ sandbox ของ repository ถืออยู่แล้ว ต่างจากฝั่ง root (`targetEditCarried`) ทุกการลงก่อนหน้า
   ที่ยังไม่ commit ใน path เดียวกันจึงถูกปฏิเสธ **การแก้:** ใช้การตรวจ carried แบบเดียวกันกับ
   repository ลูก พร้อมเทสต์ saga 3 ข้อ (carried ผ่าน; ไม่ carried และ edit ที่ต่างกันยังหยุดและเก็บ target ไว้)
   **ไม่พอในแบบ end-to-end:** ในรันเต็มถัดมา (Prove ผ่าน) Land ของ B ยังถูกปฏิเสธ sandbox มีโค้ดของ A
   ที่ Land แล้วครบ บวกอีก 68 บรรทัด และต่างจาก target แค่ 1 บรรทัด แต่การ merge edit ของ A
   (base→target) เข้าไปด้วย `git merge-file` ได้ 4 conflict (โค้ดของ B แทรกติดกับของ A) การตรวจ carried
   แบบเป๊ะจึงไม่ผ่าน ทั้งที่ merge แบบ `--ours` ไม่เปลี่ยนอะไร (ไม่มีอะไรที่ Land แล้วถูกทิ้ง)
   ฝั่ง root ยอมรับ merge ที่ agent ทำแบบนี้ผ่านการบันทึก conflict resolution (`landedResolved`,
   `resolutionKeepsLanded`) แต่ฝั่ง repository ไม่มี และ `sandbox sync` ไม่ replay edit ที่ Land แล้ว
   เข้า sandbox ของ repository (`replayLandedChanges` ครอบคลุมเฉพาะ root) agent จึง merge edit ที่ซ้อนกัน
   แล้ว Land ไม่ได้ใน change หลาย repository การยอมรับเพียงเพราะ `--ours` เท่ากันจะทำให้ sandbox เขียนทับ
   edit ของผู้ใช้ที่ชนกันได้ จึงต้องใช้ resolution ที่บันทึกไว้ ไม่ใช่การผ่อนเกณฑ์ เป็นงานระดับฟีเจอร์ ยังไม่ได้ทำ
2. **proposal ที่ archive ไม่มี Amendment history** ทั้งที่ runtime state บันทึก amendment ไว้ (4/4 packet ของ A)
3. **reviewer ของ Prove ค้างหลัง amendment** ใน 3 จาก 4 รันหลัง 4 รันแรก (0 จาก 4 รันแรก และรันล่าสุดผ่าน):
   review รอบสอง (delta closure) คืนผลที่ "do not bind to the dispatched workspace: delta closure must
   verify exactly: F1-…, F2-…" `advance` หยุดที่ no-progress boundary และ `authority reset-infra`
   ครั้งที่สองด้วย reference ของ waiver ถูกปฏิเสธว่าใช้ไปแล้ว ใน `configured-reviewer.mjs` ข้อความนี้เกิดเมื่อ
   `verifiedFindingIds` ของ reviewer ต่างจาก ID รอบแรก และถูกเก็บเป็น error แบบไม่ retry ไม่ใช่ review
   ที่ fail ดังนั้น reviewer ที่เห็นว่า finding ยังไม่ถูกปิดจึงไม่มีคำตอบที่ถูกต้อง ผลดิบของ reviewer
   ในรันที่ค้างไม่ได้เก็บไว้ (รันเดียวที่เก็บโปรเจกต์ไว้ผ่านพอดี) การอ่านนี้จึงยังไม่ยืนยัน
4. **session ซ่อมจาก oracle อาจไม่มีอะไรให้ทำ** เมื่อ target ของ Build ถึงแล้ว `advance --through build`
   ไม่คืน task และใน 3 session agent ไปค้นใน checkout หลักแทน sandbox เส้นทางนี้ใช้ร่วมกับ lane เดี่ยว
5. **B ถึง `proven` โดยไม่ต่อ route** หนึ่งครั้ง (oracle 0/7) ทั้งที่ test ที่ส่งมาผ่าน oracle จับได้

6. **หลังแก้ repository แล้ว B ไปถึง Prove แต่ review บล็อก (รัน 11, harness ที่ push `281caac1b`)**
   `sandbox sync` replay และ agent merge โค้ด SDK ของ A ที่ Land แล้วเข้า sandbox ของ B
   แต่ AI review ของ B ชี้ว่า v2 methods ที่ Land แล้วเหล่านั้นเป็นส่วนที่ B เพิ่มโดยไม่ได้ขอ และให้ลบออก
   ซึ่ง Land จะปฏิเสธ agent 3 session หยุดที่ทางตันนี้ B ค้างที่ `building` diff ที่ใช้ review
   เทียบกับ base ดังนั้น edit ที่ Land แล้วซึ่ง merge เข้าไฟล์ที่ทั้งสอง change แก้จึงถูกนับเป็นของ B
   ฝั่ง root ตัดไฟล์ที่ Land แล้วและ sandbox คัดลอกมาโดยไม่ถูกแก้ (`carriedLandedExcludes`)
   แต่ไม่มีของเทียบเท่าสำหรับไฟล์ที่ merge และ suite ฝั่ง root ไม่มี reviewer จึงไม่เคยเจอ ยังเปิดอยู่
   stacked Land เองก็ยังไม่เคยถูกทดสอบจนจบแบบ end-to-end

## บั๊กของ bench ที่พบและแก้แล้ว

session ที่ resume จบใน 0.25 วินาทีเมื่อโปรเจกต์มี 2 change (การหา change ก้ำกึ่ง) การนับงบทำให้ run หยุด
เมื่อ session ใดไม่มี envelope และ prompt เรื่อง merge ซ่อนคำตอบจริงของ harness ทุกข้อมีเทสต์ครอบใน
`openspec-native-lifecycle.test.mjs`

## ข้อจำกัด

- 9 รัน host เดียว การตั้งค่าโมเดลเดียว ข้อ 2–5 เป็นจำนวนหลักเดียวและอาจเป็นความผันผวนของ agent
- lane นี้ยังไม่มี strict pass จากการรันจริง ข้อมูลนี้ยืนยันไม่ได้ว่า stacked Land ใช้งานได้หรือไม่ได้โดยทั่วไป
- หลักฐานดิบอยู่ใน `.claude/tests/bench/results/openspec-native-lab/`
  (`order-inventory-lifecycle-17930…` ถึง `…17936…`) ยังไม่ได้ทำ archive พร้อม checksum นอก Git
