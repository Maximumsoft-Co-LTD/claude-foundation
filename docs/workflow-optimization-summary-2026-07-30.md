# Workflow Optimization Summary

**Date:** 2026-07-30  
**Scope:** `/dev` spec-driven workflow optimization across Speed, Context, Cost, and Quality

## Executive summary

เราไม่ได้ตัด spec-driven workflow ให้กลายเป็น vibe coding แต่ลด machinery ที่ไม่เพิ่มคุณภาพออก และทำให้แต่ละขั้นมี owner ชัดเจน:

```text
Interview → Spec/Plan → Contract Gate → Implement
          → Change Gate → Ship Gate → Docs/Ship → Close
```

หลักการปัจจุบัน:

- **Default inline:** ใช้ main session ต่อเมื่อ context ยัง warm และงานไม่ต้อง isolation
- **Cold spawn by proof:** spawn เฉพาะ independence, context gap, tooling isolation, parallel payoff หรือ execution volume
- **High-tier main decides, Sonnet produces:** orchestrator ใช้ session model (ปัจจุบันคือ Opus) ทำ judgment; Sonnet ทำงานเขียนจำนวนมาก
- **One source of truth per quality concern:** Contract, Test evidence, Review risk และ Ship readiness ไม่ตรวจซ้ำกัน
- **Type/trigger-aware quality:** code-bearing work ห้ามตัด Test/Ship Gate; Security และ independent Review บังคับเมื่อ trigger ทำงาน

### Evidence status

| Claim type | Status |
|---|---|
| Policy wiring, hook enforcement, artifact behavior | Implemented + deterministic tests passing |
| Resident file-size reduction | Measured against repository `HEAD` |
| Historical XS cost/turn/wall baseline | Previously measured |
| Cost/wall improvement from the complete current change set | Not yet live-benchmarked |
| Cross-run context-ledger savings | Designed and bounded; two-run measurement still pending |

---

## 1. Speed

### 1.1 เปลี่ยน size จาก routing table เป็น spawn ceiling

ก่อนหน้า M/L มักทำให้เกิด agent chain โดยอัตโนมัติ แม้ main จะมี context พร้อมอยู่แล้ว ตอนนี้ size บอกเพียงความลึกและเพดาน spawn:

| Profile | Default size | Spawn target |
|---|---|---:|
| `fast` | XS/S | XS = 0, S ≤ 2 |
| `standard` | M | ≤ 3 |
| `deep` | L | ≤ 5 |

การเกินเพดานต้องมี `exec_reason` บันทึกไว้ ห้าม spawn เพียงเพราะมี agent หรือเพราะงานเป็น M/L

### 1.2 เพิ่ม Execution resolver ราย phase

ทุก phase เริ่มที่ `inline` แล้วค่อย cold spawn เมื่อมีหลักฐานอย่างน้อยหนึ่งข้อ:

- **independence:** ต้องการ reviewer ที่ไม่ใช่ผู้เขียน
- **context gap:** main ไม่มี authoritative map และต้องสำรวจจริง
- **isolation/tooling:** browser, e2e, unknown harness, multi-repo หรือ noisy process
- **parallel payoff:** งานแยกอิสระ, file ownership ไม่ทับกัน และคุ้ม cold-start
- **execution volume:** งานเขียน code มากพอให้ Sonnet worker คุ้มกว่า Opus หลาย turn

Deterministic shell, state update, lint, known tests, docs touch-up และ ordinary git ไม่ใช่เหตุผลสำหรับ spawn

### 1.3 ลด automatic agent chain

- XS/S Design เขียน inline
- M Design ใช้ main/fork เมื่อ interview และ code map ยัง warm
- L ไม่เปิด `pm → lead → qa` อัตโนมัติอีกต่อไป
- Test ใช้ inline เมื่อรู้ runner; spawn QA เฉพาะ browser/new harness/multi-repo/test investigation
- Docs, Ship และ Retro อยู่ inline เป็นหลัก; S ยังมี measured merged Docs+Ship exception หนึ่ง spawn
- Review fanout ปิดเป็น default ทุก size
- Security ที่ trigger ใช้ Review+Security spawn เดียว

