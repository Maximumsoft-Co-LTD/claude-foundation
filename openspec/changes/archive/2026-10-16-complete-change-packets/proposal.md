# Change: เอกสาร change แบบใหม่ที่ครบทุกหัวข้อตามประเภทงาน

- **Change:** `complete-change-packets` · **Lane:** standard (impact or coupling above the rapid limit (see Impact))
- **Owner:** unassigned · **Created:** 2026-10-15 · **Status:** `claude-foundation changes`

## Why

เอกสาร change ที่ harness สร้างตอนนี้ยาวเพราะซ้ำ แต่ยังขาดหัวข้อสำคัญ เช่น error envelope, threat model, rollout, tenancy และ test strategy อีกทั้งรองรับประเภทงานแค่ 11 แบบ ผู้อนุมัติและผู้สร้างจึงต้องเดาเรื่องที่เอกสารไม่ได้บอก change นี้ทำให้ทุกงานได้เอกสารที่ครบตาม outline เดียว อ่านง่าย ไม่ซ้ำ และให้คนเขียน prose เป็น markdown ได้

## User stories

- **P1** As ผู้อนุมัติ spec, I want อ่านปัญหา ขอบเขต เกณฑ์ผ่าน และเรื่องที่ต้องตัดสินได้ในครึ่งแรกของ proposal so that อนุมัติได้โดยไม่ไล่ข้อมูลซ้ำ. Requirements: outline-contract, reader-first-order, header-clean.
- **P1** As ผู้สร้าง, I want design มีทุกหัวข้อที่ประเภทงานต้องการ เช่น contract, threat model, rollout และ test strategy so that ไม่ต้องเดาเรื่องที่เอกสารไม่ได้บอก. Requirements: required-sections, contract-fields, quality-fields, delivery-fields.
- **P1** As ผู้เขียน change, I want เขียน prose เป็น markdown แล้วให้ harness ตรวจหัวข้อ so that เขียนได้เป็นธรรมชาติโดยยังตรวจความครบได้. Requirements: v5-draft-folder, v5-prose-merge.
- **P2** As maintainer, I want ทุกประเภทงานมีหัวข้อบังคับ skill และหลักฐานของตัวเอง so that งาน infra, privacy หรือ ml ไม่ถูกตรวจเหมือน feature ทั่วไป. Requirements: work-type-catalog, work-type-routing, work-type-evidence, new-capabilities.
- **P2** As ผู้อ่าน spec ถาวร, I want เห็นเหตุผลของ decision ที่ยังมีผลใต้ requirement so that เข้าใจว่าทำไมระบบเป็นแบบนี้โดยไม่ต้องค้น change เก่า. Requirements: decision-status, rationale-in-spec.
- **P3** As ผู้อ่านภาษาไทย, I want story และ change id อ่านได้เป็นภาษาของเอกสาร so that ไม่สะดุดกับกรอบภาษาอังกฤษหรือ id ว่าง. Requirements: localized-stories, readable-change-id.

## Success criteria

- fixture ของทุกประเภทงานใน catalog คอมไพล์แล้วได้หัวข้อบังคับครบ และขาดหัวข้อใดได้ EDIT ที่ระบุชื่อ
- fixture ที่ amend สามครั้งไม่มีส่วนซ้ำใน proposal และ test ความครบผ่าน
- draft v5 ตัวอย่างคอมไพล์ได้ packet เทียบเท่า draft v4 ที่มีเนื้อหาเดียวกัน และ revise/amend ไม่ทำให้ prose หาย
- full suite ผ่าน รวม upgrade matrix และ docs consistency

## Capabilities

| Capability | Requirements | Tasks |
|---|---|---|
| change-outline-contract | One outline contract defines every packet section, Each work type requires its outline sections, Each fact has one home in the packet | T001, T003, T020 |
| hybrid-change-drafts | 7: Draft v5 is a folder with typed JSON and authored markdown, Authored prose merges with derived sections in outline order, Draft v5 passes the same intake gate as v4, Revise and amend keep authored prose, Draft v3, v4, and v5 coexist under agreed pins, Drafts warn about unknown task fields, … +1 more | T004, T022, T025, T026, T027, T028, T029, T030, T032, T033, T037 |
| typed-design-fields | 8: Design records boundaries and tenancy, Design records the domain model and modules, Contracts carry complete API, event, data, UI, and config detail, Design records quality, security, and operability, Design records delivery, rollback proof, and testing strategy, Proposals record decisions, communication, and verification steps, … +2 more | T008, T009, T010, T011, T012, T013, T014, T015, T018 |
| packet-benchmarks | The benchmark matrix covers every work type, Scorecards measure packet quality and speed | T034, T035, T036 |
| work-type-catalog | Every catalog work type is accepted and inferred, Each work type routes to its skills, Each work type requires its evidence, New gates always name an owner and a resume route | T002, T005, T006, T007 |
| evidence-capabilities | Evidence covers evaluation, release health, parity, plans, and experiments | T006 |
| durable-decisions | Decisions carry status and full options, Durable decisions become requirement rationale | T016, T017 |
| readable-change-packets | 12: Amendments update the investigation agreement in place, Proposals put reader decisions before reference material, Investigation context appears once in one appendix, Acceptance traceability uses scenario names grouped by requirement, Derived file maps state each task's responsibility once, Discovery appendix shows authored rows and summarizes derived ones, … +6 more | T019, T020, T021, T022, T023, T024, T031 |

## Scope

