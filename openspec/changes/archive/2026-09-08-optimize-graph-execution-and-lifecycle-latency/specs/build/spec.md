# build

## ADDED Requirements

### Requirement: dependency-aware-parallel-build

The system SHALL The harness dispatches them concurrently up to available configured capacity while conflicting, unknown-scope, and dependent tasks remain serialized.

#### Scenario: Multiple ready Build tasks have disjoint declared paths and no dependency or shared external resource

- **WHEN** Multiple ready Build tasks have disjoint declared paths and no dependency or shared external resource
- **THEN** The harness dispatches them concurrently up to available configured capacity while conflicting, unknown-scope, and dependent tasks remain serialized
