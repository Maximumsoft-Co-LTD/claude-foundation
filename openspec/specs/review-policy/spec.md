# review-policy Specification

## Purpose
TBD - created by archiving change opt-in-self-review-independence-waiver. Update Purpose after archive.
## Requirements
### Requirement: Reviewer independence is waivable only by committed project policy

The system SHALL read reviewer-independence policy from `foundation.json`
`review.independence`, accepting `required` or `self` and defaulting to
`required`. Any other value SHALL fail the policy read. The system SHALL NOT
accept a command flag, environment variable, or receipt field that waives
reviewer independence.

#### Scenario: An unknown independence value is refused

- **WHEN** `foundation.json` declares `review.independence` as anything other
  than `required` or `self`
- **THEN** the harness fails naming `foundation.json review.independence must
  be required|self`

#### Scenario: A project that never opts in is unaffected

- **WHEN** `foundation.json` omits `review.independence`
- **THEN** the review policy reports `independence: "required"`, carries no
  `independenceWaived` field and no independence trigger, and produces the same
  contract fingerprint it produced before the waiver existed

### Requirement: A configured self-review waiver is named in the record

The system SHALL, when `review.independence` is `self`, report the review
policy as `independence: "self"` with `independenceWaived: true` and an
`independence-waived-self-review` trigger, and SHALL carry that policy into the
review packet, the external authority request requirements, and the recorded
review receipt.

#### Scenario: The waiver reaches the review packet

- **WHEN** a review packet is printed for a change in a project that declared
  `review.independence: "self"`
- **THEN** the packet's review policy names the
  `independence-waived-self-review` trigger

### Requirement: A waived review may share the implementer's identity and session

The system SHALL accept a review receipt, including a passing one, whose
reviewer shares an identity or session with an implementation subject when and
only when the project policy waives independence, and SHALL apply the waiver at
every impact level and trigger. The system SHALL record the observed
independence truthfully as `review.policy.independent: false` rather than
asserting independence the review did not have.

#### Scenario: A same-session reviewer passes under the waiver

- **WHEN** a review receipt is recorded whose reviewer identity and session
  match the implementation subject, in a project that declared
  `review.independence: "self"`
- **THEN** the receipt is written with status `pass`, records
  `review.policy.independent` as `false` and `review.policy.independenceWaived`
  as `true`, and remains valid on re-read

#### Scenario: Independence still blocks without the waiver

- **WHEN** the same receipt is attempted in a project that did not declare
  `review.independence: "self"`, including one that declared
  `review.diversity: "single-model"`
- **THEN** the write fails naming reviewer independence, and any receipt
  already written reads back as `review-not-independent`

#### Scenario: Removing the waiver invalidates a recorded self-review

- **WHEN** `review.independence: "self"` is removed from `foundation.json`
  after a self-review receipt was recorded
- **THEN** that receipt stops counting as evidence, reading back as
  `contract-stale` because the review policy is part of the contract
  fingerprint and withdrawal moves it

#### Scenario: The waiver relaxes nothing else

- **WHEN** a self-review is recorded under the waiver
- **THEN** a passing review still requires an explicit unresolved-blocker count
  of zero, reviewer diversity is still governed by `review.diversity`, and the
  two-round AI ceiling and attempt hash chain still apply

### Requirement: Review effort follows deterministic risk tiers

Foundation SHALL classify every change as low, medium, or high using the
strictest declared risk, observed surface capability, and correction behavior.
Low SHALL require one AI full review. Medium and high SHALL permit one AI full
review and, only after correction, one fresh-session delta closure. High-risk
material decisions SHALL be asked in the initial Decision Sheet and SHALL NOT
create a mandatory human approval gate during Prove. No tier SHALL dispatch a
third AI except one closure review: when the second wave failed, its findings
were repaired, and deterministic closure cannot close them, Foundation SHALL
request one fresh-session delta review of the repaired workspace before any
user decision, and SHALL NOT dispatch a fourth.

