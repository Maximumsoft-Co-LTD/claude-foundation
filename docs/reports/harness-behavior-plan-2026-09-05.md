# Harness behavior development plan — 2026-09-05

สถานะ: แผนเฉพาะ harness ต่อจาก [development roadmap](development-roadmap-2026-09-05.md); ยังไม่ได้แก้ runtime หรือสร้าง OpenSpec change

ฐาน source: `b95140a7c3cc52fff0d1a28e9923b9e94afec75c` ขอบเขตคือ completion semantics, host/lease boundary, deterministic recovery และ read-only projections ข้อกำหนด lifecycle หลักอ้าง [WORKFLOW](../../WORKFLOW.md) ไม่สร้าง contract อีกชุดในรายงานนี้

## ผลที่ต้องการ

Harness เลือก action จาก agreement และ state/evidence ที่ตรวจสอบได้ ดำเนินงานอัตโนมัติที่อยู่ในอำนาจเดิม และคืน bounded action เมื่อถึงงานของ agent หรือ boundary จริง ทุกครั้งที่ resume ต้องใช้ revision/lease/proof ปัจจุบัน พร้อมรักษางานที่ทำสำเร็จแล้ว

ไม่เพิ่ม model caller, workflow engine อีกตัว, mandatory agent roles หรือ public command ใหม่โดยไม่จำเป็น การหยุดที่ `--through build|proven` คือจบคำสั่งที่ขอ ไม่ใช่ส่งมอบทั้ง change

## Findings ที่ใช้จัดลำดับ

1. **ยืนยันที่ pure-function boundary:** `done()` ใน [advance-runtime](../../.claude/harness/runtime/workflow/advance-runtime.mjs) ส่ง `action: DONE` ทั้ง build/proven/archived แต่ [lifecycle-outcome](../../.claude/harness/runtime/core/lifecycle-outcome.mjs) แปลงทุก DONE เป็น `DELIVERED` การเรียก `lifecycleUserProjection` ด้วย `reached: build`, `proven`, `archived` ได้ DELIVERED ทั้งสามกรณี จึงมี semantic mismatch ระหว่าง target completion กับ delivery ยังไม่ได้ยืนยัน end-to-end UI และไม่ใช่หลักฐานว่า Land gate ถูก bypass
2. **มีอยู่แล้ว:** [lease-runtime](../../.claude/harness/runtime/workflow/lease-runtime.mjs) มี lease identity, fencing generation และ graph/contract checks; [agent-dispatch](../../.claude/harness/runtime/workflow/agent-dispatch.mjs) รอ active lease จาก session เก่า จึงเริ่มด้วย coverage audit ก่อนแก้
3. **ต้องแยกหน้าที่:** [host-execution-contract](../../.claude/harness/runtime/observability/host-execution-contract.mjs) เป็น normalization/store สำหรับ observation และ telemetry โดย deduplicate ตาม dispatch ID ไม่ควรย้าย completion authority เข้า telemetry importer หรือทิ้ง historical usage เพียงเพราะงานเปลี่ยน revision
4. **ต้องตรวจเส้นทาง ownership:** Build wait ปัจจุบันใช้ actor `resource-owner`; active proof lock ใช้ harness-owned working ต้องตรวจว่าหน้าผู้ใช้แสดง internal worker wait เป็น external dependency หรือไม่ ก่อนแก้ mapping
5. **ต้องตรวจ projection parity:** [dashboard snapshot](../../dashboard/snapshot.mjs) มี freshness logic จาก receipt digests ของตัวเอง ขณะที่ runtime ตรวจ relevant inputs ด้วย ต้องทดสอบ code-only changes และกำหนดขอบเขตความสดของข้อมูลที่ view รับรองได้

## Behavior matrix เป้าหมาย

ตารางนี้เป็น acceptance cases ของการแก้ ไม่ใช่รายการ feature ใหม่ทั้งหมด Action ใช้ vocabulary เดิม; รายละเอียด owner ต้องตรงผู้รับผิดชอบจริง

