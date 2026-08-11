## ADDED Requirements

### Requirement: Runtime composition has an explicit initialization order

Foundation SHALL construct each runtime dependency before supplying it to a
consumer and SHALL statically reject delayed runtime bindings in the shipped
composition root.

#### Scenario: Runtime dependencies are initialized before use

- **WHEN** the composition root is checked or loaded
- **THEN** every runtime factory receives already-initialized dependencies and
  no callback closes over a runtime handle assigned later

### Requirement: The composition root owns composition

The runtime entrypoint SHALL own bootstrap, dependency composition, and command
dispatch while cohesive domain policy and mechanisms remain in runtime modules.

#### Scenario: The composition root owns only bootstrap wiring and dispatch

- **WHEN** maintainers inspect the shipped entrypoint
- **THEN** command registry, protocol/config, budget, instruction provenance,
  telemetry parsing, and workflow policy are owned by cohesive runtime modules

### Requirement: Harness contract tests are organized by domain

The repository SHALL expose domain-focused deterministic harness suites through
the existing aggregate test entrypoint without dropping assertions or changing
their observable fixtures.

#### Scenario: Harness contract tests are domain focused

- **WHEN** the aggregate harness test command runs
- **THEN** domain suites cover the existing change, evidence, telemetry,
  sandbox/Land, multi-repository, and lease contracts and preserve the complete
  baseline result

### Requirement: Structural simplification preserves behavior

The restructure SHALL preserve CLI output, validation and error behavior,
persisted runtime state, evidence semantics, installation, upgrade, recovery,
and Land behavior.

#### Scenario: Observable harness behavior is preserved

- **WHEN** the complete deterministic and upgrade compatibility suites run on
  the restructured runtime
- **THEN** they pass without weakening or rewriting behavioral assertions