Reviewer executable, authentication, entitlement, timeout, or transport errors
SHALL NOT create a delivered baseline or consume a correction wave. Foundation
MAY run one bounded full infrastructure retry. Exhausting delivered waves SHALL
refuse another open review without asking a generic redesign/split/pause
question; remaining work SHALL be classified as in-contract repair, a material
contract decision, or an external-authority wait.
A blocker or major finding delivered by the final AI delta SHALL name its
affected claims and predeclared verification cases. After an in-contract fix,
Foundation SHALL close exactly those finding IDs only when every bound
non-review receipt is current and passing; that deterministic closure SHALL be
hash-chained and SHALL NOT count as a third AI wave.

#### Scenario: A clean low-risk change finishes after one AI

- **WHEN** the full AI review passes and no production correction is made
- **THEN** review completes without a second AI or human request

#### Scenario: A corrected medium change receives closure only

- **WHEN** a medium change fixes the complete first-round finding batch
- **THEN** the second packet contains only changed artifacts and finding IDs,
  and the reviewer cannot reopen unchanged surface

#### Scenario: A high-risk change asks once and stays AI-bounded

- **WHEN** a change affects money, authorization, secrets, destructive data,
  concurrency, replay/idempotency, queue semantics, external wire contracts,
  legacy activation, or production cutover
- **THEN** the developer answers the material risk in the initial Decision Sheet,
  one full AI review runs, and one delta is available only after correction

#### Scenario: The configured reviewer fails before delivering a verdict

- **WHEN** the reviewer executable, model, authentication, timeout, or transport
  fails and no pass, fail, or inconclusive verdict is delivered
- **THEN** the prior receipt remains unchanged, one full infrastructure retry
  is available, and no product question or delta baseline is fabricated

#### Scenario: Delivered review waves are complete

- **WHEN** the risk route has received every allowed full/closure verdict
- **THEN** another open-ended AI dispatch is refused and the workflow routes
  remaining work without presenting generic redesign, split, or pause choices

#### Scenario: The final delta finds an in-contract defect

- **WHEN** the second AI reports a blocker with claim and critical-case bindings,
  the implementation repairs it, and all bound providers pass on the new workspace
- **THEN** Foundation records a deterministic repair closure for those exact
  finding IDs and continues Prove without AI round three or human approval

#### Scenario: The repaired final delta has no critical-case binding

- **WHEN** the second AI fails, the implementation repairs its findings, and
  no declared critical case can close them deterministically
- **THEN** Foundation requests one closure review of the repaired workspace
- **AND** only when that closure review also fails and its repair cannot close
  does Prove stop at the review-exhausted user decision

#### Scenario: Deterministic closure evidence changes

- **WHEN** a receipt bound into final repair closure is modified, stale, missing,
  failing, or no longer covers the declared claim and case
- **THEN** the review receipt becomes invalid and Land remains blocked

#### Scenario: An approved contract revision follows deterministic closure

- **WHEN** a valid deterministic closure exists, a later Decision Sheet
  revision is locked and bound to the current contract, and every finding-bound
  non-review provider passes on the current workspace
- **THEN** Foundation appends a new deterministic closure preserving the
  original failed-delta lineage and continues without another AI or human gate

### Requirement: Codex and Claude Code are configured reviewer adapters

Foundation SHALL support Codex CLI and Claude Code CLI reviewers whose
executable, provider/model family, model ID, reasoning effort, read-only mode,
output schema, and session policy are configured separately from build model
tiers. Dispatch SHALL use the exact workspace without shell interpolation and
record truthful provider/model/session provenance.

By default a reviewer from the same provider and model family as an AI
implementer SHALL be rejected. A committed `review.diversity: single-model`
policy SHALL permit that reviewer while recording observed diversity as false
and the waiver as true. The reviewer SHALL still use an identity and fresh
session distinct from every implementation subject unless the separate
independence waiver is committed. A diversity waiver SHALL NOT waive
independence.

#### Scenario: Codex Sol reviews a non-OpenAI implementation

- **WHEN** `codex-sol` is selected for an eligible review
- **THEN** Foundation invokes a fresh ephemeral `codex exec` with
  `gpt-5.6-sol`, high reasoning, read-only sandbox, exact cwd and the review
  response JSON schema

