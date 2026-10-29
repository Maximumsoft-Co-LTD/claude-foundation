# land Specification

## Purpose
TBD - created by archiving change archive-telemetry-sync. Update Purpose after archive.
## Requirements
### Requirement: Archive imports session telemetry

`land archive` SHALL run one quiet Claude-telemetry sync for the change before
the destructive archive step, and SHALL warn — without blocking — when the
change is archived with no model usage ever imported.

#### Scenario: ambient transcript is imported at archive

- **WHEN** a bound host transcript with unimported usage rows exists and
  `land archive` runs
- **THEN** the change's telemetry store gains those rows without any manual
  `telemetry sync` invocation

#### Scenario: absent transcript stays silent and non-blocking

- **WHEN** no host transcript is bound and `land archive` runs
- **THEN** the archive completes exactly as before, with one warning that
  model usage was never imported, naming `telemetry sync`

#### Scenario: telemetry never gates the archive

- **WHEN** the telemetry source is unreadable or empty
- **THEN** the archive still completes and the outcome is reported as a
  warning, never a blocker

### Requirement: Landing onto a default branch is visible

The system SHALL surface — without blocking — when landed work targets a
repository whose checked-out branch is `main` or `master`.

#### Scenario: land record warns on a default branch

- **WHEN** `land record` binds a commit and the target repository is checked
  out on `main` or `master`
- **THEN** the command succeeds and prints a warning naming the repository
  and the branch

#### Scenario: a feature branch stays silent

- **WHEN** the target repository is checked out on any other branch or a
  detached HEAD
- **THEN** no branch warning is printed

#### Scenario: land check reports the root target branch

- **WHEN** `land check` reaches `LAND READY` and the root target is checked
  out on `main` or `master`
- **THEN** the output includes a `branch:` line naming it

### Requirement: Doctor escalates the unwired branch guard

`doctor` SHALL report `no-direct-main: disabled (opt-in policy)` at `warn`
level while the hook is not wired, and keep `enabled` at `info`.

#### Scenario: disabled guard is a warning

- **WHEN** `.claude/settings.json` does not wire `no-direct-main-commit.sh`
  and `doctor` runs
- **THEN** the `no-direct-main` check reports at `warn` level and the doctor
  exit code is unchanged

### Requirement: Stale refusals state the recovery order

A staleness refusal SHALL state, in the refusal itself, the order of
operations that avoids repeating it.

#### Scenario: stale proof names the order

- **WHEN** the workspace changed after Prove and `land check` refuses
- **THEN** the message says to finish contract and code edits, sync, and run
  one fresh prove, naming the prove command

#### Scenario: stale authority request names the order

- **WHEN** the workspace changed after an authority request and
  `authority record` refuses
- **THEN** the message says review and acceptance are requested after the
  workspace stops changing, naming the re-request command

#### Scenario: fresh state stays unchanged

- **WHEN** nothing is stale
- **THEN** `land check` and `authority record` outputs carry no recovery hint

### Requirement: Out-of-band delivery is visible but non-authoritative

The system SHALL report when change bytes or an explicit delivery reference are observed in a target before archived, SHALL provide an exact audited recovery route, and SHALL NOT convert that observation into Proof, authority, Land permission, or archive completion.

#### Scenario: Target contains the change before archive

- **WHEN** the target repository advances to include the change while lifecycle state is still change, building, waiting, or proven
- **THEN** diagnostics report out-of-band delivery with current lifecycle state and supported reconciliation choices

#### Scenario: External delivery exists without proof

- **WHEN** an out-of-band commit, pull request, or deployment reference is recorded but required evidence is missing or stale
- **THEN** Proof and Land remain blocked and the change cannot be marked archived

### Requirement: High-level recovery remains local and non-authoritative

The coordinator MAY perform or prescribe reversible local sandbox reconciliation, evidence refresh, and idempotent telemetry ingestion when their preconditions are fully observed, but SHALL stop before conflict overwrite, waiver, commit, push, publication, pull request creation, or inferred delivery acceptance.

#### Scenario: Target moved without a conflict

- **WHEN** local sandbox reconciliation is policy-allowed and the replay is conflict-free
- **THEN** the coordinator returns or performs the bounded sync and requires fresh invalidated proof

#### Scenario: Target movement conflicts with repair work

- **WHEN** sandbox reconciliation detects a conflicting path
- **THEN** the coordinator preserves both states and returns a conflict authority boundary

#### Scenario: Delivery authority is absent

- **WHEN** proof passes but commit, push, publication, or another declared delivery step lacks authority
- **THEN** the coordinator reports Land readiness and stops without performing that step

### Requirement: Declared non-root scope always uses composite Land

Foundation SHALL choose root-only Apply/archive or multi-repository saga behavior
from the declared repository selection, not from the number of runtime records
that happen to survive.

#### Scenario: exactly one child is selected

- **WHEN** a change selects one non-root repository with or without selecting `root`
- **THEN** Apply refuses the single local transaction and Land uses the ordered resumable repository saga

#### Scenario: selected child record is missing at Land

- **WHEN** a non-root selection remains declared but its isolated runtime record is absent
- **THEN** Land reports the incomplete child and does not downgrade to the root-only archive route

#### Scenario: root is the only selected repository

- **WHEN** no non-root repository is selected
- **THEN** the compatible single-repository Apply and archive path remains available

### Requirement: delivery-language-remains-truthful

The system SHALL Runtime and documentation report code delivery separately from deployment, activation, and production verification.

#### Scenario: Land archives a change that still has declared post-deployment work

