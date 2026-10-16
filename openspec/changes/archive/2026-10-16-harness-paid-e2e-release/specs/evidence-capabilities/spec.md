# evidence-capabilities

## ADDED Requirements

### Requirement: provider-timeout

ระบบ SHALL ให้ provider แบบ command ที่ไม่ตั้ง timeoutMs หมดเวลาที่ 600000 มิลลิวินาที และเมื่อหมดเวลา SHALL รายงานว่า timed out พร้อมเวลาที่จำกัดและให้ตั้ง timeoutMs

#### Scenario: ค่าเริ่มต้น 10 นาที

- **GIVEN** provider แบบ command ที่ไม่มี timeoutMs
- **WHEN** harness รัน provider
- **THEN** คำสั่งได้เวลา 600000 มิลลิวินาที

#### Scenario: timeout บอกสาเหตุ

- **GIVEN** provider ที่รันนานเกิน timeoutMs
- **WHEN** advance รวบรวมหลักฐาน
- **THEN** ผลลัพธ์ระบุ provider, timed out after เวลาที่จำกัด และให้ตั้ง timeoutMs ใน evidence.yaml

#### Scenario: ตั้งเองยังใช้ค่าที่ตั้ง

- **GIVEN** provider ที่ตั้ง timeoutMs 1800000
- **WHEN** harness รัน provider
- **THEN** คำสั่งได้เวลา 1800000 มิลลิวินาที

### Requirement: provider-env-isolation

ระบบ SHALL ถอดตัวแปรสถานะ session ของ harness ได้แก่ FOUNDATION_WORKSPACE_ROOT, FOUNDATION_CALLER_CWD, FOUNDATION_CLAUDE_SESSION_ID, FOUNDATION_CLAUDE_TRANSCRIPT_PATH, FOUNDATION_PUBLIC_OPERATION และ FOUNDATION_ACTIVE_PHASE ออกจาก environment ของ provider และคงตัวแปรตาม contract เช่น FOUNDATION_CHANGE_ID และ FOUNDATION_REPOSITORIES_FILE

#### Scenario: ตัวแปร session ถูกถอด

- **GIVEN** harness ทำงานโดยมี FOUNDATION_WORKSPACE_ROOT และ FOUNDATION_CLAUDE_SESSION_ID
- **WHEN** harness สร้าง environment ของ provider
- **THEN** environment ไม่มีตัวแปรทั้งหกนั้น

#### Scenario: ตัวแปร contract ยังอยู่

- **WHEN** harness สร้าง environment ของ provider
- **THEN** environment มี FOUNDATION_CHANGE_ID และ FOUNDATION_REPOSITORIES_FILE ตามที่ EVIDENCE.md สัญญา

#### Scenario: suite ที่เรียก harness ซ้อนผ่านใน proof

- **GIVEN** test provider ของ change นี้รัน run-all.sh --affected
- **WHEN** advance รัน proof
- **THEN** provider ผ่านเหมือนตอนรันนอก proof

### Requirement: rollout-gate-rules

ระบบ SHALL บันทึก post-release gate ที่ capability ถูก waive เป็น status waived แทน deferred และ SHALL อ่าน proof ที่ไม่มี field rolloutGates เป็นรายการว่าง

#### Scenario: release-health ที่ถูก waive

- **GIVEN** change ที่ work type ต้องการ release-health และมี waiver ของ release-health
- **WHEN** harness คำนวณ rollout gate
- **THEN** gate ของ release-health มี status waived และไม่ถูกนับเป็น gate ที่ค้าง

#### Scenario: proof เก่าไม่มี rolloutGates

- **GIVEN** proof ที่สร้างก่อน field rolloutGates
- **WHEN** Land หรือ audit อ่าน proof
- **THEN** อ่าน rolloutGates เป็นรายการว่างและทำงานต่อได้

#### Scenario: gate ตาม work type ไม่มี provider

- **GIVEN** change client-release ที่ไม่มี provider release-health
- **WHEN** Prove สำเร็จ
- **THEN** proof บันทึก release-health เป็น gate ที่ deferred

### Requirement: evaluation-output

ระบบ SHALL อ่านผลของ evaluation provider จากบรรทัด JSON สุดท้ายของ stdout เมื่อ stdout มี log ปน และ SHALL ให้ผลที่ protocol ไม่ใช่ foundation-evaluation-v1 ล้มพร้อมระบุ protocol ที่ได้

#### Scenario: stdout มี log ปน

- **GIVEN** คำสั่ง evaluation พิมพ์ log แล้วตามด้วย JSON ผลลัพธ์หนึ่งบรรทัด
- **WHEN** harness อ่านผล
- **THEN** ผลลัพธ์ใช้ score และ threshold จากบรรทัด JSON สุดท้าย

#### Scenario: protocol ผิด

- **GIVEN** ผลลัพธ์ระบุ protocol อื่นที่ไม่ใช่ foundation-evaluation-v1
- **WHEN** harness อ่านผล
- **THEN** claim ล้มและระบุ protocol ที่ได้กับที่ต้องการ
