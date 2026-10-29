# land

## ADDED Requirements

### Requirement: replay-carries-landed

ระบบ SHALL ถือว่าไฟล์ที่ sandbox sync ของ harness merge งานที่ land แล้วเข้า sandbox ได้สะอาด และ target ไม่เปลี่ยนตั้งแต่ sync นั้น เป็นไฟล์ที่ carry งานที่ land แล้ว ทั้งใน root workspace และ repository sandbox และการปฏิเสธเพราะ conflict ที่ยังไม่ resolve SHALL ส่ง route resolve กลับไปด้วย

#### Scenario: clean replay ใน repository sandbox

- **GIVEN** A land แล้วใน repository backend และ sandbox ของ B ถูก sync merge ได้สะอาด (landedReplay ตรงกับ bytes ของ sandbox และ landedSynced.target ตรงกับ target)
- **WHEN** Land preflight ของ B ตรวจ repository backend
- **THEN** ไม่มี RepositoryDeliveryError และ apply ผ่าน
- **AND** ไฟล์หลัง Land เป็น bytes ของ sandbox ที่มีงานของ A รวมอยู่

#### Scenario: clean replay ใน root workspace

- **GIVEN** alpha และ bravo แก้บรรทัดที่ 3 และ 5 ของ src/shared.txt และ bravo archived ก่อน
- **WHEN** advance alpha --through archived
- **THEN** alpha ถึง archived ผ่าน landed-change-sync ของ harness โดยไม่ขอ agent reconcile
- **AND** ไม่มีบรรทัดหายหรือซ้ำ

#### Scenario: target เปลี่ยนหลัง sync

- **GIVEN** sync merge สะอาดแล้ว แต่ target ถูกแก้อีกครั้งหลังจากนั้น
- **WHEN** Land preflight
- **THEN** ยังปฏิเสธด้วย overwrite และเสนอ sync อีกครั้ง (landedSync) เพราะ bytes ไม่ตรงกับที่ sync เห็น

#### Scenario: sync รายงาน conflict ที่ยังไม่ resolve

- **GIVEN** landedConflicts มี path นั้นและไม่มี landedResolved
- **WHEN** Land preflight
- **THEN** ปฏิเสธโดย error ระบุ landedConflict และ path และ advance ส่ง REPAIR_SYNC_CONFLICT พร้อม path แทนข้อความ overwrite เปล่า

### Requirement: proof-agrees-with-lifecycle

ระบบ SHALL ลบ proof-advance checkpoint เมื่อ sandbox sync ทำให้ proof invalid เพื่อให้ advance ไม่ตอบว่า proof current ขณะที่ lifecycle กลับเป็น building

#### Scenario: sync ที่ invalidate ลบ checkpoint

- **GIVEN** มี proof.json และ proof-advance.json ที่ PASS ที่ workspace hash ปัจจุบัน และ sync ทำให้ proof invalid
- **WHEN** sandbox sync
- **THEN** proof-advance.json ถูกลบพร้อม proof.json และ lifecycle เป็น building
- **AND** advance ถัดไปรัน proof ใหม่แทนตอบ proof current

#### Scenario: sync ที่ไม่ invalidate คง checkpoint

- **GIVEN** sync ไม่เปลี่ยน packet หรือ workspace ที่ proof ผูกอยู่
- **WHEN** sandbox sync
- **THEN** proof-advance.json ยังอยู่

#### Scenario: cursor ว่างและ lifecycle building

- **GIVEN** ไม่มี proof-advance cursor และ state.status เป็น building
- **WHEN** coordinator ประเมิน advance --through proven
- **THEN** ไม่ตอบ ASK_USER land-authority

#### Scenario: lifecycle proven และ cursor ตรง

- **GIVEN** state.status proven และ cursor PASS ที่ hash ปัจจุบัน
- **WHEN** advance --through proven
- **THEN** ASK_USER land-authority เหมือนเดิม
