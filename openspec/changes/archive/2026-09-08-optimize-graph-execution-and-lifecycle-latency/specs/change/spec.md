# change

## ADDED Requirements

### Requirement: lazy-build-preparation

The system SHALL Change persists and validates the agreement without creating or setting up an isolated workspace, and the first Build advance creates that workspace exactly once.

#### Scenario: A valid semantic draft is started before any implementation work

- **WHEN** A valid semantic draft is started before any implementation work
- **THEN** Change persists and validates the agreement without creating or setting up an isolated workspace, and the first Build advance creates that workspace exactly once

### Requirement: minimal-agent-ceremony

The system SHALL The agent invokes change start and advance routes while the harness owns validation, setup, scheduling, evidence reuse and recovery instead of requiring repeated primitive commands.

#### Scenario: An agent follows the normal Change Loop workflow

- **WHEN** An agent follows the normal Change Loop workflow
- **THEN** The agent invokes change start and advance routes while the harness owns validation, setup, scheduling, evidence reuse and recovery instead of requiring repeated primitive commands