| เหตุการณ์ | การตัดสินใจของ harness | การเปลี่ยน state / side effects | สิ่งที่ส่งต่อ |
| --- | --- | --- | --- |
| ถึง `--through build` | จบ target ที่ขอ | ไม่เริ่ม Prove หรือ Land ต่อ | target reached=build; ยังไม่ delivered; next route ไป proven |
| ถึง `--through proven` | จบ target ที่ขอ | ไม่ Land โดยปริยาย | target reached=proven; ยังไม่ delivered; next route ไป archived |
| archived จริง | จบ delivery | ไม่ apply/archive ซ้ำ | delivered; ไม่มีงาน delivery ค้าง |
| Agent จบ turn/รายงาน completed | ถือเป็น observation จนตรวจ task/evidence | ไม่ยกระดับ proof/archive ด้วยคำบอกเล่า | EDIT/REPAIR หรือ action ตาม state จริง |
| รับ execution observation ซ้ำ | deduplicate ตาม contract เดิม | ไม่บวก usage หรือผลข้างเคียงซ้ำ | ผล import เดิม/duplicate; ไม่ยกระดับ lifecycle |
| stale worker พยายามส่ง task result | ตรวจ lease ID/generation/contract ที่ execution boundary | ไม่ปิด task ของ attempt ใหม่; เก็บ usage ที่ถูกต้องตาม telemetry policy | rejection พร้อมเหตุผลและ resume route |
| resume ขณะ worker ยังมี valid lease | reuse ownership | ไม่ dispatch worker ซ้ำ | internal wait/working พร้อม resume condition |
| lease หมดอายุ แต่ host liveness ไม่ทราบ | ตรวจ recovery/fencing ก่อน takeover | ไม่ถือ timeout เป็นคำยืนยันว่า process หยุด; ไม่ให้ stale worker มี authority ใหม่ | bounded recovery ตาม capability จริง |
| setup ล้มบาง repo | เตรียม/ซ่อมเฉพาะ repo ที่ยังไม่พร้อม | reuse ready siblings | harness-owned repair; ไม่โยนคำสั่ง setup ให้ user |
| provider fail หลายรายการ | รวม findings และจัด dependency batch | rerun เฉพาะ checks ที่ invalidated หลัง repair | agent repair หรือ harness infrastructure repair ตามสาเหตุ |
| code/spec/wiring เปลี่ยน | ตรวจ freshness ด้วย runtime contract | invalidate สิ่งที่ได้รับผลกระทบ; ไม่สร้าง manual receipt | proof/repair route ที่ใช้ agreement ปัจจุบัน |
| external evidence ค้าง | ตรวจ binding และ owner | ไม่วนเรียก reviewer/provider เดิมโดยไร้เหตุ | WAIT พร้อม owner และเงื่อนไข resume |
| ผล operation ไม่มี progress | เปรียบเทียบ semantic fingerprint | ใช้กติกา no-progress เดิม; ไม่เพิ่ม fixed product retry cap | boundary พร้อม state preserved และ exact resume |
| ถึง model budget boundary | ใช้ budget policy เดิม | หยุดเฉพาะ model work ตาม policy; deterministic recovery ที่อนุญาตยังใช้ได้ | decision ตาม allowance จริง |
| มี Land authority ที่ยัง valid | ตรวจ proof/target และ prepare-all | apply ตาม dependency waves; resume journal; HEAD/index คงเดิม | DONE/delivered เมื่อ archived ครบเท่านั้น |
| เปิด status/report/export | read-only projection | ไม่ run provider/acquire lease/apply หรือแก้ proof | observed state + freshness/availability ที่พิสูจน์ได้ |

## ชุดงาน H1 — แยก target completion จาก delivery (P0)

Candidate change: `distinguish-target-completion-from-delivery`

- เพิ่ม regression ระดับ projection และ coordinator สำหรับ build/proven/archived ก่อนแก้
- รักษา `DONE`, `reached`, `completed`, `next` และ arguments เดิมตาม compatibility; อย่าเปลี่ยน DONE ให้หมายถึง archived อย่างเดียวโดยไม่ audit consumers
- เลือก representation สำหรับ “target reached แต่ยังไม่ delivered” ใน compiled agreement ของ change: ใช้ state เดิมได้เฉพาะถ้าไม่แสดงว่ากำลังทำงานต่อทั้งที่คำสั่งจบแล้ว หากต้องเพิ่ม state ให้ทำ versioned schema/consumer migration
- อัปเดต user-state projection, host guidance และ report consumers ที่เกี่ยวข้อง ให้แยก command completion กับ lifecycle completion