### 1.4 ลด round-trip

- Setup/boot reads ที่ไม่ขึ้นต่อกันส่งเป็น batch เดียว
- Gate ทุก size ใช้ interaction batch เดียวสำหรับ approve/revise, commit disposition และ deviations
- Gate revision แก้เฉพาะ section ที่เปลี่ยนและแสดงเฉพาะ delta
- Review fix ใช้ delta re-review: prior blockers + changed hunks + affected risks
- ห้ามจบ turn ขณะที่ spawn ยังทำงาน ป้องกัน headless run จบก่อน worker คืนผล

### 1.5 ลดงานใน edit loop

- PostToolUse เก็บเฉพาะ deterministic check ที่ startup ต่ำ เช่น `gofmt`
- ESLint, Biome, Ruff, Stylelint, Prettier และ type/static checks ไม่รันทุก edit
- Full suite และ lint/type/static รันรวมที่ Ship Gate
- ใช้ `CLAUDE_EDIT_LINT=1` หรือ `CLAUDE_EDIT_FULL_CHECKS=1` เมื่อต้องการ behavior เก่า

### 1.6 Tiered testing

- Inner implementation/review/security cycles รันเฉพาะ **Impacted**
- Full suite ไม่รันใน inner loop
- Ship Gate รัน **Full + lint/type/static** ครั้งเดียวต่อ converged final diff
- ถ้า Ship Gate แดงและ code เปลี่ยน ต้อง converge ใหม่แล้วผ่าน Ship Gate ใหม่

### 1.7 ลบงานซ้ำระหว่าง agents

- Engineer ไม่มี acceptance task ledger แยกจาก `T###`
- Engineer รันเฉพาะ task-level `verify:`
- Test เป็นเจ้าของ executable AC evidence
- Review ไม่ rerun หรือคัดลอกทุก AC row
- Retro ไม่ verify ซ้ำ

---

## 2. Context

### 2.1 ทำ launcher และ resident prompt ให้บาง

- `/dev` เป็น launcher สั้นและชี้ไปยัง canonical sections
- XS โหลด fast-path reference เพียงชุดเดียว
- S/M/L โหลดเฉพาะ phase reference ที่กำลังใช้
- Phase 2 guard mechanics โหลดตาม named section ไม่ preload ทั้งไฟล์
- Inline Design/Implement/Retro ใช้ compact local contract ไม่โหลด role prompt ของ cold worker

### 2.2 Lazy, scoped reads

- Spawn prompt ต้องมี bounded `scope`, artifact pointer และ `exec_reason`
- Worker อ่าน task row, guardrail, AC และ source anchor เฉพาะ scope
- `[ref: path#anchor]` ถูกเปิดเมื่อเริ่ม task ที่อ้างถึง ไม่ preload ทุก artifact
- Review re-entry อ่านเฉพาะ blocker เดิม, delta และ caller/test ใกล้เคียง
- Multi-repo Retro อ่าน diff `--stat` ไม่ ingest full diff ซ้ำ

### 2.3 ใช้ context ledger ที่มีอยู่จริง

`.workflow/CONTEXT.md` ถูกอ่านหนึ่งครั้งก่อน code/test walk ทุก size:

- **Current-state facts:** entry point, invariant, caller, gotcha
- **Test infra:** validated Full/Impacted/lint-static commands พร้อม owner anchor
- **Capabilities:** shipped guarantees พร้อม test path

Agent เดิน repo เฉพาะสิ่งที่ ledger ยังไม่ครอบคลุม โดย code ยังเป็น source of truth และ load-bearing claim ต้อง spot-check

### 2.4 จำกัดและ prune ledger

- fact แต่ละบรรทัด ≤180 characters
- non-Capabilities ledger ≤100 lines / 12 KB
- Capabilities มี budget แยกประมาณ 25 lines
- `ledger-prune.sh` ลบเฉพาะ fact ที่พิสูจน์ได้ว่า stale เช่น file/symbol หาย
- superseded fact/guarantee ถูกแทนทั้งบรรทัด ไม่ append ข้อความขัดแย้ง

