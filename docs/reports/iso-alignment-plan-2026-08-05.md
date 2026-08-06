# ISO Alignment Plan — Foundation / Changeloop Harness

- **Date:** 2026-08-05
- **Status:** Draft proposal (ยังไม่เปิด OpenSpec change)
- **Scope:** ข้อเสนอต่อยอด harness จากผลสำรวจมาตรฐาน ISO ที่เกี่ยวกับซอฟต์แวร์
- **Language:** ไทย (identifier / คำสั่ง / clause คงภาษาอังกฤษ)

## Abstract (EN)

The harness already produces stronger process assurance than most ISO clauses
require — immutable content-bound receipts, sandbox isolation, semantic security
triggers, explicit human authority, and model-tier policy. The real gap is not
assurance; it is **translation** (auditor-readable artifacts) and a few
**organization-level loops** (CAPA, durable risk register, management review).
This plan proposes ten additions, all built on mechanisms that already exist.

---

## 1. บทสรุปผู้บริหาร

**harness นี้แทบเป็นเครื่องผลิต ISO evidence อยู่แล้วโดยไม่ได้ตั้งใจ**

สิ่งที่ ISO เรียกร้องแล้วองค์กรทั่วไปทำไม่ได้ คือ *หลักฐานว่ากระบวนการถูกใช้จริง
ไม่ใช่แค่มีเอกสาร* ซึ่ง `foundation.mjs` บังคับอยู่แล้วผ่าน receipt ที่
immutable + content-bound + fingerprint-validated

ช่องว่างจริงจึงไม่ใช่ "ยังไม่มีกระบวนการ" แต่คือ

1. **ยังไม่พูดภาษาที่ auditor อ่านออก** — receipt เป็น JSON, auditor ต้องการตาราง
   clause → หลักฐาน → ผู้อนุมัติ → วันที่
2. **ขาด loop ระดับองค์กร** — CAPA, durable risk register, management review
   ซึ่งอยู่เหนือขอบเขตของ change เดียว

ทั้งสิบข้อเสนอในเอกสารนี้ต่อยอดจากกลไกที่มีอยู่ **ไม่ต้องรื้อสถาปัตยกรรม**

---

## 2. ผลสำรวจมาตรฐาน (พื้นฐานของข้อเสนอ)

### 2.1 แยกประเภทมาตรฐาน

| กลุ่ม | ตัวอย่าง | ขอใบรับรองได้ไหม |
|---|---|---|
| มาตรฐานกระบวนการ | ISO/IEC/IEEE 12207, 15288, 29119 | ❌ เป็น reference ไม่ certify |
| ระบบบริหารจัดการ | ISO 9001, 27001, 42001, 20000-1, 13485 | ✅ ออกโดย certification body |
| เฉพาะโดเมน | IEC 62304, ISO 26262, IEC 61508 | ✅ ผ่าน regulator/assessor |

> **หมายเหตุสำคัญ:** ISO/IEC 12207 **ไม่มีใบรับรอง** — ถ้ามีใครเสนอขาย
> "ISO 12207 certificate" ให้ระวัง สิ่งที่ทำได้จริงคือ process assessment
> ตาม ISO/IEC 33000 (SPICE) / Automotive SPICE

### 2.2 มาตรฐานที่เกี่ยวข้องกับ harness โดยตรง

| มาตรฐาน | ฉบับล่าสุด | สาระ |
|---|---|---|
| ISO/IEC/IEEE 12207 | 2017 | วงจรชีวิตซอฟต์แวร์ 4 กลุ่มกระบวนการ, tailor ได้ (Agile ใช้ได้) |
| ISO/IEC/IEEE 15288 | 2023 | วงจรชีวิตระบบ (ครอบ 12207) |
| ISO/IEC 25010 | 2023 | โมเดลคุณภาพ 9 คุณลักษณะ |
| ISO/IEC/IEEE 29119 | 1–5 (2021–2022) | การทดสอบซอฟต์แวร์ (part 3 = test documentation) |
| ISO 9001 | 2015 | QMS — clause 4–10 บังคับ, กว่า 300 "shall" |
| ISO/IEC 27001 | 2022 | ISMS — Annex A 93 controls |
| ISO/IEC 42001 | 2023 | AI management system — 38 controls |
| ISO/IEC 5962 | 2021 | SPDX (SBOM format) |
| ISO/IEC 5230 | 2020 | OpenChain (open source compliance) |
| IEC 62304 | 2006+A1 | ซอฟต์แวร์เครื่องมือแพทย์, safety class A/B/C |
| ISO 26262 | 2018 | ยานยนต์, ASIL A–D |

