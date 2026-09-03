---
title: ตั้งค่า foundation.json
description: ทำความเข้าใจและปรับ policy ของ Change Loop สำหรับ execution, model tier, escalation, review, sandbox และ workflow อย่างปลอดภัย
---

`foundation.json` คือ **policy ที่ commit ไว้สำหรับหนึ่งโปรเจกต์** มันบอก
Change Loop ว่า agent ทำงานอัตโนมัติได้มากแค่ไหน, งานแต่ละแบบควรใช้ model tier
ใด, เมื่อไรต้อง escalate, ใครรีวิวได้ และต้องเตรียม Build workspace ใหม่อย่างไร

ไฟล์นี้ไม่ได้เก็บ requirement ของผลิตภัณฑ์หรือสถานะงานปัจจุบัน:

| เรื่อง | Source of truth |
|---|---|
| ผลิตภัณฑ์ควรทำอะไร | `openspec/` |
| implementation เหลืออะไร | `tasks.md` ใน change ที่ active |
| runtime state และ receipt | `.foundation/` |
| Change Loop มีสิทธิ์ execute อย่างไร | `foundation.json` |

installer คัดลอกไฟล์นี้ให้เฉพาะตอนที่ยังไม่มี หลังจากนั้นไฟล์เป็นของโปรเจกต์
และ upgrade จะไม่เขียนทับ ควร commit ไว้เพื่อให้ developer กับ reviewer ทุกคน
ทำงานภายใต้ policy เดียวกันที่ตรวจสอบได้

:::caution[อย่าลบไฟล์เพื่อ “reset” policy]
ถ้าไฟล์หาย runtime จะใช้ compatibility default ซึ่งอาจไม่เหมือน profile ที่มา
กับ installation ใหม่ ให้ restore หรือแก้ไฟล์ที่ commit ไว้แทน
:::

## Profile เริ่มต้น

profile ปัจจุบันออกแบบให้ Claude Code ตัวเดียวเริ่มใช้งานได้ ใช้ Claude Opus
สำหรับ configured review และอนุญาต identity/model family เดียวกัน:

```json
{
  "review": {
    "independence": "self",
    "diversity": "single-model",
    "defaultReviewer": "claude-opus"
  },
  "workflow": {
    "grounding": "optional",
    "reviewCircuit": "full-delta",
    "reviewPolicy": "risk-tiered"
  }
}
```

ไฟล์จริงยังมี execution budget, model tier, escalation trigger และ reviewer
definition ทั้งสองตัว ให้แก้ object เดิม อย่าแทนทั้งไฟล์ด้วยตัวอย่างย่อด้านบน

`self` กับ `single-model` เป็น waiver ที่ประกาศตรง ๆ ไม่ได้แปลว่า review นั้น
independent หรือ diverse receipt จะบันทึก `independence-waived-self-review`
และ `diversity-waived-single-model` เพื่อให้ trade-off ตรวจสอบย้อนหลังได้

## ขั้นตอนแก้ที่ปลอดภัย

1. แก้ `foundation.json` ที่ root และคง `version` เป็น `1`
2. รัน `claude-foundation doctor --stage change` เพื่อตรวจ policy ทั่วไป
3. ถ้าแก้ review ให้รัน `claude-foundation doctor --stage prove` เพื่อตรวจ CLI,
   authentication และ read-only mode ของ reviewer
4. ดู model routing ด้วย `claude-foundation models`
5. commit policy ก่อนสร้าง evidence ภายใต้นโยบายใหม่

การเปลี่ยน policy อาจทำให้ review หรือ proof ที่สร้างด้วย contract เก่า stale
ให้รัน readiness และ Prove ใหม่ อย่าแก้ receipt ด้วยมือ

## `execution`: กำหนดขอบเขต autonomous run

