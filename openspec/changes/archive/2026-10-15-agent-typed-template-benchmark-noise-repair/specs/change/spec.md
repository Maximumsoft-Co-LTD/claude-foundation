# ข้อตกลงของ change

template สอนการประกาศความเสี่ยงแบบ typed

## ADDED Requirements

### Requirement: Draft template teaches typed risk declarations

ระบบ SHALL ให้ change start --template มีคำแนะนำว่าเมื่อไรต้องใส่ riskSignals, access tag และ fixes ใน minimal draft

- minimalDraftRiskSignals อธิบาย access-control (บางผู้เรียกได้ บางผู้เรียกถูกปฏิเสธ เช่น owner/role/401/403 พร้อม access allow และ deny), financial (เงินเคลื่อนที่ คืนเงิน เก็บเงิน หรือ retry ต้องไม่ทำซ้ำ), performance-slo (ทำให้เร็วขึ้นหรือมี latency target พร้อม adapter benchmark) และ signal อื่นที่มีอยู่
- minimalDraftFixes อธิบายการใส่ fixes เมื่อผู้ใช้รายงานบั๊กที่มาจาก change ที่ archive แล้ว
- ข้อความไม่สแกนหรืออ้างอิง prose ของผู้ใช้

#### Scenario: template มีคำแนะนำ riskSignals

- **WHEN** เรียก change start --template
- **THEN** ผลลัพธ์มี minimalDraftRiskSignals ที่ระบุ access-control, financial และ performance-slo
- **AND** คำแนะนำ access-control ระบุ access allow และ access deny

#### Scenario: template มีคำแนะนำ fixes

- **WHEN** เรียก change start --template
- **THEN** ผลลัพธ์มี minimalDraftFixes ที่อ้าง openspec/changes/archive

#### Scenario: คำแนะนำไม่เปลี่ยน minimal draft

- **WHEN** เรียก change start --template
- **THEN** minimalDraft ไม่มี riskSignals เป็นค่าเริ่มต้น และยัง compile ได้เหมือนเดิม
