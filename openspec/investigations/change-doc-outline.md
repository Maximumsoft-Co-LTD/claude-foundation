# Change packet outline research (2026-10-15)

Research note for the hybrid authoring direction (user decision: structured
fields stay typed; prose is authored Markdown that the harness validates
against one outline contract). Each section lists the question it answers,
its draft field, and when it is included. Sources are cited at the end.

## proposal.md — for the approver: should we do this?

| # | Section | Answers | Draft field | Include when |
|---|---|---|---|---|
| 1 | Summary | What is this, in one paragraph? | intent/summary | always |
| 2 | Why | What problem, for whom, why now? | why | always |
| 3 | User stories | Who benefits, at what priority? | userStories | feature, ui, api |
| 4 | Success criteria | How is success judged, with what threshold? | successCriteria, successMeasure | always |
| 5 | Scope / what changes | What is in, per capability? | requirements, surfaces | always |
| 6 | Non-goals | What plausible work is excluded? | nonGoals | always |
| 7 | Constraints | Which fixed limits apply? | constraints | present |
| 8 | Impact and risk | Impact, coupling, surfaces, risk signals, security triggers | impact, coupling, riskSignals, securityTriggers | always |
| 9 | Decisions to ratify / open questions | What must the approver decide or accept? | decisions (agent), openQuestions | present |
| 10 | Acceptance traceability | Requirement › scenario → kind → task → claim → check → freshness | derived | always |
| 11 | Definition of done | When is it finished? | derived | always |
| 12 | Capabilities index | Which living specs change? | capabilityOverviews | more than one capability |
| A | Appendices | Investigation, discovery coverage, derived facts, provenance, amendment history | investigation, discovery | present |

## design.md — for builders and reviewers: how, and why this way?

| # | Section | Draft field | Include when |
|---|---|---|---|
| 1 | Overview (solution strategy) | new | design exists |
| 2 | Current state | currentState | changes existing behavior |
| 3 | Domain language | domainLanguage | new or ambiguous terms |
| 4 | Assumptions and open questions | assumptions, openQuestions | present |
| 5 | Work type | workType | design exists |
| 6 | Architecture views: context (C4 L1), container/deployment (C4 L2), component map | diagrams, componentMap, integrations | external actor, new runtime, multi-module |
| 7 | User flow | userFlow | ui or feature |
| 8 | Runtime behavior: sequence, state | diagrams | async, multi-step, stateful |
| 9 | Contracts: API, event/job, data model and migration, UI states, config | apiContracts, jobContract (+ eventContracts), dataModel, uiStates, configContract | workType api, async, data, ui, config |
| 10 | Bugfix analysis / refactor invariants | bugfix, refactor | bugfix or fixes; refactor |
| 11 | Decisions (ADR-lite) | decisions | present |
| 12 | Quality attributes (NFR scenarios) | new nfr | standard lane or any NFR |
| 13 | Security / threat model | new threatModel | access-control, security trigger, input-domain, external-integration, financial |
| 14 | Failure matrix | failureMatrix | failure scenario or service interaction |
| 15 | Observability | new observability | changed runtime failure surface |
| 16 | Compatibility, migration, rollout, rollback | compatibility (+ rollout) | public contract, persisted data, activation, high impact |
| 17 | Test strategy | testMap (+ testStrategy) | behavior work |
| 18 | Risks | risks | present |
| 19 | File map | fileMap (derived) | always, appendix |
| 20 | Selected prototype | prototypeSelection | prototype run |

## spec.md and tasks.md

- spec: Purpose → ADDED/MODIFIED/REMOVED → Requirement (SHALL + details;
  REMOVED carries Migration) → scenarios ordered success, boundary, failure.
  Durable decisions add one Rationale line under the affected requirement.
- tasks.md: one dependency-ordered ledger; no sections.
- Machine files: evidence.yaml (claims → providers), grounding.yaml (locked
  decisions, risk tier, NFR/observability rows), execution.yaml (provider
  wiring), handoffs.yaml (external operations), repositories.yaml (multi-repo).

## Detail formats

- **Test strategy:** risk → level rationale; levels used; doubles and their
  gaps; test data and environment; real-surface check; failing-before
  regression; explicitly untested items with reason. Per-scenario rows stay in
  the test map.
- **NFR scenario:** ID | ISO 25010 characteristic | Stimulus | Response |
  Measure (required) | Source | Environment | Artifact (optional) | Claim.
