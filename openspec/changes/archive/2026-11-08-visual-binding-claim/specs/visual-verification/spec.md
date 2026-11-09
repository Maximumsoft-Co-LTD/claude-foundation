# visual-verification

## ADDED Requirements

### Requirement: visual-binding-claims-fail-closed

ระบบ SHALL บังคับ visual ให้ทุก claim และรายงาน error เมื่อ binding แบบ strict ไม่มี claim หรืออ้าง claim ที่ contract ไม่มี

- error ระบุ claim ที่ไม่รู้จักหรือบอกว่ารายการว่าง และให้ change revise ก่อน Build
- ไม่เรียก reviewer เมื่อ binding ไม่ถูกต้อง

#### Scenario: claims ว่าง

- **GIVEN** binding โหมด strict ที่ claims เป็นรายการว่าง
- **WHEN** Prove อ่าน contract และรัน provider visual
- **THEN** ทุก claim ของ change ต้องการ visual และ receipt visual เป็น error ที่ระบุว่า binding ไม่มี claim
- **AND** reviewer ไม่ถูกเรียก

#### Scenario: claims ไม่รู้จักทั้งหมด

- **GIVEN** binding โหมด strict ที่ทุก claim id ไม่มีใน contract
- **WHEN** Prove รัน
- **THEN** ทุก claim ต้องการ visual และ receipt visual เป็น error ที่ระบุ claim ที่ไม่รู้จัก

#### Scenario: claims ไม่รู้จักบางส่วน

- **GIVEN** binding โหมด strict ที่มี claim id ที่รู้จักและไม่รู้จักปนกัน
- **WHEN** Prove รัน
- **THEN** ทุก claim ต้องการ visual และ receipt visual เป็น error ที่ระบุ claim ที่ไม่รู้จัก

#### Scenario: claims ถูกต้อง

- **GIVEN** binding โหมด strict ที่ทุก claim id มีใน contract
- **WHEN** Prove รัน
- **THEN** เฉพาะ claim ที่ผูกต้องการ visual และ reviewer ถูกเรียกเหมือนเดิม
