# แผนเร่งความเร็ว rapid path รอบ 2 (2026-09-30)

สถานะ: **อนุมัติขอบเขตแล้ว (ผู้ใช้เลือกข้อ 1, 2, 3, 5 จากการวิเคราะห์ OpenSpec) — เริ่มหลังรวมงานทีม B–F**
วิธีทำ: แก้ที่ root ด้วย deterministic verification ไม่ผ่าน change loop

## ที่มา

งานยาก `multi-service-event-flow` (oracle 6/6 ทั้งสองแบบ):

| | ไม่มี harness | มี harness (`767c5bb6c`) |
|---|---|---|
| Tool calls | 22 | 48 |
| Wall | 66s | 323s |
| ค่าใช้จ่าย | $0.46 | $2.05 |

งานไม่มี harness อีก 5 งานใช้ 10–17 calls, 34–45s, $0.32–0.39 ต่องาน
(`/tmp/cl-nh-summary.json`)

รอบแก้ที่กำลังทำ (ทีม B–F): keyword ทำให้บังคับแค่ review, ส่งทุก task ใน EDIT
เดียว, compiler จัดการ claim ID ซ้ำและ decision ที่ settle แล้ว, review เฉพาะ diff
ด้วย model เร็วสำหรับความเสี่ยงต่ำ, ตัด warning รบกวนและห้าม agent ตรวจ
เวอร์ชัน/state ก่อนเริ่ม

จาก OpenSpec: เร็วเพราะ instruction ~1–1.5k คำ/phase, agent เขียน artifact ตรงตาม
template, CLI แค่ validate และคืน path ที่ resolve แล้ว

## เป้าหมาย

- งานยาก: ≤ 2 นาที wall, ≤ $1.0, ≤ 30 tool calls, จบที่ `archived`, oracle ผ่าน
- งาน rapid (tiny-feature): ≤ 75s, ≤ 20 tool calls
- ต้นทุนที่เหลือเหนือแบบไม่มี harness ต้องอธิบายได้ด้วยงานใน core เท่านั้น
  (เขียน spec + review)

## ขอบเขตที่ไม่แตะ

spec approval (นับการอนุมัติในคำขอ), Land authority (คำสั่งแบบใดก็ได้),
review timeout/no-progress, **git worktree isolation (ผู้ใช้ยืนยัน 2026-10-01: ต้องมี)**, Land rollback/journal,
protect-secrets, evidence freshness, public command names/args

## Slices

ลำดับ: R0 → N3 → N1 → N6 → N7 → N2 → N5 → R1

### R0 — รวมงานทีม B–F

- รวม report, แก้ข้อขัดกัน, full suite ผ่าน, commit + push
- AC: `run-all.sh` 210+/210+ ผ่าน, `git diff --check` สะอาด

### N3 — EDIT แนบ path ที่ resolve แล้ว (เล็ก)

- ทุก EDIT/REPAIR จาก `advance` มี `contextFiles`: path จริงของ `proposal.md`,
  `tasks.md`, `specs/**` (หรือระบุว่าไม่มีสำหรับ rapid) และไฟล์ใน `[paths:]`
  ที่ต้องแก้
- ไฟล์: `advance-runtime.mjs` (buildAction/envelope), `rapid-path.md` บอกให้เปิด
  เฉพาะ `contextFiles`
- AC: unit test ว่า EDIT มี `contextFiles` ที่มีอยู่จริงทุก path; rapid ไม่มี
  `specs/` ใน list

### N1 — /dev เท่ากับ /change → /build → /prove → /land (ผู้ใช้เลือกแบบ B, 2026-10-01)

ผู้ใช้กำหนดว่า `/dev` ต้องทำงานเหมือนการรันคำสั่งแยกทุกประการ ใช้โครงสร้าง
"แต่ละคำสั่งเป็นต้นฉบับของ phase ตัวเอง":

- `.claude/harness/AGENT.md` (โหลดทุก session): กฎร่วมทุก phase ที่เดียว — ไม่
  preflight, หนึ่งคำสั่งต่อ shell call, ห้ามแก้ไฟล์ packet เอง, ห้ามอ่าน harness
  source, ทำตาม REPAIR/`command`/`resume`, การอนุมัติ spec ในคำขอนับเป็นการ
  อนุมัติ, คำสั่ง Land แบบใดก็ได้ให้สิทธิ์ Land
- `change.md`, `build.md`, `prove.md`, `land.md`: ขั้นตอนเฉพาะ phase (ย้ายจาก
  `rapid-path.md`) และจุดหยุดของคำสั่งนั้น
- `dev.md`: ทำ `/change` → `/build` → `/prove` → (`/land` เมื่อได้สิทธิ์) ต่อกันโดย
  ไม่หยุด ยกเว้น gate ของผู้ใช้
- ลบ `rapid-path.md`; trigger table ย้ายไป phase ที่เกี่ยว
- Budget (ผู้ใช้อนุมัติ): `AGENT.md` ≤ 300 คำ, แต่ละ phase ≤ 250 คำ, รวม
  `/dev` (AGENT + dev + 4 phase) ≤ 1,150 คำ
- Test: `dev.md` อ้างครบ 4 phase; กฎร่วมมีใน `AGENT.md` เท่านั้น (ไม่ซ้ำ);
  ไม่มี phase ใดขัดกฎร่วม; budget รวม
- ทำหลัง N2 (ส่วน draft ใน change.md อิงรูปแบบขั้นต่ำ)

### N6 — ปิด lease และ execution graph เมื่อทำงานคนเดียว (ผู้ใช้อนุมัติ 2026-10-01)

