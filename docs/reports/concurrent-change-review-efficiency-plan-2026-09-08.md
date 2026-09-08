# แผนลด review ซ้ำเมื่อทำหลาย change พร้อมกัน

วันที่: 2026-09-08

สถานะ: ข้อเสนอจากการอ่าน source เท่านั้น ยังไม่ได้ reproduce, รันทดสอบ, แก้ runtime หรือสร้าง compiled OpenSpec agreement แผนนี้ไม่ใช่ release evidence และไม่ให้อำนาจ Land, commit, push, publish หรือ paid execution

## ปัญหาและผลลัพธ์ที่ต้องการ

ผู้ใช้รายงานว่าเมื่อทำหลาย change พร้อมกัน การ sync ก่อน Land ทำให้ต้อง review ใหม่หลายรอบและส่งมอบช้า ต้องลดงานซ้ำที่ไม่จำเป็นโดยรักษาการตรวจผลกระทบจากฐานใหม่จริง ไม่ใช้การเพิ่มเพดาน review เป็นทางแก้หลัก

ตัวอย่างเป้าหมาย: A และ B ทำงานจากฐานเดียวกัน เมื่อ A Land เป็น uncommitted target diff แล้ว B sync หาก B และขอบเขตหลักฐานที่เกี่ยวข้องไม่เปลี่ยน B ต้องใช้ผลเดิมได้ตาม contract; หาก A เปลี่ยน dependency ที่ B ใช้ ต้องตรวจผลกระทบนั้นก่อนส่งมอบ

ความสำเร็จของการส่งมอบยังเป็น `archived` ตาม [WORKFLOW](../../WORKFLOW.md) ขอบเขต evidence ตาม [EVIDENCE](../../.claude/harness/EVIDENCE.md) และการพัฒนาใช้ [maintainer workflow](../../CLAUDE.md) แผนนี้ไม่สร้าง lifecycle, proof ledger หรือ approval mechanism คู่ขนาน

## ข้อค้นพบและสิ่งที่ยังไม่ทราบ

| ข้อค้นพบจาก source | ตำแหน่ง | ผลต่อแผน |
| --- | --- | --- |
| Review/acceptance reuse รองรับ diff identity + packet review hash อยู่แล้ว | `runtime/evidence/receipt-validity.mjs`, `receipt-runtime.mjs` | ต่อยอด validator และ rebind เดิม ไม่สร้าง receipt validity อีกชุด |
| `changeDiffCandidatePlan` ข้าม mode ที่ไม่ใช่ worktree; identity ที่ไม่มี rows เป็น null | `runtime/workflow/sandbox-runtime.mjs` | Copy-only sandbox ไม่มี identity สำหรับเส้นทาง diff reuse; composite ต้องตรวจทุก repository ไม่ให้บาง mode หายจาก identity |
| `normalizedDiffDigest` ตัด blob index และ hunk coordinates แต่ยังใช้ patch content/context | `sandbox-runtime.mjs` | การเปลี่ยน context อาจทำให้ identity เปลี่ยน แม้เจตนาของ contribution เดิม; ห้ามแก้ด้วยการตัด context เพิ่มโดยไม่มี contract |
| Copy sync ใช้ baseline manifest และ reconcile ราย path | `sandbox-runtime.mjs` | ใช้เป็นฐานออกแบบ identity และ movement ของ copy โดยไม่สมมติว่ามี Git base blob |
| Sync เปลี่ยน state เป็น building เพิ่ม revision และลบ proof รวมทุกครั้ง | `updateSandboxSyncState` | มีโอกาสปรับ no-op และการคงความก้าวหน้า แต่การลบ proof ไม่ได้แปลว่าเรียก reviewer ใหม่เสมอ |
| Proof run/advance มี durable rebind และข้าม valid/reusable receipts แล้ว | `runtime/evidence/proof-execution-runtime.mjs` | รักษาเส้นทางเดียว ตรวจจุด invalidation ก่อนเพิ่ม coordinator |
| Base-move reset ปลด attempt ที่ผ่านแล้วออกจาก wave accounting โดยต้องมี decision reference | `runtime/evidence/review-attempt-store.mjs` | ไม่ลดขอบเขต review ด้วยตัวเอง และไม่ควรนำมา reset อัตโนมัติ |
| AI scope ปัจจุบันมี full/delta; delta ผูกกับ AI dispatch แรกและ closure ของ findings | `review-attempt-store.mjs`, `WORKFLOW.md` | Review ผลกระทบจากฐานใหม่ต้องออกแบบ contract แยก ไม่สวมชื่อ delta แล้วใช้กติกาปิด findings เดิม |
| เอกสาร evidence ระบุ whole-workspace binding ของ review/acceptance ขณะที่ code มี diff rebind | `EVIDENCE.md` และ validator | ต้องทำ canonical contract ให้ชัดก่อนขยาย reuse |
| มี suite สำหรับ base move, receipt validity, review history และ lifecycle อยู่แล้ว | [.claude/tests/README.md](../../.claude/tests/README.md) | เพิ่ม regression ที่ boundary เดิมก่อนเพิ่ม suite ใหม่ |

