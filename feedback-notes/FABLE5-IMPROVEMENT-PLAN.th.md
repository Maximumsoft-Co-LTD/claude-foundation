# Fable-5 Improvement Plan — claude-foundation workflow

Audit date: 2026-07-15 (v2.6.8) ตรวจอ่านครบทั้ง orchestrator + references, commands, WORKFLOW.md, agent files ทั้ง 19 ไฟล์, router, skills 26 ตัว, hooks 7 ตัว, settings

**Core finding:** pipeline ถูกออกแบบขึ้นบนสมมติฐาน 3 ข้อที่ยุค Fable 5 เปลี่ยนไป: (1) การจัดชั้น cost แบบ opus-main / sonnet-worker / haiku-analyzer ที่ hard-code ไว้ทั้งใน hooks และข้อความอธิบาย; (2) orchestrator context ถูกมองเป็นทรัพยากรหายากที่ต้องปันส่วนด้วย shortcut ที่แลก correctness ทิ้ง; (3) ความไม่ไว้ใจ (distrust) เชิงโครงสร้างต่อผลลัพธ์ของ sub-agent ที่สะสมมาแบบ reactive นอกจากนี้ยังมี consistency bug ที่ไม่เกี่ยวกับ model tier ซึ่งควรแก้อยู่ดี

---

## P0 — Consistency bugs (fix now, no design work)

1. **`INDEX.md:11` says `pm` is sonnet; `pm.md:5` says opus.** เป็น row เดียวในทะเบียนที่ข้อมูลไม่ตรงกัน แก้ที่ INDEX.md (CHANGELOG 2.6.5 ยืนยันว่า opus คือค่าที่ตั้งใจไว้)
2. **`dev-state-validate.sh:70` dup-key check สมมติว่า top-level indent เป็น 2-space เป๊ะ** การ reformat `state.json` ครั้งใดก็ตามจะทำให้ check ที่มีไว้ป้องกัน regression ที่เคยทำให้ `--resume` พังจริง ใช้งานไม่ได้แบบเงียบๆ ควรเปลี่ยนไปใช้การเทียบจำนวน key ด้วย `jq` แทนการ grep แบบ fixed-indent
3. **`dev-agent-guard.sh` Case 3 fail open เมื่อมี concurrent run เท่ากับ 0 หรือ 2+** (ไม่มี `CLAUDE_DEV_RUN_ID`) มีบันทึกไว้แค่ใน shell comment เท่านั้น ควรระบุเป็น caveat ของ state-discipline guarantee ไว้ใน `state-edge-cases.md`
4. **Case 4 อ่าน worker `model:` pin จาก frontmatter ด้วย `sed`** การ reformat YAML จะทำให้ parse หลุดไปเป็น "allow" แบบเงียบๆ ควรทำ parse ให้ทนทานขึ้น หรือ fail closed พร้อมข้อความ error ที่ชัดเจน
5. **Stale prose:** `dev.md:15` ไม่ได้พูดถึงการพับ test-plan เข้ากับ combined spawn ของ XS/S (ขัดกับ `xs-s-fast-path.md:6`); ตาราง fanout ใน `WORKFLOW.md:234` ขาดแกน surface (per-repo) และสัญญาณ `research:` ของ step 7; ข้อความ error ของ guard เขียนว่า "an opus main session" (ทั้งที่ tier ของ main ตอนนี้แปรผันได้แล้ว)
6. **มี hook ที่เขียนเสร็จแล้ว 2 ตัวแต่ยังไม่ได้ wire และไม่มี status marker บอก:** `no-direct-main-commit.sh` (มี self-test, ดูเหมือน wired แล้วแต่จริงๆ ไม่ใช่) และ `artifact-lint.sh` (ระบุว่า optional แต่มี test suite จริงตัวเดียวที่มี) ให้เลือกอย่างใดอย่างหนึ่ง: wire artifact-lint เป็น PostToolUse warn-only check บน `.workflow/**` writes หรือ stamp header ทั้งคู่ว่า `OPT-IN`

## P1 — Retune the model-tier system for Fable 5

Tier map ปัจจุบัน (opus main → sonnet workers → haiku analyzers) ถูกบังคับใช้ใน `dev-agent-guard.sh` Case 4–6 และมีเหตุผลรองรับแบบ "sonnet ≈ opus at ~½ wall-clock" (`references/lead.md:22`) เมื่อมี main model ระดับ Mythos-class ที่อยู่ **เหนือ** opus แล้ว tier map นี้ต้องผ่าน decision pass อย่างจริงจังหนึ่งรอบ แล้วค่อย rollout เชิงกลไก:

