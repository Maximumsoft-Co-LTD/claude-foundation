# review-closure

## Purpose

ทำให้ทางตัน CONTRACT_DECISION_REQUIRED หลัง amendment บอกทางต่อที่มีอยู่จริง และเตือนตั้งแต่ตอน amend.

## ADDED Requirements

### Requirement: decision-route-command

ระบบ SHALL ระบุคำสั่งที่ได้ approved decision revision ในผลลัพธ์ของ advance เมื่อ agreement เปลี่ยนหลัง delta รอบสุดท้ายที่ล้ม แทนคำสั่ง packet --phase build

#### Scenario: change แบบ grounding

- **GIVEN** change ที่ groundingRequired เป็นจริงและ agreement เปลี่ยนหลัง delta รอบสุดท้ายที่ล้ม
- **WHEN** agent รัน advance
- **THEN** ผลลัพธ์เป็น ASK_USER และมีคำสั่ง change resolve <change> --reopen-grounding --decision-ref <ref> --reopen-reason <why>

#### Scenario: change แบบ non-grounding

- **GIVEN** change ที่ไม่ใช่ grounding และ spec approval ไม่ตรงกับ contractRevision ปัจจุบัน
- **WHEN** agent รัน advance
- **THEN** ผลลัพธ์เป็น ASK_USER และมีคำสั่ง advance <change> --approve-spec --decision-ref <ref>

#### Scenario: gate ไม่ถูกผ่อน

- **GIVEN** agreement เปลี่ยนโดยไม่มี approved decision revision
- **WHEN** agent รัน advance
- **THEN** closure ยังคืน closed false และ route CONTRACT_DECISION_REQUIRED เหมือนเดิม
