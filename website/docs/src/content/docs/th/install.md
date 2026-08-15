---
title: ติดตั้ง
description: requirement และวิธีติดตั้ง Claude Foundation ลงในรีโปที่มีอยู่แล้วสองแบบ
---

Foundation ติดตั้ง **ครั้งเดียวต่อหนึ่งโปรเจกต์** ออกแบบมาสำหรับรีโปที่มีของอยู่แล้ว (brownfield) — มันจะเติมสิ่งที่ขาด รีเฟรชเฉพาะสิ่งที่มันเป็นเจ้าของ และไม่ยุ่งกับส่วนที่เหลือ

## Requirement

| สิ่งที่ต้องมี | เหตุผล |
|---|---|
| **Node.js 20.19 ขึ้นไป** | runtime เป็น ESM Node ล้วน ไม่มีขั้นตอน compile |
| **Git** | Build รันอยู่ใน worktree ที่แยกออกมา |
| **OpenSpec CLI 1.7.0** | ใช้ sync spec และ archive |
| **`jq`** | installer ใช้ merge `.claude/settings.json` ของคุณแทนที่จะเขียนทับ |

```bash
npm install -g @fission-ai/openspec@1.7.0
```

## ติดตั้งจาก source

```bash
git clone https://github.com/Maximumsoft-Co-LTD/claude-foundation.git
cd claude-foundation
./install.sh /path/to/your-project
```

## ติดตั้งด้วย Homebrew

```bash
brew tap maximumsoft-co-ltd/claude-foundation \
  https://github.com/Maximumsoft-Co-LTD/claude-foundation
brew install claude-foundation
claude-foundation init /path/to/your-project --yes
```

`claude-foundation init` คือ installer ตัวเดียวกัน ส่วน `--yes` คือข้ามการถามยืนยัน

:::tip
เปิด session ของ agent **ใหม่** ในโปรเจกต์ปลายทางหลังติดตั้งเสร็จ เพื่อให้ slash command ถูกลงทะเบียน
:::

## agent host อื่นนอกจาก Claude Code

Claude Code ไม่ต้องใช้ adapter ส่วน host อื่นใช้ `--host` เพื่อวาง adapter ทับการติดตั้งชุดเดียวกัน:

```bash
claude-foundation init /path/to/your-project --host cursor    # หรือ opencode, codex
```

| Host | adapter เพิ่มอะไรให้ |
|---|---|
| **Cursor** | คำสั่งทั้งแปดใน `.cursor/commands/` และ skill router แบบ always-on เป็น rule `.mdc` ที่ตั้ง `alwaysApply: true` |
| **OpenCode** | คำสั่งทั้งแปดใน `.opencode/commands/` และ guard plugin ที่ `.opencode/plugins/foundation.js` ซึ่ง replay hook ที่ ship มา — secrets guard กับ phase-mutation guard บล็อกแบบ live ส่วน lint ให้ feedback ตอนแก้ไฟล์ ส่วน skill กับ agent contract ไม่ต้องมี adapter เลย เพราะ OpenCode อ่าน `.claude/skills/` และ `AGENTS.md` ได้เอง |
| **Codex CLI** | prompt ทั้งแปดใน `$CODEX_HOME/prompts` (Codex ไม่มีไดเรกทอรี prompt ต่อโปรเจกต์) พร้อม ownership marker เพื่อให้การติดตั้งซ้ำรีเฟรชเฉพาะ prompt ของ Foundation โดยไม่ทับ prompt ชื่อซ้ำของผู้ใช้ |

:::caution[Codex ไม่มี tool hook]
Codex รัน guard แบบ live ไม่ได้ ดังนั้น secrets guard กับ phase-mutation guard จะไม่ทำงานที่นั่น — การบังคับใช้จึงเหลือ Land gate กับ `no-direct-main-commit.sh` ที่เป็น opt-in
:::

## ตรวจสอบ

```bash
claude-foundation version
claude-foundation doctor --stage change
```

`doctor` คือคำสั่งที่ควรหยิบใช้ทุกครั้งที่รู้สึกว่ามีอะไรผิดปกติ มันวินิจฉัยสถานะของโปรเจกต์ provider และ lifecycle และรายงาน apply transaction ที่ค้างอยู่ก่อนที่ Land จะไปเจอเข้า

## installer เป็นเจ้าของอะไรบ้าง

เส้นแบ่งนี้สำคัญ เพราะการอัปเกรดทำงานตามมัน ไฟล์ที่ Foundation เป็นเจ้าของจะ **ถูกคัดลอกทับทุกครั้งที่ติดตั้ง** และถูกบันทึกไว้ใน `.foundation/install-manifest.txt`

```text
.claude/orchestrator.md
.claude/commands
.claude/harness
.claude/skills
.claude/rules
.claude/hooks
openspec/schemas
.foundation/.gitignore
.foundation/README.md
WORKFLOW.md
```

ส่วนไฟล์ที่โปรเจกต์เป็นเจ้าของจะถูกสร้างให้ตอนยังไม่มี หรือ merge เข้าไป แต่ **ไม่เคยถูกเขียนทับ**

```text
.claude/settings.json          # merge hook ด้วย jq พร้อม backup ที่มี timestamp
openspec/config.yaml           # คัดลอกเฉพาะตอนยังไม่มี
openspec/repositories.yaml     # คัดลอกเฉพาะตอนยังไม่มี
foundation.json                # คัดลอกตอนยังไม่มี
CLAUDE.md / AGENTS.md          # เขียนทับเฉพาะบล็อก pointer ที่ทำเครื่องหมายไว้
```

spec, change ที่ยัง active, runtime state, agent ที่คุณเขียนเอง และ hook ของคุณรอดทุกการอัปเกรด และถ้ามี path ถูกถอดออกจากรายการที่ Foundation ดูแล มันจะถูกลบจากโปรเจกต์คุณก็ต่อเมื่อ manifest เคยระบุว่าเป็นเจ้าของไฟล์นั้นเท่านั้น — Foundation จึงไม่เคยลบไฟล์ที่มันไม่ได้ติดตั้งเอง

## หลักฐานฝั่งเบราว์เซอร์ยังเป็นของคุณ

Foundation ไม่ติดตั้ง test framework เบราว์เซอร์ หรือ dependency ของโปรเจกต์ให้ ถ้า claim ต้องการหลักฐานจากเบราว์เซอร์ ให้ติดตั้งและล็อกเวอร์ชัน `@playwright/test` พร้อม browser binary **ในแอปของคุณเอง** Foundation จะตรวจสอบและสั่งรันเครื่องมือที่มีอยู่ในเครื่อง แต่จะไม่โหลด browser framework ที่ไม่ได้ล็อกเวอร์ชันมาระหว่างพิสูจน์

กฎเดียวกันนี้ใช้กับทุกอย่าง: executable ทุกตัวที่ adapter เรียกใช้ต้องเป็นของรีโปคุณและถูกล็อกเวอร์ชันโดยรีโปคุณ ไม่ใช่โดย harness