- **ADR-lite (MADR-derived):** ID, status (proposed/accepted/superseded),
  context, drivers, options with pros/cons, decision, decided-by,
  consequences, confirmation (claim or check), supersedes, durable.
- **Traceability:** Requirement › Scenario | Kind | Access | Task | Claim |
  Provider/check | Evidence freshness | Decision refs; bidirectional.
- **Diagrams by trigger:** external actor → C4 context; new runtime → container
  or deployment; multi-module → component; ordered cross-process calls →
  sequence; lifecycle field → state; trust boundary → data-flow diagram;
  user journey → flowchart.
- **API contract:** auth/scopes, schemas, field behavior, error model,
  idempotency and retry window, conditional requests, pagination, long-running
  operations, rate limits, versioning, compatibility class, deprecation.
- **Event contract (AsyncAPI):** channel, action, message name and version,
  payload, headers, correlation id, ordering key, delivery semantics, dedup
  key, retry/DLQ, compatibility rule.
- **Threat model (OWASP four questions):** assets and data classes, trust
  boundaries, STRIDE rows (threat, likelihood × impact, response, control →
  scenario, residual risk).
- **Observability:** failure mode | signal | SLI | SLO/alert | runbook action |
  owner; PII-in-telemetry check.
- **Rollout/rollback:** strategy and reason; stages and gates; flag and removal
  task; expand → migrate → contract data phases; rollback trigger; data
  reversibility; cross-repo ordering.

## Gaps found in the current harness

- New draft fields needed: rollout, threatModel, nfr scenarios, eventContracts,
  observability, testStrategy, dependencies, alternatives; apiContracts
  subfields (version, compatibility, idempotency, pagination, rateLimit,
  deprecation, errorModel); dataModel migration phases and reversibility.
- Rendered headings not confirmed for integrations, diagrams,
  prototypeSelection, risks.
- Defect: decision `rejected` options given as objects render as
  `[object Object]` in design.md (seen in five archived packets).

## Reading order

- Approver: proposal Summary → Why → Success → Scope/Non-goals → Impact →
  Decisions to ratify → spec scenarios.
- Builder/reviewer: design Overview → Current state → Decisions → Contracts →
  Security/NFR → Rollout → Test strategy → spec → tasks.md → evidence.yaml.

## Sources

Rust RFC template (https://raw.githubusercontent.com/rust-lang/rfcs/master/0000-template.md),
arc42 (https://docs.arc42.org/home/), Design Docs at Google
(https://www.industrialempathy.com/posts/design-docs-at-google/), C4
(https://c4model.com/diagrams), MADR (https://adr.github.io/madr/), OWASP threat
modeling (https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html),
OWASP ASVS (https://owasp.org/www-project-application-security-verification-standard/),
Google SRE launches (https://sre.google/sre-book/reliable-product-launches/) and
PRR (https://sre.google/sre-book/evolving-sre-engagement-model/), ISO 25010
(https://www.iso25000.com/index.php/en/iso-25000-standards/iso-25010), Microsoft
API guidelines (https://github.com/microsoft/api-guidelines/blob/vNext/azure/Guidelines.md),
Google AIP (https://google.aip.dev/general), AsyncAPI 3.0
(https://www.asyncapi.com/docs/reference/specification/v3.0.0), parallel change
(https://martinfowler.com/bliki/ParallelChange.html), practical test pyramid
(https://martinfowler.com/articles/practical-test-pyramid.html), ISO/IEC/IEEE
29119-3 table of contents (https://store.standards.org.au/product/as-nzs-iso-iec-ieee-29119-3-2022),
29148-based SRS template (https://github.com/G7DAO/idea-submission-guidelines/blob/main/SRS-Template.md),
IEEE 1016 (https://en.wikipedia.org/wiki/Software_design_description), SEI
quality-attribute scenarios (https://people.ece.ubc.ca/matei/EECE417/BASS/ch04lev1sec3.html),
arc42 quality requirements (https://quality.arc42.org/articles/specify-quality-requirements),
PR-FAQ (https://docs.plannotator.ai/frameworks/amazon-working-backwards-prfaq),
traceability matrix (https://www.notion.com/blog/requirements-traceability-matrix).
Paywalled standards (29148, 29119-3, 1016) were read through tables of contents
or secondary sources.
