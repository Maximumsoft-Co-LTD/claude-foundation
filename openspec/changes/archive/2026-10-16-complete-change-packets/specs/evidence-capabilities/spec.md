# Capability ของหลักฐาน

## Purpose

capability ใหม่สำหรับ evaluation, release health, parity, plan และ experiment

## ADDED Requirements

### Requirement: Evidence covers evaluation, release health, parity, plans, and experiments

ระบบ SHALL มี capability evaluation, release-health, parity, plan-check และ experiment-guardrail ใน provider catalog พร้อม adapter และกติกาผ่าน

#### Scenario: evaluation ผ่านเกณฑ์

- **GIVEN** provider evaluation คืนคะแนนเกิน threshold
- **WHEN** Prove
- **THEN** claim ผ่าน

#### Scenario: evaluation ต่ำกว่าเกณฑ์

- **GIVEN** คะแนนต่ำกว่า threshold
- **WHEN** Prove
- **THEN** claim ไม่ผ่านพร้อมคะแนนและ threshold

#### Scenario: release-health จากภายนอก

- **GIVEN** provider release-health แบบ external
- **WHEN** Prove ก่อนปล่อย
- **THEN** proof ผ่านโดยบันทึก release-health เป็น gate ของ rollout ใน handoff และ Land ทำต่อได้