#### Scenario: A Codex-only team uses a fresh same-family reviewer

- **WHEN** an OpenAI implementation selects `codex-sol`, the committed policy
  declares `diversity: single-model`, and Codex returns a fresh thread ID
- **THEN** Foundation accepts the review, records `diverse: false` and
  `diversityWaived: true`, and still rejects the coding session as the review
  session

#### Scenario: A Claude-Code-only team uses a configured reviewer

- **WHEN** `claude-opus` is selected for an Anthropic implementation
- **THEN** Foundation invokes a fresh non-persistent `claude --print` session
  with the configured model, high effort, plan/read-only tools, JSON Schema,
  exact cwd, and records the actual returned Claude session ID

#### Scenario: A same-family waiver is absent

- **WHEN** reviewer and implementation provider/model family match and policy
  still requires diversity
- **THEN** dispatch refuses before invoking the configured reviewer and names
  the committed `single-model` policy route

#### Scenario: Doctor finds the selected reviewer unavailable

- **WHEN** Codex or Claude Code is missing, unauthenticated, has an incompatible CLI/config,
  or the supplied implementation provenance cannot satisfy reviewer diversity
- **THEN** `doctor --stage prove` names local installation/login/upgrade checks,
  `authority run` rejects non-diverse provenance, and a remote model-entitlement
  failure is recorded as infrastructure failure without fabricating a review

### Requirement: Committed review waivers are visible before Prove

Foundation SHALL expose the effective reviewer-independence and model-diversity posture during doctor and change validation. A committed self-review or single-model waiver SHALL be named with its assurance consequence and SHALL NOT be presented as an independent or diverse review guarantee.

#### Scenario: Seeded policy permits both waivers

- **WHEN** doctor or change validation runs with independence self and diversity single-model
- **THEN** human and JSON output name both committed waivers, state that review may be non-independent and same-family, and preserve the existing readiness result

#### Scenario: Project requires full separation

- **WHEN** doctor or change validation runs with independence required and diversity required
- **THEN** output reports required independent and cross-family review and carries no waiver advisory

#### Scenario: Only one assurance property is waived

- **WHEN** exactly one of independence or diversity is configured as waived
- **THEN** output names only that waiver and reports the other property as required

### Requirement: Financial risk signal selects high review

ระบบ SHALL เลือก review tier high เมื่อ change ประกาศ riskSignals financial

#### Scenario: financial ได้ high

- **GIVEN** change มี riskSignals financial และ intent ไม่มีคำเกี่ยวกับเงิน
- **WHEN** harness คำนวณ review tier
- **THEN** tier เป็น high และ triggers มี financial

#### Scenario: ไม่มี signal คงพฤติกรรมเดิม

- **GIVEN** change ไม่มี riskSignals
- **WHEN** harness คำนวณ review tier
- **THEN** tier เท่ากับผลก่อน change นี้

### Requirement: Review findings may carry a stable code

ระบบ SHALL เก็บ field code ของ review finding เมื่อเป็น kebab-case ไม่เกิน 64 ตัวอักษร

#### Scenario: code ถูกเก็บ

- **GIVEN** review result มี finding code missing-authz
- **WHEN** harness บันทึก review attempt
- **THEN** finding ที่ normalize แล้วมี code missing-authz

#### Scenario: code ผิดรูปแบบไม่ block

- **GIVEN** finding code เป็น Missing Authz!
- **WHEN** harness บันทึก review attempt
- **THEN** attempt ถูกบันทึกและ finding ไม่มี code

#### Scenario: ไม่มี code

- **GIVEN** finding ไม่มี code
- **WHEN** harness บันทึก review attempt
- **THEN** digest และ chain ของ attempt เหมือนพฤติกรรมเดิม

### Requirement: worktype-no-tier

ระบบ SHALL ไม่ใช้ capability ที่ถูกบังคับเพราะ workType อย่างเดียวในการยกระดับ review และ SHALL ยังบังคับหลักฐานของ capability นั้นครบ

