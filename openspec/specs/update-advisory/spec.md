# update-advisory Specification

## Purpose
TBD - created by archiving change make-foundation-agents-surface-an-available-harness-update-durin. Update Purpose after archive.
## Requirements
### Requirement: Agents receive update awareness at implementation decision boundaries

Foundation SHALL resolve a non-blocking update advisory at Investigate entry,
Change entry, and Build preflight, SHALL reuse a bounded user-level cache
instead of requiring a network request at each boundary, and SHALL omit
automatic checks from Prove, Review, and Land.

#### Scenario: Investigate starts with a stale cache

- **WHEN** an agent enters Investigate and the shared cache is absent or older than its freshness window
- **THEN** Foundation performs one bounded stable-release refresh
- **AND** returns the resulting advisory without blocking Investigate on failure

#### Scenario: Change follows Investigate

- **WHEN** an agent enters Change after Investigate produced a fresh advisory
- **THEN** Foundation reuses the cached status without another network request

#### Scenario: Build begins while an update remains available

- **WHEN** Build preflight observes an unresolved CLI or project-runtime update
- **THEN** the Build packet contains a non-blocking reminder
- **AND** Build can continue

#### Scenario: Later phases stay quiet

- **WHEN** an agent enters Prove, Review, or Land
- **THEN** Foundation performs no automatic update check
- **AND** adds no update reminder for that phase

### Requirement: Update discovery is bounded and non-authoritative

Foundation SHALL validate a stable semantic version from the fixed GitHub
release endpoint, cache it atomically at user scope for 24 hours, fall back to
a valid stale cache or an explicit unknown status on failure, and SHALL never
execute remote content or apply an update.

#### Scenario: Multiple projects share one fresh result

- **WHEN** another project checks within the cache freshness window
- **THEN** it reuses the user-level cache without a remote request

#### Scenario: Release discovery is unavailable

- **WHEN** the release endpoint times out, fails, is rate-limited, or returns malformed data
- **THEN** the advisory uses a valid stale cache when available or reports unknown
- **AND** the phase remains unblocked

#### Scenario: Operator disables checking

- **WHEN** `FOUNDATION_UPDATE_CHECK=0` is set
- **THEN** automatic and explicit resolution reports disabled without network access

#### Scenario: Remote metadata contains executable text

- **WHEN** the release response contains fields other than a valid stable tag
- **THEN** Foundation ignores those fields and derives actions only from package-owned constants

### Requirement: Supported upgrades diagnose legacy-default drift without taking authority

Install, update, and doctor flows SHALL identify project-owned values that match known former packaged defaults, SHALL distinguish them from confirmed customization, SHALL describe affected active changes, and SHALL require an explicit decision before changing them.

#### Scenario: Former risk-based CI default survives upgrade

- **WHEN** a supported project retains the former packaged riskBasedCi value and has no configured signed CI provider
- **THEN** doctor reports legacy-default drift before Build with old and current defaults, affected active changes, and a previewable migration route

#### Scenario: Project intentionally keeps the former value

- **WHEN** the user declines migration or the value is recorded as intentional policy
- **THEN** the installer preserves it and the advisory never rewrites the project or active change

### Requirement: Legacy policy diagnostics recognize recorded intent

Upgrade and doctor diagnostics SHALL warn about a former packaged default only when its ownership remains ambiguous, SHALL recognize a valid configured signed CI provider and a bounded project-owned acknowledgement, and SHALL never rewrite the policy or acknowledgement automatically.

#### Scenario: Historical value is supported by signed CI

- **WHEN** `land.riskBasedCi` retains the former value and a valid signed CI issuer/public-key configuration exists
- **THEN** diagnostics do not describe the value as an unresolved legacy-default drift

#### Scenario: Project records intentional policy

- **WHEN** a project-owned acknowledgement binds the policy path and current value
- **THEN** diagnostics report intentional policy without repeating the migration warning
- **AND** install and update preserve both policy and acknowledgement

### Requirement: Source cohort evaluation is lazy and failure-contained

The runtime SHALL calculate a content digest only for commands that consume producer provenance and SHALL return explicit unavailable provenance when the managed source cannot be read, without preventing unrelated commands from running.

#### Scenario: A non-provenance command starts

- **WHEN** an operator runs a command that does not emit metrics or feedback provenance
- **THEN** the runtime performs no harness-tree digest traversal

#### Scenario: Managed source cannot be completely read

- **WHEN** a provenance consumer cannot hash one or more managed files
- **THEN** it reports an unavailable content digest and bounded reason
- **AND** no semantic version or symptom is substituted for the missing digest

