# test-runner

## ADDED Requirements

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