**ผ่านเมื่อ:** build/proven ไม่แสดง delivered, archived แสดง delivered, partial targets ไม่ run ขั้นถัดไป, resume route ถูกต้อง และ old machine consumers ยังตีความ fields ตาม compatibility ที่ประกาศได้

**ตรวจ:** lifecycle-outcome, advance-runtime และ delivery-convergence tests; protocol pin/upgrade tests เมื่อ contract เปลี่ยน; EN/TH docs ที่อธิบายสถานะต้องตรงกัน

## ชุดงาน H2 — Host / lease conformance (P0–P1)

Candidate change: `verify-host-resume-boundaries`

- ทำ source/test matrix แยก host instruction, telemetry observation, task result acceptance และ lifecycle transition
- ใช้ existing lease/fencing tests เป็นฐาน เพิ่มเฉพาะ missing cases: out-of-order result, amendment ระหว่าง worker run, same dispatch กับ conflicting payload, simultaneous resume และ expired lease กับ late release
- ตรวจ policy ของ duplicate observation ที่ payload ต่างกันให้ชัดก่อนเปลี่ยน importer; ไม่ตีความ historical execution เป็น fresh task evidence
- ระบุแต่ละ host capability ว่า enforced/observed/unavailable ตามหลักฐาน; harness guard ไม่ใช่ process isolation

**ผ่านเมื่อ:** stale generation ปิด task ใหม่ไม่ได้; resume ไม่ dispatch ซ้ำกับ live lease; result/usage ไม่ถูกนับซ้ำ; ไม่มี telemetry event ที่พา runtime ไป proven/archived ด้วยตัวมันเอง

หาก matrix ผ่านอยู่แล้ว ให้ส่งมอบ conformance evidence โดยไม่มี runtime redesign และไม่เพิ่ม handshake ที่ทำให้ host เดิมใช้ไม่ได้

## ชุดงาน H3 — Ownership และ automatic recovery (P1)

Candidate change: `align-wait-and-recovery-ownership`

- audit active-worker wait, internal lock, setup failure, reviewer infrastructure failure, actual external dependency และ user decision
- ใช้ lifecycle outcome/owner เดิมเป็นแหล่งตัดสิน ไม่สร้าง decision queue แยกจาก runtime
- operation result ที่มี boundary ต้องถูก consume ก่อน re-project state เพื่อไม่ทิ้ง decision แล้วรัน operation ซ้ำ
- กรณี harness ทำ recovery ได้ต้องทำต่อภายใต้อำนาจเดิม; กรณีไม่มี capability/resource จริงให้ระบุ owner/condition ไม่ทำ busy loop

**ผ่านเมื่อ:** internal worker/lock ไม่ถูกอธิบายเป็นการรอทีมภายนอก; ready sibling ไม่ setup ซ้ำ; reviewer infrastructure exhaustion ไม่ re-dispatch ไม่สิ้นสุด; failed product checks ยังซ่อมต่อได้เมื่อ progress เปลี่ยน; ไม่ถาม user เรื่อง bookkeeping

## ชุดงาน H4 — Readiness projection และ local diagnostics (P1)

Candidate changes: `project-canonical-change-readiness`, `export-change-diagnostics`

- ต่อ feedback/local report จาก H1/H3: target reached, delivery status, reason, owner, evidence reference, observation time และ next action
- แยก recorded proof status จาก current validity; ถ้า dashboard ตรวจ workspace ปัจจุบันไม่ได้ ต้องแสดง freshness unavailable ไม่รับรองจาก receipt digest อย่างเดียว
- read-only path ต้องไม่เรียก coordinator entrypoint ที่ acquire/record/mutate โดยไม่ตั้งใจ; ตรวจ call graph และ fixture side effects
- diagnostic bundle ใช้ allowlist จาก projection; free-form reason/error อาจมี secrets ต้องไม่ export raw โดยปริยาย ใช้ code/alias และข้อมูลที่ตรวจแล้ว
- เก็บ exact local paths/commands สำหรับ agent ใน local surface; central dashboard รับเฉพาะข้อมูลที่ schema/privacy contract อนุญาต