- **In scope:** renderer และ validator ทุกตัวใช้ outline เดียวกัน หัวข้อที่เงื่อนไขไม่เป็นจริงไม่แสดง; ทุกประเภทงานใน catalog ได้หัวข้อบังคับครบ หรือได้คำสั่งแก้ที่ชัดเจน; ไม่มีข้อความซ้ำระหว่างหัวข้อ; change start กับโฟลเดอร์ draft คอมไพล์ได้เหมือน draft ไฟล์เดียว; packet มี prose ของผู้เขียนตรงตามต้นฉบับและหัวข้อ derive อยู่ในตำแหน่งตาม outline; v5 ข้าม gate ไม่ได้; ไม่มี prose หายหรือซ้ำหลัง revise หรือ amend; consumer เดิมยังใช้ v4 ได้ และ CLI ที่ติดตั้งอยู่ใช้ runtime ใหม่ได้ทันทีหลัง Land; แต่ละ boundary มีแบบ sync/async เหตุผล timeout retry consistency staleness เจ้าของ และ correlation; tenancy มีการแยกต่อชั้น ที่มาของ tenant context การกัน noisy neighbor และ metering; design มีหัวข้อ Domain model และ module; API มี error envelope ตาราง error idempotency pagination rate limit version deprecation และ consumer; event มี delivery dedup ordering และการรับมือซ้ำ ช้า ผิดลำดับ; data มี column index invariant volume retention migration recovery และ data contract; ui มี entry info state copy i18n accessibility ACR และ validation plan; config มี type secret ค่าต่อ environment reload และ task ที่ลบ; NFR เป็น scenario ที่วัดได้ threat model มี asset trust boundary STRIDE และความเสี่ยงที่เหลือ observability มี SLI SLO alert runbook owner และ usage signal; design บอกวิธีปล่อย ถอย และทดสอบได้ครบ; proposal มีบันทึกคำตอบของผู้ใช้ แผนสื่อสาร release note และขั้นตอนตรวจด้วยตัวเอง; archive บอกได้ว่าใคร review อะไร แก้อย่างไร และใครอนุมัติ; scenario ใหม่สำหรับ library, migration, integration, config, dependency, deprecation, infra, observability, privacy, experiment, client-release, ml และ bugfix แบบ security กับ hotfix; ผลเทียบบอกได้ว่าแบบใหม่ดีขึ้นและไม่ช้าเกินเกณฑ์; bugfix มี reproduction สิ่งที่คาดกับที่เกิด root cause commit ที่ทำให้เกิด blast radius การซ่อมข้อมูล และ regression พร้อมรูปแบบย่อย security (ประเภทช่องโหว่ version ที่กระทบ disclosure advisory backport) และ hotfix (incident การบรรเทา backport follow-up); refactor, library, migration, integration, performance, dependency (รวม provenance และ SBOM), deprecation, infra, privacy, experiment, client-release และ ml (model card) มี field ตาม catalog; ประเภทงานคือ feature, bugfix, refactor, api, library, ui, data, migration, async, integration, config, performance, dependency, deprecation, infra, observability, privacy, experiment, client-release, ml, docs, test, chore; performance → performance-investigation, migration → architecture และ refactoring, dependency → delivery-engineering และ security, deprecation และ library → api-design, infra → delivery-engineering และ architecture, observability → observability-fundamentals, privacy → security, experiment → ux-ui และ observability, client-release → delivery-engineering, ml → testing และ observability, integration → architecture และ security; เช่น api ต้อง compatibility, ui ต้อง accessibility, dependency ต้อง dependency-supply-chain, infra ต้อง plan-check, migration ต้อง parity, ml ต้อง evaluation; agent และผู้ใช้ไม่ติดค้าง ผู้ใช้ถูกถามเฉพาะเรื่องความหมาย การอนุมัติ Land และสิทธิ์ภายนอก; field ที่สะกดผิดไม่ถูกเพิกเฉยเงียบ ๆ; evaluation, parity และ plan-check รันผ่าน command adapter ก่อน Land; release-health และ experiment-guardrail รับผลผ่าน external adapter หลังปล่อยงานและเป็น gate ของ rollout ใน handoff โดยไม่ขวาง proof หรือ Land; decision ที่ proposed อยู่ในเรื่องที่ต้องให้ผู้ใช้ตัดสิน และ option ที่เป็น object แสดงเป็นข้อความ; หลัง archive spec ถาวรมีเหตุผลของ decision; proposal มีส่วน investigation agreement หนึ่งชุดที่เป็นปัจจุบัน และมีประวัติการ amend หนึ่งบรรทัดต่อครั้ง; ส่วนหัว, สรุป, ทำไม, user stories, เกณฑ์สำเร็จ, ขอบเขต, capability, ผลกระทบ, เรื่องที่ต้องตัดสิน, บันทึกคำตอบ, การสื่อสาร, demo, เกณฑ์ผ่าน, Definition of done แล้วจึงเป็น appendix; appendix มีสรุป, coverage ของ requirement, คำตอบ, ตัวอย่าง, ข้อจำกัดของ experiment และ history gap ครั้งเดียว; reviewer อ่านได้ว่าแต่ละ scenario พิสูจน์ด้วยอะไรโดยไม่เจอ claim id; design สั้นลงโดยทุกไฟล์ยังอยู่ใน file map; appendix บอกครบโดยไม่พิมพ์ตารางซ้ำกับ spec; ส่วนหัวแสดง change id, lane พร้อมเหตุผลหนึ่งวลี, review tier, owner และวันที่สร้าง; story ภาษาไทยอ่านเป็นประโยคเดียว; การจัดเรียงใหม่ไม่ทำให้เนื้อหาหาย; คำเตือนไม่แนะนำให้ตัดเนื้อหาที่จำเป็นและไม่ block; intent ภาษาไทยได้ id ที่บอกเรื่อง; agent เขียน intent ไม่เกิน 70 ตัวอักษร why ไม่เกินสามประโยค และรู้ field ของประเภทงานของตน; WORKFLOW.md, README ทั้งสองภาษา, AGENTS.md, harness README, EVIDENCE.md, skill change และ website ทั้งสองภาษาตรงกัน
- **Out of scope:** edits outside `.claude/harness/runtime/workflow/validation/outline-contract.mjs`, `.claude/harness/tests/outline-contract.test.mjs`, `.claude/harness/runtime/workflow/validation/design-blueprints.mjs`, `.claude/harness/runtime/workflow/validation/dev-document.mjs`, `.claude/harness/runtime/workflow/validation/packet-overview.mjs`, `.claude/harness/runtime/evidence/test-discrimination.mjs`, … +91 more; the authored Non-goals below

## Acceptance traceability

Tasks and checks: `tasks.md`.

