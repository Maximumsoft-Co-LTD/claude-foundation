# agent-contract

## ADDED Requirements

### Requirement: build-edit-test-adequacy

ระบบ SHALL ใส่ในคำสั่งของ Build EDIT จำนวน scenario ที่ task ครอบคลุมและกฎให้เขียนเทสต์ที่ fail บนโค้ดก่อนแก้อย่างน้อยหนึ่งเทสต์ต่อ scenario

- จำนวนนับจาก claims ที่ผูกกับ task ใน tasks.md
- ใส่เฉพาะงานที่เปลี่ยนพฤติกรรม ไม่ใส่กับงานเบาหรืองานที่ไม่เปลี่ยนพฤติกรรม
- คำสั่งไม่มี field skills ไม่มีคำสั่งโหลด skill และไม่มีชื่อ skill ตาม no-skill-routing

#### Scenario: task เปลี่ยนพฤติกรรมและมี claim

- **GIVEN** task T001 เป็นงาน feature ที่ผูก 4 claims
- **WHEN** advance คืน Build EDIT
- **THEN** instructions บอกว่า T001 ครอบคลุม 4 scenario และให้เขียนเทสต์ที่ fail บนโค้ดก่อนแก้อย่างน้อยหนึ่งเทสต์ต่อ scenario

#### Scenario: งานไม่เปลี่ยนพฤติกรรม

- **GIVEN** task เป็นงาน docs หรือ refactor
- **WHEN** advance คืน Build EDIT
- **THEN** instructions ไม่มีบรรทัดความพอของเทสต์

#### Scenario: task ไม่มี claim

- **GIVEN** task เปลี่ยนพฤติกรรมแต่ไม่มี claim ผูก
- **WHEN** advance คืน Build EDIT
- **THEN** instructions ไม่มีบรรทัดความพอของเทสต์ และไม่พิมพ์จำนวนเป็นศูนย์

#### Scenario: ไม่ระบุชื่อ skill

- **GIVEN** Build EDIT ที่มีบรรทัดความพอของเทสต์
- **WHEN** ตรวจ field และ instructions
- **THEN** ไม่มี field skills ไม่มีชื่อ skill และไม่มีคำสั่งให้โหลด skill