**ผ่านเมื่อ:** report/runtime/dashboard ตรงกันใน valid/stale/error/missing; status/export ไม่เปลี่ยน runtime/leases/proof หรือ invoke provider; sensitive fixtures ไม่หลุด export; unknown timing/usage ไม่เป็น zero

## ชุดงาน H5 — Bounded resume packet (P2)

Candidate change: `resume-from-current-execution-context`

- derive packet จาก current agreement, task frontier, accepted decisions, active leases, findings และ invalidation state
- ส่งเฉพาะ context ที่จำเป็นและ source references ภายใน packet ceilings เดิม; truncate ต้องบอกและให้ทางอ่านต่อโดยไม่ทิ้งข้อจำกัดสำคัญ
- ทดสอบ restart ก่อน/หลัง amendment, provider wiring change, base movement และ partial Land
- ทดลอง cache เพิ่มเฉพาะเมื่อวัดแล้วช่วย; runtime state/OpenSpec ยังคง authoritative

**ผ่านเมื่อ:** resume เลือก action เดียวกับ equivalent uninterrupted state, ไม่ทำงานสำเร็จซ้ำ, packet bound ผ่านและ stale knowledge ไม่ถูกอ้างเป็น fact การเปรียบเทียบต้นทุนโมเดลจริงเป็นงานแยกที่ต้องมี authority

## ลำดับ implementation และ stop conditions

1. H1 ก่อน เพราะมี reproduction แล้ว พร้อม source/test matrix ส่วน H2/H3
2. H2/H3 แก้เฉพาะ gaps ที่ reproduce ได้; ไม่สรุปทุกข้อว่าเป็น bug จากชื่อ test หรือคำอธิบาย
3. H4 ใช้ semantics ที่นิ่งจาก H1/H3; diagnostic export แยก change จาก dashboard
4. H5 หลังมี resume baseline; เลื่อน Stores integration, arbitrary graph editor และ fleet orchestration ออกจากรอบนี้

แต่ละ change ระบุ before/after behavior, scope, allowed paths และ evidence ใน OpenSpec ก่อน Build ตรวจ focused tests ระหว่างแก้ แล้ว full deterministic suite ตาม [suite ownership](../../.claude/tests/README.md) ก่อนส่งมอบ harness change ไม่รวม live paid scenarios ในรอบนี้

ถ้าการแก้ต้อง break public enum/field semantics ให้เปิด compatibility decision ใน change นั้นก่อน implementation; ไม่เปลี่ยน canonical contract เงียบ ๆ ถ้า limitation มาจาก native host ให้บอกขอบเขตจริงและ fallback ที่ตรวจได้ ไม่สร้าง evidence ว่าบังคับสำเร็จ

## Definition of done

- requirement/scenario ของ change ครบ; regression จับ before/after ที่ตั้งใจแก้ได้
- `rtk test bash .claude/tests/run-all.sh` ผ่าน; docs consistency, website build และ upgrade tests ตามส่วนที่เปลี่ยน
- ไม่มี unavailable→pass/zero, ไม่มี proof JSON ที่ agent แก้เอง, ไม่มีผลข้างเคียงซ้ำใน interruption fixtures
- public command compatibility และ installer ownership ตรวจแล้ว; pins เปลี่ยนเฉพาะ actual wire contract
- explicit Land ที่ผูกกับ change ปัจจุบันนำไปถึง archived โดย HEAD/index เดิม; Git/external authority แยกต่างหาก

ขั้นถัดไปที่เสนอ: เปิด `/change distinguish-target-completion-from-delivery` จาก reproduction ของ H1 แล้วใช้ compiled packet เป็น agreement การวางแผนครั้งนี้ยังไม่ได้เปิด change หรือให้ authority สำหรับ Land
