# Rapid path

The default `/dev` path: Change → Build → Prove → Land with three commands,
`claude-foundation change start`, `advance`, and `changes`. The harness owns
setup, evidence wiring and upgrade, sandbox sync, agent-runnable review, task
ticking, validation, and proof. You own the draft, product code, and tests.

## Rules

- Never read `.claude/harness/**` source, receipts, or `.foundation` state to
  recover. Every `REPAIR` or blocked result carries its fix: apply the named
  field or instruction, or run the returned `command`, then its `resume`.
- Command, resume, and next fields are agent-only control data. Run them
  yourself; never ask the user to run one. Report in the user's language.
- Never hand-edit generated packet files: `execution.yaml`, `evidence.yaml`,
  `handoffs.yaml`, `grounding.yaml`, `tasks.md` checkboxes, or task IDs. The
  agreement changes only through the draft or one semantic amendment.
- Never infer approval or Land authority from silence. Never commit, push, or
  open a PR.
- One command per shell call (a `cd <workspace> &&` prefix is fine).

## Load more only on a trigger

| Trigger | Load |
|---|---|
| Draft needs `impact` medium/high, `riskSignals`, `integrations`, external operations, several repositories, or the harness reports lane `standard` | `.claude/skills/change/references/workflow.md` |
| Inspect returns discovery rows to settle or an `ASK_USER` frontier | `.claude/skills/change/references/semantic-intake.md` |
| Revision, amendment, or new observable behavior found during Build | `workflow.md`, amendment section |
| A new user request arrives during an active change | `build-policy.md` follow-up gate |
| `execution.mode` is parallel, or an action names a lease | `build-dispatch.md` |
| A structured `decision` | `decision-policy.md` |
| Prove stops at a non-automatic boundary | `.claude/skills/prove/references/workflow.md` |

Bare names are siblings of this file. Otherwise this file is sufficient; do
not preload the others.

## 1. Change

1. Read only the sources that settle the behavior: relevant code, tests, and
   existing `openspec/specs`. Reuse answers already settled in conversation;
   resolve facts yourself and ask only material product gaps.
2. Print the shape with `claude-foundation change start --template` and save
   draft v4 at `.foundation/drafts/<id>.json`. Essentials:
   - `intent`, `summary`, `why`, `impact: low`, `coupling: isolated`, `workType`.
   - `requirements[]`: semantic `key`, `capability`, `operation`
     (`added|modified|removed`; compare canonical specs first), one-sentence
     `description` with `SHALL`, `outcome`, and scenarios (`given`, `when`,
     `then`) covering the main path plus a relevant failure or boundary case.
   - `tasks[]`: `key`, `outcome`, `covers`, `paths`, and `verify`, an existing
     test command that fails when the behavior is wrong.
   - `evidence`: optional on rapid; capabilities default to `test` from the
     task `verify`.
   - `discovery.coverage`: optional for an ordinary change. Delete the
     template placeholder rows, or mark each `covered` (with `covers`) or
     `not-applicable` (with rationale). Never leave a `needs-*` row.
   - Prose in the user's requested document language, otherwise the language
     of their request; set `language` and one `capabilityOverviews` entry per
     capability. Keep keys, enums, IDs, paths, and `SHALL`/`WHEN`/`THEN`.
   - Grounding is the draft `grounding` field, only for a material decision
     that needs a hashed read. Never invent IDs or hand-write artifacts.
3. Run `claude-foundation change start .foundation/drafts/<id>.json`. It
   inspects and, when clean, starts the change in the same call.
   - `EDIT`: repair every named draft field in one batch, then rerun.
   - `ASK_USER`: ask the returned decisions (at most three) with the host
     question tool, recommendation first; put each answer into the draft as a
     requirement, scenario, non-goal, or `discovery.decisions` row; rerun.
   - `DONE`: the change exists under `openspec/changes/<id>/`.
4. Read the compiled proposal, specs, and tasks. Confirm the detail and
   language survived and every confirmed point from the conversation is
   covered; if not, repair it through a revision (see the trigger table).

## Gate: spec approval

Present the packet links, scope, behavior, and acceptance criteria in the
user's language. Wait for explicit approval; validation is not approval. Then
record it with
`claude-foundation advance <id> --approve-spec --decision-ref <user-decision>`.

## 2. Build and 3. Prove

Run `claude-foundation advance <id> --through proven`. Execute each returned
action, then its exact `resume`, until `DONE` or a real boundary:

- `EDIT`: implement the returned task in the returned workspace, inside its
  allowed `paths`, and run its focused check. Start every mutating shell
  command with `cd <workspace> &&`; prefer Edit/Write. `advance` ticks the
  task in `tasks.md` when its verify passes.
- `REPAIR`: apply the whole ordered batch, then resume.
- `RUN_EXTERNAL`: run the named operation; long commands go through
  `claude-foundation exec`.
- `WAIT`: report the owner and condition; resume when it clears.
- `ASK_USER`: ask only for the decision, record it, resume.
- `DONE` at `proven`: Prove succeeded.

`advance` itself initializes or upgrades evidence, syncs the sandbox, and runs
agent-runnable reviewers; run none of those primitives unless a returned
action names one. Do not rerun unchanged checks. Never fabricate evidence or
invent a checker. Stay in-session while a review runs: ending the reply kills
it.

If Build reveals new observable behavior, or work needs an unauthorized
infrastructure or external operation, author one semantic amendment (see the
trigger table) instead of editing the packet; never ask for credentials.

## Gate: review timeout or no progress

Review shares one 30-minute window that extends once automatically. At the
next expiry, or after repeated no-progress, report completed findings, what
was tried, and unreviewed scope. Let the user choose another window, Land with
explicit risk acceptance, or pause; record the answer through the Prove
workflow reference.

## 4. Land (explicit authority only)

Any explicit user instruction to land grants Land: `/land`, or "land it
when proven" in the request. Then run
`claude-foundation advance <id> --through archived`; it applies the proven
diff uncommitted and archives. Otherwise stop at `proven`, which is not
delivery.

## Status and resume

`claude-foundation changes` lists active changes and their next action. After
a restart, rerun `advance <id> --through proven`; it skips completed Build
work and reuses fresh evidence.
