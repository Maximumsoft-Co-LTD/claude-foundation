# Change packet outline research (2026-10-15)

Research note for the hybrid authoring direction (user decision: structured
fields stay typed; prose is authored Markdown that the harness validates
against one outline contract). Each section lists the question it answers,
its draft field, and when it is included. Sources are cited at the end.

## proposal.md — for the approver: should we do this?

| # | Section | Answers | Draft field | Include when |
|---|---|---|---|---|
| 0 | Status header | Status (draft, approved, building, proven, archived), owner, approvers, dates | derived | always |
| 1 | Summary | What is this, in one paragraph? | intent/summary | always |
| 2 | Why | What problem, for whom, why now? | why | always |
| 3 | User stories | Who benefits, at what priority? | userStories | feature, ui, api |
| 4 | Success criteria | How is success judged, with what threshold? | successCriteria, successMeasure | always |
| 5 | Scope / what changes | What is in, per capability? | requirements, surfaces | always |
| 6 | Non-goals | What plausible work is excluded? | nonGoals | always |
| 7 | Constraints | Which fixed limits apply? | constraints | present |
| 8 | Impact and risk | Impact, coupling, surfaces, consumers, risk signals, security triggers | impact, coupling, riskSignals, securityTriggers, consumers | always |
| 9 | Decisions to ratify / open questions | What must the approver decide or accept? | decisions (agent), openQuestions | present |
| 9a | User decision log | Each question asked during Change: options, recommendation, answer, who, when | decisionLog | any question was asked |
| 9b | Communication, support, and release note | Who is told and when, support runbook and owner after launch, user docs to update, release-note text | communication, releaseNote | user-visible change |
| 9c | How to verify (demo) | Steps a person follows to see the change work | demo | behavior work |
| 10 | Acceptance traceability | Requirement › scenario → kind → task → check → freshness → decision refs | derived | always |
| 11 | Definition of done | When is it finished? Includes user docs and release note when user-visible, and the compliance record when enabled | derived | always |
| 12 | Capabilities index | Which living specs change? | capabilityOverviews | more than one capability |
| A | Appendices | Investigation, discovery coverage, review record (round, finding, severity, fix, reviewer), compliance change record, derived facts, provenance, amendment history | investigation, discovery, derived review, compliance | present |

## design.md — for builders and reviewers: how, and why this way?

| # | Section | Draft field | Include when |
|---|---|---|---|
| 1 | Overview (solution strategy) | new | design exists |
| 2 | Current state | currentState | changes existing behavior |
| 3 | Domain language | domainLanguage | new or ambiguous terms |
| 4 | Assumptions and open questions | assumptions, openQuestions | present |
| 5 | Work type | workType | design exists |
| 6 | Architecture views: context (C4 L1), container/deployment (C4 L2), data flow with trust boundaries, boundary decisions (owner, callers, sync/async reason, latency budget, timeout, retry, consistency/staleness, correlation), tenancy (isolation per layer, tenant context propagation, noisy-neighbor limits, per-tenant cost) | diagrams, integrations, boundaries, tenancy | external actor, new runtime, cross-process call; tenancy when multi-tenant |
| 7 | User flow: actor, entry information, flowchart, information architecture, rejected interaction alternatives | userFlow | ui or feature |
| 8 | Runtime behavior: sequence, state | diagrams | async, multi-step, stateful |
| 9 | Domain model and modules: invariant-carrying types, illegal states, module interface and hidden decisions, pure core vs injected edge (clock, ids), error classes (expected → result, infrastructure → boundary retry, bug → crash) | new domain | non-trivial logic or invariant |
| 10 | Contracts: API, event/job, data model and migration, UI, config | apiContracts, eventContracts, jobContract, dataModel, ui, config | workType api, async, data, ui, config |
| 11 | Bugfix analysis / refactor invariants | bugfix, refactor | bugfix or fixes; refactor |
| 12 | Decisions (ADR-lite) | decisions | present |
| 13 | Quality attributes (NFR scenarios) | new nfr | standard lane or any NFR |
| 14 | Security / threat model | new threatModel | access-control, security trigger, input-domain, external-integration, financial |
| 15 | Failure matrix | failureMatrix | failure scenario or service interaction |
| 16 | Observability and usage: failure signals, usage/health signals, analytics tracking plan | observability, trackingPlan | changed runtime failure surface; trackingPlan when successMeasure needs product events |
| 17 | Compatibility, version skew, upgrade steps, enablement, rollout, rollback and its proof | compatibility, rollout | public contract, persisted data, activation, high impact |
| 17a | Capacity and cost | capacity | behavior work with new load, storage, or paid resource |
| 17b | Backup, restore, disaster recovery | dataModel.recovery | new or changed data store |
| 18 | Test strategy | testMap (+ testStrategy) | behavior work |
| 19 | Dependencies | new dependencies | library, team, or service prerequisite |
| 20 | Risks | risks | present |
| 21 | File map | fileMap (derived) | always, appendix |
| 22 | Test map | testMap (derived) | behavior work, appendix |
| 23 | Selected prototype | prototypeSelection | prototype run |

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
- **Domain model:** type | rule | constructed at; illegal states; module |
  interface | hidden decisions; injected nondeterminism; expected,
  infrastructure, and bug error classes.
