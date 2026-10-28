# skill-guidance Specification

## Purpose
ขั้นตอนที่ตรวจได้จาก pstack ใน reference ของ owner skill โดยไม่ขัดกฎเดิมและไม่เกิน budget
## Requirements
### Requirement: Performance work has a bounded hillclimb procedure

ระบบ SHALL ให้ performance-investigation มี reference hillclimb ที่กำหนด stop predicate, การพิสูจน์ความไวของ harness ก่อน freeze, attempt log และการเปลี่ยนทางเมื่อถึง plateau

- stop predicate = target คู่กับจำนวน attempt ขั้นต่ำ หรือ plateau ที่ยืนยันแล้ว
- ก่อนเริ่มต้องพิสูจน์ว่า harness แยก workload ที่ต่างกันได้ แล้ว freeze ไม่แก้ harness ระหว่าง hillclimb
- ทุก hypothesis ต้องระบุกลไก และไล่ตามลำดับ mantra จากถูกไปแพง
- keep หรือ revert แต่ละ attempt ด้วยการแก้ workspace และเก็บ log เป็น raw run นอก managed skills ไม่ใช้ commit
- การอ้าง improvement สุดท้ายใช้ benchmark provider หรือ project tool ผ่าน harness และ paid workload ต้องมี authority

#### Scenario: reference มีขั้นตอนครบ

- **WHEN** อ่าน performance-investigation/references/hillclimb.md
- **THEN** มี stop predicate, harness sensitivity และ freeze, attempt log, plateau pivot และ mantra order

#### Scenario: เข้าถึงได้จาก reference เดิม

- **WHEN** reference governance ตรวจ bundle performance-investigation
- **THEN** hillclimb.md reachable จาก measurement.md โดย SKILL.md ไม่เพิ่มคำ

#### Scenario: ไม่สั่ง commit ต่อ attempt

- **GIVEN** เนื้อหามีคำสั่ง commit ต่อ attempt หรือ status ledger
- **WHEN** รัน skill-catalog.test.mjs
- **THEN** test คำต้องห้าม fail

### Requirement: Performance claims explain the number

ระบบ SHALL ให้ measurement.md กำหนดให้เขียนประโยค claim ก่อนวัด ถามว่าทำไมไม่เป็นสองเท่า และตัดสิน inconclusive เมื่อไม่รู้ limiter

#### Scenario: มีกฎ claim

- **WHEN** อ่าน measurement.md
- **THEN** มีขั้นเขียน claim ก่อนวัด, why-not-double และ inconclusive เมื่อ limiter ไม่มีชื่อ

#### Scenario: pin เดิมคงอยู่

- **WHEN** รัน skill-catalog.test.mjs
- **THEN** /returned Build/, /Never fabricate missing measurements/ และ not a status ledger ยังผ่าน

### Requirement: Debugging stops guessing and repairs the root cause

ระบบ SHALL ให้ debug-fundamentals มี reference root-cause ที่หยุดการแก้ต่อหลังแก้ล้มซ้ำสองครั้งจนกว่าจะเขียนและทดสอบ premise และตรวจความชอบธรรมของ guard

- trigger: แก้ล้มสองครั้งบน gate เดียวกัน ต้องเขียน premise และ experiment ที่ falsify ได้ก่อนแก้ต่อ
- guard เป็นการแก้ได้ก็ต่อเมื่อ state ที่มันรับมือนั้นชอบธรรม; การลบ guard ยังต้องพิสูจน์ตาม coding-discipline
- instance อื่นของ pattern เดียวกันที่อยู่นอกขอบเขตของ change ให้รายงานเป็น follow-up ไม่รวมเป็น cleanup

#### Scenario: มี stop rule

- **WHEN** อ่าน debug-fundamentals/references/root-cause.md
- **THEN** มี trigger แก้ล้มสองครั้งและข้อกำหนดเขียน premise ก่อนแก้ต่อ

#### Scenario: ไม่ขัด no bundled cleanup

- **GIVEN** เนื้อหาสั่งให้แก้ทุก instance ทั่ว repo โดยไม่จำกัดขอบเขต
- **WHEN** รัน skill-catalog.test.mjs
- **THEN** test fail เพราะไม่มีข้อความจำกัดขอบเขตและ follow-up

