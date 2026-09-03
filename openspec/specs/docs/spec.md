# docs Specification

## Purpose
TBD - created by archiving change refresh-the-website-and-human-facing-docs-to-3-2-8-and-document-. Update Purpose after archive.
## Requirements
### Requirement: Documentation states the release it describes

Every documentation surface that names a release or protocol pin SHALL name the
one the repository actually carries, and the deterministic documentation suite
SHALL derive the expected values from `VERSION` and
`.claude/harness/protocol.json` at run time rather than from a value written
into the test.

#### Scenario: A release moves without the documentation following

- **WHEN** `VERSION` or a pin in `.claude/harness/protocol.json` changes and a
  documentation surface still states the previous value
- **THEN** the documentation suite fails and names the surface that drifted

#### Scenario: A guard that cannot itself go stale

- **WHEN** the documentation suite checks a stated release or protocol pin
- **THEN** it compares against the value read from `VERSION` or
  `protocol.json`, so no expected release number is stored in the test

### Requirement: Documented adapter catalog matches the runtime

Shipped operator documentation SHALL name every evidence adapter the runtime
implements, so a reader of an installed harness sees the same set the runtime
would accept.

#### Scenario: The runtime gains an adapter the documentation omits

- **WHEN** `ADAPTERS` in `.claude/harness/foundation.mjs` names an adapter that
  the shipped operator documentation does not list
- **THEN** the documentation suite fails and names the missing adapter

### Requirement: Documented artifact listings agree with the runtime

Documentation SHALL describe the artifacts the system writes from one canonical
listing, and any shorter listing SHALL name that canonical source rather than
restate it independently.

#### Scenario: A listing claims a directory the runtime does not declare

- **WHEN** a documentation surface lists a `.foundation/` directory that the
  runtime does not declare as a state root
- **THEN** the documentation suite fails and names the unsupported entry

### Requirement: Documentation does not overclaim human approval

Documentation SHALL distinguish gates the harness enforces from steps an agent
is instructed to take, and SHALL NOT state that landing a change is gated on
human consent, because the harness gates Land on evidence.

#### Scenario: A surface claims Land requires approval

- **WHEN** a documentation surface states that Land is blocked until a human
  approves it
- **THEN** the documentation suite fails and names the surface

#### Scenario: A reader looks for how acceptance actually blocks

- **WHEN** a reader consults human-facing documentation about acceptance
- **THEN** it states that a standard change starts `undecided` and that
  `change validate` fails until a human decides

### Requirement: Current documentation teaches one primary agent workflow

Current English and Thai documentation SHALL teach `/investigate`, `/change`,
`/build`, `/prove`, `/land`, and `/dev` as the user surface, semantic draft plus
`change amend` as the agreement compiler surface, and `advance --through` as the
normal model-facing runtime surface. Low-level compatible commands SHALL remain
documented as operator or integration primitives rather than a required chain.

#### Scenario: A user follows the normal lifecycle

- **WHEN** the user asks the coding agent to create, build, prove, or land work
- **THEN** the documentation does not require the user to run sandbox, packet,
  dispatch, provider, receipt, or archive primitives manually

#### Scenario: Documentation lists active change artifacts

- **WHEN** a current page describes an active semantic change
- **THEN** it distinguishes the three core files from conditional design,
  grounding, execution, repository, handoff, and standard delta-spec files

#### Scenario: Historical records retain their original vocabulary

- **WHEN** a file is an archived OpenSpec change, release note, or dated report
- **THEN** documentation consistency treats it as historical evidence and does
  not rewrite its description of the version that produced it