เส้นทาง runtime ในตารางอ้างอิงภายใต้ `.claude/harness/` ข้อค้นพบยังไม่ยืนยันเหตุของเหตุการณ์ผู้ใช้: ยังไม่ทราบ installed source cohort, workspace mode, receipt version, invalidation reason, จำนวน dispatch จริง และมี conflict/contract amendment หรือไม่ การอ่านไฟล์ test ไม่ใช่ผลทดสอบผ่าน

## หลักการออกแบบ

- Reuse ต้องมี identity และเงื่อนไข validity ครบ ไม่เทียบ null เท่ากับ null และไม่ใช้ชื่อไฟล์ต่างกันเป็นหลักฐานว่าไม่กระทบ
- แยก contribution ของ change, ฐานที่รับเข้ามา, agreement และ evidence inputs เพื่ออธิบายสาเหตุ แต่ runtime ยังคงตัดสินผ่าน validator/reducer เดิม
- Diff เหมือนเดิมอย่างเดียวไม่พิสูจน์ว่า dependency, global configuration หรือ read-only producer ไม่กระทบพฤติกรรม
- ไม่ใช้ observed read-set ของ reviewer หรือคำยืนยันจาก agent เป็น dependency closure ที่ครบถ้วนโดยอัตโนมัติ
- เก็บ attempt/receipt ต้นฉบับและ provenance; rebind ใช้ journal/binding เดิม ไม่แก้ JSON ให้ดูเหมือน reviewer เคยอ่านฐานใหม่
- Human acceptance และ signed semantic acceptance เป็น authority คนละชนิดกับ AI review การเพิ่ม review reuse ไม่ขยาย acceptance โดยปริยาย
- Runtime ที่ติดตั้งใน consumer ต้องไม่พึ่ง tests, reports หรือ release tooling ของ upstream
- ไม่ลด review รอบแรก ไม่เพิ่ม workflow editor, central queue, persistent dependency database หรือ mandatory multi-agent ในงานนี้

## การตัดสินใจหลัง sync

ชื่อผลด้านล่างเป็น vocabulary ในแผน ยังไม่ใช่ public enum หรือ command ใหม่

