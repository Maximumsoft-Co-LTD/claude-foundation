## ADDED Requirements

### Requirement: A decision frontier feeds the finalized Decision Sheet

Foundation discovery SHALL model material user decisions as a private dependency
tree, resolve source-discoverable facts without asking the user, and expose only
decisions whose prerequisites are settled at the current frontier. Pre-lifecycle
brainstorming MAY traverse successive frontiers in rounds and SHALL hand off one
compact agreement. Feature and change intake SHALL reuse that agreement and
locked decisions, include conditional alternatives and their dependent effects
in the existing finalized Decision Sheet, and SHALL NOT create a parallel
decision-tree artifact or routine second interview.

#### Scenario: A dependent decision waits for its prerequisite

- **WHEN** a material decision depends on another answer that is not settled
- **THEN** pre-lifecycle brainstorming asks it only in a later frontier, while
  feature intake includes the dependency and conditional effects in its one
  finalized sheet

#### Scenario: A repository fact is discoverable

- **WHEN** specifications, code, tests, or the sandbox can settle a fact
  required by a decision
- **THEN** Foundation resolves and grounds that fact without asking the user

#### Scenario: Feature intake retains dependencies in one finalized sheet

- **WHEN** feature intake contains material choices with dependent effects
- **THEN** the finalized Decision Sheet presents their dependencies,
  alternatives, and effects without starting a successive-round interview

#### Scenario: A prior compact agreement reaches change intake

- **WHEN** brainstorming has settled every material decision and handed off its
  compact agreement
- **THEN** feature or change intake reuses its answers and records them in the
  existing change packet without a routine second interview or parallel ledger
