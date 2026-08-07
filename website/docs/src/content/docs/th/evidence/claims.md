---
title: Claim และ capability
description: scenario ที่สังเกตได้กลายเป็น claim ที่มี ID คงที่อย่างไร และ capability ตัวไหนใน 19 ตัวที่พิสูจน์มันได้จริง
---

กฎหลักของ Foundation คือ **คำสั่งที่ผ่านไม่ได้แปลว่าเป็นหลักฐานโดยอัตโนมัติ**

ทุก scenario ที่ยอมรับได้และสังเกตได้จะได้ claim ID ที่คงที่ แต่ละ claim ประกาศ capability ที่พิสูจน์มันได้จริง หลักฐานที่ขาด, stale, fail, error หรือ inconclusive จะบล็อกการ land

## สัญญาเชิงพฤติกรรม

`evidence.yaml` เก็บส่วนที่คงที่ มันเปลี่ยนก็ต่อเมื่อ claim หรือภาระที่สังเกตได้เปลี่ยน

```json
{
  "version": 2,
  "claims": [
    {
      "id": "profile-update",
      "scenario": "The owner can update their profile",
      "impact": "medium",
      "capabilities": ["test", "browser", "accessibility"]
    }
  ]
}
```

การต่อสายที่รันได้จริงอยู่แยกใน [`execution.yaml`](/docs/th/evidence/adapters/) การแยกนี้ตั้งใจ เพราะ Build มักค้นพบว่าคำสั่งจริงคือ `npm run test:unit` ไม่ใช่ `npm test` และการเปลี่ยนสายไฟแบบนั้นไม่ควรดูเหมือนการเปลี่ยนสิ่งที่ซอฟต์แวร์สัญญาไว้

:::tip
`discovery` เป็นภาระระดับ suite ที่มาโดยปริยายทุกครั้งที่เลือก `test` ไม่ต้องใส่ซ้ำในทุก claim
:::

## แคตตาล็อก capability

เลือกเฉพาะที่ claim ต้องการ ไม่ใช่เลือกทั้งแคตตาล็อกเป็นค่าเริ่มต้น

| Capability | ยืนยันอะไร |
|---|---|
| `test` | การตรวจเชิงพฤติกรรมที่รันได้สำหรับ claim ที่ประกาศไว้ |
| `discovery` | พบเทสตามที่คาด และจำนวนที่เจอถึงเกณฑ์ขั้นต่ำ |
| `browser` | พฤติกรรมที่เรนเดอร์ในเบราว์เซอร์จริง พร้อม input capability ที่ต้องการ |
| `mutation` | ความผิดพลาดเชิงพฤติกรรมที่จงใจใส่เข้าไปถูกชุดหลักฐานจับได้ |
| `state-identity` | state ก่อน ระหว่าง หรือหลัง เป็นของ actor และ revision ที่ตั้งใจ |
| `integration` | หลายคอมโพเนนต์หรือขอบเขตภายนอกทำงานร่วมกันได้ |
| `compatibility` | สัญญาสาธารณะหรือที่ persist ไว้ยังเข้ากันได้ข้ามเวอร์ชันที่รองรับ |
| `performance` | latency, throughput, ทรัพยากร หรือขนาด อยู่ในงบที่วัดได้ |
| `security-static` | การตรวจความปลอดภัยเชิงสถิตครอบคลุม trust boundary และ sink ที่ไม่ปลอดภัยที่เปลี่ยนไป |
| `cross-repo-contract` | ฝั่งผลิตและฝั่งบริโภคตกลงกันบนสัญญาเวอร์ชันเดียวกัน |
| `review` | การรีวิวความเสี่ยงอย่างอิสระครอบคลุม claim และประเด็นที่ยังค้าง |
| `acceptance` | มีคนที่ระบุชื่อยอมรับการตัดสินใจเชิงอัตวิสัยอย่างชัดเจน |
| `static-analysis` | การคอมไพล์ type check lint และ static quality gate ผ่าน |
| `data-migration` | การเปลี่ยน schema หรือข้อมูลปลอดภัยไปข้างหน้า เข้ากันได้ย้อนหลัง และ rollback ได้ |
| `accessibility` | semantics การใช้คีย์บอร์ด focus contrast และการเข้าถึงด้วยเครื่องมือช่วย ผ่านนโยบาย |
| `resilience` | พฤติกรรมเรื่อง timeout retry ความล้มเหลวบางส่วน การกู้คืน และ dependency ที่ทำงานไม่เต็มที่ ถูกพิสูจน์ |
| `observability` | log, metric, trace และ alert ที่จำเป็นเปิดเผยทั้งความสำเร็จและความล้มเหลวอย่างปลอดภัย |
| `deployment` | การแพ็กเกจ การตั้งค่า health check ตอน rollout และพฤติกรรม rollback ถูกพิสูจน์ |
| `dependency-supply-chain` | นโยบายเรื่องช่องโหว่ ไลเซนส์ lockfile และ provenance ของ dependency ผ่าน |

รวม 19 ตัว change ส่วนใหญ่ใช้แค่สองสามตัว

## Receipt

receipt คือสิ่งที่ capability ผลิตออกมา มันผูกกับทุกอย่างที่ทำให้มันใช้ไม่ได้

```text
provider      browser
adapter       playwright · protocol 7
execution     harness
claims        profile-view, profile-update
workspace     sha256:7f31…
environment   node 22 · darwin-arm64
input         browser-automation
artifacts     trace.zip · screenshot.png
duration      8.42s
```

เปลี่ยน input ที่ผูกไว้เมื่อไหร่ receipt จะ stale ทันที Foundation ไม่เคยใช้หลักฐานที่ไม่ตรงกันซ้ำแบบเงียบ ๆ

`execution: harness` ถูกตั้งได้เฉพาะจากจุดเรียกที่รันคำสั่งจริง ดูเกณฑ์เต็มของหลักฐานที่บันทึกด้วยมือได้ที่ [`/prove`](/docs/th/loop/prove/)

## Test และ discovery

รายงาน JSON ที่ตั้งค่าไว้ต้องเปิดเผยจำนวนเต็มไม่ติดลบ เช่น `numTotalTests`, `totalTests`, `testCount` หรือ `expected`

ถ้าคำสั่งผ่านแต่ไม่มีจำนวนที่แน่นอน หลักฐาน test อาจผ่านได้ ขณะที่ discovery เป็น `inconclusive` — และการ land ยังถูกบล็อกอยู่ อาร์เรย์ สตริงตัวเลข คีย์ซ้อนที่กำหนดเอง และ stdout ที่ปนกัน **จะไม่** ถูกแปลงเป็นจำนวนให้ เพราะ suite ที่เงียบ ๆ แล้วเจอศูนย์เทสคือความล้มเหลวที่กฎนี้ตั้งใจดักไว้พอดี

## ความเชื่อมโยง

```bash
claude-foundation change audit <change>
```

ตรวจความเชื่อมโยง scenario → claim → task → provider ทุก scenario ที่สังเกตได้ควรไปถึง claim และทุก claim ควรไปถึง provider ที่พิสูจน์มันได้ scenario ที่ไม่มี claim คือคำสัญญาที่ไม่มีใครตรวจ
