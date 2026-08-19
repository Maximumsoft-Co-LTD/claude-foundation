## ADDED Requirements

### Requirement: Unavailable host usage is actionable

Metrics SHALL preserve absent host usage as unmeasured null values and SHALL
include a structured availability reason plus package-supported recovery actions
without creating a telemetry event or estimating model usage.

#### Scenario: A correlated Codex session has no imported events

- **WHEN** phase context contains a Codex session identity but no Codex usage
  event was imported
- **THEN** metrics report correlation-without-usage as the reason
- **AND** name the supported Codex telemetry import route
- **AND** requests, tokens, and cost remain null

#### Scenario: No host telemetry context is available

- **WHEN** no host events or correlated host phase context exist
- **THEN** metrics report host-telemetry-not-ingested
- **AND** name the generic telemetry and host-execution import routes

#### Scenario: Host events are present

- **WHEN** at least one normalized host event has been ingested
- **THEN** usage availability reports measured with no recovery action
