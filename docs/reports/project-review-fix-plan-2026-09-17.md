# Project review and proposed fix plan — 2026-09-17

Review baseline: `63f2ce1c4b73034bed2cbdb70b924928529e3fde`, Change Loop 3.5.18.
The source worktree was clean. This is a review and proposed sequence, not an
implementation record or release approval. Canonical behavior remains in
[WORKFLOW.md](../../WORKFLOW.md), [EVIDENCE.md](../../.claude/harness/EVIDENCE.md),
and the [maintainer guide](../../CLAUDE.md).

## Scope and confidence

All 1,696 tracked files were inventoried and fingerprinted: 16,583,332 bytes and
331,546 newline characters, including large generated quality inventories and
historical OpenSpec records. Every tracked JavaScript module received a syntax
check; every JSON, YAML, and Python file received a parse check. Behavioral review
focused on active runtime boundaries, shipping, evidence, publication, and
dashboard state, backed by the registered tests and additional reproductions.

This is repository-wide coverage, not a claim that every line of every historical
record, design dataset, fixture, and generated report received an independent
semantic audit. Dependencies, ignored runtime state, credentials, and built output
were not treated as authored source. No paid scenario, live model provider, remote
push, PR creation, deployment, or publication was performed. Reproductions used
disposable repositories; publication commands were mocked.

| Surface | Tracked files | Review coverage |
|---|---:|---|
| Shipped harness, contracts, and colocated tests | 297 | Syntax, imports, registered tests, targeted boundary review |
| Hooks and host instructions | 32 | Contract tests, shell checks, routing/guard configuration |
| Skills and bundled datasets | 170 | Inventory, Python parsing, instruction/context/reference checks |
| Deterministic tests and scenario labs | 448 | Registered runner, fixture/import inspection; no paid execution |
| OpenSpec schemas | 18 | YAML parsing, compiler/installer/contract tests |
| OpenSpec agreements and archives | 429 | Inventory and YAML parsing; retained as historical agreements |
| Dashboard | 34 | Registered dashboard tests, source review, HTTP reproduction |
| Website | 60 | Syntax, example tests, English/Thai docs build |
| Examples | 58 | Syntax and dedicated Node/Vitest tests |
| Quality and release tooling | 68 | Syntax, registered tooling tests, release preflight |
| Docs, reports, release notes, legacy records | 53 | Index/canonical contract review; historical records preserved |
| Root configuration and distribution | 29 | Installer reproduction, pins, manifest/CLI and configuration review |

## Confirmed findings

Priority P1 means a proof, authority, or filesystem boundary should be fixed before
relying on the affected path. P2 means a functional or supported-environment defect.
P3 is guidance cleanup. Findings below describe current behavior, not hypothetical
third-party vulnerabilities.

### R1 — P1: Unexecuted browser tests receive passing evidence

Locations: `.claude/harness/runtime/evidence/evidence-results.mjs:158`, `:173`,
`:181`; `.claude/harness/runtime/evidence/adapter-runtime.mjs:632`.

`playwrightTestOutcome` returns neither failed nor skipped for an empty results
array, a result without status, or an unknown status. `recordPlaywrightTest`
then increments the test count, credits claim annotations, and marks critical
cases as passing. The adapter accepts those values when the command exits zero.

Reproduction: reports with `results: []`, `results: [{}]`, and
`results: [{status: "unrecognized"}]`, each annotated with a required claim and
critical case, all produced a passing adapter result and passing recorded receipt
arguments: `1 tests; 0 failed; 0 skipped; covered claims 1/1`.

Fix: require a recognized executed outcome before crediting claims or cases;
preserve missing/unknown outcomes as unavailable or inconclusive. Reject zero
executed tests independently of annotations. Decide and test retry semantics
explicitly. The existing helper test at `evidence-results.test.mjs:228` currently
accepts the ambiguous result and must change with the implementation.

Regression: pure outcome tests plus a real-normalizer/adapter integration test for
empty, malformed, unknown, skipped, failed, and passed outcomes. Review the adapter
protocol pin and upgrade behavior so previously accepted invalid receipts cannot
remain reusable after this semantic correction.

### R2 — P1: Installation follows writable symlinks outside the target

Locations: `install.sh:135`, `:156`, `:241`–`:245`.

