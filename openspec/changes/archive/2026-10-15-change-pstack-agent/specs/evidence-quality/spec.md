# คุณภาพหลักฐาน

หลักฐาน performance เทียบ head กับ base ใน environment เดียวกัน

## ADDED Requirements

### Requirement: Benchmark evidence compares head with base under one environment

ระบบ SHALL ให้ provider adapter benchmark รันคำสั่งเดียวกันบน base และ head สลับกันหลายรอบใน environment เดียวกันแล้วบันทึกการเทียบใน receipt

- config: adapter benchmark, command, runs (ค่าเริ่มต้น 5, ต่ำสุด 3), maxRegressionPercent (ค่าเริ่มต้น 10)
- base tree สร้างด้วย buildScratch เดิมของ test-discrimination (git archive baseHead + overlay ที่ไม่ใช่ product code)
- ลำดับการรันสลับ base, head, base, head ... เพื่อลด drift ของเครื่อง
- regressionPercent = (headMedian - baseMedian) / baseMedian * 100 ปัดสองตำแหน่ง
- ผ่านเมื่อ regressionPercent <= maxRegressionPercent และทุก head run exit 0

#### Scenario: head ไม่ช้ากว่า threshold

- **GIVEN** provider benchmark runs 5 และ head median ช้ากว่า base 4%
- **WHEN** Prove รัน provider
- **THEN** receipt validity passed
- **AND** receipt มี baseSamples และ headSamples อย่างละ 5 ค่า
- **AND** receipt มี environment descriptor เดียวสำหรับทั้งสองฝั่ง

#### Scenario: head ช้าเกิน threshold

- **GIVEN** head median ช้ากว่า base 25% และไม่ได้กำหนด maxRegressionPercent
- **WHEN** Prove รัน provider
- **THEN** Prove คืน REPAIR stage performance-regression พร้อม finding ที่ระบุ provider, baseMedianMs, headMedianMs และ regressionPercent

#### Scenario: ช้าเท่า threshold พอดี

- **GIVEN** regressionPercent เท่ากับ 10.00 และ threshold ค่าเริ่มต้น
- **WHEN** Prove รัน provider
- **THEN** receipt validity passed

#### Scenario: threshold ที่ผู้เขียนกำหนด

- **GIVEN** maxRegressionPercent 2 และ head ช้ากว่า base 3%
- **WHEN** Prove รัน provider
- **THEN** Prove คืน REPAIR stage performance-regression

#### Scenario: base ใช้ไม่ได้ไม่ block

- **GIVEN** ไม่มี baseHead หรือคำสั่งบน base spawn ไม่ได้
- **WHEN** Prove รัน provider
- **THEN** receipt บันทึก comparison unavailable พร้อม reason และตัดสินจาก exit code ของ head เท่านั้น

#### Scenario: head run ล้มเหลว

- **GIVEN** คำสั่งบน head exit ไม่ใช่ 0
- **WHEN** Prove รัน provider
- **THEN** Prove คืน REPAIR stage evidence-failed เหมือน provider ทั่วไป

#### Scenario: runs ต่ำกว่าขั้นต่ำ

- **GIVEN** draft กำหนด runs 1
- **WHEN** change start inspect
- **THEN** intake คืน EDIT ระบุว่า runs ต้องไม่น้อยกว่า 3
