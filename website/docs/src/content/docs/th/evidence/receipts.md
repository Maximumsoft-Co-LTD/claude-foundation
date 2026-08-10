---
title: Receipt, สถานะ และความ stale
description: receipt ผูกตัวเองกับอะไร สี่สถานะที่ provider คืนได้ ทำไม pass ที่เขียนด้วยมือถึงถูกปฏิเสธ และอะไรทำให้ proof stale
---

Receipt คือบันทึกของ Foundation ว่า provider ตัวหนึ่งสังเกตเห็นผลอย่างหนึ่ง
เทียบกับเนื้อหาชุดหนึ่ง ทุกอย่างในนั้นถูกออกแบบให้ receipt อยู่ได้ไม่นานกว่าสิ่งที่มันบรรยาย

## สี่สถานะ

provider คืนสถานะหนึ่งในสี่ และสามในสี่นั้นบล็อก

| สถานะ | ความหมาย | Land ได้ไหม |
|---|---|---|
| `pass` | provider รันแล้วและ claim เป็นจริง | ได้ |
| `fail` | provider รันแล้วแต่ claim ไม่เป็นจริง | ไม่ได้ |
| `error` | provider รันไม่ได้ — crash, timeout, spawn ล้มเหลว | ไม่ได้ |
| `inconclusive` | provider รันแล้วแต่ไม่ได้ให้คำตัดสินกับ claim นั้น | ไม่ได้ |

`inconclusive` คือตัวที่ทำให้คนงง และเป็นตัวที่มีประโยชน์ที่สุดในสี่ตัว
Playwright ที่รันแล้วเขียวแต่ไม่มี annotation ผูกกับ claim ถือว่า inconclusive ไม่ใช่ผ่าน
เพราะมันแสดงว่ามี test บางตัวรัน ไม่ได้แสดงว่า *claim ของคุณ* เป็นจริง
readiness ที่ประกาศไว้แต่ไม่เคยสังเกตเห็นจะเป็น `error` ไม่ว่าคำสั่งจะ exit เป็นศูนย์หรือไม่
เพราะ suite ที่รันก่อนที่ dependency จะพร้อมไม่ได้พิสูจน์อะไรเลย

:::tip
มอง `inconclusive` ว่า "ต่อสายผิด" ไม่ใช่ "code พัง"
เกือบทุกครั้งมันแปลว่า provider ไม่ได้รายงานผลผูกกับ claim ที่คุณประกาศไว้
:::

## Receipt ผูกกับอะไร

receipt แต่ละตัวบันทึกว่าอะไรรัน เห็นอะไร และเห็นเทียบกับอะไร

```json
{
  "provider": "test",
  "execution": "harness",
  "status": "pass",
  "workspaceHash": "eb7f67b3…",
  "contractFingerprint": "9a456f30…",
  "providerFingerprint": "084664fa…",
  "inputIdentity": { "mode": "global" },
  "claims": ["profile-update"],
  "artifacts": [{ "name": "command-log", "sha256": "…", "size": 4210 }]
}
```

fingerprint คือสิ่งที่ทำให้การใช้ซ้ำปลอดภัย `contractFingerprint`
ครอบคลุมเจตนา impact นโยบาย review acceptance และ claim ส่วน `providerFingerprint`
ครอบคลุม adapter คำสั่ง capability สภาพแวดล้อม **digest ของ lockfile** timeout
และตัวระบุ readiness เปลี่ยนอย่างใดอย่างหนึ่ง receipt ก็ไม่ได้บรรยายโลกปัจจุบันอีกต่อไป

`workspaceHash` ผูก receipt กับเนื้อหาที่มันถูกสร้างขึ้นมาเทียบด้วย
มันคำนวณจาก Git index บวกกับตัวตนของไฟล์ที่ยังไม่ commit โดยข้ามไดเรกทอรีผลลัพธ์
ที่สร้างใหม่ได้ และข้าม `execution.yaml` ของ change นั้นเอง — การแก้การต่อสายของ provider
จึงไม่ทำให้หลักฐานหมดอายุโดยตัวมันเอง แต่การแก้ source ทำ

## รันจริง กับ แค่ยืนยัน

Foundation แยกหลักฐานที่มันสร้างเอง ออกจากหลักฐานที่คนยื่นให้ และไม่ยอมให้สองอย่างนี้ปนกัน

receipt ที่ระบุ `execution: "harness"` เขียนได้เฉพาะจากจุดที่รันคำสั่งจริงเท่านั้น
และถ้าผ่านก็ต้องแนบ command log เป็น artifact

