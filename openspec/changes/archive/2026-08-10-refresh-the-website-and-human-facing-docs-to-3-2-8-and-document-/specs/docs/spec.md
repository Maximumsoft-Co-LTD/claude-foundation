## ADDED Requirements

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