### 2.5 ลด artifact และ template noise

- XS ใช้ `run.md` ไฟล์เดียว
- S+ ใช้ type-aware artifact shape
- template teaching notes ต้องถูก strip เมื่อ fill
- artifact linter ตรวจ scaffold/placeholder ที่หลงเหลือ
- generated coverage/test output และ nested `node_modules` ถูก ignore

### 2.6 Context size ที่วัดได้

เทียบ working tree ปัจจุบันกับ `HEAD` ก่อนชุดการปรับนี้:

| Resident file | Before | After | Reduction |
|---|---:|---:|---:|
| `.claude/orchestrator.md` | 24,553 bytes | 15,899 bytes | 35.2% |
| `.claude/agents/retro.md` | 10,099 bytes | 4,557 bytes | 54.9% |

ตัวเลขนี้เป็น file-size proxy ไม่ใช่ exact billed-token count แต่สะท้อน resident/read context ที่ลดลงโดยตรง

---

## 3. Cost

### 3.1 Model-economic routing

Policy ปัจจุบันคือ **high-tier main decides; Sonnet produces**:

- Main session model: interview, size/risk, Contract Gate, fanout arbitration และ final judgment
- `engineer`: Sonnet default
- `pm`, `qa`, `retro`, `uxui`: Sonnet
- narrow pattern agents เช่น codebase explorer/test analyzer: Haiku
- Lead: Sonnet default; Opus เฉพาะ Security และ high-stakes planning/review

### 3.2 Execution-volume threshold

Implement เปลี่ยนจาก main Opus เป็น bounded Sonnet worker เมื่อมีอย่างใดอย่างหนึ่ง:

- code-producing tasks ≥3
- source/test files ≥3
- มี planned test-fix loop
- คาดว่า generated output >ประมาณ 2K tokens

XS/micro work ยัง inline เพื่อไม่จ่าย cold-start โดยไม่จำเป็น

### 3.3 L ไม่ได้แปลว่า Opus

Size=L อย่างเดียวไม่อัปเกรด Engineer เป็น Opus การ override ต้องมี high-stakes trigger เช่น:

- auth/crypto boundary
- destructive/irreversible migration
- security remediation
- unresolved public-contract invariant

Prompt ต้องบันทึก `model_reason:<trigger>` และ hook บังคับ policy นี้

### 3.4 ลด duplicated spend

- ไม่ spawn QA เพื่อเขียน test plan แยก หาก Design executor ทำได้ใน working set เดิม
- ไม่ spawn Docs/Ship/Retro สำหรับ deterministic work โดยทั่วไป; ยกเว้น S merged Docs+Ship exception ที่ retention มี measured rationale
- ไม่มี acceptance TaskCreate ต่อ AC
- Review ไม่สร้าง AC evidence ชุดที่สอง
- Test ไม่รัน Full/lint/static ซ้ำกับ Ship
- cached validated test commands ลด discovery turns ใน run ถัดไป
- fanout ต้องพิสูจน์ coordination payoff และ disjoint ownership

### 3.5 Cost baseline ที่เคยวัด

Historical XS benchmark ก่อน optimization ชุดล่าสุด:

| Arm | Cost | Turns | Wall |
|---|---:|---:|---:|
| vibe baseline | $0.27 | 12 | 51s |
| `/dev` XS | $2.01 | 47 | 302s |

ข้อสรุปจากการทดลองเดิม:

- ตัด `state.json` ledger เพิ่มไม่ทำให้ cost/turn ลด
- แบน TaskCreate ทั้งหมดทำให้ cost และ turns แย่ลง
- ต้นทุนหลักอยู่ที่ boot/design/process ไม่ใช่ state write อย่างเดียว
- quality process ที่มี Gate ไม่สามารถมีราคาเท่า vibe baseline ได้

**ข้อจำกัด:** ยังไม่มี live A/B ใหม่หลัง resolver, model routing, context diet และ quality-gate consolidation ชุดปัจจุบัน จึงไม่อ้างตัวเลข cost reduction ใหม่จนกว่าจะ benchmark