### 2.3 ISO/IEC 25010:2023 — 9 คุณลักษณะ

`functional-suitability` · `performance-efficiency` · `compatibility` ·
`interaction-capability` (เดิม Usability) · `reliability` · `security` ·
`maintainability` · `flexibility` (เดิม Portability) · `safety` (ใหม่ในฉบับ 2023)

### 2.4 ISO 12207:2017 — 4 กลุ่มกระบวนการ

1. **Agreement** — Acquisition, Supply
2. **Organizational Project-Enabling** — Life Cycle Model Management,
   Infrastructure, Portfolio, Human Resource, Quality Management, Knowledge Management
3. **Technical Management** — Project Planning, Project Assessment & Control,
   Decision Management, Risk Management, Configuration Management,
   Information Management, Measurement, Quality Assurance
4. **Technical** — Business/Mission Analysis, Stakeholder Needs, System/Software
   Requirements, Architecture Definition, Design Definition, System Analysis,
   Implementation, Integration, Verification, Validation, Transition, Operation,
   Maintenance, Disposal

---

## 3. Gap analysis — ของที่มีอยู่ vs ข้อกำหนด

ประเมินจาก `.claude/orchestrator.md`, `.claude/harness/EVIDENCE.md`,
`openspec/schemas/foundation-standard/schema.yaml`, คำสั่ง 43 ตัวใน
`.claude/harness/commands.json` และ 21 crates ใน `Cargo.toml`

| ข้อกำหนด ISO | กลไกใน harness | สถานะ |
|---|---|---|
| 12207 Configuration Management | sandbox isolation + workspace hash + change revision | ✅ แข็งกว่าที่ขอ |
| 12207 Verification / Validation | `proof run` (V) + acceptance receipt (Val, human-only) | ✅ แยกชัดถูกต้อง |
| 12207 Decision / Risk Management | `change resolve` เก็บ impact/coupling/security | ⚠️ ต่อ change ไม่มี register ถาวร |
| 12207 Measurement | `metrics <change>` | ⚠️ วัด cost/usage ไม่มี quality objective |
| 9001 §7.5 Document control | OpenSpec + `land archive` + digest audit | ✅ |
| 9001 §8.3.5 Design outputs | proposal/spec/design/tasks artifacts | ✅ |
| 9001 §8.5.2 Traceability | `change audit` (scenario→claim→task→provider) | ⚠️ audit ได้ export ไม่ได้ |
| 9001 §8.7 Nonconforming output | review findings `verified\|hypothesis\|disproved\|accepted-risk` | ⚠️ ไม่มี ledger ข้ามเวลา |
| 9001 §9.2 Internal audit | `proof audit` + `land check` | ⚠️ ระดับ change เท่านั้น |
| 9001 §9.3 Management review | `dashboard snapshot` | ❌ |
| 9001 §10.2 CAPA | — | ❌ |
| 27001 A.8.25 Secure SDLC gates | security เป็น semantic trigger + review บังคับ | ✅ ดีมาก |
| 27001 A.8.31 แยก dev/test/prod | sandbox / worktree isolation | ✅ |
| 27001 A.8.30 Outsourced development | agent leases + model tier policy | ✅ (agent = supplier) |
| 27001 A.8.8 Vulnerability management | `deny.toml` มีแต่ไม่ใช่ evidence provider | ⚠️ |
| 27001 A.8.33 Test information | ไม่มีนโยบายห้ามใช้ prod data ใน test | ⚠️ |
| IEC 62304 §8.1.2 SOUP list | — | ❌ |
| IEC 62304 safety class A/B/C | schema tier `rapid`/`standard` | ⚠️ กลไกพร้อม ยังไม่มี tier |
| ISO/IEC 25010 quality model | capabilities `test\|browser\|accessibility` | ⚠️ vocabulary ไม่ครบ 9 ด้าน |
| 42001 human oversight | authority bridge + Human interaction boundary | ✅ เข้มกว่าที่ 42001 ขอ |
| 42001 provenance / logging | model/request provenance เฉพาะ review receipt | ⚠️ ยังไม่ครอบทุก evidence |
| 42001 AI impact assessment | — | ❌ |

