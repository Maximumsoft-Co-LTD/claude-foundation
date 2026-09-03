# แผนลดความซับซ้อนของ Agent Harness

**วันที่:** 2026-09-03  
**สถานะ:** แผนออกแบบ ยังไม่ได้เริ่ม implementation และไม่ได้สร้าง OpenSpec change  
**ขอบเขต:** ทั้ง repository — model-facing workflow, OpenSpec artifact authoring,
CLI orchestration, runtime, hooks, rules, adapters, installers, quality, examples,
dashboard, website, CI, documentation, compatibility, tests และ rollout

เอกสารนี้บันทึกแผนจากการทบทวนการใช้งาน Change Loop กับโมเดลที่ทำตาม
instruction ซับซ้อนได้ไม่สม่ำเสมอ เช่น Qwen โดยไม่เปลี่ยน lifecycle ที่ผู้ใช้
เห็น รายละเอียด runtime contract ปัจจุบันยังอ้างอิงจาก
[WORKFLOW.md](../../WORKFLOW.md) และ
[Harness README](../../.claude/harness/README.md)

## 1. ปัญหาที่ต้องแก้

ผู้ใช้จริงเรียกเพียง:

```text
/investigate
/change
/build
/prove
/land
/dev
```

แต่ agent ต้องเข้าใจ CLI primitives, packet fields, artifact relationships,
provider routing, authority, recovery และ phase transitions จำนวนมาก

ข้อสังเกตจาก source ปัจจุบัน:

- CLI router มี command handlers ประมาณ 76 ตัว
- Rapid schema สร้าง artifacts อย่างน้อย 7 รายการ
- Standard schema สร้าง artifacts ได้ 9 ประเภท
- Template ของ `grounding.yaml` มี 86-97 บรรทัดก่อนใส่ข้อมูลจริง
- Tasks และ evidence สามารถถูกสร้างแยกกัน แต่ `tasks.md` ต้องย้อนกลับมาเติม
  claim links ภายหลัง
- Intent, impact, claims, paths, risks และ decisions ถูกทำซ้ำข้ามหลายไฟล์
- `advance` coordinator มีอยู่แล้ว แต่ model-facing instructions ยังทำให้ agent
  ต้องเลือกใช้ `packet`, dispatch, proof และ Land commands หลายตัว

ผลที่เกิดขึ้นคือ agent อาจ:

- สร้างไฟล์ไม่ตรง schema
- สร้าง claim ID ไม่ตรงกัน
- ไม่ผูก spec, claim, task และ provider
- ทิ้ง placeholder ใน template
- เรียก commands ผิดลำดับหรือซ้ำ
- หยุดเมื่อ `proven` แทนที่จะจบ delivery ที่ `archived`
- ส่ง automatic recovery กลับไปถามผู้ใช้
- พบ validation failure หลังเขียน artifacts ไปแล้วหลายไฟล์

## 2. เป้าหมาย

- รักษา slash commands และ user workflow เดิม
- ให้ agent ระบุความหมายครั้งเดียวโดยไม่ copy IDs ข้ามไฟล์
- ให้ compiled OpenSpec artifacts ผ่าน structural validation ตั้งแต่ครั้งแรก
- ให้ OpenSpec documents ยังคงเป็น Source of Truth
- ให้ agent ใช้ lifecycle CLI entrypoint หลักเพียง `advance`
- รวม deterministic operations เป็น chain เดียวจนถึง boundary ที่แท้จริง
- ลด model turns, repeated commands, context และ repair loops
- ทุก blocker ต้องมี recovery, decision, pause, abandon หรือ resume route
- รักษา proof, evidence, isolation, budget, authority และ Land guarantees เดิม
- รักษา public command names และ arguments เดิมเพื่อ compatibility

## 3. สิ่งที่ไม่ใช่เป้าหมาย

- ไม่ลด acceptance criteria เพื่อทำให้งานผ่านง่ายขึ้น
- ไม่แปลง evidence ที่ unavailable ให้เป็น pass
- ไม่ให้ Land หมายถึงสิทธิ์ commit, push, publish หรือเปิด PR
- ไม่รวม Land เข้า `/dev` โดยปริยาย
- ไม่ทำให้ prototype artifacts กลายเป็น proof
- ไม่ rewrite archived changes
- ไม่ลบ primitive CLI commands ที่ integrations เดิมอาจใช้อยู่
- ไม่ย้าย Source of Truth จาก OpenSpec ไปไว้ใน `.foundation`

## 4. สถาปัตยกรรมเป้าหมาย

```text
User slash command
        |
        v
Agent produces semantic input
        |
        v
Transactional change compiler
        |
        v
Validated OpenSpec Source of Truth
        |
        v
Unified advance coordinator
        |
        v
Deterministic chain until a real boundary
        |
        v
One typed action
        |
        v
Agent performs the action and calls advance again
```

## 5. Source of Truth และ ownership

| ข้อมูล | Source of Truth |
|---|---|
| Intent, scope, non-goals | `proposal.md` |
| Observable requirements | `specs/**/*.md` |
| Load-bearing decisions และ diagrams | `design.md` และ referenced assets |
| Implementation progress | `tasks.md` |
| Claims และ evidence requirements | `evidence.yaml` |
| Custom provider wiring | `execution.yaml` หรือ committed project configuration |
| External operations | `handoffs.yaml` เมื่อมี |
| Multi-repository topology | `repositories.yaml` เมื่อมี |
| Product implementation | Code และ tests |
| Evidence result | Immutable receipts และ proof bundle |
| Runtime coordination | `.foundation/` ซึ่งเป็น derived state |

Semantic draft เป็น input ชั่วคราว หลัง compile สำเร็จแล้ว OpenSpec artifacts
เป็น canonical agreement

Compiler ต้องทำงานจาก canonical documents ไปหา derived state เท่านั้น ห้ามใช้
`.foundation` ย้อนกลับไปเปลี่ยน agreement semantics

## 6. Work package A: Baseline และ regression fixtures

สร้าง deterministic scenarios ก่อนเปลี่ยน runtime:

