# Change Loop development roadmap — 2026-09-05

สถานะ: แผนเสนอจากการวิจัยและตรวจ source บางส่วน ยังไม่ได้เริ่ม implementation หรือกำหนด release version

รายละเอียด implementation ฝั่ง harness และลำดับ P0 ที่ปรับจากการตรวจ source เพิ่มอยู่ใน [Harness behavior plan](harness-behavior-plan-2026-09-05.md)

อ้างอิง [ผลสำรวจโครงการที่เกี่ยวข้อง](related-projects-research-2026-09-05.md) และ checkout `b95140a7c3cc52fff0d1a28e9923b9e94afec75c` การจัดลำดับด้านล่างเป็นข้อเสนอ ไม่ใช่ผล benchmark

## เป้าหมาย

ทำให้ผู้ใช้ไว้ใจได้ว่างานเสร็จจริง เข้าใจเหตุผลที่งานยังไม่เสร็จ และกลับมาทำต่อได้โดยเสีย context/งานเดิมน้อยลง รักษา lifecycle และ authority ตาม [WORKFLOW](../../WORKFLOW.md) โดยใช้ [OpenSpec agreement และ evidence contract](../../.claude/harness/EVIDENCE.md) เดิม

ส่งมอบเป็น change เล็กที่ตรวจได้ จบแต่ละ change ที่ `archived` ภายใต้อำนาจ Land ที่ผู้ใช้ให้จริง โดยแยก commit/push/release ต่างหาก

## สิ่งที่ตรวจพบใน source แล้ว

| ฐานที่มีอยู่ | หลักฐาน | ผลต่อแผน |
| --- | --- | --- |
| `advance` มี owner, reason, recovery, resume และ user projection | [advance-runtime](../../.claude/harness/runtime/workflow/advance-runtime.mjs), [lifecycle-outcome](../../.claude/harness/runtime/core/lifecycle-outcome.mjs) | ไม่สร้าง coordinator หรือ decision state ใหม่ |
| มี host instruction/provenance และ duplicate import coverage | [host instruction tests](../../.claude/tests/harness/run-host-instruction-tests.mjs), [provenance tests](../../.claude/tests/harness/run-provenance-contract-tests.sh) | ทำ matrix หา missing coverage ก่อนเพิ่ม tests หรือ protocol |
| มี weak-host resume, stale-proof, authority และ saga tests | [advance tests](../../.claude/harness/tests/advance-runtime.test.mjs), [suite ownership](../../.claude/tests/README.md) | แยก deterministic coverage ออกจากการยืนยันพฤติกรรม host จริง |
| feedback รวม timing, blocker coverage, evidence reuse และ next action แล้ว | [feedback-runtime](../../.claude/harness/runtime/observability/feedback-runtime.mjs) | สร้างคำอธิบายจากข้อมูลเดิม ไม่คำนวณ lifecycle ใหม่ใน UI |
| dashboard projection ส่ง blocker เป็น code และมี receipt freshness projection ของตัวเอง | [snapshot](../../dashboard/snapshot.mjs) | ตรวจว่าข้อมูลพออธิบาย owner/reason หรือไม่ และความหมาย freshness ตรงกับ runtime หรือไม่; ยังไม่ถือเป็น confirmed bug |
| มี packet bounds, scaling tests และ context telemetry | [packet-runtime](../../.claude/harness/runtime/workflow/packet-runtime.mjs), [suite ownership](../../.claude/tests/README.md) | วัดข้อจำกัดก่อนเพิ่ม persistent context cache |

## ลำดับส่งมอบ

```text
A: Audit + baseline → B: ปิดช่องว่าง host/completion ที่ยืนยันได้
                   → C: อธิบายสถานะและ evidence ให้ตรงกัน
                   → D: Diagnostic export
B + C → E: Resume context ทดลองและวัดผล
A     → F: OpenSpec Stores investigation (ยังไม่ผูกกับ release แรก)
```

D ใช้ vocabulary จาก C แต่ไม่ต้องรอ UI เสร็จ; F ทำแยกได้เมื่อมี capacity โดยไม่แย่งงาน A–D ไม่มีข้อเสนอให้รันหลาย agent เป็นค่าเริ่มต้น

## A — Audit และ baseline ก่อนแก้ runtime

**ผลที่ต้องได้:** รายการว่าอะไรผ่านอยู่แล้ว อะไรขาด test อะไรเป็น defect และอะไรตรวจไม่ได้จาก host นี้