### 3.6 Cost telemetry

`state.json` เก็บ:

- `speed_profile`
- `spawn_count`
- `exec_mode.<phase>`
- `exec_reason.<phase>`
- `phase_times`
- requested/pinned model ผ่าน spawn telemetry

ทำให้แยกได้ว่า cost เปลี่ยนเพราะ model, spawn count, execution mode หรือ phase duration

### 3.7 Mechanical enforcement

Policy ไม่ได้อยู่ใน prose อย่างเดียว:

- `dev-agent-guard.sh` บังคับ named agents, state freshness และ model pin
- Engineer ที่ override เป็น Opus ต้องมี `model_reason:<high-stakes trigger>`
- `dev-state-mark.sh` ใช้ compact reminder และ `"__now__"` timestamp sentinel
- `state.json` เก็บ `speed_profile` และ `exec_reason`
- `fanout_authorized: true` + named proof + disjoint scopes เป็นเงื่อนไขก่อน nested fanout
- `--yes` auto-approve ได้เฉพาะ optional verification-neutral work; required quality-gate skip ถูกปฏิเสธ

---

## 4. Quality

### 4.1 รวม Quality Gate ให้เหลือ 3 owner

#### Contract Gate

ก่อน human approval:

```sh
sh .claude/hooks/artifact-lint.sh --contract .workflow/<id>/
```

ตรวจ:

- required artifacts ตาม Type และ artifact shape (`run.md` หรือ multi-file)
- required sections และ runnable `verify:`
- placeholder/scaffold/unresolved markers
- exact AC set ระหว่าง spec/run, tasks, test plan และ UX map
- phase disposition ใน plan

Human Gate ตรวจ intent, assumptions และ hard-to-reverse decisions ไม่ตรวจ syntax/AC set ซ้ำ

#### Change Gate

- Test รัน Impacted และเขียน `tests.md`
- `tests.md` เป็น authoritative executable AC ledger
- ทุก AC มี actual test path + pass/fail/unmapped status
- Review consume Test summary เพียงครั้งเดียว
- Review ตรวจ task adherence, public contract, invariant, error handling, data loss, concurrency, measured target และ untestable AC
- Security scan ทำงานทุก run; review บังคับเมื่อ trigger fired

#### Ship Gate

- code-bearing `feat`/`fix`/`refactor` ข้ามไม่ได้
- รัน Full suite + existing lint/type/static checks
- green แล้วจึงเปลี่ยน `tests.md` เป็น `Status: passing`
- ไม่มี executable test surface สำหรับ code change ถือเป็น test-plan gap ไม่ใช่เหตุผลให้ skip

### 4.2 Spec เป็น immutable approved contract

- Engineer ไม่ tick หรือ rewrite acceptance checkbox
- การเปลี่ยน WHAT ships ระหว่าง Implement เป็น `BLOCKER: contract change`
- กลับไป targeted Gate revision แทนการ amend spec เงียบๆ
- implementation-only detail เปลี่ยนใน plan/task row ได้

### 4.3 Engineer/Test/Review/Retro มีหน้าที่ไม่ทับกัน

| Owner | Authoritative responsibility |
|---|---|
| Engineer | code + completed `T###` + task-level verify |
| Test | executable AC evidence in `tests.md` |
| Review | independent semantic/contract/risk findings |
| Security | threat boundary and sensitive-path findings |
| Ship Gate | final integrated repository health |
| Retro | report/follow-up/context fold; ไม่ verify |

### 4.4 Type-aware mandatory checks

- ทุก run: Interview+Spec, Plan, Contract Gate, Implement
- `feat/fix/refactor`: Test plan, Change Gate Test, Ship Gate
- runtime M/L หรือ Sonnet volume implementation: independent Review
- Security trigger fired: Security review
- optional: Docs touch-up, commit/PR effects, Retro document, non-triggered lightweight Review

### 4.5 Brownfield protection

