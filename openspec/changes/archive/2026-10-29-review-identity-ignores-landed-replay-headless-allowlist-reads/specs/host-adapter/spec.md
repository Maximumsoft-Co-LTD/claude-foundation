# host-adapter

## ADDED Requirements

### Requirement: headless-read-allowlist

ระบบ SHALL ship permissions.allow ที่มีกฎอ่านอย่างเดียวเพิ่มจาก CLI และ Edit เดิม ได้แก่ Bash(find *), Bash(grep *), Bash(ls *), Bash(head *), Bash(wc *), Bash(rtk ls *), Bash(rtk grep *) และคู่ Bash(git <verb>) กับ Bash(git <verb> *) สำหรับ status, diff, log, show โดยไม่มีกฎสำหรับ cat

#### Scenario: installer ต่อท้ายกฎอ่าน

- **GIVEN** settings.json เดิมของผู้ใช้มี Bash(user-tool *)
- **WHEN** รัน install.sh
- **THEN** permissions.allow เป็นกฎผู้ใช้ตามด้วยกฎที่ ship ทั้งหมดรวมกฎอ่าน ตามลำดับ และรันซ้ำไม่เพิ่มอะไร

#### Scenario: ไม่มีกฎเขียนหรือ git ที่เปลี่ยน state

- **GIVEN** allowlist ที่ ship
- **WHEN** ตรวจรายการ
- **THEN** ไม่มี rm, mv, cat, git commit/push/reset/checkout หรือ Write นอก sandbox และ cat > file ไม่ถูก pre-allow

#### Scenario: git แบบไม่มี argument

- **GIVEN** allowlist ที่ ship
- **WHEN** agent รัน git status หรือ git diff เปล่า ๆ
- **THEN** ตรงกับกฎ exact Bash(git status) / Bash(git diff)

#### Scenario: opt-out

- **GIVEN** --no-permission-allowlist
- **WHEN** รัน install.sh
- **THEN** permissions.allow ไม่ถูกแตะ
