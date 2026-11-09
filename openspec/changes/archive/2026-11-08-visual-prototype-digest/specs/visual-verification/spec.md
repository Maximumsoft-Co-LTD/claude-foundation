# visual-verification

## ADDED Requirements

### Requirement: visual-binding-fail-closed

ระบบ SHALL คงการตรวจ visual และรายงาน error เมื่อสำเนา prototype ใน packet ไม่ตรงกับ digest ที่ผูกไว้

- error ระบุไฟล์ digest ที่ผูกไว้ และทางกู้คืน: คืนสำเนาจาก binding.source หรือ change revise ก่อน Build
- ไม่เรียก reviewer เมื่อสำเนาหรือ binding ไม่ถูกต้อง

#### Scenario: สำเนา strict ถูกแก้

- **GIVEN** binding โหมด strict และไฟล์ใน openspec/changes/<id>/prototype/ ถูกแก้หลัง compile
- **WHEN** Prove อ่าน contract และรัน provider visual
- **THEN** claim ที่ผูกไว้ยังต้องการ visual และ receipt visual เป็น error ที่ระบุว่าสำเนาไม่ตรง digest
- **AND** reviewer ไม่ถูกเรียก

#### Scenario: สำเนา strict หายไป

- **GIVEN** binding โหมด strict และไฟล์สำเนาถูกลบ
- **WHEN** Prove รัน
- **THEN** claim ที่ผูกไว้ยังต้องการ visual และ receipt visual เป็น error ที่ระบุว่าไม่พบสำเนา

#### Scenario: สำเนา advisory ถูกแก้

- **GIVEN** binding โหมด advisory และสำเนาถูกแก้
- **WHEN** Prove รัน
- **THEN** provider visual แบบ advisory ยังถูกรันและรายงาน error ว่าสำเนาไม่ตรง โดย visual ไม่เป็น required

#### Scenario: สำเนาตรง digest

- **GIVEN** binding โหมด strict และสำเนาตรง digest
- **WHEN** Prove รัน
- **THEN** พฤติกรรมเหมือนเดิม: reviewer ถูกเรียกและผลขึ้นกับการเทียบภาพ

#### Scenario: binding.json เสียหรืออ่านไม่ได้

- **GIVEN** packet มี prototype/binding.json ที่ parse ไม่ได้หรือ version ไม่รองรับ
- **WHEN** Prove อ่าน contract และรัน provider visual
- **THEN** ทุก claim ของ change ต้องการ visual และ receipt visual เป็น error ที่ระบุว่า binding อ่านไม่ได้
- **AND** reviewer ไม่ถูกเรียก

#### Scenario: binding ไม่มี digest

- **GIVEN** binding โหมด strict ไม่มี sha256 หรือ sha256 ไม่ใช่ค่า hex 64 ตัว
- **WHEN** Prove รัน provider visual
- **THEN** claim ที่ผูกไว้ยังต้องการ visual และ receipt visual เป็น error ที่ระบุว่า binding ไม่มี digest
- **AND** reviewer ไม่ถูกเรียก