- **WHEN** Land archives a change that still has declared post-deployment work
- **THEN** Runtime and documentation report code delivery separately from deployment, activation, and production verification.

### Requirement: Landed specs end with one newline

ระบบ SHALL ทำให้ spec ใน openspec/specs ที่ change ถูก archive เขียนใหม่ลงท้ายด้วย newline เดียวก่อนบันทึก delivery integrity

#### Scenario: openspec archive ทิ้งบรรทัดว่าง

- **GIVEN** spec ที่ merge ลงท้ายด้วย \n\n
- **WHEN** Land archive สำเร็จ
- **THEN** spec ลงท้ายด้วย \n เดียวและ spec sync verification ผ่าน

#### Scenario: spec ที่ไม่ได้อยู่ใน change

- **GIVEN** spec อื่นใน openspec/specs ลงท้ายด้วย \n\n
- **WHEN** Land
- **THEN** spec นั้นไม่ถูกแก้

#### Scenario: recovery หลัง archive ค้าง

- **GIVEN** Land หยุดหลัง openspec archive ก่อนบันทึก integrity
- **WHEN** resume Land
- **THEN** spec ของ change ลงท้ายด้วย \n เดียวก่อนบันทึก integrity

### Requirement: land-dead-end-route

ระบบ SHALL ให้ข้อความเมื่อ read-only dependency ไม่ได้แยก sandbox ระบุ route ที่มีอยู่จริงและตรงกับ WORKFLOW.md แทนการบอกให้สร้าง sandbox ใหม่

#### Scenario: dependency ไม่แยก

- **GIVEN** read-only dependency ที่ไม่ใช่ worktree
- **WHEN** agent รัน Land
- **THEN** ข้อความระบุ route ที่มีใน commands.json และไม่มีคำว่า recreate the sandbox

### Requirement: replay-carries-landed

ระบบ SHALL ถือว่าไฟล์ที่ sandbox sync ของ harness merge งานที่ land แล้วเข้า sandbox ได้สะอาด และ target ไม่เปลี่ยนตั้งแต่ sync นั้น เป็นไฟล์ที่ carry งานที่ land แล้ว ทั้งใน root workspace และ repository sandbox และการปฏิเสธเพราะ conflict ที่ยังไม่ resolve SHALL ส่ง route resolve กลับไปด้วย

#### Scenario: clean replay ใน repository sandbox

- **GIVEN** A land แล้วใน repository backend และ sandbox ของ B ถูก sync merge ได้สะอาด (landedReplay ตรงกับ bytes ของ sandbox และ landedSynced.target ตรงกับ target)
- **WHEN** Land preflight ของ B ตรวจ repository backend
- **THEN** ไม่มี RepositoryDeliveryError และ apply ผ่าน
- **AND** ไฟล์หลัง Land เป็น bytes ของ sandbox ที่มีงานของ A รวมอยู่

#### Scenario: clean replay ใน root workspace

- **GIVEN** alpha และ bravo แก้บรรทัดที่ 3 และ 5 ของ src/shared.txt และ bravo archived ก่อน
- **WHEN** advance alpha --through archived
- **THEN** alpha ถึง archived ผ่าน landed-change-sync ของ harness โดยไม่ขอ agent reconcile
- **AND** ไม่มีบรรทัดหายหรือซ้ำ

#### Scenario: target เปลี่ยนหลัง sync

- **GIVEN** sync merge สะอาดแล้ว แต่ target ถูกแก้อีกครั้งหลังจากนั้น
- **WHEN** Land preflight
- **THEN** ยังปฏิเสธด้วย overwrite และเสนอ sync อีกครั้ง (landedSync) เพราะ bytes ไม่ตรงกับที่ sync เห็น

#### Scenario: sync รายงาน conflict ที่ยังไม่ resolve

- **GIVEN** landedConflicts มี path นั้นและไม่มี landedResolved
- **WHEN** Land preflight
- **THEN** ปฏิเสธโดย error ระบุ landedConflict และ path และ advance ส่ง REPAIR_SYNC_CONFLICT พร้อม path แทนข้อความ overwrite เปล่า

### Requirement: proof-agrees-with-lifecycle

ระบบ SHALL ลบ proof-advance checkpoint เมื่อ sandbox sync ทำให้ proof invalid เพื่อให้ advance ไม่ตอบว่า proof current ขณะที่ lifecycle กลับเป็น building

#### Scenario: sync ที่ invalidate ลบ checkpoint

- **GIVEN** มี proof.json และ proof-advance.json ที่ PASS ที่ workspace hash ปัจจุบัน และ sync ทำให้ proof invalid
- **WHEN** sandbox sync
- **THEN** proof-advance.json ถูกลบพร้อม proof.json และ lifecycle เป็น building
- **AND** advance ถัดไปรัน proof ใหม่แทนตอบ proof current

#### Scenario: sync ที่ไม่ invalidate คง checkpoint

- **GIVEN** sync ไม่เปลี่ยน packet หรือ workspace ที่ proof ผูกอยู่
- **WHEN** sandbox sync
- **THEN** proof-advance.json ยังอยู่

#### Scenario: cursor ว่างและ lifecycle building

- **GIVEN** ไม่มี proof-advance cursor และ state.status เป็น building
- **WHEN** coordinator ประเมิน advance --through proven
- **THEN** ไม่ตอบ ASK_USER land-authority

#### Scenario: lifecycle proven และ cursor ตรง

- **GIVEN** state.status proven และ cursor PASS ที่ hash ปัจจุบัน
- **WHEN** advance --through proven
- **THEN** ASK_USER land-authority เหมือนเดิม