Manifest validation checks strings, but backup and copy destinations can traverse
symlink ancestors. A target containing `.claude -> ../external` causes installation
to overwrite files in the external directory, outside the named install target.

Reproduction: an external `orchestrator.md` sentinel was overwritten and
`external/harness/foundation.mjs` was created; the installer exited zero.

Fix: preflight canonical containment of every mutation/backup/removal destination,
including managed roots, project-owned merge targets, legacy paths, and manifest
paths. Reject external symlink traversal before the first write, preserve links
and external bytes on failure, and apply the same rule to adapter installers.
Do not silently replace shared user configuration.

Regression: external directory symlink, symlinked leaf, symlinked `.foundation`,
stale-manifest deletion through a link, and failure/rollback cases. Assert both
target and external sentinels, not only installer exit status.

### R3 — P1: Deliver checks the fetch URL but publishes through an unchecked push URL

Locations: `.claude/harness/runtime/workflow/pull-request-runtime.mjs:520`–`:532`,
`:790`, `:954`.

`providerContext` validates `git remote get-url origin`, while publication invokes
`git push origin`. A separate `remote.origin.pushurl` can point elsewhere, so the
validated host/repository is not necessarily the publication destination.

Reproduction: fetch URL `https://github.com/acme/booking.git`, push URL
`https://unapproved.example/acme/booking.git`; Deliver reached the mocked push
with the unapproved effective push URL. No network push occurred.

Fix: resolve and validate every effective push URL, including URL rewrites and
multiple destinations. Require a destination consistent with the approved
provider/repository, or return an explicit unsupported-remote decision. Bind the
destination to the delivery checkpoint and revalidate on resume before effects.

Regression: distinct push URL, same-host different repository, multiple push URLs,
rewrite rules, and remote changes between attempts, for root and child repos.
Every disallowed case must make zero publication calls.

### R4 — P1: A custom PR base bypasses default-branch push protection

Locations: `.claude/harness/runtime/workflow/pull-request-runtime.mjs:528`,
`:752`, `:925`.

The guard compares the delivery branch only with the configured PR base. With
`defaultBaseBranch: "release"`, `branchPattern: "main"`, and actual remote default
`main`, the branches differ and the default-branch restriction is not enforced.

Reproduction: a disposable repository with remote HEAD `origin/main` and no local
`main` branch reached a mocked push of `<commit>:refs/heads/main` despite the
unconditional `allowDefaultBranchPush: false` policy.

Fix: resolve the remote default branch separately from the selected PR base and
forbid publication to either protected destination. Fail closed when the actual
default branch cannot be established; revalidate on resume. Reuse the destination
identity work from R3.

Regression: custom base plus real default destination, ordinary feature branch,
non-main default names, stale remote-HEAD information, and multi-repository routing.

### R5 — P1: A chmod after Land becomes the newly trusted delivery mode

Locations: `.claude/harness/runtime/workflow/pull-request-runtime.mjs:366`–`:386`,
`:404`–`:435`; `.claude/harness/runtime/workflow/delivery-integrity.mjs:5`.

Projection creation compares current content identity with the Land journal, but
does not compare the recorded `afterMode`. It then records the current file mode
as the expected delivery mode. Later tree checks therefore accept an executable
bit changed after proof/Land but before the first Deliver invocation.

Reproduction: the journal recorded `src/booking.js` at `0644`; chmod to `0755`
without changing bytes allowed creation of a `100755` Git blob and reached the
mocked push. Existing resume-mode coverage does not cover this earlier boundary.

Fix: validate and derive expected modes from the Land-bound journal/integrity
record before snapshotting delivery inputs, using consistent filesystem-to-Git
mode normalization. Apply to root, child, and archive/spec inputs where relevant.
Keep the post-stage and post-commit checks already present.

Regression: executable-bit changes in both directions before first delivery,
root/child projections, mode-only changes, valid executable files, and legacy
journals with an explicit compatibility decision instead of invented certainty.

### R6 — P2: Deliver loses valid dangling symlinks

Location: `.claude/harness/runtime/workflow/pull-request-runtime.mjs:310`–`:316`.

`copyEntry` uses `existsSync(source)` before `lstatSync`. A dangling symlink has a
valid link identity but `existsSync` follows its absent referent and returns false.
The link is omitted from the delivery worktree, and integrity checking later
blames a missing proven path and asks for a new change.