- เมื่อแผนรันใน session เดียว (agent ตัวเดียว ไม่มี native worker ขนาน) ไม่ต้อง
  acquire/release session lease และไม่ต้องคำนวณ dispatch graph ต่อ task;
  `advance` ส่งทุก task ตามลำดับ dependency (ต่อยอดจากทีม E)
- lease และ graph ยังทำงานเต็มเมื่อมีงานขนานหรือหลาย repository
- ไฟล์: `session-lease.mjs`, `agent-dispatch.mjs`, `advance-runtime.mjs`,
  `lease-runtime.mjs`
- AC: seam test ว่าแผน single-session ไม่เขียน lease และถึง proven ได้; แผนขนาน
  ยังได้ lease/fencing เหมือนเดิม

### N7 — rapid ยอมรับ exit 0 + มี test รัน เมื่อนับจำนวนไม่ได้ (ผู้ใช้อนุมัติ 2026-10-01)

- เฉพาะ lane rapid: ถ้า test provider exit 0 แต่ parse จำนวน test ไม่ได้ ให้ผ่าน
  เมื่อมีหลักฐานว่ามี test รันอย่างน้อย 1 ตัว (เช่น output มีบรรทัด pass/ok/✔ หรือ
  ไฟล์ test ที่ตรง `[paths:]` ถูกเรียก) และบันทึก receipt เป็น
  `countMeasurement: "exit-code"` ไม่ใช่ตัวเลขปลอม
- exit ≠ 0 ยัง fail; standard/high-risk ยังต้องนับจำนวนได้ตามเดิม; ไม่มีหลักฐาน
  ว่า test รันเลย → ยัง inconclusive
- ไฟล์: `adapter-runtime.mjs` (test-discovery), `evidence-results.mjs`,
  receipt schema/EVIDENCE.md
- AC: unit test ทั้งสามกรณี (rapid exit0+evidence → pass, rapid exit0 ไม่มีหลักฐาน →
  inconclusive, standard exit0 ไม่มี count → inconclusive)

### N2 — draft แบบขั้นต่ำ (กลาง, ผลสูงสุด)

- Draft v4 ขั้นต่ำที่ compile ได้:
  `intent` + `requirements[{description (SHALL), scenarios[{when, then}]}]` +
  `tasks[{outcome, verify, paths}]`
- Compiler เติมเอง: `version` (4), requirement/task `key` (จาก text),
  `capability` (จาก intent/พาธ), `operation` (added เว้นแต่ตรง canonical spec →
  modified), scenario `name` (จาก `when`), `covers` (task เดียว → ทุก requirement;
  หลาย task → จับคู่จาก `paths`/ข้อความ หรือคืน EDIT ที่ระบุชัด), `impact: low`,
  `coupling: isolated`, `workType`, `summary`/`why` (จาก intent),
  `capabilityOverviews` (ข้าม), evidence (test จาก verify)
- `change start --template` แสดงรูปแบบขั้นต่ำเป็นค่าเริ่มต้น; รูปแบบเต็มยังรับได้
- ไฟล์: `semantic-draft.mjs` (normalize/defaults), `change-lifecycle.mjs`
  (template), `rapid-path.md` (draft essentials สั้นลง)
- AC: draft ขั้นต่ำ 3 field compile ได้ใน `change start` ครั้งเดียว; draft เต็ม
  เดิมยังผ่านทุก test; v3 compatibility ผ่าน; standard lane ยังต้องใส่ข้อมูลที่
  จำเป็นตาม risk

### N5 — review ขนานกับ test (กลาง)

- ใน `proof advance` รัน configured review (diff-scoped จากทีม F) พร้อมกับ test
  provider ทั้งสองผูก workspace hash เดียวกัน; ถ้า test ล้ม ยังเก็บผล review ไว้
  ใช้ต่อเมื่อ hash ไม่เปลี่ยน
- ไฟล์: `proof-execution-runtime.mjs`, `provider-scheduler.mjs`,
  `advance-runtime.mjs` (inline review จาก S1)
- AC: seam test ว่า review และ test เริ่มก่อนอีกตัวจบ; proof freshness/receipt
  semantics เดิมผ่าน; review ถูก invalidate เมื่อ repair เปลี่ยน diff

### R1 — วัดผล (เสียเงิน ~ $6–10)

- รัน 6 งาน (tiny ไม่รวม) แบบมี harness ด้วย prompt `/dev <matrix prompt>. I
  approve the spec. Land it when proven.` วิธีวัดเดียวกับแบบไม่มี harness
  (`/tmp/cl-nh-measure.py`)
- อัปเดต artifact report ด้วยตารางเทียบ 6 งาน × 2 แบบ
- AC: ทุกงานจบที่ `archived`, oracle ผลเท่ากับแบบไม่มี harness (refactor มี
  oracle bug เรื่องชื่อ helper — บันทึกแยก)

## ความเสี่ยง

| ความเสี่ยง | ป้องกัน |
|---|---|
| Compiler เดา `covers`/`operation` ผิด | เดาเฉพาะกรณีชัด (task เดียว, ไม่มี canonical spec ตรง) นอกนั้นคืน EDIT ที่ระบุ field |
| ตัด instruction แล้ว Land/recovery พลาด | test ยืนยันว่า rapid-path ครอบทุก action type และ Land |
| Review ขนานกินทรัพยากรพร้อม test | จำกัดด้วย `maxParallelProviders` เดิม |
| Test รั่วเข้ารีโปจริง | รันผ่าน runner เท่านั้น (fragment มี guard แล้ว) |

## ความรับผิดชอบ

- ผู้ใช้: อนุมัติขอบเขต (แล้ว), อนุมัติค่าใช้จ่าย R1, สั่ง release
- Agent: N1–N5, test, เอกสาร EN/TH, รวมงาน
- Harness: context budget, contract tests, benchmark scorecard (`hostToolCalls`)