1. **เขียน policy note เดียวชื่อ `model-tiers`** (reference สั้นๆ ใหม่ ให้ INDEX.md และ guard ชี้มาที่นี่) แทน rationale ที่กระจัดกระจายอยู่ตามไฟล์ต่างๆ ข้อเสนอ mapping:
   - **Main agent (orchestrator, interview, gate): inherit (Fable 5)** เป็นแบบนี้อยู่แล้ว งานที่ต้องใช้ judgment หนักๆ (gate fold, size/field call, fanout arbitration) คือจุดที่การอัป tier คุ้มค่าที่สุด
   - **`lead` security mode + L-tier plan/review: อนุญาต `inherit`** แทนที่จะ cap ไว้ที่ opus ปัจจุบัน guard ทำให้ไปเหนือ opus ไม่ได้เลยสำหรับ artifact ที่ stake สูงที่สุด — กลับตาลปัตรภายใต้ Fable ต้องมี Case-4 exemption list (lead ได้รับยกเว้นอยู่แล้ว เก็บไว้) และอัปเดต prose ใน `references/lead.md:22`
   - **`pm` ยังคงเป็น opus** (rationale เรื่องคุณภาพ spec จาก 2.6.5 ยังใช้ได้อยู่ อีกทั้ง interview เกิดขึ้นบน Fable main อยู่แล้ว)
   - **`engineer`/`qa`/`retro`/`uxui` ยังคงเป็น sonnet; haiku analyzer ยังคงเป็น haiku** — งานที่เป็น mechanical/narrow-lens tier ถูกต้องอยู่แล้ว แต่ให้ไปบันทึก rationale haiku-vs-sonnet (ตอนนี้ยังไม่ได้เขียนไว้ที่ไหน) ลงใน TEAM.md
   - **Case 6 floor (`general-purpose`/`Explore` → sonnet): คงไว้ แต่ทำให้ parameterize ได้** floor model ควรอยู่ที่จุดเดียวแทนการ hard-code เป็น string และแก้ข้อความ error ด้วย
2. **Re-benchmark claim "sonnet ≈ opus at ½ wall-clock"** เทียบกับ model ปัจจุบัน ก่อนที่มันจะยังคงชี้นำ default-down override ของ lead ต่อไป — เป็น cost claim ที่ load-bearing ที่สุดตัวเดียวใน corpus และมีอายุย้อนไปถึงยุคก่อน Fable
3. **Inline-fallback อัปเกรด haiku role ไปเป็น sonnet แบบเงียบๆ** (`references/lead.md:96`, `pm.md:20`, `qa.md:51`) โดยไม่มีการ flag ใดๆ พฤติกรรมนี้โอเคอยู่แล้ว แต่ให้เพิ่มบรรทัดเดียวที่กำหนดให้ entry `Dispatched-as:` ต้องระบุการเปลี่ยน tier ด้วย เพื่อให้ cost drift มองเห็นได้
4. **Stale cache-TTL rule:** `orchestrator.md:21` เขียนว่า "keep turns short (~5-min cache TTL)" — แต่ Fable session รัน TTL 1 ชั่วโมง ให้เก็บหลัก "decide, write, spawn" ไว้เป็น hygiene แต่ตัด TTL justification ทิ้ง

## P2 — Relax correctness-trading context rations (biggest quality win)

Rule เหล่านี้มีไว้เพื่อกัน token ไม่ให้เข้าไปใน orchestrator context ยุค opus เท่านั้น บน Fable (budget ใหญ่กว่า, judgment ต่อ token ถูกกว่า) หลายข้อกำลังแลก correctness margin ทิ้งไปโดยไม่คุ้มอีกต่อไป:

1. **Set-compare gate fold** (`team-mode-sharding.md:11`, `orchestrator.md:33`): shard สามารถโกหกเรื่อง `ac_covered` แล้วผ่านได้ถ้า set แค่ match กัน ให้เพิ่ม spot-check ต้นทุนต่ำ — gate re-read AC แบบสุ่มหนึ่งตัวจาก artifact row ของแต่ละ shard; re-read เต็มรูปแบบเฉพาะตอนไม่ match เท่านั้น วิธีนี้ยังคง savings ไว้ได้ราว 90% แต่ปิดช่องโหว่การโกหกผ่าน index
2. **Security trigger ตัดสินจากชื่ออย่างเดียว** (`phase-2-guards.md:23`): คง fast path แบบดูจากชื่ออย่างเดียวไว้ แต่เมื่อเกิด *near-miss* (เข้า path category ที่ trip แล้วแต่ไม่มี content sink) ให้อนุญาตการ peek เนื้อหาแบบมีขอบเขต แทนที่จะ skip ไปเลย
3. **`tail -40` final-suite capture** (`phase-2-guards.md:29`): เปลี่ยนเป็น capture แบบ failure-aware (capture output เต็มตอน red, tail ตอน green)
4. **เก็บ** distrust machinery ที่ cost ต่ำและจับ failure จริงได้ไว้ (disjointness re-verify จาก `tasks.md`, `git status --porcelain` ground-truth, zero-file BLOCKER, present-and-compiles) เป็น pipeline hygiene ที่ model-agnostic ไม่ใช่การชดเชยให้ model อ่อนแอ อย่า relax

## P3 — Structural consolidation (maintenance debt)

1. **Fanout reference สะสมกระจัดกระจาย:** `fanout.md` + `fanout-plan.md` + `surface-fanout.md` + `implement-fanout.md` = 5.4k words คิดเป็น 45% ของ reference weight ทั้งหมด การไล่ตามสัญญาณเดียวต้องข้าม 4 ไฟล์ และ registry-preflight rule ถูกเขียนซ้ำในแต่ละ axis ให้ merge เหลือ 2 ไฟล์: `fanout-dispatch.md` (signal regex, registry preflight, guard interplay, dispatch table ของทั้ง 3 axis) + `implement-fanout.md` (ส่วนที่ต่างจริง: write-only engineer, integration engineer)
2. **Recruit-help boilerplate ถูก copy-paste ซ้ำ ~7 ครั้ง** (stop-line + cap + registry branch ชุดเดียวกันเป๊ะ ใน team-codebase-explorer, team-best-practice-researcher, team-code-reviewer, references/lead|pm|qa, uxui) ให้ดึง nesting contract ออกไปไว้ที่ `fanout-team-agents/references/dispatch-mechanism.md` (มีอยู่แล้ว) แล้วเหลือต่อ agent แค่: เลข cap + pointer line เดียว การเปลี่ยน cap-policy ในอนาคตตอนนี้ต้องแก้มือ 7 จุด
3. **`references/engineer.md` parity gap:** engineer เป็น core file ที่หนาแน่นเป็นอันดับ 2 มี 3 mode + fanout contract อยู่คนละ directory tree (`orchestrator/references/implement-fanout.md`) ให้สร้าง `references/engineer.md` เก็บ pointer ของ fanout/phase-engineer contract + รายละเอียด ship-mode และกำหนด rule ว่า agent จะมี references file เมื่อไหร่
4. **ระบบ trigger สองระบบที่ไม่เชื่อมกัน:** fundamentals.md router (skill สาย code-lifecycle 16 ตัว) กับการ match ผ่าน bare frontmatter (อีก 10 ตัว โดย 6 ตัวไม่มี wiring ใดๆ เลย) ให้เพิ่มภาคผนวกตาราง "non-router skills" ลงใน fundamentals.md (หรือ CLAUDE.md) เพื่อบันทึกไว้อย่างน้อยว่าระบบที่สองนี้เป็นของที่ตั้งใจให้เป็นแบบนี้
5. **Hook test coverage:** มีแค่ `artifact-lint.sh` ที่ถูก test เท่านั้น `dev-agent-guard.sh` (234 บรรทัด, 6 case, บล็อกการ spawn) คือ script ที่ untested และมี risk สูงที่สุด ให้ port self-test pattern ของ `no-direct-main-commit.sh` เข้าไปใน `tests/` สำหรับ guard + validate + mark
6. **`ui-ux-pro-max`** เป็น SKILL.md เดี่ยวก้อนใหญ่ที่สุด (6.1k words ไม่มีการ split เป็น references/) ให้ split ตามแบบ sibling ตัวอื่นๆ
7. **`team-*` fork drift:** fork มาจาก pr-review-toolkit เมื่อ 2026-05-21 มีการแก้ local ที่บันทึกไว้แค่ 1 จุด ไม่มีกลไก audit (`TEAM.md:50-56`) ให้เลือก: กำหนด audit pass หนึ่งรอบตอนนี้ (upstream drift สะสมมาแล้วราว 8 สัปดาห์) หรือประกาศให้ fork นี้ detached ไปเลยอย่างชัดเจน
8. **Multi-repo boundary** (`size-execution.md:28`, `surface-fanout.md:16`): "still being built out" คือ functional debt ที่แต่งตัวเป็น design-rule — blocking finding ใน repo ที่ไม่ใช่ primary จะ auto-fix ไม่ได้ ให้ตัดสินใจ: สร้าง implement/ship fanout รองรับ multi-repo จริงๆ หรือ scope ตัดออกไปเลยแล้วประกาศให้ชัด

