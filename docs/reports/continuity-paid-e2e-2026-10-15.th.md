# ผล paid E2E และ Investigate หลาย session — 2026-10-15

[English](continuity-paid-e2e-2026-10-15.md)

Source สะอาด `6211780127a69c2166d61a24cf8eed8a3ce3f20e` ส่งมอบครบ 9/10
paid scenarios Tracker ยังติด `CASE_TESTS_EXIST` ที่ 32/33 และหยุดที่ `proven`
ไม่ได้ Land การคุย Investigate รุ่นใหม่รักษาประวัติแบบมีโครงสร้างได้ แต่กรณี
timeout ที่เพิ่มเพื่อตรวจอิสระไม่ผ่านกับ prototype ที่ agent สร้าง ผลนี้ไม่ใช่
release checkpoint ที่ผ่านครบ และไม่ได้ยืนยันว่าความหมายของ payment ปลอดภัยครบ

## ขอบเขตการรัน

ผู้ใช้อนุมัติงบรวม US$200 ใช้ matrix ceilings ของสิบโจทย์รวม US$105 และ
consumer สำหรับ Investigate ก่อน–หลังอย่างละ US$20 คุยฝั่งละ 8 user turns
ค่าโมเดลที่วัดได้: portfolio US$4.4735401, Investigate ก่อนแก้ US$6.0970157,
หลังแก้ US$6.1689378 รวม **US$16.7394936** รอบนี้ หรือ US$17.2587553
เมื่อรวม Notes API smoke ก่อนหน้า เป็นค่าใน CLI envelopes ไม่ใช่ยอด invoice
และไม่ได้ประมาณค่าให้ dimensions ที่วัดไม่ได้

ใช้ Claude Code 2.1.299, Node 26.3.0 ตรึง `claude-sonnet-5-5` และพบชื่อนี้ใน
streams รันพร้อมกันสูงสุด 4 hosts ก่อน paid dispatch sentinel ผ่าน 12/12
ไม่แก้ product source Delivery lab ใช้สิทธิ์ self-review และ backend Land
ตามข้อกำหนดของ consumer ชั่วคราว โดย oracle รันก่อน Land ส่วน research
ห้าม Build, Land, เขียน Git หรือเรียกบริการจ่ายเงินจริง

## Paid delivery สิบโจทย์

แต่ละช่องคือวินาทีของ host / ค่าโมเดล / oracle score ผลเก่าอ้างจาก
[v3.6.3 candidate](scenario-checkpoint-v3.6.3-2026-10-11.th.md) ไม่ได้รันรุ่นนั้นใหม่

| Scenario | v3.6.3 เดิม | Source ใหม่ | สถานะใหม่ |
|---|---|---|---|
| bare-node-boundary | 50.6 / $0.3409 / 6/6 | 51.8 / $0.3438 / 6/6 | archived |
| typescript-react-state | 42.5 / $0.3197 / 6/6 | 51.8 / $0.3435 / 6/6 | archived |
| python-api-validation | 39.5 / $0.3145 / 5/5 | 41.2 / $0.3373 / 5/5 | archived |
| database-migration-rollback | 80.8 / $0.3237 / 6/6 | 72.9 / $0.3463 / 6/6 | archived |
| refactor-no-reproduction | 45.3 / $0.3197 / 6/6 | 60.1 / $0.3616 / 6/6 | archived |
| multi-service-event-flow | 96.7 / $0.3543 / 6/6 | 95.2 / $0.3626 / 6/6 | archived |
| tiny-feature | 33.7 / $0.2893 / 8/8 | 92.9 / $0.3715 / 8/8 | archived |
| notes-api | 135.2 / $0.5003 / 13/13 | 163.8 / $0.4604 / 13/13 | archived |
| cart-coupons | 103.7 / $0.5047 / 11/11 | 140.6 / $0.5978 / 11/11 | archived |
| project-tracker-api | 390.0 / $1.1146 / 32/33 | 337.5 / $0.9487 / 32/33 | proven; ไม่ผ่าน |