#### Scenario: pin bisection คงอยู่

- **WHEN** รัน skill-catalog.test.mjs
- **THEN** bisection.md ยังตรง /never the active target or Build workspace/

### Requirement: Tests are judged against behavior and internal edits

ระบบ SHALL ให้ test-design.md มีการทดสอบ test ด้วยการแก้สองแบบในใจและรายการสาเหตุของ hollow assertion

- การแก้สองแบบ: break the behavior ต้องทำให้ test fail; change the internals ต้องไม่ทำให้ test fail
- hollow assertion: ค่าคาดหวังคำนวณจากโค้ดที่ทดสอบ, ค่าคงที่ที่ทวนซ้ำ, assertion แบบไม่มีการเรียกที่ไม่มี positive case คู่กัน
- การทำ effect ซ้ำสองครั้งเป็น mutation ที่ใช้ตรวจ idempotent behavior
- ถ้าไฟล์เกิน 300 บรรทัดต้องมี ## Contents ที่ลิงก์ได้
- programming-fundamentals ไม่มี references/testing.md อีกต่อไป; SKILL.md ของมันลิงก์ไป ../../testing-fundamentals/references/test-design.md แทน

#### Scenario: มีสองการแก้และ hollow assertion

- **WHEN** อ่าน test-design.md
- **THEN** มี break the behavior, change the internals และรายการ hollow assertion

#### Scenario: ไม่ซ้ำกับ programming-fundamentals testing

- **GIVEN** references ของ programming-fundamentals หลัง change นี้ (module-design, details, error-handling, complexity, naming)
- **WHEN** reference governance ตรวจ duplicate และ skill-catalog.test.mjs ตรวจไฟล์
- **THEN** programming-fundamentals/references/testing.md ไม่มีอยู่ และไม่มีย่อหน้าซ้ำหรือใกล้เคียง (Jaccard ≥ 0.92) ระหว่าง test-design.md กับไฟล์ใดใน references ของ programming-fundamentals

### Requirement: Impact claims state how far safety was proven

ระบบ SHALL ให้ change-impact-analysis มี reference proof ladder ห้าระดับและข้อกำหนดระบุ load-bearing safety fact

- ladder: คำบอก, อ่านโค้ด, ค้นหา consumer, รันจริงผ่าน project tool, ทำซ้ำในแอปที่รันอยู่
- รายงานต้องบอกว่าหยุดที่ระดับใด ไม่เรียก cleared จากระดับที่ต่ำกว่า
- การรันจริงเป็นหลักฐานได้ต่อเมื่อผ่าน provider ของ harness ไม่ใช่คำอ้าง
- SKILL.md ได้ลิงก์หนึ่งบรรทัดไม่เกิน 12 คำ

#### Scenario: มี ladder

- **WHEN** อ่าน change-impact-analysis/references/proof-ladder.md
- **THEN** มีห้าระดับ, say where it stopped และ load-bearing safety fact

#### Scenario: pin เดิมคงอยู่

- **WHEN** รัน skill-catalog.test.mjs
- **THEN** SKILL.md ยังตรง /OpenSpec/, /not receipts/ และ /never hand-edit/

### Requirement: Operations answer the rerun and crash questions

ระบบ SHALL ให้ Principle 5 ใน shared-state-and-async.md มีสามคำถาม idempotency และกฎเขียนไฟล์ชั่วคราวแล้ว rename

- สามคำถาม: รันซ้ำแล้วเกิดอะไร, run ก่อนหน้า crash กลางทางแล้วเกิดอะไร, สอง run พร้อมกันแล้วเกิดอะไร
- derive แต่ละขั้นจาก state ปัจจุบัน, เขียน temp แล้ว rename, ตัดสิน staleness จากหลักฐานที่ถูกต้องทุกจุด crash
- queue-fundamentals/references/idempotency.md ลิงก์มาที่ Principle 5 แทนการคัดลอก

#### Scenario: มีสามคำถาม

- **WHEN** อ่าน shared-state-and-async.md Principle 5
- **THEN** มีสามคำถามและกฎ temp แล้ว rename

#### Scenario: Contents ยังลิงก์ได้

- **WHEN** รัน skill-catalog.test.mjs
- **THEN** ## Contents ของ shared-state-and-async.md ยัง resolve ทุก anchor

