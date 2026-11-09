# Change: Bind the project's advisory REVIEW.md to every AI review

- **Change:** `bind-the-project-s-advisory-review-md-to-every-ai-review` · **Lane:** standard (impact or coupling above the rapid limit)
- **Review:** medium tier · **Owner:** unassigned · **Created:** 2026-11-09

## เหตุผล

ตอนนี้ AI reviewer อ่านแค่ diff, claim และ spec ของ change นั้น ทีมไม่มีที่เขียนเกณฑ์รีวิวถาวร เช่น รอบตรวจ ระดับความรุนแรง และสิ่งที่ยกเว้น และถ้าจะเพิ่มเกณฑ์แบบนี้ การแก้เกณฑ์หลังรีวิวก็ไม่ทำให้รีวิวเดิมถือว่าเก่า change นี้ให้ REVIEW.md ของโปรเจกต์เข้าไปใน reviewer packet ในฐานะคำแนะนำ และผูก hash ของไฟล์ไว้ใน receipt

## ขอบเขต

- REVIEW.md ที่ root ของโปรเจกต์เข้า AI reviewer packet พร้อม hash
- prompt ของ reviewer ระบุว่าเป็นคำแนะนำ
- review receipt บันทึก reviewRulesHash และรีวิวเก่าเมื่อ hash เปลี่ยน
- installer ใส่ REVIEW.md ตั้งต้นเมื่อยังไม่มีไฟล์
- reviewPacketSchema 6 → 7

- **In scope (`review-policy`):** AI reviewer เห็นเกณฑ์รีวิวของโปรเจกต์ในทุกรอบ รวมรอบที่ส่งแค่ diff; ผลรีวิวผ่าน/ไม่ผ่านตัดสินจาก review contract เดิมเหมือนตอนไม่มี REVIEW.md; การสร้าง แก้ หรือลบ REVIEW.md หลังรีวิวทำให้ต้องรีวิวใหม่ ส่วน receipt เก่าที่ไม่มี hash ยังใช้ได้; ทุกโปรเจกต์ได้เกณฑ์รีวิวตั้งต้นที่แก้ได้ และ REVIEW.md ที่มีอยู่ไม่ถูกแตะ
- **Out of scope:** edits outside `.claude/harness/runtime/workflow/packet-runtime.mjs`, `.claude/harness/runtime/workflow/authority-runtime.mjs`, `.claude/harness/runtime/evidence/configured-reviewer.mjs`, `.claude/harness/runtime/core/diagnostics-runtime.mjs`, `.claude/harness/foundation.mjs`, `.claude/harness/protocol.json`, … +18 more; the authored Non-goals below

## Non-goals

- ให้ finding ที่อ้าง REVIEW.md เปลี่ยนผลผ่าน/ไม่ผ่าน
- REVIEW.md แยกต่อ repository ในงานหลาย repository
- ให้ human reviewer ต้องยืนยันว่าอ่าน REVIEW.md
- แก้ REVIEW.md ของ repository claude-foundation เอง

## ผลกระทบและความเสี่ยง

- ทุกโปรเจกต์ที่อัปเกรดจะได้ REVIEW.md ใหม่หนึ่งไฟล์ถ้ายังไม่มี ไฟล์นี้จะโผล่ใน git status ของโปรเจกต์
- receipt เก่าที่ไม่มี hash ยังใช้ได้ จึงไม่มีรีวิวไหนต้องรันใหม่ทันทีหลังอัปเกรด
- หลังอัปเกรด การแก้ REVIEW.md ทำให้รีวิวของ change ที่ค้างอยู่ต้องรันใหม่ เสียเวลาและค่า model ต่อ change
- reviewProtocol คงเดิม receipt ที่มีอยู่จึงไม่ถูกทำให้เก่าเพราะเวอร์ชัน

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** none detected

## บันทึกการตัดสินใจของผู้ใช้

ผู้ใช้ตัดสินเมื่อ 2026-11-09:

- REVIEW.md เป็นคำแนะนำทั้งหมด finding ใด ๆ ไม่เปลี่ยนผลผ่าน/ไม่ผ่าน
- receipt ที่ทำก่อนอัปเกรดและไม่มี reviewRulesHash ยังใช้ได้ ไม่ต้องรีวิวใหม่
- installer ใส่ REVIEW.md ตั้งต้นทั้งตอนติดตั้งใหม่และอัปเกรด เฉพาะเมื่อยังไม่มีไฟล์ และไม่เขียนทับ

## การสื่อสาร การดูแลหลังปล่อย และ release note

### Release note

AI review now reads the project's REVIEW.md as advisory guidance, and editing REVIEW.md asks for a fresh review. New and upgraded installs get a starter REVIEW.md when none exists.

## วิธีตรวจด้วยตัวเอง

1. สร้าง REVIEW.md ในโปรเจกต์ตัวอย่าง แล้วรัน Prove ของ change ที่มี AI review
2. เปิด review receipt จะเห็น reviewRulesHash
3. แก้ REVIEW.md หนึ่งบรรทัด แล้วรัน Prove อีกครั้ง รีวิวต้องรันใหม่ด้วยเหตุผล review-rules-changed
4. ลบ REVIEW.md แล้วรัน install.sh จะได้ไฟล์ตั้งต้นกลับมา ส่วนไฟล์ที่แก้เองจะไม่ถูกเขียนทับ

