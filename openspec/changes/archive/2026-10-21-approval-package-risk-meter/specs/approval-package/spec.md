# approval-package

## ADDED Requirements

### Requirement: risk-meter

หน้า package SHALL แสดงระดับความเสี่ยงเป็นแถบ 4 ระดับพร้อมคำกำกับ และเหตุผลของระดับนั้นเป็นรายการสั้น

#### Scenario: ระดับสูงสุด

- **GIVEN** route ได้ระดับ Critical พร้อมเหตุผล
- **WHEN** เรนเดอร์หน้า package
- **THEN** แถบเต็ม 4 ช่อง คำว่าวิกฤตถูกเน้น และเหตุผลแต่ละข้อเป็นรายการแยก

#### Scenario: ระดับต่ำ

- **GIVEN** route ได้ระดับ Low
- **WHEN** เรนเดอร์หน้า package
- **THEN** แถบเต็ม 1 ช่อง และบอกระดับเป็นคำและสัญลักษณ์ ไม่ใช้สีอย่างเดียว

#### Scenario: ไม่มีเหตุผล

- **GIVEN** route ไม่มีเหตุผลของระดับ
- **WHEN** เรนเดอร์หน้า package
- **THEN** แสดงแถบและคำกำกับโดยไม่แสดงรายการเหตุผลว่าง

### Requirement: before-after-and-questions

หน้า package SHALL แสดงก่อน-หลังเป็นการ์ดคู่ และแสดงตัวข้อความของคำถามที่ค้างอยู่ในกล่องเด่นเหนือแถบตัดสินใจ

#### Scenario: มีคำถามค้าง

- **GIVEN** draft มี openQuestions 1 ข้อ
- **WHEN** เรนเดอร์หน้า package
- **THEN** กล่องคำถามแสดงข้อความของคำถามนั้นและจำนวนในหัวกล่อง

#### Scenario: ไม่มีคำถามค้าง

- **GIVEN** draft ระบุ openQuestions เป็นรายการว่าง
- **WHEN** เรนเดอร์หน้า package
- **THEN** ไม่แสดงกล่องคำถาม

#### Scenario: คำถามเป็นข้อความอันตราย

- **GIVEN** ข้อความคำถามมีเครื่องหมาย HTML
- **WHEN** เรนเดอร์หน้า package
- **THEN** ข้อความถูก escape และแสดงเป็นตัวอักษร

#### Scenario: ไม่มีสรุปก่อน-หลัง

- **GIVEN** scratch ไม่มี asIs และ toBe
- **WHEN** เรนเดอร์หน้า package
- **THEN** ไม่แสดงการ์ดก่อน-หลังที่ว่าง และคำเตือนเรื่องสรุปที่ขาดยังแสดง

### Requirement: failure-cards

หน้า package SHALL แสดงกรณีพลาดจาก scenario ชนิด failure เป็นการ์ดที่มีสาเหตุ ผลที่เห็น และวิธีกู้คืน

#### Scenario: มี failure scenario

- **GIVEN** requirements มี failure scenario 2 ข้อที่มี when then recovery
- **WHEN** เรนเดอร์หน้า package
- **THEN** แสดงการ์ด 2 ใบ ใบละหนึ่ง scenario โดยมีสาเหตุ ผลที่เห็น และวิธีกู้คืน

#### Scenario: ไม่มี recovery

- **GIVEN** failure scenario ไม่มี recovery
- **WHEN** เรนเดอร์การ์ด
- **THEN** ไม่แสดงช่องวิธีกู้คืนที่ว่าง

#### Scenario: ไม่มี failure scenario

- **GIVEN** requirements ไม่มี failure scenario
- **WHEN** เรนเดอร์หน้า package
- **THEN** ไม่แสดงส่วนกรณีพลาด และแถบขอบเขตแสดงจำนวนตามจริง

### Requirement: mobile-decision-bar

หน้า package SHALL แสดงแถบตัดสินใจเป็นแถบปกติท้ายหน้าที่ความกว้าง 640px หรือน้อยกว่า และคงแถบติดขอบล่างที่กว้างกว่านั้น

#### Scenario: มือถือ

- **WHEN** เรนเดอร์หน้า package
- **THEN** CSS มี media query ที่ 640px ซึ่งตั้งแถบตัดสินใจเป็น position static

#### Scenario: ไม่มี script

- **WHEN** เรนเดอร์หน้า package ที่ไม่มี diagram
- **THEN** ไม่มี script form button หรือ event handler ในหน้า

### Requirement: type-cards

หน้า package SHALL จับ work type ที่ draft ประกาศหรืออนุมานเป็นแบบ A ถึง G และแสดงการ์ดของแต่ละแบบที่ตรงกันพร้อมข้อมูลเฉพาะชนิดจาก draft

#### Scenario: แบบข้อมูล

