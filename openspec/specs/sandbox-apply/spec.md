# sandbox-apply Specification

## Purpose
TBD - created by archiving change fix-review-authority-guards-and-land-recovery-defects. Update Purpose after archive.
## Requirements
### Requirement: Applied projection refresh is reachable from the CLI

`sandbox apply` SHALL accept a `--refresh` boolean flag that refreshes the
applied projection of a target that legitimately moved after apply, SHALL
continue to reject unknown flags, and SHALL keep refusing a refresh when an
applied path diverged from the sandbox copy or the transaction journal is
missing.

#### Scenario: Refresh a moved target

- **WHEN** a change is applied, the target repository advances for unrelated
  reasons, and the operator runs `sandbox apply <change> --refresh`
- **THEN** the applied projection and journal are refreshed and the change can
  proceed to archive

#### Scenario: Unknown flags still die

- **WHEN** `sandbox apply` is invoked with a flag other than `--refresh`
- **THEN** the command refuses with a usage error

#### Scenario: Diverged path still refuses

- **WHEN** an applied path no longer matches the sandbox copy
- **THEN** the refresh fails naming the diverged path

### Requirement: Copy apply recognizes an exact desired projection

Copy-mode Land SHALL treat a target path whose content identity and mode equal
the sandbox path as already reconciled even when it differs from the recorded
baseline, and SHALL continue to reject a target that differs from both.

#### Scenario: Another change produced the same bytes

- **WHEN** a copy sandbox changed a path and the target independently reached
  the identical content and mode
- **THEN** Land records the no-op projection without an isolated-copy conflict

#### Scenario: The target contains different work

- **WHEN** the target differs from both baseline and sandbox
- **THEN** Land blocks before overwriting the target

### Requirement: post-land-install

ระบบ SHALL รันคำสั่งติดตั้ง dependency ของโปรเจกต์ในโฟลเดอร์ของผู้ใช้หลัง Land เมื่อ Land เปลี่ยน package.json หรือ lockfile ที่ root โดยใช้ sandbox.setupCommand ถ้าตั้งไว้ มิฉะนั้นใช้คำสั่งของ lockfile และ SHALL บันทึกผลไว้ใน Land

#### Scenario: lockfile เปลี่ยน

- **GIVEN** Land เปลี่ยน package.json และ package-lock.json ที่ root
- **WHEN** Land apply เสร็จ
- **THEN** ระบบรัน npm ci ในโฟลเดอร์ของผู้ใช้และบันทึกสถานะ ok

#### Scenario: dependency ไม่เปลี่ยน

- **GIVEN** Land ไม่เปลี่ยน package.json หรือ lockfile
- **WHEN** Land apply เสร็จ
- **THEN** ระบบไม่รันคำสั่งติดตั้ง

#### Scenario: ปิดการติดตั้ง

- **GIVEN** foundation.json ตั้ง sandbox.installDependencies เป็น false และไม่มี setupCommand
- **WHEN** Land เปลี่ยน lockfile
- **THEN** ระบบไม่รันคำสั่งติดตั้ง

#### Scenario: ติดตั้งล้ม

- **GIVEN** คำสั่งติดตั้งจบด้วย exit code ไม่เป็นศูนย์
- **WHEN** Land apply เสร็จ
- **THEN** Land ไม่ถูกย้อนกลับ ระบบบันทึกสถานะ failed และแสดงคำสั่งที่ต้องรันเอง
