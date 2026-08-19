## ADDED Requirements

### Requirement: Standard design preserves canonical domain language and durable rationale

The system SHALL capture resolved project-specific language and qualifying
durable tradeoffs inside the existing standard OpenSpec design without
introducing a parallel glossary, ADR ledger, or lifecycle.

#### Scenario: A standard packet receives canonical domain language

- **WHEN** a new standard packet or a rapid-to-standard upgrade is generated
- **THEN** its existing `design.md` provides a concise domain-language section and durable-decision guidance

#### Scenario: A fuzzy project term is resolved against source

- **WHEN** feature discovery encounters ambiguous or conflicting project-specific terminology
- **THEN** the agent checks specifications and code, settles the canonical term with the user only when a semantic choice remains, and records the meaning and avoided aliases in `design.md`

#### Scenario: A durable tradeoff reaches the existing Decisions section

- **WHEN** a choice is hard to reverse, surprising without context, and selected among meaningful alternatives
- **THEN** the existing Decisions section records the choice, rationale, and rejected alternative without creating an ADR file

#### Scenario: Rapid and existing packets keep their lifecycle contract

- **WHEN** a rapid packet or a pre-existing standard packet without the new section is validated
- **THEN** validation remains compatible and no new artifact or migration is required
