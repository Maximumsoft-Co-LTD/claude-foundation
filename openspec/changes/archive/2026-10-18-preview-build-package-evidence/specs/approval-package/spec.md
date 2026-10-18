# approval-package

## ADDED Requirements

### Requirement: package-tolerates-evidence

ระบบ SHALL เขียน package ต่อพร้อมคำเตือนเมื่ออ่าน evidence หรือ receipt ไม่ได้

#### Scenario: provider ไม่มี adapter

- **GIVEN** evidence.yaml มี provider ที่ไม่มี adapter
- **WHEN** รัน package ผ่าน CLI
- **THEN** exit 0 ไฟล์ package ถูกเขียน และมีคำเตือนที่ระบุ evidence

#### Scenario: evidence.yaml เป็น JSON ที่เสีย

- **GIVEN** evidence.yaml อ่านเป็น JSON ไม่ได้
- **WHEN** รัน package ผ่าน CLI
- **THEN** exit 0 ไฟล์ package ถูกเขียน และมีคำเตือน

#### Scenario: change ที่ไม่มีอยู่

- **WHEN** รัน package กับ id ที่ไม่มี
- **THEN** exit ไม่เป็นศูนย์และไม่เขียนไฟล์

### Requirement: package-content

ระบบ SHALL แสดงเนื้อหาจริงของ agreement ใต้ artifact แต่ละรายการใน package

- เนื้อหามาจาก typed draft ของ revision ปัจจุบันเท่านั้น
- ทุกค่าถูก escape ก่อนใส่ HTML
- artifact ที่ agreement ไม่ได้ประกาศแสดงว่าไม่ได้ประกาศ

#### Scenario: API contract

- **GIVEN** draft มี apiContracts POST /wallets/{account}/withdrawals ที่มี error 409
- **WHEN** รัน package
- **THEN** ส่วน Tech Lead แสดง method, path และ error 409

#### Scenario: test matrix

- **GIVEN** draft มี requirement 2 ข้อ รวม 3 scenario
- **WHEN** รัน package
- **THEN** ส่วน QA แสดง 3 แถวพร้อม given, when, then

#### Scenario: permission matrix

- **GIVEN** draft มี scenario access allow และ deny
- **WHEN** รัน package
- **THEN** ส่วน Security แสดงทั้ง allow และ deny

#### Scenario: ไม่ได้ประกาศ

- **GIVEN** change ระดับ High ที่ไม่มี dataModel
- **WHEN** รัน package
- **THEN** artifact ERD แสดงว่าไม่ได้ประกาศใน agreement

#### Scenario: ค่าที่มี HTML

- **GIVEN** scenario มีข้อความ <script>alert(1)</script>
- **WHEN** รัน package
- **THEN** ข้อความถูก escape และไม่มี script tag ใน HTML

### Requirement: package-preview-output

ระบบ SHALL แสดงสถานะและ output ท้ายของ preview receipt ใต้ artifact ที่ตรง capability

#### Scenario: preview ล้มเหลว

- **GIVEN** preview concurrency ที่มี status fail และ output RACE pays out twice
- **WHEN** รัน package
- **THEN** artifact concurrency แสดงสถานะ fail และข้อความ RACE pays out twice

#### Scenario: preview เก่า

- **GIVEN** preview ของ revision ก่อนหน้า
- **WHEN** รัน package
- **THEN** output แสดงพร้อมระบุว่า stale

#### Scenario: output มี HTML

- **GIVEN** output ของ preview มี <img src=x onerror=alert(1)>
- **WHEN** รัน package
- **THEN** output ถูก escape และไม่มี img tag

### Requirement: archived-proof-labels

ระบบ SHALL ติดป้าย proof จาก receipt ที่ผ่านของ change ที่ archive หรือ apply แล้ว โดยไม่ตรวจ sandbox ที่ถูกลบ

#### Scenario: archive แล้วผ่าน

- **GIVEN** change ที่ archived โดย land.assurance ผ่านและ receipt test มี status pass
- **WHEN** รัน package
- **THEN** artifact test map ติดป้าย proof และไม่มีคำเตือน

#### Scenario: archive แต่ receipt ไม่ผ่าน

- **GIVEN** change ที่ archived แต่ receipt test มี status fail
- **WHEN** รัน package
- **THEN** artifact test map ไม่ติดป้าย proof

### Requirement: failure-table-filter

ระบบ SHALL แสดงใต้ artifact concurrency และ retry เฉพาะ failure scenario ที่เกี่ยวกับการทำงานพร้อมกันหรือการลองใหม่

#### Scenario: กรองตรง

- **GIVEN** failure scenario 3 ข้อ ซึ่งมีข้อเดียวพูดถึงการส่งพร้อมกัน
- **WHEN** รัน package
- **THEN** artifact concurrency แสดงแถวเดียว

#### Scenario: ไม่มีที่ตรง

- **GIVEN** ไม่มี failure scenario ที่พูดถึงการทำงานพร้อมกัน
- **WHEN** รัน package
- **THEN** artifact concurrency บอกว่าไม่มี scenario ที่ตรง

### Requirement: router-path-signals

ระบบ SHALL ยกระดับความเสี่ยงและ lane อนุมัติจาก path ที่ task แตะ เมื่อ path บอก signal ที่ draft ไม่ได้ประกาศ

- ใช้กับระดับความเสี่ยง domain artifact และ lane อนุมัติเท่านั้น ไม่เปลี่ยน discovery หรือ review
- migrations/ schema prisma และ .sql ให้ persisted-data-change; auth permission rbac ให้ access-control; payment billing refund checkout wallet ให้ financial; tsx jsx vue css และ components pages ให้ user-interface; .tf terraform k8s helm Dockerfile และ .github/workflows ให้ high-operational-risk; webhook ให้ external-integration

#### Scenario: migration ที่ไม่ประกาศ

- **GIVEN** workType bugfix impact medium ไม่มี riskSignals และ task แตะ migrations/003_add_status.sql
- **WHEN** เรียก routeChange
- **THEN** ระดับเป็น High และ reasons มี path:migrations/003_add_status.sql→persisted-data-change

#### Scenario: path ปกติ

- **GIVEN** task แตะ src/util/format.js
- **WHEN** เรียก routeChange
- **THEN** ไม่มี signal จาก path

#### Scenario: lane จาก path

- **GIVEN** approval.roles มี security และ task แตะ src/auth/session.js ที่ draft ไม่ประกาศ access-control
- **WHEN** advance --through build โดยอนุมัติแค่ tech-lead
- **THEN** advance ถามหา lane security
