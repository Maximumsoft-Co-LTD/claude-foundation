---
title: การอนุมัติโดยคน
description: สี่จุดที่คนเข้ามาในวงจร — acceptance, review อิสระ, authority bridge และ host attestation — และตัวไหนที่บล็อกจริง
---

Foundation มีสี่จุดที่คนเข้ามาในวงจรได้ ทั้งสี่มักถูกสับสนกัน ทั้งที่ทำหน้าที่ต่างกัน

| จุด | ตอบคำถามอะไร | บล็อกไหม |
|---|---|---|
| **Acceptance** | นี่คือผลลัพธ์ที่เราต้องการหรือเปล่า | บล็อก — standard change ที่ยังไม่ตัดสินจะ validate ไม่ผ่าน |
| **Review** | การ implement นี้ดีพอไหม ตัดสินโดยคนนอก | บล็อก เมื่อเงื่อนไขนโยบายเข้าเงื่อนไข |
| **Authority bridge** | คำตัดสินกลายเป็น receipt ได้อย่างไร | เป็นกลไก ไม่ใช่ประตู |
| **Host attestation** | ปลอดภัยพอจะรันแบบไม่มีคนดูไหม | เฉพาะการรันแบบไม่มีคนดู |

:::caution[Land บังคับอะไรจริง ๆ]
Land ตรวจที่ **หลักฐาน** ไม่ใช่ที่ความยินยอม มันปฏิเสธที่จะไปต่อเมื่อหลักฐานขาด, stale,
fail หรือ inconclusive และตรวจ digest ของ receipt ทุกตัวเทียบกับ proof manifest อีกครั้ง
ก่อนจะ apply อะไรก็ตาม

agent ถูกสั่งแยกต่างหากให้อธิบายผลกระทบและเสนอทางเลือกให้คุณ ตรวจดู ไปต่อ หรือหยุดพัก
ก่อนจะ land — แต่นั่นคือคำสั่งที่ agent ปฏิบัติตาม ไม่ใช่กลอนที่ harness ล็อกไว้
คำสั่งที่ **บังคับ** ให้มีการตัดสินใจของคนที่บันทึกไว้จริงคือกลุ่มคำสั่งต่อเนื่อง ได้แก่
`land record`, `budget continue`, `change abandon`, `change waive` และ
`agents release --force` ซึ่งแต่ละตัวต้องมี `--decision-ref`
ระบุการตัดสินใจที่คุณทำจริง

`change waive` คือทางออกที่ถูกบันทึกไว้สำหรับ gate ที่รันแล้ว fail:
มันถอนการบังคับใช้ capability หนึ่งตัวตามการตัดสินใจชัดเจนของคุณ
เดินทางเป็น advisory `user-waived` ผ่าน proof เข้าไปถึง archive และ `--revoke`
คืนข้อบังคับกลับมา ส่วน review กับ acceptance ถูกปฏิเสธที่นั่น — waiver
ของสองตัวนี้ประกาศใน `foundation.json` ตามที่อธิบายด้านล่าง
:::

## Acceptance

Acceptance คือการที่คนที่ระบุชื่อได้บอกว่าผลลัพธ์นี้คือสิ่งที่ต้องการ
เป็นจุดเดียวที่พูดถึง *ตัวผลิตภัณฑ์* ไม่ใช่ *ตัวงาน*

**standard change เริ่มต้นที่ยังไม่ตัดสิน และการยังไม่ตัดสินคือการบล็อก**
`change validate` จะไม่ผ่านจนกว่าจะมีคนตัดสิน ซึ่งตั้งใจให้เป็นแบบนี้
เพราะความเงียบไม่ใช่การยินยอม และ change ต้องไม่ค่อย ๆ ไหลไปเป็น "ยอมรับแล้ว"
เพียงเพราะไม่มีใครคัดค้าน

คุณตัดสินมันอย่างชัดเจน ไม่ทางใดก็ทางหนึ่ง

```bash
# ไม่มีอะไรเชิงอัตวิสัยต้องเซ็น — การตรวจแบบ deterministic คือทั้งหมดแล้ว
claude-foundation change resolve <change> --acceptance-not-required

# ต้องมีคนดูแล้วบอกว่าใช่
claude-foundation change resolve <change> \
  --acceptance-required --acceptance-reason "<ทำไมต้องให้คนตัดสิน>"
```

rapid change เริ่มที่ `not-required` แทน เพราะ rapid สงวนไว้สำหรับงาน impact ต่ำที่แยกอิสระ
การประกาศ claim ที่มี capability `acceptance` ก็ทำให้ต้องมี acceptance เช่นกัน
และการประกาศนั้นมีน้ำหนักเหนือ `--acceptance-not-required`