| Requirement › scenario | Kind | Task | Tests |
|---|---|---|---|
| outline-contract › compile | happy | T001, T020 | .claude/harness/tests/outline-contract.test.mjs, .claude/harness/tests/design-render.test.mjs |
| outline-contract › compile-2 | edge | T001, T020 | .claude/harness/tests/outline-contract.test.mjs, .claude/harness/tests/design-render.test.mjs |
| outline-contract › compile-3 | edge | T001, T020 | .claude/harness/tests/outline-contract.test.mjs, .claude/harness/tests/design-render.test.mjs |
| required-sections › change-start | happy | T003 | .claude/harness/tests/required-sections.test.mjs |
| required-sections › change-start-2 | edge | T003 | .claude/harness/tests/required-sections.test.mjs |
| required-sections › change-start-3 | failure | T003 | .claude/harness/tests/required-sections.test.mjs |
| single-home | happy | T001 | .claude/harness/tests/outline-contract.test.mjs |
| v5-draft-folder › change-start-foundation-drafts-refund-api | happy | T025 | .claude/harness/tests/draft-folder.test.mjs |
| v5-draft-folder › change-start | failure | T025 | .claude/harness/tests/draft-folder.test.mjs |
| v5-draft-folder › change-start-2 | failure | T025 | .claude/harness/tests/draft-folder.test.mjs |
| v5-draft-folder › change-start-3 | failure | T025 | .claude/harness/tests/draft-folder.test.mjs |
| v5-prose-merge › compile | happy | T026 | .claude/harness/tests/draft-folder.test.mjs |
| v5-prose-merge › change-start | failure | T026 | .claude/harness/tests/draft-folder.test.mjs |
| v5-prose-merge › change-start-2 | failure | T026 | .claude/harness/tests/draft-folder.test.mjs |
| v5-intake-gate › change-start | failure | T027 | .claude/harness/tests/semantic-intake.test.mjs |
| v5-intake-gate › new-draft | edge | T027 | .claude/harness/tests/semantic-intake.test.mjs |
| v5-revise-amend › revise-draft-requirement | happy | T022, T028 | .claude/harness/tests/amendment-invalidation.test.mjs, .claude/harness/tests/change-revise.test.mjs |
| v5-revise-amend › amend-rollout | happy | T022, T028 | .claude/harness/tests/amendment-invalidation.test.mjs, .claude/harness/tests/change-revise.test.mjs |
| v5-revise-amend › amend-outline | failure | T022, T028 | .claude/harness/tests/amendment-invalidation.test.mjs, .claude/harness/tests/change-revise.test.mjs |
| draft-versions › change-start | happy | T029, T030 | .claude/harness/tests/semantic-draft.test.mjs, .claude/harness/tests/public-command-golden.test.mjs, .claude/tests/harness/upgrade-matrix.test.mjs, .claude/tests/harness/run-upgrade-compat-tests.sh |
| draft-versions › change-start-2 | edge | T029, T030 | .claude/harness/tests/semantic-draft.test.mjs, .claude/harness/tests/public-command-golden.test.mjs, .claude/tests/harness/upgrade-matrix.test.mjs, .claude/tests/harness/run-upgrade-compat-tests.sh |
| draft-versions › claude-foundation-changes | edge | T029, T030 | .claude/harness/tests/semantic-draft.test.mjs, .claude/harness/tests/public-command-golden.test.mjs, .claude/tests/harness/upgrade-matrix.test.mjs, .claude/tests/harness/run-upgrade-compat-tests.sh |
| draft-versions › change-start-3 | failure | T029, T030 | .claude/harness/tests/semantic-draft.test.mjs, .claude/harness/tests/public-command-golden.test.mjs, .claude/tests/harness/upgrade-matrix.test.mjs, .claude/tests/harness/run-upgrade-compat-tests.sh |
| architecture-fields › compile | happy | T008 | .claude/harness/tests/architecture-fields.test.mjs |
| architecture-fields › change-start | failure | T008 | .claude/harness/tests/architecture-fields.test.mjs |
| domain-fields › compile | happy | T008 | .claude/harness/tests/architecture-fields.test.mjs |
| domain-fields › change-start | failure | T008 | .claude/harness/tests/architecture-fields.test.mjs |
| contract-fields › compile | happy | T009, T010 | .claude/harness/tests/contract-fields.test.mjs, .claude/harness/tests/design-blueprints.test.mjs |
| contract-fields › compile-2 | edge | T009, T010 | .claude/harness/tests/contract-fields.test.mjs, .claude/harness/tests/design-blueprints.test.mjs |
| contract-fields › change-start | failure | T009, T010 | .claude/harness/tests/contract-fields.test.mjs, .claude/harness/tests/design-blueprints.test.mjs |
| quality-fields › compile | happy | T011 | .claude/harness/tests/quality-fields.test.mjs |
| quality-fields › compile-2 | happy | T011 | .claude/harness/tests/quality-fields.test.mjs |
| quality-fields › change-start | failure | T011 | .claude/harness/tests/quality-fields.test.mjs |
| delivery-fields › compile | happy | T012 | .claude/harness/tests/delivery-fields.test.mjs |
| delivery-fields › change-start | failure | T012 | .claude/harness/tests/delivery-fields.test.mjs |
| process-fields › compile | happy | T015 | .claude/harness/tests/process-fields.test.mjs |
| process-fields › change-start | failure | T015 | .claude/harness/tests/process-fields.test.mjs |
| archive-appendices › land-archive | happy | T018 | .claude/harness/tests/archive-appendices.test.mjs |
| archive-appendices › archive | edge | T018 | .claude/harness/tests/archive-appendices.test.mjs |
| archive-appendices › change-start | failure | T018 | .claude/harness/tests/archive-appendices.test.mjs |
| bench-work-types › test-matrix | happy | T034, T035 | .claude/tests/bench/tasks/29-*/**, .claude/tests/bench/tasks/30-*/**, .claude/tests/bench/tasks/31-*/**, .claude/tests/bench/tasks/32-*/**, .claude/tests/bench/tasks/33-*/**, .claude/tests/bench/config/openspec-native-matrix.json, .claude/tests/bench/tests/openspec-native-matrix.test.mjs, .claude/tests/bench/tasks/34-*/**, .claude/tests/bench/tasks/35-*/**, .claude/tests/bench/tasks/36-*/**, .claude/tests/bench/tasks/37-*/**, .claude/tests/bench/tasks/38-*/**, .claude/tests/bench/tasks/39-*/**, .claude/tests/bench/tasks/40-*/**, .claude/tests/bench/tasks/41-*/** |
| bench-work-types › oracle | failure | T034, T035 | .claude/tests/bench/tasks/29-*/**, .claude/tests/bench/tasks/30-*/**, .claude/tests/bench/tasks/31-*/**, .claude/tests/bench/tasks/32-*/**, .claude/tests/bench/tasks/33-*/**, .claude/tests/bench/config/openspec-native-matrix.json, .claude/tests/bench/tests/openspec-native-matrix.test.mjs, .claude/tests/bench/tasks/34-*/**, .claude/tests/bench/tasks/35-*/**, .claude/tests/bench/tasks/36-*/**, .claude/tests/bench/tasks/37-*/**, .claude/tests/bench/tasks/38-*/**, .claude/tests/bench/tasks/39-*/**, .claude/tests/bench/tasks/40-*/**, .claude/tests/bench/tasks/41-*/** |
| bench-work-types › test-matrix-2 | edge | T034, T035 | .claude/tests/bench/tasks/29-*/**, .claude/tests/bench/tasks/30-*/**, .claude/tests/bench/tasks/31-*/**, .claude/tests/bench/tasks/32-*/**, .claude/tests/bench/tasks/33-*/**, .claude/tests/bench/config/openspec-native-matrix.json, .claude/tests/bench/tests/openspec-native-matrix.test.mjs, .claude/tests/bench/tasks/34-*/**, .claude/tests/bench/tasks/35-*/**, .claude/tests/bench/tasks/36-*/**, .claude/tests/bench/tasks/37-*/**, .claude/tests/bench/tasks/38-*/**, .claude/tests/bench/tasks/39-*/**, .claude/tests/bench/tasks/40-*/**, .claude/tests/bench/tasks/41-*/** |
| bench-packet-metrics › scorecard | happy | T036 | .claude/tests/bench/openspec-native/scorecard.mjs, .claude/tests/bench/openspec-native/quality.mjs, .claude/tests/bench/openspec-native/time-gate.mjs, .claude/tests/bench/tests/openspec-native-scorecard.test.mjs, .claude/tests/bench/tests/openspec-native-time-gate.test.mjs |
| bench-packet-metrics › 2 | failure | T036 | .claude/tests/bench/openspec-native/scorecard.mjs, .claude/tests/bench/openspec-native/quality.mjs, .claude/tests/bench/openspec-native/time-gate.mjs, .claude/tests/bench/tests/openspec-native-scorecard.test.mjs, .claude/tests/bench/tests/openspec-native-time-gate.test.mjs |
| bench-packet-metrics › 3 | edge | T036 | .claude/tests/bench/openspec-native/scorecard.mjs, .claude/tests/bench/openspec-native/quality.mjs, .claude/tests/bench/openspec-native/time-gate.mjs, .claude/tests/bench/tests/openspec-native-scorecard.test.mjs, .claude/tests/bench/tests/openspec-native-time-gate.test.mjs |
| work-type-detail-fields › compile | happy | T013, T014 | .claude/harness/tests/work-type-fields.test.mjs |
| work-type-detail-fields › compile-2 | happy | T013, T014 | .claude/harness/tests/work-type-fields.test.mjs |
| work-type-detail-fields › change-start | failure | T013, T014 | .claude/harness/tests/work-type-fields.test.mjs |
| work-type-detail-fields › compile-3 | edge | T013, T014 | .claude/harness/tests/work-type-fields.test.mjs |
| work-type-catalog › change-start | happy | T002 | .claude/harness/tests/design-blueprints.test.mjs, .claude/harness/tests/test-discrimination.test.mjs |
| work-type-catalog › compile | happy | T002 | .claude/harness/tests/design-blueprints.test.mjs, .claude/harness/tests/test-discrimination.test.mjs |
| work-type-catalog › change-start-2 | failure | T002 | .claude/harness/tests/design-blueprints.test.mjs, .claude/harness/tests/test-discrimination.test.mjs |
| work-type-routing › advance-build | happy | T005 | .claude/harness/tests/skill-routing.test.mjs |
| work-type-routing › advance | edge | T005 | .claude/harness/tests/skill-routing.test.mjs |
| work-type-evidence › compile | happy | T007 | .claude/harness/tests/change-policy-surface.test.mjs |
| work-type-evidence › prove | failure | T007 | .claude/harness/tests/change-policy-surface.test.mjs |
| gates-always-resumable › change-start | happy | T006, T007 | .claude/harness/tests/required-providers.test.mjs, .claude/harness/tests/new-capabilities.test.mjs, .claude/harness/tests/change-policy-surface.test.mjs |
| gates-always-resumable › prove-land | happy | T006, T007 | .claude/harness/tests/required-providers.test.mjs, .claude/harness/tests/new-capabilities.test.mjs, .claude/harness/tests/change-policy-surface.test.mjs |
| gates-always-resumable › change-start-2 | edge | T006, T007 | .claude/harness/tests/required-providers.test.mjs, .claude/harness/tests/new-capabilities.test.mjs, .claude/harness/tests/change-policy-surface.test.mjs |
| gates-always-resumable › test-gate | failure | T006, T007 | .claude/harness/tests/required-providers.test.mjs, .claude/harness/tests/new-capabilities.test.mjs, .claude/harness/tests/change-policy-surface.test.mjs |
| unknown-task-fields › change-start | happy | T004 | .claude/harness/tests/semantic-draft.test.mjs |
| unknown-task-fields › change-start-2 | edge | T004 | .claude/harness/tests/semantic-draft.test.mjs |
| new-capabilities › prove | happy | T006 | .claude/harness/tests/required-providers.test.mjs, .claude/harness/tests/new-capabilities.test.mjs |
| new-capabilities › prove-2 | failure | T006 | .claude/harness/tests/required-providers.test.mjs, .claude/harness/tests/new-capabilities.test.mjs |
| new-capabilities › prove-3 | edge | T006 | .claude/harness/tests/required-providers.test.mjs, .claude/harness/tests/new-capabilities.test.mjs |
| decision-status › compile | happy | T016 | .claude/harness/tests/durable-decision-metadata.test.mjs |
| decision-status › compile-2 | edge | T016 | .claude/harness/tests/durable-decision-metadata.test.mjs |
| decision-status › change-start | failure | T016 | .claude/harness/tests/durable-decision-metadata.test.mjs |
| rationale-in-spec › compile | happy | T016, T017 | .claude/harness/tests/durable-decision-metadata.test.mjs, .claude/harness/tests/apply-runtime-archive.test.mjs |
| rationale-in-spec › land-archive | happy | T016, T017 | .claude/harness/tests/durable-decision-metadata.test.mjs, .claude/harness/tests/apply-runtime-archive.test.mjs |
| rationale-in-spec › compile-2 | edge | T016, T017 | .claude/harness/tests/durable-decision-metadata.test.mjs, .claude/harness/tests/apply-runtime-archive.test.mjs |
| amendment-replaces › amend | happy | T022 | .claude/harness/tests/amendment-invalidation.test.mjs |
| amendment-replaces › amend-2 | edge | T022 | .claude/harness/tests/amendment-invalidation.test.mjs |
| amendment-replaces › amend-3 | edge | T022 | .claude/harness/tests/amendment-invalidation.test.mjs |
| reader-first-order › compile-draft | happy | T019 | .claude/harness/tests/reader-guide.test.mjs |
| reader-first-order › compile | edge | T019 | .claude/harness/tests/reader-guide.test.mjs |
| investigation-once › compile | happy | T019 | .claude/harness/tests/reader-guide.test.mjs |
| investigation-once › compile-2 | edge | T019 | .claude/harness/tests/reader-guide.test.mjs |
| readable-traceability › compile-draft-scenario | happy | T021 | .claude/harness/tests/reader-guide.test.mjs |
| readable-traceability › compile | happy | T021 | .claude/harness/tests/reader-guide.test.mjs |
| readable-traceability › compile-2 | edge | T021 | .claude/harness/tests/reader-guide.test.mjs |
| file-map-once › compile | happy | T020 | .claude/harness/tests/design-render.test.mjs |
| file-map-once › compile-2 | edge | T020 | .claude/harness/tests/design-render.test.mjs |
| discovery-authored-first | happy | T019 | .claude/harness/tests/reader-guide.test.mjs |
| header-clean › compile | happy | T019 | .claude/harness/tests/reader-guide.test.mjs |
| header-clean › compile-change-standard | happy | T019 | .claude/harness/tests/reader-guide.test.mjs |
| localized-stories › compile | happy | T019 | .claude/harness/tests/reader-guide.test.mjs |
| localized-stories › compile-2 | edge | T019 | .claude/harness/tests/reader-guide.test.mjs |
| completeness-guard › compile | happy | T024 | .claude/harness/tests/change-draft-materialization.test.mjs, .claude/harness/tests/fixtures/complete-packets/** |
| completeness-guard › test | failure | T024 | .claude/harness/tests/change-draft-materialization.test.mjs, .claude/harness/tests/fixtures/complete-packets/** |
| complete-budgets › validate | happy | T023 | .claude/harness/tests/change-validation-phases.test.mjs, .claude/harness/tests/change-atomic-start.test.mjs |
| complete-budgets › validate-2 | failure | T023 | .claude/harness/tests/change-validation-phases.test.mjs, .claude/harness/tests/change-atomic-start.test.mjs |
| readable-change-id › change-start | happy | T023 | .claude/harness/tests/change-validation-phases.test.mjs, .claude/harness/tests/change-atomic-start.test.mjs |
| readable-change-id › change-start-2 | edge | T023 | .claude/harness/tests/change-validation-phases.test.mjs, .claude/harness/tests/change-atomic-start.test.mjs |
| writing-guidance-template | happy | T031 | .claude/harness/tests/semantic-draft.test.mjs |
| docs-describe-packets › docs-consistency | happy | T032, T033, T037 | .claude/tests/run-all.sh |
| docs-describe-packets › docs-consistency-2 | failure | T032, T033, T037 | .claude/tests/run-all.sh |

## Definition of done

- Fresh evidence for every claim (98).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (high tier, configured model).
- Land archives it; Land never commits.
- Success: หัวข้อบังคับที่ขาดใน fixture ทุกประเภทงาน = 0 และส่วนซ้ำใน proposal = 0.

## Impact

- **Impact:** high
- **Coupling:** coupled
- **Affected surfaces:** code
- **Security triggers:** none detected

## Constraints

- ส่งมอบทั้งหมดใน change เดียว
- change นี้เขียนด้วย draft v4 เพราะ runtime ที่ root เป็นตัวคอมไพล์ change นี้
- draft v3 และ v4 ยังคอมไพล์ได้ และ change ที่กำลังทำอยู่ยัง validate ผ่าน
- ไม่เปลี่ยนโครงสร้างที่ parser ใช้: หัวข้อ delta ของ spec, Requirement:, Scenario:, GIVEN/WHEN/THEN/AND, SHALL, tag ใน tasks.md, บรรทัด Lane และ Review
- ไม่ตัดเนื้อหาที่ผู้เขียนให้มา
- ไม่เขียนข้อมูลที่เปลี่ยนหลังอนุมัติลงใน packet ก่อน Land เพราะ agreement identity ครอบทุกไฟล์
- ไม่เพิ่ม dependency ภายนอกใน runtime

## Non-goals

- ไม่ render packet ที่ archive ไปแล้วใหม่
- ไม่แยก metadata ของ task ใน tasks.md เป็นหลายบรรทัด
- ไม่แก้เอกสาร slicing ใน docs/openspec-native-harness.md ที่ไม่ตรงกับ runtime
- ไม่ release ใน change นี้ ทำหลัง Land; paid e2e ไม่ใช่ task แต่เป็นขั้น acceptance หลัง Prove ก่อน Land ตาม decision paid-acceptance
- ไม่สร้าง ADR store แยก

## Derived by harness

- **Failure matrix:** read from the failure scenarios (27); recovery is "No separate step; the outcome is the handling" where unstated.
- **Evidence capabilities:** defaulted to `test` (`static-analysis` for docs/chore) for outline-contract, required-sections, single-home, v5-draft-folder, v5-prose-merge, v5-intake-gate, v5-revise-amend, draft-versions, architecture-fields, domain-fields, contract-fields, quality-fields, delivery-fields, process-fields, archive-appendices, bench-work-types, bench-packet-metrics, work-type-detail-fields, work-type-catalog, work-type-routing, work-type-evidence, gates-always-resumable, unknown-task-fields, new-capabilities, decision-status, rationale-in-spec, amendment-replaces, reader-first-order, investigation-once, readable-traceability, file-map-once, discovery-authored-first, header-clean, localized-stories, completeness-guard, complete-budgets, readable-change-id, writing-guidance-template.

## Investigation handoff

- **ID:** hybrid-packets-impact
- **Outcome:** ready-for-change
- **Summary:** พร้อมเปิด change เดียวที่เขียนด้วย draft v4 (เพราะ runtime ที่ root คอมไพล์ตัว change เอง) ขนาดราว 35-45 task ที่แต่ละ task แคบพอให้ packet ไม่เกิน 20 KB; กลไก v5: โฟลเดอร์ draft มี change.json + proposal.md + design.md ที่คนเขียน, harness ตรวจหัวข้อตาม outline แล้วรวมกับส่วน derive; ต้องแก้ intake gate, check version ราว 40 จุด, revise/amend ให้รักษา prose, pin protocol/runtime ทั้ง 4 จุด, capability ใหม่ 5 ตัว, รวม LIGHT_WORK 3 ชุด และให้ Rationale อยู่ใน requirement ของ spec delta

## ความครบของ requirement จาก Investigate

| Source | Requirement | Targets |
|---|---|---|
| single-change@1 | ส่งมอบทั้งหมดใน change เดียว | constraint: ส่งมอบทั้งหมดใน change เดียว; design: single-change-v4-authored |
| fold-reader-first@1 | change ใหม่ต้องรวม requirement และ task ของ change reader-first ที่ปิดไป (amendment แทนที่, ลำดับ proposal, investigation appendix เดียว, ส่วนหัวสะอาด, traceability ชื่อ scenario, file map ครั้งเดียว, story ตามภาษา, ความครบ, budget ใหม่) | requirement: amendment-replaces; requirement: reader-first-order; requirement: investigation-once; requirement: header-clean; requirement: readable-traceability; requirement: file-map-once; requirement: localized-stories; requirement: completeness-guard; requirement: complete-budgets; requirement: readable-change-id |
| roadmap-intent@1 | ขอบเขตตาม changeIntent ของ investigation roadmap-after-pstack และ openspec/investigations/change-doc-outline.md | requirement: outline-contract; requirement: v5-draft-folder; requirement: work-type-catalog; requirement: new-capabilities; requirement: rationale-in-spec; requirement: contract-fields |

ลิงก์นี้ตรวจความครบเชิงโครงสร้าง Agent ต้องตรวจความหมายกับต้นทางก่อนเสนออนุมัติ spec

## Appendix: discovery coverage

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| operability | covered | required-sections, new-capabilities, complete-budgets |  | budget, EDIT ที่ระบุ field, และ capability ใหม่ที่ปิดกั้น proof พร้อมวิธีตั้ง provider |
| verification | covered | completeness-guard, draft-versions, docs-describe-packets |  | ทุก task มี verify เป็น node --test หรือ docs consistency ที่ fail เมื่อพฤติกรรมผิด และ test ความครบครอบ v4 และ v5 |
| recoverability | covered | draft-versions, v5-revise-amend |  | v3/v4 ยังคอมไพล์ได้, amend ปฏิเสธหัวข้อไม่รู้จักโดยไม่แก้ packet, และ pin ไม่ตรงถูกปฏิเสธพร้อมเหตุผล |
| current-behavior | covered (derived) |  |  | Derived from currentState |
| affected-actor | covered (derived) | 17: outline-contract, reader-first-order, header-clean, required-sections, contract-fields, quality-fields, … +11 more |  | Derived from userStories |
| desired-behavior | covered (derived) | 39: outline-contract, required-sections, single-home, v5-draft-folder, v5-prose-merge, v5-intake-gate, … +33 more |  | Derived from requirements |
| success-path | covered (derived) | 38: outline-contract, required-sections, single-home, v5-draft-folder, v5-prose-merge, v5-revise-amend, … +32 more |  | Derived from requirements[].scenarios kind:success |
| failure-path | covered (derived) | 24: required-sections, v5-draft-folder, v5-prose-merge, v5-intake-gate, v5-revise-amend, draft-versions, … +18 more |  | Derived from requirements[].scenarios kind:failure |
| input-boundary | covered (derived) | 22: outline-contract, required-sections, v5-intake-gate, draft-versions, contract-fields, archive-appendices, … +16 more |  | Derived from requirements[].scenarios kind:boundary |
| compatibility | covered (derived) |  |  | Derived from compatibility |
| non-goals | covered (derived) |  |  | Derived from nonGoals |

## Appendix: investigation provenance

- **Change intent:** ส่งมอบ hybrid change packets ใน change เดียว: (1) outline contract เดียวตาม openspec/investigations/change-doc-outline.md ที่กำหนดหัวข้อ ลำดับ เงื่อนไข และบ้านของทุก field; (2) draft v5 คู่กับ v4: โฟลเดอร์ draft มี change.json (typed) + proposal.md + design.md ที่คนเขียนตามหัวข้อ outline; harness ตรวจหัวข้อ ลำดับ ความครบ ความซ้ำ แล้วรวมกับส่วน derive เป็น packet; revise และ amend รักษา prose และ amend แก้ design ได้; intake gate และ check version ครอบคลุม v5; (3) field typed ใหม่ตาม outline รวม nfr และ observability ที่ derive grounding; (4) ประเภทงานครบตาม Work type catalog พร้อมการอนุมาน path, skill routing, หัวข้อบังคับ, การผูก evidence และรวม LIGHT_WORK ให้เป็นชุดเดียวที่รวม test; (5) capability ใหม่ evaluation, release-health (crash-free), parity, plan-check, experiment-guardrail; (6) ADR แบบ (ก): decision มีสถานะ และ decision ที่ durable เป็น Rationale ใน requirement ของ spec delta; (7) แก้ renderer จาก change reader-first ที่ปิดไป: amendment แทนที่, ลำดับ proposal, investigation appendix เดียว, ส่วนหัวสะอาด, traceability ชื่อ scenario, file map ครั้งเดียว, story และ id ภาษาไทย, rejected options, budget 1200/2000/1200 และ 2400/3600/2400 พร้อมคำเตือนใหม่; (8) pin protocol และ runtime API ทั้ง 4 จุด, template, เอกสาร EN/TH, website และ upgrade matrix; change นี้เขียนด้วย draft v4
- **State:** .foundation/investigations/hybrid-packets-impact.json @ a925458bc2817480272ee6c8d3b2bf969238f199caff83e74fc7ebda5984312e
- **Sources:** sha256:8f923dab2b64925f4dc022d904db4e51ceb55e107e8c0f4820d076dab3c9677c
## บริบทที่รับจาก Investigate

เป้าหมาย: เตรียมข้อมูลให้เปิด change เดียวที่ส่งมอบ outline contract, hybrid authoring, field ใหม่, ประเภทงานครบตาม catalog, ADR แบบ (ก), แก้ renderer และ budget

ผลลัพธ์ที่ต้องการ: แผนที่โค้ดที่กระทบพร้อม path, กลไก draft v5 ที่ผู้ใช้เลือกแล้ว, ข้อสรุปว่าขนาด change เดียวรับได้ และ change intent ที่พร้อมส่งต่อ


### ขอบเขตและผู้เกี่ยวข้อง

- draft compile pipeline
- renderer
- amendment
- archive
- work types
- evidence capabilities
- budgets
- docs EN/TH
- website
- schemas
- protocol pins
- tests
- maintainer
- consumer agent
- ผู้อนุมัติ spec

### ข้อกำหนดและประวัติการแก้ไข

- **single-change@1** [constraint / stated / user]: ส่งมอบทั้งหมดใน change เดียว
- **fold-reader-first@1** [behavior / stated / user]: change ใหม่ต้องรวม requirement และ task ของ change reader-first ที่ปิดไป (amendment แทนที่, ลำดับ proposal, investigation appendix เดียว, ส่วนหัวสะอาด, traceability ชื่อ scenario, file map ครั้งเดียว, story ตามภาษา, ความครบ, budget ใหม่)
- **roadmap-intent@1** [behavior / stated / user]: ขอบเขตตาม changeIntent ของ investigation roadmap-after-pstack และ openspec/investigations/change-doc-outline.md

### คำถามและการตัดสินใจ

- q-v5-layout [answered]: draft v5 เก็บ prose ที่คนเขียนไว้ที่ไหน → ไฟล์ .md ในโฟลเดอร์ draft: change.json + proposal.md + design.md ตามหัวข้อ outline แล้ว harness ตรวจและรวมเป็น packet
- q-typed-format [answered]: ส่วน typed ของ v5 เป็น JSON (ใช้ parser เดิม) หรือ YAML (ต้องเพิ่ม parser) → JSON
- q-new-capabilities [answered]: หลักฐานที่ยังไม่มี capability (ml evaluation, crash-free, parity, plan check, experiment guardrail) จะทำอย่างไร → เพิ่ม capability ใหม่สำหรับ ml evaluation, crash-free rate, parity, plan check และ experiment guardrail
- q-nfr-home [answered]: nfr และ observability ของ v5 อยู่ที่ไหน → อยู่ใน change.json ของ v5 แล้ว harness derive grounding; v4 ใช้ grounding v2 ตามเดิม

### สาระจากบทสนทนา

- u1 [user]: เปิด change เลยได้ไหม ต้องการเปิด change เดียว ต้องปิด change อะไรก่อนไหม หรือ investigate ครบหรือยังและรู้หรือยังต้องปรับอะไรบ้าง (session message)
- u2 [user]: ปิด change ตามทาง ก แล้ว investigate ต่อเลย (session message)
- u3 [user]: v5 prose: ไฟล์ .md ในโฟลเดอร์ draft; typed: JSON; หลักฐานที่ยังไม่มี: เพิ่ม capability ใหม่; nfr/observability: ใน change.json แล้ว derive grounding (AskUserQuestion answers)



## Latest amended investigation agreement

## ความครบของ requirement จาก Investigate

| Source | Requirement | Targets |
|---|---|---|
| single-change@1 | ส่งมอบทั้งหมดใน change เดียว | constraint: ส่งมอบทั้งหมดใน change เดียว; design: single-change-v4-authored |
| fold-reader-first@1 | change ใหม่ต้องรวม requirement และ task ของ change reader-first ที่ปิดไป (amendment แทนที่, ลำดับ proposal, investigation appendix เดียว, ส่วนหัวสะอาด, traceability ชื่อ scenario, file map ครั้งเดียว, story ตามภาษา, ความครบ, budget ใหม่) | requirement: amendment-replaces; requirement: reader-first-order; requirement: investigation-once; requirement: header-clean; requirement: readable-traceability; requirement: file-map-once; requirement: localized-stories; requirement: completeness-guard; requirement: complete-budgets; requirement: readable-change-id |
| roadmap-intent@1 | ขอบเขตตาม changeIntent ของ investigation roadmap-after-pstack และ openspec/investigations/change-doc-outline.md | requirement: outline-contract; requirement: v5-draft-folder; requirement: work-type-catalog; requirement: new-capabilities; requirement: rationale-in-spec; requirement: contract-fields |

ลิงก์นี้ตรวจความครบเชิงโครงสร้าง Agent ต้องตรวจความหมายกับต้นทางก่อนเสนออนุมัติ spec
## บริบทที่รับจาก Investigate

เป้าหมาย: เตรียมข้อมูลให้เปิด change เดียวที่ส่งมอบ outline contract, hybrid authoring, field ใหม่, ประเภทงานครบตาม catalog, ADR แบบ (ก), แก้ renderer และ budget

ผลลัพธ์ที่ต้องการ: แผนที่โค้ดที่กระทบพร้อม path, กลไก draft v5 ที่ผู้ใช้เลือกแล้ว, ข้อสรุปว่าขนาด change เดียวรับได้ และ change intent ที่พร้อมส่งต่อ


### ขอบเขตและผู้เกี่ยวข้อง

- draft compile pipeline
- renderer
- amendment
- archive
- work types
- evidence capabilities
- budgets
- docs EN/TH
- website
- schemas
- protocol pins
- tests
- maintainer
- consumer agent
- ผู้อนุมัติ spec

### ข้อกำหนดและประวัติการแก้ไข

- **single-change@1** [constraint / stated / user]: ส่งมอบทั้งหมดใน change เดียว
- **fold-reader-first@1** [behavior / stated / user]: change ใหม่ต้องรวม requirement และ task ของ change reader-first ที่ปิดไป (amendment แทนที่, ลำดับ proposal, investigation appendix เดียว, ส่วนหัวสะอาด, traceability ชื่อ scenario, file map ครั้งเดียว, story ตามภาษา, ความครบ, budget ใหม่)
- **roadmap-intent@1** [behavior / stated / user]: ขอบเขตตาม changeIntent ของ investigation roadmap-after-pstack และ openspec/investigations/change-doc-outline.md

### คำถามและการตัดสินใจ

- q-v5-layout [answered]: draft v5 เก็บ prose ที่คนเขียนไว้ที่ไหน → ไฟล์ .md ในโฟลเดอร์ draft: change.json + proposal.md + design.md ตามหัวข้อ outline แล้ว harness ตรวจและรวมเป็น packet
- q-typed-format [answered]: ส่วน typed ของ v5 เป็น JSON (ใช้ parser เดิม) หรือ YAML (ต้องเพิ่ม parser) → JSON
- q-new-capabilities [answered]: หลักฐานที่ยังไม่มี capability (ml evaluation, crash-free, parity, plan check, experiment guardrail) จะทำอย่างไร → เพิ่ม capability ใหม่สำหรับ ml evaluation, crash-free rate, parity, plan check และ experiment guardrail
- q-nfr-home [answered]: nfr และ observability ของ v5 อยู่ที่ไหน → อยู่ใน change.json ของ v5 แล้ว harness derive grounding; v4 ใช้ grounding v2 ตามเดิม

### สาระจากบทสนทนา

- u1 [user]: เปิด change เลยได้ไหม ต้องการเปิด change เดียว ต้องปิด change อะไรก่อนไหม หรือ investigate ครบหรือยังและรู้หรือยังต้องปรับอะไรบ้าง (session message)
- u2 [user]: ปิด change ตามทาง ก แล้ว investigate ต่อเลย (session message)
- u3 [user]: v5 prose: ไฟล์ .md ในโฟลเดอร์ draft; typed: JSON; หลักฐานที่ยังไม่มี: เพิ่ม capability ใหม่; nfr/observability: ใน change.json แล้ว derive grounding (AskUserQuestion answers)


## Latest amended investigation agreement

## ความครบของ requirement จาก Investigate

| Source | Requirement | Targets |
|---|---|---|
| single-change@1 | ส่งมอบทั้งหมดใน change เดียว | constraint: ส่งมอบทั้งหมดใน change เดียว; design: single-change-v4-authored |
| fold-reader-first@1 | change ใหม่ต้องรวม requirement และ task ของ change reader-first ที่ปิดไป (amendment แทนที่, ลำดับ proposal, investigation appendix เดียว, ส่วนหัวสะอาด, traceability ชื่อ scenario, file map ครั้งเดียว, story ตามภาษา, ความครบ, budget ใหม่) | requirement: amendment-replaces; requirement: reader-first-order; requirement: investigation-once; requirement: header-clean; requirement: readable-traceability; requirement: file-map-once; requirement: localized-stories; requirement: completeness-guard; requirement: complete-budgets; requirement: readable-change-id |
| roadmap-intent@1 | ขอบเขตตาม changeIntent ของ investigation roadmap-after-pstack และ openspec/investigations/change-doc-outline.md | requirement: outline-contract; requirement: v5-draft-folder; requirement: work-type-catalog; requirement: new-capabilities; requirement: rationale-in-spec; requirement: contract-fields |

ลิงก์นี้ตรวจความครบเชิงโครงสร้าง Agent ต้องตรวจความหมายกับต้นทางก่อนเสนออนุมัติ spec
## บริบทที่รับจาก Investigate

เป้าหมาย: เตรียมข้อมูลให้เปิด change เดียวที่ส่งมอบ outline contract, hybrid authoring, field ใหม่, ประเภทงานครบตาม catalog, ADR แบบ (ก), แก้ renderer และ budget

ผลลัพธ์ที่ต้องการ: แผนที่โค้ดที่กระทบพร้อม path, กลไก draft v5 ที่ผู้ใช้เลือกแล้ว, ข้อสรุปว่าขนาด change เดียวรับได้ และ change intent ที่พร้อมส่งต่อ


### ขอบเขตและผู้เกี่ยวข้อง

- draft compile pipeline
- renderer
- amendment
- archive
- work types
- evidence capabilities
- budgets
- docs EN/TH
- website
- schemas
- protocol pins
- tests
- maintainer
- consumer agent
- ผู้อนุมัติ spec

### ข้อกำหนดและประวัติการแก้ไข

- **single-change@1** [constraint / stated / user]: ส่งมอบทั้งหมดใน change เดียว
- **fold-reader-first@1** [behavior / stated / user]: change ใหม่ต้องรวม requirement และ task ของ change reader-first ที่ปิดไป (amendment แทนที่, ลำดับ proposal, investigation appendix เดียว, ส่วนหัวสะอาด, traceability ชื่อ scenario, file map ครั้งเดียว, story ตามภาษา, ความครบ, budget ใหม่)
- **roadmap-intent@1** [behavior / stated / user]: ขอบเขตตาม changeIntent ของ investigation roadmap-after-pstack และ openspec/investigations/change-doc-outline.md

### คำถามและการตัดสินใจ

- q-v5-layout [answered]: draft v5 เก็บ prose ที่คนเขียนไว้ที่ไหน → ไฟล์ .md ในโฟลเดอร์ draft: change.json + proposal.md + design.md ตามหัวข้อ outline แล้ว harness ตรวจและรวมเป็น packet
- q-typed-format [answered]: ส่วน typed ของ v5 เป็น JSON (ใช้ parser เดิม) หรือ YAML (ต้องเพิ่ม parser) → JSON
- q-new-capabilities [answered]: หลักฐานที่ยังไม่มี capability (ml evaluation, crash-free, parity, plan check, experiment guardrail) จะทำอย่างไร → เพิ่ม capability ใหม่สำหรับ ml evaluation, crash-free rate, parity, plan check และ experiment guardrail
- q-nfr-home [answered]: nfr และ observability ของ v5 อยู่ที่ไหน → อยู่ใน change.json ของ v5 แล้ว harness derive grounding; v4 ใช้ grounding v2 ตามเดิม

### สาระจากบทสนทนา

- u1 [user]: เปิด change เลยได้ไหม ต้องการเปิด change เดียว ต้องปิด change อะไรก่อนไหม หรือ investigate ครบหรือยังและรู้หรือยังต้องปรับอะไรบ้าง (session message)
- u2 [user]: ปิด change ตามทาง ก แล้ว investigate ต่อเลย (session message)
- u3 [user]: v5 prose: ไฟล์ .md ในโฟลเดอร์ draft; typed: JSON; หลักฐานที่ยังไม่มี: เพิ่ม capability ใหม่; nfr/observability: ใน change.json แล้ว derive grounding (AskUserQuestion answers)


## Latest amended investigation agreement

## ความครบของ requirement จาก Investigate

| Source | Requirement | Targets |
|---|---|---|
| single-change@1 | ส่งมอบทั้งหมดใน change เดียว | constraint: ส่งมอบทั้งหมดใน change เดียว; design: single-change-v4-authored |
| fold-reader-first@1 | change ใหม่ต้องรวม requirement และ task ของ change reader-first ที่ปิดไป (amendment แทนที่, ลำดับ proposal, investigation appendix เดียว, ส่วนหัวสะอาด, traceability ชื่อ scenario, file map ครั้งเดียว, story ตามภาษา, ความครบ, budget ใหม่) | requirement: amendment-replaces; requirement: reader-first-order; requirement: investigation-once; requirement: header-clean; requirement: readable-traceability; requirement: file-map-once; requirement: localized-stories; requirement: completeness-guard; requirement: complete-budgets; requirement: readable-change-id |
| roadmap-intent@1 | ขอบเขตตาม changeIntent ของ investigation roadmap-after-pstack และ openspec/investigations/change-doc-outline.md | requirement: outline-contract; requirement: v5-draft-folder; requirement: work-type-catalog; requirement: new-capabilities; requirement: rationale-in-spec; requirement: contract-fields |

ลิงก์นี้ตรวจความครบเชิงโครงสร้าง Agent ต้องตรวจความหมายกับต้นทางก่อนเสนออนุมัติ spec
## บริบทที่รับจาก Investigate

เป้าหมาย: เตรียมข้อมูลให้เปิด change เดียวที่ส่งมอบ outline contract, hybrid authoring, field ใหม่, ประเภทงานครบตาม catalog, ADR แบบ (ก), แก้ renderer และ budget

ผลลัพธ์ที่ต้องการ: แผนที่โค้ดที่กระทบพร้อม path, กลไก draft v5 ที่ผู้ใช้เลือกแล้ว, ข้อสรุปว่าขนาด change เดียวรับได้ และ change intent ที่พร้อมส่งต่อ


### ขอบเขตและผู้เกี่ยวข้อง

- draft compile pipeline
- renderer
- amendment
- archive
- work types
- evidence capabilities
- budgets
- docs EN/TH
- website
- schemas
- protocol pins
- tests
- maintainer
- consumer agent
- ผู้อนุมัติ spec

### ข้อกำหนดและประวัติการแก้ไข

- **single-change@1** [constraint / stated / user]: ส่งมอบทั้งหมดใน change เดียว
- **fold-reader-first@1** [behavior / stated / user]: change ใหม่ต้องรวม requirement และ task ของ change reader-first ที่ปิดไป (amendment แทนที่, ลำดับ proposal, investigation appendix เดียว, ส่วนหัวสะอาด, traceability ชื่อ scenario, file map ครั้งเดียว, story ตามภาษา, ความครบ, budget ใหม่)
- **roadmap-intent@1** [behavior / stated / user]: ขอบเขตตาม changeIntent ของ investigation roadmap-after-pstack และ openspec/investigations/change-doc-outline.md

### คำถามและการตัดสินใจ

- q-v5-layout [answered]: draft v5 เก็บ prose ที่คนเขียนไว้ที่ไหน → ไฟล์ .md ในโฟลเดอร์ draft: change.json + proposal.md + design.md ตามหัวข้อ outline แล้ว harness ตรวจและรวมเป็น packet
- q-typed-format [answered]: ส่วน typed ของ v5 เป็น JSON (ใช้ parser เดิม) หรือ YAML (ต้องเพิ่ม parser) → JSON
- q-new-capabilities [answered]: หลักฐานที่ยังไม่มี capability (ml evaluation, crash-free, parity, plan check, experiment guardrail) จะทำอย่างไร → เพิ่ม capability ใหม่สำหรับ ml evaluation, crash-free rate, parity, plan check และ experiment guardrail
- q-nfr-home [answered]: nfr และ observability ของ v5 อยู่ที่ไหน → อยู่ใน change.json ของ v5 แล้ว harness derive grounding; v4 ใช้ grounding v2 ตามเดิม

### สาระจากบทสนทนา

- u1 [user]: เปิด change เลยได้ไหม ต้องการเปิด change เดียว ต้องปิด change อะไรก่อนไหม หรือ investigate ครบหรือยังและรู้หรือยังต้องปรับอะไรบ้าง (session message)
- u2 [user]: ปิด change ตามทาง ก แล้ว investigate ต่อเลย (session message)
- u3 [user]: v5 prose: ไฟล์ .md ในโฟลเดอร์ draft; typed: JSON; หลักฐานที่ยังไม่มี: เพิ่ม capability ใหม่; nfr/observability: ใน change.json แล้ว derive grounding (AskUserQuestion answers)