### Requirement: Recurring lessons become the strongest workable check

ระบบ SHALL ให้ coding-discipline/references/details.md มี enforcement ladder และข้อกำหนดว่า check ใหม่ต้อง fail บนกรณีจริงในอดีต

- ladder: architecture, type, lint ที่ error บอกวิธีแก้, test, เอกสารเป็นทางเลือกสุดท้าย
- check ใหม่ต้อง fail บน occurrence จริงในอดีต โดยใช้ base-tree ของ tests that fail without the change
- การนำ check เข้าทำผ่าน /change ปกติ ไม่มี commit แยก
- การเขียนคำสั่งเดิมซ้ำเป็นครั้งที่สองคือ trigger ให้พิจารณา check แทน prose

#### Scenario: มี ladder

- **WHEN** อ่าน coding-discipline/references/details.md
- **THEN** มีลำดับ architecture, type, lint, test, docs และ fail-on-past-case

#### Scenario: ไม่สั่ง commit แยก

- **GIVEN** เนื้อหามี one commit each หรือ separate commit
- **WHEN** รัน skill-catalog.test.mjs
- **THEN** test คำต้องห้าม fail

### Requirement: Repeated work builds a lever and domain models show skip signals

ระบบ SHALL ให้ details.md มีกฎ build-the-lever และ module-design.md มี skip signal ของ domain model และการทดสอบผู้อ่าน 30 วินาที

#### Scenario: มี lever และ skip signals

- **WHEN** อ่าน details.md และ module-design.md
- **THEN** มี build-the-lever, one more branch, synchronized boolean และ 30-second reader test

#### Scenario: pin programming-fundamentals คงอยู่

- **WHEN** รัน skill-catalog.test.mjs
- **THEN** SKILL.md ยังมี Design deep, cohesive modules และ references/module-design.md

### Requirement: Prose deliverables follow one writing reference

ระบบ SHALL ให้ init-project-docs/references/writing.md เป็นแนวทางการเขียนเดียวที่มีการเลือกรูปแบบเอกสารแบบ Diátaxis และ catalog รูปแบบภาษาแบบ AI พร้อมตัวอย่างก่อนและหลัง

- ลิงก์จาก init-project-docs/references/documentation-workflow.md, git-workflow/references/commit-messages.md, git-workflow/references/pull-requests.md, harness-html-report/references/report.md และ claude-md/references/guide-workflow.md
- ห้ามแก้ข้อความที่ผู้ใช้ quote, หัวข้อหรือ marker ที่ parser ต้องการ (Requirement:, Scenario:, WHEN/THEN/SHALL) และภาษาของเอกสารที่ผู้ใช้กำหนด
- การเขียน commit message หรือ PR ไม่ให้สิทธิ์ commit หรือเปิด PR

#### Scenario: มี Diátaxis และ catalog

- **WHEN** อ่าน writing.md
- **THEN** มีการเลือก tutorial/how-to/reference/explanation, catalog รูปแบบภาษา และตัวอย่างก่อนหลัง

#### Scenario: เข้าถึงได้ทุก bundle ที่เขียน prose

- **WHEN** reference governance ตรวจ
- **THEN** writing.md reachable จาก init-project-docs และลิงก์ข้าม bundle ทั้งห้า resolve

#### Scenario: ไม่ทำลาย marker ของ parser

- **GIVEN** writing.md สั่งให้เขียนหัวข้อ Requirement หรือ Scenario ใหม่
- **WHEN** รัน skill-catalog.test.mjs
- **THEN** test fail เพราะไม่มีข้อความคุ้มครอง parser marker

### Requirement: New skill guidance is guarded against contradicting existing contracts

ระบบ SHALL มี test ที่ตรวจไฟล์ reference ทุกไฟล์ที่ change นี้เพิ่มหรือแก้ว่าไม่มีคำสั่งที่ขัดกับกฎเดิม และ pstack-adoption.md บันทึก review ของ commit e5136d8