- Claim ID ไม่ตรงกันระหว่าง tasks/evidence/grounding
- Task อ้าง claim ที่ไม่มี
- Spec scenario ไม่มี evidence coverage
- Claim ไม่มี provider ที่รองรับ
- Repository หรือ path annotation ผิด scope
- Template placeholder หลงเหลือ
- Rapid change มี risk ที่ต้อง upgrade เป็น Standard
- Agent เรียก lifecycle primitives ผิดลำดับ
- Validation, readiness หรือ proof ถูกเรียกซ้ำบน inputs เดิม
- Automatic recovery ถูกส่งกลับไปถามผู้ใช้
- Change หยุดที่ `proven` หลังได้รับ Land authorityแล้ว
- Blocker ไม่มี typed exit และ exact resume route

เก็บ baseline metrics:

- Model requests ต่อ change
- User questions ต่อ change
- CLI invocations ต่อ phase
- Artifact validation failures
- Repeated identical commands
- Context bytes ต่อ request
- Repair cycles
- Time to `proven`
- Time to `archived`
- Wrong-next-command incidents
- Dead-end blocker incidents

## 7. Work package B: Semantic change draft

เพิ่ม schema กลางที่ agent เขียนเพียงครั้งเดียว ตัวอย่าง:

```yaml
intent: Prevent orphaned rows from blocking mutations
impact: medium
coupling: isolated

requirements:
  - key: orphan-row-does-not-lock
    capability: mutation-control
    operation: added
    scenario: An orphaned phase row exists
    outcome: Unrelated mutations remain available

tasks:
  - key: filter-orphan-rows
    outcome: Exclude orphaned rows from active locks
    covers:
      - orphan-row-does-not-lock
    paths:
      - .claude/harness/runtime/**

evidence:
  orphan-row-does-not-lock:
    capabilities:
      - test
```

Draft validator ต้องตรวจ:

- Required fields
- Duplicate semantic keys
- Unknown references
- Missing task coverage
- Contradictory decisions
- Invalid Rapid/Standard eligibility
- Missing integration information
- Unsupported provider requirements
- Placeholder values
- Material ambiguity ที่ runtime ตัดสินใจแทนไม่ได้

Agent ใช้ semantic keys ส่วน compiler สร้าง stable requirement, claim และ task IDs

## 8. Work package C: Typed extensions

Core draft ต้องเล็ก แต่งานซับซ้อนยังขยายได้โดยไม่เสียข้อมูล

### 8.1 Multiple specs

Requirement แต่ละรายการมี `capability` และ `operation` เพื่อให้ compiler แยก
delta specs ตาม domain และรองรับ `ADDED`, `MODIFIED`, `REMOVED`

สำหรับ `MODIFIED` compiler ต้องอ่าน canonical requirement เดิมและรวมทุก scenario
ก่อน render ห้ามสร้าง partial replacement

### 8.2 Decisions และ design

```yaml
decisions:
  - key: api-auth
    choice: Use signed service credentials
    reason: Provider requirement
    rejected:
      - End-user token forwarding
```

สร้าง `design.md` เฉพาะเมื่อมี load-bearing decision, migration, compatibility,
rollout, rollback หรือ architecture constraint

### 8.3 Diagrams

```yaml
diagrams:
  - key: payment-flow
    type: mermaid
    purpose: Authentication and retry flow
    relatesTo:
      - api-auth
      - create-payment
```

รองรับ Mermaid และ referenced SVG/PNG Diagram ที่เป็น architecture contract
ต้องถูกอ้างจาก `design.md` และรวมใน review context ส่วน explanatory diagram
ไม่กลายเป็น proof โดยอัตโนมัติ

### 8.4 Prototype selection

```yaml
prototypeSelection:
  reference: .foundation/prototypes/payment-flow/selection.md
  selected: redirect-checkout
  reason: Lowest security scope
```

Compiler ต้องตรวจว่า selection มีจริง นำเข้าเฉพาะ decision/conclusion และปฏิเสธ
prototype code หรือ artifacts ที่ถูกใช้เป็น evidence

### 8.5 External documentation และ integrations

```yaml
integrations:
  - key: payment-api
    kind: external-api
    documentation:
      source: https://provider.example/api/v2
      version: "2026-08"
    concerns:
      - authentication
      - idempotency
      - timeout
      - retry
      - rate-limit
      - error-mapping
      - webhook-verification
```

Integration trigger ต้องตรวจ success/failure scenarios, compatibility, security,
resilience, credentials และ external authority หาก documentation ไม่มีหรือ version
ไม่ชัด ให้คืน `RESEARCH_REQUIRED` หรือ `ASK_USER` แทนการเดา

External documentation เป็น grounding source สิ่งที่นำมาใช้ต้องถูกบันทึกเป็น
behavior/decision ใน OpenSpec เพื่อไม่ให้ upstream documentation เปลี่ยน agreement
แบบเงียบ ๆ

## 9. Work package D: Transactional OpenSpec compiler

เพิ่ม internal compiler operation ที่ `/change` เรียกเอง:

```text
Validate draft
→ Resolve versioned defaults
→ Generate stable IDs
→ Build reference graph
→ Render into temporary directory
→ Validate complete OpenSpec
→ Atomically install artifacts
```

ข้อกำหนด:

- Compilation failure ต้องไม่ทิ้ง partial files
- Error ต้องชี้กลับไปยัง draft field
- IDs ต้อง deterministic และ stable
- Spec → claim → task → provider ต้องเชื่อมจาก semantic key เดียว
- Successful compile ต้องผ่าน `change validate` ทันที
- Compiler ห้ามเดา material compatibility, security, migration หรือ rollout decisions
- Compiler ห้าม overwrite active change โดยไม่มี amendment path
- Unknown manual sections และ referenced assets ต้องไม่ถูกลบ

## 10. Work package E: ลดและทำ artifacts เป็น conditional

### Rapid default

```text
proposal.md
tasks.md
evidence.yaml
```

### Standard default

```text
proposal.md
specs/**/*.md
tasks.md
evidence.yaml
design.md  # เมื่อมี load-bearing decision
```

### Conditional artifacts

```text
execution.yaml       # custom provider wiring
repositories.yaml    # multi-repository
handoffs.yaml        # external operation
grounding.yaml       # material decisions ที่ derive ไม่ได้
```

### Versioned virtual defaults

- ไม่มี `repositories.yaml` หมายถึง single writable root
- ไม่มี `handoffs.yaml` หมายถึงไม่มี external operation
- ไม่มี `execution.yaml` หมายถึงใช้ committed project defaults/detection
- ไม่มี `grounding.yaml` หมายถึงไม่มี additional material decision