- **Boundary decision:** boundary | sync/async | reason | timeout and retry
  (bounded, backoff, jitter, idempotent only) | consistency and staleness
  budget | write owner; latency budget nests inside the caller's; one
  correlation id across hops.
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
- **API contract:** OpenAPI source of truth and CI breaking-change check;
  resource model; auth and per-object authorization (foreign objects answer
  404); request/response schemas with units, limits, and absent-vs-null; wire
  model separate from domain model; one error envelope (stable code, human
  message, field errors, request id) and the full status/code table per
  endpoint with retryability; idempotency key scope (client + endpoint),
  retention, verbatim replay including status, in-flight 409, payload-mismatch
  422; conditional requests; cursor pagination with order, default and max
  limit, allow-listed filters and sorts; long-running operations; rate limits
  with Retry-After; versioning and compatibility class; deprecation (announce,
  Deprecation and Sunset headers, per-consumer usage metric, remove at zero);
  named consumers and consumer evidence.
- **Event contract (AsyncAPI):** channel, action, message name and version,
  payload, headers, correlation id, ordering key, delivery semantics, dedup
  key, retry/DLQ, compatibility rule, consumer handling of duplicate, late,
  and out-of-order events, named consumers.
- **UI contract:** design reference; entry information the user needs before
  acting; every applicable state (loading, empty, denied, invalid, submitting,
  in-progress, unknown, partial, success, terminal) with what the user sees
  and can do next; input preserved on error; duplicate submission prevented;
  copy rules and languages; accessibility rows labeled standard (WCAG 2.2 AA
  criterion), platform convention, or heuristic with the check used;
  untested assistive technology disclosed; responsive behavior; component map;
  validation plan (method, participants, task, pass rule, severity scale).
- **Config contract:** key | type | default | validation | secret | per-environment | reload | owner | removal task.
- **i18n (UI and user-visible data):** languages, locale formats (number,
  currency, date), time zone source and storage (UTC), bidi text, collation and
  search, text expansion, translation source.
- **Accessibility conformance report:** update the ACR/VPAT rows touched
  (optional; when the product publishes one).
- **Threat model (OWASP four questions):** assets and data classes, trust
  boundaries (shown in the data-flow diagram), STRIDE rows (threat,
  likelihood × impact, response, control → scenario, residual risk).
- **Observability:** failure mode | signal | SLI | SLO/alert | runbook action |
  owner; PII-in-telemetry check. Usage and health: signal that the feature is
  in use and working for a given user or tenant.
- **Tracking plan:** success measure → event name → properties → trigger →
  owner → dashboard; consent and PII rules.
- **Tenancy:** isolation mechanism per layer (API, compute, data, cache,
  queue), tenant context source and propagation, noisy-neighbor limits,
  per-tenant metering and cost, cross-tenant test.
- **Capacity and cost:** expected load and growth, limits that would exhaust
  (connections, storage, quota), headroom, cost estimate and owner.
- **Data recovery and data contract:** backup scope and frequency, restore
  test, RPO/RTO, region failure; for shared data: freshness, update frequency,
  quality rules, retention, end-of-life date (ODCS).
