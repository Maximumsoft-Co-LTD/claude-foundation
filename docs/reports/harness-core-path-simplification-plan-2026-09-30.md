# แผนทำ core path ให้บาง (2026-09-30)

สถานะ: **ดำเนินการแล้ว 2026-09-30 (ยังไม่ commit) — ดูผลวัดท้ายเอกสาร** · ขอบเขตที่ผู้ใช้เลือก: ข้อ 1–6 + ตัวนับ overhead + benchmark
วิธีทำ: แก้ที่ root ด้วย deterministic verification (ไม่ผ่าน change loop ตามที่ผู้ใช้สั่ง)

## เป้าหมาย

ให้ harness ทำงานตาม core ที่ผู้ใช้นิยาม:

| Phase | Core |
|---|---|
| Investigate | หาว่าจะทำอย่างไร (optional) |
| Change | เขียนเอกสารให้ครบ ถามเฉพาะสิ่งที่ไม่ชัด ส่งต่อให้ Build ได้ทันที |
| Build | เขียนโค้ดใน git worktree ให้ตรงกับ change |
| Prove | รัน test + review ว่าผ่านตาม change |
| Land | นำงานจาก worktree เข้า main workspace และ archive |
| Deliver | phase เสริม (commit/PR) |

ส่วนอื่นยังคงอยู่ แต่ไม่ขวางทางปกติของงานเล็ก

## Baseline (E2E `claude -p`, ฟีเจอร์ 3 บรรทัด, ก่อน commit `99f115385`)

รอบที่สำเร็จใช้ **97 tool calls / 99 turns / 426 วินาที / ~$2.95** เป็นงาน product จริงแค่ประมาณ 5 call:

| หมวด | Calls |
|---|---|
| Harness CLI (12 คำสั่งต่างกัน) | 35 |
| อ่าน doc/source ของ harness เพื่อหาทางแก้ | ~27 |
| อ่าน state/receipt ใน `.foundation` | 16 |
| เขียน artifact ของ harness | 12 |
| งาน product | ~5 |

ต้นเหตุ: agent ต้องเรียนรู้และคุม harness เองระหว่างทำงาน ไม่ใช่แค่ gate ที่หยุดถาม

## หลักการ

- ไม่ลบหรือเปลี่ยนชื่อคำสั่ง public (เป็น compatibility contract) ใช้วิธีซ่อนจาก agent หรือให้ `advance` เรียกแทน
- ไม่แตะ gate ที่ผู้ใช้เลือกให้คง: spec approval, Land, review timeout/no-progress
- ไม่แตะ worktree isolation, Land rollback/journal, protect-secrets, evidence freshness
- เปลี่ยน `protocol.json` เฉพาะเมื่อ wire contract เปลี่ยนจริง
- ทุก slice ต้องมี regression test ระดับต่ำสุดที่จับได้ + full suite ผ่าน

## ความรับผิดชอบ

- **ผู้ใช้ตัดสินใจ:** ขอบเขต, default ของ policy ที่กระทบ consumer, การใช้เงินกับ benchmark, การตัดเนื้อหา instruction (context-budget test ระบุว่าต้องให้ผู้ใช้เลือก)
- **Agent เขียนโค้ดและเอกสาร:** ทุก slice ข้างล่าง รวม test และเอกสาร EN/TH
- **Harness ทำอัตโนมัติ:** ตัวนับ overhead, benchmark scenario, test ตรวจว่าทุก stop มีวิธีแก้

## จุดที่ผู้ใช้ต้องตัดสินใจ

| # | เรื่อง | ข้อเสนอ |
|---|---|---|
| D1 | ใช้เงินกับ benchmark ก่อน/หลังแก้ (ประมาณ $3 ต่อรอบ × 2) | รัน baseline 1 รอบหลัง S0 และรอบวัดผล 1 รอบหลัง S6 |
| D2 | default ของ consumer: model tier routing, budget watchdog และ quality gate ใน `foundation.json` | ตั้ง default เป็นปิด (single model, budget ไม่ทำงาน, quality `off`) ส่วน consumer ที่ตั้งค่าไว้เองยังคงค่าเดิม |
| D3 | ลดเนื้อหา instruction ของ `change/references/workflow.md` (ตอนนี้ 1397/1400 คำ) และ `build-policy.md` (1058 คำ) | ย้ายรายละเอียดไป reference แบบ conditional และตั้ง budget ใหม่ให้ build-policy |
| D4 | ให้ `advance` รัน configured reviewer (`authority run`) เองสำหรับ reviewer ที่ agent รันได้ | เห็นด้วย ส่วน reviewer ภายนอกยังเป็น WAIT เหมือนเดิม |
| D5 | เลิกให้ agent ติ๊ก checkbox ใน `tasks.md` เอง | ให้ `advance` ติ๊กเมื่อ focused check ของ task ผ่าน |