receipt ที่ระบุ `execution: "manual"` ต้องมีสิ่งที่สังเกตเห็น แหล่งที่มา
และอย่างน้อยหนึ่ง artifact หรือ reference ที่ชี้ไปถึงได้จริง — เป็น URI หรือ path ที่มีอยู่จริง
ข้อความลอย ๆ ถูกปฏิเสธ เพราะ "ผมรันแล้วมันผ่าน" ไม่ใช่หลักฐาน

:::caution
receipt ที่บันทึกด้วยมือจะระบุ adapter ที่รันได้ไม่ได้ และ provider ที่ต่อสายไว้กับ
`command`, `test-discovery`, `playwright` หรือ `contract-digest`
รับ `pass` ที่เขียนด้วยมือไม่ได้เลย ถ้า harness รันมันได้ harness ต้องเป็นคนรัน
:::

## Input ที่ประกาศไว้ กับการใช้ซ้ำอย่างปลอดภัย

โดยปกติ receipt ผูกกับ workspace ทั้งก้อน การแก้อะไรก็ตามจึงทำให้มันหมดอายุ
ซึ่งถูกต้องแต่หยาบ การพิมพ์ผิดในเอกสารไม่ควรล้มผลการสแกนความปลอดภัย

provider แคบขอบเขตนั้นได้ด้วยการประกาศ input ที่มันพึ่งพาจริง

```json
{
  "security-static": {
    "adapter": "command",
    "command": ["npm", "audit", "--audit-level=high"],
    "inputs": ["package.json", "package-lock.json"]
  }
}
```

เมื่อประกาศ input ไว้ Foundation จะบันทึก digest ของไฟล์เหล่านั้นแบบเรียงลำดับ
เมื่อ workspace เปลี่ยนแต่ไฟล์เหล่านั้นไม่เปลี่ยน receipt จะถูกผูกใหม่เข้ากับ
workspace hash ใหม่แทนที่จะรันซ้ำ และการผูกใหม่ถูกเขียนลง audit log
ประกาศ input ตามจริง — provider ที่อ่านมากกว่าที่ประกาศจะใช้ receipt ซ้ำ
ทั้งที่ควรต้องพิสูจน์ใหม่

`review` กับ `acceptance` ประกาศ input ไม่ได้ คำตัดสินของคนพูดถึง change ทั้งก้อน

## ทำไม proof ถึง stale

`prove` จะไม่ยอมทำงานจนกว่าทุก provider ที่ต้องมีจะอยู่ในสถานะถูกต้อง
คำตัดสินที่พบบ่อย เรียงตามลำดับที่ตรวจ

| คำตัดสิน | เกิดอะไรขึ้น |
|---|---|
| `missing` | provider ไม่เคยสร้าง receipt |
| `contract-stale` | claim หรือสัญญาเปลี่ยนหลังจากได้ receipt มา |
| `provider-fingerprint-stale` | คำสั่ง สภาพแวดล้อม หรือ lockfile เปลี่ยน |
| `stale` | workspace เปลี่ยนและไม่ได้ประกาศ input ไว้ |
| `provider-inputs-stale` | input ที่ประกาศไว้เปลี่ยนเอง |
| `review-not-independent` | ผู้รีวิวเป็นผู้ implement ด้วย |
| `review-not-diverse` | AI ผู้รีวิวใช้ตระกูลโมเดลเดียวกับผู้ implement |
| `acceptance-invalid` | ขอบเขต hash หรือเหตุผลเปลี่ยนไปหลังการยอมรับ |
| `external-observation-missing` | receipt แบบ manual ขาดสิ่งที่สังเกตเห็นหรือแหล่งที่มา |

receipt ที่ stale *หลัง* จากรันไปแล้วในรอบ proof เดียวกัน มักแปลว่า provider
เขียนไฟล์ลงในพื้นที่ที่ถูก hash — คือปล่อย report ลง working tree
แทนที่จะเป็นไดเรกทอรีที่ถูก ignore ให้ชี้ report ไปยังที่ที่สร้างใหม่ได้
หรือประกาศมันเป็น artifact

Land ตรวจทั้งหมดนี้ซ้ำอีกรอบ workspace hash ของ proof ต้องยังตรง
และ digest ของ receipt ที่ใช้งานอยู่ทุกตัวต้องเท่ากับ digest ที่บันทึกไว้ใน proof manifest
receipt จึงถูกสลับระหว่างตอนพิสูจน์กับตอน land ไม่ได้
