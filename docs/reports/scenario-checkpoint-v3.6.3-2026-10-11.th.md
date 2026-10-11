# Scenario checkpoint ของ candidate v3.6.3 (2026-10-11)

[English](scenario-checkpoint-v3.6.3-2026-10-11.md)

**ยังเผยแพร่ไม่ได้** ผ่าน strict delivery 9/10 scenarios ส่วน tracker ผ่าน
oracle 32/33 แต่ไม่ผ่าน `CASE_TESTS_EXIST` จึงค้างที่ `proven` ไม่ได้ Land
และไม่มีผล quality หรือ clean install รอบนี้ไม่ยืนยัน production assurance
หรือความเร็วที่ดีขึ้นอย่างเสถียร

## Source และขอบเขตการรัน

- เป้าหมาย release คือ v3.6.3 ทดสอบจาก preparation commit ที่สะอาด
  `9f561b67ac5273e0712fd7537e5fcaf2146d441a` โดย VERSION ที่ติดตั้งยังเป็น
  3.6.2 จนกว่า publication workflow จะปรับเวอร์ชัน
- รัน paid scenarios สิบงาน งานละหนึ่งครั้ง และ retry เฉพาะ tiny-feature
  อีกหนึ่งครั้ง เก็บทั้งสิบเอ็ด attempts ผ่านการตรวจ SHA-256 integrity
  และรักษา source กับ frozen seed digests
- ขอและตรวจพบโมเดลจริงจาก stream เป็น `claude-sonnet-5-5` ทุกงาน
  ใช้ Claude Code 2.1.296, Node v26.3.0 และ macOS 26.7 arm64
  พร้อม canonical macOS temporary paths
- ผู้ใช้อนุมัติเพดานรวม US$105 ใช้เพดานแต่ละ scenario ตาม matrix
  concurrency สูงสุดสี่งาน โดย paid sentinel ผ่านก่อนเริ่มอีกเก้างาน
- Instrumentation เฉพาะการทดลอง pin โมเดลและหักค่า session ก่อนหน้า
  ออกจาก allowance ก่อน oracle-repair continuation ถ้าค่าเดิมไม่ทราบจะหยุด
  ไม่เปลี่ยน shipped runtime, fixture หรือ oracle ส่วน retry ของ tiny-feature
  ระบุอนุมัติ spec/Build ภายใน fixture ที่ได้รับอำนาจทดสอบแล้วให้ชัด
  และใช้วงเงินที่เหลือจากงานเดิม

## ผลและข้อมูล stable เดิม

แต่ละช่องคือ host seconds / ค่า main-host ที่วัดได้ / oracle score
ใช้ selected attempt โดยเก็บ tiny-feature ครั้งแรกไว้ด้านล่าง ค่า stable มาจาก
[cohort v3.6.2 ที่เก็บไว้](scenario-benchmark-v3.6.0-v3.6.2-2026-10-08.th.md)
source `50ad2ce4d5ceccb8bee0c1b8c44d5387617fadec`

| Scenario | Candidate ปัจจุบัน | v3.6.2 ในอดีต | Terminal ปัจจุบัน |
|---|---|---|---|
| bare-node-boundary | 50.6 / $0.3409 / 6/6 | 59.9 / $0.3589 / 6/6 | archived |
| typescript-react-state | 42.5 / $0.3197 / 6/6 | 60.9 / $0.4045 / 6/6 | archived |
| python-api-validation | 39.5 / $0.3145 / 5/5 | 47.4 / $0.3502 / 5/5 | archived |
| database-migration-rollback | 80.8 / $0.3237 / 6/6 | 87.6 / $0.3510 / 6/6 | archived |
| refactor-no-reproduction | 45.3 / $0.3197 / 6/6 | 63.4 / $0.4122 / 6/6 | archived |
| multi-service-event-flow | 96.7 / $0.3543 / 6/6 | 118.0 / $0.4251 / 6/6 | archived |
| tiny-feature | 33.7 / $0.2893 / 8/8 | 57.4 / $0.3256 / 8/8 | archived |
| notes-api | 135.2 / $0.5003 / 13/13 | 228.7 / $0.4842 / 13/13 | archived |
| cart-coupons | 103.7 / $0.5047 / 11/11 | 124.8 / $0.5800 / 11/11 | archived |
| project-tracker-api | 390.0 / $1.1146 / 32/33 | 269.6 / $0.9505 / 32/33 | proven; failed |

