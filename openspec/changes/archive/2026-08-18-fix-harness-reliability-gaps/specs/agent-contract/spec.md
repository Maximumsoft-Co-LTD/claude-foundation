## ADDED Requirements

### Requirement: Shipped API guidance matches executable runtime pins

Every shipped setup or agent instruction that names a runtime API SHALL match
the runtime API declared by the CLI, composition root, runtime module, and
protocol bundle, and the deterministic documentation suite SHALL fail on drift.

#### Scenario: A runtime API pin changes

- **WHEN** any executable runtime API pin is updated without updating shipped
  setup guidance
- **THEN** the consistency suite fails naming the mismatched file and values