receipt ของ acceptance ที่ผ่านต้องมีชื่อคนจริง การตัดสิน `accept` ที่ชัดเจน
เกณฑ์การยอมรับอย่างน้อยหนึ่งข้อที่ไม่ซ้ำกัน และบันทึกสิ่งที่สังเกตเห็น
มันถูก validate ใหม่ทุกครั้งที่อ่าน เทียบกับ workspace hash, claim ที่อยู่ในขอบเขตตอนนี้
และเหตุผลที่ระบุไว้ — ถ้าอย่างใดอย่างหนึ่งเปลี่ยนไปทีหลัง acceptance จะกลายเป็นไม่ถูกต้อง
แทนที่จะถูกยกยอดมาเงียบ ๆ

## Review อิสระ

Review ถามว่าการ implement นี้ดีพอไหม ผู้รีวิวเป็นคน **หรือ** AI ตัวอื่นก็ได้
สิ่งที่สำคัญคือความเป็นอิสระ ไม่ใช่ว่าเป็นคนหรือเครื่อง

เมื่อใช้ `workflow.reviewPolicy: "risk-tiered"` ทุก change ได้รับ review และระดับ
ความเสี่ยงกำหนดเส้นทางที่มีขอบเขต:

- **low:** AI full review หนึ่งรอบ ถ้าต้องแก้สาระสำคัญจะเลื่อนเป็น medium
- **medium:** full review หนึ่งรอบ แก้รวมหนึ่ง batch แล้วใช้ fresh-session delta
  ได้ไม่เกินหนึ่งรอบเพื่อปิด finding IDs เดิม
- **high:** ตัดสินใจความเสี่ยงสำคัญใน Decision Sheet ต้นทาง ใช้ AI full review
  หนึ่งรอบและ post-correction delta ได้ไม่เกินหนึ่งรอบ โดยไม่บังคับ human final

authorization/secrets, public หรือ cross-repository contract, migration/การแก้
state ที่ย้อนกลับยาก, เงิน, concurrency, replay/idempotency, broker/real wire
และการ activate legacy behavior เป็นสัญญาณ high risk

มีสองคุณสมบัติกำหนดว่าใครรีวิวได้ ทั้งคู่ยกเว้นได้ และยกเว้นด้วยวิธีเดียวกัน
คือคีย์ใน `foundation.json` ที่ commit ไว้ ไม่ใช่ flag บนคำสั่ง — ข้อยกเว้นที่ฝ่ายถูกรีวิว
เขียนเองได้ตอนที่โดนจับ ไม่นับเป็นข้อยกเว้น

**ความเป็นอิสระ** โดยปกติตัวตนของผู้รีวิวต้องต่างจากผู้ implement ทุกคน
และ session ของ AI ผู้รีวิวต้องต่างจาก session ของ AI ผู้ implement ทุกตัว
โปรเจกต์ที่ขับด้วย session เดียวไม่มี session ที่สองให้ส่ง packet ไปหา
จึงตั้ง `"review": { "independence": "self" }` เพื่อให้ผู้รีวิวใช้ตัวตนและ session
เดียวกับผู้ implement ได้ ใช้ได้ทุกระดับ impact และจะประทับ trigger
`independence-waived-self-review` ลงในนโยบาย receipt ยังบันทึกสิ่งที่เกิดขึ้นจริง
คือ `review.policy.independent` ยังเป็น `false` โดยมี `independenceWaived: true`
อยู่ข้าง ๆ เพื่ออธิบายว่าทำไมมันผ่าน

**ความหลากหลาย** โดยปกติ AI ผู้รีวิวต้องมาจากคนละ provider
และคนละตระกูลโมเดลกับผู้ implement โปรเจกต์ที่ใช้โมเดลเดียวตั้ง
`"review": { "diversity": "single-model" }` ใน `foundation.json` ได้
ซึ่งจะผ่อนความหลากหลายเป็น *preferred* และประทับ trigger
`diversity-waived-single-model` ลงในนโยบาย

profile ที่ให้มารองรับทั้งสองแบบ: ทีม Codex ล้วนเลือก `codex-sol` และทีม Claude
Code ล้วนเลือก `claude-opus` โดยคง `independence: "required"` ไว้ Foundation
จะเปิด reviewer แบบ read-only ใน session ใหม่ และปฏิเสธ identity/session ของตัว coding

การยกเว้นแต่ละอันผ่อนเฉพาะแกนของตัวเอง การรีวิวตัวเองด้วยโมเดลเดียวกันบนงาน critical
ต้องประกาศทั้งสองอัน ประกาศอันเดียวอีกอันยังบังคับอยู่ และการถอนคีย์ใดคีย์หนึ่งออก
จะทำให้ receipt ที่มันเคยอนุญาตใช้ไม่ได้ เพราะนโยบายรีวิวเป็นส่วนหนึ่งของ
contract fingerprint

