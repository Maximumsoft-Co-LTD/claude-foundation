# Related projects research — 2026-09-05

รายงานสำรวจเพื่อเลือกแนวคิดมาพัฒนา Change Loop ต่อ เป็นข้อเสนอสำหรับ investigation ไม่ใช่ implementation plan ที่อนุมัติแล้ว

ฐานเปรียบเทียบ: Change Loop v3.5.8, checkout `b95140a7c3cc52fff0d1a28e9923b9e94afec75c` โดยอ่าน [README](../../README.md), [maintainer guide](../../CLAUDE.md), [evidence contract](../../.claude/harness/EVIDENCE.md), [host contracts](../../.claude/harness/runtime/contracts/README.md) และตรวจบางส่วนของ runtime/รายการ tests

วิธีศึกษา: ค้นเว็บแล้วอ่าน repository, เอกสารเจ้าของโครงการ และ PR ต้นทางผ่าน BrowserOS neo ณ วันที่ข้างต้น ไม่ได้ติดตั้งหรือ benchmark โครงการอื่น และไม่ได้ audit source ทุกโครงการ ข้อความว่า “มี” หมายถึงมีเอกสารหรือ implementation record รองรับ ไม่ใช่ผลทดสอบของเราเอง; สิ่งที่ยังไม่พบไม่เท่ากับไม่มี

## ข้อค้นพบหลัก

มีโครงการในทิศทางเดียวกับเราชัดเจน โดยเฉพาะ **bmad-loop, Atomic และ DoorDash Agentic Orchestrator** การใช้ deterministic orchestration, verification และ durable state จึงไม่ใช่ความแตกต่างเฉพาะตัวของ Change Loop อีกต่อไป

พื้นที่ที่เราควรรักษาและพิสูจน์ให้ชัดคือการรวม OpenSpec agreement, หลักฐานที่ผูกกับเนื้อหาจริง, selective invalidation และ recoverable multi-repository Land ซึ่งส่งมอบเป็น uncommitted diff โดยรักษา HEAD/index และแยก Git/external authority จากการอนุญาต Land ดู contract ใน [README](../../README.md) และ [WORKFLOW](../../WORKFLOW.md)

นี่เป็นข้อสังเคราะห์จากกลุ่มที่สำรวจ ไม่ใช่คำยืนยันว่าไม่มีโครงการอื่นทำได้ และความเข้มของ contract ยังต้องแยกจากความง่ายในการใช้งานจริง

## โครงการที่ควรศึกษา