- **GIVEN** workType เป็น migration และ draft มี migrationPlan กับ rollout
- **WHEN** เรนเดอร์หน้า package
- **THEN** แสดงการ์ดแบบ E ที่มี จาก ถึง cutover rollbackWindow และ rollback ของ rollout

#### Scenario: หลายชนิด

- **GIVEN** workType เป็น feature และ api และ data
- **WHEN** เรนเดอร์หน้า package
- **THEN** แสดงการ์ดแบบ E ก่อน แบบ D และแบบ A ตามลำดับคงที่ ไม่แสดงซ้ำ

#### Scenario: ชนิดงานเบา

- **GIVEN** workType เป็น docs
- **WHEN** เรนเดอร์หน้า package
- **THEN** แสดงการ์ดแบบ C ที่มีแต่สรุป และไม่แสดงรายการตรวจของส่วนที่ไม่บังคับ

#### Scenario: ข้อมูลเฉพาะชนิดหาย

- **GIVEN** workType เป็น privacy แต่ draft ไม่มี privacyAssessment
- **WHEN** เรนเดอร์หน้า package
- **THEN** การ์ดแบบ G แสดง ไม่ทราบ ที่ช่องที่ขาดและไม่ใส่ค่าที่เดาเอง

### Requirement: required-checklist

หน้า package SHALL แสดงรายการตรวจของส่วนที่บังคับตาม requiredDevSections เป็น ✓ หรือ ✕ ต่อส่วน และแยกส่วนแนะนำที่ยังไม่บังคับด้วยป้ายต่างหาก

#### Scenario: ส่วนบังคับครบ

- **GIVEN** bugfix มี reproduction rootCause regression
- **WHEN** เรนเดอร์รายการตรวจ
- **THEN** ทุกส่วนบังคับเป็น ✓

#### Scenario: ส่วนบังคับขาด

- **GIVEN** bugfix ไม่มี regression
- **WHEN** เรนเดอร์รายการตรวจ
- **THEN** ส่วน bugfix เป็น ✕ และระบุว่าขาดอะไร

#### Scenario: ส่วนแนะนำ

- **GIVEN** ml draft ไม่มี evaluation
- **WHEN** เรนเดอร์รายการตรวจ
- **THEN** evaluation แสดงด้วยป้าย แนะนำ ไม่ใช่ ✕ และไม่เปลี่ยนผลการ validate ของ draft

#### Scenario: ไม่มีส่วนบังคับ

- **GIVEN** draft ไม่ประกาศ workType และอนุมานไม่ได้
- **WHEN** เรนเดอร์หน้า package
- **THEN** ไม่แสดงรายการตรวจ

### Requirement: scratch-undo-who

draft SHALL รับ scratch.undo และ scratch.who เป็นฟิลด์เสริมหนึ่งบรรทัด และการ์ดแสดงสองบรรทัดนี้โดยไม่ทำให้ draft เดิมตก

#### Scenario: ระบุครบ

- **GIVEN** scratch มี undo และ who
- **WHEN** เรนเดอร์หน้า package
- **THEN** การ์ดแสดงทั้งสองบรรทัดจากค่าที่ผู้เขียนระบุ

#### Scenario: ไม่ระบุ

- **GIVEN** draft เดิมไม่มี undo และ who
- **WHEN** start หรือ revise draft ระดับ medium ที่มี scratch 4 บรรทัดเดิม
- **THEN** ผ่านการตรวจเหมือนเดิม และการ์ดดึงค่าจาก rollout.rollback dataModel.rollback rollbackPin หรือ userStories.asA ถ้ามี ไม่เช่นนั้นแสดง ไม่ทราบ

#### Scenario: รูปแบบผิด

- **GIVEN** scratch.undo เป็นหลายบรรทัดหรือยาวเกิน 240 ตัวอักษร
- **WHEN** รัน change start
- **THEN** คืน EDIT ระบุ scratch.undo ตามกฎเดียวกับฟิลด์ scratch เดิม

### Requirement: thai-readable

หน้า package SHALL ใช้ฟอนต์ sans ที่มีอักษรไทยในเครื่องเรียงตามลำดับ Sukhumvit Set, Leelawadee UI, Noto Sans Thai, Thonburi, Tahoma ขนาดฐานอย่างน้อย 17px และไม่ใช้ฟอนต์ serif กับข้อความไทย

#### Scenario: stack ฟอนต์

- **WHEN** เรนเดอร์หน้า package
- **THEN** CSS ระบุ font-family ตามลำดับที่กำหนดและไม่มี @import url หรือ link ไปฟอนต์ภายนอก

#### Scenario: ไม่มีฟอนต์ไทยในเครื่อง

- **GIVEN** เครื่องไม่มีฟอนต์ไทยใดใน stack
- **WHEN** เปิดหน้า package
- **THEN** เบราว์เซอร์ใช้ฟอนต์ไทยสำรองของระบบและหน้ายังอ่านได้
