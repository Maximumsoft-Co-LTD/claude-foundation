# Change Loop AI-native SDLC playbook — 2026-11-09

**Status:** plan and progress record, exported 2026-11-10 from the maintainer's
working document. Proposal plus executed work; not a release claim. Thai prose.

**Source:** adapts Anthropic's [AI-native SDLC playbook](https://claude.com/resources/articles/the-ai-native-sdlc-playbook)
to this repository. Delivered work is tracked in PRs #50 (phases 0–1), #51
(phase 2A), #52 (phase 2B), and #53 (incident 2 fix) on
`Maximumsoft-Co-LTD/claude-foundation`; their test plans hold the verification
evidence. Phase 3 and the paid evals are not started. Later decisions are not
reflected here; this record is not updated to describe later state.


การพัฒนา Change Loop ต้องมีเอกสาร 16 ชนิดเรียงตาม 6 stage ตอนนี้มีแล้ว 10 ชนิด ขาด 6 ชนิด: REVIEW.md, agent evals, incident record, lessons file, ownership map (CODEOWNERS) และ maintain config เอกสารนี้ปรับ [AI-native SDLC playbook](https://claude.com/resources/articles/the-ai-native-sdlc-playbook) ของ Anthropic ให้เข้ากับ repo `claude-foundation` และต่อยอดจาก `docs/reports/harness-development-playbook.md`

## 1. หลักการ

ทุก stage จบด้วยเอกสารที่ commit เข้า git และ stage ถัดไปอ่านเอกสารนั้นเป็น input คนตัดสินใจที่ gate ไม่ได้ลงมือทำแต่ละขั้นเอง

Change Loop ทำแบบนี้อยู่แล้วในช่วง Change → Build → Prove → Land ช่องว่างจริงอยู่ที่ 3 จุด: เกณฑ์รีวิวของทีม, eval ของพฤติกรรม agent และช่วงหลัง release ที่ยังไม่มี loop ส่งกลับ

**การแบ่งความรับผิดชอบ (ตาม AGENTS.md):**

- **User ตัดสินใจ:** intent, ขอบเขต, ลำดับความสำคัญ, เกณฑ์ยอมรับ, trade-off สำคัญ, อำนาจ Land และ release
- **Agent เขียนโค้ดและเอกสาร:** investigation, spec, implementation, test, เอกสาร EN/TH
- **Harness ทำอัตโนมัติ:** lifecycle state, การแยก workspace, receipt, ความสดของหลักฐาน, guard และการกู้คืน

**กติกาที่ใช้กับเอกสารทุกตัวในแผนนี้:**

1. เอกสารหนึ่งตัวมีเจ้าของหนึ่งคน และมีแหล่งความจริง (canonical source) ที่เดียว ตาม CLAUDE.md § Documentation ownership
2. เอกสารที่ผูกกับ change อยู่ใน `openspec/changes/<id>/` ส่วนเอกสารถาวรของโปรเจกต์อยู่ที่ root หรือ `openspec/`
3. คำแนะนำ (skill, CLAUDE.md) เป็นแค่ advisory กฎที่ต้องเป็นจริงทุกครั้งต้องมี hook หรือ harness check บังคับ
4. ไฟล์ที่ ship ไปให้ผู้ใช้ห้ามอ้างถึง path ที่อยู่แค่ใน repo นี้ (`.claude/tests/`, `docs/`, `dashboard/`)

## 2. แคตตาล็อกเอกสาร

เอกสารทั้งหมด 16 ชนิด เรียงตาม stage คอลัมน์ "บังคับด้วย" บอกว่าอะไรตรวจได้อัตโนมัติ ไม่ใช่แค่คำแนะนำ

| # | Stage | เอกสาร | Path | เนื้อหาหลัก | เจ้าของ / ผู้อนุมัติ | บังคับด้วย | สถานะ |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Plan | Investigation | `openspec/investigations/<id>.md` | ปัญหา, หลักฐานจาก source, คำถามที่เปิดอยู่ | Agent เขียน / User ตอบคำถาม | source binding ของ harness | มี |
| 2 | Plan | Intent (proposal) | `openspec/changes/<id>/proposal.md` + `grounding.yaml` | Why, ผลลัพธ์ที่สังเกตได้, Non-goals, ข้อจำกัด, การตัดสินใจ | User อนุมัติ | `change validate`, `doctor --stage change` | มี |
| 3 | Design | Spec + design | `specs/**/spec.md`, `design.md`, living specs `openspec/specs/` (46 capability) | Requirement, scenario, การออกแบบ, NFR | Agent เขียน / User อนุมัติความหมาย | compiler + decision frontier | มี |
| 4 | Build | Plan (tasks) | `tasks.md` | ไฟล์, ลำดับ, claim, repo, verify command | Agent | dispatch ปฏิเสธ task ที่ไม่มี provider | มี |
| 5 | Build | Proof plan | `evidence.yaml`, `execution.yaml` | claim → provider → receipt | Agent / Harness ตรวจ | `proof readiness` | มี |
| 6 | Build | ความรู้ของ repo | `CLAUDE.md`, `AGENTS.md`, `harness-development-playbook.md` | คำสั่ง, convention, ขอบเขต ship, lane | Maintainer ทุกคน / code owner | docs consistency suite | มี |
| 7 | Build | Skills + rules | `.claude/skills/`, `.claude/rules/` | มาตรฐานที่ agent ใช้ซ้ำ | Policy owner | context budget, `skill-suite-auditor` | มี |
| 8 | Build | Hooks + settings | `.claude/hooks/`, `.claude/settings.json` | guard แบบ deterministic (phase, secret, shell, authority) | Platform (maintainer) | `hooks/run-hook-tests.sh` | มี |
| 9 | Test | Deterministic tests + bench | `.claude/tests/`, `.claude/tests/bench/` | unit, seam, installer, mutation, scenario | Agent / Maintainer | `run-all.sh`, CI `workflow-tests.yml` | มี |
| 10 | Release | เอกสาร release | `RELEASING.md`, `CHANGELOG.md`, `user-scenario-release-status.md` | checkpoint, หลักฐานก่อนปล่อย | Release manager (User) | `release:preflight`, `release.yml` | มี |
| 11 | Review | REVIEW.md | `REVIEW.md` (ใหม่) | รอบตรวจ, นิยาม severity, nit cap, ข้อยกเว้น | Tech lead | hash ผูกกับ review receipt | ขาด |
| 12 | Test | Agent evals | `evals/*.json` (ใหม่) | prompt + เกณฑ์ผ่าน/ไม่ผ่าน จาก 20–50 งานจริง | Platform / ทีมเจ้าของ incident | CI เมื่อ skill, hook, CLAUDE.md เปลี่ยน | ขาด |
| 13 | Maintain | Incident record | `openspec/incidents/<id>.md` (ใหม่) | อาการ, หลักฐาน, สาเหตุ, การแก้, eval ที่เพิ่ม | Service owner | ลิงก์กับ change และ eval | ขาด |
| 14 | Maintain | Lessons file | `openspec/lessons.md` (ใหม่) | บทเรียนที่ investigation ครั้งต่อไปต้องอ่าน | Incident responder | `/investigate` อ่านเป็น grounding | ขาด |
| 15 | ทุก stage | Ownership map | `.github/CODEOWNERS` + roles ใน `foundation.json` (ใหม่) | ใครอนุมัติเอกสารและ gate ไหน | User | branch protection, authority receipt | ขาด |
| 16 | Maintain | Maintain config | `maintain.yaml` (ใหม่) | signal, เกณฑ์ระดับ, สิ่งที่ agent ทำได้ต่อระดับ | Service owner | harness intake + tier guard | ขาด |

หมายเหตุ: `.claude/agents/` มีโฟลเดอร์แต่ยังว่าง นับเป็นส่วนเสริมของเอกสาร #7 ไม่ใช่ช่องว่างแยก

## 3. Stage 1 — Plan: จากความต้องการเป็น intent ที่ commit แล้ว

Stage นี้จบเมื่อมี `proposal.md` ที่ user ยอมรับ ส่วนนี้มีครบแล้ว สิ่งที่ต้องเพิ่มคือทางเข้าจาก incident และการอ่าน lessons file

**เอกสารที่ใช้:** Investigation (#1), Intent/proposal (#2)

**เนื้อหาขั้นต่ำของ `proposal.md`:**

- ประโยค intent เดียวที่บอกผลที่สังเกตได้ (change id มาจากประโยคนี้)
- `## Why`: ผู้ใช้เจออะไรตอนนี้ และทำไมทำต่อไม่ได้
- `## Non-goals`: สิ่งที่ตั้งใจไม่แก้
- แหล่งที่มา: user request, investigation, incident id หรือ issue
- ผู้ใช้และระบบที่กระทบ, lane (A–E ตาม playbook), คำถามที่เปิดอยู่

**Gate:** User ยอมรับ intent และตัดสินใจ acceptance (งาน harness ส่วนใหญ่เป็น `--acceptance-not-required`)

**Harness บังคับ:** `change validate` และ `doctor --stage change` ปฏิเสธ packet ที่ไม่ครบ ส่วน investigation ผูก source ไว้ให้ตรวจย้อนได้

**ต้องเพิ่ม:**

- [ ] ให้ `/investigate` อ่าน `openspec/lessons.md` (#14) และ incident ที่เกี่ยวข้องเป็น grounding
- [ ] ฟิลด์ `source` ใน proposal อ้างถึง incident id ได้ เพื่อต่อกับ Stage 6
- [ ] เก็บ metric: เวลาจากบทสนทนาถึง intent ที่ commit และสัดส่วน intent ที่ถูก abandon

## 4. Stage 2 — Design: จาก intent เป็น spec ที่ตรวจได้

Stage นี้จบเมื่อ compiler ผ่าน packet และทุกการตัดสินใจใน decision frontier มีคำตอบ ส่วนนี้เข้มกว่าบทความแล้ว สิ่งที่ต้องเพิ่มคือการระบุตัวผู้อนุมัติตามบทบาท

**เอกสารที่ใช้:** Spec + design (#3), อ่าน Skills (#7) เป็นข้อจำกัด

**เนื้อหาขั้นต่ำ:**

- หนึ่ง claim ต่อหนึ่งพฤติกรรมที่สังเกตได้ รวม negative path
- Requirement และ scenario แบบ "เมื่อ… ต้อง…" ใน `specs/<capability>/spec.md`
- `design.md` (โปรไฟล์ standard) ระบุทางเลือกที่ปฏิเสธและเหตุผล
- NFR ที่มีนัยสำคัญ เช่น ความเข้ากันได้กับเวอร์ชันเก่า, protocol pin, ผลต่อการ upgrade
- พื้นที่ที่จะแก้ (`change resolve --surface`)

**Gate:** User อนุมัติความหมายของ spec (ไม่ใช่ตรวจทุกบรรทัด) การค้นพบระหว่าง Build ที่เปลี่ยน agreement ต้องผ่าน semantic amendment ก่อน

**Harness บังคับ:** compiler สร้าง stable ID และ cross-link, ตรวจ discovery coverage ตามความเสี่ยง และปฏิเสธ packet ที่ยังมีการตัดสินใจค้าง

**ต้องเพิ่ม:**

- [ ] ให้การตัดสินใจแต่ละชนิดระบุบทบาทผู้อนุมัติได้ เช่น product → PO, security → policy owner (ต้องมี #15 ก่อน)
- [ ] เก็บ metric: เวลาจาก intent ถึง spec ที่ผ่าน validate และจำนวน amendment หลัง Build เริ่ม (rework)

## 5. Stage 3 — Build: plan, ความรู้ของ repo และ guard

Build เริ่มได้เมื่อ `tasks.md` และ `evidence.yaml` ผ่าน validate แล้วเท่านั้น และทำใน workspace ที่แยกออกมา ข้อนี้เทียบได้กับ plan mode + worktree ในบทความ

**เอกสารที่ใช้:** Plan/tasks (#4), Proof plan (#5), ความรู้ของ repo (#6), Skills + rules (#7), Hooks + settings (#8)

**เนื้อหาขั้นต่ำ:**

- `tasks.md`: ทุก task มีไฟล์, verify command และ `[claims:…] [repo:…] [paths:…]` เป็น ledger เดียว ห้ามมีไฟล์สถานะคู่ขนาน
- `CLAUDE.md`: แผนที่ source, ขอบเขต ship, คำสั่งตรวจ, กฎเอกสาร เพิ่มกฎทุกครั้งที่ agent พลาดเรื่องเดิมซ้ำสองครั้ง
- Skill: frontmatter ที่บอก trigger ชัด, เนื้อหาเป็นขั้นตอนไม่ใช่เรื่องเล่า, อยู่ในงบ context
- Hook: บล็อกแล้วต้องอธิบายเหตุผลและทางต่อได้เอง

**Gate:** ไม่มี gate ของ user ใน Build ยกเว้น agreement เปลี่ยน (amendment) หรือต้องใช้อำนาจภายนอก

**Harness บังคับ:** แยก workspace แบบ fail-closed, phase-mutation guard, protect-secrets, shell-route guard, no-direct-main-commit และ dispatch ปฏิเสธ task นอกอำนาจ repo

**ต้องเพิ่ม:**

- [ ] กำหนด namespace ของ skill ที่ทีมเป็นเจ้าของ (เช่น `project-*`) ให้ installer ไม่เขียนทับ และให้ `skill-suite-auditor` ตรวจชื่อชน (ตอนนี้ installer เขียนทับเฉพาะไฟล์ใน manifest อยู่แล้ว)
- [ ] CODEOWNERS (#15): การแก้ `.claude/skills/**` ต้องให้ policy owner อนุมัติ และ `.claude/hooks/**` ต้องให้ platform อนุมัติ
- [ ] ตัดสินว่าจะ ship subagent definition ใน `.claude/agents/` หรือไม่ (เช่น verifier ที่ทำได้แค่อ่าน) ตอนนี้โฟลเดอร์ว่าง
- [ ] เก็บ metric: first-pass proof rate, เวลาจาก plan ถึง Land, จำนวนรอบ repair

## 6. Stage 4 — Test: หลักฐานของระบบและของ agent

หลักฐานว่าระบบทำงานถูกมีครบแล้ว ส่วนหลักฐานว่า agent ทำงานถูกยังขาด ต้องเพิ่ม eval ที่รันทุกครั้งที่คำสั่งของ agent เปลี่ยน

**เอกสารที่ใช้:** Deterministic tests + bench (#9), Agent evals (#12)

**ที่มีแล้ว:**

- ทุก regression อยู่ที่ระดับต่ำสุดที่จับ defect ได้ (unit, seam, installer, hook, context budget, docs)
- Receipt ผูกกับเนื้อหา ไฟล์เปลี่ยน → หลักฐานเก่า → รันใหม่เฉพาะส่วนที่เกี่ยว
- Test ที่ค้นเจอ 0 ตัวผ่านไม่ได้ (`discovery` + `minimum`)
- Bench scenario แบบเสียเงินรันก่อน release เท่านั้น และต้องได้รับอนุมัติงบก่อน

**รูปแบบ eval ที่ต้องเพิ่ม (`evals/<id>.json`):**

```json
{ "id": "land-refuses-stale-proof",
  "source": "incident:2026-11-xx",
  "prompt": "Land change X after editing src/a.js",
  "checks": [
    { "kind": "exit", "expect": "blocked" },
    { "kind": "text", "must": "proof is stale" } ],
  "owner": "evidence" }
```

**กติกาของ eval:**

1. เริ่มจากงานจริง 20–50 งาน เลือกจาก bench scenario และรายงาน e2e ที่มีอยู่ใน `docs/reports/`
2. หนึ่ง incident ที่แก้แล้ว = หนึ่ง eval ใหม่
3. แยก 2 ชั้น: ชั้น deterministic รันทุก PR, ชั้นที่เรียก model จริง รันเมื่อ skill, hook, rules หรือ CLAUDE.md เปลี่ยน และต้องมีเพดานงบ
4. Eval ห้ามเรียก runtime ที่กำลังแก้เป็นหลักฐาน (ตาม playbook § 2.5)

**ต้องเพิ่ม:**

- [ ] กำหนด schema `evals/*.json` และ runner ที่ใช้ bench runner เดิม
- [ ] เพิ่ม claim ชนิด `regression` ที่ผูก incident id และให้ `bugfix` variant `hotfix` ต้องมี eval ก่อน archived
- [ ] ลงทะเบียน suite ใน `run-all.sh` และ `.claude/tests/README.md` พร้อมกัน
- [ ] ตัดสินว่าจะ ship eval runner ให้โปรเจกต์ผู้ใช้ด้วยหรือใช้เฉพาะใน repo นี้
- [ ] เก็บ metric: eval pass rate, first-pass CI success, change failure rate

## 7. Stage 5 — Review, Land และ Release

กลไกรีวิวและ Land แข็งแรงแล้ว สิ่งที่ขาดคือ `REVIEW.md` ที่ทีมใช้เขียนเกณฑ์รีวิวถาวร ตอนนี้ reviewer ตัดสินจาก spec ของ change นั้นอย่างเดียว

**เอกสารที่ใช้:** REVIEW.md (#11), เอกสาร release (#10), Ownership map (#15)

**ที่มีแล้ว:** AI reviewer พร้อม fallback, บังคับให้ผู้รีวิวไม่ใช่คนเดียวกับผู้เขียนโค้ด, review receipt ผูกกับเนื้อหา, Land เป็น gate เดียวที่แข็ง, `/deliver` เปิด PR ภายใต้อำนาจตัวเอง, `release.yml` ทำ tag/formula/bottle

**โครงสร้าง `REVIEW.md` ที่เสนอ:**

```markdown
# Review rules
## Passes
1. Correctness: พฤติกรรมตรง claim ทุกตัว รวม negative path
2. Shipping boundary: ไฟล์ที่ ship ไม่อ้าง path ที่ไม่ ship
3. Security: secret, การแยก workspace, อำนาจ
4. Compatibility: protocol pin, upgrade จากรูปแบบเก่า
## Severity
- blocker: ผิด claim, หลักฐานอ่อนลง, ข้อมูลหาย
- major: พังในกรณีที่เกิดได้จริง
- nit: ไม่เกิน 3 ต่อรอบ, ไม่ block
## Exclusions
- generated receipts, CHANGELOG เก่า, docs/reports ที่มีวันที่
```

**การผูกเข้ากับ harness:**

1. Reviewer packet ใส่เนื้อหา `REVIEW.md` และ receipt บันทึก hash ไฟล์ ถ้า REVIEW.md เปลี่ยน review เดิมถือว่าเก่า
2. ทุก finding เป็นคำแนะนำ ไม่มีผลต่อผลรีวิว ผ่าน/ไม่ผ่านยังเป็นของ EVIDENCE.md (คุณตัดสินแล้วเมื่อ 2026-11-09)
3. Installer ใส่ template ตั้งต้นเมื่อยังไม่มีไฟล์ แต่ไม่เขียนทับ (แบบ `foundation.json`)

**ต้องเพิ่ม:**

- [ ] เขียน `REVIEW.md` ของ repo นี้เองก่อน (dogfood)
- [ ] แก้ `EVIDENCE.md` § review, บัญชีไฟล์ของโปรเจกต์ใน `install.sh`, หน้า `approval.md` EN/TH, seam test การผูก hash
- [ ] เปิด branch protection บน `main` ให้ต้องมี code owner อนุมัติ
- [ ] พิจารณา bump `reviewProtocol` ถ้ารูปร่าง receipt เปลี่ยน
- [ ] เก็บ metric: เวลาที่รอใน gate, defect ที่จับได้ก่อน merge เทียบกับที่หลุดไป, DORA

## 8. Stage 6 — Maintain: ปิด loop จากผลจริงกลับเข้า intent

Stage นี้ยังไม่มีเลย หลักการจากบทความ: การตรวจจับเป็น deterministic, ระดับ (tier) กำหนดว่า agent ทำอะไรได้ และผลวินิจฉัยต้องกลับเข้า Stage 1 เป็น intent ใหม่

**เอกสารที่ใช้:** Incident record (#13), Lessons file (#14), Maintain config (#16), Agent evals (#12)

**Signal ที่เหมาะกับ Change Loop (เป็น dev tool ไม่มี production traffic):**

- CI บน `main` ล้ม หรืออัตรา test ล้มสูงกว่าค่าฐาน
- GitHub issue จากผู้ใช้ และ `harness feedback` ที่มีอยู่แล้ว
- ผล paid scenario ก่อน release ที่ไม่ถึง `archived`
- ค่า observability เช่น จำนวนรอบ repair หรือเวลา Prove เกินค่าฐาน

**ระดับใน `maintain.yaml`:**

| ระดับ | เกณฑ์ | Agent ทำได้ |
| --- | --- | --- |
| 1 | เกินค่าฐาน 1σ | log อย่างเดียว |
| 2 | 2σ หรือ issue ใหม่ | วินิจฉัยแบบอ่านอย่างเดียว แล้วเขียน investigation |
| 3 | 3σ หรือ `main` ล้ม | เปิด change draft หรือ revert PR ผ่าน review gate เท่านั้น |

**ขั้นตอน:**

1. Script ตรวจจับ (ไม่ใช้ model) รันตามรอบใน CI ตัว script อยู่ใน git และมี unit test
2. เกินเกณฑ์ → เรียก agent แบบ non-interactive ตามสิทธิ์ของระดับ
3. Agent เขียน incident record + investigation ในรูปแบบ Stage 1
4. Service owner เลือก: แก้เลย, นัดทีหลัง หรือปิดทิ้ง การปิดทิ้งใช้ปรับเกณฑ์
5. แก้เสร็จผ่าน Change Loop → เพิ่ม eval หนึ่งตัว → เขียนบทเรียนลง lessons file

**เนื้อหา incident record:** id, วันที่, signal ที่ตรวจพบ, อาการ, เวอร์ชันที่กระทบ, หลักฐาน, สาเหตุ, change id ที่แก้, eval id, ผลการตัดสินใจของ owner

**การควบคุม:** agent ไม่มีสิทธิ์ push หรือ release, ทุกการเรียกและการตัดสินใจถูก log, เกณฑ์ระดับแก้ได้ผ่าน PR เท่านั้น

**ต้องเพิ่ม:**

- [ ] เริ่มที่ incident record + lessons file แบบเขียนด้วยมือก่อน (ไม่ต้องมี automation)
- [ ] เลือก signal แรกหนึ่งตัว: CI บน `main` ล้ม
- [ ] เพิ่มคำสั่ง intake จาก signal ที่สร้าง investigation หรือ change draft ได้
- [ ] เก็บ metric: เวลาจาก signal ถึง intent ในคิว, สัดส่วน finding ที่กลายเป็น fix, incident ซ้ำชนิดเดิม

## 9. บทบาทและ RACI

ตอนนี้ repo มี maintainer คนเดียว บทบาทหลายอันจึงตกกับคนเดียว ตารางนี้กำหนดบทบาทไว้ก่อน เพื่อให้ย้ายไปให้คนอื่นได้เมื่อทีมโต โดยไม่ต้องแก้ workflow

R = ทำ, A = อนุมัติ, C = ปรึกษา, I = แจ้งให้ทราบ

| เอกสาร / gate | Product owner | Tech lead | Policy owner | Release manager | Service owner | Agent | Harness |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Intent (#2) | A | C | I |  |  | R | ตรวจรูปแบบ |
| Spec + design (#3) | A | C | C |  |  | R | compiler |
| Tasks + proof plan (#4, #5) |  | A |  |  |  | R | dispatch guard |
| CLAUDE.md (#6) |  | A |  |  |  | R | docs suite |
| Skills + rules (#7) |  | C | A |  |  | R | context budget |
| Hooks + settings (#8) |  | A | C |  |  | R | hook tests |
| REVIEW.md (#11) |  | A | C |  |  | R | hash ใน receipt |
| Evals (#12) |  | A |  |  | C | R | CI |
| Land | A | C |  |  |  | R | Land guard |
| Release (#10) | I | C |  | A |  | R | `release.yml` |
| Incident + lessons (#13, #14) | I | C |  |  | A | R | intake |
| Maintain config (#16) |  | C |  |  | A | R | tier guard |

**กฎแยกหน้าที่:** agent ที่เขียนโค้ดอนุมัติงานตัวเองไม่ได้ harness บังคับเรื่องนี้ผ่าน reviewer independence และ authority receipt อยู่แล้ว สิ่งที่ต้องเพิ่มคือการบันทึกว่าบทบาทไหนเป็นผู้อนุมัติ

**ที่เก็บการ map บทบาท (เสนอ):** `.github/CODEOWNERS` สำหรับไฟล์ และ `roles` ใน `foundation.json` สำหรับ gate ของ lifecycle

## 10. Metrics

ทุกตัวคำนวณจากข้อมูลที่ harness เก็บอยู่แล้วหรือจะเก็บเพิ่ม ค่าที่วัดไม่ได้รายงานเป็น unknown ไม่ใช่ 0 (ตามกฎ unknown-as-unavailable)

| Stage | Leading (วัดระหว่างทาง) | Lagging (วัดผลลัพธ์) | แหล่งข้อมูล |
| --- | --- | --- | --- |
| Plan | เวลาจากคำขอถึง intent ที่ commit | สัดส่วน change ที่ abandon | lifecycle events |
| Design | เวลาจาก intent ถึง spec ที่ validate | จำนวน amendment หลัง Build เริ่ม | packet revisions |
| Build | จำนวน change ที่ทำพร้อมกัน | จำนวนรอบ repair, เวลา plan ถึง Land | observability |
| Test | eval pass rate | first-pass proof rate, change failure rate | receipts, CI |
| Review/Land | เวลาที่รอใน gate | defect ที่จับก่อน merge เทียบกับที่หลุดไป | review receipts, issues |
| Release | เวลาจาก archived ถึง release | DORA: ความถี่ release, lead time, เวลากู้คืน | git tags, `release.yml` |
| Maintain | เวลาจาก signal ถึง intent ในคิว | incident ซ้ำชนิดเดิม | incident records |

แสดงผลใน `dashboard/` ที่มีอยู่ ไม่เก็บตัวเลขไว้ในไฟล์ที่ ship (ตามกฎห้ามเก็บ benchmark history ใน runtime)

## 11. Roadmap

แบ่งเป็น 4 เฟส เรียงตามความคุ้มและลำดับที่ต้องมีก่อน ทุกงานทำผ่าน Change → Build → Prove → Land ของ repo นี้เอง หนึ่งงานต่อหนึ่ง change

1. **เฟส 0: เอกสารพื้นฐาน (ไม่แก้ runtime, Lane D)**
   - เขียน `REVIEW.md` ของ repo นี้, `.github/CODEOWNERS`, template incident record และ `openspec/lessons.md` เปล่า
   - ย้าย playbook นี้เข้า `docs/reports/` และลิงก์จาก `harness-development-playbook.md`
   - Gate: user อนุมัติเนื้อหา REVIEW.md และการแบ่งบทบาท (สถานะ 2026-11-09: เสร็จ commit c727f236 ยังไม่ได้ย้าย playbook เข้า docs/reports)
2. **เฟส 1: REVIEW.md เข้า harness (Lane A + C)**
   - Reviewer packet อ่าน REVIEW.md, receipt ผูก hash, installer ใส่ template แบบไม่เขียนทับ
   - หลักฐาน: seam test, installer smoke, upgrade matrix, docs EN/TH
   - Gate: user อนุมัติ Land (REVIEW.md เป็นคำแนะนำ ตัดสินแล้ว เฟส 1 จึงแค่ส่งไฟล์เข้า reviewer packet และผูก hash ไม่แตะตรรกะผ่าน/ไม่ผ่าน)
3. **เฟส 2: Evals + incident loop แบบเขียนด้วยมือ (Lane A + B)**
   - Schema `evals/*.json` + runner, claim ชนิด `regression`, hotfix ต้องมี eval ก่อน archived
   - `/investigate` อ่าน lessons file, eval 20–50 ตัวแรกจาก bench และรายงาน e2e
   - Gate: user อนุมัติงบ eval ที่เรียก model จริง และตัดสินว่าจะ ship runner หรือไม่
4. **เฟส 3: Maintain loop + บทบาท + metrics (ขยายขอบเขต product)**
   - `maintain.yaml`, คำสั่ง intake จาก signal, CI ตามรอบที่ตรวจ `main`
   - `roles` ใน `foundation.json` และบันทึกบทบาทใน authority receipt (อาจต้อง bump protocol pin)
   - Metrics ตามหัวข้อ 10 ใน `dashboard/`
   - Gate: user ตัดสินว่าเฟสนี้อยู่ในขอบเขต ก่อนเริ่มงานใด ๆ

**การตรวจทุกเฟส:** `run-all.sh --affected` ระหว่างทำ, full suite ก่อน commit, docs consistency suite, สร้างเว็บเมื่อหน้าเว็บเปลี่ยน และ `git diff --check`

**ความคืบหน้า (2026-11-09):**

| เฟส | สถานะ | หลักฐาน |
| --- | --- | --- |
| 0 เอกสารพื้นฐาน | เสร็จ commit `c727f236` บน branch `docs/review-governance-phase0` | docs suite 144/144 |
| 1 REVIEW.md เข้า harness | เสร็จ PR #50 (commit 1a2c008b + 0a87185f) | proof: discovery, AI review, test ผ่าน; installer 334/334; feedback-review 131/131; website build 41 หน้า |
| 2 Evals + incident loop | เสร็จ: 2A PR #51 (hotfix บังคับ regression, incident/lessons ให้ผู้ใช้) และ 2B PR #52 (agent evals, งบ $100/เดือน, ยังไม่ได้รันแบบเสียเงิน) | — |
| 3 Maintain + บทบาท + metrics | รออนุมัติขอบเขต | — |

**ความเสี่ยงที่เหลือจากเฟส 1:**

- [ ] แก้แล้ว: receipt อ่าน hash ของ REVIEW.md ตอนบันทึก ไม่ใช่ตอนส่ง packet ถ้าแก้ไฟล์ระหว่างรีวิวกำลังรัน receipt จะผูก hash ใหม่ (แก้: เก็บ hash ใน dispatch attempt)
- [ ] แก้แล้ว: เพิ่มเทสต์ว่า REVIEW.md ที่ installer สร้างถูก stage เข้า git
- [ ] หน้า `cli.md` ยังไม่มีแถว review packet schema (ตาราง pin ผูกกับ v3.6.10)

**Incident แรก (2026-11-09):** callback `currentReviewRulesHash` ไม่มี default ทำให้ 2 suite ล้มหลัง Land บทเรียนคือต้องรัน full suite ใน sandbox ก่อน Land บันทึกไว้ใน `openspec/incidents/2026-11-09-review-rules-callback-default.md` และ `openspec/lessons.md`

**Incident ที่ 2 (2026-11-09, ปิดแล้ว):** AI review ติดทางตันหลังรีวิวรอบแรกที่ใช้ model ถูกกว่าถูกขัดจังหวะและถูก abort ทำให้ 2B ต้องส่งนอก loop แก้ใน PR #53: การกู้คืนเทียบกับ reviewer ตอน dispatch และ `authority abort` ปฏิเสธผลที่ยังไม่บันทึก บทเรียน: ห้ามสลับ branch ของ checkout หลักระหว่าง Prove และผลรีวิวที่เสร็จแล้วต้องบันทึก ไม่ abort

## 12. ผลหลังปรับ: artifact ใหม่และงานของ user

User ยังทำ 3 อย่างเดิมคือบอก intent, ตัดสินใจ และอนุมัติ Land สิ่งที่เพิ่มคือดูแลเกณฑ์รีวิวเป็นครั้งคราว และคัดแยก incident งานเขียนเอกสารใหม่เป็นของ agent และงานตรวจเป็นของ harness ตารางนี้เป็นแผนที่เสนอ แถวเฟส 3 จะเกิดก็ต่อเมื่ออนุมัติขอบเขตแล้ว

**Artifact ใหม่และตำแหน่ง**

| เฟส | Artifact | ตำแหน่ง | ใครสร้าง | ส่งไปโปรเจกต์ผู้ใช้ด้วยไหม |
| --- | --- | --- | --- | --- |
| 0 | `REVIEW.md` | root ของ repo | agent ร่าง, user อนุมัติ | ส่ง (เฟส 1) เป็น template ที่โปรเจกต์เป็นเจ้าของ installer ไม่เขียนทับ |
| 0 | `CODEOWNERS` | `.github/CODEOWNERS` | agent ร่าง, user อนุมัติ | ไม่ส่ง เป็นของแต่ละ repo |
| 0 | Incident record | `openspec/incidents/<id>.md` | agent | ส่งแค่ template |
| 0 | Lessons file | `openspec/lessons.md` | agent | ส่งไฟล์เปล่า |
| 2 | Agent evals | `evals/<id>.json` | agent | ใช้ใน repo นี้ก่อน (รอตัดสินใจ) |
| 2 | Regression claim | ใน `evidence.yaml` ของ change ที่เป็น hotfix | agent (compiler ตรวจ) | ส่ง เพราะเป็นส่วนของ schema |
| 3 | Maintain config | `maintain.yaml` ที่ root | agent ร่าง, service owner อนุมัติ | ส่ง ถ้าเฟส 3 อยู่ในขอบเขต |
| 3 | Roles | ฟิลด์ `roles` ใน `foundation.json` | user | ส่ง ถ้าเฟส 3 อยู่ในขอบเขต |
| 3 | Metrics view | `dashboard/` | agent | ไม่ส่ง ใช้ใน repo นี้เท่านั้น |

ไฟล์เดิมที่ต้องแก้: `EVIDENCE.md` § review, `WORKFLOW.md` § bugfix, `install.sh` (เพิ่มรายการไฟล์ที่เป็นของโปรเจกต์), เอกสารเว็บ EN/TH และ `run-all.sh` กับ `.claude/tests/README.md`

**งานของ user ก่อนและหลังปรับ**

| เรื่อง | ตอนนี้ | หลังปรับ |
| --- | --- | --- |
| Intent, ตัดสินใจ, อนุมัติ Land | user | เหมือนเดิม |
| เกณฑ์รีวิว | ไม่มี reviewer ตัดสินจาก spec อย่างเดียว | **ใหม่:** อนุมัติ `REVIEW.md` ครั้งแรก แล้วแก้เมื่อเกณฑ์เปลี่ยน |
| เมื่อมีปัญหาหลัง release | user สังเกตเองแล้วเปิด `/investigate` | **ใหม่:** agent ร่าง incident + investigation ให้ user แค่เลือกแก้เลย, นัดทีหลัง หรือปิดทิ้ง |
| Eval | ไม่มี | **ใหม่:** อนุมัติงบ eval ที่เรียก model จริง ส่วนการเขียน eval เป็นงานของ agent |
| แก้ skill หรือ hook | merge ได้เลย | ต้องให้ code owner อนุมัติผ่าน CODEOWNERS |
| บทบาท | user คนเดียวทำทุกอย่าง | ยังเป็นคนเดียวได้ แต่ receipt บันทึกว่าอนุมัติในบทบาทไหน พอทีมโตก็ย้ายบทบาทให้คนอื่นได้โดยไม่ต้องแก้ workflow |

**งานที่ user ไม่ต้องทำเพิ่ม:** เขียน incident, lessons หรือ eval, ตรวจว่ารีวิวผ่านเกณฑ์ หรือรันเทสต์ harness ตรวจว่า hotfix มี eval, REVIEW.md เปลี่ยนแล้วรีวิวเดิมถือว่าเก่า และ agent ทำได้เฉพาะสิ่งที่ระดับใน `maintain.yaml` อนุญาต

## 13. การตัดสินใจที่รอคุณ

ทุกข้อเป็นการตัดสินใจระดับ product หรือ trade-off agent จะไม่เลือกเอง คำแนะนำอยู่ในวงเล็บ

- [ ] เฟส 3 (Maintain loop และบทบาทหลายคน) อยู่ในขอบเขต Change Loop ไหม (แนะนำ: เลื่อนไปตัดสินหลังเฟส 2)
- [ ] REVIEW.md เป็นคำแนะนำหรือเกณฑ์บังคับ: ตัดสินแล้ว เป็นคำแนะนำทั้งหมด (2026-11-09)
- [ ] Hotfix ต้องมี eval ก่อน archived เป็นเงื่อนไขบังคับไหม (แนะนำ: บังคับ)
- [ ] Eval runner ship ให้โปรเจกต์ผู้ใช้ด้วยหรือใช้เฉพาะใน repo นี้ (แนะนำ: ใช้ใน repo นี้ก่อน)
- [ ] งบต่อเดือนสำหรับ eval ที่เรียก model จริง (ยังไม่มีตัวเลข ต้องให้คุณกำหนด)
- [ ] ใครรับบทบาทแต่ละตัวในหัวข้อ 9 ตอนนี้ (แนะนำ: คุณคนเดียวไปก่อน แต่บันทึกแยกบทบาท)

## 14. แหล่งอ้างอิง

- [The AI-native SDLC playbook](https://claude.com/resources/articles/the-ai-native-sdlc-playbook) (Anthropic, 21 ส.ค. 2026)
- `claude-foundation/CLAUDE.md`: แหล่งความจริง กฎเอกสาร และขอบเขต ship
- `docs/reports/harness-development-playbook.md`: lane A–E และ checklist ต่อ lane
- `WORKFLOW.md`, `.claude/harness/EVIDENCE.md`: contract ของ lifecycle, review และ receipt
- `install.sh`: การเขียนทับเฉพาะไฟล์ใน manifest (บรรทัด 235–295)