- รายการคำต้องห้ามรวม: commit per/each attempt, one commit each, open a PR, push, merge to, spawn, fan out to models, without asking, proceed without approval, delete the old API immediately
- ข้อความปฏิเสธที่มีอยู่แล้ว (เช่น Land never commits) ไม่นับเป็นการละเมิด: test ตรวจเฉพาะเนื้อหาที่ change นี้เพิ่ม
- pstack-adoption.md เพิ่ม provenance ของ e5136d8 และ Verification boundary bullets ที่ลิงก์ reference ใหม่ โดยตาราง Disposition ยังมี 58 แถว

#### Scenario: เนื้อหาสะอาด

- **WHEN** รัน skill-catalog.test.mjs
- **THEN** test คำต้องห้ามผ่านทุกไฟล์ใหม่และที่แก้

#### Scenario: คำต้องห้ามถูกจับ

- **GIVEN** ไฟล์ใหม่มีคำว่า open a PR
- **WHEN** รัน test
- **THEN** test fail ระบุไฟล์และคำ

#### Scenario: ตาราง adoption ไม่เปลี่ยน

- **WHEN** รัน skill-catalog.test.mjs
- **THEN** ตาราง Disposition ยังมี 58 แถวและ provenance มีทั้ง 5062f28 และ e5136d8

### Requirement: Skill bodies stay within the context budget

ระบบ SHALL คง SKILL.md ทุกไฟล์ไม่เกิน 700 คำและรวมไม่เกิน 9500 คำ โดย change นี้เพิ่มรวมไม่เกิน 12 คำ

#### Scenario: budget ผ่าน

- **WHEN** รัน run-context-budget-tests.sh
- **THEN** ทุก assertion ผ่าน

#### Scenario: เกิน budget

- **GIVEN** SKILL.md รวมเกิน 9500 คำ
- **WHEN** รัน budget test
- **THEN** test คืน CONTEXT_BUDGET_USER_DECISION_REQUIRED

### Requirement: trigger-descriptions

ระบบ SHALL ให้ description ของ skill ที่ไม่ใช่ lifecycle ทั้ง 32 ตัวเป็นประโยค trigger สั้นที่บอกว่าใช้ทำอะไร ใช้เมื่อไร และข้ามเมื่อไร ตามข้อความที่กำหนดด้านล่าง

