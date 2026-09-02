---
title: ติดตั้ง
description: requirement และวิธีติดตั้ง Change Loop ลงในรีโปที่มีอยู่แล้วสองแบบ
---

ติดตั้ง CLI `claude-foundation` ครั้งเดียวในเครื่อง แล้ว initialize Change Loop
ในแต่ละโปรเจกต์ การรัน `init` ซ้ำคือการอัปเกรดไฟล์ที่ระบบดูแล ใช้กับรีโปที่มีของ
อยู่แล้วได้: ระบบเติมสิ่งที่ขาด รีเฟรชเฉพาะไฟล์ของตัวเอง และไม่แตะไฟล์ของโปรเจกต์

## สิ่งที่จำเป็นและเครื่องมือที่แนะนำ

| เครื่องมือ | สถานะ | เหตุผล |
|---|---|---|
| **Node.js 20.19 ขึ้นไป** | จำเป็น | runtime เป็น ESM Node ล้วน ไม่มีขั้นตอน compile |
| **OpenSpec CLI 1.7.0** | จำเป็น | ใช้ sync spec และ archive |
| **Git** | แนะนำ | ใช้แยกงานด้วย worktree; โปรเจกต์ที่ dirty หรือไม่ใช่ Git จะใช้ isolated copy แทน |

```bash
npm install -g @fission-ai/openspec@1.7.0
```

แนะนำให้มี `jq` เพื่อ merge hook เข้า `.claude/settings.json` เดิม หากไม่มี
installer จะทำงานต่อโดยเก็บไฟล์เดิมไว้ และสร้าง
`.claude/settings.foundation.json` ให้ตรวจและ merge เอง

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
เวลาอัปเกรดให้รัน `brew upgrade claude-foundation` แล้วรัน `init` ในแต่ละโปรเจกต์
ที่ต้องการรีเฟรช

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
| **Codex CLI** | prompt ทั้งแปดใน `$CODEX_HOME/prompts` (Codex ไม่มีไดเรกทอรี prompt ต่อโปรเจกต์) พร้อม ownership marker เพื่อให้การติดตั้งซ้ำรีเฟรชเฉพาะ prompt ของ Change Loop โดยไม่ทับ prompt ชื่อซ้ำของผู้ใช้ |

:::caution[Codex ไม่มี tool hook]
Codex รัน guard แบบ live ไม่ได้ ดังนั้น secrets guard กับ phase-mutation guard จะไม่ทำงานที่นั่น — การบังคับใช้จึงเหลือ Land gate กับ `no-direct-main-commit.sh` ที่เป็น opt-in
:::

## ตรวจสอบ

```bash
claude-foundation version
claude-foundation doctor --stage change
```

`doctor` คือคำสั่งที่ควรหยิบใช้ทุกครั้งที่รู้สึกว่ามีอะไรผิดปกติ มันวินิจฉัยสถานะของโปรเจกต์ provider และ lifecycle และรายงาน apply transaction ที่ค้างอยู่ก่อนที่ Land จะไปเจอเข้า

## Commit การติดตั้ง

ถ้าเป็น Git project installer จะ stage ไฟล์ setup ที่ดูแลให้ แต่จะไม่ commit
ตรวจแล้ว commit ก่อนเริ่ม change แรก:

```bash
git status
git commit -m "chore: install Change Loop"
```

ขั้นนี้ต้องได้รับอนุญาตจากคุณอย่างชัดเจน ถ้ายังไม่ commit ระบบจะมองไฟล์ติดตั้งเป็น
ส่วนหนึ่งของ change ถัดไปตามจริง ทำให้ change แรกใหญ่ขึ้นและต้องใช้ isolated copy

## เริ่ม change แรก

เปิด session ใหม่ของ agent ในโปรเจกต์ที่ initialize แล้ว จากนั้นบอกผลลัพธ์ที่ต้องการ:

```text
/change ให้เจ้าของ account แก้ display name ของตัวเองได้
```

ตรวจข้อตกลงที่ agent เสนอ แล้วทำต่อด้วย `/build`, `/prove` และ `/land` ที่อนุมัติ
อย่างชัดเจน Agent จะรัน CLI และคำสั่ง recovery เบื้องหลังเอง ดูขั้นตอนทั้งหมดที่
[เริ่มใช้งาน](/docs/th/quickstart/)

## installer เป็นเจ้าของอะไรบ้าง

เส้นแบ่งนี้สำคัญ เพราะการอัปเกรดทำงานตามมัน ไฟล์ที่ Change Loop เป็นเจ้าของจะ **ถูกคัดลอกทับทุกครั้งที่ติดตั้ง** และถูกบันทึกไว้ใน `.foundation/install-manifest.txt`

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

spec, change ที่ยัง active, runtime state, agent ที่คุณเขียนเอง และ hook ของคุณรอดทุกการอัปเกรด และถ้ามี path ถูกถอดออกจากรายการที่ Change Loop ดูแล มันจะถูกลบจากโปรเจกต์คุณก็ต่อเมื่อ manifest เคยระบุว่าเป็นเจ้าของไฟล์นั้นเท่านั้น — Change Loop จึงไม่เคยลบไฟล์ที่มันไม่ได้ติดตั้งเอง

เพราะ `foundation.json` เป็นของโปรเจกต์ การอัปเกรดจะไม่เปลี่ยน budget หรือ
review policy เดิมให้เป็นค่า default รุ่นใหม่ อ่าน
[ตั้งค่า foundation.json](/docs/th/foundation-config/) ก่อนแก้ไฟล์นี้

## หลักฐานฝั่งเบราว์เซอร์ยังเป็นของคุณ

Change Loop ไม่ติดตั้ง test framework เบราว์เซอร์ หรือ dependency ของโปรเจกต์ให้ ถ้า claim ต้องการหลักฐานจากเบราว์เซอร์ ให้ติดตั้งและล็อกเวอร์ชัน `@playwright/test` พร้อม browser binary **ในแอปของคุณเอง** Change Loop จะตรวจสอบและสั่งรันเครื่องมือที่มีอยู่ในเครื่อง แต่จะไม่โหลด browser framework ที่ไม่ได้ล็อกเวอร์ชันมาระหว่างพิสูจน์

กฎเดียวกันนี้ใช้กับทุกอย่าง: executable ทุกตัวที่ adapter เรียกใช้ต้องเป็นของรีโปคุณและถูกล็อกเวอร์ชันโดยรีโปคุณ ไม่ใช่โดย harness