- **Rollout/rollback:** strategy and reason; deploy order across components;
  stages and gates; flag and removal task; expand → migrate → contract data
  phases; rollback trigger; data reversibility; old/new overlap window;
  cross-repo ordering. Enablement (KEP PRR): how it is enabled, whether it
  changes default behavior, whether it can be disabled once enabled, what
  happens when re-enabled after rollback, downtime needed, enable/disable test.
  Rollback proof: upgrade → downgrade → upgrade test or a rehearsal record.
  Version skew: component × version matrix that must work together. Upgrade
  steps existing users must perform. Optional: maturity criteria (alpha, beta,
  GA), change window and blackout dates.
- **Supply chain (dependency):** provenance or signature verified, SBOM
  regenerated, license and CVE scan.
- **Communication and support:** audience → channel → timing; support
  runbook and owner after launch; user docs updated; release-note text per
  user-visible type.
- **Compliance change record (opt-in in `openspec/config.yaml`):** requester,
  approver distinct from implementer, approval recorded before Build, change
  window, emergency path with retrospective approval, links to evidence and
  Land.
- **Spec deltas:** ADDED, MODIFIED (full replacement text), and REMOVED with
  Reason and Migration; deprecation is a MODIFIED requirement until removal.

## Work type catalog

Every change declares one or more work types; the harness infers them from
task paths when absent. Each type adds required design sections, a detail
format, a routed skill, and evidence. Behavior-neutral types (refactor, docs,
chore, test, config) skip the failure matrix. Variants refine a base type
without becoming a new type.

| Type | Required sections | Detail format | Routed skill | Evidence |
|---|---|---|---|---|
| feature | user flow, domain model, decisions | as outlined above | programming | test |
| bugfix | bugfix analysis, failure matrix | reproduction (steps, environment), expected vs observed, root cause with evidence, introducing commit, blast radius and affected data, data repair, failing-before regression test | debug | failing-before test |
| bugfix + security riskSignal (security fix) | bugfix analysis, threat model | adds: vulnerability class, affected versions, exploitability, disclosure owner and embargo, advisory/CVE, backport targets | debug, security | regression + security-static |
| bugfix + hotfix lane | bugfix analysis, rollout | adds: incident link, mitigation already applied, minimum fix scope, backport branches, follow-up change for the full fix | debug, delivery | regression + real-surface check |
| refactor | refactor invariants, component map | invariants, characterization tests written first, behavior-equivalence evidence, ordered mechanical steps, performance neutrality | refactoring | characterization tests unchanged |
| api | API contract, boundary decisions | API contract format | api-design | contract + breaking-change check |
| library (SDK, package, CLI) | public interface contract | exported symbols or commands and flags, signatures/types, exit codes and stdout/stderr contract, error types, semver class, supported runtimes, deprecation with warning period, changelog entry | api-design | contract/snapshot test + public API diff |
| ui | user flow, UI contract, component map | UI contract format | ux-ui | e2e + accessibility |
| data | data model | data model format | database | migration test |
| migration (platform/framework/service move) | migration plan, rollout | from → to, strangler seam, dual-run or shadow traffic, parity check and tolerance, cutover criteria, rollback window, decommission task | architecture, refactoring | parity report |
| async | job/event contract, sequence or state diagram | event contract; job: states, retry, timeout, idempotency, concurrency, schedule, poison-message handling | queue | integration with broker |
| integration | integration contract | external system and owner, documentation link and version, auth and secret, rate/quota limits, sandbox, anti-corruption mapping, webhook signing and replay, outage behavior | architecture, security | contract test against sandbox or recorded fixture |
| config | config contract | key, type, default, validation, secret or not, per-environment values, reload behavior, owner, removal task | programming | validation test |
| performance | NFR, performance analysis | baseline with method, profile evidence, hypothesis, target, benchmark (runs, variance, environment), resource trade-offs, regression budget | performance | benchmark vs base |
| dependency | dependency change | current → target, changelog breaking changes reviewed, CVE fixed or introduced, license, transitive impact, lockfile diff, rollback pin | delivery, security | full regression + audit |
| deprecation | deprecation plan, spec MODIFIED/REMOVED | what, replacement, consumers, announce date, warning signal (header, log, CLI warning), per-consumer usage metric, removal condition (usage zero) | api-design | warning test + usage metric |
| infra | infra plan, container/deployment diagram, rollout, handoffs | IaC plan diff, environments, capacity, cost delta, blast radius, secrets, provisioning order, drift detection, external operations | delivery, architecture | plan check + post-apply smoke |
| observability | observability | observability format | observability | signal emitted test |
| privacy | privacy assessment, threat model | personal data inventory and class, purpose and lawful basis, data minimization, retention and deletion path, subject requests (access, delete), cross-border transfer, LINDDUN privacy threats, telemetry PII check | security | deletion/retention test |
| experiment (A/B, feature experiment) | experiment design, rollout | hypothesis, primary metric, guardrail metrics, unit and allocation, sample size or duration, stop rules, exposure logging, decision rule, cleanup task | ux-ui (if UI), observability | exposure event test |
| client-release (mobile/desktop app) | release plan | minimum supported version, old and new clients coexisting, server compatibility window, store review timing, staged rollout percentages, forced-upgrade rule, crash-rate gate | delivery | crash-free gate |
| ml (model or LLM feature) | model card, evaluation plan, rollout | intended use and out-of-scope use, model/provider and version pin, prompt or training data source and license, evaluation set and thresholds (quality, safety, bias), limitations and failure modes, human oversight, cost and latency per call, drift and quality monitoring, fallback when the model fails | ml-relevant: testing, observability, security | evaluation run vs threshold |
| docs | none (summary only) | audience, documents touched, mirrored languages | — | docs build/consistency |
| test | none (summary only) | behavior or gap covered, level, flakiness control | testing | tests pass |
| chore | none (summary only) | — | — | suite passes |

