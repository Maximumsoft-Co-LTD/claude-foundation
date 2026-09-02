---
title: คำสั่ง CLI
description: คำสั่งที่ agent ของคุณรัน จัดกลุ่มตามหน้าที่และระดับอำนาจที่ต้องใช้
---

agent ของคุณเป็นคนรันคำสั่งเหล่านี้ คุณแทบไม่ต้องรันเอง เอกสารนี้มีไว้ให้คุณอ่านออกว่า agent กำลังทำอะไร และรันเองได้เมื่ออยากรัน

ทุกคำสั่งตอบ `--help` และ `claude-foundation describe [command] [--json]` อธิบายทั้ง surface — รวม slash command ทั้งแปด เรียกได้ทั้งชื่อเปล่าและแบบ `/slash` โดยอ่านจากไฟล์คำสั่งที่ ship มาโดยตรง จึงไม่มีสำเนาที่สองให้ drift

## อ่านอย่างเดียว

รันได้ทุกเมื่ออย่างปลอดภัย ไม่แก้อะไรทั้งสิ้น

| คำสั่ง | ใช้ทำอะไร |
|---|---|
| `changes` | แสดง change ที่ active สถานะ lifecycle และ action ถัดไปของแต่ละตัว |
| `doctor [--stage change\|build\|prove] [--change <id>]` | วินิจฉัยความพร้อมของโปรเจกต์ provider และ lifecycle |
| `packet <change> [--phase <phase>] [--task <id>]` | อ่าน handoff ของ operation ปัจจุบัน |
| `metrics <change>` | ดูการใช้งานที่วัดได้ งบที่ใช้อยู่ ต้นทุน และเวลาการรัน |
| `change audit <change>` | ตรวจความเชื่อมโยงของ scenario claim task และ provider |
| `proof readiness <change>` | blocker แบบมีชนิด พร้อมคำสั่งถัดไปที่ถูกต้อง |
| `land check <change>` | ตรวจว่า projection ที่พิสูจน์แล้วยัง land ได้ |
| `handoff status <change>` | ดู operation ที่ต้องสิทธิ์ภายนอกและผลต่อ Land |
| `handoff packet <change> [--id <H00n>]` | อ่าน packet ที่ไม่มี credential สำหรับ DevOps/SRE owner |
| `repos [change]` | ดู topology และการเลือกรีโป |
| `models` | ดูนโยบาย model tier |
| `providers` | ดูการต่อสายหลักฐานระหว่างนิยาม change contract |
| `version` | พิมพ์เวอร์ชันแพ็กเกจที่ติดตั้งอยู่ |

## Consumer quality

ดูการตั้งค่า language profile, baseline และ rollout policy ที่
[Quality gate ของโปรเจกต์](/docs/th/consumer-quality/)

| คำสั่ง | ใช้ทำอะไร |
|---|---|
| `quality discover [--change <id>]` | อ่าน manifest แล้วรายงานภาษา profile provider และ capability ที่ไม่รองรับ โดยไม่รัน command ของโปรเจกต์ |
| `quality init [--change <id>] [--write] [--force] [--ci github]` | preview consumer quality config แล้วเขียน config/ตัวอย่าง GitHub workflow เมื่อสั่งชัดเจน |
| `quality doctor [--change <id>] [--enforce]` | ตรวจ repository ที่เลือก, provider config, executable ที่พร้อมใช้ และ mutation isolation |
| `quality run [--change <id>] [--repo <id>] [--capability <name>] [--full] [--shard-index <n> --shard-count <n>] [--enforce]` | รัน lane แยก repository และใช้ changed-code หรือ full-inventory ratchet |
| `quality report` | อ่าน summary ล่าสุดแบบไม่เฉลี่ยกลบ repository |
| `quality baseline [--repo <id>] [--capability <name>] [--write --decision-ref <ref> --reason <why>]` | preview หรืออนุมัติ versioned CRAP/mutation baseline อย่างชัดเจน |
| `quality debt` | สร้าง debt แบบ JSON/Markdown จากรอบล่าสุดโดยไม่ขยาย Change scope |

## วงจรชีวิตของ change

| คำสั่ง | ใช้ทำอะไร |
|---|---|
| `change new <intent> [--rapid]` | สร้างข้อตกลงของ change |
| `change start --template \| <draft.json>` | สร้างและเริ่ม change ที่แยกออกมาจาก draft ที่ผ่านการตรวจแล้วหนึ่งอัน |
| `change resolve <change> …` | บันทึกการตัดสินใจเรื่อง impact coupling security และ review |
| `change validate <change>` | ตรวจ change และ evidence contract ที่รันได้ |
| `sandbox create <change> [--all]` | สร้างพื้นที่ Build ที่แยกออกมา |
| `sandbox sync <change>` | ซิงก์การแก้ข้อตกลงที่ตั้งใจเข้าไปใน Build |
| `proof advance <change>` | ทาง Prove ปกติที่ทำต่อได้: เดิน gate ปัจจุบัน ใช้ evidence ที่ยัง valid และคืน repair batch เดียวหรือ external handoff |
| `proof collect <change>` | การเก็บระดับล่างสำหรับวิเคราะห์หรือ integration ที่ตั้งใจไว้ |
| `proof run <change>` | atomic run ระดับล่างเมื่อไม่ต้องมี external handoff ที่ทำต่อได้ |
| `handoff record <change> --id <H00n> …` | บันทึก accepted/completed/rejected จาก operator ที่ระบุชื่อพร้อม reference |

## การต่อสายหลักฐาน