Defaults ต้อง pin ด้วย schema version ค่า default ที่มีผลเชิง behavior หรือ security
เฉพาะ change ต้อง materialize ลง agreement

## 11. Work package F: Grounding v3

ลด `grounding.yaml` ให้เก็บเฉพาะ human/model decisions:

```yaml
version: 3
decisions:
  - id: DEC-001
    choice: Preserve existing CLI arguments
    reason: Public compatibility
```

ให้ runtime derive:

- Timestamps และ digests
- Read set identities
- Production paths
- Claim mappings
- Risk triggers
- Activation defaults
- Empty service interactions
- Evidence classes ที่หาได้จาก claims/providers

Runtime ยังต้องอ่าน Grounding v2 ได้ และ archived artifacts ห้ามถูก rewrite

## 12. Work package G: Amendment compiler

เมื่อ Build พบ requirement ใหม่ ให้ agent ส่ง amendment แทนการแก้หลายไฟล์:

```yaml
addRequirements:
  - key: malformed-row-does-not-lock
    capability: mutation-control
    scenario: A malformed orphan row exists
    outcome: It is reported without blocking unrelated work

updateTasks:
  - key: filter-orphan-rows
    covers:
      - orphan-row-does-not-lock
      - malformed-row-does-not-lock
```

Amendment ต้อง:

- อ่าน canonical OpenSpec ปัจจุบันก่อน
- รักษา stable IDs
- รักษา completed tasks ที่ไม่ถูกกระทบ
- รักษา prose, diagrams และ custom sections
- เพิ่ม revision
- Invalidate evidence เฉพาะ dependency closure ที่เกี่ยวข้อง
- Validate ใน temporary directory ก่อนแทนที่
- ไม่ regenerate จาก draft เก่าจนลบ manual edits

## 13. Work package H: Unified advance protocol

ขยาย `advance` ให้เป็น model-facing lifecycle coordinator หลัก:

```bash
claude-foundation advance <change> --through build
claude-foundation advance <change> --through proven
claude-foundation advance <change> --through archived
```

### Deterministic Build preparation

```text
Validate agreement
→ Prepare or synchronize sandbox
→ Compile task graph
→ Acquire eligible lease
→ Select next task
```

### Deterministic Prove chain

```text
Validate
→ Readiness
→ Reuse valid receipts
→ Execute eligible providers
→ Collect receipts
→ Route review or acceptance
→ Finalize proof
```

### Deterministic Land chain

```text
Check proof freshness
→ Check handoffs
→ Prepare transaction
→ Apply projection
→ Verify
→ Archive
→ Cleanup
```

Chain ต้องหยุดเมื่อพบ:

- Model edit
- User decision
- External authority
- Missing permission
- Resource wait
- Conflict
- Contradictory contract
- Budget exhaustion
- Repeated no-progress
- Explicit Land authority boundary

Land ต้องไม่ถูก inferred จาก `/dev` หรือจาก proof success

## 14. Work package I: Minimal action envelope

Model-facing actions ควรเหลือ:

```text
EDIT
RUN_EXTERNAL
REPAIR
WAIT
ASK_USER
DONE
```

ตัวอย่าง:

```json
{
  "protocol": 3,
  "action": "EDIT",
  "changeId": "fix-orphan-locks",
  "workspace": "/exact/workspace",
  "task": {
    "id": "T001",
    "instruction": "Exclude orphan rows from active mutation locks"
  },
  "allowedPaths": [
    ".claude/harness/runtime/**",
    ".claude/harness/tests/**"
  ],
  "verification": [
    "focused test command"
  ],
  "resume": "claude-foundation advance fix-orphan-locks"
}
```

Packet ต้องไม่ส่ง unrelated tasks, internal hashes, full provider graph หรือ alternate
commands ที่ action ปัจจุบันไม่ต้องใช้ Operator/debug views ยังคงเข้าถึงข้อมูลเต็มได้

## 15. Work package J: Recovery-first behavior

Harness ต้องไม่สร้าง artificial dead end แต่ยัง fail-closed เมื่อ proof, authority
หรือ safety requirement ไม่ครบ

ทุก blocker ต้องคืนทางออกอย่างน้อยหนึ่งชนิด:

- `AUTO_RECOVER`
- `EDIT`
- `RECONFIGURE`
- `HANDOFF`
- `ASK_USER`
- `PAUSE`
- `ABANDON`

ทุก response ต้องระบุ:

- สาเหตุ
- Actor ที่แก้ได้
- Safe alternatives
- ผลกระทบของแต่ละทางเลือก
- Automatic route ถ้ามี
- Exact resume route
- State ที่ถูกเก็บไว้

Harness ต้อง:

- ทำ safe automatic recovery เองเมื่อมี authority
- รวม independent findings ก่อน repair
- ซ่อมเป็น dependency-ordered batch
- Rerun เฉพาะ invalidated checks
- ถาม material decisions เป็น batch
- ไม่ถามซ้ำเมื่อ agreement ไม่เปลี่ยน
- ไม่ลด acceptance criteria หรือสร้าง evidence เทียม

## 16. Work package K: Slash-command migration

### `/investigate`

- Read-only
- รองรับ compare/prototype
- ส่ง selected conclusion เข้า semantic draft ได้
- ไม่มี lifecycle state ของตัวเอง

### `/change`

- อ่าน repository และ documentation ที่จำเป็น
- รวบรวม material decisions เป็น batch
- สร้าง semantic draft
- เรียก compiler
- สำเร็จเมื่อ compiled OpenSpec validate ผ่าน
- ไม่ให้ agent สร้างและผูก artifacts หลายไฟล์เอง

### `/build`

```text
advance
→ perform EDIT or REPAIR
→ advance
```

### `/prove`

```text
advance --through proven
```

Deterministic proof ไม่ควรใช้ model turn เว้นแต่ต้อง review หรือ repair

### `/land`

```text
advance --through archived
```

ต้องมี explicit Land authority

### `/dev`

```text
/change
→ advance --through proven
```

ไม่รวม Land โดยปริยาย

## 17. Work package L: CLI surface

รักษา public command names และ arguments เดิม แต่ลดสิ่งที่ agent ต้องรู้