| สภาพก่อน–หลัง | Review | Executable evidence / proof |
| --- | --- | --- |
| Relevant content, agreement, policy และ provider inputs ไม่เปลี่ยน | คง valid verdict | คง valid evidence; หลีกเลี่ยง no-op invalidation แต่ยังตรวจ target/authority ณ Land |
| ฐานหรือ metadata เปลี่ยน โดย review validity ตาม contract ยังครบ | Rebind ผ่านเส้นทางเดิม | ประเมินแต่ละ provider และประกอบ proof ปัจจุบัน |
| Copy/worktree รับการเปลี่ยนที่พิสูจน์ได้ว่าอยู่นอก review impact boundary | Reuse ตาม contract ที่ออกแบบและตรวจรับแล้ว | รันเฉพาะ provider ที่ inputs เปลี่ยน |
| Dependency/global config/read-only producer ที่เกี่ยวข้องเปลี่ยน | ประเมินผลกระทบ; ใช้ bounded impact review เมื่อ contract รองรับ | Rerun checks ที่ invalidated; evidence ไม่ครบต้องไม่ผ่าน |
| Conflict resolution หรือ contribution เปลี่ยน | ห้าม rebind ตาม identity เก่า; ประเมิน scope review ใหม่ | ผูกหลักฐานกับ merged result จริง |
| Agreement หรือ consequential semantics เปลี่ยน | ใช้ amendment/decision route เดิม และ review ตาม scope ใหม่ | ใช้ contract/provider identities ใหม่ตามส่วนที่เปลี่ยน |
| Identity/history/impact coverage ไม่ครบ หรือ source เก่าตรวจไม่ได้ | ไม่ประกาศ reusable; ให้เหตุผลและ exact resume route | ไม่แทน unknown ด้วย pass; ใช้ recovery/authority/budget boundary เดิม |

## ลำดับพัฒนา

### A — ตรวจ baseline และล็อก reuse contract

ขนาดสัมพัทธ์: S–M; ต้องเสร็จก่อน B/C

1. ตรวจ installation/cohort และ log/diagnostics ที่มีของเคสจริงแบบ read-only หากเข้าถึงได้ ไม่ขอให้ผู้ใช้รัน harness command ที่ agent รันได้ และไม่แก้ machine-owned evidence
2. แยกจำนวน sync, proof rebuild, executable provider runs, reviewer dispatches และ retries จริง เพื่อตรวจว่าความช้าอยู่ส่วนใด
3. ไล่ทุก input ของ receipt validity รวม provider/protocol/contract/provenance ไม่สรุปว่า workspace hash เป็นสาเหตุเดียว
4. เขียน compatibility/impact decision สั้นใน compiled change: ขอบเขตที่ contract เดิมอนุญาต reuse, ขอบเขต copy ที่เพิ่ม, การจัดการ unknown, และผลต่อ acceptance
5. ตรวจ Land แบบ HEAD ไม่เปลี่ยนแต่ target มี uncommitted diff จาก A ด้วย ไม่จำกัด fixture แค่ upstream commit เคลื่อน
6. ระบุ conservative invalidation กับ defect แยกกัน ห้ามรับรองว่า copy identity เพียงอย่างเดียวแก้ความช้าทั้งหมด

ตรวจรับ: ทุกเหตุผลมี source reference หรือ reproduction เมื่อเข้าสู่ implementation; มี baseline หรือระบุ unavailable; contract ไม่อ้างว่าดูคนละไฟล์จึงปลอดภัย

### B — Identity และ reuse ครบทุก workspace mode

ขนาด: M; dependency A

- เพิ่ม mode-aware contribution identity ใน sandbox domain ใช้ path, repository identity, operation, content และ metadata ที่ Land ใช้จริง รวม delete, binary, symlink และ executable mode
- Copy baseline มี digest ไม่จำเป็นต้องมีเนื้อหาเก่า: ออกแบบและระบุข้อจำกัดก่อนเลือก file-level before/after identity; ไม่บังคับ copy ให้ใช้ Git patch algorithm หรือสร้างฐานข้อมูลเก็บไฟล์เก่าทั้ง repo
- คง worktree identity เดิมเมื่อไม่จำเป็นต้องเปลี่ยน representation; หากเปลี่ยนต้องมี version และ migration ที่ไม่ทำให้ receipt เก่าบังเอิญเท่ากัน
- Composite identity ต้องครอบคลุมทุก writable contribution; read-only repositories ไม่สร้าง contribution แต่ยังต้องอยู่ใน relevant input/freshness และ Land guards
- เก็บ pre/post movement สำหรับ copy และ worktree ด้วยข้อมูลที่ตรวจกลับได้ รวม content movement ที่ HEAD คงเดิม โดยใช้ state/journal เดิมและ schema evolution ที่จำเป็น
- ต่อ `receiptRebind`, `workspaceReuse` และ proof rebind เดิม เก็บ original attempt digest และ acceptance provenance
- การขยาย reuse ข้าม content movement ต้องใช้ขอบเขตที่ A รับรอง; หากยังยืนยัน non-impact ไม่ได้ ให้ invalidated ต่อ พร้อมเหตุผล ไม่เปิด optimization โดยเดา

