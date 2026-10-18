# approval-lanes Specification

## Purpose
เมื่อเปิดใช้ การอนุมัติ spec แยกเป็น lane ตามบทบาทที่ router เลือก และ Build เริ่มได้เมื่อทุก lane ที่ต้องมีได้รับการอนุมัติ
## Requirements
### Requirement: approval-lanes

ระบบ SHALL ต้องได้อนุมัติครบทุก lane ที่ต้องมีก่อน Build เมื่อเปิด approval.roles

#### Scenario: ขาด lane

- **GIVEN** approval.roles มี tech-lead และ qa และอนุมัติแค่ tech-lead
- **WHEN** advance --through build
- **THEN** advance หยุดด้วย ASK_USER ที่ระบุ lane qa และไม่สร้าง sandbox

#### Scenario: ครบทุก lane

- **GIVEN** lane ที่ต้องมีอนุมัติครบ
- **WHEN** advance --through build
- **THEN** Build เริ่มได้

#### Scenario: บทบาทที่ router ไม่เลือก

- **GIVEN** approval.roles มี security แต่ routeChange() ไม่เลือก security
- **WHEN** advance --through build หลังอนุมัติ lane อื่นครบ
- **THEN** Build เริ่มได้โดยไม่ต้องมี security

### Requirement: approval-lane-record

ระบบ SHALL บันทึกการอนุมัติราย lane ตามบทบาทที่ผู้ใช้แจ้ง

#### Scenario: บันทึก lane

- **GIVEN** approval.roles มี qa
- **WHEN** advance --approve-spec --role qa --decision-ref qa-ok
- **THEN** specApproval.lanes.qa มี decisionRef qa-ok

#### Scenario: บทบาทที่ไม่รู้จัก

- **WHEN** advance --approve-spec --role cfo --decision-ref x
- **THEN** ปฏิเสธพร้อมรายชื่อบทบาทที่ใช้ได้และไม่บันทึกอะไร

### Requirement: legacy-approval

ระบบ SHALL ถือว่าการอนุมัติที่ไม่ระบุบทบาทครอบทุก lane และคงพฤติกรรมเดิมเมื่อไม่เปิด approval.roles

#### Scenario: อนุมัติไม่ระบุ role

- **GIVEN** approval.roles มีหลายบทบาท
- **WHEN** advance --approve-spec --decision-ref all-ok
- **THEN** ทุก lane ที่ต้องมีถือว่าอนุมัติแล้ว

#### Scenario: state เก่า

- **GIVEN** state ที่มี specApproval แบบเดิมไม่มี lanes
- **WHEN** advance --through build
- **THEN** Build เริ่มได้โดยไม่ต้อง migrate

### Requirement: lane-carry

ระบบ SHALL คงการอนุมัติ lane ใน revision แบบเพิ่ม และล้างทุก lane เมื่อ revision ลบ requirement

#### Scenario: revision แบบเพิ่ม

- **GIVEN** lane ทั้งหมดอนุมัติแล้ว
- **WHEN** change revise เพิ่ม scenario
- **THEN** lane ทั้งหมดยังอนุมัติอยู่

#### Scenario: revision ลบ requirement

- **GIVEN** lane ทั้งหมดอนุมัติแล้ว
- **WHEN** change revise ลบ requirement
- **THEN** ทุก lane กลับเป็นรออนุมัติ

### Requirement: lane-after-full

ระบบ SHALL คงการอนุมัติเต็มของ revision เดียวกันเมื่อมีการอนุมัติด้วย --role ตามมา

#### Scenario: role หลังอนุมัติเต็ม

- **GIVEN** approval.roles มี tech-lead และ qa และอนุมัติเต็มโดยไม่ระบุ role แล้ว
- **WHEN** advance --approve-spec --role qa --decision-ref qa-ok
- **THEN** การอนุมัติเต็มยังอยู่และ lane qa บันทึก decisionRef qa-ok

### Requirement: lane-recompute

ระบบ SHALL คำนวณ lane ที่ต้องมีใหม่เมื่อ revision หรือ amendment carry การอนุมัติ และขอเฉพาะ lane ที่เพิ่มมา

- การอนุมัติที่ไม่ระบุ role ครอบทุก lane ที่ต้องมีในขณะที่อนุมัติ
- ถ้าไม่ได้ตั้ง approval.roles พฤติกรรมเหมือนเดิม

#### Scenario: revision เพิ่ม role ใหม่

- **GIVEN** approval.roles มี tech-lead และ security และอนุมัติครบเมื่อ router เลือกแค่ tech-lead
- **WHEN** revision แบบเพิ่มทำให้ router เลือก security ด้วย
- **THEN** การอนุมัติยังไม่ครบและ gate ระบุ lane security

#### Scenario: revision ไม่เปลี่ยน role

- **GIVEN** lane ที่ต้องมีอนุมัติครบ
- **WHEN** revision แบบเพิ่มที่ router เลือก role ชุดเดิม
- **THEN** การอนุมัติยังครบและ Build เริ่มได้

### Requirement: approval-config-type

ระบบ SHALL ปฏิเสธ approval ใน foundation.json ที่ไม่ใช่ object หรือ roles ที่ไม่ใช่ array

#### Scenario: approval เป็น string

- **GIVEN** foundation.json มี approval เป็น string
- **WHEN** harness อ่าน policy
- **THEN** ปฏิเสธพร้อมข้อความที่ระบุ approval

#### Scenario: roles เป็น string

- **GIVEN** foundation.json มี approval.roles เป็น string
- **WHEN** harness อ่าน policy
- **THEN** ปฏิเสธพร้อมข้อความที่ระบุ approval.roles
