---
title: Workflow หลาย Repository
description: ตั้งค่า Build, Prove และ Land change ที่ต้องใช้หลาย Git repository ตามลำดับที่ Change Loop ตรวจจริง
---

ใช้คู่มือนี้เมื่อ change หนึ่งเขียนโค้ดในหลาย repository หรือเมื่อ test รันจาก
repository หนึ่งแต่ต้องใช้โค้ดหรือ contract จาก repository อื่น

ถ้า change ใช้ repository เดียว ให้หยุดตรงนี้แล้วทำตาม
[เริ่มใช้งาน](/docs/th/quickstart/) ซึ่งเป็นเส้นทางที่สั้นกว่า

## ก่อนอื่น แยก Scope สามชั้นให้ออก

ไฟล์เหล่านี้ตอบคนละคำถาม และต้องตั้งค่าตามลำดับ:

| ลำดับ | Contract | คำถามที่ตอบ |
|---|---|---|
| 1 | `openspec/repositories.yaml` | โปรเจกต์นี้ใช้ repository อะไรได้บ้าง |
| 2 | `openspec/changes/<change>/repositories.yaml` | change นี้อ่านหรือเขียนตัวไหนได้บ้าง |
| 3 | derived provider หรือฟิลด์ใน conditional `execution.yaml` | command หลักฐานตัวนี้ต้องใช้ repository อะไรบ้าง |

อย่าข้ามไปต่อ provider ก่อน เพราะ provider พิสูจน์ repository ที่ topology ไม่รู้จัก
หรือ change ไม่ได้เลือกไม่ได้

## 1. ประกาศ Topology ระดับโปรเจกต์

เพิ่มทุก repository ที่ Change Loop อาจต้องแยกพื้นที่ใน
`openspec/repositories.yaml`:

```json
{
  "version": 1,
  "repositories": [
    { "id": "api", "path": "services/api", "setupCommand": "npm ci" },
    { "id": "app", "path": "apps/web", "setupCommand": "npm ci" },
    { "id": "contracts", "path": "contracts", "mode": "read" },
    {
      "id": "partner-sdk",
      "type": "external",
      "path": "../partner-sdk",
      "mode": "read",
      "allowOutsideRoot": true
    }
  ]
}
```

สิ่งที่ต้องรู้:

- `id` คือชื่อคงที่ที่ task, provider, receipt และ Land ใช้ร่วมกัน
- `path` ปกติอิงจาก control repository
- `setupCommand` เตรียม worktree ใหม่ของ repository นั้น
- path ภายนอกต้องมี `type: "external"` และ `allowOutsideRoot: true`
- repository ที่ถูกเลือกทุกตัวต้อง initialize Git แล้ว

Change Loop ปฏิเสธ dependency ที่ไม่ใช่ Git เพราะมันล็อก commit และแยก directory
ที่กำลังขยับอย่างตรงไปตรงมาไม่ได้

ตรวจก่อนสร้าง change:

```bash
claude-foundation repos
```

## 2. เลือก Scope ของ Change

ใน change ให้เลือกเฉพาะ repository ที่ต้องใช้:

```json
{
  "version": 1,
  "repositories": [
    { "id": "api", "mode": "write", "dependsOn": [] },
    { "id": "app", "mode": "write", "dependsOn": ["api"] },
    { "id": "contracts", "mode": "read", "dependsOn": [] },
    { "id": "partner-sdk", "mode": "read", "dependsOn": [] }
  ]
}
```

ใช้ `write` เฉพาะ repository ที่ change จะสร้างโค้ด ใช้ `read` กับ test data,
contract, SDK และ integration dependency repository แบบ read เป็นส่วนหนึ่งของ
identity ของ proof แต่ไม่ใช่เป้าหมาย Build หรือ Land

ตรวจ selection ที่ resolve แล้ว:

```bash
claude-foundation repos <change>
```

## 3. ผูก Task กับ Repository

task implementation ทุกตัวต้องระบุ repository เจ้าของและ path ส่วน dependency
ทำให้ลำดับข้าม repository ชัดเจน:

```markdown
- [ ] **T001** Update API [repo:api] [kind:implementation] [paths:src/profile]
- [ ] **T002** Update app [repo:app] [kind:implementation] [depends:T001] [paths:src/profile]
- [ ] **T003** Verify contract [repo:app] [kind:contract] [depends:T001,T002]
```

Change Loop compile repository selection, task, provider และลำดับ Land เป็น
execution graph ให้เอง ไม่ต้องสร้างไฟล์ graph ที่สอง

## 4. ให้ Build สร้าง Sandbox ทั้งหมด

คำสั่งปกติของ agent สร้าง workspace ที่เลือกพร้อมกัน:

```bash
claude-foundation advance <change> --through build
```

`sandbox create --all` และ `sandbox inspect` ยังเป็น operator diagnostic ใต้
`help --all`; ผู้ใช้ไม่ต้องเรียงคำสั่งเอง

repository แบบ write ได้ Build worktree แยก ส่วน read และ external ที่มี Git ได้
detached worktree ที่ล็อก commit คำสั่งนี้ไม่ได้ทำให้ service ภายนอกหรือ directory
ทั่วไปปลอดภัย sandbox เป็น Git workspace isolation ไม่ใช่ OS security boundary

## 5. ต่อ Evidence ให้ครบ Scope