- ทำ matrix สำหรับ host ที่ product รองรับ: instruction delivery, workspace enforcement, result correlation, resume, evidence freshness และ authority
- แต่ละช่องระบุ source/test reference พร้อมสถานะ `covered`, `gap`, `defect` หรือ `unavailable`; test ของ harness ไม่แปลว่า native host บังคับได้จริง
- ใช้ fixtures เดิมตรวจ 8 กรณี: turn จบแต่งานไม่เสร็จ, artifact ไม่ครบ, duplicate result, delayed result จาก revision เก่า, restart ขณะ lease ยังทำงาน, code เปลี่ยนหลัง proof, dirty target และ interruption ระหว่าง multi-repo Land
- บันทึก baseline ของ provider executions, reused receipts, runtime operations และ packet bytes; token/cost ที่ไม่มี measurement คงเป็น unavailable

**เสร็จเมื่อ:** ทุกกรณีมีหลักฐานหรือชื่อ gap ที่ชัดเจน และ defect ทุกตัวมี reproduction ที่ต่ำที่สุด หาก covered แล้วให้ reuse test เดิม ไม่เพิ่ม test ซ้ำ

**ขนาด:** S–M; ไม่รวม live model runs

## B — Host completion และ resume ที่ตรวจสอบได้

**ผลที่ผู้ใช้ได้:** เปิด session ใหม่หรือ host ส่งผลซ้ำแล้วงานเดินต่อถูกจุด และคำว่า “เสร็จแล้ว” ของ agent ไม่ทำให้ข้าม proof/Land

- แก้เฉพาะ defect/gap จาก A ใน host boundary, coordinator หรือ lease/result handling ที่เป็นเจ้าของจริง
- ตรวจ correlation ของ result กับ dispatch/change/agreement revision ตาม contract ที่มีอยู่; ปฏิเสธข้อมูลผิดงานหรือหมดอายุโดยรักษา state
- จำแนก unsupported host capability ให้ชัด ไม่ประกาศ enforcement ที่ host ไม่ได้ให้
- host ส่งข้อมูลสำเร็จเป็นเพียง execution observation; runtime ยังเป็นผู้ตัดสิน lifecycle ตาม artifacts/evidence/authority

**Acceptance:** duplicate ไม่สร้างผลข้างเคียงซ้ำ; stale result ไม่ปิดงานใหม่; restart ไม่ spawn executor ซ้ำขณะ lease ยัง valid; end-turn ไม่กลายเป็น `archived`; Land ที่ไม่มี authority ไม่ผ่าน; HEAD/index ของ target คงเดิม

**ตรวจที่:** host instruction/provenance tests, advance/delivery-convergence tests และ saga tests เฉพาะเส้นทางที่เปลี่ยน ก่อน authoritative full suite

**ขนาด:** M ขึ้นกับผล A; ถ้าไม่มี defect ให้จบที่ conformance evidence ไม่สร้าง protocol ใหม่เพื่อให้มี feature

## C — อธิบายสถานะและหลักฐานให้ผู้ใช้เข้าใจ

**ผลที่ผู้ใช้ได้:** เห็นว่าทำอะไรอยู่ ติดเพราะอะไร ใครรับผิดชอบ และต้องตัดสินใจอะไร โดยไม่อ่าน machine JSON

ส่งสองช่วง:

1. **C1: local explanation/report** — ต่อจาก lifecycle user projection และ feedback เดิม แสดงสถานะ, สาเหตุ, evidence ที่เกี่ยวข้อง, owner และเงื่อนไขเดินต่อ; agent รับ exact command ส่วน user รับคำอธิบาย/คำถามที่ต้องใช้ judgment
2. **C2: dashboard projection** — ใช้ semantic projection เดียวกันหลัง C1 นิ่ง แสดงรายละเอียดของ change แบบอ่านอย่างเดียวก่อน รวม observation time/cohort และสถานะข้อมูลเก่า

ตัวอย่างข้อความเป้าหมาย:

> การแก้ไขพร้อมแล้ว แต่กำลังรอผลตรวจจากทีม DevOps สำหรับ migration นี้ เมื่อผลที่ผูกกับ code ชุดปัจจุบันเข้ามา ระบบจะตรวจต่อใน change เดิม

**Acceptance:**

- runtime, report และ dashboard ไม่ขัดกันใน cases: proof valid/stale, provider error, external wait, user decision และ archived
- เปลี่ยน code โดยไม่แตะ receipt แล้วหน้าจอต้องไม่รับรองว่า proof ยัง valid จาก receipt digest เพียงอย่างเดียว; ถ้า view ตรวจ workspace ไม่ได้ ต้องบอกว่าเป็น recorded status/ยังไม่ตรวจปัจจุบัน
- evidence failure ยังเห็นเป็น failure; ข้อมูล missing/corrupt ไม่กลายเป็น pass หรือ zero
- การเปิด report/view ไม่รัน provider ไม่เปลี่ยน lifecycle และไม่ส่งคำสั่ง recovery ของ harness ไปให้ผู้ใช้ทำเอง
- central dashboard ไม่รับ local paths, prompts หรือ evidence content เพิ่มโดยปริยาย; ให้รายละเอียดเชิงลึกอยู่ local ก่อน

