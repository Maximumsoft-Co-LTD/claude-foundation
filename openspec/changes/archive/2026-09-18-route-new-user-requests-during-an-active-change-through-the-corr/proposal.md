# Change: Route new user requests during an active Change through the correct agreement update before product mutation

## Why

Keep user decisions, implementation, documentation, and automated lifecycle state aligned when follow-up requests arrive during Build or Prove

## What changes

- the agent repairs the implementation without creating an amendment
- The user owns product intent, the agent authors code and durable documentation including amendments, and the harness automates validation, invalidation, evidence, recovery, and lifecycle progression without asking the user to operate commands or author machine inputs
- The shipped policy provides compact positive, negative, and ambiguous examples across UI, interaction, filtering, validation, accessibility, API, data, security, performance, external effects, tests, refactoring, and lifecycle timing

## Impact

- **Impact:** low
- **Coupling:** isolated
- **Affected surfaces:** code
- **Security triggers:** 

## Non-goals

- none

## Requirement discovery coverage

| Dimension | Status | Requirements | Sources | Rationale |
|---|---|---|---|---|
| current-behavior | covered | classify-follow-up-before-mutation | .claude/orchestrator.md, .claude/commands/build.md, .claude/commands/references/build-policy.md | none |
| affected-actor | covered | preserve-development-ownership | none | none |
| desired-behavior | covered | classify-follow-up-before-mutation, preserve-development-ownership, document-classification-examples | none | none |
| success-path | covered | classify-follow-up-before-mutation, preserve-development-ownership | none | none |
| failure-path | covered | classify-follow-up-before-mutation | none | none |
| input-boundary | covered | classify-follow-up-before-mutation, document-classification-examples | none | none |
| compatibility | covered | preserve-development-ownership | .claude/harness/AGENT.md, WORKFLOW.md | none |
| non-goals | covered | preserve-development-ownership | none | none |
| verification | covered | classify-follow-up-before-mutation, preserve-development-ownership, document-classification-examples | .claude/tests/harness/run-agent-contract-tests.sh, .claude/tests/harness/run-instruction-contract-tests.sh, .claude/tests/docs/run-doc-consistency.sh | none |
| security-privacy | not-applicable | none | .claude/commands/references/build-policy.md, .claude/rules/fundamentals.md | This instruction-only change classifies security follow-ups but does not change a trust boundary, permission, secret, or stored user data |
| permission-rejection | not-applicable | none | .claude/orchestrator.md, .claude/harness/AGENT.md | The existing authority and decision routes remain unchanged; the change only clarifies who performs routine amendment mechanics |
| performance-capacity-availability | not-applicable | none | .claude/commands/build.md, WORKFLOW.md | No runtime execution path, service, capacity, latency, or availability behavior changes |
| accessibility | not-applicable | none | .claude/commands/references/build-policy.md, README.md | Accessibility appears only as an example of observable product semantics; no rendered interface or accessibility contract changes |