- lifecycle skill 8 ตัว (change, build, prove, land, investigate, dev, feature, changes) ไม่ถูกแก้
- description ≤ 40 คำ ขึ้นต้นด้วย Use when ... และมีส่วนข้าม (Skip ... หรือ use <skill> for ...)
- description ของ testing-fundamentals, database-fundamentals, api-design-fundamentals, security-fundamentals, debug-fundamentals ยังมีคำ workType, riskSignals, requirement หรือ scenario และคำว่า Skip
- ไม่มีคำว่า Must always apply, any prose surface, Use any MCP tool
- brainstorming: Use when the product outcome or approach is still open and the user must pick between real alternatives before /change. Skip settled work and how/why questions (use investigate).
- change-impact-analysis: Use before changing an API, schema, config, or shared behavior when you do not know who depends on it. Skip isolated code with known consumers.
- coding-discipline: Use when scope, assumptions, or the right size of a fix is unclear and you might over-build. Skip routine settled work.
- debug-fundamentals: Use when workType is bugfix and the cause is unknown: reproduce, localize, fix, prove. Skip obvious corrections, new features, and slowness (use performance-investigation).
- performance-investigation: Use when something is measured slow, growing in memory, or a speedup must be proven. Skip unmeasured bugs (debug-fundamentals) and telemetry design (observability-fundamentals).
- plan-writing: Use when a settled change needs design input — dependencies, compatibility, migration, rollback — before compiling. Skip obvious rapid work.
- refactoring-fundamentals: Use when restructuring code without changing behavior: extract, move, rename, split, deduplicate, simplify. Skip bug fixes and new features.
- testing-fundamentals: Use when a task's requirement has scenarios to prove: write a failing-first test per scenario and pick level and doubles. Skip docs, renames, and work with no behavior to prove.
- api-design-fundamentals: Use when workType includes api or library, or a requirement defines a request, response, status code, error body, pagination, or version other code consumes. Skip private module interfaces (use programming-fundamentals).
- architecture-fundamentals: Use when deciding how services, runtimes, or deployables split, talk, fail, or scale. Skip single-process module design (programming-fundamentals) and domain meaning (ddd-strategic).
- concurrency-fundamentals: Use when threads, async tasks, locks, shared mutable state, cancellation, or races affect correctness inside one process. Skip cross-process queues (queue-fundamentals) and database isolation (database-fundamentals).
- database-fundamentals: Use when workType includes data or migration, or a requirement touches a schema, query, index, transaction, or persisted file. Skip read-only analysis and measured slowness (use performance-investigation).
- ddd-strategic: Use when business terms, bounded contexts, aggregates, or who owns a model are unclear. Skip generic CRUD and settled single-context code.
- hexagonal-backend: Use when one backend service needs domain logic isolated from framework and storage through ports and adapters. Skip trivial CRUD and cross-service design (architecture-fundamentals).
- observability-fundamentals: Use when adding or reviewing logs, metrics, traces, SLOs, or alerts for a runtime failure surface. Skip offline code; use performance-investigation to explain measurements.
- programming-fundamentals: Use for nontrivial local logic: types, state, data structures, error paths, module boundaries inside one process. Skip trivial or generated code and cross-runtime design.
- queue-fundamentals: Use when work crosses processes through a broker, stream, job queue, or worker: delivery semantics, idempotency, retries, ordering, backpressure. Skip in-process async (concurrency-fundamentals).
- security-fundamentals: Use when riskSignals include access-control, authorization, secrets, or external-integration, or a scenario must reject forged, replayed, oversized, or unauthorized input. Load with the owning construction skill. Skip work without a trust boundary.
- claude-md: Use when asked to create or update a repository's CLAUDE.md. Skip human onboarding docs (use init-project-docs).
- delivery-engineering: Use when building or fixing CI/CD, builds, containers, deploys, rollouts, or rollbacks. Skip application code and Git operations (use git-workflow).
- frontend-design: Use when implementing or polishing web UI — layout, typography, motion, responsive states — after UX direction is settled. Skip unresolved interaction decisions (use ux-ui-principles).
- git-workflow: Use when asked to branch, commit, rebase, merge, push, clean up, or open a PR. Skip read-only inspection; Land never grants Git authority.
- grill-task-gu: Use when grooming an approved PRD into a grounded decision sheet and ordered backlog. Skip implementation and compiled-spec approval.
- grill-task-gu-please: Alias for grill-task-gu; use only when the old name is invoked.
- harness-html-report: Use when asked for an HTML report of Change Loop state, tasks, gates, or evidence. Read-only; skip anything that changes runtime state.
- init-project-docs: Use when asked to create or refresh human-facing onboarding docs for an existing codebase. Skip CLAUDE.md-only requests (use claude-md).
- skill-creator: Use when explicitly asked to create or edit a skill. Skip unrequested skill changes; use skill-evaluation to compare behavior.
- skill-evaluation: Use when comparing a changed skill or description against its old version on real runs. Skip static catalog checks (skill-suite-auditor).
- skill-suite-auditor: Use when auditing the skill catalog for metadata, overlap, broken references, or ownership conflicts. Skip behavioral evaluation (skill-evaluation).
- tailwind-design-system: Use when maintaining shared Tailwind v4 tokens, variants, themes, or a v3 migration. Skip one-off styling (use frontend-design).
- ui-ux-pro-max: Use when you need to look up product, style, palette, typography, or chart guidance from the bundled design data. Skip experience reasoning (ux-ui-principles) and final visuals (frontend-design).
- ux-ui-principles: Use when deciding or reviewing user flows, hierarchy, forms, navigation, accessibility, or responsive layout. Skip settled visuals (frontend-design) and token systems (tailwind-design-system).

#### Scenario: description ตรงตามข้อความที่กำหนด

- **GIVEN** SKILL.md ของ skill ที่อยู่ในขอบเขต 32 ตัว
- **WHEN** อ่าน frontmatter description
- **THEN** ทุกตัวตรงกับข้อความใน details (ต่างได้เฉพาะเครื่องหมายวรรคตอน) ≤ 40 คำ และมีส่วนที่บอกว่าเมื่อไรไม่ควรใช้

#### Scenario: spec-vocabulary ยังอยู่

- **GIVEN** skill 5 ตัวที่ spec-vocabulary-descriptions กำหนด
- **WHEN** รัน .claude/harness/tests/skill-routing.test.mjs
- **THEN** ผ่านทุก assertion

#### Scenario: lifecycle skill ไม่ถูกแตะ