Selected attempts ที่ผ่านทั้งเก้างานถึง `archived` ผ่าน hidden oracle ก่อน Land,
measured quality, project command, clean install และ project command หลังติดตั้ง
ส่วน tracker มีสิบเอ็ด tests ที่ผ่าน แต่เกณฑ์ adequacy ต้องมีอย่างน้อยสิบห้า tests
ที่ผ่านและปฏิเสธ seed เดิมได้ ไม่มีการลดเกณฑ์ oracle

รอบ stable ใช้ Claude Code 2.1.294, concurrency แปดงาน และ US$2 ต่อ scenario
รอบนี้มี allowance, concurrency และ host version ต่างกัน รันคนละเวลาและ n=1
โดยไม่มี spread จึงไม่ใช่การเทียบ performance ด้วยงบที่ตรงกัน ตารางแสดงผลของงาน
ในอดีตประกอบบริบทเท่านั้น ไม่อ้างว่าความเร็วหรือต้นทุนรวมดีขึ้น

## Findings และ selective repair

1. Tiny-feature ครั้งแรกหยุดรออนุมัติ spec ก่อน Build ใช้ 35.4 host seconds,
   US$0.2247395 และแปด model requests ไม่มีผล oracle หรือ quality
   prompt ทดสอบไม่ได้ระบุอนุมัติ spec ให้ชัด เมื่อ retry ด้วย fixture authority
   ที่ชัดเจนแล้ว ผ่าน oracle 8/8, archived และ clean install โดยหักค่า attempt
   แรกออกจาก allowance เดิม เก็บหลักฐานครบทั้งสองครั้ง
2. Tracker พบ `CASE_TESTS_EXIST` เช่นเดียวกับ stable cohort มีสิบเอ็ด tests
   ที่ผ่านแต่ยังไม่ถึงเกณฑ์ hidden adequacy การ oracle-repair continuation
   ไม่ได้รับ repair tasks ไม่แก้ไฟล์ และกล่าวว่า failure หายแล้ว แต่ oracle
   รอบถัดไปยังได้ 32/33 จึงไม่ใช้คำกล่าวนั้นเป็นหลักฐาน ต้องแก้การเปิด task
   เพื่อ repair/continuation และความเพียงพอของ tests ก่อน checkpoint ใหม่
3. Scorecard ของ runner ที่รวมหลาย sessions ใช้ cost จาก result envelope
   สุดท้ายของ tracker เพียง US$0.1386859 ไม่รวม session แรก US$0.975896
   audit ที่เก็บไว้รวมทั้งสอง envelopes ได้ US$1.1145819 สำหรับ tracker
   และ **US$4.6064739 สำหรับสิบเอ็ด attempts** โดยไม่มี host-cost result ที่หาย
   ตัวเลขเป็น main-host CLI cost ที่วัดได้ ไม่ใช่ใบแจ้งยอดบัญชี และไม่ได้วัด
   provider/reviewer ที่คิดค่าใช้จ่ายแยกต่างหาก

## การเก็บหลักฐานและงานถัดไป

เก็บ raw bundles, instrumentation, budgets, progress, summaries และ integrity
indexes นอก Git และนอก disposable state:

```text
~/.local/share/changeloop/benchmarks/2026-10-11-v3.6.3-candidate-1791733256467270000.tar.gz
SHA256 be81a9169cfc8af72c1bb1ac0f67be0856829083a54094d5640846a9c1a87ee4
```

Working copy ที่ ignored คือ
`.foundation/test-results/benchmark/v3.6.3-20261011/` โดย `summary.json`
บันทึกทุก attempts และ `retention.json` ระบุ archive ตรวจ checksum และ
`integrity.json` แต่ละ run ก่อนนำกลับมาใช้ Local audit archives ก่อนหน้านี้
ถูกแทนด้วย archive ที่รวม session costs ข้างต้น

Checkpoint ตาม [RELEASING.md](../../RELEASING.md) ยังไม่ผ่าน ห้ามเผยแพร่
v3.6.3 หรือใช้ผลนี้กับ product source ที่เปลี่ยนไป ต้องแก้ tracker continuation,
test adequacy และการรวม session costs ผ่าน scoped product change ใหม่
แล้วเก็บหลักฐาน candidate ใหม่พร้อมรักษาผลที่ไม่ผ่านเดิม Disposable consumer
ถูกลบหลังเก็บ evidence แล้ว จึงไม่มี consumer เดิมที่ยังเปิดเพื่อ resume