## Slices

ลำดับ: S0 → S2 → S1 → S3 → S4 → S5 → S6 → S7 (S2 ทำก่อน S1 เพราะ `advance` ต้องส่งต่อวิธีแก้ที่ถูกต้องได้)

### S0 — ตัวนับ overhead + scenario benchmark (ไม่เสียเงิน ยกเว้นตอนรัน baseline)

- **Scorecard:** เพิ่ม `hostToolCalls` (มีอยู่แล้วใน `run.mjs:565-579` แต่ `operationSummary` ใน `scorecard.mjs:196-221` ทิ้งไป) แยกตามหมวด: harness CLI, อ่าน harness doc, อ่าน state, เขียน artifact, งาน product และขยาย schema
- **Metrics:** ให้ transcript importer (`telemetry.mjs:99-104`) นับ `tool_use` ตามชื่อ tool และตาม path แล้วแสดงใน `metrics <change>` คู่กับ `commandProfile`
- **Scenario ใหม่ `tiny-feature`:** อยู่ที่ `.claude/tests/bench/tasks/<nn>-tiny-feature/` (seed + oracle) เพิ่มแถวใน matrix แก้จำนวนที่ hard-code ไว้ใน `openspec-native-matrix.test.mjs:10-12` และตั้ง `tool_calls_max: 20` ใน targets
- **Stop:** เพิ่ม `--max-tool-calls` คู่กับ `--max-model-requests`
- **AC:** sentinel ผ่าน, schema validate, และ scorecard ที่ได้จาก collect-only มี `hostToolCalls`
- **รัน baseline** (D1): 1 รอบ บน consumer ที่ทิ้งได้ และต้องจบที่ `archived`

### S2 — ทุก BLOCKED บอกวิธีแก้ในตัว (ข้อ 2)

- **Validation:** `validateLifecycleOutcome` (`core/lifecycle-outcome.mjs:27-60`) ต้องบังคับให้ REPAIR มี `command` หรือ `instruction` ที่ทำตามได้ทันที
- **Fallback:** เมื่อ `advanceFailureAction` (`advance-runtime.mjs:92-148`) ไม่มีคำสั่งให้แนบ ให้คืน field ที่ผิดและค่าที่ต้องการ แทนการคืนแค่ `doctor --stage`
- **ปรับข้อความ `fail()` ใน hot path** ได้แก่ `change-lifecycle.mjs` (60), `change-validation.mjs` (57), `proof-readiness.mjs` และ `adapter-runtime.mjs` ให้บอก field หรือคำสั่งที่แก้ได้ โดยเริ่มจาก error ที่เจอใน E2E
- **Test ใหม่:** วนทุก `legacyAction` และ readiness status แล้วยืนยันว่ามี recovery ที่ทำตามได้ และตรวจว่า BLOCKED ไม่มีข้อความที่ทำให้ agent ต้องไปอ่าน source
- **AC:** test ใหม่ผ่าน และข้อความ error ทุกตัวที่เจอใน E2E ระบุวิธีแก้

### S1 — agent ใช้แค่ `change start` + `advance` (ข้อ 1)

- **`advance` ทำแทน agent:**
  - `evidence init/upgrade` เมื่อ wiring ขาดหรือเก่า (ตอนนี้แค่ส่งชื่อคำสั่งกลับมา: `proof-readiness.mjs:658`)
  - `sandbox sync` ในทุกกรณีที่ sync เองได้
  - `authority run` สำหรับ reviewer ที่ agent รันได้ (D4)
- **`advance --approve-spec --decision-ref <ref>`:** เพิ่มเป็น alias ของ `change resolve --approve-spec` ส่วนคำสั่งเดิมยังใช้ได้
- **Help ของ agent:** `cli.sh:127-157` ให้ help แบบย่อแสดงแค่ `change start`, `advance` และ `changes` และจัด `advance` เข้ากลุ่ม Workflow (ตอนนี้อยู่ใน host)
- **Instruction:** แก้ `commands/*.md`, `skills/*/references`, `orchestrator.md` ไม่ให้สั่งคำสั่งอื่นในเส้นทางปกติ ย้ายคำสั่ง operator ไปไว้ใน `.claude/harness/README.md`
- **AC:** test ตรวจว่าในเส้นทางปกติ instruction ของ agent อ้างถึงแค่ `change start`, `advance` และ `changes` และ seam test ยืนยันว่า `advance` เดินผ่าน evidence upgrade, sync และ reviewer ได้เอง

### S3 — Prove ของงาน rapid = verify + AI review 1 รอบ (ข้อ 3)

