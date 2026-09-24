# change

## ADDED Requirements

### Requirement: Pre-Build agreements revise in place

Foundation SHALL ให้ `change revise <change> <draft.json>` คอมไพล์ semantic draft ฉบับแก้ไขทับ change เดิมที่ยังไม่เริ่ม Build ใน id เดิมแบบ transaction เดียว ผ่าน intake gate เดียวกับ `change start` เพิ่ม contract revision ล้าง spec approval เดิม รายงาน requirement delta และคืนสถานะ packet กับ runtime เดิมทั้งหมดเมื่อขั้นใดล้มเหลว

#### Scenario: Revise an agreed change before Build

- **WHEN** change เวอร์ชัน 4 ที่ AGREED ไม่มี workspace และไม่มี receipt ถูกส่ง `change revise <change> <draft.json> --inspect` จนได้ `DONE` แล้วรันด้วย `--consume-draft`
- **THEN** packet ใน `openspec/changes/<change>/` ถูกแทนด้วยผลคอมไพล์ใหม่ใน id เดิม contractRevision เพิ่มขึ้น 1 specApproval กลับเป็น required และผลลัพธ์แสดง `REVISED <change>` พร้อม requirement key ที่ added/revised/removed และคำสั่ง approve ถัดไป

#### Scenario: A failed revision restores the prior agreement

- **WHEN** การคอมไพล์ materialize หรือ strict validation ของ draft ฉบับแก้ไขล้มเหลว
- **THEN** ไฟล์ packet และ runtime state ของ change เดิมถูกคืนตรงทุกไบต์ ไม่มีไฟล์ staging เหลือ และ error ระบุว่า revision ถูก rollback

#### Scenario: Revision is refused once Build started

- **WHEN** change มี workspace ของ Build แล้ว มี receipt แล้ว หรืออยู่ในสถานะ proven, landing หรือ archived
- **THEN** คำสั่งถูกปฏิเสธโดยไม่แก้ไฟล์ใด และบอกเส้นทาง `change amend <change> <amendment.json> --inspect` หรือ successor change ตามสถานะ

#### Scenario: The revised draft keeps the change identity

- **WHEN** draft ฉบับแก้ไขระบุ `id` ที่ไม่ตรงกับ change หรือ change ไม่มีอยู่ หรือเป็น agreement แบบ legacy
- **THEN** คำสั่งถูกปฏิเสธก่อนแตะ packet; draft ที่ไม่ระบุ `id` ใช้ id ของ change

#### Scenario: A version-4 revision passes the same intake gate

- **WHEN** draft ฉบับแก้ไขเป็นเวอร์ชัน 4 และยังไม่ผ่าน `--inspect` จนได้ `DONE` หรือ source เปลี่ยนหลัง inspect
- **THEN** `--consume-draft` ถูกปฏิเสธพร้อม resume route `change revise <change> <draft.json> --inspect` และ intake state แยก namespace จาก `change start` ของ draft path เดียวกัน

### Requirement: Revised agreements report their approval delta

Foundation SHALL บันทึก requirement delta ของ revision หรือ amendment ล่าสุด (key ที่ added, revised และ removed) ไว้ใน runtime state แสดง delta นั้นในผลลัพธ์ของคำสั่ง และให้ `change resolve --approve-spec` แสดงและล้าง delta เมื่อบันทึก approval โดย approval ยังผูก identity ของ agreement ทั้งฉบับ

#### Scenario: A revision records the pending approval delta

- **WHEN** `change revise` หรือ `change amend` สำเร็จ
- **THEN** runtime state มี `pendingApprovalDelta` ที่มี added/revised/removed requirement keys และ revision และผลลัพธ์ของคำสั่งแสดงรายการเดียวกัน

#### Scenario: Approving a revision clears its delta

- **WHEN** ผู้ใช้ approve และ agent รัน `change resolve <change> --approve-spec --decision-ref <ref>`
- **THEN** ผลลัพธ์แสดง delta ที่ถูก approve specApproval ผูก identity ของ agreement ปัจจุบัน และ `pendingApprovalDelta` ถูกล้าง

#### Scenario: Unapproved revisions accumulate one delta

- **WHEN** มี revision หรือ amendment มากกว่าหนึ่งครั้งก่อนการ approve
- **THEN** delta ถูกรวมเป็นชุดเดียวโดย key ที่เพิ่มแล้วลบภายหลังหายไป และ key ที่เพิ่มแล้ว revise ยังนับเป็น added

### Requirement: The public command contract freezes change revise

Foundation SHALL บันทึก `change revise` ใน golden public command contract เพื่อให้การเปลี่ยน usage, audience, kind หรือ idempotency ของคำสั่งนี้ถูกตรวจพบเป็น contract change

#### Scenario: The golden contract includes change revise

- **WHEN** registry คำสั่ง public มี `change revise` และ test golden contract ถูกรัน
- **THEN** จำนวนและ digest ของคำสั่ง CLI public ตรงกับ fixture และ `change revise --help` ตอบกลับสำเร็จโดยไม่แก้ไฟล์

## MODIFIED Requirements

### Requirement: Active semantic agreements amend transactionally

Foundation SHALL ใช้ semantic amendment หนึ่งฉบับกับ agreement เวอร์ชัน 3 หรือ 4 ที่ active เป็น transaction ที่ผ่าน validation โดยรักษา checkbox ของ task ที่เสร็จแล้วและส่วน Markdown ที่เขียนเอง เพิ่ม แก้ไข หรือลบ requirement ได้ด้วย key ที่เสถียร invalidate เฉพาะ claim ที่เพิ่มหรือเปลี่ยน วางแผนการลบจาก binding ของ claim เดิม และคืนทั้ง packet และ runtime state เมื่อ validation ล้มเหลว

