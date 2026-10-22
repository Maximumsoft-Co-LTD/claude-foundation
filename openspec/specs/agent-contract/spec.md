# agent-contract Specification

## Purpose
TBD - created by archiving change shipped-agent-contract-names-the-structured-question-tool. Update Purpose after archive.
## Requirements
### Requirement: The shipped agent contract names the channel for decisions

The shipped agent contract SHALL name the host's structured question tool as
the channel for authority and consequential decisions when the session offers
one, and SHALL name plain text as the fallback when it does not. It SHALL cite
the fundamentals rule for conduct as well as skill routing, so the fuller rule
is reachable from the only file a consumer project is guaranteed to load.

#### Scenario: The contract names the tool

- **WHEN** the documentation contract suite reads `.claude/harness/AGENT.md`
- **THEN** its human-interaction guidance names the structured question tool by
  name and states the plain-text fallback

#### Scenario: The contract stays within its stated budget

- **WHEN** the context budget suite measures `.claude/harness/AGENT.md`
- **THEN** it is within that file's 175-word budget, raised for this file alone
  with its reason recorded, while the standing slash-command budget and every
  other named limit are unchanged

### Requirement: Shipped API guidance matches executable runtime pins

Every shipped setup or agent instruction that names a runtime API SHALL match
the runtime API declared by the CLI, composition root, runtime module, and
protocol bundle, and the deterministic documentation suite SHALL fail on drift.

#### Scenario: A runtime API pin changes

- **WHEN** any executable runtime API pin is updated without updating shipped
  setup guidance
- **THEN** the consistency suite fails naming the mismatched file and values

### Requirement: The shipped agent contract reports update advisories without taking authority

The shipped agent contract SHALL require an agent to notify the user when a
phase-bound update advisory reports an available update, avoid duplicate notices
between Investigate and Change, remind immediately before Build when the update
remains unresolved, continue the requested work, and never perform the package
or project update without user authority.

#### Scenario: Agent discovers an update

- **WHEN** an Investigate or Change instruction carries an available update advisory
- **THEN** the agent tells the user once in the user's language
- **AND** continues the requested phase

#### Scenario: Update remains unresolved before Build

- **WHEN** Build preflight carries the same available update
- **THEN** the agent gives one concise reminder
- **AND** does not run an upgrade automatically

#### Scenario: Update status is unavailable

- **WHEN** the advisory status is unknown because no valid cache or remote result is available
- **THEN** the agent does not claim that Foundation is current
- **AND** does not block work

### Requirement: build-edit-test-adequacy

ระบบ SHALL ใส่ในคำสั่งของ Build EDIT จำนวน scenario ที่ task ครอบคลุมและกฎให้เขียนเทสต์ที่ fail บนโค้ดก่อนแก้อย่างน้อยหนึ่งเทสต์ต่อ scenario

- จำนวนนับจาก claims ที่ผูกกับ task ใน tasks.md
- ใส่เฉพาะงานที่เปลี่ยนพฤติกรรม ไม่ใส่กับงานเบาหรืองานที่ไม่เปลี่ยนพฤติกรรม
- คำสั่งไม่มี field skills ไม่มีคำสั่งโหลด skill และไม่มีชื่อ skill ตาม no-skill-routing

#### Scenario: task เปลี่ยนพฤติกรรมและมี claim

- **GIVEN** task T001 เป็นงาน feature ที่ผูก 4 claims
- **WHEN** advance คืน Build EDIT
- **THEN** instructions บอกว่า T001 ครอบคลุม 4 scenario และให้เขียนเทสต์ที่ fail บนโค้ดก่อนแก้อย่างน้อยหนึ่งเทสต์ต่อ scenario

#### Scenario: งานไม่เปลี่ยนพฤติกรรม

- **GIVEN** task เป็นงาน docs หรือ refactor
- **WHEN** advance คืน Build EDIT
- **THEN** instructions ไม่มีบรรทัดความพอของเทสต์

#### Scenario: task ไม่มี claim

- **GIVEN** task เปลี่ยนพฤติกรรมแต่ไม่มี claim ผูก
- **WHEN** advance คืน Build EDIT
- **THEN** instructions ไม่มีบรรทัดความพอของเทสต์ และไม่พิมพ์จำนวนเป็นศูนย์

#### Scenario: ไม่ระบุชื่อ skill

- **GIVEN** Build EDIT ที่มีบรรทัดความพอของเทสต์
- **WHEN** ตรวจ field และ instructions
- **THEN** ไม่มี field skills ไม่มีชื่อ skill และไม่มีคำสั่งให้โหลด skill