#### Scenario: api ที่ไม่มี risk อื่น

- **GIVEN** change ประกาศ workType api และ path ที่แก้ไม่บังคับ compatibility
- **WHEN** harness คำนวณนโยบาย review
- **THEN** ระดับ review ไม่มี trigger critical-capability หรือ risk-capability จาก compatibility และ compatibility ยังเป็นหลักฐานที่ต้องมี

#### Scenario: path บังคับ compatibility

- **GIVEN** path ที่แก้บังคับ compatibility ด้วย
- **WHEN** harness คำนวณนโยบาย review
- **THEN** compatibility ยังยกระดับ review เหมือนเดิม

### Requirement: review-rules-in-packet

ระบบ SHALL ใส่เนื้อหาและ hash ของ REVIEW.md ที่ root ของโปรเจกต์ลงใน AI reviewer packet เมื่อมีไฟล์นั้น

#### Scenario: มี REVIEW.md

- **GIVEN** root ของโปรเจกต์มี REVIEW.md ขนาดไม่เกิน 32 KiB
- **WHEN** harness ประกอบ reviewer packet
- **THEN** packet มี reviewRules ที่มี path REVIEW.md, hash sha256 ของเนื้อหา, เนื้อหาเต็ม และ advisory: true
- **AND** packet version เป็น reviewPacketSchema 7

#### Scenario: ไม่มี REVIEW.md

- **GIVEN** root ของโปรเจกต์ไม่มี REVIEW.md
- **WHEN** harness ประกอบ reviewer packet
- **THEN** packet ไม่มีฟิลด์ reviewRules และ prompt ของ reviewer ไม่มีส่วนเกณฑ์รีวิว

#### Scenario: REVIEW.md ว่าง

- **GIVEN** REVIEW.md มีแต่ whitespace
- **WHEN** harness ประกอบ reviewer packet
- **THEN** ถือเหมือนไม่มีไฟล์ packet ไม่มี reviewRules

#### Scenario: REVIEW.md ใหญ่เกิน

- **GIVEN** REVIEW.md ใหญ่กว่า 32 KiB
- **WHEN** harness ประกอบ reviewer packet
- **THEN** reviewRules มี hash และ omitted: "too-large" แต่ไม่มีเนื้อหา
- **AND** prompt บอก reviewer ว่าเกณฑ์ของโปรเจกต์ไม่ได้ส่งมาเพราะใหญ่เกิน

#### Scenario: อ่าน REVIEW.md ไม่ได้

- **GIVEN** REVIEW.md มีอยู่แต่อ่านไม่ได้ เช่น สิทธิ์ไฟล์ไม่พอ
- **WHEN** harness ประกอบ reviewer packet
- **THEN** รีวิวยังรันได้ reviewRules มี omitted: "unreadable" และไม่มี hash

#### Scenario: รอบรีวิวแบบส่งแค่ diff

- **GIVEN** REVIEW.md มีอยู่และเป็นรอบรีวิวแบบ diff-only
- **WHEN** harness ส่ง packet ให้ AI reviewer
- **THEN** reviewRules ยังอยู่ใน packet ไม่ถูกตัดออกเหมือนฟิลด์อื่นในรอบ diff-only

### Requirement: review-rules-advisory

ระบบ SHALL ใช้ REVIEW.md เป็นคำแนะนำเท่านั้นและไม่ให้มีผลต่อการตัดสินผ่านหรือไม่ผ่านของรีวิว

#### Scenario: prompt ระบุว่าเป็นคำแนะนำ

- **GIVEN** packet มี reviewRules ที่มีเนื้อหา
- **WHEN** harness สร้าง prompt ให้ configured reviewer
- **THEN** prompt มีเนื้อหา REVIEW.md ใต้หัวข้อที่ระบุว่าเป็นคำแนะนำ และบอกว่าห้ามใช้เป็นเหตุให้ไม่ผ่านเกินกว่า review contract

#### Scenario: ผลตัดสินเหมือนเดิม