| Surface | Commands |
|---|---|
| Model | `advance` |
| Change authoring | Compiler operation ที่ `/change` เรียกเอง |
| Operator | `status`, `doctor`, `inspect`, `metrics`, `audit`, `recover` |
| Internal/debug | `proof-*`, `authority-*`, `agent-*`, `handoff-*`, `land-*`, `receipt`, `packet` |

Default help ควรแสดง entrypoints หลัก ส่วน primitives อยู่ใน advanced/internal help
แต่ยังเรียกได้เพื่อ compatibility, diagnosis และ tests

### 17.1 Command-contract alignment gate

การเปลี่ยน workflow ถือว่ายังไม่เสร็จจนกว่า command surfaces ทั้งหมดจะสอดคล้องกับ
semantic compiler และ unified `advance` protocol ต้องทำ inventory และตรวจอย่างน้อย:

- Slash commands ใต้ `.claude/commands/`
- Slash-command reference files
- Public CLI parser และ router
- Command registry และ aliases
- Shell wrapper/grammar
- Lifecycle phase mapping
- Default, advanced และ internal help output
- Packet `verificationPlan` commands
- `next`, `resume`, `automaticRecovery` และ decision commands
- Doctor, status, feedback และ metrics guidance
- Session-start next-action output
- Installer-owned command files
- Host adapter และ integration command contracts
- Tests, fixtures, documentation และ website command examples

ไฟล์ปัจจุบันใต้ `.claude/commands` ต้องอยู่ใน explicit review checklist ทุกไฟล์:

- `.claude/commands/build.md`
- `.claude/commands/change.md`
- `.claude/commands/changes.md`
- `.claude/commands/dev.md`
- `.claude/commands/feature.md`
- `.claude/commands/investigate.md`
- `.claude/commands/land.md`
- `.claude/commands/prove.md`
- `.claude/commands/references/build-dispatch.md`
- `.claude/commands/references/build-policy.md`
- `.claude/commands/references/decision-policy.md`

หากมี command หรือ reference Markdown เพิ่มก่อนเริ่ม implementation ให้ inventory จาก
directory จริงและเพิ่มเข้ารายการตรวจโดยอัตโนมัติ ห้ามยึดเฉพาะรายชื่อ ณ วันที่เขียนแผน

กฎของ command surface หลังปรับ:

- Model-facing normal path หลัง Change ใช้ `advance` เป็น entrypoint หลัก
- `/change` เรียก semantic compiler ภายในโดยไม่ให้ user ประกอบคำสั่งหรือ JSON
- `/build`, `/prove`, `/land` และ `/dev` ไม่แนะนำ primitive chain เดิม
- `advance --through build|proven|archived` ใช้สถานะและ exit semantics แบบเดียวกัน
- `/dev` ไม่ infer Land; `/land` ยังต้อง explicit authority
- ทุก action คืน command เดียวที่ทำได้จริงและ exact resume route
- Automatic recovery command ต้องอยู่ใน authority ปัจจุบันและทำซ้ำได้อย่างปลอดภัย
- Primitive commands เดิมยังทำงานเป็น compatibility/debug surface
- Deprecated normal paths ต้องไม่ปรากฏใน default help, packets หรือ current docs
- Aliases ต้อง resolve ไปยัง operation เดียวกัน ไม่สร้าง semantic path คู่ขนาน
- Command output สำหรับ agent ต้องเป็น stable structured schema ส่วน human output ต้อง
  อ่านง่ายและไม่เปิดเผย protocol internals โดยไม่จำเป็น
- Exit codes ต้องแยก success, action-required, wait, user-decision, conflict,
  configuration error และ internal failure อย่างสม่ำเสมอ

เพิ่ม single-source tests ที่เปรียบเทียบ command registry, router, wrapper grammar,
phase mapping, help, slash docs และ protocol descriptor เพื่อป้องกันชื่อคำสั่งหรือ
behavior drift ในอนาคต

### 17.2 Hook-contract alignment gate

Hooks เป็น enforcement surface ของ lifecycle จึงต้องเปลี่ยนไปในทิศทางเดียวกับ
semantic compiler และ unified `advance` ห้ามให้ commands แนะนำ flow ใหม่แต่ hooks
ยัง block, infer phase หรือแสดง recovery route ตาม flow เดิม

ไฟล์ปัจจุบันใต้ `.claude/hooks` ต้องอยู่ใน explicit review checklist ทุกไฟล์:

- `.claude/hooks/README.md`
- `.claude/hooks/authoring-surface-guard.mjs`
- `.claude/hooks/authoring-surface-guard.sh`
- `.claude/hooks/dev-terminal-guard.mjs`
- `.claude/hooks/dev-terminal-guard.sh`
- `.claude/hooks/lint.sh`
- `.claude/hooks/no-detached-authority.mjs`
- `.claude/hooks/no-detached-authority.sh`
- `.claude/hooks/no-direct-main-commit.sh`
- `.claude/hooks/phase-guard-policy.mjs`
- `.claude/hooks/phase-mutation-guard.md`
- `.claude/hooks/phase-mutation-guard.mjs`
- `.claude/hooks/phase-mutation-guard.sh`
- `.claude/hooks/phase-state.mjs`
- `.claude/hooks/protect-secrets.sh`
- `.claude/hooks/session-context.mjs`
- `.claude/hooks/session-context.sh`

หากมี hook เพิ่มก่อน implementation ต้อง inventory จาก directory จริงและเพิ่มเข้า
review/test matrix โดยอัตโนมัติ

Hook alignment ต้องครอบคลุม:

- `advance` ต้องบันทึก phase context ที่ hooks ใช้แทนการพึ่ง `packet --phase`
- Change authoring guard ต้องยอมรับ semantic draft/compiler path และไม่แนะนำ
  `change new` หรือ manual artifact flow ที่เลิกเป็น normal path แล้ว
- Phase mutation guard ต้องใช้ workspace/phase/action authority เดียวกับ action envelope
- Build mutations ยังถูกจำกัดใน isolated workspace และ allowed paths
- Change/Prove mutations ยังถูกปฏิเสธ ยกเว้น compiler/runtime-owned transaction ที่มี
  marker และ authority ชัดเจน
- Land mutations ยังเกิดเฉพาะใน journaled runtime transaction
- Dev terminal guard ต้องวัด completion ตาม `/dev` target (`proven`) และคืน unified
  resume route โดยไม่สับสนกับ delivery completion (`archived`)