เก้าโจทย์ที่ผ่านมี quality, project command, clean install และ tests หลังติดตั้ง
ผ่านครบ ไม่มี task ค้าง Tracker มีสอง host envelopes รวม US$0.9486703
หลัง oracle ไม่ผ่านจึงไม่มีผล quality/clean install ไม่ได้นับเป็น pass หรือ zero
การ repair continuation ยังไม่แก้ test-adequacy failure ไม่ลดเกณฑ์ oracle
ผลเดิมของ v3.6.0, v3.6.1, v3.6.2 และ v3.6.3 ก็ส่งมอบ 9/10 และติด Tracker
ข้อเดียวกัน จึงยังอ้างไม่ได้ว่ารุ่นใหม่แก้ปัญหานี้แล้ว

รันโจทย์ละหนึ่งครั้ง ต่าง host version และไม่ interleave รุ่นก่อน–หลัง
รอบนี้ยังมี research hosts รันร่วมด้วย ความต่างด้านเวลา รวมถึง tiny-feature
ที่ช้าลง เป็นผลที่สังเกตได้ ยังไม่พิสูจน์สาเหตุหรือ performance ที่คงที่

## Investigate ด้วย paid model หลาย session

Source ก่อนแก้คือ `d157286b9b32c4374fcb94accf7c1a430c04228d` ซึ่งอยู่ก่อน
implementation นี้ทันที หลังแก้ใช้ clean source ข้างต้น ทั้งสองฝั่งได้ seed
และข้อความผู้ใช้ 8 turns เดียวกัน: คำขอ retry ที่ยังไม่ชัด, คำตอบ policy,
การแก้ revision, เปิด session ใหม่ขอ Change, คำตอบเพิ่มเติม, ขอ Change อีกครั้ง,
เลือกแบบและกำหนด cross-key semantics ชัดเจน แล้วเปิด session ใหม่ขอ Change
สาม turns แรก resume chat เดียวกัน หลังจากนั้นเริ่ม chat ใหม่และอ่าน artifacts

| สิ่งที่ตรวจพบ | ก่อนแก้ | หลังแก้ |
|---|---|---|
| Product files ไม่เปลี่ยนระหว่าง research | ครบ 8 snapshots | ครบ 8 snapshots |
| ค่าโมเดล | $6.0970157 | $6.1689378 |
| รวม wall time ของแต่ละ turn | 1204.746 วินาที | 1151.667 วินาที |
| Model requests ที่พบ | 145 | 138 |
| Requirements/history | authored note และ context ใน design ที่ agent ดูแลเอง | typed revisions 16 รายการ: active 13, superseded 3 |
| ประวัติ PoC | note/selection addenda | experiments 4 รายการ: complete 2 และ planned ที่ superseded 2 |
| Native packet | Valid, 29 claims, รอ approval | Valid, 20 claims, รอ approval |
| จำนวนคำใน proposal | 1435 | 4307 |

Agent หลังแก้เก็บผล A/B/C เดิมไว้ และทดสอบใหม่เฉพาะแบบที่ถูกเลือกและกระทบ
จาก cross-key correction PoC ของ agent ผ่าน 15/15 ทั้งสอง packet เก็บ
constraints และข้อจำกัดที่วัดได้ ไม่ได้ Build แอปหรือ archive consumer เหล่านี้
รุ่นก่อนก็เก็บ history ด้วย note ได้ จึงไม่ได้ใช้การไม่มี v2 fields ตัดสินว่า
รุ่นเก่าลืมความหมายทั้งหมด การเปรียบเทียบหนึ่งรอบไม่ใช่ผล win-rate

**กรณีตรวจอิสระ:** จำลอง upstream ชาร์จสำเร็จแต่ response หายจนได้ timeout
แล้วส่ง payment id/revision เดิมด้วย key ใหม่ ใช้กรณีเดียวกันกับ prototypes
ทั้งสองฝั่ง ไม่มีการเรียก gateway จริง

| Prototype ที่ agent สร้าง | Status แรก | Status ครั้งที่สอง | จำนวนชาร์จใน simulation | เกณฑ์ความปลอดภัย |
|---|---:|---:|---:|---|
| ก่อนแก้ B4 | 504 | 409 | 1 | ผ่าน |
| หลังแก้ B2 | 504 | 201 | 2 | ไม่ผ่าน |