:::note[วงจรตามความเสี่ยง]
ระบบบังคับเพดานก่อน dispatch: low ได้ full หนึ่งรอบ และถ้าแก้จะเลื่อนเข้าเส้นทาง full/delta แบบเดียวกับ medium/high infrastructure retry หนึ่งครั้งแยกจาก delivered wave หลัง AI สองรอบจะไม่เปิด review ใหม่ defect ใน contract ปิดได้เฉพาะผ่าน claim และ critical-case receipt ปัจจุบัน ส่วน contract ขัดแย้งจริงจึงเปิด Decision Sheet แบบ batch และถ้าขาดสิทธิ์จะเป็น external handoff ประวัติเป็น SHA-256 hash chain ถ้าโซ่ขาดระบบจะ fail closed
:::

## Authority bridge

ทางปกติเริ่มด้วยคำสั่งที่ทำต่อได้คำสั่งเดียว

```bash
claude-foundation proof advance <change>
```

คำสั่งนี้สร้างหรือ reuse request และไม่ poll external wait ที่ไม่เปลี่ยน เมื่อส่ง packet
จริง การรีวิว Codex หรือ Claude Code ที่ตั้งค่าไว้ใช้ `authority run` ส่วน named-human review ต้องใช้
`authority dispatch` ก่อน `authority record` และ human acceptance ใช้
request/status/record โดยไม่ต้อง review dispatch

`authority request` จะไม่ยอมเปิดถ้า task การ implement ยังไม่เสร็จ
หรือถ้า authority นั้นไม่ได้ถูกบังคับจริง คำขอถูกผูกกับ workspace hash
หมดอายุใน 24 ชั่วโมง และใช้ได้ครั้งเดียว Dispatch จะบันทึก full/delta packet ที่แน่นอน
และใช้ attempt แม้ reviewer crash แต่เฉพาะ response ที่เสร็จจริงเท่านั้นที่เปิด route ถัดไป

`authority record` ตรวจคำตอบเทียบกับคำขอ — version, request ID, change ID, type
และ workspace hash ต้องตรงกันทั้งหมด — แล้วจึงรัน validator ของ receipt ตามปกติ
ถ้าคำตอบบอกว่าผ่านแต่ receipt ที่ได้จะไม่ถูกต้อง ระบบจะคืน receipt เดิมกลับมา
และคำสั่งล้มเหลว คำขอที่เสร็จแล้วเล่นซ้ำไม่ได้

:::tip
`authority status --template` คือ flag ที่ทำให้ทำมือได้จริง
มันพิมพ์รูปแบบคำตอบที่ระบบคาดหวังออกมาตรง ๆ คุณจึงแค่เติมคำตัดสิน
ไม่ต้องประกอบ JSON schema ขึ้นมาเองจากเอกสาร
:::

ถ้า workspace เปลี่ยนหลังจากเปิดคำขอไปแล้ว คำขอจะ stale และต้องเปิดใหม่
คำตัดสินผูกกับ code ที่มันได้เห็น ไม่ใช่ผูกกับ change แบบลอย ๆ

## Host attestation

ตัวนี้ **ไม่ใช่** การอนุมัติโดยคน แม้จะอยู่ใกล้กัน

`sandbox challenge` คู่กับ `doctor --unattended --attestation <file>`
คือคำแถลงที่เซ็นแล้วจาก host ที่เชื่อถือได้ ว่าขอบเขตของ sandbox ปลอดภัยพอ
จะรันโดยไม่มีคนเฝ้า มันเซ็นด้วย Ed25519, nonce หมดอายุใน 10 นาที
และ nonce ที่ใช้แล้วถูกบันทึกไว้เพื่อไม่ให้เล่นซ้ำได้

trust root เป็นไฟล์ระบบที่ root เป็นเจ้าของเท่านั้น และ Foundation
ปฏิเสธการรันแบบไม่มีคนดูด้วยตัวเองเมื่อพบ socket ของ container ที่เขียนได้,
token ของ Kubernetes service account ที่ mount ไว้ หรือ SSH agent socket ที่ mount ไว้
ซึ่งคือสิ่งที่จะทำให้งานที่อ้างว่า "อยู่ใน sandbox" เอื้อมออกไปนอก sandbox ได้

การตรวจพบไม่ใช่การอนุญาต การพบว่ารันแบบไม่มีคนดูได้ ไม่เคยแปลว่าได้รับอนุญาตให้ทำ

## การตัดสินใจถูกบันทึกไว้ที่ไหน

การตัดสินใจอยู่ใน change packet ไม่ใช่ใน transcript ของแชท
เหตุผลของ acceptance อยู่ในสัญญา คำตัดสินของ review อยู่ใน receipt
และการตัดสินใจให้ทำต่อถูกระบุด้วย `--decision-ref` ของมัน
กฎที่อยู่ใต้ทั้งสี่จุดคือกฎเดียวกัน **การอนุมัติไม่เคยถูกอนุมานจากความเงียบ
และการที่คำสั่งใช้ได้ ไม่เคยแปลว่าได้รับอนุญาตให้รันมัน**