- **GIVEN** reviewer ตอบผลเดียวกันสองครั้ง ครั้งหนึ่ง packet มี reviewRules อีกครั้งไม่มี
- **WHEN** harness บันทึก review receipt
- **THEN** status และ verdict ของ receipt ทั้งสองเหมือนกัน

### Requirement: review-rules-bind-receipt

ระบบ SHALL บันทึก hash ของ REVIEW.md ใน review receipt และถือว่ารีวิวเก่าเมื่อ hash ปัจจุบันไม่ตรงกับที่บันทึก

#### Scenario: บันทึก hash

- **GIVEN** packet มี reviewRules ที่มี hash
- **WHEN** harness บันทึก review receipt
- **THEN** receipt มี review.reviewRulesHash เท่ากับ hash ใน packet

#### Scenario: แก้ REVIEW.md หลังรีวิว

- **GIVEN** receipt มี reviewRulesHash และต่อมา REVIEW.md ถูกแก้
- **WHEN** harness ตรวจความใช้ได้ของ receipt
- **THEN** receipt เป็น stale ด้วยเหตุผล review-rules-changed

#### Scenario: ลบ REVIEW.md หลังรีวิว

- **GIVEN** receipt มี reviewRulesHash และต่อมา REVIEW.md ถูกลบ
- **WHEN** harness ตรวจความใช้ได้ของ receipt
- **THEN** receipt เป็น stale ด้วยเหตุผล review-rules-changed

#### Scenario: สร้าง REVIEW.md หลังรีวิว

- **GIVEN** receipt ถูกบันทึกโดยระบุว่าไม่มี REVIEW.md (reviewRulesHash: null) และต่อมามีการสร้างไฟล์
- **WHEN** harness ตรวจความใช้ได้ของ receipt
- **THEN** receipt เป็น stale ด้วยเหตุผล review-rules-changed

#### Scenario: REVIEW.md ไม่เปลี่ยน

- **GIVEN** receipt มี reviewRulesHash เท่ากับ hash ปัจจุบัน และ base ของ change ขยับเพราะ change อื่น land ก่อน
- **WHEN** harness ตรวจความใช้ได้ของ receipt
- **THEN** receipt ยังใช้ได้หรือ rebind ได้เหมือนก่อนมีฟีเจอร์นี้

#### Scenario: receipt เก่าก่อนอัปเกรด

- **GIVEN** receipt ไม่มีฟิลด์ reviewRulesHash เลย และโปรเจกต์มี REVIEW.md แล้ว
- **WHEN** harness ตรวจความใช้ได้ของ receipt
- **THEN** receipt ไม่ถูกทำให้เก่าด้วยเหตุผล review-rules-changed

### Requirement: starter-review-rules-seeded

installer SHALL ใส่ REVIEW.md ตั้งต้นที่ root ของโปรเจกต์เฉพาะเมื่อยังไม่มีไฟล์นั้น ทั้งตอนติดตั้งใหม่และอัปเกรด

#### Scenario: ติดตั้งใหม่

- **GIVEN** โปรเจกต์ยังไม่มี REVIEW.md
- **WHEN** รัน install.sh
- **THEN** REVIEW.md ถูกสร้างจาก .claude/harness/templates/REVIEW.md
- **AND** แผนติดตั้งแสดงบรรทัด + REVIEW.md

#### Scenario: อัปเกรดโปรเจกต์ที่ไม่มีไฟล์

- **GIVEN** โปรเจกต์ติดตั้ง Change Loop รุ่นก่อนแล้วและไม่มี REVIEW.md
- **WHEN** รัน install.sh เพื่ออัปเกรด
- **THEN** REVIEW.md ถูกสร้างจาก template

#### Scenario: มี REVIEW.md อยู่แล้ว

- **GIVEN** โปรเจกต์มี REVIEW.md ของตัวเอง
- **WHEN** รัน install.sh
- **THEN** REVIEW.md เหมือนเดิมทุก byte

#### Scenario: ติดตั้งล้มกลางทาง

- **GIVEN** โปรเจกต์ไม่มี REVIEW.md และการติดตั้งล้มหลังสร้างไฟล์แล้ว
- **WHEN** installer rollback
- **THEN** REVIEW.md ที่เพิ่งสร้างถูกลบออก