Implementation notes: `WORK_TYPES` in `design-blueprints.mjs` omits `test`
although `dev-document.mjs` treats it as light work; reconcile when the work
types change lands. New typed fields: bugfix variants (security, hotfix),
library contract, migration plan, integration contract, performance analysis,
dependency change, deprecation plan, infra plan, privacy assessment,
experiment design, release plan, model card. Cross-cutting fields: decisionLog,
communication, releaseNote, demo, tenancy, capacity, trackingPlan,
dataModel.recovery, rollout.enablement, rollout.rollbackProof,
rollout.versionSkew, compliance. Every user-visible type adds a release note.

## Gaps found in the current harness

- New draft fields needed: boundaries, domain, ui (states, entryInfo,
  validation), config, consumers, rollout, threatModel, nfr scenarios,
  eventContracts, observability, testStrategy, dependencies, alternatives;
  apiContracts
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
Gap review (2026-10-15): Kubernetes KEP template and PRR
(https://raw.githubusercontent.com/kubernetes/enhancements/master/keps/NNNN-kep-template/README.md),
PEP 12 (https://peps.python.org/pep-0012/), Oxide RFD 1
(https://rfd.shared.oxide.computer/rfd/0001), HashiCorp RFC
(https://www.hashicorp.com/how-hashicorp-works/articles/rfc-template), Google
SRE launch checklist (https://sre.google/sre-book/launch-checklist/), AWS ORR
(https://docs.aws.amazon.com/wellarchitected/latest/operational-readiness-reviews/wa-operational-readiness-reviews.html),
AWS SaaS Lens (https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/general-design-principles.html),
SLSA (https://slsa.dev/spec/v1.0/requirements), NTIA SBOM minimum elements
(https://www.ntia.gov/sites/default/files/publications/sbom_minimum_elements_report_0.pdf),
ODCS (https://bitol-io.github.io/open-data-contract-standard/latest/), model
cards (https://huggingface.co/docs/hub/model-cards), tracking plan
(https://amplitude.com/docs/data/create-tracking-plan), W3C internationalization
(https://www.w3.org/TR/international-specs/), FinOps
(https://www.finops.org/framework/capabilities/architecting-for-cloud/), Keep a
Changelog (https://keepachangelog.com/en/1.1.0/), Section 508 ACR
(https://www.section508.gov/sell/acr/). SOC 2 CC8.1 and ITIL change records
were read through secondary sources; GitLab, Sourcegraph, and Uber templates
were not reachable.
Paywalled standards (29148, 29119-3, 1016) were read through tables of contents
or secondary sources.