**ตรวจที่:** lifecycle-outcome/delivery-convergence, feedback และ dashboard snapshot tests; visual QA เมื่อลงมือเปลี่ยนหน้าจอ

**ขนาด:** C1 M, C2 M; C2 เป็น change แยกและเลื่อนได้

## D — Diagnostic export ที่แชร์เพื่อแก้ปัญหาได้

**ผลที่ผู้ใช้ได้:** ส่งรายงานปัญหาจาก change เดียวให้ผู้ดูแลวิเคราะห์ได้โดยไม่ต้องรวบรวม log เอง

- export แบบ local/on-demand จากข้อมูลที่มีอยู่: runtime cohort, protocol/host capabilities, provider status, typed blocker, recovery stage และ measurement availability
- ออกแบบจาก field allowlist; ไม่ dump raw logs แล้วหวังให้ regex ลบหมด
- ใช้ alias ภายใน bundle สำหรับ identifiers ที่อาจเผยข้อมูล และเก็บความสัมพันธ์ที่จำเป็นต่อ diagnosis
- เลือกว่าจะเพิ่ม option ให้ diagnostic surface เดิมหรือ additive command หลังตรวจ registry; ชื่อคำสั่งใหม่ยังไม่เป็น public contract ในแผนนี้

**Acceptance:** fixture ที่ใส่ secret/path/email ใน identifier, reason, error และ unknown fields ต้องไม่หลุด; truncated/corrupt input มีคำอธิบาย; export ไม่แก้ state และไม่ upload; unavailable measurement คงเดิม

**ตรวจที่:** diagnostics/observability boundary, CLI output contract และ install ownership หากเพิ่ม shipped module

**ขนาด:** M; เริ่มหลัง C1 นิยาม explanation fields แล้ว

## E — กลับมาทำต่อด้วย context ที่กระชับและสด

**ผลที่ผู้ใช้ได้:** session ใหม่รับงานต่อได้โดยไม่ต้องเล่า intent/สถานะซ้ำ และไม่ใช้ข้อมูลเก่าทับ agreement ใหม่

- ทดลอง resume packet ที่มี agreement revision, task frontier, accepted decisions, active leases, outstanding findings และ next action จาก runtime ปัจจุบัน
- ข้อมูลสรุปที่ derive ได้ให้สร้างใหม่จาก source; เฉพาะความรู้ที่ reuse แล้วมีประโยชน์จริงจึงพิจารณา cache พร้อม source references และ freshness identity
- ทดสอบการเปลี่ยน producer repo, spec amendment, provider wiring และ workspace base เพื่อดูว่า invalidate เฉพาะข้อมูลที่เกี่ยวข้องได้หรือไม่
- ใช้ packet limits และ telemetry เดิม ไม่สร้าง knowledge base เต็ม repo เป็นค่าเริ่มต้น

**Acceptance ขั้นแรก:** constraint/decision ที่จำเป็นไม่หาย, stale context ไม่ถูกแสดงเป็น fact, active work ไม่ซ้ำ, packet อยู่ใน limit เดิม

**เกณฑ์ตัดสินนำมาใช้:** fixed fixtures ต้องไม่เพิ่ม median packet bytes หรือ deterministic rerun count จาก baseline; live comparison เมื่อได้รับ authority ต้องรายงาน task success และต้นทุนจริงแยกกัน ยังไม่สัญญาว่าลด token กี่เปอร์เซ็นต์ หากไม่มีประโยชน์ให้เก็บเพียง resume projection

**ตรวจที่:** packet/context/scaling suites และ provider invalidation cases ที่เกี่ยวข้อง

**ขนาด:** M–L; เริ่มเมื่อ B/C1 นิ่งและมี baseline จาก A

## F — OpenSpec Stores compatibility investigation

**ผลที่ต้องได้:** คำตัดสินว่าเชื่อม upstream stores ได้หรือไม่ ต้อง upgrade อะไร และจำเป็นต่อ use case เราจริงหรือไม่

- ใช้ disposable fixture เปรียบเทียบ pinned version ของเรากับ upstream revision ที่เลือกและบันทึกไว้
- ตรวจ canonical root, shared read-only references, cross-repo ownership, proof binding, archive destination และ upgrade preservation
- ตรวจว่าความสามารถ multi-repo ปัจจุบันตอบโจทย์อยู่แล้วส่วนใด; เพิ่ม integration เฉพาะ gap ที่มีผู้ใช้ต้องการ