## P4 — Fable-era capability adoption (directional, behind a version gate)

Protocol `FANOUT_REQUESTED:` first-line-sentinel และ dispatch loop ที่ orchestrator เป็นตัวกลาง คือเวอร์ชัน hand-rolled ของสิ่งที่ harness มีให้ใช้ native อยู่แล้วตอนนี้ ให้ adopt แบบค่อยเป็นค่อยไป โดยยังคง signal path ไว้เป็น fallback (pattern เดียวกับ direct-nesting gate ของ v2.1.172):

1. **Structured worker returns:** sentinel string (`BLOCKER:`, `SIZE_UPGRADE:`, การ parse first-line) เปราะบางโดยธรรมชาติของการออกแบบ ตรงจุดที่ harness รองรับ schema-validated agent output ให้กำหนด return schema เล็กๆ (status, size_upgrade, files_changed, ac_covered) แล้วให้ validation retry มาแทน rule การ parse prose
2. **Deterministic fanout ผ่าน Workflow primitive** สำหรับ fanout ที่มีรูปทรงตายตัว (review core-3/full-6, surface per-repo, security bucket): เขียน script ให้ fan-out/synthesis barrier ทำงานแบบ deterministic แทนการ prompt ให้ orchestrator ไล่ตาม procedure 4 ไฟล์ Implement fanout ยังคงเป็นของ orchestrator เหมือนเดิม (ต้องมี gate interplay + git ground-truthing)
3. **Session-scoped registry fragility** (`running-a-fanout.md`: agent `team-*` ตัวใหม่ spawn ไม่ได้จนกว่าจะ restart ทั้ง branch `team_registry` ถูกสร้างขึ้นมารอบๆ ปัญหานี้): เช็คว่า harness เวอร์ชันปัจจุบัน rescan agent กลาง session ได้หรือไม่ ถ้าได้ registry state แบบ three-way นี้จะยุบเหลือแค่ version note เดียว
4. **`qa` visual pass** ใช้ Playwright ผ่าน Bash เท่านั้น ให้ประเมิน browser-automation MCP tools เป็นทางเลือกสำหรับ step Visual+a11y (อาจตั้งใจให้เป็นแบบนี้เพื่อ headless CI — บันทึกไว้ไม่ว่าจะเลือกทางไหน)

## P5 — Opus 4.8 main-model profile (ปิดช่องว่างให้ใกล้ Fable 5)

ที่มา: `how-to-4.8-same-5.md` (Anthropic docs + benchmark ภายนอก, ก.ค. 2026) ข้อเท็จจริงหลัก: ช่องว่างกับ Fable 5 อยู่ที่ long-horizon agentic self-verification (SWE-Bench Pro 80.3 vs 69.2) และปิดได้เกือบหมดเมื่อ harness ป้อน external verification feedback ให้ — ซึ่ง workflow นี้มีโครงส่วนใหญ่อยู่แล้ว profile ด้านล่างคือส่วนที่เหลือ

1. **Session config (จุดพลาดอันดับ 1):** รัน orchestrator session ด้วย adaptive thinking ON และ effort `xhigh` (ค่า default ของ Claude Code สำหรับงานโค้ด; ขั้นต่ำ `high`) — Opus 4.8 จะไม่คิดถ้าไม่สั่ง ต่างจาก Fable 5 เพิ่มโน้ตหนึ่งบรรทัดใน preamble ของ `orchestrator.md`: "บน Opus 4.8 main session ให้เช็ค effort ≥ high ก่อนเข้า Phase 2"
2. **ต่อ verification loop ให้ครบวงจร** (นี่คือตัวปิดช่องว่างจริง และยกระดับ P0.6 จากงานเก็บกวาดเป็นงาน load-bearing):
   - Wire `artifact-lint.sh` เป็น PostToolUse warn-only บน write ไปที่ `.workflow/**` — การเช็ค artifact เชิงกลไกมาแทน self-review ที่ Fable ทำเองภายใน
   - ขยาย `lint.sh` ให้รัน typecheck ของโปรเจกต์ด้วย (tsc/go vet) บนไฟล์ที่แก้ ไม่ใช่แค่ style linter — feedback ความผิดพลาดทันทีหลังทุก edit batch คือเงื่อนไขแบบ Terminal-Bench ที่ทำให้ 4.8 ≈ Fable
   - คง review/QA ไว้ใน **agent แยก context** (เป็น design เดิมอยู่แล้ว: `lead` Mode B, `qa` execute) ห้าม fold review เข้า implementer ที่ XS/S — verifier ที่ context สดชนะ self-critique บน 4.8 โดยเฉพาะ