สำหรับ custom wiring ใน conditional `execution.yaml`, `repository` คือ working directory ของ provider ส่วน
`repositories` คือชุดทั้งหมดที่ command อ่าน:

```json
{
  "providers": {
    "integration": {
      "capability": "integration",
      "adapter": "command",
      "repository": "api",
      "repositories": ["api", "app", "contracts", "partner-sdk"],
      "command": ["npm", "run", "test:integration"]
    }
  }
}
```

Change Loop ส่ง environment สำคัญสองตัว:

- `FOUNDATION_REPOSITORY_ID` — ID ของ repository ที่เป็น working directory
- `FOUNDATION_REPOSITORIES_FILE` — JSON manifest ที่มี version และ map ID ทุกตัว
  ใน scope ไปยัง `path`, `access` และ `baseHead` ที่แยกพื้นที่แล้ว

โค้ด provider ต้องอ่าน manifest ห้ามสมมติว่า repository ทั้งห้าของบริษัทถูก
checkout เป็น sibling อยู่ในทุกเครื่อง

ชุด repository เป็นส่วนหนึ่งของ command deduplication และ identity ของ receipt
คำสั่งเหมือนกันแต่ scope ต่างกันจะรันแยก และ receipt บันทึก `repositoryIds` ครบ

## 6. Build และ Synchronize

วางแผน worker ขนานหลัง scope กับ dependency นิ่งแล้วเท่านั้น:

```bash
claude-foundation agents plan <change>
```

ถ้า change อื่นทำให้ repository ที่เลือกขยับ ให้ sync ก่อน Prove:

```bash
claude-foundation sandbox sync <change>
```

sync refresh child read worktree ได้แม้ control sandbox ใช้ copy mode และรัน
`setupCommand` ของ repository ใหม่หลัง refresh ถ้า setup หรือ provider ทิ้ง tracked
change ไว้ใน read workspace readiness จะ fail closed

## 7. Prove Graph ทั้งชุด

```bash
claude-foundation proof readiness <change>
claude-foundation proof run <change>
```

Prove รัน branch อิสระขนานกันได้และรักษา branch ที่เสร็จแล้วเมื่ออีก branch ล้ม
แต่ aggregate proof ยังต้องตรงกับ repository และ provider scope ปัจจุบันทั้งหมด
read dependency ที่ขยับต้อง sync และ prove ใหม่ Change Loop จะไม่รับรอง commit เก่า
ใต้ repository manifest ใหม่

Consumer quality ใช้ graph เดียวกันแต่ไม่เฉลี่ยคะแนนข้าม repository ต้องเพิ่ม
ทุก repository ที่ถูกเลือกไว้ใน `quality/foundation-quality.json`; ถ้าขาดตัวใด
ระบบจะ fail closed แต่ละ lane เก็บ commit, workspace digest, tool/config identity,
baseline และ assurance แยกกัน รัน `quality run --change <change>` ก่อน Prove
หรือให้ evidence bootstrap ต่อ quality config ที่ commit แล้วเป็น static-analysis
evidence ดูรายละเอียดที่ [Quality gate ของโปรเจกต์](/docs/th/consumer-quality/)

## 8. Land ตามลำดับที่ระบบรายงาน

read repository ไม่มี Land node ส่วน writable child repository จะ Land เป็น saga
ที่เรียงลำดับและ resume ได้:

```bash
claude-foundation land check <change>
claude-foundation land record <change> --repo <id> --commit <sha> --decision-ref <ref>
claude-foundation land resume <change>
```

ทำตาม structured next action จาก `land check` หรือ `land resume` Change Loop ตรวจ
commit และ root pointer ที่บันทึก แต่ไม่อ้างว่า atomic ข้าม remote อิสระ การ commit,
push และเปิด pull request ยังต้องได้รับอนุญาตจากผู้ใช้แยกต่างหาก

## แผนที่การกู้คืน

| เหตุการณ์ | Action ที่ถูกต้อง |
|---|---|
| target ที่เลือกขยับ | `sandbox sync <change>` แล้ว Prove ใหม่ |
| sync เจอ replay conflict | แก้ path ที่ระบุ ไม่ต้องสร้าง change ใหม่ |
| read repository สกปรก | เอา mutation ออกหรือแก้ setup/provider |
| setup ของ repository ล้ม | แก้ `setupCommand` แล้ว recreate หรือ sync ตามที่รายงาน |
| provider มองไม่เห็น repository | เพิ่มใน `repositories` ของ provider ห้าม hard-code local path |
| Land ถูกขัดจังหวะ | `land resume <change>` |

## User และ Agent ต้องทำอะไร

**User:** ยืนยัน write scope, ลำดับ dependency ที่มีผลสำคัญ และการตัดสินใจเรื่อง
external commit/CI ไม่ต้องสร้าง manifest, receipt, hash หรือ Land journal เอง

**Agent:** ตั้งค่า scope สามชั้นตามลำดับ ใช้ path จาก manifest รัน readiness ก่อน
เสียรอบ Prove ทำ recovery ตามที่ระบบรายงาน และสรุปว่า repository ใดถูกอ่าน เขียน
พิสูจน์แล้ว หรือยังรอ Land ห้ามให้ user คัดลอก protocol JSON และห้ามลด test ที่ต้อง
ใช้ห้า repository เหลือสามตัวเพียงเพราะ sandbox มีข้อมูลไม่ครบ