#### Scenario: Build discovers new required behavior

- **WHEN** the agent submits one amendment that adds requirements and maps them to an existing or new implementation task
- **THEN** Foundation updates the same active change, increments its revisions, and returns the exact `advance` resume route

#### Scenario: A version-4 amendment adds behavior

- **WHEN** an amendment targets a version-4 agreement
- **THEN** Foundation requires complete discovery coverage for the added requirements and appends the validated delta to the proposal

#### Scenario: A version-4 amendment is inspected before mutation

- **WHEN** Build discovers new observable behavior in a version-4 agreement
- **THEN** the amendment uses the same bounded repository discovery, source acknowledgement, adaptive depth, question-quality, freshness, and resumable DONE gate as initial Change intake before it may mutate the packet

#### Scenario: Amendment invalidation is planned before mutation

- **WHEN** an amendment adds claims to an active semantic agreement
- **THEN** Foundation computes affected tasks and dependency-closed providers, invalidates agreement approval and proof, and records which unrelated providers may be preserved before installing the staged packet

#### Scenario: An unaffected proof receipt crosses one amendment revision

- **WHEN** a passing unaffected provider retains the exact declared provider, claim, and input fingerprints across one explicit contract revision
- **THEN** the amendment transaction rebinds that receipt to the new contract and validates it before Prove scheduling

#### Scenario: Receipt preservation is ambiguous

- **WHEN** a receipt is affected, missing, unscoped, independently stale, or has an incomplete or changed binding
- **THEN** the harness fails closed for that provider, preserves no ambiguous proof, and returns the exact `advance <change> --through proven` recovery route

#### Scenario: One preserved receipt is ambiguous

- **WHEN** one preservation candidate is ambiguous while another retains an exact independently valid declared-input binding
- **THEN** only the ambiguous provider is rerun and the exact provider remains preserved

#### Scenario: A receipt is rebound across an amendment

- **WHEN** the transaction preserves and rebinds an unaffected receipt
- **THEN** it writes a create-only audit record containing the before/after receipt digests and authorized contract-revision decision, and removes that record if the amendment rolls back

#### Scenario: The amended packet is invalid

- **WHEN** strict validation rejects the staged amendment
- **THEN** no partial file or revision remains installed and the prior active agreement is still resumable

#### Scenario: An amendment tries to redefine an existing task

- **WHEN** `updateTasks` supplies a replacement outcome or verification command for an existing task
- **THEN** validation refuses the silent replacement and instructs the agent to add a new task, preserving the original task's completed meaning

#### Scenario: An amendment revises an existing requirement

- **WHEN** amendment มี `reviseRequirements` ที่อ้าง key ของ requirement เดิม พร้อม outcome/scenario ใหม่ evidence และ task ที่ยังไม่เสร็จอย่างน้อยหนึ่งงานครอบคลุม key นั้น
- **THEN** block `### Requirement:` เดิมใน spec ของ change ถูกแทนที่ claim ของ key นั้นถูกแทนด้วย claim ใหม่และนับเป็น changed claim task และ provider ที่ผูกกับ claim นั้นเท่านั้นถูก invalidate ส่วน provider อื่นที่ไม่กระทบคงถูกเก็บไว้

#### Scenario: A revised requirement needs open implementation work

- **WHEN** requirement ที่ถูก revise ถูกครอบคลุมโดย task ที่เสร็จแล้วเท่านั้น
- **THEN** validation ปฏิเสธ amendment และบอกให้เพิ่ม task ใหม่ผ่าน `addTasks` เพื่อไม่ให้ task ที่เสร็จแล้วเปลี่ยนความหมาย

#### Scenario: An amendment removes an existing requirement

- **WHEN** amendment มี `removeRequirements` ที่อ้าง key เดิมพร้อม `migration`
- **THEN** block ของ requirement ถูกลบจาก spec ของ change claim ของ key นั้นถูกถอดจาก evidence และ annotation ของ task และ provider ที่เคยผูกกับ claim เหล่านั้นถูก invalidate โดยคำนวณจาก claim ก่อน amendment แทนการ BLOCK

#### Scenario: Removal cannot orphan a task

- **WHEN** การลบทำให้ task ใดไม่เหลือ claim ครอบคลุมเลย และ amendment ไม่ได้ย้าย coverage ของ task นั้นด้วย `updateTasks`
- **THEN** validation ปฏิเสธและระบุ task id ที่จะไม่มี coverage

#### Scenario: Amendment keys are unambiguous

- **WHEN** amendment ไม่มี add/revise/remove เลย อ้าง key ที่ไม่มีอยู่ใน revise หรือ remove หรือใช้ key เดียวกันมากกว่าหนึ่งการกระทำ
- **THEN** validation ปฏิเสธโดยไม่แก้ไฟล์ และ amendment ที่มีแค่ `addRequirements` ให้ผลเหมือนเดิม

#### Scenario: A version-4 revision carries discovery coverage

- **WHEN** amendment ต่อ agreement เวอร์ชัน 4 revise requirement
- **THEN** intake gate ต้องการ discovery coverage ของ requirement ที่ revise เหมือน requirement ที่เพิ่ม และ delta ที่ผ่านแล้วถูกต่อท้าย proposal