3. **แก้กับดัก review recall:** `team-code-reviewer.md:25` hard-filter เหลือเฉพาะ confidence ≥ 80 พร้อมคำสั่ง "filter aggressively" — 4.8 เชื่อฟังคำสั่งห้ามจุกจิกเกินไปจน recall ตก เปลี่ยน contract ของ worker เป็น "รายงานทุก finding พร้อม confidence + severity" แล้วย้าย filter ≥ 80 ไปที่ synthesis step ของ `lead` (`references/lead.md:113`) ซึ่งเป็นที่ที่มันควรอยู่ตั้งแต่แรก
4. **ชดเชยนิสัย 4.8 ที่ under-reach เรื่อง subagent/tool:**
   - 4.8 ชอบคิดเองมากกว่าเรียก tool — router แบบ trigger (`fundamentals.md`) และ description ของ agent ช่วยอยู่แล้ว; audit ให้ทุกจุดตัดสินใจ fanout ใน `orchestrator.md` ใช้ประโยคเชิงคำสั่ง ("spawn X when Y") ไม่ใช่เชิงบรรยาย
   - ทำให้ `## Fanout plan` เป็น default-on ที่ M/L แทนที่จะแล้วแต่ดุลพินิจของ lead — 4.8 จะไม่หยิบ parallelism มาใช้เองถ้าไม่ถูกกระตุ้น
5. **ลด ask-rate:** เพิ่มหนึ่งบรรทัดใน prompt ของ `pm`/`lead`/`engineer`: "การตัดสินใจเล็กๆ (ตั้งชื่อ, ค่า default) — เลือกเลย บันทึกไว้ใน artifact อย่า BLOCKER" คง `BLOCKER:` ไว้เฉพาะกรณี goal ไม่รู้ (`pm.md:28` ขีดเส้นนี้ให้ pm อยู่แล้ว; ทำซ้ำให้ engineer)
6. **First turn ต้องมี spec ครบ:** spawn prompt ตอนนี้ใช้ "pointers + the delta" อยู่แล้ว — คงไว้; 4.8 คุณภาพตกเมื่อโดนป้อนคำสั่งแบบทีละหยด ห้ามแตก brief ของ worker ข้ามหลาย turn
7. **นโยบาย model escalation (อัปเดต P1.1):** default main = Opus 4.8 + harness ชุดนี้; เก็บ Fable 5 ไว้สำหรับ run ที่ต้นทุนความล้มเหลวสูงกว่าค่า token — plan ระดับ L, security mode, migration ใหญ่, งาน autonomous ข้ามคืน — 4.8 ชนะอยู่แล้วเรื่อง hallucination rate และ GPQA ที่ราคาครึ่งเดียว ($5/$25 vs $10/$50 ต่อ MTok)

## Sequencing

- **Week 1:** P0 (เชิงกลไก, ~1 วัน) + P1.1–1.2 decision pass (ต้องมี owner ตัดสินใจเรื่อง tier policy)
- **Week 2:** P1 rollout + P2 (diff เล็ก, ได้ correctness margin มาก)
- **Weeks 3–4:** P3 ข้อ 1–3 (สาม consolidation หลัก) จากนั้นข้อ 4–8 ทำแบบ opportunistic
- **P4:** spike ทีละข้อ อยู่หลัง version gate อย่า couple เข้ากับ P0–P3

ทุก item ใน P0/P1 แตะไฟล์ที่ closing rule ใน `fundamentals.md:55` บอกว่าต้องย้ายไปด้วยกัน (CLAUDE.md / README / WORKFLOW ต้อง mirror chain เดียวกัน) — ให้รัน grep-anchor check (`ddd-strategic`) หลังแต่ละ batch