- Session context ต้องแนะนำ slash command หรือ `advance` path ปัจจุบัน ไม่แนะนำ
  primitive chain เดิม
- Detached authority guard ต้องรู้จัก authority action ใหม่โดยไม่เปิดช่องให้ background
  execution ทำให้ session จบก่อนรับผล
- Secret guard และ direct-main-commit guard ต้องรักษา safety boundary เดิม
- Lint hook ต้องไม่รัน deterministic checks ซ้ำกับ `advance` บน inputs เดิมโดยไม่มี
  invalidation reason
- Shell prefilters และ `.mjs` implementations ต้องให้ผลและ exit semantics ตรงกัน
- Hooks ต้องไม่เปลี่ยน unknown state ให้เป็น pass และต้องคืน recovery/resume ที่ทำได้จริง
- Host capability differences ต้องยังถูกแสดงอย่างตรงไปตรงมา ไม่อ้างว่า host ที่ไม่มี
  hooks ได้ enforcement เท่ากับ Claude Code

เพิ่ม hook contract tests สำหรับ phase establishment ผ่าน `advance`, compiler-owned
artifact writes, sandbox confinement, Prove read-only enforcement, Land transaction,
terminal completion, session guidance, recovery route และ wrapper/implementation parity

### 17.3 Whole-system alignment gate

ก่อน release ต้องสร้าง contract matrix หนึ่งชุดและตรวจให้ทุก surface ตอบคำถามเดียวกัน
ด้วยคำตอบเดียวกัน:

| Contract question | Surfaces that must agree |
|---|---|
| Current lifecycle phase | Runtime reducer, `advance`, hooks, packets, status, session context |
| Next allowed action | `advance`, slash commands, hooks, doctor, feedback, docs, website |
| Writable workspace/path | Sandbox runtime, action envelope, phase guard, task lease |
| Change agreement | OpenSpec compiler, validator, packet, review, proof |
| Completion state | `/dev`, `/land`, terminal guard, status, docs |
| Authority boundary | Runtime, hooks, decision policy, handoffs, Land, docs |
| Recovery route | Runtime error, `advance`, hook error, doctor, user-facing guidance |
| Public command behavior | Router, registry, aliases, help, installer, tests, website |

Single-source tests ต้อง fail หาก surface ใด drift จาก matrix นี้ เป้าหมายคือทุกส่วนของ
harness สนับสนุน flow เดียวกัน ไม่ใช่แก้เฉพาะ prompt หรือ CLI ชั้นใดชั้นหนึ่ง

### 17.4 Repository-surface alignment gate

นอกจาก commands, hooks และ website ต้องทำ source inventory และ impact review แบบเต็ม
กับ surfaces ต่อไปนี้ ทุกไฟล์ต้องถูกจัดเป็น `change-required`, `verify-only`,
`historical-preserve` หรือ `not-applicable` พร้อมเหตุผล ห้ามตรวจเฉพาะไฟล์ที่ค้นจาก
keyword แล้วถือว่าครบ

#### `.claude/harness`

ตรวจทั้ง directory ปัจจุบัน ซึ่งรวม runtime, contracts, adapters, fixtures, templates,
tests และเอกสาร โดยเน้น:

- `foundation.mjs` ต้องคงเป็น composition root ไม่รับ domain logic ใหม่
- `runtime/workflow/` ต้องเป็นเจ้าของ compiler, amendment, `advance` และ Land flow
- `runtime/core/` ต้องใช้ lifecycle, action, command และ authority contracts ชุดเดียว
- Evidence, review, acceptance, quality และ observability runtimes ต้องรับ identity
  และ invalidation semantics ใหม่โดยไม่ลด assurance
- `commands.json`, `protocol.json`, host capabilities และ public-command fixtures ต้อง
  สอดคล้องกับ action/command protocol ใหม่
- Adapters สำหรับ Claude Code, Codex, Cursor และ OpenCode ต้องไม่อ้าง capability ที่
  host ไม่มีจริง
- Context budgets, packet limits, telemetry และ metrics ต้องวัด semantic-draft และ
  action-envelope flow ใหม่ได้
- Harness tests และ fixtures ต้องเพิ่ม compiler, compatibility, weak-model และ
  whole-system alignment coverage
- Harness Markdown ทั้งหมดต้องผ่าน Markdown refresh gate
- ไม่มี runtime module orphaned และ dependency direction ยังผ่าน architecture tests

#### `.claude/rules`

ตรวจ `.claude/rules/fundamentals.md` และไฟล์ใหม่ใด ๆ ที่เพิ่มภายหลัง เพื่อให้:

- Skill routing และ conduct ใช้ semantic compiler/`advance` flow
- Agent ไม่ถูกสั่งให้สร้าง IDs, artifacts หรือ primitive command chain ด้วยมือ
- Authority, secrets, user decision, Land และ commit/push boundaries ยังเหมือน runtime
- Completion, automatic recovery และ reporting language ตรงกับ slash commands/hooks

#### `openspec`

ตรวจทุก current schema, template, config และ canonical spec โดยแยก historical data:

- `openspec/schemas/foundation-rapid/**`
- `openspec/schemas/foundation-standard/**`
- `openspec/config.yaml`
- `openspec/repositories.yaml`
- `openspec/specs/**/*.md`
- Active changes ที่มีอยู่ ณ เวลาพัฒนาเพื่อทดสอบ compatibility เท่านั้น
- Archived changes และ investigations เป็น `historical-preserve` โดย default

OpenSpec alignment ต้องครอบคลุม draft/compiler contract, conditional artifacts,
versioned defaults, Grounding v3, amendment, action/resume, proof และ Land semantics
Canonical specs ต้องอธิบาย behavior ใหม่ครบก่อน release แต่ห้าม rewrite historical
archives หรือ user-owned active agreements เพื่อทำ migration แบบเงียบ ๆ

#### `foundation.json`

ตรวจ configuration contract ทั้งไฟล์ โดยเฉพาะ:

- Execution and packet/action size budgets
- Request/token budgets และ completion-only behavior
- Model routing และ review assurance
- Provider/project defaults ที่ใช้แทน optional `execution.yaml`
- Compiler, schema และ compatibility policy ที่เพิ่มใหม่
- Host capability และ unattended execution defaults

Defaults ใหม่ต้อง versioned, validated, documented และ deep-merge กับ consumer config
เดิมได้ ห้ามทำให้ missing configuration กลายเป็น fabricated pass