Spec หลังแก้ระบุชัดว่า sibling key ที่ timeout และยังไม่รู้ผลไม่ block key ใหม่
Investigation บอกว่าตอบ material questions ครบและ ready-for-change ทั้งที่
conclusion ยังบอกว่า unknown timeout outcome เปิดไว้ให้ Change ตัดสิน
Agent จึงถามความหมายสำคัญนี้ในขั้น spec approval โครงสร้าง coverage และ
packet ที่ valid ไม่ได้พิสูจน์ว่าความหมายตรงกับเป้าหมายไม่ชาร์จซ้ำ ไม่ได้อนุมัติ
spec นี้ ผลเป็น finding ของ design/handoff ที่สร้างในรอบเดียว ไม่ได้แปลว่า
ทุก run ของ harness ใหม่จะสร้างข้อผิดพลาดนี้

งานที่ยังต้องปรับ: เปลี่ยน counterexample ที่ยังไม่เคลียร์เป็น material question
ก่อน handoff; ทำ current intent ให้อ่านกระชับและโหลดประวัติเมื่อเกี่ยวข้อง;
เพิ่ม acceptance case ของ ambiguous timeout แบบอิสระ; แก้เส้นทาง oracle
ไปสู่ repair/test adequacy ของ Tracker ส่วนตำแหน่ง module ภายในควรเป็น
การตัดสินใจของ agent เว้นแต่เปลี่ยนพฤติกรรมที่ผู้ใช้เห็น

## ปัญหา infrastructure และหลักฐาน

Wrapper สิบครั้งแรกไม่ได้ dispatch โมเดล เพราะ `/tmp` กับ `/private/tmp`
ทำให้ entrypoint check ไม่ตรง แต่ lab กลับคืน `strictPass: true` ทั้งที่ stdout
ว่างและไม่มี scorecard เก็บรอบเหล่านี้เป็น **invalid/no-dispatch** ไม่รวมใน
สิบ paid results แก้ wrapper ให้ใช้ canonical path แล้วตรวจ dry-run host plan
ก่อนรันด้วย run IDs ใหม่ Lab ยังต้องเพิ่ม gate แบบ fail-closed ที่ตรวจ scorecard,
lifecycle และ oracle จริง ใช้ manifest boolean อย่างเดียวไม่ได้

PoC ของ research ช่วงแรกติด headless permission ของ `node` จึงยังเป็น planned
ไม่อ้างผลที่ไม่ได้รัน Continuation เพิ่มเฉพาะ `Bash(node .foundation/prototypes/*)`
ใน consumer ชั่วคราว พร้อมตอบ policy/selection ที่ขาด ทั้งสองฝั่งได้เหมือนกัน

ตรวจ checksum ผ่านครบ 381 indexed files ของสิบ delivery bundles และ 1361
indexed files ของสอง research bundles ลบ consumers ชั่วคราวหลังเก็บหลักฐานแล้ว
เก็บ streams,
session envelopes, source identities, oracle, install/quality checks, research
snapshots, compiled packets, validation output, fixtures และ helpers นอก Git:

```text
~/.local/share/changeloop/benchmarks/2026-10-15-continuity-paid-e2e.tar.gz
SHA256 dbe64d8d3e2def8f4abbb7e82bcaeac894b6c37c4086d973fdcea0e0f48ff66a

~/.local/share/changeloop/benchmarks/2026-10-15-continuity-semantic-counterexample.tar.gz
SHA256 b6369a5d3ccb6d0044e8d1a6aaa0f550accbe2c41e865fdf8714fcc99f4c8750
```

Bundle ที่สองเก็บ probe อิสระและผลจริง ใช้ prototypes ใน bundle แรก
[ผล deterministic 19 ข้อ](investigation-continuity-differential-2026-10-15.th.md)
ยังเป็นหลักฐานของ structural guards แต่ไม่ลบล้าง semantic failure ที่พบรอบนี้
ไม่ promote release หรือ production assurance