Reproduction: a Land-bound `link -> missing-target` returned `ASK_USER` with
`delivery tree is missing a proven path: link`; no publication was attempted.

Fix: distinguish an absent directory entry from an existing symlink with `lstat`;
copy link text verbatim, including dangling targets. Apply the same distinction
when identifying stageable new links. Keep genuine deletion handling intact.

Regression: new and modified dangling links, valid links, links outside the
worktree, deletions, and resumed workspaces; assert Git mode `120000` and link text.

### R7 — P2: Expired dashboard agents can block all new registrations

Locations: `dashboard/server.js:593`, `:616`, `:941`.

The heartbeat route enforces `MAX_AGENTS` before pruning. Pruning runs after an
accepted heartbeat or during `/api/online`. When a full roster becomes stale,
new agents continue receiving 429 if no viewer or old agent triggers cleanup.

Reproduction: with capacity one, age the accepted agent beyond retention and post
a new agent: 429 `agent capacity reached`. Fetch `/api/online`, then repeat the
same heartbeat: 200. This used a local HTTP server and in-memory SQLite.

Fix: prune expired entries before admission/capacity evaluation and keep cache and
persistence invalidation consistent. Consider boot cleanup for restored rosters.

Regression: full-but-expired roster accepts a new agent without any viewer request;
full live roster still rejects it; persisted expired entries are removed.

### R8 — P2: Docs package declares a Node version its pinned Astro cannot run on

Locations: `website/docs/package.json:7`, `website/docs/package-lock.json:2476`.

The docs package advertises Node `>=20.19.0`, while its locked Astro 7.3.2 requires
Node `>=22.12.0`. The successful build on the installed newer Node does not verify
the advertised lower bound. This is a manifest-confirmed mismatch; no Node 20
docs build was run during this review.

Fix: align the docs package and contributor guidance with its actual dependency
minimum, refresh the docs lockfile's root-package metadata, and exercise that
minimum in the docs CI lane. Keep the consumer harness Node support independent.

### R9 — P3: Agent and quality guidance retains old protocol defaults

Locations: `AGENTS.md:19`, `quality/README.md:46`.

AGENTS names draft v3 as the new-work path, while CLAUDE and the protocol pin use
v4 with v3 compatibility. The quality guide still calls advance protocol v4 while
the current pin is 6. These instructions can route new authoring through an older
compatibility path or confuse maintainers.

Fix: align concise summaries with canonical current contracts and add targeted
consistency assertions. Preserve historical documents and supported legacy input.

### R10 — P2: Investigation delivers machine-readable JSON without a dependable human report

Added from user feedback after the baseline review: the investigation artifact
arrives as JSON and is difficult to read. Source inspection corroborates the
presentation gap; this is not an additional reproduced runtime safety defect.

Locations: `.claude/commands/investigate.md`,
`.claude/skills/investigate/references/workflow.md:8`–`:20`,
`.claude/harness/runtime/workflow/investigation-runtime.mjs:586`, and the
English/Thai `website/docs/src/content/docs/loop/investigate.md` pages.

The command requires a JSON record, the runtime prints a JSON action envelope,
and the readable Markdown note is optional. Although the workflow asks the agent
to return conclusions in the user's language, no dependable human-readable file
is required. Users therefore receive the data structure without a clear reading
order for the conclusion, evidence, alternatives, and pending decisions.

Fix: make a readable report a standard Investigation deliverable, accompanied by
a short chat summary and a link. Keep the existing JSON record, runtime state,
and CLI response compatible for validation, resume, and handoff. Generate the
report from the validated record and current outcome rather than maintaining a
second independent account of the findings.

The report should lead with the problem, current conclusion, recommendation and
its reasons, then show verified facts with source links, hypotheses and their
status, comparison/tradeoffs when applicable, remaining unknowns, and any actual
decision required from the user. Use the user's language for the presentation;
do not invent missing evidence or turn an open hypothesis into a confirmed fact.
For an incomplete investigation, make the incomplete status and next step clear.
Do not automatically start Change from this report.

Use a distinct generated path such as
`openspec/investigations/<id>.report.md`; preserve existing user-authored
`<id>.md` notes. Define generated-file ownership and safe path handling before
writing. Refresh the report after successful inspection batches and at terminal
or decision boundaries. A failed refresh must not leave an older report
presented as current. Exclude generated reports from source discovery/binding so
rendering does not invalidate the investigation that produced them.

