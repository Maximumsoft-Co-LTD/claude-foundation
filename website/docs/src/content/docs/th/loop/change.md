---
title: /change
description: สร้างหรือทำข้อตกลง OpenSpec ให้ครบ — เจตนา delta spec tasks claim ความเสี่ยง และ evidence contract
---

```text
/change <intent | change ที่มีอยู่> [--prototype-selection <path>]
```

`/change` ผลิต **ข้อตกลง** คือคำแถลงที่คงอยู่และคนรีวิวได้ ว่าจะเปลี่ยนอะไรและจะรู้ได้อย่างไรว่ามันสำเร็จ ทุกขั้นที่อยู่ถัดจากนี้อ่านจากมัน

มันสร้างหรือทำ `openspec/changes/<id>/` ให้ครบ

## ประเมินอะไรบ้าง

ก่อนเขียนไฟล์ agent จะจำแนก change แล้วบันทึก

| คุณสมบัติ | ค่า | ใช้ทำอะไร |
|---|---|---|
| ambiguity | clear, unclear | ต้องไปสำรวจก่อนไหม |
| impact | low, medium, high | เลือก assurance profile |
| coupling | isolated, coupled | เลือก assurance profile |
| security trigger | จับตามความหมาย | บังคับให้ต้องมีรีวิวอิสระ |
| evidence capability | ดู [claim](/docs/th/evidence/claims/) | ต้องพิสูจน์อะไรบ้าง |
| size | — | **งบและการแบ่งงานเท่านั้น** |

ขนาดไม่เคยลดความเข้มลง นี่เป็นความตั้งใจ เพราะ change ที่ดูถูกที่สุดมักเป็นตัวที่ข้าม trust boundary

security trigger จับแบบ **ทั้งคำ** ไม่ใช่ substring เวอร์ชันก่อนหน้าจับคำว่า `access` ที่อยู่ใน "accessibility" และ `migration` ใน "migration guide" — ทำให้งานธรรมดาถูกบังคับให้ต้องรีวิวภายนอก ขณะที่พลาด "sign in with a passkey" ไปทั้งที่เป็นเคสที่ข้าม trust boundary จริง

## สองรูปแบบ

**Rapid** — proposal, tasks, evidence และ execution wiring ใช้กับงาน impact ต่ำที่แยกขาดและเป็นงาน unit/static เท่านั้น

**Standard** — เพิ่ม delta spec และ `design.md`

rapid จะ **อัปเกรดในที่** ถ้าพบความเสี่ยง เมื่อการประเมิน impact, coupling, security หรือ acceptance ทำให้ change ย้ายจาก rapid ไป standard คำสั่งจะพิมพ์บอกว่าลงเอยที่ schema ไหนและสร้างไฟล์ที่จำเป็นให้ แทนที่จะปล่อยให้ `validate` มาปฏิเสธทีหลังเพราะไฟล์ที่ไม่มีใครรู้ว่าต้องมี

## Delta spec

requirement เขียนเป็น delta เทียบกับ spec ปัจจุบัน — `## ADDED Requirements`, `## MODIFIED Requirements`, `## REMOVED Requirements` แต่ละอันมี scenario ที่สังเกตได้

:::caution[การเปลี่ยนชื่อ scenario]
OpenSpec อ่านบล็อก `## MODIFIED Requirements` ว่าเป็นรายการ scenario **ทั้งหมด** ดังนั้นการเปลี่ยนชื่อ scenario เงียบ ๆ จะถูก archive เป็นการลบ Foundation ปฏิเสธเรื่องนี้ก่อนถึง Land ไม่ใช่หลังจากนั้น

วิธีเปลี่ยนชื่อที่ถูกต้องคือใส่ชื่อเดิมไว้ใต้ `## REMOVED Requirements` และชื่อใหม่ใต้ `## ADDED Requirements` พร้อมรายการ scenario เต็ม

จงใจไม่มี flag ให้ข้าม เพราะ OpenSpec บังคับกฎเดียวกันตอน archive อยู่ดี การข้ามจึงเป็นแค่การเลื่อนความล้มเหลวไปอยู่หลังจุดที่ย้อนกลับไม่ได้
:::

## Acceptance ต้องตัดสิน ไม่ใช่อนุมาน

ผลลัพธ์บางอย่างเป็นเรื่องอัตวิสัย — "อันนี้รู้สึกใช่ไหม" — ซึ่งไม่มีเทสไหนตัดสินได้ change แบบ standard จึงต้อง **ตัดสินอย่างชัดเจน** ว่าต้องให้คนยอมรับหรือไม่ การนิ่งเงียบจะคงสถานะเป็น `undecided` และบล็อก validation มันไม่เคยกลายเป็นการอนุมัติ

## การตรวจสอบ

```bash
claude-foundation change validate <change>
claude-foundation change audit <change>
```

`validate` ตรวจตัว change และ evidence contract ส่วน `audit` รายงานความเชื่อมโยงของ scenario → claim → task → provider ทุก scenario ที่สังเกตได้ควรไปถึง claim และทุก claim ควรไปถึง provider ที่พิสูจน์มันได้จริง

## แก้ change ที่มีอยู่

ส่ง ID ของ change แทน intent การแก้เป็นเส้นทางปกติเมื่อ requirement ขยับ — คุณ **ไม่** เปิด change ตัวที่สอง Foundation จะ sync sandbox ที่มีอยู่และทำให้ proof ที่การแก้นั้นทำให้ล้าสมัยใช้ไม่ได้

## ปลดระวาง

change ที่พิสูจน์ไม่ได้ต้องปลดระวางอย่างชัดเจน

```bash
claude-foundation change abandon <change> --reason <reason> --decision-ref <ref>
```

มันปล่อย lease เก็บกวาด sandbox และย้ายไดเรกทอรีของ change, runtime state, receipt, evidence, transaction และ log ไปกักไว้ใต้ `.foundation/recovery/abandoned/<id>/` พร้อมบันทึก audit ที่ `.foundation/logs/abandoned.jsonl` มันไม่แตะ Git และปฏิเสธ change ที่ archive แล้ว ถ้าไฟล์ที่พิสูจน์แล้วอยู่ใน working tree ของคุณแล้ว มันจะหยุดและถามว่าจะเก็บไว้หรือย้อนกลับ

agent จะเสนอทางนี้เมื่อเข้าเงื่อนไข แต่จะไม่ปลดระวาง change โดยไม่ถามก่อน
