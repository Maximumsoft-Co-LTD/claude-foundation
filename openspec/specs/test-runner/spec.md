# test-runner Specification

## Purpose
Installer smoke ไม่ถูก watchdog ฆ่าที่ 300 วินาทีบน CI.
## Requirements
### Requirement: installer-smoke-timeout

run-all.sh SHALL ให้ suite installer smoke มี watchdog 600 วินาทีโดยปริยาย และ suite อื่นที่ไม่อยู่ในรายการขยายยังมี 300 วินาที

#### Scenario: installer smoke ได้ 600 วินาที

- **GIVEN** ไม่ได้ตั้ง FOUNDATION_SUITE_TIMEOUT_SECONDS
- **WHEN** ถามค่า timeout ของ suite ชื่อ installer smoke
- **THEN** ได้ 600

#### Scenario: suite อื่นยังได้ 300 วินาที

- **GIVEN** ไม่ได้ตั้ง FOUNDATION_SUITE_TIMEOUT_SECONDS
- **WHEN** ถามค่า timeout ของ suite ที่ไม่อยู่ในรายการขยาย
- **THEN** ได้ 300

#### Scenario: ตัวแปรสภาพแวดล้อมครอบทุก suite

- **GIVEN** ตั้ง FOUNDATION_SUITE_TIMEOUT_SECONDS เป็น 45
- **WHEN** ถามค่า timeout ของ installer smoke และของ suite อื่น
- **THEN** ทั้งสองได้ 45

### Requirement: timeout-reported-as-cause

run-all.sh SHALL นับ suite ที่ถูก watchdog ฆ่าว่าล้มเสมอและรายงานสาเหตุว่า timed out พร้อมจำนวนวินาทีที่ตั้งไว้ แม้ shell ของ suite จะพิมพ์ผลสำเร็จก่อนถูกฆ่า

#### Scenario: suite ที่ถูกฆ่ารายงาน timed out

- **GIVEN** watchdog บันทึกขีด 300 วินาทีของ suite หนึ่ง
- **WHEN** สร้างหมายเหตุ timeout ของ suite นั้น
- **THEN** ได้ข้อความ timed out after 300s

#### Scenario: suite ที่ถูกฆ่านับว่าล้มแม้สถานะเป็น 0

- **GIVEN** suite หนึ่งมีไฟล์ timeout แต่ไฟล์สถานะเป็น 0
- **WHEN** ตัดสินว่า suite ล้มหรือไม่
- **THEN** นับว่าล้ม

#### Scenario: suite ปกติไม่มีหมายเหตุ

- **GIVEN** suite หนึ่งไม่มีไฟล์ timeout และสถานะเป็น 0
- **WHEN** สร้างหมายเหตุและตัดสินว่าล้มหรือไม่
- **THEN** ไม่มีหมายเหตุ timeout และไม่นับว่าล้ม

### Requirement: topology-planning-timeout

run-all.sh SHALL ให้ suite harness contracts (topology planning) มี watchdog 1200 วินาทีโดยปริยาย โดย suite ยาวอื่นยังมี 600 วินาทีและ suite ปกติยังมี 300 วินาที

#### Scenario: topology planning ได้ 1200 วินาที

- **GIVEN** ไม่ได้ตั้ง FOUNDATION_SUITE_TIMEOUT_SECONDS
- **WHEN** ถามค่า timeout ของ suite ชื่อ harness contracts (topology planning)
- **THEN** ได้ 1200

#### Scenario: suite ยาวอื่นยังได้ 600 วินาที

- **GIVEN** ไม่ได้ตั้ง FOUNDATION_SUITE_TIMEOUT_SECONDS
- **WHEN** ถามค่า timeout ของ installer smoke, pull request delivery, proof loop end to end, apply conflict และ concurrent repositories seam
- **THEN** ทุกตัวได้ 600

#### Scenario: ตัวแปรสภาพแวดล้อมยังครอบทุก suite

- **GIVEN** ตั้ง FOUNDATION_SUITE_TIMEOUT_SECONDS เป็น 45
- **WHEN** ถามค่า timeout ของ topology planning และของ suite ปกติ
- **THEN** ทั้งสองได้ 45