Implementation surfaces: a bounded report renderer in the workflow domain,
the investigation runtime write point, the investigate command/workflow
instructions, and canonical English/Thai guidance. Do not replace the CLI's JSON
stdout with Markdown or rename public arguments as part of this fix.

Regression: all investigation outcomes; analysis and comparison modes; Thai
content; source links; unsupported hypotheses; pending user choices; stale/error
report handling; existing note preservation; path containment; idempotent
rendering without source-digest feedback; and unchanged JSON/handoff behavior.
Acceptance: a user can understand the result and next decision from the report
without opening JSON or interpreting internal protocol fields.

### R11 — P2: Normal Git line-ending conversion blocks valid Deliver content

Locations: `.claude/harness/runtime/workflow/delivery-integrity.mjs:5`–`:12`,
`:53`–`:60`; `.claude/harness/runtime/workflow/pull-request-runtime.mjs:1005`.

The projection binds raw worktree bytes, but delivery integrity compares that hash
with raw committed Git blob bytes. With a tracked `*.js text eol=crlf` attribute,
a valid CRLF worktree file becomes an LF Git blob when staged. Deliver treats the
normal conversion as unproven content and refuses to continue.

Reproduction: a disposable repository using the existing delivery integration
fixture, a tracked `.gitattributes`, and a CRLF proven source returned `ASK_USER`,
`completed: false`, and `delivery tree differs from the proven content:
src/booking.js`. No push was attempted. The only offered choices were creating a
new Change or cancelling delivery. A new Change retaining the same attributes
and line endings does not address this comparison defect. Fetch was local and
publication was mocked; this verifies delivery from an archived fixture, not an
entire live-model lifecycle on Windows.

Fix: define and bind both proven worktree identity and the expected Git object
representation under the authorized attributes/conversion rules. Validate the
staged and committed objects against that bound representation, preserving
post-Land drift and hook-mutation detection. Bind relevant conversion inputs;
do not bypass integrity checks or indiscriminately normalize binary content.
Custom clean filters and LFS need explicit support/unsupported-case handling;
their behavior was not reproduced by this review.

Regression: LF, CRLF with explicit attributes, `core.autocrlf`, binary files,
changed attributes, and post-stage hook edits. Verify valid content reaches the
mocked publication endpoint while real mutation remains rejected.

## Consumer completion blockers

This section addresses users installing the harness into other projects, not
obstacles to implementing this upstream repair plan.

Two unintended completion blockers are reproduced: R6 (a valid dangling symlink
is omitted from the delivery tree) and R11 (normal Git CRLF conversion is rejected).
Both affect optional `/deliver` after `archived`; they do not establish a failure
of the normal Change → Build → Prove → Land/archive endpoint. Their recovery
messages misroute the user to a new product Change instead of addressing harness
behavior.

No unrecoverable core-lifecycle defect has been demonstrated by this review.
That is a coverage limit, not a universal completion guarantee. The isolated
proof-loop fixture reached archive; the full upstream suite timeout is not
evidence of a consumer deadlock. R1–R5 primarily concern invalid acceptance or
unsafe mutation/publication, rather than inability to finish. R7 affects dashboard
admission, R8 affects the upstream docs environment, and R10 affects understanding
and handoff of Investigation results.

Actual consumer prerequisites can still prevent completion: unavailable setup
dependencies, required evidence/reviewer access, unresolved product failures,
conflicts with target edits, missing explicit Land/publication authority, and
exhausted resources or budgets. These require an accurate diagnosis and a working
resume route. Do not describe all such stops as bugs or silently waive requirements.

Before claiming broader consumer completion, exercise disposable installed
consumers through `archived`, covering an existing dirty project, interrupted
setup with restored prerequisites, reviewer/provider unavailability and recovery,
target conflicts, and multi-repository dependency waves. Test optional Deliver
separately with R6/R11 fixtures. Real provider execution remains subject to its
separate authorization; deterministic mocks cannot prove live credentials or
service availability.

## Completion and recovery acceptance across all fixes

The eleven fixes do not establish that every possible consumer workflow can finish
without intervention. Preserve legitimate authority, conflict, resource, budget,
and evidence boundaries from WORKFLOW.md. The direct-repository execution plan
below does not itself enter Change or require Land.