| คำสั่ง | ใช้ทำอะไร |
|---|---|
| `evidence detect <change>` | ตรวจหา provider ของโปรเจกต์ที่ปลอดภัย โดยไม่รันมัน |
| `evidence init <change> [--write]` | ดูตัวอย่าง หรือเขียนการต่อสายที่มั่นใจสูงลงไปจริง |
| `evidence doctor <change>` | อธิบายการต่อสายที่ตั้งไว้ ที่ตรวจพบได้ และที่ยังไม่ลงตัว |
| `evidence verify-ci <change> <provider> <signed.json>` | ตรวจ provenance ของ CI ที่เซ็นและผูกกับ workspace ของ provider |

## อำนาจจากภายนอก

การรีวิวและการยอมรับที่ทำต่อข้าม session ได้ ปกติใช้ `proof advance`; ใช้คำสั่ง
เหล่านี้โดยตรงเมื่อตรวจวิเคราะห์หรือทำ integration ที่ตั้งใจไว้

| คำสั่ง | ใช้ทำอะไร |
|---|---|
| `authority request <change> --type review\|acceptance` | สร้างคำขอภายนอกที่ทำต่อได้ |
| `authority status <change> [--request <id>] [--template]` | ดูสถานะ `--template` ออกไฟล์คำตอบให้กรอก |
| `authority dispatch <change> …` | reserve full/delta packet ที่แน่นอนเมื่อส่งให้ AI หรือ named human review |
| `authority run <change> …` | รัน AI reviewer ที่ตั้งค่าไว้แบบ read-only/ephemeral และบันทึก session จริง |
| `authority abort <change> …` | ปิด request ที่ใช้ต่อไม่ได้โดยไม่อ้างว่า dispatched attempt เสร็จแล้ว |
| `authority record <change> --request <id> --response <file>` | ตรวจคำตอบที่ผูกกับ host แล้วบันทึกเป็นหลักฐาน |
| `evidence record <change> <provider> <status> …` | ทางเชื่อมระดับล่างสำหรับหลักฐานที่สังเกตจากภายนอก |

:::caution
`evidence record` เป็นทางเชื่อมระดับล่าง **ไม่ใช่** ขั้นตอนกู้คืนแบบโต้ตอบตามปกติ มันปฏิเสธ receipt ที่ผ่านของ provider ทุกตัวที่ harness เป็นคนรัน
:::

## การ land

| คำสั่ง | ใช้ทำอะไร |
|---|---|
| `land archive <change>` | apply, ซิงก์, ตรวจ, archive และเก็บกวาด |
| `land record <change> --repo <id> --commit <sha> --decision-ref <ref>` | ผูก commit ของรีโปลูกหลังมีการตัดสินใจของผู้ใช้ที่บันทึกไว้ |
| `land resume <change>` | ทำ Land saga ที่ถูกขัดจังหวะหรือแบบหลายรีโปต่อ |

## การกู้คืนและทางออกฉุกเฉิน

| คำสั่ง | ใช้ทำอะไร |
|---|---|
| `change abandon <change> --reason <r> --decision-ref <ref>` | กัก change ที่พิสูจน์ไม่ได้ |
| `change waive <change> --capability <c> --reason <r> --decision-ref <ref>` | ถอนการบังคับใช้ capability หนึ่งตัวหลัง provider ของมันรันแล้วล้มเหลว `--revoke` คืนข้อบังคับ |
| `budget continue <change> --reason <r> --decision-ref <ref>` | เปิดหน้าต่างทำงานต่อหนึ่งครั้งตามนโยบาย |
| `agents release <change> <task> --owner <id> [--lease-id <id>] [--force]` | ปล่อย lease โดย generation ที่ถูก takeover ต้องใช้ lease id ที่ acquire มา และ `--force` ใช้ยึดคืนจากเจ้าของที่ crash |

คำสั่งที่ต้องใส่ `--decision-ref` ต้องการ **การตัดสินใจของผู้ใช้ที่ host บันทึกไว้อย่างชัดเจน** runtime จะไม่รับดุลพินิจของ agent มาแทน

## การดูแลระบบ

| คำสั่ง | ใช้ทำอะไร |
|---|---|
| `init [target-path] [--yes]` | ติดตั้งหรืออัปเกรด Change Loop ในโปรเจกต์ |
| `help [--all]` | คำสั่งหลัก `--all` รวม route ที่เก็บไว้เพื่อความเข้ากันได้ |
| `dashboard [-up\|-status\|-down]` | จัดการ client แสดงสถานะทีม (ตัวเลือกเสริม) |
| `migrate [legacy-id] [--apply]` | ย้ายบันทึก workflow เก่าที่ยืนยันได้ |

## เวอร์ชันของ protocol

สัญญาที่มองเห็นจากภายนอกถูกตรึงไว้ใน `.claude/harness/protocol.json` การติดตั้งที่ปนกันหลายรุ่นจะล้มเหลวทันทีตอนโหลด แทนที่จะไปพังกลางทาง Land

| Pin | v3.4.10 |
|---|---|
| runtime | 3.4.10 |
| runtime API | 26 |
| provider protocol | 13 |
| evidence schema | 1, 2 |
| packet schema | 10 |
| proof protocol | 7 |
| review protocol | 4 |
| acceptance protocol | 2 |
| semantic acceptance protocol | 1 |
| attestation protocol | 1 |
| authority protocol | 2 |
| quality capabilities protocol | 1 |
| CRAP protocol | 1 |
| automated mutation protocol | 1 |

:::note
provider protocol 13 หมายความว่า receipt ที่บันทึกด้วย protocol ก่อนหน้าจะอ่านได้เป็น `provider-version-stale` และต้องพิสูจน์ใหม่ เพราะ receipt เก่าบอกไม่ได้ว่ามันผ่าน semantic-acceptance protocol 1 หรือไม่
:::