#### `quality`

ตรวจทั้ง quality policy surface:

- `quality/README.md`
- `quality/policy.json`
- `quality/surfaces.json`
- `quality/coverage-lanes.json`
- `quality/semantic-mutants.json`
- `quality/exceptions.json`
- `quality/refactoring-plan-v1.json`
- `quality/schemas/**`
- `quality/baselines/**`

ต้องเพิ่ม compiler/action/hook/command surfaces เข้า coverage และ mutation ownership ที่
เหมาะสม ปรับ schemas เมื่อ output contract เปลี่ยน และอัปเดต baselines เฉพาะจากผลวัด
จริง ห้ามแก้ baseline เพื่อซ่อน regression Quality unavailable/unsupported ต้องยัง
แสดงเป็น unknown หรือ reduced assurance ไม่ใช่ zero/pass

#### `install-codex.sh`

ตรวจ entrypoint การติดตั้ง Codex ให้:

- ติดตั้ง runtime, schemas, commands, hooks, rules, adapters และ docs ที่เพิ่มใหม่ครบ
- ใช้ protocol/runtime versions ที่ตรงกับ bundle
- เรียก installer flow เดียวกับ canonical install path ไม่สร้าง installation semantics
  อีกชุด
- Upgrade consumers เดิมโดยรักษา OpenSpec changes, project configuration และ
  `.foundation` state ตาม ownership contract
- ลบเฉพาะ stale managed files และไม่ overwrite consumer-owned files
- รายงาน incompatibility พร้อม exact upgrade/retry route
- ผ่าน clean-install, upgrade, reinstall และ relocated-install tests

#### Alignment procedure

1. Inventory ทุกไฟล์ในหก surfaces ก่อน implementation
2. บันทึก classification และ owner ของแต่ละไฟล์
3. Map แต่ละ changed contract ไปยัง runtime, command, hook, docs, test และ installer
4. ทำ implementation โดยแก้ canonical owner ก่อน derived surfaces
5. Inventory ซ้ำก่อน release เพื่อจับไฟล์ที่เพิ่มระหว่างพัฒนา
6. รัน single-source, architecture, wiring, installer, quality และ full-suite gates

เป้าหมายคือ `.claude/harness`, `.claude/rules`, `.claude/commands`, `.claude/hooks`,
`openspec`, `foundation.json`, `quality`, installer, docs และ website เดินไปตาม lifecycle
และ Source of Truth contract เดียวกันทั้งหมด

### 17.5 Full-repository audit gate — no path allowlist

ขอบเขตสุดท้ายคือ repository ทั้งหมด ไม่ใช่เฉพาะ directories ที่ถูกเรียกชื่อก่อนหน้า
รายการ path ในแผนเป็นจุดเน้น ไม่ใช่ allowlist

ก่อน implementation และก่อน release ต้องใช้ tracked repository inventory เป็นฐาน
เช่น `git ls-files` และตรวจ untracked source candidates จาก worktree โดยรักษางานของผู้ใช้
ทุกไฟล์ต้องถูก classify อย่างน้อยหนึ่งประเภท:

- `change-required` — contract ใหม่กระทบและต้องแก้
- `verify-only` — ไม่ต้องแก้แต่ต้องพิสูจน์ว่ายังสอดคล้อง
- `historical-preserve` — เก็บเป็น point-in-time record ห้าม rewrite
- `generated-ignore` — build output, cache, dependency หรือ machine-owned state
- `consumer-owned-preserve` — installer/runtime ห้าม overwrite
- `not-applicable` — ไม่เกี่ยวข้อง พร้อมเหตุผลตรวจสอบได้

Repository-wide review ต้องครอบคลุมอย่างน้อย:

- Root contracts และ metadata: `README*`, `WORKFLOW.md`, `CLAUDE.md`, `AGENTS.md`,
  `CHANGELOG.md`, `RELEASING.md`, `CONTRIBUTING.md`, `SECURITY.md`, `VERSION`,
  `package*.json`, `foundation.json` และ mutation configurations
- CLI และ installers: `cli.sh`, `install.sh`, `install-codex.sh`,
  `install-cursor.sh`, `install-opencode.sh` และ `Formula/`
- Agent product surface: `.claude/agents`, `.claude/commands`, `.claude/hooks`,
  `.claude/rules`, `.claude/skills`, `.claude/harness`, `.claude/settings*` และ
  `.claude/tests`
- Product configuration และ compatibility surfaces: `.changeloop`, `openspec`,
  `quality` และ read-only legacy `.workflow`
- Automation and release: `.github`, `scripts` และ `release-notes`
- User-visible/runtime consumers: `dashboard`, `website` และ `examples`
- Current documentation and research indexes ใต้ `docs`
- Root ignore, packaging และ distribution metadata ที่กำหนด shipped surface

สิ่งที่ต้อง inventory แต่ไม่แก้เป็น source โดยปกติ:

- `.foundation/` เป็น generated machine-owned state; ตรวจ compatibility, migration,
  cleanup และ preservation behavior ผ่าน tests แทนการแก้ live state
- `.workflow/` เป็น read-only legacy state; รักษา migration compatibility
- `node_modules/`, `target/`, `coverage/`, `.stryker-tmp/` และ website build output
  เป็น generated/dependency artifacts
- `.git/` ไม่ใช่ product source
- Dated reports, archived OpenSpec changes และ release history เป็น historical records

กฎสำคัญคือ "ตรวจทั้ง repo" ไม่ได้หมายถึงแก้ทุกไฟล์ การแก้ไฟล์ที่ไม่เกี่ยวข้องจะสร้าง
noise และทำลาย historical truth ต้องแก้เฉพาะ `change-required` แต่ทุก tracked file ต้อง
มีผลการ classification เพื่อยืนยันว่าไม่มี stale contract หลุดรอด

เพิ่ม repository-wide alignment manifest/check ที่ตอบได้ว่า contract ใหม่แต่ละข้อถูก
สะท้อนใน source, enforcement, documentation, examples, packaging และ tests ที่ใด
Release ต้อง fail หากมี tracked surface ที่เกี่ยวข้องแต่ยังไม่ได้ classify หรือยังอ้าง
normal flow เดิม

## 18. Work package M: Compatibility และ migration

ต้องรองรับ:

- Active legacy changes
- Archived changes
- Grounding v2
- Embedded legacy evidence providers
- Existing packet, proof และ review hashes
- Existing CLI callers
- Installed consumer repositories
- Mixed runtime/schema versions

Policy:

- Existing change ใช้ legacy reader ต่อ
- New change ใช้ compiler flow
- Legacy amendment ต้อง preview migration ก่อน
- Archived change ไม่ถูก rewrite
- Installer ไม่แก้ consumer-owned changes
- Protocol mismatch ต้อง fail พร้อม upgrade และ resume route
- ไม่มี automatic semantic migration

## 19. Work package N: Tests

### Compiler tests

- Stable ID generation
- Multi-spec rendering
- Cross-reference correctness
- Duplicate/unknown reference rejection
- Rapid/Standard selection
- Transactional failure
- Placeholder rejection
- Conditional artifacts
- Amendment preservation
- Manual prose/diagram preservation

### Advanced artifact tests

- Mermaid diagram
- Referenced SVG/PNG
- Prototype selection
- Unselected prototype rejection
- External API documentation
- Missing/outdated documentation
- Security failure scenario
- Migration and rollback
- Multi-repository integration

### Advance tests

- Deterministic chain execution
- Correct boundary stop
- Resume after edit/wait/decision
- Receipt reuse
- Selective rerun
- No-progress handling
- Budget handling
- Authority routing
- Conflict recovery
- Land reaches `archived`

### Compatibility tests

- Legacy active change
- Legacy archived audit
- Installer upgrade
- Protocol pins
- Mixed schemas
- Existing primitive CLI calls

### Weak-model compliance

สร้าง deterministic simulator ที่เข้าใจเพียง:

```text
Read action
Perform action
Call resume
```

หาก simulator ทำ lifecycle ได้ แสดงว่า protocol ไม่พึ่งให้ model จำ framework
รายละเอียดมากเกินไป Qwen live scenarios เป็นกิจกรรมแยกและต้องได้รับอนุญาตก่อน
หากมีค่าใช้จ่าย

## 20. Work package O: Protocol, installer และ documentation

อัปเดตเมื่อ contract เปลี่ยนจริง:

- Runtime API
- Advance protocol
- Packet/action schema
- Draft schema
- Grounding schema
- Command registry
- Protocol pins
- Installer `MANAGED`
- Upgrade coverage
- `README.md` และ `README.th.md`
- `WORKFLOW.md`
- Harness README และ EVIDENCE
- Slash-command instructions
- Test ownership documentation

Public documentation ต้องอธิบาย slash lifecycle ส่วน primitive CLI รายละเอียดอยู่ใน
operator/reference documentation เพื่อไม่ทำ contract ซ้ำหลายที่

### 20.1 Markdown refresh gate

หลัง implementation ต้องทำ inventory ของ Markdown ทั้ง repository และจัดประเภทก่อน
อัปเดต:

- Current public documentation
- Shipped agent instructions
- Slash-command documentation
- Skill และ reference documentation
- Maintainer/operator documentation
- Test and release documentation
- Generated documentation sources
- Historical reports และ archived change records

Markdown ที่เป็น current หรือ shipped guidance ต้องได้รับการตรวจทุกไฟล์และอัปเดต
ให้ตรงกับ semantic compiler, conditional artifacts, `advance` protocol, recovery routes
และ Source of Truth ownership ใหม่ อย่างน้อยต้องครอบคลุม:

- Root `README.md` และ `README.th.md`
- `WORKFLOW.md`
- `CLAUDE.md` และ shipped instruction blocks ที่ installer เป็นเจ้าของ
- `.claude/orchestrator.md`
- `.claude/harness/*.md`
- `.claude/commands/*.md` และ `.claude/commands/references/*.md`
- `.claude/skills/**/SKILL.md` และ reference Markdown ที่อธิบาย lifecycle
- `.claude/rules/*.md`
- `.claude/tests/README.md`
- Website/documentation source Markdown ที่อ้าง command หรือ artifact flow
- Current operational plans และ indexes ใต้ `docs/`

การ refresh ต้องตรวจ:

- ไม่มีคำสั่ง deprecated ถูกแนะนำเป็น normal agent path
- ไม่มีเอกสารบอกให้ agent สร้าง cross-file IDs ด้วยมือ
- ไม่มีเอกสารบังคับ empty/default artifacts ที่กลายเป็น virtual defaults แล้ว
- `/dev` ยังหยุดที่ `proven` และ `/land` ยัง explicit
- Delivery completion ยังคือ `archived`
- Automatic recovery, authority และ blocker semantics ตรงกับ runtime
- Source of Truth ownership ตรงกันทุก surface
- English และ Thai public documentation ให้ความหมายเดียวกัน
- Version, protocol และ schema references เป็นค่าปัจจุบัน
- Internal links, command examples และ referenced paths ใช้งานได้
- Canonical contract ไม่ถูก copy ซ้ำจนเกิดหลาย Source of Truth

Historical reports, dated investigations และ archived OpenSpec records ต้องไม่ถูก
rewrite ให้เหมือนเป็นเอกสารปัจจุบัน ให้เก็บตามสภาพเดิมและเพิ่มหมายเหตุหรือลิงก์ไปยัง
current canonical document เฉพาะเมื่อจำเป็น

Markdown refresh เป็น Definition-of-Done gate ไม่ใช่งานเก็บตกหลัง release

### 20.2 Website documentation refresh gate

Website documentation เป็น shipped public surface และต้องอัปเดตพร้อม runtime ห้ามรอ
แก้ภายหลัง โดยต้อง inventory และตรวจเนื้อหาภายใต้:

- `website/docs/src/content/docs/**/*.md`
- `website/docs/src/content/docs/th/**/*.md`
- `website/docs/astro.config.mjs` รวม sidebar และ navigation
- `website/docs/README.md`
- `website/index.html`, `website/app.js` และ `website/styles.css` หาก landing page
  อธิบาย lifecycle, commands หรือ artifacts
- `website/demo/**` หาก demo แสดง workflow หรือข้อความจาก contract เดิม

หน้าเว็บไซต์ที่ต้องตรวจเป็นพิเศษ:

- Home และ Quickstart
- Lifecycle overview
- Investigate, Change, Build, Prove และ Land
- CLI reference
- Artifacts
- Claims, receipts และ evidence adapters
- Approval/authority
- Multi-repository workflow
- Foundation configuration
- Installation และ upgrade
- Consumer quality

