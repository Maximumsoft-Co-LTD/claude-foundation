# change

## ADDED Requirements

### Requirement: template-leads-with-v5

ระบบ SHALL ให้ change start --template นำด้วยคำสั่ง save และ minimal draft แบบโฟลเดอร์ v5 ที่มี change.json version 5, workType และ proposal.md

#### Scenario: template นำด้วย v5

- **WHEN** agent รัน claude-foundation change start --template
- **THEN** save บอกให้เขียน .foundation/drafts/<id>/change.json และ proposal.md ด้วย Write tool แล้วรัน change start .foundation/drafts/<id>
- **AND** minimalDraft มี change.json ที่มี version 5 และ workType

#### Scenario: minimal draft ที่กรอกแล้วเริ่มได้

- **WHEN** agent เขียนโฟลเดอร์ตาม minimal draft โดยแทนค่าตัวอย่างด้วยงานจริง แล้วรัน change start กับโฟลเดอร์นั้น
- **THEN** change เริ่มได้และ packet ระบุ work type ที่ประกาศไว้แทนค่าที่เดาจาก path

#### Scenario: work type ที่ประกาศบังคับหัวข้อของตัวเอง

- **GIVEN** minimal draft ประกาศ workType api แต่ไม่มี apiContracts
- **WHEN** agent รัน change start กับโฟลเดอร์นั้น
- **THEN** harness คืน EDIT ที่ระบุ apiContracts โดยไม่เริ่ม change

#### Scenario: draft v4 แบบ JSON ยังใช้ได้

- **GIVEN** draft v4 เป็นไฟล์ JSON เดียวตาม template เดิม
- **WHEN** agent รัน change start กับไฟล์ JSON นั้น
- **THEN** change เริ่มได้เหมือนเดิม

### Requirement: v5-prose-counts-as-authored

ระบบ SHALL นับ prose ใต้หัวข้อ Summary, Why, User stories และ Success criteria ของ proposal.md ใน draft v5 เป็นค่าที่ผู้เขียนเขียนเอง ทั้งในคำเตือนก่อนอนุมัติและใน appendix ข้อมูลที่ harness สร้าง

#### Scenario: prose เหตุผลนับเป็น why

- **GIVEN** draft v5 ไม่มี field why แต่ proposal.md มีหัวข้อ เหตุผล ที่มีเนื้อหา
- **WHEN** agent รัน change start กับโฟลเดอร์นั้น
- **THEN** ไม่มีคำเตือนให้เพิ่ม why หรือ summary
- **AND** appendix ข้อมูลที่ harness สร้างไม่มีบรรทัด Why: not authored separately

#### Scenario: prose user story และเกณฑ์นับเป็นของผู้เขียน

- **GIVEN** proposal.md ของ draft v5 มีหัวข้อ User stories และ Success criteria ที่มีเนื้อหา
- **WHEN** agent รัน change start กับโฟลเดอร์นั้น
- **THEN** ไม่มีคำเตือนให้เพิ่ม userStories หรือ successCriteria

#### Scenario: ไม่มีทั้ง field และ prose ยังเตือน

- **GIVEN** draft v5 แบบ standard ที่ไม่มีทั้ง field why และหัวข้อ Why หรือ Summary ใน proposal.md
- **WHEN** agent รัน change start กับโฟลเดอร์นั้น
- **THEN** ยังมีคำเตือนให้เพิ่ม why หรือ summary และ appendix บันทึกว่า why มาจาก intent

### Requirement: instructions-teach-v5

ระบบ SHALL ให้คำสั่ง /change, skill change และหน้า loop/change ของ website ทั้งสองภาษา สอนการเขียนโฟลเดอร์ v5 พร้อม workType เป็นทางหลัก

#### Scenario: คำสั่ง /change สอนโฟลเดอร์ v5

- **WHEN** agent อ่าน .claude/commands/change.md
- **THEN** ขั้นเขียน draft และขั้น change start ใช้โฟลเดอร์ .foundation/drafts/<id>/ ที่มี change.json version 5 และ workType

#### Scenario: ทางเขียน draft ได้รับอนุญาตล่วงหน้า

- **WHEN** agent เขียน .foundation/drafts/<id>/change.json และ proposal.md ด้วย Write tool
- **THEN** เส้นทางนั้นอยู่ใน allowlist ที่ seed ไว้ และไม่ต้องขออนุญาตเพิ่ม

#### Scenario: เอกสารสองภาษาตรงกัน

- **WHEN** รัน docs consistency และ context budget
- **THEN** ผ่านทั้งหมด และหน้าภาษาอังกฤษกับไทยอธิบายทางเดียวกัน