ตรวจรับ: unrelated movement ที่เข้าเงื่อนไข reuse ไม่ dispatch reviewer เพิ่ม; missing identity/mixed-mode omission ไม่ผ่าน; contribution/contract ที่เปลี่ยนไม่ใช้ verdict เก่า; ไม่มี HEAD/index mutation จากการอ่าน identity

### C — Sync และ proof invalidation ตาม input ที่เปลี่ยน

ขนาด: M; dependency A และ B สำหรับ copy reuse

- ให้ sync สร้าง before/after summary จาก snapshots/fingerprints ที่มี: contribution, packet, execution inputs, repository movement, conflicts และ setup/environment inputs ที่ contract ติดตาม
- No-op sync ต้องไม่ลบ valid proof หรือทำให้ต้อง dispatch งานซ้ำเพียงเพราะเรียกคำสั่งเดิม; revision ที่เป็น audit counter ต้องไม่กลายเป็น evidence invalidation โดยอ้อม
- เมื่อ relevant content เปลี่ยน proof รวมยังต้อง invalidated/ประกอบใหม่ให้ถูกต้อง แต่เก็บ valid receipts แล้วให้ proof execution เดิมเลือก rerun
- เปลี่ยน lifecycle projection ผ่าน reducer/phase owner เดิม ตรวจว่า state ไม่รายงาน proven/archived เมื่อมี stale inputs หรือ conflict; แยก proof freshness จาก target readiness และ Land authority
- Reuse setup/build artifacts ตามกลไกเดิมเมื่อ inputs ยัง valid; ไม่ใช้ cache จากนอก declared isolated workspace
- ไม่เปลี่ยน provider inputs เป็น inferred narrow patterns อัตโนมัติ; declaration เดิมยังต้องครอบคลุม dependency/configuration ของ command

ตรวจรับ: sync ซ้ำบน inputs เดิมไม่เพิ่ม reviewer/provider execution; checks ที่กระทบ rerun และ checks ที่ valid reuse; proof ใหม่ผูกกับ snapshot ปัจจุบัน; stale Land grant ไม่กลับ valid เพียงเพราะ review reuse

### D — อธิบาย invalidation และวัด effort

ขนาด: S–M; ส่งพร้อม B/C ได้เมื่อ vocabulary จาก A คงที่

- ต่อ invalidation metadata, feedback, proof plan และ resume projection เดิม โดยแสดงว่า reuse/rebind/rerun เพราะอะไร พร้อม affected paths/repos เท่าที่มีหลักฐาน
- แยกสาเหตุ: contribution, agreement, dependency/context, provider config/version, legacy identity, conflict และ unknown coverage; ระบุว่าเป็น source-derived result หรือข้อมูล unavailable
- บันทึก actual reviewer dispatch count, execution count, reused receipts และ phase duration จาก telemetry เดิม; ไม่เพิ่ม ledger อีกชุด
- Dashboard ใช้ canonical projection ไม่คำนวณ validity เอง; diagnostics export เพิ่มเฉพาะ allowlisted fields และไม่เผย secret/absolute path โดยปริยาย
- ไม่รายงาน token ที่ประหยัดได้จากการเดา; report จำนวน dispatch ที่ไม่เกิดได้ แต่ต้นทุน counterfactual ต้องมีการวัดเปรียบเทียบ