- **GIVEN** SKILL.md ของ lifecycle skill 8 ตัว
- **WHEN** เทียบกับ HEAD 281caac1b
- **THEN** เนื้อหาเหมือนเดิมทุกไบต์

#### Scenario: description ยาวเกิน

- **WHEN** description ใดเกิน 80 คำ
- **THEN** skill-catalog.test.mjs fail ระบุชื่อ skill

### Requirement: minimal-skill-bodies

ระบบ SHALL ให้ SKILL.md ของ skill ในขอบเขตใช้โครงเดียวกัน: จุดยืน 1 บรรทัด, Steps ≤ 6 ข้อ, Harness ≤ 3 บรรทัด และรายการ References ที่อ่านเมื่อจำเป็น

- โครงเดิม: วรรคเปิด + ## Rules 7 ข้อ + ## Check before finishing 4-6 ข้อ + วรรค handoff + วรรค References (40-80 บรรทัด, 300-450 คำ)
- โครงใหม่: # ชื่อ / จุดยืน 1 บรรทัด / ## Steps (≤ 6 ข้อ ทำตามได้ทันที) / ## Harness (≤ 3 บรรทัด) / ## References (read only when needed) bullet: ชื่อไฟล์ — เมื่อไรควรอ่าน
- SKILL.md แต่ละไฟล์ในขอบเขต ≤ 250 คำ (ไม่รวม frontmatter) และรวมทุก SKILL.md ≤ 9,500 คำตาม budget เดิม
- วรรค Harness ยังระบุว่า harness เป็นเจ้าของ lifecycle, receipts, task status และ Build ไม่ stage/commit
- ข้อความที่ test เดิม pin (เช่น Design deep, cohesive modules; Never ask what you can find; not receipts; never hand-edit; approves intake choices, not a compiled OpenSpec packet) ยังอยู่หรือถูกแทนด้วยถ้อยคำใหม่ที่ test อัปเดตให้ตรงกันในงานเดียวกัน

#### Scenario: ทุก body อยู่ใน budget และใช้โครงเดียวกัน

- **GIVEN** SKILL.md 32 ไฟล์ในขอบเขต
- **WHEN** นับคำหลัง frontmatter และอ่านหัวข้อ
- **THEN** ทุกไฟล์ ≤ 250 คำ มีหัวข้อ Steps, Harness, References และ run-context-budget-tests.sh ผ่าน

#### Scenario: guardrail ยังถูกจับ

- **GIVEN** SKILL.md หรือ reference ที่ย่อแล้วถูกแทรกคำว่า commit when green หรือ open a PR
- **WHEN** รัน skill-catalog.test.mjs
- **THEN** test fail ระบุไฟล์และคำ

#### Scenario: จำนวน assertion ห้ามคำไม่ลดลง

- **GIVEN** skill-catalog.test.mjs, run-doc-consistency.sh และ run-context-budget-tests.sh ที่ HEAD มี doesNotMatch/assert_file_not_contains รวม 21 จุด
- **WHEN** เทียบหลังแก้
- **THEN** จำนวนไม่น้อยกว่า 21 และทุก regex ที่เปลี่ยนมีคู่ใหม่ที่ความหมายเดิม

### Requirement: pruned-references

ระบบ SHALL ให้ references ของ skill ในขอบเขตเป็นไปตามแผน keep/merge/drop รายไฟล์ด้านล่าง โดยคงเนื้อหาที่ spec หรือ test pin ไว้ครบ