- อ่าน current state ก่อนออกแบบ
- `tasks.md > Guardrails` อ้าง `path#anchor`
- guardrail ห้ามขัดกับ AC
- refactor/brownfield behavior ต้องมี characterization/baseline เมื่อ coverage ไม่พอ
- baseline ที่พบ bug ต้อง pin behavior เดิมและสร้าง follow-up ห้ามแอบแก้ระหว่าง refactor

### 4.6 Fix input-domain rule

เมื่อ ticket ระบุ input จุดเดียว ให้ตรวจ neighboring domain ที่ reproduce symptom ได้ เช่น:

- number: zero, negative, fractional, out-of-range
- collection: empty, one item, oversized
- string: empty, blank, case, null

การทดลองเดิมเพิ่ม objective AC pass จาก 5/6 เป็น 6/6 โดย cost increase ยังเล็กกว่า minimum detectable effect

### 4.7 Deterministic validation

ชุดล่าสุดผ่านทั้งหมด:

| Suite | Assertions |
|---|---:|
| Hook tests | 60 |
| Artifact/Contract Gate | 72 |
| Scenario fixtures | 71 |
| Documentation consistency | 142 |
| Benchmark logic/oracles | 273 |
| Ledger pruning | 15 |
| **Total** | **633** |

Live Claude E2E ถูก skip โดยตั้งใจเพราะใช้ external tokens; เปิดด้วย `CLAUDE_E2E=1`

---

## 5. Current workflow by size

| Phase | XS/S | M | L |
|---|---|---|---|
| Interview | one merged batch | bounded batches | bounded batches |
| Design | inline | warm inline/fork, spawn by proof | combined by default; chain by proof |
| Contract Gate | deterministic + human intent | same | same |
| Implement | inline or one Sonnet by volume | Sonnet by volume | same; L alone ไม่อัปเกรด model |
| Test | Impacted inline when runner known | same | same |
| Review | main inline; independent from Sonnet author | Lead for runtime/Sonnet work | Lead; fanout only by payoff |
| Security | trigger-based | trigger-based | trigger-based |
| Ship Gate | Full + lint/type/static | same | same |
| Docs/Ship/Retro | XS inline; S มี merged Docs+Ship exception | inline unless substantial/isolation | same |

---

## 6. What was deliberately not removed

สิ่งเหล่านี้ยังอยู่เพราะมี correctness/resume value:

- Human Contract approval
- `state.json` single-writer and resume cursor
- security-trigger scan
- regression-first contract สำหรับ `fix`
- baseline/equivalence contract สำหรับ `refactor`
- final Full-suite Ship Gate
- independent review เมื่อผู้เขียนเป็น Sonnet worker หรือ risk สูง

เป้าหมายคือเอา machinery ซ้ำออก ไม่ใช่ลด verification จนเหลือ vibe coding

---

## 7. Remaining measurements

1. รัน live XS/S A/B หลัง optimization ชุดนี้ วัด cost, turns, wall time, spawn count และ oracle pass
2. รัน M `money-drift` ใหม่เมื่อ model API stable เพื่อตรวจ liveness หลัง foreground-spawn rule
3. วัด two-run scenario เพื่อดูผลของ `.workflow/CONTEXT.md` cache; fresh sandbox benchmark วัดจุดนี้ไม่ได้
4. Validate fix input-domain rule บน holdout task
5. เพิ่ม deterministic AC oracle ให้ task ที่ยังใช้ model judge อย่างเดียว

ห้ามสรุปว่า speed/cost ดีขึ้นจาก wall-clock sample เดียว และห้ามใช้ model judge แทน deterministic AC oracle

---

## 8. Primary implementation references

- `.claude/orchestrator.md`
- `.claude/orchestrator/references/size-execution.md`
- `.claude/orchestrator/references/model-tiers.md`
- `.claude/orchestrator/references/phase-1.md`
- `.claude/orchestrator/references/phase-2.md`
- `.claude/orchestrator/references/phase-2-guards.md`
- `.claude/hooks/artifact-lint.sh`
- `.claude/agents/engineer.md`
- `.claude/agents/lead.md`
- `.claude/agents/qa.md`
- `.claude/agents/retro.md`
- `WORKFLOW.md`
- `.claude/tests/bench/rationale.md`
