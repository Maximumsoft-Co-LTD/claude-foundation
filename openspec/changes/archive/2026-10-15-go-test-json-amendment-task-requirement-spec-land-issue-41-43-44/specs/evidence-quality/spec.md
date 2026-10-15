# evidence-quality

## ADDED Requirements

### Requirement: go test -json results are counted test evidence

ระบบ SHALL นับผลจาก go test -json event stream เป็นจำนวนเทสต์ที่ผ่าน ล้ม และข้าม

#### Scenario: เทสต์ผ่านทั้งหมด

- **GIVEN** stdout มี event Action pass ของ 3 test ใน package เดียว
- **WHEN** parse รายงานแบบ auto
- **THEN** totalTests 3, passed 3, failed 0, format go-test-json

#### Scenario: subtest นับแยก

- **GIVEN** มี TestA และ TestA/case1 ผ่าน
- **WHEN** parse
- **THEN** นับเป็น 2 เทสต์ และ critical case id เป็นชื่อ Test

#### Scenario: เทสต์ล้มและข้าม

- **GIVEN** มี pass 1, fail 1, skip 1
- **WHEN** parse
- **THEN** totalTests 3, passed 1, failed 1

#### Scenario: package build fail ไม่มี test event

- **GIVEN** มีเฉพาะ event Action fail ระดับ package
- **WHEN** parse
- **THEN** failed อย่างน้อย 1 จึงไม่นับเป็นผ่าน

#### Scenario: รูปแบบอื่นคงเดิม

- **GIVEN** stdout เป็น TAP หรือ node spec หรือ JSON object เดียว
- **WHEN** parse
- **THEN** ได้ผลเดิมเหมือนก่อนแก้