ตรวจรับ: ผู้ใช้เห็นเหตุผลก่อน review ใหม่; CLI/feedback/dashboard ไม่ขัดกัน; unavailable measurements ไม่เป็นศูนย์; อธิบายได้ว่าช้าเพราะ full review, retry หรือ executable checks

### E — Dependency-aware impact review แบบมีขอบเขต

ขนาด: L; เริ่มเมื่อ B–D ให้ข้อมูลว่าการ review ที่ยังเหลือมีต้นทุนจริง และ A ระบุข้อจำกัด reuse ชัดแล้ว

1. ออกแบบ review subject จาก agreement, contribution, shared contracts, provider/grounding references และ input boundaries ที่เชื่อถือได้ พร้อม freshness identity; observed read-set เป็นข้อมูลประกอบเท่านั้น
2. ใช้ explicit project-owned dependencies และข้อมูลที่มีอยู่ก่อน ไม่สร้าง cross-language dependency analyzer เต็มระบบในรอบแรก; dynamic imports, global config และ missing coverage ต้องมี conservative route
3. สร้าง packet ผลกระทบจากฐานที่ review เดิมผูกไว้ถึงฐานปัจจุบัน รวม incoming delta, local conflict resolutions, claims ที่กระทบ, prior findings/closures และ current executable evidence
4. หาก A แล้ว C Land ก่อน B ตรวจเพิ่ม ให้ครอบคลุมการเปลี่ยนสะสมจาก binding ล่าสุดของ B ไม่อ้างอิงเฉพาะ `lastBaseMove` จนการเปลี่ยนก่อนหน้าหาย
5. ระบุ scope/purpose ใหม่ใน review contract โดยเลือก schema ที่เหมาะหลังตรวจ consumers; ห้ามใช้ correction-delta เดิมโดยไม่แก้ finding closure และ attempt validation ให้สอดคล้อง
6. คง fail/inconclusive/blockers เดิม ไม่ใช้ base movement ล้าง verdict; findings ใหม่ต้องผูก paths/claims/cases ที่ตรวจกลับได้
7. ระบุ route accounting, budget และ authority อย่างชัดเจน: ค่าใช้จ่ายจริงสะสมทั้งหมด, ไม่มี auto reset ของ quality/infra caps, ไม่มี unlimited review เพราะฐานเคลื่อน; เมื่อ scope กว้างหรือหลักฐานไม่พอ ใช้ bounded review/decision route ตาม contract ที่อนุมัติ
8. การเริ่มรอบเพิ่มเติมต้องอยู่ใน authority ที่มีจริง; public `reset-base-move` และ decision-reference semantics คงเดิมจนมี compatibility change ที่ตกลงชัดเจน
9. ถ้า target เปลี่ยนอีกระหว่างตรวจ ให้ reconcile และประเมินเฉพาะ input ใหม่; หยุดที่ conflict/resource/budget/repeated-no-progress boundary เดิมพร้อม exact resume route ไม่เพิ่ม global Land lock ยาวตลอดเวลาที่ reviewer ทำงาน

ตรวจรับ: related base movement ตรวจ scope ที่ครบโดยไม่ reopen untouched findings; repeated movement ไม่ทำ duplicate dispatch ขณะ lease valid; ไม่รับ stale asynchronous result; scope กว้างจนต้อง full review มีเหตุผลชัด; reviewer authority และ independence ไม่ลดลง

### F — Upgrade, documentation และ rollout

ขนาด: M; ทำต่อเนื่องในแต่ละ change ไม่รอ E เสร็จทั้งหมด

