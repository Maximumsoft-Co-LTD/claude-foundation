## ADDED Requirements

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