**หลักการที่ตรงกันโดยบังเอิญ:** `orchestrator.md` เขียนว่า
*"Risk and evidence—not size—select assurance"* ซึ่งเป็นหลักคิดเดียวกับ
IEC 62304 safety class และ ISO 26262 ASIL แบบเป๊ะ — นี่คือเหตุผลที่ข้อเสนอ A
มีต้นทุนต่ำที่สุด

---

## 4. ข้อเสนอ (เรียงตาม leverage)

### A. `foundation-regulated` schema tier

**มาตรฐาน:** IEC 62304 (class A/B/C) · ISO 26262 (ASIL) · IEC 61508 (SIL)
**ต้นทุน:** ต่ำ — กลไก schema tier มีอยู่แล้ว
**ไฟล์:** `openspec/schemas/foundation-regulated/schema.yaml`, resolver ใน
`.claude/harness/foundation.mjs`, `crates/changeloop-policy`

เพิ่ม tier ที่สามต่อจาก `foundation-rapid` / `foundation-standard` ที่บังคับ:

- `design.md` เป็น required (ไม่ใช่ optional)
- artifact ใหม่ `soup.yaml` — รายการ third-party dependency + ประเมินความเสี่ยง
- acceptance receipt required เสมอ (ห้ามสถานะ `undecided`)
- review ต้องใช้ model family ต่างกันหรือมนุษย์ (critical policy บังคับ)
- evidence capability ต้องมีอย่างน้อย unit + integration + system

### B. `compliance report` — ตัวแปลง receipt → เอกสาร audit

**มาตรฐาน:** ทุกตัว (ISO 9001 / 27001 / 42001 / IEC 62304)
**ต้นทุน:** สูงสุดในชุดนี้ แต่มูลค่าสูงสุดเช่นกัน
**ไฟล์:** crate ใหม่ `crates/changeloop-compliance` (อ่านจาก `changeloop-evidence`
+ `changeloop-land`)

```
claude-foundation compliance report <change> \
  --standard iso9001|iso27001|iec62304|iso42001 \
  --format md|html|pdf
```

Auditor ไม่อ่าน JSON receipt แต่อ่านตารางที่บอกว่า
*"ข้อกำหนดข้อนี้ → หลักฐานชิ้นนี้ → ใครอนุมัติ → เมื่อไร"*
ข้อมูลมีครบใน `.foundation/evidence/<change>/<proof-run>/` แล้ว
เหลือแค่ render พร้อม clause mapping table

สอดคล้องกับหลัก *"Human interaction boundary"* ใน `orchestrator.md` ที่บอกว่า
ต้องแปล machine state เป็นภาษามนุษย์

> **บังคับ:** clause ที่ไม่มี receipt รองรับ ต้อง render เป็น `NOT EVIDENCED`
> ชัดเจน ห้ามปล่อยว่างหรือเดา (ดูข้อ 7.5)

### C. RTM export จาก `change audit`

**มาตรฐาน:** ISO 9001 §8.3.5 · ISO 12207 · IEC 62304 §5.1.1 · ISO 29119-3
**ต้นทุน:** ต่ำมาก — `change audit` ทำ traceability audit อยู่แล้ว เพิ่มแค่ format
**ไฟล์:** `.claude/harness/foundation.mjs`, `crates/changeloop-evidence`

```
claude-foundation change audit <change> --format rtm --out rtm.md
```

Requirements Traceability Matrix คือข้อที่ทีมซอฟต์แวร์ตก audit บ่อยที่สุด
ถ้า harness พ่นให้ฟรีคือจุดขายทันที

### D. Nonconformity + CAPA ledger ระดับองค์กร

**มาตรฐาน:** ISO 9001 §8.7 + §10.2
**ต้นทุน:** กลาง
**ไฟล์:** `.foundation/nonconformity/` (state), คำสั่งใหม่ใน harness

```
claude-foundation nonconformity list|open|close
claude-foundation capa report --since <date>
```

ปัจจุบัน review finding `accepted-risk` = ISO "concession / risk acceptance"
อยู่แล้ว แต่หายไปเมื่อ change ถูก archive

ต้องมี ledger ถาวรที่ตอบได้ว่า: finding นี้เปิดเมื่อไร root cause คืออะไร
แก้อย่างไร ปิดเมื่อไร มี recurrence หรือไม่

**โบนัส:** ถ้าเชื่อม finding → root cause → change ที่แก้ จะได้ CAPA ที่
traceable แบบที่องค์กรมนุษย์ทำไม่ค่อยได้

