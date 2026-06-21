# Spec: Sample passing fixture

**ID**: 0000-feat-sample
**Type**: feat
**Status**: approved
**Ship as**: one-drop
**Open PR on ship**: no
**Parent**: none

## User Stories

### US1 — Lint a clean run (Priority: P1)

A maintainer runs the linter on a complete run directory and gets a clean exit.

**Why this priority**: without a clean fixture the suite cannot prove the pass verdict.
**Independent test**: run the linter on this directory; it exits 0.

**Acceptance scenarios**

- [x] **AC1** — **Given** a complete run directory, **When** the linter runs, **Then** it exits 0 with no findings.

## Requirements

### Functional Requirements

- **FR-001**: The fixture MUST carry a Type slot and a User Stories section so the linter's spec checks pass.

## Success Criteria

- **SC-001**: The fixtures suite asserts the clean-pass verdict on this directory.