### Requirement: dispatched-review-binds-sent-rules

ระบบ SHALL บันทึก reviewRulesHash ของ AI review ที่ผ่าน dispatch จาก hash ที่ส่งไปกับ dispatch นั้น ไม่ใช่จากไฟล์ตอนบันทึก

#### Scenario: บันทึก hash ที่ส่งไป

- **GIVEN** AI review ถูก dispatch ขณะ REVIEW.md มี hash A
- **WHEN** บันทึก review receipt ด้วย --review-attempt ของ dispatch นั้น
- **THEN** receipt มี review.reviewRulesHash เท่ากับ A

#### Scenario: แก้ REVIEW.md ระหว่างรีวิว

- **GIVEN** AI review ถูก dispatch ขณะ REVIEW.md มี hash A และไฟล์ถูกแก้เป็น hash B ก่อนบันทึก receipt
- **WHEN** บันทึก receipt แล้วตรวจความใช้ได้
- **THEN** receipt บันทึก A และเป็น stale ด้วยเหตุผล review-rules-changed

#### Scenario: dispatch ตอนไม่มีเกณฑ์

- **GIVEN** AI review ถูก dispatch ขณะไม่มี REVIEW.md หรือไฟล์อ่านไม่ได้
- **WHEN** บันทึก receipt ด้วย --review-attempt
- **THEN** receipt มี review.reviewRulesHash เป็น null

#### Scenario: attempt รุ่นเก่าไม่มีฟิลด์

- **GIVEN** dispatch attempt ถูกสร้างก่อนอัปเกรดและไม่มีฟิลด์ reviewRulesHash
- **WHEN** บันทึก receipt ด้วย --review-attempt ของ attempt นั้น
- **THEN** receipt ใช้ hash ของ REVIEW.md ปัจจุบัน และ attempt ยังผ่านการตรวจเหมือนเดิม

#### Scenario: receipt ที่ไม่ผ่าน dispatch

- **GIVEN** บันทึก review receipt โดยไม่มี dispatch attempt (เส้นทาง reserve)
- **WHEN** บันทึก receipt
- **THEN** receipt ใช้ hash ของ REVIEW.md ปัจจุบัน

### Requirement: receipt-validity-without-rules-lookup

ระบบ SHALL ถือว่าไม่มีเกณฑ์รีวิวเมื่อ receipt validity ถูกสร้างโดยไม่มีฟังก์ชันอ่าน hash ของเกณฑ์

#### Scenario: ไม่ส่ง callback และ receipt บันทึก null

- **GIVEN** receipt validity ไม่มี currentReviewRulesHash และ receipt มี reviewRulesHash เป็น null
- **WHEN** ตรวจความใช้ได้ของ receipt
- **THEN** ผลเหมือนตอนไม่มีฟีเจอร์ REVIEW.md และไม่มี exception

#### Scenario: ไม่ส่ง callback แต่ receipt มี hash

- **GIVEN** receipt validity ไม่มี currentReviewRulesHash และ receipt มี hash
- **WHEN** ตรวจความใช้ได้ของ receipt
- **THEN** receipt เป็น stale ด้วยเหตุผล review-rules-changed

### Requirement: seeded-review-rules-staged

installer SHALL stage REVIEW.md เข้า git เฉพาะเมื่อ installer เป็นผู้สร้างไฟล์นั้นในรอบนั้น

#### Scenario: installer สร้างไฟล์

- **GIVEN** target เป็น git repository ที่ไม่มี REVIEW.md
- **WHEN** install.sh stage ไฟล์ที่ติดตั้ง
- **THEN** REVIEW.md อยู่ใน git index

#### Scenario: ไฟล์ของโปรเจกต์ที่ยังไม่ commit

- **GIVEN** target มี REVIEW.md ที่แก้แล้วยังไม่ stage
- **WHEN** install.sh stage ไฟล์ที่ติดตั้ง
- **THEN** REVIEW.md ยังไม่ถูก stage