| โครงการ / แหล่งต้นทาง | ส่วนที่ใกล้เรา | แนวคิดที่นำมาต่อยอดได้ | ขอบเขตหรือความต่างที่ต้องรักษา |
| --- | --- | --- | --- |
| [bmad-loop](https://github.com/bmad-code-org/bmad-loop) | Python คุม story selection, retries, gates และ completion; agent ทำ creative work; เก็บ state ลงดิสก์และตรวจ artifacts/test/lint | structured event/result contract, journal + decision queue, diagnostic bundle ที่ตัดข้อมูลอ่อนไหว | early open beta; ใช้ BMAD; worktree เป็นตัวเลือก; workflow มี commit จึงยกมาทั้งชุดไม่ได้ |
| [Atomic](https://github.com/bastani-inc/atomic) / [workflows](https://docs.bastani.ai/workflows) | executable graph, checkpoints, resume, artifacts, review/repair และ human input | graph/status ที่ตรวจได้ระหว่างรัน, pause/steer/resume, typed handoff, การเปลี่ยน skill ที่ทำซ้ำเป็น executable workflow | เป็น coding-agent runtime ที่รันโมเดลเอง; เราควรยังเป็น model-free harness; README ระบุว่าไม่มี built-in sandbox หรือ command-level shell permission gate |
| [DoorDash Agentic Orchestrator — Agentico](https://github.com/doordash-oss/agentic-orchestrator) | durable lifecycle, isolated worktrees, multi-repo dependency ordering, verification และ decision checkpoints | repository knowledge base ที่ reuse ได้, UI ที่แสดงเฉพาะสิ่งต้องตัดสินใจ, structured phase completion | desktop/server orchestrator; Publish มี commit/push/PR; ของเราต้องคง Land authority แยกต่างหาก |
| [Superpowers](https://github.com/obra/superpowers) | brainstorm → plan → worktree → implement → review → finish; เน้น TDD และ evidence | แยกคำถาม review ว่า “ตรง spec ไหม” กับ “คุณภาพ code ดีไหม”; skill ที่โหลดตามงาน; behavioral eval ของ instructions | หลักฐานที่อ่านเน้น composable skills; ไม่ควรถือว่าคำสั่งใน skill เท่ากับ enforced receipt gate; ไม่ยก default subagent-per-task มาแทน routing ของเรา |
| [GSD Core](https://github.com/open-gsd/gsd-core) / [context engineering](https://github.com/open-gsd/gsd-core/blob/next/docs/explanation/context-engineering.md) | Discuss → Plan → Execute → Verify → Ship; durable STATE/CONTEXT และงานเป็น waves | fresh context เมื่อมีเหตุผล, packet ที่จำกัดเฉพาะงาน, resume summary ที่ชัด | README สนับสนุน fresh subagents สำหรับงานหนัก; ของเราต้องวัดต้นทุนก่อน; หน้าที่อ่านอยู่ branch `next` จึงไม่ควรเหมารวมว่า released ทั้งหมด |
| [GitHub Spec Kit](https://github.com/github/spec-kit) | constitution, specification, plan, tasks, analyze และ converge | ตรวจความครบ/ความสอดคล้องของ requirement ก่อน Build; customization แบบแยก core/extension/preset/project override | ให้เรียนรู้ UX และ analysis; อย่าสร้าง spec ledger ชุดที่สองแข่งกับ OpenSpec; README ปัจจุบันมี converge/extensions แล้ว ไม่ใช่แค่ template รุ่นแรก |
| [BMAD Method](https://github.com/bmad-code-org/BMAD-METHOD) | explicit decisions, durable context และ process ที่ปรับตามขนาดงาน | brownfield onboarding และเลือกความลึกของ planning; ส่ง artifact เข้ากระบวนการอื่นได้ | รุ่นที่อ่านเน้น right-sized process ไม่ควรอธิบายว่าเป็น fixed-role waterfall; แยก method ออกจาก bmad-loop runtime |
| [OpenSpec](https://github.com/Fission-AI/OpenSpec) / [Stores beta](https://github.com/Fission-AI/OpenSpec/blob/main/docs/stores-beta/user-guide.md) | เป็น agreement layer ที่เราใช้อยู่; upstream เพิ่ม standalone planning store และ shared read-only references | ตรวจ interoperability ของ multi-repo agreement กับ upstream stores ก่อนออกแบบ ownership เพิ่มเอง | Stores ยัง beta และ formats/commands เปลี่ยนได้; เรา pin OpenSpec 1.7.0 จึงต้องตรวจ compatibility แยก ไม่อัปเกรดจากรายงานนี้ |

**สถานะ GSD ที่ควรแก้ในรายการอ้างอิงเก่า:** [gsd-build/get-shit-done](https://github.com/gsd-build/get-shit-done) ถูก archive วันที่ 27 มิถุนายน 2026 และ README ชี้ไป `open-gsd/gsd-core` ไม่ควรใช้ repo เดิมเป็นแหล่ง current development

## กรณีศึกษาที่ตรงกับปัญหาเราเป็นพิเศษ

[Agentico PR #157](https://github.com/doordash-oss/agentic-orchestrator/pull/157) บันทึกปัญหาที่ model defaults แทน phase instructions และ prose recovery ยอมรับเอกสารบางส่วนว่า phase เสร็จแล้ว การแก้ใช้ structured `ask_user`/`complete_phase`, ตรวจ artifacts, unanswered questions และ delegated tasks ก่อนยอมรับ completion รวมถึงรักษา contract ตอน resume

บทเรียนสำหรับเรา: เป้าหมายของ host adapter ต้องครอบคลุม semantics ตอนจบงานและกลับมาทำต่อ ไม่ใช่เพียงเปิด agent สำเร็จ เรามี versioned instruction manifests, host execution normalization และ dispatch-id idempotency แล้ว จึงควรทำ gap audit และเพิ่มเฉพาะ case ที่ยังขาด ไม่เริ่มระบบใหม่ ข้อมูล compatibility ใน PR เป็นของ Agentico ไม่ใช่การรับรอง host adapter ของ Change Loop

## ลำดับการพัฒนาที่แนะนำ

ลำดับนี้เป็น judgment จากความเกี่ยวข้องกับ invariant ของเรา ยังไม่ใช่ผลวัด ROI

| ลำดับ | งานที่เสนอ | ต่อยอดจากสิ่งที่เรามี | เกณฑ์รับงานที่ควรใช้ |
| --- | --- | --- | --- |
| P0 | Host conformance audit จากกรณี Agentico | host contracts, instruction manifest, existing host-adapter tests | turn ending/partial artifact ไม่ทำให้ complete; duplicate result ไม่ทำซ้ำ; resume ไม่หลุด agreement/authority; unknown capability ต้องแสดงว่า unknown |
| P1 | มุมมอง “ติดอะไร ใครต้องทำอะไร ต่ออย่างไร” | `advance`, typed blockers, metrics, existing HTML report/dashboard | แสดง blocker → evidence/finding → owner → exact next action จาก runtime เดิม; เปิดใหม่แล้วเห็นสถานะเดิม; UI ไม่สร้าง state truth ชุดใหม่ |
| P1 | Sanitize diagnostic export แบบ bmad-loop | doctor, metrics, provenance และ logs ที่มีอยู่ | export runtime cohort/provider status/blocker/recovery stage ได้; fixture ที่มี secrets/prompt/path ส่วนตัวต้องไม่หลุด; unknown measurement ยังเป็น null |
| P2 | วัดคุณภาพ context reuse และ resume packet | scoped packets, packet limits, context telemetry และ scaling tests | เปรียบเทียบ token/เวลาตอนเริ่มใหม่; เปลี่ยน dependency แล้ว context เก่าต้องไม่ถูกใช้เป็น fact; เก็บ source reference + freshness; ไม่ให้ cache กลายเป็น agreement |
| P2 | OpenSpec Stores compatibility investigation | multi-repo agreement/compiler และ pinned CLI | ระบุ mapping ของ canonical roots, read-only references, archive target และ store revision ที่ proof ต้อง bind; ไม่มี silent fallback ไปผิด repo |
| P2 | Behavioral eval ของ instructions และ review | deterministic suites และ scenario portfolio เดิม | ทดสอบ requirement เปลี่ยนกลางงาน, self-reported success, stale evidence, missing authority และ restart; วัด violation/completion/cost แยกกัน |

สำหรับ P1 ควรสำรวจ report/dashboard เดิมก่อนเลือกว่าจะเพิ่ม CLI explanation หรือ UI: [dashboard README](../../dashboard/README.md) อธิบาย team awareness/usage และมี legacy `/dev` references จึงต้องตรวจ source เพิ่มก่อนสรุปว่าเปลี่ยนเป็น lifecycle control UI ได้แค่ไหน

## สิ่งที่ไม่ควรยกมาตรง ๆ

- อย่าเพิ่ม mandatory roles/phases หรือ fresh subagent ทุก task เพียงเพราะโครงการอื่นทำ ต้องรักษา conditional artifacts และ singleton-inline routing
- อย่าให้ Land รวม commit/push/PR ตาม flow ของ Agentico, GSD หรือ bmad-loop
- อย่าใช้ LLM verdict เป็นตัวแทน executable evidence หรือให้ summary/cache เป็น agreement
- อย่าเพิ่ม user-authored graph อีกชุดจากแนวทาง Atomic ถ้า compiler ของเราสร้าง graph จาก agreement เดิมได้
- อย่าอ้าง “verification” เป็นข้อได้เปรียบเฉพาะเรา ควรแสดงว่าหลักฐาน bind อะไร stale เมื่อไร และ recovery รักษางานอย่างไร

## การทดลองเปรียบเทียบที่ควรทำต่อ

เริ่มจาก Change Loop เทียบ **bmad-loop และ Agentico** ในมุม harness; เพิ่ม Atomic เมื่อจะเทียบประสบการณ์ควบคุม workflow ใช้ disposable consumer เดียวกัน กำหนด intent/test oracle เดียวกัน และตรึง project revision, model/host, policy, budget และ dependency versions หากตรึง model ไม่ได้ต้องรายงานเป็น confounder

กรณีขั้นต่ำ:

1. bug fix ขนาดเล็กที่มี failing reproduction
2. เปลี่ยน API สอง repo ที่มี producer/consumer dependency
3. แก้ code หลัง proof ผ่านเพื่อทดสอบ stale evidence
4. kill process ระหว่าง apply/finish แล้ว resume
5. target มี dirty edits บน touched path
6. provider ใช้งานไม่ได้ หรือมีงานที่ต้องอาศัย external authority

วัด completion ตามนิยามของแต่ละระบบพร้อม common oracle, false completion, งานผู้ใช้ถูกเขียนทับ, side effect ซ้ำ, intervention count, time-to-reviewable-result, measured tokens/cost และจำนวน check ที่ rerun โดยแยก framework overhead จาก model quality สำหรับ Change Loop ต้องถึง `archived` และ HEAD/index คงเดิม

รายงานนี้ยังไม่ได้รันการทดลองหรือ paid scenarios หากเลือกงานต่อ แนะนำเปิด investigation เรื่อง **host conformance gaps** ก่อน แล้วนำผลที่ยืนยันได้ไปสร้าง `/change` ตาม lifecycle ปกติ ไม่มี authority ให้ Land/commit/push จากงานวิจัยนี้

## ขอบเขตความเชื่อมั่น

- ความเชื่อมั่นสูงว่าโครงการที่ระบุมีทิศทางใกล้กัน: มี primary documentation รองรับ
- ความเชื่อมั่นปานกลางต่ออันดับการนำแนวคิดมาใช้: อิง contract และการตรวจ source บางส่วนของเรา
- ยังสรุปไม่ได้ว่าใครถูกกว่า เร็วกว่า ปลอดภัยกว่า หรือ production-ready กว่า: ไม่มี controlled run และไม่ใช้ stars/marketing metrics เป็นหลักฐานคุณภาพ
- รายการนี้เป็น shortlist ที่คัดตามความใกล้ Change Loop ไม่ใช่ census ของ ecosystem
