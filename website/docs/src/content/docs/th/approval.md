---
title: การอนุมัติโดยคน
description: การตัดสินใจไม่กี่อย่างที่เป็นของคุณ เกิดเมื่อไร และจะเกิดอะไรถ้าไม่ตัดสิน ตามด้วยกลไกของ agent และ host
---

<!-- docs-audience: users -->
**ผู้อ่าน:** ผู้ใช้โปรเจกต์ อ่านหน้านี้เพื่อรู้ว่าการตัดสินใจใดเป็นของคุณ และจะเกิดอะไรถ้าไม่ตัดสิน ส่วน agent ดูแลขั้นตอนระบบตามปกติ รายละเอียดระดับคำสั่งรวมอยู่ใน [For agents and integrators](#for-agents-and-integrators)

Change Loop ไม่เคยตัดสินแทนคุณว่าคุณต้องการอะไร คุณอนุมัติ agreement ก่อนมีการสร้างอะไร
ตัดสินใจเมื่อมี trade-off จริง บอกว่าผลลัพธ์ใช่สิ่งที่ต้องการหรือไม่เมื่อกำหนดให้ต้องมี
และให้อำนาจ Land ส่วน agent และ harness บันทึกการตัดสินใจเหล่านั้นและทำงานประจำที่เหลือทั้งหมด
reviewer และ trusted host สร้างหลักฐานของตนเอง
มาที่หน้านี้เมื่อมีคำถามมาถึงคุณแล้วอยากรู้ว่ามันแปลว่าอะไร
หรืออยากรู้ว่าระบบจะไม่ขออะไรจากคุณเลย

![จุดที่การตัดสินใจของคุณอยู่ตลอด Change, Build, Prove, Land และหลัง Land และสิ่งที่ไม่ถามคุณ](/docs/diagrams/approval-th.svg)

## การตัดสินใจของคุณโดยสรุป

| การตัดสินใจ | เกิดเมื่อไร | สิ่งที่คุณพูดหรือทำ | ถ้าคุณไม่ตัดสิน |
|---|---|---|---|
| **อนุมัติ agreement** | ท้าย Change และอีกครั้งหลัง amendment ที่ลบพฤติกรรมที่เคยอนุมัติ | อ่านหน้าอนุมัติแล้วตอบ "ลุยเลย", "go ahead" หรือ "approve" หรือแก้ไข | Build ไม่เริ่ม ความเงียบและความเร่งด่วนไม่นับเป็นการอนุมัติ |
| **ตัดสิน trade-off ของ product** | เมื่อ agreement ไม่สามารถระบุความหมาย trade-off หรือขอบเขตที่กว้างขึ้นได้ | ตอบคำถามด้วยภาษาปกติ | Flow รอคำถามข้อนั้นข้อเดียว ไม่มีการเดา |
| **ยอมรับผลลัพธ์ (acceptance)** | หลัง Prove เฉพาะเมื่อ change กำหนดให้ต้องมีคนยอมรับ | บอกพร้อมชื่อของคุณว่าผลลัพธ์ใช่สิ่งที่ต้องการหรือไม่ | acceptance ที่จำเป็นยังเปิดค้างและ change รออยู่ standard change ที่ยังไม่ตัดสินจะบล็อก validation |
| **Waive gate ที่ไม่ผ่าน** | check รันแล้วไม่ผ่าน และคุณเลือกไม่แก้ | ให้เหตุผลที่ชัดเจน | ความล้มเหลวยังเป็นความล้มเหลว และ Land จะปฏิเสธ |
| **ตัดสินหลัง review ใช้รอบหมด** | รอบ review ที่อนุญาตใช้หมดแล้วแต่ยังไม่มี verdict | เลือก: human verdict, AI อีกหนึ่งรอบ หรือพัก | change หยุดรอ review ที่ใช้รอบหมดแล้วไม่เคยถูก waive |
| **อนุญาต Land** | เมื่อ change เป็น `proven` | `/land <change>` หรือบอกตั้งแต่ต้นว่า "ทำจนจบ" | ไม่มีอะไรถูก apply เข้าโปรเจกต์ `proven` ไม่ใช่ delivered |
| **อนุญาต side effect** | commit, push, เปิด PR, รัน external provider, ใช้เกิน budget | บอกตรง ๆ (`/deliver`, "push ด้วย", "ตกลง") | การกระทำนั้นไม่รัน ระบบถามไม่ได้สันนิษฐาน |
| **แก้สิ่งที่มีแต่คุณแก้ได้** | login, network หรือ disk เต็มขวางความคืบหน้า | แก้ใน environment ของคุณเอง | change คงสถานะไว้และทำต่อเมื่อคุณแก้เสร็จ |

ที่เหลือทั้งหมดเป็นของ agent หรือ harness: setup, เตรียมเครื่องมือ, ซ่อม sandbox,
sync conflict, การรอ resource ร่วม และการแก้ที่วนซ้ำ

:::caution[Land บังคับอะไรจริง ๆ]
คำสั่ง `/land <change>` ที่ตรง change ให้อำนาจสำหรับ transaction ที่กู้คืนได้
และสร้าง grant ภายในที่ผูกกับ session Land เป็นด่านบังคับเพียงด่านเดียว: จะปฏิเสธ
เว้นแต่การอนุมัติ spec ของคุณยังใช้ได้ change ถูก prove แล้ว assurance ผ่าน และ proof
ตรงกับ workspace ปัจจุบัน หลักฐานที่ขาด, stale, fail, inconclusive หรือ invalid
จะไม่ถูก Land เลย ส่วน proof ที่เก่าแล้วจะถูก prove ใหม่ก่อน Land ยังปฏิเสธเมื่อมี
target conflict, path ไม่ปลอดภัย, repository identity กำกวม หรือ transaction เสียหาย
และจะแสดง path ของ control-plane, CI หรือ secret และไฟล์ที่ change ลบก่อน apply

ก่อนถึง Land ไม่มีอะไรรอคุณนอกจากการตัดสินใจของคุณเอง: อนุมัติ spec, ความหมายของ
product หรือ trade-off, ผล acceptance, waiver, review ที่ใช้รอบหมด, Land, การ commit,
push หรือ side effect อื่น, budget หรือสาเหตุที่มีแต่คุณแก้ได้ (login, network, disk เต็ม)
ส่วน setup, sync conflict, การรอ resource ร่วม และการแก้ที่วนซ้ำเป็นงานของ agent หรือ harness
:::

## อนุมัติด้วยคำพูดของคุณเอง

คำตอบในแชทคือการตัดสินใจ การตอบคำถามขออนุมัติ spec หรือ amendment ว่า "ลุยเลย",
"ทำเลย", "ทำไปเลย", "go ahead" หรือ "approve" ถือเป็นการอนุมัติ agent จะบันทึกไว้และ
ไม่ถามซ้ำ การบอกตั้งแต่ต้นว่า "ทำจนจบ" หรือ "ทำให้เสร็จ" ให้สิทธิ์ Land สำหรับ change
นั้นด้วย คำเร่งอย่างเดียว ("ด่วน", "รีบ demo") และความเงียบไม่ใช่การอนุมัติ และคำขอที่
ปฏิเสธ ("อย่าเพิ่ง push") ไม่ใช่อำนาจ

Commit และ push เกิดได้เฉพาะผ่าน `/deliver` หรือคำสั่งตรงของคุณ ("commit ให้เลย",
"push ด้วย") ระหว่าง Build หรือ Prove `git commit` หรือ `git push` จาก main checkout
ที่ไม่ได้สั่งจะไม่รัน แต่กลายเป็นคำถาม และเมื่อคุณตอบตกลงจึงรันได้ "เปิด PR ให้เลย"
หรือ "open a PR" ถือเป็น `/deliver` กฎฉบับเต็มอยู่ใน `WORKFLOW.md` หัวข้อ
"Authority from the user's words"

<a id="approval-package-preview-และ-role-lane"></a>

## หน้าอนุมัติ, preview และ role lane

เมื่อเริ่ม change และอีกครั้งเมื่อ `advance` ถามขออนุมัติ spec คุณจะได้รับ path ของ
**หน้าอนุมัติ** ซึ่งเป็นไฟล์เดียว `.foundation/previews/<change>/prototype.html` ที่ skill
prototype เขียนให้ change นี้ เปิดดูได้เลย หน้านี้เปิดด้วย prototype ที่คลิกได้ในหน้าตาของ
โปรเจกต์คุณ ตามด้วยแถบข้อเท็จจริงสั้น ๆ แล้วเรียงต่อดังนี้ สิ่งที่ prototype ต้องแสดงและ
แสดงแล้วเท่าไร ก่อนและหลัง เส้นทางที่ผู้ใช้เดิน รวมถึงทางที่พลาด กรณีพลาดพร้อมวิธีกู้คืน
วิธีย้อนกลับและใครได้รับผลกระทบ และส่วน **รายละเอียดผู้ตรวจ** ที่พับไว้ สิ่งที่ agreement
ไม่ได้ระบุจะเขียนว่า **ไม่ทราบ** ไม่มีการเดา หน้านี้ไม่มีปุ่มอนุมัติหรือฟอร์ม คุณตัดสินใจ
ด้วยการตอบในแชท

harness ไม่เขียนหน้านี้ แต่คำนวณข้อเท็จจริงและตรวจหน้า:

- **ข้อเท็จจริง** ระดับความเสี่ยง (Low, Medium, High หรือ Critical คำนวณจาก impact และ
  risk signal) technical domain ที่เกี่ยวข้อง และ artifact สำหรับอนุมัติแยกตามบทบาท
  (product-owner, tech-lead, qa, devops, security) แต่ละ artifact มีป้าย **proof**
  เฉพาะเมื่อมี receipt ที่ผ่านและใช้ได้จริง ไม่เช่นนั้นเป็น **preview** หรือ **none** หน้าจะ
  คัดลอกค่าเหล่านี้ และเขียนว่าผ่านการทดสอบเองไม่ได้ จึงเพิ่มจำนวน proof ไม่ได้
- **สิ่งที่ต้องแสดง** สำหรับงานแต่ละชนิด harness ระบุสิ่งที่หน้าต้องมี (ตารางด้านล่าง)
  บอกว่า prototype ประกาศว่าครอบคลุมข้อไหน และข้อไหนยังขาดหรือไม่ทราบ คำประกาศเป็นของ
  agent ไม่ใช่ proof และ `change start` พิมพ์ข้อสังเกตหนึ่งบรรทัดว่ายังขาดอะไร
- **คำเตือน** ถ้าหน้าถูกแก้หลัง revision ล่าสุด หรือไม่มีข้อเท็จจริงล่าสุดแล้ว คำถามอนุมัติจะ
  เตือนคุณ คำเตือนไม่เคยบล็อก

ถ้ายังไม่มีหน้า คำถามจะให้สรุป 4 บรรทัดเป็นข้อความและ agent จะใช้ skill คุณยังอนุมัติจาก
packet ได้ เมื่อคุณขอให้แก้หน้า agent จะแก้ agreement ในรอบเดียวกัน หน้ากับ agreement จึงไม่แยกจากกัน
ถ้าเครื่องมือของคุณมี design canvas agent จะสร้างหน้าบน canvas เป็นเฟรมที่มีเลขลำดับ
หนึ่งเฟรมต่อหน้าจอหรือสถานะ และเก็บไฟล์ที่ส่งออกไว้ด้วย agent อ่านข้อเท็จจริงชุดเดียวกัน
ได้ด้วย `claude-foundation package <change>` ซึ่งพิมพ์เป็น JSON และไม่เขียนไฟล์

**สิ่งที่หน้าต้องแสดง** งานแต่ละชนิดมีสิ่งที่ต้องแสดงของตัวเอง บวกก่อนและหลัง และถ้างาน
พลาดได้ก็ต้องมีกรณีพลาดพร้อมวิธีกู้คืน:

| กลุ่ม | ชนิดงาน | คำถาม |
|---|---|---|
| A | feature, ui, client-release, experiment | ผู้ใช้จะเห็นและทำอะไรได้ |
| B | bugfix | ปัญหาคืออะไร และจะรู้ได้อย่างไรว่าหายแล้ว |
| C | refactor, dependency, config, docs, test, chore | ปลอดภัยไหม และอะไรต้องคงเดิม |
| D | api, library, deprecation | ใครใช้สัญญานี้ และเขาจะโดนอะไร |
| E | data, migration, data-fix | ข้อมูลเสียหายไหม และย้อนกลับได้ไหม |
| F | async, integration, infra, observability, performance, cicd | พังแล้วเป็นอย่างไร และค่าใช้จ่ายเท่าไร |
| G | privacy, ml, security | ข้อมูลของใครถูกใช้ เก็บนานแค่ไหน และถ้าผิดทำอย่างไร |

change ที่มีหลายชนิดแสดงแต่ละอย่างหนึ่งครั้ง

**งานชนิดใหม่สามแบบ และคำตอบที่ให้ได้เสมอ** งานแก้ข้อมูลจริงครั้งเดียว (`data-fix`)
แสดงขอบเขต สำเนาก่อนแก้ การลองรันแบบไม่เขียนจริง รันซ้ำปลอดภัยไหม และย้อนกลับ
อย่างไร งานเสริมความปลอดภัยที่ไม่มี bug เจาะจง (`security`) แสดง threat model จุดอ่อน
มาตรการ และวิธีพิสูจน์ งานแก้ pipeline หรือ build (`cicd`) แสดงสิ่งที่เปลี่ยน
สิทธิ์และ secret ที่ใช้ รัศมีผลกระทบ และการย้อนกลับ งาน ml ต้องบอกวิธีประเมินโมเดล
งานทดลองต้องมีราวกั้นและเงื่อนไขหยุด และงานโครงสร้างต้องบอกค่าใช้จ่าย ทั้งหมดนี้
ไม่เคยกั้นคุณหรือ agent: ทุกคำตอบเป็น **`none: <เหตุผล>`** หรือ **`unknown: <เหตุผล>`**
(ภาษาไทย `ไม่มี:` หรือ `ไม่ทราบ:`) ได้เมื่อข้อเท็จจริงนั้นไม่มีอยู่หรือยังไม่ทราบ และหน้าจะ
เขียนคำนั้นพร้อมเหตุผลให้คุณชั่งใจ change ระดับ High หรือ Critical ต้องบอกด้วยว่า
ย้อนกลับอย่างไร หรือบอกชัดๆ ว่าย้อนกลับไม่ได้เพราะอะไร กฎเหล่านี้ใช้กับ draft ที่กำลัง
เริ่มหรือ revise เท่านั้น change ที่ทำอยู่แล้วไม่ถูกหยุดด้วยกฎนี้ ถ้าไฟล์ที่ change
แตะชี้ไปที่ความเสี่ยงที่ draft ไม่ได้ครอบคลุม `change start` จะพิมพ์ข้อสังเกตหนึ่งบรรทัด
แล้วไปต่อ

**Preview เป็นทางเลือก** ก่อน Build agent อาจรัน provider ที่ประกาศไว้หนึ่งตัว
กับสำเนาของ target ที่ทิ้งได้ เพื่อให้เห็นพฤติกรรมเบื้องต้น ข้อมูลของ change ระดับ High
หรือ Critical จะแนะนำ preview ที่ควรรัน ผลของ preview ไม่ใช่ proof เด็ดขาด:
ใช้ผ่าน Prove หรือ Land ไม่ได้ ไม่บล็อก approval หรือ Build และจะแสดงเป็น stale
เมื่อ spec เปลี่ยน provider ที่ระบุ `external: true` (เช่น payment sandbox หรือ
staging) จะออกไปนอกเครื่องของคุณ จึงรันได้เฉพาะหลังคุณอนุญาตการรันครั้งนั้น
ถ้าไม่มีการตัดสินใจของคุณจะถูกปฏิเสธและไม่มีอะไรรัน

**Role lane ต้องเปิดใช้เอง** ค่าเริ่มต้นคือการอนุมัติ spec ครั้งเดียวครอบคลุมทั้ง
change ถ้าโปรเจกต์ตั้ง `approval.roles` ใน `foundation.json` (ดู
หัวข้อ `approval` ใน [ตั้งค่า foundation.json](/docs/th/foundation-config/)) แต่ละ role
ที่ถูกเลือกต้องอนุมัติ revision ปัจจุบันแยกกัน และ Build จะไม่เริ่มจนกว่าทุก lane
ที่ต้องมีอนุมัติครบ คุณเป็นผู้ระบุว่าอนุมัติในบทบาทใด การอนุมัติที่ไม่ระบุ role
ครอบคลุมทุก lane harness บันทึก role ตามที่แจ้งและไม่ได้ยืนยันตัวตน การเพิ่ม
requirement คงการอนุมัติของ lane ไว้ ส่วนการลบ requirement จะรีเซ็ตทุก lane

## Acceptance

Acceptance คือการที่คนที่ระบุชื่อได้บอกว่าผลลัพธ์นี้คือสิ่งที่ต้องการ
เป็นจุดเดียวที่พูดถึง *ตัวผลิตภัณฑ์* ไม่ใช่ *ตัวงาน*

**standard change เริ่มต้นที่ยังไม่ตัดสิน และการยังไม่ตัดสินคือการบล็อก**
`change validate` จะไม่ผ่านจนกว่าจะมีคนตัดสิน ซึ่งตั้งใจให้เป็นแบบนี้
เพราะความเงียบไม่ใช่การยินยอม และ change ต้องไม่ค่อย ๆ ไหลไปเป็น "ยอมรับแล้ว"
เพียงเพราะไม่มีใครคัดค้าน

คุณตัดสินมันอย่างชัดเจน ไม่ทางใดก็ทางหนึ่ง: ไม่มีอะไรเชิงอัตวิสัยต้องให้คนเซ็น
การตรวจแบบ deterministic คือทั้งหมดแล้ว หรือต้องมีคนดูแล้วบอกว่าใช่พร้อมเหตุผลที่ระบุไว้
agent เป็นผู้บันทึก (คำสั่งอยู่ที่ [Recording the acceptance decision](#recording-the-acceptance-decision))

rapid change เริ่มที่ `not-required` แทน เพราะ rapid สงวนไว้สำหรับงาน impact ต่ำที่แยกอิสระ
การประกาศ claim ที่มี capability `acceptance` ก็ทำให้ต้องมี acceptance เช่นกัน
และการประกาศนั้นมีน้ำหนักเหนือการตัดสินว่าไม่จำเป็น

receipt ของ acceptance ที่ผ่านต้องมีชื่อคนจริง การตัดสิน `accept` ที่ชัดเจน
เกณฑ์การยอมรับอย่างน้อยหนึ่งข้อที่ไม่ซ้ำกัน และบันทึกสิ่งที่สังเกตเห็น
มันถูก validate ใหม่ทุกครั้งที่อ่าน เทียบกับ workspace hash, claim ที่อยู่ในขอบเขตตอนนี้
และเหตุผลที่ระบุไว้ — ถ้าอย่างใดอย่างหนึ่งเปลี่ยนไปทีหลัง acceptance จะกลายเป็นไม่ถูกต้อง
แทนที่จะถูกยกยอดมาเงียบ ๆ

## Review อิสระ

Review ถามว่าการ implement นี้ดีพอไหม ผู้รีวิวเป็นคน **หรือ** AI ตัวอื่นก็ได้
สิ่งที่สำคัญคือความเป็นอิสระ ไม่ใช่ว่าเป็นคนหรือเครื่อง

เมื่อใช้ `workflow.reviewPolicy: "risk-tiered"` ทุก change ได้รับ review และระดับ
ความเสี่ยงกำหนดเส้นทางที่มีขอบเขต ยกเว้น rapid change ระดับ low ที่ไม่มี security
keyword, risk signal หรือ `--review` ซึ่งพิสูจน์ด้วย test ของโปรเจกต์เองและไม่มี AI review

- **low:** AI full review หนึ่งรอบ ถ้าต้องแก้สาระสำคัญจะเลื่อนเป็น medium
- **medium:** full review หนึ่งรอบ แก้รวมหนึ่ง batch แล้วใช้ fresh-session delta
  ได้ไม่เกินหนึ่งรอบเพื่อปิด finding IDs เดิม
- **high:** ตัดสินใจความเสี่ยงสำคัญใน Decision Sheet ต้นทาง ใช้ AI full review
  หนึ่งรอบและ post-correction delta ได้ไม่เกินหนึ่งรอบ โดยไม่บังคับ human final

authorization/secrets, public หรือ cross-repository contract, migration/การแก้
state ที่ย้อนกลับยาก, เงิน, concurrency, replay/idempotency, broker/real wire
และการ activate legacy behavior เป็นสัญญาณ high risk

:::note[วงจรตามความเสี่ยง]
ระบบบังคับเพดานก่อน dispatch: low ได้ full หนึ่งรอบ และถ้าแก้จะเลื่อนเข้าเส้นทาง full/delta แบบเดียวกับ medium/high infrastructure retry หนึ่งครั้งแยกจาก delivered wave หลัง AI สองรอบจะไม่เปิด review แบบเปิดใหม่ defect ใน contract ปิดผ่าน claim และ critical-case receipt ปัจจุบัน หรือถ้าไม่มี binding จะมี closure review หนึ่งรอบสำหรับ delta ที่แก้แล้ว ส่วน contract ขัดแย้งจริงจึงเปิด Decision Sheet แบบ batch และถ้าขาดสิทธิ์จะเป็น external handoff ประวัติเป็น SHA-256 hash chain ถ้าโซ่ขาด harness จะกักไว้และสร้างใหม่เอง โดยไม่ลดจำนวนรอบและไม่นำผลที่ตรวจสอบไม่ผ่านกลับมาใช้

เพดานนี้จำกัดการ dispatch reviewer เพื่อให้ workflow เร็ว ไม่ได้จำกัดจำนวนครั้งที่แก้
Agent แก้ finding ที่รวมเป็นชุดและตรวจ evidence ที่ invalidated ซ้ำได้ตราบใดที่งานยังคืบหน้า
:::

เมื่อรอบ AI ที่อนุญาตใช้หมดและยังไม่มี verdict คุณเลือกได้: human verdict จากคนที่ระบุชื่อ,
AI อีกหนึ่งรอบพอดี หรือพัก review ที่ใช้รอบหมดแล้วไม่เคยถูก waive ส่วนใครรีวิวได้
(ความเป็นอิสระและความหลากหลายของโมเดล) เป็นนโยบายของโปรเจกต์ ดู
[Review independence and diversity](#review-independence-and-diversity)

## การตัดสินใจถูกบันทึกไว้ที่ไหน

การตัดสินใจอยู่ใน change packet ไม่ใช่ใน transcript ของแชท
เหตุผลของ acceptance อยู่ในสัญญา คำตัดสินของ review อยู่ใน receipt
และการตัดสินใจให้ทำต่อถูกระบุด้วย `--decision-ref` ของมัน
กฎที่อยู่ใต้ทั้งสี่จุดคือกฎเดียวกัน **การอนุมัติไม่เคยถูกอนุมานจากความเงียบ
และการที่คำสั่งใช้ได้ ไม่เคยแปลว่าได้รับอนุญาตให้รันมัน**

## For agents and integrators

ทุกอย่างจากตรงนี้ลงไปคือกลไก: คำสั่งที่ agent รันแทนคุณ คีย์นโยบายของโปรเจกต์
และหลักฐานจาก host ผู้ใช้เป็นผู้ให้การตัดสินใจข้างบน ไม่มีส่วนไหนที่นี่ขอให้คุณรันคำสั่ง
แต่ละส่วนมีเจ้าของต่างกัน

| ส่วน | เจ้าของ | ตอบคำถามอะไร |
|---|---|---|
| **Acceptance** | ผู้ใช้ตัดสินใจ; agent บันทึก | ได้ผลลัพธ์ที่ต้องการหรือไม่ และต้องให้คนยอมรับผลหรือไม่? |
| **Review** | Reviewer ที่ตั้งค่าไว้; โปรเจกต์กำหนดนโยบาย | Implementation ผ่านเกณฑ์ review หรือไม่? ความเป็นอิสระตั้งค่าแยก |
| **Authority bridge** | Agent/harness integration | คำตัดสินหรือ verdict กลายเป็น receipt ที่ตรวจสอบแล้วอย่างไร? |
| **Host attestation** | ผู้ดูแลหรือ integration ของ trusted host | Environment ตรงข้อกำหนด sandbox สำหรับงานที่ไม่มีคนเฝ้าหรือไม่? |

### Recording the acceptance decision

```bash
# ไม่มีอะไรเชิงอัตวิสัยต้องเซ็น — การตรวจแบบ deterministic คือทั้งหมดแล้ว
claude-foundation change resolve <change> --acceptance-not-required

# ต้องมีคนดูแล้วบอกว่าใช่
claude-foundation change resolve <change> \
  --acceptance-required --acceptance-reason "<ทำไมต้องให้คนตัดสิน>"
```

### Review independence and diversity

มีสองคุณสมบัติกำหนดว่าใครรีวิวได้ ทั้งคู่ยกเว้นได้ และยกเว้นด้วยวิธีเดียวกัน
คือคีย์ใน `foundation.json` ที่ commit ไว้ ไม่ใช่ flag บนคำสั่ง — ข้อยกเว้นที่ฝ่ายถูกรีวิว
เขียนเองได้ตอนที่โดนจับ ไม่นับเป็นข้อยกเว้น

**ความเป็นอิสระ** นโยบายที่ให้มาใช้
`"review": { "independence": "self" }` จึงอนุญาตให้ reviewer ใช้ identity และ
session เดียวกับผู้ implement ได้ ใช้ได้ทุกระดับ impact และจะประทับ trigger
`independence-waived-self-review` ลงในนโยบาย receipt บันทึกสิ่งที่เกิดขึ้นจริง
คือ `review.policy.independent` ยังเป็น `false` โดยมี `independenceWaived: true`
อธิบายว่าทำไมจึงผ่าน โปรเจกต์ที่ต้องการ separation of duties สามารถเพิ่มเป็น
`required` ซึ่งจะบังคับให้ reviewer ใช้ identity และ session ที่ต่างออกไป

**ความหลากหลาย** นโยบายที่ให้มาใช้
`"review": { "diversity": "single-model" }` จึงให้ความหลากหลายเป็น
*preferred* และผู้ใช้ Claude Code อย่างเดียวสามารถรีวิวผ่าน Claude session ใหม่
ได้โดยไม่ต้องมี Codex พร้อมประทับ trigger `diversity-waived-single-model`
ลงในนโยบาย ทีมที่มีทั้งสอง provider สามารถเพิ่มความเข้มเป็น `required`
ซึ่งจะบังคับให้ AI ผู้รีวิวต้องมาจากคนละ provider และคนละตระกูลโมเดลกับผู้ implement

ค่าเริ่มต้นที่ให้มาเลือก `claude-opus`; ทีม Codex ล้วนเปลี่ยนเป็น `codex-sol`
configured AI review ยังคงทำงานแบบ read-only และ ephemeral แม้นโยบายเริ่มต้น
จะไม่ได้บังคับให้ใช้ identity หรือ session ที่ต่างออกไป

การยกเว้นแต่ละอันผ่อนเฉพาะแกนของตัวเอง การรีวิวตัวเองด้วยโมเดลเดียวกันบนงาน critical
ต้องประกาศทั้งสองอัน ประกาศอันเดียวอีกอันยังบังคับอยู่ และการถอนคีย์ใดคีย์หนึ่งออก
จะทำให้ receipt ที่มันเคยอนุญาตใช้ไม่ได้ เพราะนโยบายรีวิวเป็นส่วนหนึ่งของ
contract fingerprint

เมื่อ review ใช้รอบหมด ตัวเลือกจะแมปกับ `authority dispatch --reviewer-type human`
ตามด้วย `authority record` (human verdict), `authority extend-review <change>
--decision-ref <user-decision>` (AI อีกหนึ่งรอบพอดีต่อหนึ่ง decision reference) หรือพัก

### Gate waivers and advanced continuations

User ไม่ต้องสร้าง grant หรือ decision-reference command เอง `land record` ต้องมี
`--decision-ref` เฉพาะ compatibility ของ commit-oriented transaction แบบ legacy
ที่ active อยู่ก่อนแล้ว ส่วน continuation ขั้นสูงอื่น เช่น `budget continue`,
`change abandon`, `change waive` และ `agents release --force` ยังบันทึกการตัดสินใจ
ที่ให้อำนาจตามเดิม

`change waive` คือทางออกที่ถูกบันทึกไว้สำหรับ gate ที่รันแล้ว fail:
มันถอนการบังคับใช้ capability หนึ่งตัวตามการตัดสินใจชัดเจนของคุณ
เดินทางเป็น advisory `user-waived` ผ่าน proof เข้าไปถึง archive และ `--revoke`
คืนข้อบังคับกลับมา และปฏิเสธ waiver ที่จะทำให้ไม่เหลือ provider ที่จำเป็นเลย
Acceptance ถูกปฏิเสธที่นั่น ให้ถอนข้อกำหนดด้วย
`change resolve --acceptance-not-required` แทน ส่วน review ใช้เส้นทาง waiver เดียวกันได้
ขณะที่ independence กับ diversity ประกาศใน `foundation.json` ตามข้างบน

## Authority bridge

**สำหรับผู้พัฒนา agent และ host integration** ผู้ใช้เป็นผู้ตัดสินใจ
ส่วน integration บันทึกและตรวจการตัดสินใจผ่านกลไกนี้

ทางปกติเริ่มด้วยคำสั่งที่ทำต่อได้คำสั่งเดียว

```bash
claude-foundation advance <change> --through proven
```

Coordinator เรียก compatible proof primitive แล้วสร้างหรือ reuse request และไม่
poll external wait ที่ไม่เปลี่ยน เมื่อส่ง packet
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
`authority status --template` แสดงรูปแบบคำตอบให้ agent หรือผู้ดูแล integration
ผู้ใช้ตอบคำถามด้วยภาษาปกติ ไม่ต้องสร้าง receipt JSON
หรือแต่ง verdict ของ reviewer เอง
:::

ถ้า workspace เปลี่ยนหลังจากเปิดคำขอไปแล้ว คำขอจะ stale และต้องเปิดใหม่
คำตัดสินผูกกับ code ที่มันได้เห็น ไม่ใช่ผูกกับ change แบบลอย ๆ

## Host attestation

**สำหรับผู้ดูแล trusted host** นี่คือหลักฐาน environment จาก host
ไม่ใช่เอกสารที่ผู้ใช้เซ็นเพื่ออนุมัติฟีเจอร์

ตัวนี้ **ไม่ใช่** การอนุมัติโดยคน แม้จะอยู่ใกล้กัน

`sandbox challenge` คู่กับ `doctor --unattended --attestation <file>`
คือคำแถลงที่เซ็นแล้วจาก host ที่เชื่อถือได้ ว่าขอบเขตของ sandbox ปลอดภัยพอ
จะรันโดยไม่มีคนเฝ้า มันเซ็นด้วย Ed25519, nonce หมดอายุใน 10 นาที
และ nonce ที่ใช้แล้วถูกบันทึกไว้เพื่อไม่ให้เล่นซ้ำได้

trust root เป็นไฟล์ระบบที่ root เป็นเจ้าของเท่านั้น และ Change Loop
ปฏิเสธการรันแบบไม่มีคนดูด้วยตัวเองเมื่อพบ socket ของ container ที่เขียนได้,
token ของ Kubernetes service account ที่ mount ไว้ หรือ SSH agent socket ที่ mount ไว้
ซึ่งคือสิ่งที่จะทำให้งานที่อ้างว่า "อยู่ใน sandbox" เอื้อมออกไปนอก sandbox ได้

การตรวจพบไม่ใช่การอนุญาต การพบว่ารันแบบไม่มีคนดูได้ ไม่เคยแปลว่าได้รับอนุญาตให้ทำ