Every new rejection must identify the cause, retain the work, identify who can
resolve it, and supply an executable recovery/resume route or concrete user
options. A diagnostic-only command is not sufficient when a known repair exists.
The agent/harness executes authorized recovery; users should not be asked to run
harness commands or edit runtime JSON.

| Boundary | Expected handling | Completion condition |
|---|---|---|
| Missing or malformed provider output (R1) | Diagnose and repair the runner/report configuration, then rerun only invalidated evidence; never manufacture a pass | Required evidence genuinely passes, or a separately authorized policy decision is recorded |
| External install path through symlinks (R2) | Stop before writes; show the offending resolved path and safe installation choices; do not overwrite shared files or silently move user configuration | An authorized destination is safe and installation/rollback checks pass |
| Push destination or branch-policy mismatch (R3/R4) | Explain the exact mismatch and valid feature-branch/remote choices before publication; do not silently broaden allowed hosts or rewrite user intent | Destination and branch satisfy the authorized delivery policy |
| Post-Land content or mode drift (R5) | Preserve newer user edits; identify the changed paths/modes and route intended changes through current proof, or an explicitly chosen restoration | Published bytes and modes match the approved projection |
| Symlink-copy defect (R6) | Preserve and stage the valid link as part of normal delivery; do not ask for a new product change to compensate for the copy bug | The verified Git tree retains the intended link |
| Git line-ending conversion (R11) | Compare against a bound expected Git representation while retaining raw worktree drift checks | Valid CRLF/LF conversion reaches delivery without accepting unproven edits |
| Stale dashboard capacity (R7) | Prune automatically before admission; retain real capacity enforcement for live agents | An expired roster does not prevent a new heartbeat |
| Human report generation failure (R10) | Preserve validated investigation state, report the rendering failure, and regenerate without repeating unaffected research | A readable current report is delivered; no stale report is presented as current |
| User-owned approval, subjective acceptance, or consequential conflict | Ask only for the missing concrete decision and preserve the exact current context | The needed decision arrives and is still valid for the same content |
| Live worker, external CI/reviewer, authentication, or unavailable resources | Distinguish active work from an external wait; detect dead workers; retain named owner, checking route, and actual resource/authentication boundary | Worker/recovery completes or the external dependency becomes available |
| Budget exhaustion or repeated unchanged recovery | Preserve observations and offer continuation, a different strategy, re-scope, or pause under existing policy | The required decision/resource changes; do not reset counters or invent progress |

Add focused recovery/resume regressions beside the affected fixes, reusing the
existing suites. Cover interruption before/after checkpoints, repeated invocation,
restored prerequisites, retained user work, and successful completion after the
actual blocker is resolved. These are acceptance criteria, not newly confirmed
defects in every listed path.

Verify distinct endpoints: Investigation yields its supported conclusion and
readable report without starting Change; a consumer code-delivery lifecycle ends
at `archived` once authorized; optional Deliver ends at a verified PR only when
explicitly requested. A presentation-only missing artifact should follow the
configured draft policy rather than silently becoming a new mandatory proof gate.
Do not add user confirmation to routine authorized repairs. Do not remove proof,
Land, Git, or external-effect authority merely to make a flow appear complete.

## Proposed delivery sequence

The user requested a direct-repository fix plan without entering Change. This
sequence remains planning only. When implementation is requested, edit the
repository directly and use root `tasks.md` as the sole implementation ledger,
preserving its prior records. Do not create an OpenSpec change or require the
Change/Build/Prove/Land lifecycle for this work. This report records findings and
rationale, not implementation status.

The order below prioritizes trustworthy consumer completion: first prevent an
unsafe apparent success, then remove demonstrated false stops, improve the user
handoff, and verify recovery in installed projects. All packages are **planned**.

