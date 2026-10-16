# Benchmark ของเอกสาร change

## Purpose

scenario ทุกประเภทงานและตัววัดคุณภาพกับความเร็วสำหรับ paid e2e

## ADDED Requirements

### Requirement: The benchmark matrix covers every work type

ระบบ SHALL มี scenario ใน benchmark matrix พร้อม seed และ oracle สำหรับทุกประเภทงานใน catalog ที่ยังไม่มี

- แต่ละ scenario มี prompt, seed, oracle, critical case และงบไม่เกิน 3$
- scenario ใหม่ต้องผ่าน oracle บน seed ที่แก้ถูกและ fail บน seed ที่ยังไม่แก้

#### Scenario: matrix ครบทุกประเภท

- **WHEN** รัน test ของ matrix
- **THEN** ทุกประเภทงานใน catalog มีอย่างน้อยหนึ่ง scenario ที่ status ready

#### Scenario: oracle จับ seed ที่ยังไม่แก้

- **GIVEN** seed ของ scenario ใหม่ที่ยังไม่แก้
- **WHEN** รัน oracle
- **THEN** oracle fail ที่ critical case

#### Scenario: fixture digest ไม่ตรง

- **GIVEN** seed เปลี่ยนแต่ digest เดิม
- **WHEN** รัน test ของ matrix
- **THEN** test fail พร้อมชื่อ scenario

### Requirement: Scorecards measure packet quality and speed

ระบบ SHALL ให้ scorecard ของ benchmark รายงานหัวข้อบังคับที่ขาด จำนวนส่วนซ้ำ จำนวนคำของเอกสาร จำนวนรอบ EDIT ก่อน AGREED เวลาคอมไพล์ และเทียบสองแขนด้วยเกณฑ์ไม่ช้ากว่า 20%

#### Scenario: รายงานตัววัดเอกสาร

- **GIVEN** ผลรันที่มี packet
- **WHEN** สร้าง scorecard
- **THEN** มีหัวข้อที่ขาด ส่วนซ้ำ คำ รอบ EDIT และเวลาคอมไพล์

#### Scenario: ช้าเกินเกณฑ์

- **GIVEN** แขนใหม่มีค่ามัธยฐานเวลาสูงกว่าแขนเดิม 25%
- **WHEN** เทียบผล
- **THEN** ผลเทียบเป็นไม่ผ่านพร้อมตัวเลข

#### Scenario: เร็วขึ้น

- **GIVEN** แขนใหม่เร็วกว่าแขนเดิม
- **WHEN** เทียบผล
- **THEN** ผลเทียบเป็นผ่านและแสดงเปอร์เซ็นต์ที่เร็วขึ้น