## เกณฑ์ผ่าน

Task: `tasks.md`; scenario: ใน specs

| Requirement | Scenario | ชนิด | Task | Check | Decision |
|---|---|---|---|---|---|
| review-rules-in-packet | มี REVIEW.md | success | T001, T004 | test: `.claude/harness/tests/packet-value.test.mjs`, `.claude/harness/tests/configured-reviewer.test.mjs`, `.claude/harness/tests/diagnostics-runtime.test.mjs`, `.claude/tests/harness/run-feedback-review-tests.sh` | — |
|  | รอบรีวิวแบบส่งแค่ diff | success | T001, T004 |  |  |
|  | ไม่มี REVIEW.md | boundary | T001, T004 |  |  |
|  | REVIEW.md ว่าง | boundary | T001, T004 |  |  |
|  | REVIEW.md ใหญ่เกิน | boundary | T001, T004 |  |  |
|  | อ่าน REVIEW.md ไม่ได้ | failure | T001, T004 |  |  |
| review-rules-advisory | prompt ระบุว่าเป็นคำแนะนำ | success | T001, T002, T004 | test: `.claude/harness/tests/packet-value.test.mjs`, `.claude/harness/tests/configured-reviewer.test.mjs`, `.claude/harness/tests/diagnostics-runtime.test.mjs`, `.claude/tests/harness/run-feedback-review-tests.sh`, `.claude/harness/tests/receipt-validity.test.mjs` | — |
|  | ผลตัดสินเหมือนเดิม | boundary | T001, T002, T004 |  |  |
| review-rules-bind-receipt | บันทึก hash | success | T002, T004 | test: `.claude/harness/tests/receipt-validity.test.mjs` | — |
|  | REVIEW.md ไม่เปลี่ยน | success | T002, T004 |  |  |
|  | ลบ REVIEW.md หลังรีวิว | boundary | T002, T004 |  |  |
|  | สร้าง REVIEW.md หลังรีวิว | boundary | T002, T004 |  |  |
|  | receipt เก่าก่อนอัปเกรด | boundary | T002, T004 |  |  |
|  | แก้ REVIEW.md หลังรีวิว | failure | T002, T004 |  |  |
| starter-review-rules-seeded | ติดตั้งใหม่ | success | T003, T004 | test: `.claude/tests/harness/run-installer-tests.sh` | — |
|  | อัปเกรดโปรเจกต์ที่ไม่มีไฟล์ | success | T003, T004 |  |  |
|  | มี REVIEW.md อยู่แล้ว | boundary | T003, T004 |  |  |
|  | ติดตั้งล้มกลางทาง | failure | T003, T004 |  |  |

## นิยามของงานเสร็จ

- Fresh evidence for every claim (18).
- Changed tests fail on the original code.
- Review: risk-tiered AI review (medium tier, standard model).
- Land archives it; Land never commits.
- Success: acceptance scenarios above pass.

## ภาคผนวก: ความครอบคลุมของการสำรวจ

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| current-behavior | covered | review-rules-in-packet, review-rules-bind-receipt |  |  |
| compatibility | covered | review-rules-bind-receipt, review-rules-in-packet |  |  |
| non-goals | covered | review-rules-advisory |  |  |
| input-boundary | covered | review-rules-in-packet |  |  |
| data-migration | covered | review-rules-bind-receipt |  |  |
| rollout-rollback | covered | starter-review-rules-seeded, review-rules-bind-receipt |  |  |
| recoverability | covered | review-rules-in-packet, starter-review-rules-seeded |  |  |

## ภาคผนวก: ข้อมูลที่ harness สร้าง

- **Failure matrix:** read from the failure scenarios (3); recovery is "No separate step; the outcome is the handling" where unstated.
- **Evidence capabilities:** defaulted to `test` (`static-analysis` for docs/chore) for review-rules-in-packet, review-rules-advisory, review-rules-bind-receipt, starter-review-rules-seeded.

## ภาคผนวก: ผล review

| รอบ | ข้อค้นพบ | ความรุนแรง | การแก้ไข | ผู้ review |
|---|---|---|---|---|
| 1 | f-receipt-hash-recomputed: `review.reviewRulesHash` is recomputed from disk with `reviewRulesHash(ROOT)` when the receipt is recorded. It is not read from the dispatched packet's `reviewRules.hash`. If `REVIEW.md` is edited after dispatch but before the receipt, the receipt binds a hash the reviewer never saw, and it stays valid. The impact is small because the rules are advisory. Reading the hash from `scope.dispatched` or the packet would match the spec text 'equal to the hash in the packet'. (root/.claude/harness/runtime/evidence/receipt-runtime.mjs:958) | minor | ยังเปิดอยู่ | claude-opus |
| 1 | f-prompt-heading: The prompt appends an advisory sentence ('packet.reviewRules holds the project's REVIEW.md. It is ADVISORY…'). It has no section headed 'Project review rules (advisory)', which `EVIDENCE.md` and the spec describe. The content is carried only inside the JSON payload. The behavior is acceptable, but the docs and code differ. (root/.claude/harness/runtime/evidence/configured-reviewer.mjs:338) | minor | ยังเปิดอยู่ | claude-opus |