- Legacy receipt ที่ไม่มี identity/coverage คงอ่านได้แต่ห้าม fabricate binding; ยอมให้ต้อง review ใหม่หนึ่งครั้งเมื่อใช้ receipt เก่าไม่ได้ พร้อมคำอธิบาย ไม่รับรอง migration แบบ zero review
- Pin provider/review/runtime protocol เฉพาะ wire contract ที่เปลี่ยนจริง; ตรวจ pins ของ runtime ทั้งสี่ตาม CLAUDE.md และ upgrade coverage ที่เกี่ยวข้อง
- Public command names/arguments คงเดิม; เพิ่ม registry/schema fields เฉพาะจำเป็นและดู parser compatibility
- ตรวจ install.sh MANAGED เมื่อเพิ่ม shipped module และ clean-install consumer ไม่พึ่ง upstream reports/tests
- ปรับ EVIDENCE.md/WORKFLOW.md เป็น contract หลัก; README EN/TH และ website EN/TH สรุปและลิงก์ ไม่คัดลอก contract ไปหลายแห่ง
- แยก release evidence ตาม immutable source cohort; deterministic checks ไม่ใช่ paid/live assurance; paid scenarios และ publish ต้องมี authority แยก
- Rollback optimization ผ่านการกลับ implementation/policy ที่เข้ากันได้และ conservative validity ห้าม downgrade แล้วทำให้ receipts ใหม่ดูเหมือน valid โดยไม่ได้ตรวจ version

## Regression และการตรวจรับใน implementation

รอบวางแผนนี้ไม่รันทดสอบ ตารางนี้เป็นงานที่จะทำเมื่อเข้าสู่ implementation ใช้ suite เดิมตาม [suite ownership](../../.claude/tests/README.md) ก่อนเพิ่ม suite ใหม่

| กรณี | ผลที่ต้องตรวจ | Boundary หลัก |
| --- | --- | --- |
| No-op sync, task checkbox เท่านั้น, history-only base movement | ไม่มี reviewer/provider execution เพิ่มเมื่อ binding ยัง valid | sandbox/state/proof |
| A Land แบบ uncommitted → B copy sync | contribution/impact ที่ไม่เปลี่ยน reuse ตาม contract; HEAD/index ของ target คงเดิม | copy/rebind/Land |
| Worktree รับ commit ใหม่และ new-file staged/untracked representation เปลี่ยน | ไม่ invalidate เพราะ index representation เพียงอย่างเดียว | diff identity/base-move |
| Patch context เปลี่ยนแต่ contribution ดูเหมือนเดิม | จำแนก conservative invalidation และไม่ normalize จนซ่อน meaningful context | normalized digest |
| Shared API/schema/config/lockfile เปลี่ยน แต่ B diff เดิม | ไม่ใช้ diff equality ข้าม relevant impact; checks/review ที่ต้องทำไม่หาย | validity/impact |
| Mixed copy/worktree + read-only producer | repository ไม่หลุดจาก relevant binding; read-only ไม่เป็น Land target | composite snapshot |
| Binary/delete/rename/symlink/mode และ copy baseline ไม่ครบ | identity ตาม Apply semantics หรือ fail closed โดยไม่อ่านออกนอก workspace | sandbox identity |
| Conflict resolved, contract amended, provider/version changed | binding เก่าใช้ไม่ได้ตามเหตุ; ไม่ล้าง findings หรือ authority | validity/review |
| Failed/inconclusive prior review แล้วฐานเคลื่อน | movement ไม่เปลี่ยนเป็น pass หรือ reset รอบอัตโนมัติ | review history |
| A/C Land สะสมก่อน B review, restart หลัง rebind, duplicate/delayed result | incoming delta ไม่หาย, journal/history ถูกต้อง, ไม่มี dispatch/apply ซ้ำ | history/proof/leases |
| Target เปลี่ยนหลัง proof และ interruption ระหว่างหลาย repo Land | revalidate target/grant; recovery เดิม; HEAD/index/user diff ปลอดภัย | Land saga |
| Legacy/corrupt/tampered identity หรือ acceptance | ไม่ backfill ความยินยอม ไม่แก้ immutable chain ไม่บันทึก unavailable เป็น pass | upgrade/provenance |