English และ Thai pages ต้องให้ behavior, boundaries, defaults และตัวอย่างคำสั่ง
ตรงกัน โดยเฉพาะ:

- `/change` ใช้ semantic compiler และไม่สอนให้ผูก IDs หลายไฟล์ด้วยมือ
- `/build`, `/prove` และ `/land` ใช้ unified `advance` path
- `/dev` หยุดที่ `proven`; Land ยัง explicit
- Rapid/Standard artifacts ตรงกับ conditional-artifact rules
- Diagram, multi-spec, prototype และ external-documentation flows ยังถูกอธิบาย
- Blockers มี recovery/resume routes และไม่รับรองว่าจะ bypass safety boundary
- OpenSpec ยังคงเป็น Source of Truth
- Existing primitive CLI ที่ยังรองรับถูกแยกเป็น advanced/operator reference

หลัง refresh ต้องรันอย่างน้อย:

```bash
cd website/docs
rtk npm run build
```

พร้อมตรวจ broken internal links, missing pages, sidebar order, code examples และ
English/Thai parity Website build failure เป็น release blocker

## 21. ลำดับดำเนินงาน

```text
1. Baseline tests and metrics
2. Ownership and protocol contracts
3. Semantic draft schema
4. Transactional compiler
5. Cross-link generation
6. Typed extensions
7. Conditional artifacts and versioned defaults
8. Grounding v3
9. Amendment support
10. Advance protocol v3
11. Recovery-first routing
12. Slash-command migration
13. Legacy compatibility
14. Weak-model tests
15. Full Markdown inventory and current-document refresh
16. Website content, navigation and English/Thai refresh
17. Command inventory and command-contract alignment
18. Hook inventory, behavior migration and hook regression coverage
19. Whole-system contract matrix and single-source tests
20. Full-repository tracked-file inventory and classification
21. Harness, rules, OpenSpec, config, quality, dashboard, examples, CI and release audit
22. Documentation consistency, links, examples and website build verification
23. All installers, packaging and protocol updates
24. Consumer validation and rollout
```

แต่ละช่วงต้องผ่าน affected tests ก่อนเริ่มช่วงถัดไป Shipped runtime changes ต้องผ่าน
full deterministic suite ก่อนส่งมอบ

## 22. Verification

```bash
rtk test bash .claude/tests/run-all.sh --affected
rtk test bash .claude/tests/run-all.sh
rtk test bash .claude/tests/docs/run-doc-consistency.sh
rtk git diff --check
```

จากนั้นตรวจใน disposable consumers:

1. Rapid single-repository change
2. Standard multi-spec change
3. Failed draft validation
4. Amendment during Build
5. Diagram-bound design review
6. Prototype selection
7. External API documentation flow
8. Review/authority wait and resume
9. Land until `archived`
10. Legacy active change
11. Weak-model compliance
12. Qwen live scenario เมื่อได้รับอนุญาต

## 23. Turn-reduction acceptance

เปรียบเทียบ baseline กับผลหลังปรับโดยไม่กำหนดเปอร์เซ็นต์ล่วงหน้าจนกว่าจะมีข้อมูล

เกณฑ์ขั้นต่ำ:

- Clear Rapid `/dev` ไม่ถาม user เพิ่ม
- Successful `/change` ผ่าน structural validation ครั้งแรก
- Agent ใช้ lifecycle command หลักเพียง `advance` หลัง Change
- ไม่มี identical deterministic check ซ้ำบน inputs เดิม
- Deterministic proof ไม่ใช้ model request
- ทุก blocker มี typed recovery และ resume route
- User interaction เพิ่มเฉพาะ material decision หรือ external authority จริง
- Explicit `/land` จบที่ `archived`

## 24. Definition of Done

- ผู้ใช้ใช้ slash commands เดิม
- Agent ไม่ต้องสร้างหรือ copy cross-file IDs เอง
- Compiled OpenSpec validate ผ่านก่อนติดตั้ง artifacts
- OpenSpec ยังคงเป็น Source of Truth
- Rapid change ไม่สร้าง empty/default artifacts โดยไม่จำเป็น
- Multiple specs, diagrams, prototypes และ API docs ยังรองรับ
- `advance` เป็น model-facing lifecycle entrypoint หลัก
- Slash, CLI, alias, help, packet, recovery และ resume commands ตรงกับ workflow ใหม่
- Primitive commands เดิมยัง compatible แต่ไม่ถูกเสนอเป็น normal model path
- Hooks ทุกตัวใช้ phase, workspace, authority, completion และ recovery contract เดียวกับ runtime
- Commands, hooks, runtime, docs, website, installer และ tests ผ่าน whole-system alignment matrix
- `.claude/harness`, `.claude/rules`, `openspec`, `foundation.json`, `quality` และ
  `install-codex.sh` ผ่าน explicit inventory, classification และ alignment review
- Tracked repository ทุกไฟล์ถูก classify โดยไม่มี path allowlist และไม่มี stale
  lifecycle contract ใน source, CI, examples, packaging หรือ documentation
- Generated, machine-owned, consumer-owned และ historical files ถูก preserve ตาม owner
- Deterministic chains ทำงานต่อเนื่องจนถึง real boundary
- ทุก blocker มีทางออกและ exact resume route
- Proof, authority, budget และ Land ยังคง fail-closed
- Legacy changes และ public CLI เดิมยังทำงาน
- Turn และ repeated-command metrics ดีขึ้นจาก baseline
- English/Thai public documentation ตรงกัน
- Current/shipped Markdown ทุกไฟล์ผ่าน inventory และ refresh gate
- Markdown ไม่มี stale lifecycle commands, artifact rules, versions หรือลิงก์
- Website documentation, navigation, landing/demo references และตัวอย่างคำสั่งเป็นปัจจุบัน
- Website English/Thai content สื่อ contract เดียวกันและ production build ผ่าน
- Historical reports และ archived records ถูกเก็บเป็น point-in-time records
- Full deterministic suite ผ่าน
- Delivery ที่ได้รับ Land authority จบที่ `archived`

## 25. สถานะปัจจุบัน

เอกสารนี้เป็น planning-only ไม่มี OpenSpec change ถูกสร้าง ไม่มี implementation ถูกแก้
และไม่มี paid Qwen scenario ถูกเรียกใช้
