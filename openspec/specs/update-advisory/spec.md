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