**เสร็จเมื่อ:** ได้ ADR สั้นพร้อมทางเลือก adopt/defer/reject, compatibility matrix และ migration risks; ยังไม่เปลี่ยน pin หรือเพิ่ม agreement store จาก investigation นี้

**ขนาด:** S–M สำหรับ investigation; implementation ประเมินใหม่ภายหลัง

## ขอบเขตรอบแรกที่แนะนำ

เลือก **A → B → C1 → D** เป็นรอบแรก: ตรวจความเชื่อถือได้ของ boundary, ทำให้ผู้ใช้เข้าใจสถานะ และลดต้นทุนวิเคราะห์ปัญหา C2/E/F เป็นรอบถัดไปตามหลักฐานและ capacity

ขนาด S/M/L เป็นความกว้างและความเสี่ยงสัมพัทธ์ ไม่ใช่จำนวนวันหรือคำรับรองเวลา ต้องใช้ผล A และเวลารัน full suite มาประเมินกำหนดส่งอีกครั้ง

ยังไม่ลงทุนใน agent marketplace, desktop app ใหม่, arbitrary workflow editor, auto-publish, mandatory multi-agent หรือ context database เต็มรูปแบบ เพราะยังไม่มีหลักฐานว่าแก้ปัญหาหลักได้คุ้มกว่าการต่อยอด runtime เดิม

## แบ่งเป็น change ที่ตรวจรับได้

ชื่อด้านล่างเป็น candidate IDs ยังไม่ได้สร้าง OpenSpec packet:

| งาน | Candidate change | ขอบเขต |
| --- | --- | --- |
| A | investigation ก่อน change | matrix + reproduction + baseline |
| B | `host-completion-conformance` | เฉพาะ gaps ที่ยืนยันแล้ว; แยกตาม boundary หาก scope ใหญ่ |
| C1 | `explain-change-readiness` | canonical read-only explanation และ local report |
| C2 | `align-dashboard-readiness` | dashboard consumer ของ projection เดิม |
| D | `export-change-diagnostics` | allowlisted local bundle |
| E | `resume-context-projection` | bounded fresh resume packet; cache เป็น follow-up เมื่อคุ้ม |
| F | investigation ก่อน change | compatibility ADR; ยังไม่ upgrade |

ทุก product change ใช้ draft → compiled OpenSpec packet → isolated Build → Prove → explicit Land/archived ตาม [maintainer workflow](../../CLAUDE.md) ไม่ใช้ roadmap แทน agreement

## การตรวจและการวัดผล

- เริ่มจาก focused regression ที่เจ้าของ boundary ตาม [suite map](../../.claude/tests/README.md); ใช้ `rtk test bash .claude/tests/run-all.sh --affected` ระหว่างแก้ และ `rtk test bash .claude/tests/run-all.sh` เป็น deterministic gate ก่อนส่งมอบ harness change
- หากเปลี่ยน command/wire contract ให้อัปเดต registry/pin/upgrade coverage เฉพาะที่เปลี่ยน; public docs EN/TH ต้องตรงกัน; website docs เปลี่ยนต้อง build
- behavioral fixtures เป็นส่วนหนึ่งของ A/B/E ตั้งแต่ต้น ไม่รอ feature ทั้งหมดเสร็จ; live/paid runs เป็นกิจกรรมแยกที่ต้องมี authority
- ลง baseline/result แยกตาม source cohort, host/model, scenario และ policy: false completion, wrong-owner handoff, duplicate side effects, stale-proof acceptance, provider reruns, packet bytes, time-to-resume และ measured usage
- correctness fixtures ต้องไม่มี false completion, overwrite ของ user work หรือ unauthorized Land; ผลผ่าน fixture ไม่ใช่การรับประกันว่าไม่มี defect นอกชุดทดสอบ
- ไม่เพิ่ม proof ledger, ไม่แก้ machine-owned proof JSON และไม่ยก missing data เป็น pass เพื่อให้ผลดีขึ้น

## จุดเริ่มต้นถัดไป

เริ่ม A ด้วย matrix จาก tests ที่มีและ reproduction ของช่องว่าง โดยให้ผลสุดท้ายระบุ “ต้องแก้ B อะไรจริง” และ “C1 ใช้ projection ไหนได้เลย” ก่อนเปิด product change แรก การดำเนินการในรอบวางแผนนี้มีเพียงเอกสาร ไม่ได้รัน implementation, Land หรือ paid scenarios