- references รวมทุก skill ≤ 8,500 บรรทัด (จาก 14,048)
- วรรค Principle N (from SKILL.md) ที่คัดลอก body ของ SKILL.md มาซ้ำถูกตัดออกทุก bundle
- reference-governance.mjs ผ่าน: ทุกไฟล์ reachable, ลิงก์และ anchor resolve, ไม่มี block ซ้ำหรือใกล้เคียง (Jaccard ≥ 0.92); ไฟล์เกิน 300 บรรทัดยังมี ## Contents
- ไฟล์ที่ถูกลบหรือรวมต้องไม่มีลิงก์เข้าจากไฟล์ที่ shipped
- debug-fundamentals (332): keep reproduction/root-cause/bisection (pinned); merge instrumentation + distributed-debugging → tools.md ~80
- performance-investigation (134): keep hillclimb, measurement (pinned)
- change-impact-analysis (48): keep proof-ladder (pinned)
- refactoring-fundamentals (397): keep refactoring-discipline, characterization-tests, large-scale (pinned); catalog → ตาราง move/when ~60; code-smells → ตาราง smell/fix ~50
- testing-fundamentals (514): keep test-design (pinned), coverage, verification-drivers; test-doubles-and-levels ตัดวรรค Principle ซ้ำ → ~120
- coding-discipline (105): keep details, cleanup (pinned)
- ddd-strategic (1,055): aggregate-design → ~200 (ตัดตัวอย่าง Scrum, ย่อ persistence/events); bounded-contexts → ~150 (ตัด glossary building, drawing a map); event-storming → ~80 (ตัด facilitation, sticky colors, Domain Storytelling); subdomain-classification → ~80 (ตัด Wardley, worked examples); failure-modes keep
- architecture-fundamentals (834): drop observability.md (ซ้ำ observability-fundamentals → ลิงก์ข้าม bundle); communication → ~130 (ตัด API versioning/deprecation ที่ซ้ำ api-design evolution); resilience → ~120; boundaries → ~100
- programming-fundamentals (544): keep module-design (pinned); drop testing.md (ซ้ำ testing-fundamentals → ลิงก์); details → ~50; error-handling → ~60; complexity → ~40; naming → ~30
- concurrency-fundamentals (595): shared-state-and-async keep Contents + Principle 5 + Quick reference (pinned); Principle 1-4, 6-7 ย่อเป็น pointer; recipes 1-5 ตัด ~40% → ~350
- database-fundamentals (841): indexing → ~110; migrations → ~130; query-performance → ~130; schema-design → ~50; transactions → ~120
- hexagonal-backend (676): keep patterns-and-pitfalls (pinned); go → ~180 และ typescript → ~130 (ตัวอย่างชั้นละหนึ่ง)
- api-design-fundamentals (350): merge auth-and-limits เข้า contracts-and-errors (→ ~90); evolution → ~100; resource-modeling → ~70
- queue-fundamentals (873): broker-selection → ~90 (ตัด per-broker cheat sheet); idempotency → ~130 (ลิงก์ Principle 5 ตาม pin); operating → ~130; outbox → ~120
- security-fundamentals (504): authn-authz → ~150; input-and-output → ~140; trust-and-hardening → ~70
- observability-fundamentals (514): logs-metrics-traces ตัด Principle 1-7 ซ้ำ body เหลือ conventions/recipes/worked example → ~330
- tailwind-design-system (835): setup-and-migration → ~100; component-patterns → ~150; layout-motion-theming → ~150; utilities-and-advanced → ~80
- ux-ui-principles (863, 13 ไฟล์ → 10): merge visual + visual-composition → ~90; merge accessibility + accessibility-verification → ~90; merge patterns + experience-patterns → ~110; experience-workflow → ~90; sources → ~40; keep interaction, validation, do-and-dont, change-loop-handoff, upstream (pinned)
- ui-ux-pro-max (563): keep search-tool (เอกสารเครื่องมือ), experience-workflow; quick-reference → ~150; app-ui-rules → ~70
- git-workflow (594): keep pull-requests (pinned); commit-messages → ~120 (คง provenance และ writing link ที่ pin); recovery → ~120; branching-and-rebasing → ~100
- delivery-engineering (537): keep ci-and-review-repair; pipeline-and-deploy → ~280 (7 principles ย่อเหลือ ~100)
- init-project-docs (642): keep writing, documentation-workflow (pinned); doc-templates → ~200 (เหลือหัวข้อ ตัดเนื้อหาตัวอย่าง); workflow-and-quality → ~70
- skill-creator (718): keep ทั้งหมด (schemas เป็น contract ของ script; ที่เหลือ pinned); creating-skills → ~80
- claude-md, harness-html-report, grill-task-gu, skill-evaluation, skill-suite-auditor (447): keep ทั้งหมด (pinned หรือเป็น contract)
- brainstorming, plan-writing, frontend-design, grill-task-gu-please: ไม่มี references แก้เฉพาะ description และ SKILL.md
- scripts/, assets/, data/ ของ ui-ux-pro-max และ skill-creator ไม่ถูกแตะ