```json
{
  "execution": {
    "maxParallelAgents": 3,
    "packetBytes": {
      "task": 8192,
      "review": 8192,
      "repository": 12288,
      "global": 16384
    },
    "tokenBudgets": { "rapid": 800000, "standard": 1600000 },
    "requestBudgets": { "rapid": 100, "standard": 200 },
    "maxContinuationWindows": 3,
    "planSummaryBytes": 4096,
    "leaseMinutes": 45
  }
}
```

| Field | ค่าที่ใช้ได้ | ปรับเมื่อไร |
|---|---|---|
| `maxParallelAgents` | จำนวนเต็ม `1..16` | ลดเมื่อเครื่องจำกัดหรืองานผูกกันแน่น เพิ่มเฉพาะเมื่อแยก task ได้ปลอดภัย |
| `packetBytes.*` | จำนวนเต็ม `2048..65536` byte | เพิ่มเมื่อ task, review, repository description หรือ packet ทั้งก้อนถูกตัดจริง ๆ |
| `tokenBudgets.rapid/standard` | จำนวนเต็ม `10000..100000000` | จำกัด token ของ autonomous run หนึ่งรอบ เป็นเพดาน ไม่ใช่เป้าหมาย |
| `requestBudgets.rapid/standard` | จำนวนเต็ม `10..100000` | จำกัดจำนวน model request ต่อ run |
| `maxContinuationWindows` | จำนวนเต็ม `1..20` | จำกัดจำนวน continuation window ที่ operator อนุมัติแยกกัน โดยไม่บังคับงานเดิมที่ยังค้างให้แตกเป็น Change ใหม่ |
| `planSummaryBytes` | จำนวนเต็ม `1024..16384` | จำกัด plan แบบย่อที่ส่งต่อระหว่าง phase |
| `leaseMinutes` | ตัวเลข `1..1440` | เพิ่มสำหรับ build ช้า หรือลดเพื่อคืนงานจาก worker ที่ค้างเร็วขึ้น |

เมื่อใช้ budget ถึง 85% Change Loop จะเข้า completion-only mode และหยุดงาน
สำรวจหรือ refactor ที่ไม่จำเป็น เมื่อถึง 100% operator สามารถอนุมัติ window ใหม่
แบบมี audit ได้ตราบใดที่ยังมีงานใน scope เดิมค้างอยู่ จนถึงเพดาน
`maxContinuationWindows` ส่วน readiness, receipt reuse, recovery และ archive
ยังทำงานต่อได้โดยไม่ต้องขยาย budget

:::tip
อย่าเพิ่ม budget ทุกตัวเพื่อแก้ task ใหญ่เพียงตัวเดียว ลองแบ่งงานที่เป็นอิสระ,
ตัด context ที่ไม่เกี่ยว หรือย้าย fact ถาวรเข้า OpenSpec ก่อน
:::

## `quality`: เปิด quality gate แบบเป็นขั้น

`quality.changeGate` รับค่า `off`, `warn` หรือ `enforce-high-risk` โหมด warn
จะแจ้งเมื่อ Change ความเสี่ยงสูงไม่มี provider สำหรับ changed-quality
(coverage, complexity และ CRAP) หรือ mutation ส่วน enforce จะบังคับทั้งสอง
capability สำหรับงาน high-impact หรือ security-sensitive โดยแต่ละภาษาสามารถ
ใช้ command adapter ของโครงการเองได้

field นี้เลือก **ว่า Change แบบไหนต้องมี quality evidence** ส่วนไฟล์ commit แยก
`quality/foundation-quality.json` กำหนด **ว่าแต่ละ repository สร้างและประเมิน
หลักฐานนั้นอย่างไร** ได้แก่ language profile, command, built-in normalizer,
threshold, baseline และ exception ให้สร้างไฟล์นี้ด้วย `quality init` ไม่ใช่เพิ่ม
provider command ลง `foundation.json` ดูรายละเอียดที่
[Quality gate ของโปรเจกต์](/docs/th/consumer-quality/)

## `models`: route ตามจุดประสงค์ ไม่ผูกกับคำสั่งของ host