| Order | Work package and reason | Delivery and acceptance |
|---|---|---|
| 1 | Trustworthy proof and safe installation (R1, R2): completion must mean real evidence, and installing must preserve other projects | Reject unexecuted browser evidence with a repair route; validate all install destinations before writes. Valid reports pass; unsafe links preserve target/external files; corrected prerequisites allow retry. Resolve receipt compatibility before integration. |
| 2 | Safe, successful optional Deliver (R3–R6, R11): remove the two reproduced false stops while keeping publication bound to approved content and destination | Validate effective push destinations, distinguish remote default from PR base, bind modes, preserve dangling links, and bind Git conversion rules. Valid symlink/CRLF cases reach a verified mocked PR; incorrect destination, mode drift, hook edits, and unrelated paths still stop before publication. |
| 3 | Readable Investigation (R10): users need to understand the conclusion and decide the next action | Generate a current report in the user's language, with a chat summary/link, conclusions, reasons, evidence, unknowns, and any decision. Keep JSON/handoff compatible and preserve authored notes. Rendering failure is recoverable without repeating research or starting Change. |
| 4 | Consumer recovery and completion verification: prevent a repaired prerequisite from leaving users trapped in a stale stop | Extend existing lifecycle/recovery tests with the installed-consumer cases below. First reproduce any failure, then repair only the demonstrated boundary. Every recoverable case must resume to its endpoint and preserve unrelated work. |
| 5 | Dashboard and environment guidance (R7–R9): remove stale capacity rejection and misleading setup instructions | Prune before admission; align docs Node requirements separately from consumer requirements; align current protocol guidance. Verify admission without a viewer, docs build at its declared minimum, and documentation consistency. |
| 6 | Integrated verification and upgrade: ensure separate fixes work together in the shipped installation | Run the authoritative deterministic suite, affected upgrade/installer coverage, docs consistency/build, website/example checks, release preflight, and diff checks. Diagnose the observed full-suite timeout using measured runtime/concurrency. A focused pass does not replace the full gate. |

Within package 2, resolve destination identity before branch protection; resolve
the Land-bound projection before mode, link, and conversion integration. Reuse
existing runtime domains and test fixtures rather than creating a second delivery
pipeline. Retain commit-hook, interrupted/recovered commit, PR-base ancestry,
sibling-repository, and submodule coverage.

Package 4 extends the existing `advance-recovery`, `delivery-convergence`,
`run-stale-recovery`, installer/upgrade, and `run-proof-loop` suites where they own
the behavior. It is a validation work package, not a claim that each scenario
below currently contains a bug. Required recovery changes should remain local;
do not redesign the state machine solely to make its messages uniform.

### Installed-consumer acceptance matrix

Use disposable consumers installed from the candidate shipping files. For each
recovery case, establish the stop, preserve the checkpoint, resolve the actual
cause, start a fresh runtime session, and verify completion. Ordinary Land must
leave target HEAD and index unchanged; optional Deliver has separate Git authority
and performs its commits in its delivery workspace.

| Consumer scenario | Required observation |
|---|---|
| Fresh install and existing dirty project | Reach `archived` after the required decisions; preserve unrelated tracked/untracked files, project configuration, target HEAD, and index |
| Upgrade with existing state and custom policy | Preserve project-owned files and configuration; reuse compatible state, and explicitly invalidate only evidence made incompatible by the changes |
| Setup interrupted or dependency unavailable, then restored | Diagnose the real prerequisite and resume setup/build using the retained state; no new Change required merely to retry setup |
| Required reviewer/provider unavailable, then restored | Follow the configured permitted recovery route; retain valid evidence and rerun invalidated checks; reach archive without fabricating a verdict |
| Failed product test, followed by an implementation repair | Preserve independent passing evidence where valid, run the required checks on the new subject, and reach archive |
| Target conflict or missing Land decision, then explicitly resolved | Preserve both versions while blocked; apply only with current authority and valid evidence, then archive |
| Interrupted Land and repeated resume | Recover transactionally without duplicate effects or lost user work; reach archive with unchanged target HEAD/index |
| Multi-repository dependency wave interrupted | Preserve per-repository checkpoints and read-only repositories; resume the correct wave without repeating completed mutations |
| Budget or repeated no-progress boundary | Explain the actual boundary and retain state; a valid continuation decision resumes work, while pause stays paused |
| Archived source with dangling links or CRLF | With optional Deliver authorized, reach a verified mocked PR with correct link text and expected Git content; retain destination and integrity rejection coverage |
| Investigation report interrupted or stale | Regenerate a current readable result from valid state; do not present an outdated report as current or invalidate evidence by rendering |

For waiting/repair scenarios, verify both the machine envelope and the human
handoff: current stage, concrete cause, responsible actor, next action, and resume
route. Where the agent can execute an authorized repair, it should do so; ask the
user only for the consequential decision or unavailable authority/resource.