- **Capability:** `evidence[key].capabilities` เป็น optional สำหรับ lane rapid และใช้ค่า default `["test"]` ที่ได้จาก `tasks[].verify` (`semantic-draft.mjs:305-313`)
- **Discovery:** ถ้า verify เรียก `node --test` หรือ `npm test` ที่ห่อ `node --test` ไว้ ให้ใส่ `--test-reporter=tap` หรือใช้ spec parser อัตโนมัติ (ส่วน spec parser ทำไปแล้ว) ถ้าไม่มี test count ให้ใช้ exit code ร่วมกับ `minimum` ที่ประกาศไว้ ตามกติกาเดิมที่มีอยู่
- **Review:** tier low ของ risk-tiered review เป็น `ai-full` 1 รอบอยู่แล้ว ให้ `advance` รันเอง (ต่อจาก S1)
- **Agent ไม่แตะ `execution.yaml` และ `evidence.yaml` ในงาน rapid:** ถ้าต้องแก้ wiring ให้ทำผ่าน `advance` repair
- **AC:** seam test ที่ draft ไม่มี `evidence.capabilities` ผ่านไปถึง proven ได้ และ proof loop ผ่านครบ

### S4 — agent เขียนแค่ draft ใน Change (ข้อ 4)

- **Checkbox (D5):** `advance` ติ๊ก `tasks.md` เองเมื่อ focused check ของ task ผ่าน และเอาคำสั่งให้ agent ติ๊กออกจาก `build-policy.md:12-15`, `orchestrator.md:8,28` และ `session-lease.mjs:96`
- **`handoffs.yaml`:** แก้คำสั่งที่ขัดกันระหว่าง `commands/build.md:23-24` กับ `build-policy.md:80-81` ให้ใช้ semantic amendment อย่างเดียว เพราะ compiler เป็นเจ้าของไฟล์นี้
- **`grounding.yaml`:** แก้ถ้อยคำใน `workflow.md:103-104` ให้ชัดว่าเป็น field ใน draft
- **Inspect:** เมื่อไม่มี dimension ที่บังคับและไม่มี decision ค้าง ให้ `change start <draft>` ทำทั้ง inspect และ consume ในคำสั่งเดียว ส่วน `--inspect` แยกยังใช้ได้ (`change-lifecycle.mjs:1117,1429-1438`)
- **AC:** draft ที่ถูกต้องใช้ `change start <draft>` ครั้งเดียวก็ได้ change และ seam test ยืนยันว่า checkbox ถูกติ๊กอัตโนมัติ

### S5 — คำสั่งที่ agent ต้องอ่านเหลือประมาณ 150 บรรทัด (ข้อ 5, D3)

- **ปัจจุบัน:** instruction บังคับของ `/dev` rapid รวมประมาณ 4,300 คำ ได้แก่ `change.md`, `workflow.md` 1397 คำ, `semantic-intake.md`, `build.md`, `build-policy.md` 1058 คำ และ `prove.md`
- **สร้าง `commands/references/rapid-path.md`:** รวม Change → Build → Prove → Land ของ lane rapid ไว้ไฟล์เดียว ประมาณ 150 บรรทัด ให้ `dev.md` โหลดไฟล์นี้แทนการสั่งให้อ่านทุกไฟล์จนจบ
- **Reference อื่นเป็น conditional:** `workflow.md`, `semantic-intake.md` และ `build-policy.md` โหลดเมื่อมี trigger ชัดเจน (standard, high impact, amendment หรือ parallel)
- **Context budget:** เพิ่ม budget ให้ `rapid-path.md` และ `build-policy.md` ใน `run-context-budget-tests.sh`
- **AC:** context budget ผ่าน, instruction contracts ผ่าน และ `/dev` rapid ไม่อ่าน reference ที่ไม่ได้ใช้

### S6 — ส่วนเสริมเป็น opt-in (ข้อ 6, D2)

| Module | ปัจจุบัน | เปลี่ยนเป็น |
|---|---|---|
| Repository intelligence | เรียกทุกครั้ง (`change-lifecycle.mjs:1027,1444,1784`) | เรียกเฉพาะ standard หรือ `impact` ≥ medium |
| Discovery/decision frontier | inspect gate บังคับเสมอ | ข้ามได้เมื่อไม่มี dimension บังคับ (ทำไว้แล้วใน S4) |
| Model tier routing | คำนวณทุก plan (`agent-planning.mjs`) | flag `models.routing` default ปิด |
| Budget watchdog | ทำงานเสมอ (`budget.mjs`) | flag `execution.budgetWatchdog` default ปิด แต่ยังเก็บ usage ไว้ใน metrics |
| Quality gate | `changeGate: warn` | default `off` |
| Signed CI | opt-in อยู่แล้ว | ไม่เปลี่ยน |
| Multi-repo saga | สร้างทุกครั้งใน Apply | สร้างเมื่อมีมากกว่า 1 repository |