ช่วง implementation: focused deterministic regressions ที่ต่ำที่สุด → affected suite ระหว่างแก้ → authoritative `rtk test bash .claude/tests/run-all.sh` สำหรับ shipped changes ก่อน commit ตามกติกา repo; docs consistency และ website build เมื่อแตะขอบเขตนั้น; `rtk git diff --check` ทุกชุดส่งมอบ ไม่รัน paid scenarios จากแผนนี้

## การวัดว่าคุ้มจริง

ใช้ scenario/workload และ source cohort ที่บันทึกไว้ เปรียบเทียบก่อน–หลัง แยก mode, repo count, movement type และ policy:

- จำนวน full review, correction delta, impact review และ infrastructure retries ต่อ change
- Provider executions/reused receipts, identity/sync computation duration และ packet bytes
- เวลาจาก review แรกถึง archived และเวลารอ authority แยกจากเวลาประมวลผล
- Token/cost เฉพาะที่ host วัดได้; test double dispatch count ไม่ใช่ live model efficiency
- ความถูกต้อง: ไม่มี stale evidence acceptance, unauthorized Land, HEAD/index mutation หรือ user-work overwrite ใน fixture ที่กำหนด

เกณฑ์ B–D: eligible non-impact sync ต้องไม่มี reviewer dispatch เพิ่ม; no-op ต้องไม่มี provider executions เพิ่ม; impacted inputs ต้อง rerun; receipt/attempt history ต้องตรวจผ่าน เกณฑ์ performance ใช้ baseline กำหนดก่อนปรับ ไม่สัญญาตัวเลขประหยัดล่วงหน้า และต้องรายงาน overhead ของ hashing/impact analysis ด้วย

เกณฑ์เริ่ม E: ยังมี recurring base-impact full reviews ที่ D วัดได้และมี dependency boundary ที่นิยามได้ หาก B–D เพียงพอ ให้จบ release รอบแรกโดยเก็บ E เป็น follow-up ไม่ทำเพื่อให้ครบฟีเจอร์

## แบ่ง delivery และลำดับลงมือ

| ชุด | Candidate scope | Dependency | ผลส่งมอบ |
| --- | --- | --- | --- |
| A | investigation + reuse contract decision | ไม่มี | confirmed gaps, compatibility decision, baseline |
| B | `preserve-review-reuse-across-sandbox-modes` | A | mode-complete identities และ conservative reuse |
| C | `preserve-valid-evidence-across-sandbox-sync` | A; B สำหรับ copy | no-op sync และ selective invalidation |
| D | `explain-sync-review-invalidation` | vocabulary A | explanation และ measured reuse/dispatch |
| E | `review-base-movement-impact` | B–D + measured need | versioned bounded impact review contract |
| F | upgrade/docs/rollout ในแต่ละชุด | change ที่เกี่ยวข้อง | compatibility และ source-bound evidence |

Candidate names ยังไม่ใช่ change ที่สร้างแล้ว แต่ละชุดใช้ draft v3 → compiled OpenSpec packet → isolated Build → Prove → explicit Land → archived; tasks.md ของ change เป็น implementation ledger ไม่ใช้ checkboxes ในรายงานนี้แทน หลังแต่ละชุดประเมินประโยชน์ก่อนเปิดชุดถัดไป

รอบแรกที่เสนอคือ A → B → C พร้อม D และ F ตามส่วนที่เกี่ยวข้อง E เป็นส่วนของแผนทั้งหมดแต่ยังไม่ควรลงทุนจนมีหลักฐาน ขณะนี้มีเพียงเอกสารแผน ไม่ได้ให้คำรับรองว่าปัญหาเคสจริงแก้แล้วหรือว่าจะมีประสิทธิภาพสูงสุด
