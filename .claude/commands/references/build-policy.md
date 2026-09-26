# Build operating policy

Before editing, including after a session restart, read the full requirements
and scenarios for the returned tasks and their dependencies, plus relevant
design decisions, diagrams, folder mapping, and evidence obligations at the
packet's references. A scenario preview or hash is navigation, not the full
agreement or proof that it was read. Follow truncated references to their
source; resolve missing or contradictory material through the existing
amendment/decision route. Preserve scope settled before this session.

The protocol-v6 `advance` action is the current authority. Do not call lifecycle
primitives unless its recovery explicitly names one. Update `tasks.md` only for
the returned task after focused checks; the coordinator owns planning and phase
transitions. In the isolated packet only checkboxes and a task's `[paths:]` are
bookkeeping; express other agreement changes with `change amend`. Never ask the
user to copy agreement files between checkouts. Shell mutations run audited,
not blocked: anchor them in the workspace, and on
`TARGET_EDITED_OUTSIDE_SANDBOX` move your target edits into the sandbox.

## Follow-up intent gate

Classify every new user request received during an active Change against the
approved agreement before product mutation:

- If the agreement already requires the requested outcome, repair the
  implementation in contract without an amendment or another product decision.
- If the request adds or changes an observable outcome, author one batched
  semantic amendment and follow its harness-owned resume route before editing
  product code (an additive amendment keeps the approval; a removal asks). This includes UI, interaction, filter/search,
  validation, accessibility, API, data, permission, performance, integration,
  external-effect, compatibility, and rollout semantics. Revise or remove an
  existing requirement through that amendment; never abandon and rewrite the
  change merely to edit it.
- If materially different interpretations remain, ask only for that unresolved
  product decision. Do not ask the user to write specs, tasks, amendment JSON,
  commands, tests, or recovery steps.
- If the active Change is archived or the request is an independently deliverable
  outcome, start a successor Change instead of rewriting history or widening the
  current agreement silently.

The user decides product intent and material trade-offs. The agent translates
that decision into the amendment, code, tests, and durable documentation. The
harness automates validation, revision state, invalidation, evidence execution,
recovery, and lifecycle progression. A clear user instruction is decision input;
do not ask the same semantic question again. The first compiled-agreement
approval stays explicit; later additive deltas carry it. Report only the product
delta rather than its CLI or JSON.

Use these boundaries consistently:

| Request during an active Change | Classification |
|---|---|
| Apply the already-approved primary color, restore the specified button position, or fix the approved filter result | In-contract repair |
| Choose a new color, move an action to a newly requested location, add a filter, saved search, validation rule, responsive layout, or accessibility outcome | Semantic amendment |
| Add or change an API field, permission, persistence/migration rule, performance target, notification, retry, external integration, or rollout behavior | Semantic amendment |
| Add a regression test or refactor internals while preserving the approved observable behavior | In-contract implementation work |
| Change a test expectation, public documentation, or UI copy because the intended product behavior changed | Semantic amendment |
| “Make it better”, “clean up the filters”, or another request with materially different valid outcomes | Ask only for the unresolved product choice |
| Add a separate feature after archive or an independently deliverable objective | Successor Change |

During Prove, an in-contract defect follows repair and selective re-proof. A new
user outcome returns through amendment and Build before Prove resumes. After any
product or agreement edit, never treat the prior proof as fresh.

For every mutating Bash command — redirects and heredocs, `sed -i`, `ln`,
`cp`, `mv`, `rm`, `touch`, package scripts, `npx` — begin with
`cd <workspace or a directory inside it> && ...`; the live phase guard proves
the command text. On Claude Code it pins the shell's reported directory as
that anchor when it lies inside the workspace; other hosts refuse an
unanchored command, so anchor explicitly. It rejects
an unanchored command, absolute outside operands, later directory escapes,
symlink traversal, and copying or linking from outside the workspace. A fresh
workspace has no installed dependencies: rely on `sandbox.setupCommand` in
`foundation.json`, or run the project's install once inside the workspace;
never link or copy the checkout's `node_modules`. Run returned long commands through
`claude-foundation exec`; it derives the active phase and starts Build children
in the canonical workspace. Prefer structured Edit/Write tools for product
changes.

Move unauthorized infrastructure operations to a semantic amendment that adds
an external operation; never ask for credentials. Time a returned long command
only when its action requests observed execution.

For defect guards, test adjacent input partitions and source-language coercion
boundaries before completing their tasks; do not stop at the reported repro.
For UI outcomes, check that the required value is rendered and reachable, not
only calculated. For evolving persisted or wire data, exercise the supported
older representation. Map required critical cases to claims and executable
observations through the existing agreement; discovered test tags alone do not
add or prove acceptance criteria.

Reuse an existing deterministic test command for every claim it actually
observes, including compatibility and validation claims. Do not create a
bespoke evidence executable merely to give a capability its own command. If
no existing check can observe a claim, declare the new checker as product work
in `tasks.md`, test its success and failure paths, and keep those tests in the
normal quality run; an untested checker cannot be completion evidence.

Ask only for structured decisions. Ask again only if behavior, compatibility,
security, data, or rollout must change. Provider and permission failures follow
typed recovery.

## Convergent gates

Before product edits, obey the action boundary. `advance` has already evaluated
authority preflight; do not repeat it.

For every Build gate, run all independent eligible checks before repair. Group
findings by root cause, build one dependency-ordered repair batch, apply every
safe in-contract fix, and rerun only failed, unavailable, downstream,
input-invalidated, or mandatory global checks. Continue without a repair-count
limit while the progress fingerprint changes.

At a decision, authority, resource, conflict, contradictory-contract, or
repeated no-progress boundary, preserve the sandbox, present the typed choices,
and resume the same Build yourself after resolution. Keep the resume route
agent-only unless the user requests diagnosis. Never turn repeated execution or
a stale receipt into a pass.
