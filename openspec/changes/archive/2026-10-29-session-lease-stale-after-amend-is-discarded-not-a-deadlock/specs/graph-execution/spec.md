# graph-execution

## ADDED Requirements

### Requirement: stale-session-lease-discarded

ระบบ SHALL settle session lease ที่ harness ออกเองเมื่อ authority ของมัน stale (graph revision, graph identity หรือ contract เปลี่ยน) ก่อน dispatch: ถ้า task ของมันรอ pending dependency ให้ park (ปล่อย resource ทั้งหมด เก็บ index และ write baseline ไว้ให้ acquire ครั้งถัดไปของ owner เดิม) มิฉะนั้นให้ renew in place

#### Scenario: lease stale ของ task ที่รอ dependency ถูก park

- **GIVEN** session lease ของ T002 ที่ fingerprint เป็นของ revision ก่อน amend และ plan ปัจจุบัน T002 dependsOn T001 ที่ยัง pending
- **WHEN** advance settle
- **THEN** resource ของ lease ถูกปล่อย index คงอยู่ในสถานะ parked และ settle ไม่นับ T002 ว่าเสร็จ

#### Scenario: re-acquire หลัง park สืบทอด baseline

- **GIVEN** lease ของ T002 ถูก park และมี write ก่อน amend ใน path ของมัน
- **WHEN** owner เดิม acquire T002 ใหม่แล้ว release
- **THEN** lease ใหม่มี baselineSurface เดิม และ release รายงาน write นั้น

#### Scenario: lease stale ของ task ที่รันได้ถูก renew

- **GIVEN** session lease ของ T003 ที่ stale และ T003 ไม่รอ pending dependency
- **WHEN** advance settle
- **THEN** lease ถูก acquire ใหม่ด้วย owner เดิม (own-prior) ไม่ถูก park หรือ discard

#### Scenario: lease ที่ยังตรง plan ไม่ถูกแตะ

- **GIVEN** session lease ที่ graph และ contract ตรงกับ plan ปัจจุบัน และ task ยังไม่ผ่าน check
- **WHEN** advance settle
- **THEN** lease คงอยู่

#### Scenario: lease ของ agent ภายนอกไม่ถูกแตะ

- **GIVEN** lease ที่ owner ไม่ใช่ session owner และ authority stale
- **WHEN** advance settle
- **THEN** ไม่ถูก park หรือ renew (agent นั้นต้อง re-acquire เองตามข้อความ stale เดิม)

#### Scenario: parked lease ไม่นับเป็น active

- **GIVEN** lease ถูก park
- **WHEN** อ่าน active leases
- **THEN** ไม่ปรากฏ เว้นแต่ขอ includeParked และ worker อื่น acquire resource เดิมได้
