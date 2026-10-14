# โจทย์เปรียบเทียบ Investigation continuity — 2026-10-15

[English](investigation-continuity-differential-2026-10-15.md)

เพิ่มความยากด้วยการเปลี่ยนความต้องการและการรักษาประวัติ แทนการเพิ่มขนาดแอป
ทดสอบ runtime และ native proposal compiler จริงจาก source ก่อนแก้
`d157286b9b32c4374fcb94accf7c1a430c04228d` เทียบกับหลังแก้
`bdcfdf4d4edc07e83448904163d1657c4641c273` ทั้งสองฝั่งได้รับเนื้อหาเดียวกัน
ใน record envelope ที่แต่ละรุ่นรองรับ คือ v1 และ v2 ไม่ได้นับการปฏิเสธ schema
v2 ที่รุ่นเก่าไม่รองรับเป็นความล้มเหลว

โจทย์คือสืบเรื่อง retry การจ่ายเงิน โดยต้องไม่ลบ audit history และไม่เปลี่ยน
storage เดิม มีคำถามสำคัญที่ยังไม่ตอบ งานอิสระ และคำถามไม่สำคัญ จากนั้นตอบ
คำถาม บันทึก PoC สองชุด แก้ requirement เฉพาะ retry ทบทวนเฉพาะ PoC ที่กระทบ
ทดลองทำประวัติหายหรือเขียนทับแล้วกู้กลับ สุดท้ายสร้าง native proposal และ
ทดลองส่ง coverage ที่ขาดหรืออ้าง target ที่ไม่มี ทุก turn สร้าง runtime ใหม่
เพื่ออ่าน persisted state และจำลอง resume

## ผลตรวจข้อกำหนดใหม่

ก่อนแก้รองรับ 5/19 ข้อ หลังแก้ผ่าน 19/19 คะแนนนี้วัดความสามารถตามสัญญาใหม่
ไม่ใช่อัตราผ่าน compatibility tests ของรุ่นเก่า

| สิ่งที่ตรวจ | ก่อนแก้ | หลังแก้ |
|---|---|---|
| ความต้องการชัดแล้วไม่ถามยืนยันทั้งหมด | รองรับ | รองรับ |
| ส่ง requirements รายละเอียดผ่าน handoff | ledger นี้ไม่เก็บ | เก็บครบ |
| คำถามสำคัญใน intake ป้องกัน handoff ก่อนคำตอบ | ไม่บังคับผ่าน ledger นี้ | บังคับ |
| แสดงงานอิสระระหว่างรอคำตอบ | ไม่แสดง | แสดง |
| คำถามไม่สำคัญไม่หยุดงาน | เดินต่อ | เดินต่อ |
| เปลี่ยนบาง requirement ทำให้เฉพาะ PoC ที่กระทบล้าสมัย | ไม่บังคับ | เฉพาะ retry PoC ล้าสมัย |
| Resume เก็บ revision บทสนทนา และ history gaps | ledger นี้ไม่เก็บ | เก็บครบ |
| ทบทวน PoC แล้วจบโดยไม่ถามยืนยันเกินจำเป็น | เดินต่อ | เดินต่อ |
| เก็บผล PoC เดิมใน handoff | ledger นี้ไม่เก็บ | เก็บ |
| ตรวจพบ constraint ถูกลบ | ไม่บังคับ | คืน agent ให้แก้ |
| ตรวจพบข้อความผู้ใช้เดิมหาย | ไม่บังคับ | คืน agent ให้แก้ |
| ตรวจพบ requirement ถูกเขียนทับโดยไม่เพิ่ม revision | ไม่บังคับ | คืน agent ให้แก้ |
| ตรวจพบผล PoC เดิมถูกเขียนทับ | ไม่บังคับ | คืน agent ให้แก้ |
| ข้อเสนอ agent ไม่กลายเป็น user consent เอง | ไม่บังคับผ่าน ledger นี้ | ปฏิเสธ |
| กู้ข้อมูลถูกต้องแล้วเดินต่อโดยไม่ถามผู้ใช้ซ้ำ | เดินต่อ | เดินต่อ |
| Proposal เก็บ examples ที่มา revision ข้อจำกัด และช่องว่างประวัติ | ไม่ครบ | รายละเอียดที่ตรวจอยู่ครบ |
| ปฏิเสธ storage constraint ที่ไม่มี coverage | ไม่บังคับ | ปฏิเสธ |
| ปฏิเสธ scenario target ที่ไม่มีจริง | ไม่บังคับ | ปฏิเสธ |
| ปฏิเสธ handoff เก่าหลังมี turn ใหม่ | รองรับ | รองรับ |

v1 มี `decisions` ledger สำหรับคำถามเปิดอยู่แล้ว การตรวจนี้วัด typed intake
ledger ใหม่และการป้องกันข้อมูลสูญหาย ไม่ได้แปลว่า agent รุ่นเก่าถามไม่ได้
หรือจด context เองไม่ได้ coverage links ตรวจโครงสร้าง ไม่ได้รับรองว่าความหมาย
ตรงกันทั้งหมด ผล PoC ในโจทย์เป็น fixture ที่กำหนดไว้ ไม่ได้รัน payment prototype
หรือวัด production concurrency

## รันซ้ำและดูหลักฐาน

```sh
rtk npm run bench:investigation-continuity
```

Runner อยู่ที่ `.claude/tests/bench/openspec-native/investigation-continuity.mjs`
เก็บ comparison, findings ทุก turn และ proposals ทั้งสองฝั่งที่
`.foundation/test-results/investigation-continuity-comparison/`
มี SHA-256 digest ของ executable scenario ผลลัพธ์ไม่เข้า Git
หากฝั่งใหม่ไม่ผ่านข้อใด runner จะ exit nonzero และลบ consumer/source ชั่วคราว

นี่เป็น deterministic runtime/compiler seam ไม่เสียค่าโมเดล ไม่ใช่ public-CLI
E2E, paid conversation หลาย session หรือการส่งแอปผ่าน Build → Land
[Paid smoke ก่อนหน้า](investigation-continuity-smoke-2026-10-15.th.md) ตรวจ
`notes-api` จน archive แต่ไม่ได้ตรวจบทสนทนานี้ การเปรียบเทียบ paid ขั้นต่อไป
ควร replay turns เดียวกันผ่าน agent sessions ใหม่ทั้งสองเวอร์ชัน แล้วตรวจ
requirements และ implementation ด้วย oracle อิสระ ไม่ใช้คำบรรยายว่าเข้าใจแล้ว
แทนหลักฐาน และไม่อ้างว่าเร็วขึ้นจาก checks เหล่านี้