### E. Durable risk register

**มาตรฐาน:** ISO 9001 §6.1 · ISO 27001 §6.1.2–6.1.3 (+ SoA) · ISO 14971 · ISO 42001
**ต้นทุน:** กลาง
**ไฟล์:** `.foundation/risk/`, ต่อยอดจาก `change resolve`

```
claude-foundation risk list|add|treat|review
```

ยกระดับ impact/coupling/security ที่ `change resolve` เก็บต่อ change
ให้เป็น register ถาวรที่มี: risk · likelihood · impact · treatment ·
**residual risk** · owner · review date

### F. Supply chain evidence provider (SBOM + vulnerability scan)

**มาตรฐาน:** ISO/IEC 5962 (SPDX) · ISO 27001 A.8.8 + A.8.30 · ISO 9001 §8.4 ·
IEC 62304 §8.1.2 (SOUP)
**ต้นทุน:** ต่ำมาก — adapter `command` มีอยู่แล้ว และ `deny.toml` มีอยู่แล้ว
**ไฟล์:** `execution.yaml` template, `.claude/harness/EVIDENCE.md`

```yaml
providers:
  supply-chain:
    adapter: command
    command: ["cargo", "deny", "check"]
  sbom:
    adapter: command
    command: ["cargo", "sbom", "--output-format", "spdx_json_2_3"]
```

เป็น deterministic provider — ไม่ใช้ model, ไม่กิน budget

### G. ISO/IEC 25010:2023 เป็น vocabulary ของ claim

**มาตรฐาน:** ISO/IEC 25010:2023
**ต้นทุน:** ต่ำ — เพิ่ม field เดียว + validation
**ไฟล์:** `openspec/schemas/*/templates/evidence.yaml`, validator ใน harness

```yaml
claims:
  - id: profile-update
    scenario: The owner can update their profile
    qualityCharacteristic: functional-suitability   # ← ใหม่
    capabilities: [test, browser]
```

ค่าที่รับได้ = 9 คุณลักษณะของ 25010:2023 (ดูข้อ 2.3)

จากนั้น `change audit` เตือนได้ว่า
*"ไม่มี claim ใดครอบคลุม security หรือ reliability เลย"*
→ ทำให้ NFR gap มองเห็นได้ แทนที่จะหายเงียบ

### H. AI provenance ครบวง → ISO/IEC 42001

**มาตรฐาน:** ISO/IEC 42001:2023
**ต้นทุน:** กลาง–สูง
**ไฟล์:** `crates/changeloop-evidence`, `crates/changeloop-session`, telemetry

มาตรฐานเดียวที่ harness เป็นทั้ง *เครื่องมือช่วย* และ *ตัวถูกกำกับเอง*
เพราะมันคือ AI system ที่ทำงาน production

| 42001 ต้องการ | harness มีแล้ว | ขาด |
|---|---|---|
| Human oversight | authority bridge (request/status/record) | — |
| Accountability | model tier policy, budget window | — |
| Traceable decision | review provenance (model/request) | ขยายให้ครอบ **ทุก** evidence |
| AI impact assessment | — | artifact ใหม่ |
| Operational logging | telemetry import/sync | log ที่ตอบได้ว่า AI ตัดสินใจอะไร มนุษย์แทรกตรงไหน |

**ผลลัพธ์:** ลูกค้าที่ต้องผ่าน 42001 ใช้ harness แล้วได้หลักฐานฟรี และเรา
อ้าง conformance ของตัวเองได้ (AWS, Microsoft, Anthropic ถือใบนี้แล้ว)

### I. Quality objectives + management review pack

**มาตรฐาน:** ISO 9001 §6.2 + §9.1 + §9.3
**ต้นทุน:** กลาง
**ไฟล์:** `foundation.json`, `dashboard snapshot`

```json
{
  "qualityObjectives": {
    "firstPassProofRate": 0.85,
    "reviewFindingDensity": { "max": 3 },
    "escapedDefectRate": { "max": 0.05 },
    "evidenceStaleness": { "maxDays": 30 }
  }
}
```

แล้วสร้าง management review pack: objective vs actual · nonconformity trend ·
risk ที่ยังเปิด · audit findings

### J. ISO 29119-3 test documentation export

**มาตรฐาน:** ISO/IEC/IEEE 29119-3
**ต้นทุน:** ต่ำ (หลังทำ B แล้ว)
**ไฟล์:** `crates/changeloop-compliance`

