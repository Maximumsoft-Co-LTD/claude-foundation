# Change: Strengthen Foundation discovery with an explicit decision frontier while preserving one finalized Decision Sheet and the existing OpenSpec lifecycle

## Why

Foundation already batches material questions, but its pre-lifecycle and feature-intake instructions do not share one explicit dependency and handoff contract, leaving room for premature questions, repeated decisions, or an incomplete single-sheet gate.

## What changes

- Define one private decision tree whose frontier contains only material user decisions with settled prerequisites, while source-resolvable facts remain agent-owned.
- Make brainstorming hand off a compact agreement and make feature intake present dependencies, alternatives, and dependent effects in one finalized Decision Sheet.
- Require change intake to reuse locked decisions and prior agreements without a routine second interview, while retaining the existing single batched contradiction amendment.
- Pin the cross-skill contract with focused deterministic instruction and interview replay tests.

## Impact

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** shipped skills, feature/change intake, interview contract tests
- **Security triggers:** none

## Non-goals

- Add a grill-with-docs command, lifecycle phase, decision-tree artifact, CONTEXT.md, ADR store, or runtime state.
- Change grounding.yaml shape, review policy, Build behavior, or the existing contradiction reopen route.
- Implement domain-language and durable-decision capture; that remains a separate dependent change.