```json
{
  "models": {
    "fast": {
      "family": "haiku",
      "fallbackTier": "standard",
      "purposes": ["inventory", "logs", "mechanical-docs"]
    },
    "standard": {
      "family": "sonnet",
      "fallbackTier": "deep",
      "purposes": ["implementation", "tests", "focused-investigation"]
    },
    "deep": {
      "family": "opus",
      "fallbackTier": null,
      "purposes": ["architecture", "security", "migration", "independent-review"]
    }
  }
}
```

key `fast`, `standard` และ `deep` คือ portable tier ส่วน `family` ระบุ family
ที่ต้องการ ขณะที่ native agent host เป็นตัวรัน model จริง `fallbackTier` ต้องเป็น
หนึ่งในสาม tier หรือ `null` และ `deep` ห้าม fallback ลง tier ต่ำกว่า

ควรรักษา purpose list ให้แคบ change ความเสี่ยงสูงต้อง escalate ตาม boundary
แม้ diff จะเล็ก การใส่งานทุกแบบไว้ใน `fast` ไม่ได้ทำให้งาน security หรือ
migration กลายเป็น low risk

## `escalation`: เงื่อนไขที่ต้องใช้ judgment ลึกขึ้น

trigger เริ่มต้นมีดังนี้:

- `ambiguous-contract` — behavior หรือสิ่งที่ไม่รวมใน scope ยังไม่ชัด;
- `auth-or-sensitive-data` — เกี่ยวข้องกับ authorization, secret หรือข้อมูลอ่อนไหว;
- `migration` — ต้องย้าย persistent state หรือ compatibility อย่างปลอดภัย;
- `concurrency` — ordering, race, retry หรือ idempotency มีผล;
- `public-compatibility` — public interface หรือ behavior ที่ support อาจเปลี่ยน;
- `cross-repository-conflict` — scope หรือ version ระหว่าง repository ขัดกัน;
- `evidence-anomaly` — evidence หาย ขัดแย้ง หรือ stale ผิดคาด;
- `two-failed-attempts` — approach ปัจจุบันล้มเหลวสองครั้งแล้ว

escalation เลือก investigation หรือ review ที่ลึกขึ้น มันไม่ขยาย write authority,
ข้าม budget หรือเปลี่ยน credential ภายนอกให้เป็น permission ของ agent

## `review`: เลือกความสะดวกหรือ separation of duties

review มีสองแกนที่แยกจากกัน:

| Field | ผ่อนปรน | เข้มงวด |
|---|---|---|
| `independence` | `self`: identity/session เดียวกันรีวิวได้ | `required`: identity และ AI session ต้องต่างกัน |
| `diversity` | `single-model`: provider/family อื่นเป็นเพียง preferred | `required`: AI reviewer ต้องมาจากคนละ provider และ model family |

### ค่า default: Claude installation เดียว

```json
{
  "review": {
    "independence": "self",
    "diversity": "single-model",
    "defaultReviewer": "claude-opus"
  }
}
```

profile นี้เริ่มง่ายที่สุด configured review ผ่าน `authority run` ยังคงเป็น
read-only และ ephemeral แต่ policy ไม่บังคับ identity หรือ model family ที่ต่างกัน

### Model เดิม แต่แยก reviewer session

```json
{
  "review": {
    "independence": "required",
    "diversity": "single-model",
    "defaultReviewer": "claude-opus"
  }
}
```

ใช้เมื่อมี provider เดียว แต่รับ self-review ไม่ได้

### Review ข้าม provider

ถ้า implement ด้วย Claude:

```json
{
  "review": {
    "independence": "required",
    "diversity": "required",
    "defaultReviewer": "codex-sol"
  }
}
```

ถ้า implement ด้วย Codex ให้เลือก `claude-opus` แทน เมื่อ diversity เป็น
`required` reviewer ต้องต่างจาก implementation provenance จริง ไม่เช่นนั้น
receipt จะ fail closed

reviewer definition อยู่ใต้ `review.reviewers` โดย reviewer ที่ตั้งค่าต้อง:

- ใช้ adapter `claude-cli` หรือ `codex-cli` คู่กับ provider family ที่ถูกต้อง;
- ระบุ executable ที่ติดตั้งแล้วและ model ID;
- ใช้ `reasoningEffort: "high"`;
- ใช้ `sandbox: "read-only"` และ `ephemeral: true`

อย่าใส่ credential, token หรือ login command ใน `foundation.json` ให้ติดตั้งและ
login CLI ตามปกติ แล้วใช้ `doctor --stage prove` ตรวจ readiness

## `sandbox`: เตรียม Build workspace ใหม่

Git worktree มี tracked file แต่ไม่มี `node_modules` ถ้า evidence ต้องใช้
dependency ให้เพิ่ม setup command ที่ deterministic:

```json
{
  "sandbox": {
    "setupCommand": "npm ci",
    "setupTimeoutMs": 600000
  }
}
```

`setupCommand` ต้องเป็น string ที่ไม่ว่าง `setupTimeoutMs` ต้องเป็นจำนวนเต็ม
ตั้งแต่ `1000` ถึง `3600000` คำสั่งรันหนึ่งครั้งในทุก workspace ใหม่ ถ้าล้มเหลว
Change Loop จะเก็บ workspace และรายงานวิธีกู้ แทนที่จะทำต่อใน sandbox ที่เตรียม
ไม่ครบ

โปรเจกต์หลาย repository ให้เก็บ root setup ไว้ที่นี่ และใส่ setup เฉพาะ repo
ใน `openspec/repositories.yaml` topology, scope ของ change, scope ของ provider
และลำดับ Land เป็นคนละ contract ให้ตั้งค่าตามลำดับในคู่มือ
[Workflow หลาย Repository](/docs/th/multi-repository/)

## `workflow`: ใช้ control circuit รุ่นปัจจุบัน

```json
{
  "workflow": {
    "grounding": "optional",
    "reviewCircuit": "full-delta",
    "reviewPolicy": "risk-tiered"
  }
}
```

- `grounding` รับ `required` หรือ `optional`;
- `reviewCircuit` รับ `full-delta` หรือค่า compatibility `legacy`;
- `reviewPolicy` รับ `risk-tiered` หรือค่า compatibility `legacy`

งานใหม่ควรใช้ค่าที่ ship มา ค่า legacy มีไว้สำหรับอ่านโปรเจกต์เก่า ไม่ใช่วิธีที่
แนะนำสำหรับลดความเข้มของ review
`optional` แปลว่า semantic compiler สร้าง `grounding.yaml` เฉพาะเมื่อมี material
non-derived decision จริง ตั้งเป็น `required` เมื่อ policy ของ project ต้องมี
decision ledger ทุก change เท่านั้น เพราะ grounding ว่างไม่ได้เพิ่มคุณภาพ

## จุดที่พลาดบ่อย

- **แทนทั้งไฟล์ด้วยตัวอย่างย่อ** ให้แก้ object เดิมเพื่อรักษา reviewer definition
  และ policy section อื่นไว้
- **มอง budget เป็นโควตา** change เล็กควรจบโดยใช้ต่ำกว่าเพดานมาก
- **บังคับ diversity แต่เลือก model family เดียวกับ implementer** review receipt
  จะ fail อย่างถูกต้อง
- **ให้ `deep` fallback ไป `fast` หรือ `standard`** runtime จะปฏิเสธการ downgrade
- **ใส่ secret ใน setup หรือ reviewer field** เก็บ secret ออกจาก committed policy
  และใช้ authentication ปกติของ CLI
- **คาดว่า upgrade จะเปลี่ยน policy โปรเจกต์** installer รักษาไฟล์นี้หลังสร้างครั้งแรก
  ต้องอัปเดตโดยตั้งใจและ review diff

หลังแก้ทุกครั้ง ชุดตรวจที่สั้นและเชื่อถือได้คือ:

```bash
claude-foundation doctor --stage change
claude-foundation doctor --stage prove
claude-foundation models
```