Receipt มีข้อมูลครบเกือบหมดแล้ว เพิ่ม exporter เป็น Test Plan /
Test Design Spec / Test Case Spec / Test Result Report

---

## 5. ลำดับการทำ

### Phase 1 — Quick wins (< 1 สัปดาห์ต่ออัน)

| ลำดับ | งาน | เหตุผล |
|---|---|---|
| 1 | **C — RTM export** | ต่อยอด `change audit` ที่พร้อม ~90% แล้ว เสี่ยงต่ำสุด |
| 2 | **F — supply chain provider** | `deny.toml` + adapter `command` พร้อมแล้ว |
| 3 | **G — 25010 vocabulary** | เพิ่ม field เดียวใน schema + validation |

### Phase 2 — โครงสร้าง

| ลำดับ | งาน | ขึ้นกับ |
|---|---|---|
| 4 | **A — `foundation-regulated` tier** | F (SOUP list ใช้ SBOM) |
| 5 | **E — risk register** | — |
| 6 | **D — CAPA ledger** | E |

### Phase 3 — ผลผลิตสำหรับ auditor

| ลำดับ | งาน | ขึ้นกับ |
|---|---|---|
| 7 | **B — compliance report** | C, F, G (ต้องการ metadata ครบก่อน) |
| 8 | **J — 29119-3 export** | B |
| 9 | **I — management review pack** | D, E |
| 10 | **H — 42001 provenance ครบวง** | B, I |

---

## 6. เส้นทางสำหรับผู้ใช้ (สำหรับเอกสารการตลาด/README)

| ถ้าองค์กร… | เริ่มที่ |
|---|---|
| อยากได้ใบรับรองเพื่อประมูลงาน / ขายองค์กร | ISO 9001 |
| ขาย SaaS / ลูกค้าถาม security questionnaire | ISO/IEC 27001 (คุ้มกว่า 9001 ในสาย tech) |
| อยากยกระดับกระบวนการ ไม่ต้องการใบรับรอง | ใช้ 12207 + 29119 + 25010 เป็น reference |
| ทำผลิตภัณฑ์ AI | ISO/IEC 42001 |
| เครื่องมือแพทย์ / ยานยนต์ | IEC 62304+13485+14971 / ISO 26262+ASPICE (บังคับตามกฎหมาย) |

**บริบทต้นทุนการรับรอง (อ้างอิงตลาดสากล):** gap analysis $5–8k ·
documentation $1–8k · Stage 1+2 audit $14–16k · surveillance รายปี $6–7.5k ·
รวมเวลา 6–12 เดือน · ใบรับรองอายุ 3 ปี · ต้องมี evidence จากการใช้งานจริง
ย้อนหลังอย่างน้อย ~3 เดือน (เร่งไม่ได้ — นี่คือจุดที่ harness ช่วยได้มากที่สุด)

---

## 7. ข้อควรระวัง / ข้อจำกัด

### 7.1 อย่าให้กลายเป็น compliance theater

`.claude/rules/fundamentals.md` เขียนว่า *"Never cut security,
error/data-loss handling, evidence, regression contracts"* — หลักการเดียวกัน
ต้องใช้กลับด้วย: **อย่าเพิ่มพิธีกรรมที่ไม่เพิ่ม assurance จริง**
ทุกฟีเจอร์ต้องพิสูจน์ได้ว่าจับ defect ได้ ไม่ใช่แค่ผลิตกระดาษ

### 7.2 Shipping boundary

`CLAUDE.md` ระบุว่า `install.sh > PLAN` เป็น authoritative และ
*"Runtime files contain rules, not benchmark history"*

- ฟีเจอร์ compliance ต้องอยู่ใน `.claude/harness/**` + `openspec/schemas/**` เท่านั้น
- เอกสารประกอบ / clause mapping narrative ไปที่ `docs/` (ไม่ ship)
- ห้าม shipped file ชี้ไปยัง path ที่ไม่ ship

### 7.3 การทดสอบ

การแก้ shipped file ต้องอัปเดต `.claude/tests/` ด้วย แล้วรัน
`sh .claude/tests/run-all.sh`

### 7.4 ภาษาการตลาด

**ห้ามเคลมว่า "ISO certified harness"** — เครื่องมือผลิตหลักฐาน
ส่วนใบรับรองออกโดย certification body ให้แก่ *องค์กร*

