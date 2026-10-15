# evidence-quality Specification

## Purpose
Define content-bound critical-case and mutation evidence that fails when a
required behavior is skipped, missing, or killed by the wrong oracle.
## Requirements
### Requirement: Critical test evidence names each required case

A material test claim SHALL declare stable critical case IDs. Its report SHALL
record passed, failed, and skipped status for each ID. A missing or skipped
critical case SHALL block the claim even when the command exits zero and the
aggregate test count meets its minimum.

#### Scenario: A critical case is skipped inside a green suite

- **WHEN** the suite exits zero but one declared critical case is skipped
- **THEN** proof records the case as skipped and refuses the claim

### Requirement: Mutation evidence binds mutants to behavioral kills

Mutation protocol v2 SHALL record mutant ID, whether it applied and compiled,
its killed or survived result, and the critical case that killed it. A crash,
non-applying mutant, compile failure, or aggregate score SHALL NOT substitute
for a required behavioral kill.

#### Scenario: A required semantic mutant survives

- **WHEN** a field-swap, duplicate-wire-key, classifier, or equivalent required
  mutant remains behaviorally observable without a failing critical case
- **THEN** mutation evidence fails naming the mutant and missing killer

### Requirement: Executable provider scripts are content-bound

The harness SHALL require a workspace-relative file named directly by an
executable provider command to be covered by the provider's declared inputs or
the change's declared surface when that file is untracked, and evidence
bootstrap SHALL emit deterministic input coverage when it can identify the
script safely.

#### Scenario: An untracked test script changes after proof

- **WHEN** a provider command names an untracked workspace script and that
  script changes without an implementation change
- **THEN** its prior receipt is stale and the provider executes again

#### Scenario: Command input coverage is absent

- **WHEN** validation sees a workspace script argument outside both provider
  inputs and the declared surface
- **THEN** validation refuses the unsafe wiring and names the uncovered path

### Requirement: go test -json results are counted test evidence

ระบบ SHALL นับผลจาก go test -json event stream เป็นจำนวนเทสต์ที่ผ่าน ล้ม และข้าม

#### Scenario: เทสต์ผ่านทั้งหมด

- **GIVEN** stdout มี event Action pass ของ 3 test ใน package เดียว
- **WHEN** parse รายงานแบบ auto
- **THEN** totalTests 3, passed 3, failed 0, format go-test-json

#### Scenario: subtest นับแยก

- **GIVEN** มี TestA และ TestA/case1 ผ่าน
- **WHEN** parse
- **THEN** นับเป็น 2 เทสต์ และ critical case id เป็นชื่อ Test

#### Scenario: เทสต์ล้มและข้าม

- **GIVEN** มี pass 1, fail 1, skip 1
- **WHEN** parse
- **THEN** totalTests 3, passed 1, failed 1

#### Scenario: package build fail ไม่มี test event

- **GIVEN** มีเฉพาะ event Action fail ระดับ package
- **WHEN** parse
- **THEN** failed อย่างน้อย 1 จึงไม่นับเป็นผ่าน

#### Scenario: รูปแบบอื่นคงเดิม

- **GIVEN** stdout เป็น TAP หรือ node spec หรือ JSON object เดียว
- **WHEN** parse
- **THEN** ได้ผลเดิมเหมือนก่อนแก้

### Requirement: Benchmark evidence compares head with base under one environment

ระบบ SHALL ให้ provider adapter benchmark รันคำสั่งเดียวกันบน base และ head สลับกันหลายรอบใน environment เดียวกันแล้วบันทึกการเทียบใน receipt

- config: adapter benchmark, command, runs (ค่าเริ่มต้น 5, ต่ำสุด 3), maxRegressionPercent (ค่าเริ่มต้น 10)
- base tree สร้างด้วย buildScratch เดิมของ test-discrimination (git archive baseHead + overlay ที่ไม่ใช่ product code)
- ลำดับการรันสลับ base, head, base, head ... เพื่อลด drift ของเครื่อง
- regressionPercent = (headMedian - baseMedian) / baseMedian * 100 ปัดสองตำแหน่ง
- ผ่านเมื่อ regressionPercent <= maxRegressionPercent และทุก head run exit 0

#### Scenario: head ไม่ช้ากว่า threshold

- **GIVEN** provider benchmark runs 5 และ head median ช้ากว่า base 4%
- **WHEN** Prove รัน provider
- **THEN** receipt validity passed
- **AND** receipt มี baseSamples และ headSamples อย่างละ 5 ค่า
- **AND** receipt มี environment descriptor เดียวสำหรับทั้งสองฝั่ง

#### Scenario: head ช้าเกิน threshold

- **GIVEN** head median ช้ากว่า base 25% และไม่ได้กำหนด maxRegressionPercent
- **WHEN** Prove รัน provider
- **THEN** Prove คืน REPAIR stage performance-regression พร้อม finding ที่ระบุ provider, baseMedianMs, headMedianMs และ regressionPercent

#### Scenario: ช้าเท่า threshold พอดี

- **GIVEN** regressionPercent เท่ากับ 10.00 และ threshold ค่าเริ่มต้น
- **WHEN** Prove รัน provider
- **THEN** receipt validity passed

#### Scenario: threshold ที่ผู้เขียนกำหนด

- **GIVEN** maxRegressionPercent 2 และ head ช้ากว่า base 3%
- **WHEN** Prove รัน provider
- **THEN** Prove คืน REPAIR stage performance-regression

#### Scenario: base ใช้ไม่ได้ไม่ block

- **GIVEN** ไม่มี baseHead หรือคำสั่งบน base spawn ไม่ได้
- **WHEN** Prove รัน provider
- **THEN** receipt บันทึก comparison unavailable พร้อม reason และตัดสินจาก exit code ของ head เท่านั้น

#### Scenario: head run ล้มเหลว

- **GIVEN** คำสั่งบน head exit ไม่ใช่ 0
- **WHEN** Prove รัน provider
- **THEN** Prove คืน REPAIR stage evidence-failed เหมือน provider ทั่วไป

#### Scenario: runs ต่ำกว่าขั้นต่ำ

- **GIVEN** draft กำหนด runs 1
- **WHEN** change start inspect
- **THEN** intake คืน EDIT ระบุว่า runs ต้องไม่น้อยกว่า 3

### Requirement: Benchmark regression is confirmed before repair

ระบบ SHALL วัด benchmark ยืนยันหนึ่งครั้งด้วยจำนวน runs สองเท่าก่อนตัดสินว่า regression

#### Scenario: regression จริงได้ REPAIR

- **GIVEN** head ช้ากว่า base 25% ทั้งการวัดแรกและการวัดยืนยัน
- **WHEN** Prove รัน provider
- **THEN** Prove คืน REPAIR stage performance-regression
- **AND** receipt มี confirmation ที่ใช้ runs สองเท่า

#### Scenario: noise ครั้งเดียวผ่าน

- **GIVEN** การวัดแรก regressed แต่การวัดยืนยันไม่ regressed
- **WHEN** Prove รัน provider
- **THEN** receipt validity passed และเก็บผลการวัดแรกไว้

#### Scenario: ไม่ regressed ไม่วัดซ้ำ

- **GIVEN** การวัดแรกไม่ regressed
- **WHEN** Prove รัน provider
- **THEN** ไม่มี confirmation และจำนวน run เท่า runs