#### Scenario: ขนาดรวมลดและ governance ผ่าน

- **GIVEN** references หลังตัด
- **WHEN** นับบรรทัดรวมและรัน reference-governance.mjs
- **THEN** รวม ≤ 8,500 บรรทัด และไม่มี issue

#### Scenario: เนื้อหาที่ pin ยังครบ

- **GIVEN** ไฟล์ reference ที่ test pin ไว้
- **WHEN** รัน skill-catalog.test.mjs และ run-context-budget-tests.sh
- **THEN** ทุก assertion ผ่าน

#### Scenario: ไฟล์ที่แผนบอกว่าลบหรือรวมหายไปจริง

- **GIVEN** แผนระบุ drop observability.md ของ architecture, testing.md ของ programming, auth-and-limits.md, instrumentation.md, distributed-debugging.md และคู่ซ้ำ 3 คู่ของ ux-ui-principles
- **WHEN** list ไฟล์ใน references หลัง Build
- **THEN** ไฟล์เหล่านั้นไม่อยู่ และไฟล์ที่รวมเข้าไปมีเนื้อหาส่วนที่ย้ายมา

#### Scenario: ลบไฟล์ที่ยังถูกอ้าง

- **WHEN** reference ถูกลบแต่ SKILL.md หรือ reference อื่นยังลิงก์ถึง
- **THEN** reference-governance.mjs รายงาน unresolved reference

### Requirement: router-in-sync

ระบบ SHALL ให้แถว trigger ใน .claude/rules/fundamentals.md ใช้คำเดียวกับ description ของ skill ที่มันชี้ไป

- fundamentals.md ≤ 700 คำ และยังมีประโยคที่ test pin: Skills supply judgment and procedures; the harness owns lifecycle, module boundary, abstraction depth, structured question tool, record the answers in the change packet

#### Scenario: แถว router ตรงกับ description

- **GIVEN** ตาราง Process/Construction/Delivery ใน fundamentals.md
- **WHEN** เทียบคำ trigger ของแต่ละแถวกับ description ของ skill ปลายทาง
- **THEN** ทุกแถวมีคำหลักร่วมกับ description อย่างน้อยหนึ่งคำ และ budget 700 คำผ่าน

### Requirement: trigger-evaluation-report

ระบบ SHALL มีรายงาน skill-evaluation ลงวันที่ที่เทียบการ trigger ของ catalog ที่ HEAD 281caac1b กับ catalog ใหม่บน case ชุดเดียวกัน

- ใช้ positive/negative case จาก skill-evaluation/references/evaluation-cases.json ของ skill ในขอบเขต รันแต่ละ case อย่างน้อย 2 ครั้งต่อ arm
- รายงานอยู่ที่ docs/reports/2026-10-27-skill-catalog-trigger-evaluation.md ระบุ source revision ทั้งสอง arm, model, จำนวน run, per-case ผล, missed/false trigger, usage ที่วัดได้ (ไม่วัดได้ = unknown)
- transcript ดิบอยู่นอก Git; ไฟล์ใน .claude/skills ไม่ถูกใช้เก็บผล
- evaluation-cases.json ยัง execution: not-run และทุก case status: not-run ตาม test เดิม
- ถ้า missed trigger ของ catalog ใหม่มากกว่า baseline ในระดับที่ทำซ้ำได้ ให้รายงานเป็น regression และหยุดก่อน Land

#### Scenario: รายงานมีสอง arm

- **GIVEN** baseline และ candidate รันครบ
- **WHEN** อ่านรายงาน
- **THEN** มีตาราง per-case ที่แต่ละแถวบอก skill ที่ถูกโหลดใน arm เก่าและใหม่ พร้อมสรุป missed/false trigger ของแต่ละ arm

#### Scenario: run ไม่สำเร็จ

- **WHEN** host runner ไม่พร้อมหรือ case รันไม่ได้
- **THEN** รายงานระบุ case นั้นเป็น not-run ไม่ใช่ pass

#### Scenario: catalog ใหม่แย่ลง

- **WHEN** missed trigger ของ candidate มากกว่า baseline ในทุกรอบที่รัน
- **THEN** รายงานติดป้าย regression และ Prove ไม่ผ่าน