### Compatibility decisions and remaining limits

Resolve these implementation choices against the canonical contracts while
implementing the owning package; they do not currently block planning:

- R1: invalidate old ambiguous receipts through the existing version/binding
  mechanism, changing a protocol pin only when the wire-visible contract changes.
- R5: handle journals lacking mode evidence explicitly; never trust the current
  mode merely because the old record omitted it. Define the supported recovery
  path before considering legacy delivery complete.
- R11: initially prove deterministic Git text conversion. Inventory custom clean
  filters/LFS before claiming support; do not execute an unapproved filter or
  accept arbitrary transformed bytes as proven.
- R10: generate `<id>.report.md` separately from authored notes, preserve JSON CLI
  output, and keep generated reports outside investigation source bindings.

Real provider availability, credentials, and external CI cannot be guaranteed by
deterministic tests. Paid/live scenarios remain separate authorized validation.
Likewise, this macOS CRLF reproduction does not establish native Windows support;
test only the advertised platform contract and label untested environments.

Completion of the improvement work requires matching regressions for the confirmed
runtime defects, the installed-consumer acceptance results, aligned documentation,
a passing authoritative deterministic run, and a reviewed final diff. Retain
before/after evidence and disclose any unsupported scenario; do not report that
every possible consumer project is guaranteed to finish. Leave implementation
changes uncommitted unless separately authorized. This planning update itself
does not authorize implementation, commit, push, PR creation, or publication.

No broad rewrite or complexity-driven refactor is needed for these fixes. Keep
runtime changes in their current domains and `foundation.mjs` a composition root.

## Verification and retained evidence

Checks ran on Node 26.3.0 on this macOS host.

| Check | Result |
|---|---|
| Full `.claude/tests/run-all.sh` | Exit 1: 207 suites passed; `proof loop end to end` exceeded its 300-second limit under the default 24-worker run |
| Isolated proof-loop rerun | Exit 0; 51/51 assertions passed, including automatic Land recovery and archive |
| JavaScript syntax | 524/524 `.js`, `.mjs`, and `.cjs` files passed `node --check` |
| JSON / YAML / Python parsing | 80 JSON, 236 YAML, and 19 Python files passed |
| Static shipping surfaces, within full suite | 98 shell files, workflow YAML, Formula syntax passed |
| Documentation consistency, within full suite | 134/134 assertions passed |
| Docs production build | Passed, 37 pages; existing empty-i18n and missing-404-content warnings |
| Website and first-generation example tests | Passed |
| Todo v2 example tests | 5 files, 58 tests passed |
| Release preflight on clean baseline | Exit 0; all structural checks passed; paid portfolio readiness remained advisory/unavailable |
| Additional reproductions | Five delivery cases (including the follow-up CRLF case), three invalid browser-result cases, installer escape, and dashboard admission defect reproduced |

The full deterministic gate is **not green** on this review run. The timed-out
suite had no reported failing assertion before termination and passed all 51
assertions when rerun in isolation. This supports a runtime/resource-limit
explanation, but does not establish the exact cause. A focused pass does not
replace a successful full gate. Before release, establish a reliable full-run
concurrency/timeout configuration and rerun the complete gate. Do not turn a
timeout into a pass.

After adding this report, documentation consistency passed again (134/134),
`git diff --check` passed, and fingerprint comparison confirmed that the only
changed baseline file was `docs/reports/README.md`. The only added repository
file was this report; product source, existing tests, Git HEAD, and index were
not changed by the review.

Temporary reproduction artifacts were kept outside the worktree under
`/var/folders/xv/rnwy766j2wv3d7d2yqzn9x340000gn/T/changeloop-review-iidc6bio/`:
`file-inventory.csv`, `full-suite.log`, `proof-loop-rerun.log`, `delivery-reproductions.test.mjs`,
`delivery-reproductions.log`, `browser-reproductions.test.mjs`,
`browser-reproductions.log`, and `installer-reproduction.log`.
The follow-up CRLF reproduction is `/tmp/changeloop-crlf-review.test.mjs`.
The generators were `/tmp/changeloop-review-reproduce.py` and
`/tmp/changeloop-dashboard-reproduce.cjs`. These are temporary diagnostic artifacts,
not installed product files or durable project proof.