- **Installer:** เคารพค่าที่ consumer ตั้งไว้เองใน `foundation.json` และ upgrade matrix test ต้องผ่าน
- **Runtime API:** ถ้าเปลี่ยน ต้องแก้ pin ทั้ง 4 ตัวให้ตรงกัน
- **AC:** installer, upgrade matrix และ full suite ผ่าน และงาน rapid ไม่เรียก repository intelligence, model routing หรือ budget

### S7 — วัดผลหลังแก้ (D1)

- รัน scenario `tiny-feature` อีก 1 รอบ แล้วเทียบกับ baseline ใน `docs/reports/`
- **เป้า:** tool call ไม่เกิน 20, อ่านเอกสารของ harness 0 ครั้ง, ไม่มี ASK_USER นอก gate ที่ผู้ใช้เลือก และจบที่ `archived`
- ถ้าไม่ถึงเป้า ให้บันทึกหมวดที่ยังกิน call มากที่สุด เป็นข้อมูลสำหรับรอบถัดไป

## ความเสี่ยง

| ความเสี่ยง | การป้องกัน |
|---|---|
| `advance` ทำหลายอย่างเองจนซ่อนความล้มเหลว | ทุก auto-action บันทึกใน `operations.jsonl` และถ้าล้มต้องคืน REPAIR ที่มีวิธีแก้ (S2) |
| Default ใหม่กระทบ consumer เดิม | ตรวจ upgrade matrix และเคารพค่าที่ตั้งไว้เอง |
| ตัด instruction แล้ว agent ทำผิดในงาน standard | reference ที่ละเอียดยังอยู่ และโหลดเมื่อมี trigger |
| Benchmark ต้องเสียเงิน | รันแค่ 2 รอบตาม D1 บน consumer ที่ทิ้งได้ |
| test รั่วมาเขียนรีโปจริง (เคยเกิดวันที่ 2026-09-30) | รันแต่ละ suite ผ่าน `run-all.sh` หรือตัวรันของมันเท่านั้น ห้ามรันไฟล์ contract ตรงๆ และ unset `FOUNDATION_CLAUDE_SESSION_ID` |

## การตรวจสอบ

```bash
rtk test bash .claude/tests/run-all.sh --affected   # ระหว่างทำ
rtk test bash .claude/tests/run-all.sh              # ก่อน commit (release sentinel ล้มอยู่แล้วบน HEAD)
rtk test bash .claude/tests/docs/run-doc-consistency.sh
rtk npm run bench:openspec-native:sentinel
rtk git diff --check
```

## ผลวัด (S7, 2026-09-30)

Scenario เดียวกัน (`/dev add a discount(total, percent) ... Land it when proven.`), consumer ทิ้งได้ใน `/tmp`, CLI บน PATH 3.5.26 ทั้งสองรอบ, workspace ยังไม่ trusted ทั้งสองรอบ

| Metric | Baseline (`99f115385`) | หลังแก้ (S0–S6) |
|---|---|---|
| Tool calls | 47 | 30 |
| อ่านเอกสาร/source ของ harness | 15 | 5 |
| Harness CLI | 13 | 8 |
| อ่าน source ของ hook เพื่อดีบัก Land | 6 | 0 |
| Tool errors | 11 | 6 |
| BLOCKED | 4 | 2 |
| `--inspect` แยก | 1 | 0 |
| Resume ที่ต้องทำ | 2 | 1 |
| Turns | 51 | 33 |
| API / wall time | 167s / 230s | 115s / 136s |
| ค่าใช้จ่าย | $1.52 | $0.78 |
| ผลลัพธ์ | archived, test ผ่าน | archived, test ผ่าน |

ยังไม่ถึงเป้า ≤20 tool calls สิ่งที่ยังกิน call:

1. "Land it when proven" ใน `/dev` ยังต้อง resume ด้วย `/land` (gate ที่ผู้ใช้เลือกคงไว้) และ agent ลอง `land advance` ถูกปฏิเสธ 3 ครั้ง; `advance` ยังแนะนำ `--through archived` ทั้งที่ agent ข้าม gate ไม่ได้
2. คำสั่ง shell แบบต่อกัน (`a && b`) ถูก Claude Code ปฏิเสธเพราะ allowlist (สภาพแวดล้อม ไม่ใช่ harness)
3. Harness ไม่พิมพ์ path ของ artifact ที่สร้าง agent จึงเดา path ผิด
4. Agent ยังอ่าน `dev.md`, `rapid-path.md`, `change.md`, `land.md` ก่อนเริ่ม (`change.md` ซ้ำกับ `rapid-path.md`)
5. คำเตือน "changed outside the sandbox" หลัง Land เป็น false alarm จาก diff ของ Land เอง

Transcript และ metrics: `/tmp/cl-baseline-*`, `/tmp/cl-after-*`