ภาษาที่ปลอดภัย: *"audit-ready evidence"* / *"ISO 9001 clause-mapped artifacts"*
/ *"evidence pack for ISO/IEC 42001"*

### 7.5 ความเสี่ยงของข้อ B (compliance report)

ถ้ามันพ่นรายงานสวยจากหลักฐานที่ไม่มีจริง จะเลวร้ายกว่าไม่มีเลย
บังคับว่า clause ที่ไม่มี receipt รองรับต้องขึ้น `NOT EVIDENCED` ชัดเจน
ห้าม render ว่าง ห้ามอนุมาน

### 7.6 ขอบเขตที่ harness ทำแทนไม่ได้

ข้อกำหนดที่เป็นเรื่องคน/องค์กรล้วน — competence & training record (§7.2),
customer satisfaction (§9.1.2), leadership commitment (§5.1),
awareness (§7.3) — harness ช่วยไม่ได้ ต้องทำนอกระบบ
(ข้อ H เป็นเพียง *analog* ของ competence สำหรับ AI agent ไม่ใช่ตัวแทน)

---

## 8. สรุปประโยคเดียว

harness ทำ **assurance** ได้แข็งกว่าที่ ISO เรียกร้องอยู่แล้ว
สิ่งที่ขาดคือ **การแปลผล** (RTM, compliance report, 25010 vocabulary)
และ **loop ระดับองค์กร** (CAPA, risk register, management review)
ซึ่งทั้งหมดต่อยอดจากกลไกที่มีอยู่ ไม่ต้องรื้อสถาปัตยกรรม

---

## 9. แหล่งอ้างอิง

**มาตรฐานต้นทาง**

- [ISO/IEC/IEEE 12207:2017](https://www.iso.org/standard/63712.html)
- [ISO/IEC 25010:2023](https://www.iso.org/standard/78176.html) ·
  [iso25000.com](https://iso25000.com/index.php/en/iso-25000-standards/iso-25010)
- [ISO/IEC/IEEE 29119-1:2022](https://www.iso.org/standard/81291.html) ·
  [softwaretestingstandard.org](https://softwaretestingstandard.org/)
- [ISO/IEC 42001:2023](https://www.iso.org/standard/42001)
- [IEC 62304:2006](https://www.iso.org/obp/ui/en/#!iso:std:38421:en)

**คำอธิบาย / แนวปฏิบัติ**

- [ISO 9001 requirements & structure — Advisera](https://advisera.com/9001academy/knowledgebase/iso-9001-requirements-and-structure/)
- [ISO 9001 clause-by-clause — QualityCoach](https://qualitycoach.net/iso-9001-requirements/)
- [ISO 27001 A.8.25 Secure development life cycle — ISMS.online](https://www.isms.online/iso-27001/annex-a-2022/8-25-secure-development-life-cycle-2022/)
- [ISO 27001 A.8.28 Secure coding — ISMS.online](https://www.isms.online/iso-27001/annex-a-2022/8-28-secure-coding-2022/)
- [ISO 27001 A.8.25–8.27 architecture — DQS](https://www.dqsglobal.com/en/explore/blog/architecting-secure-software-with-iso-27001-controls-a.8.25-%E2%80%93-a.8.27)
- [ISO 42001 overview — Microsoft Learn](https://learn.microsoft.com/en-us/compliance/regulatory/offering-iso-42001)
- [IEC 62304 guide — Jama Software](https://www.jamasoftware.com/requirements-management-guide/medical-devices/iec-62304/)
- [Safety standards overview — Wind River](https://www.windriver.com/solutions/learning/what-are-safety-standards-for-industrial-automotive-medical)
- [ISO 27001 certification process — Secureframe](https://secureframe.com/hub/iso-27001/certification-process)
- [ISO 9001 certification timeline — Glocert](https://www.glocertinternational.com/resources/guides/iso-9001-certification-audit-process-and-timeline/)
- [ISO certification cost — ZenGRC](https://www.zengrc.com/blog/what-does-iso-certification-cost/)

**หลักฐานภายในรีโป (ที่ใช้ประเมิน gap)**

- `.claude/orchestrator.md`
- `.claude/harness/EVIDENCE.md`
- `.claude/harness/commands.json` (43 คำสั่ง)
- `openspec/schemas/foundation-standard/schema.yaml`
- `openspec/schemas/foundation-rapid/schema.yaml`
- `Cargo.toml` (21 crates)
- `.claude/rules/fundamentals.md`
- `CLAUDE.md` (shipping boundary)
