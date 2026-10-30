# sandbox-apply

## MODIFIED Requirements

### Requirement: child-only-ledger

เมื่อ Land change แบบหลาย repository ที่ไม่มี root เป็น repository ที่เขียนได้ ระบบ SHALL นำ task ที่ติ๊กใน tasks.md ของ sandbox กลับเข้า tasks.md ของ packet ใน root ก่อน archive โดยไม่เปลี่ยนบรรทัดอื่นของ packet เว้นแต่ change มี amendment ที่ harness บันทึกไว้และ sandbox packet ตรงกับ amendment ล่าสุด ซึ่ง SHALL แทนที่ packet ใน root ด้วย sandbox packet ทั้งชุดก่อน archive

#### Scenario: ทุก task เสร็จ

- **GIVEN** change เลือกเฉพาะ repository ลูก และ Build ติ๊ก T001–T003 ใน tasks.md ของ sandbox
- **WHEN** Land apply ก่อน archive
- **THEN** tasks.md ใน root แสดง T001–T003 เป็น [x]

#### Scenario: บรรทัดอื่นไม่เปลี่ยน

- **GIVEN** tasks.md ใน root มีข้อความหรือ task ที่ sandbox ไม่ได้ติ๊ก และไม่มี amendment
- **WHEN** Land apply ก่อน archive
- **THEN** บรรทัดเหล่านั้นคงเดิมทุก byte และมีแค่ task ที่ sandbox ติ๊กที่เปลี่ยนเป็น [x]

#### Scenario: มี root

- **GIVEN** change เลือก root เป็น repository ที่เขียนได้
- **WHEN** Land apply
- **THEN** ระบบใช้ projection ของ root ตามเดิมและไม่ merge tasks.md ซ้ำ

#### Scenario: amendment ทำให้ packet ทั้งชุดถูกแทนที่

- **GIVEN** change เลือกเฉพาะ repository ลูก มี amendment ที่บันทึก identity ไว้ และ sandbox packet ตรงกับ identity นั้น (มี task ใหม่, requirement ที่แก้, spec delta, Appendix: Amendment history)
- **WHEN** Land apply ก่อน archive
- **THEN** packet ใน root เป็น byte เดียวกับ sandbox packet ทุกไฟล์ และไฟล์ที่ root มีแต่ sandbox ไม่มีถูกลบ
- **AND** archive ที่ตามมามี task ใหม่และ Amendment history
- **AND** specs ที่ archive merge มาจาก spec delta ที่ amend แล้ว

#### Scenario: sandbox packet ไม่ตรง amendment

- **GIVEN** มี amendment แต่ sandbox packet ถูกแก้มือหลังจากนั้น
- **WHEN** Land apply
- **THEN** ไม่แทนที่ root packet และ Land หยุดด้วย drift ตามกติกาเดิม
