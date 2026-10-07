---
description: Create or complete an OpenSpec change and evidence contract.
argument-hint: <intent|existing-change> [--prototype-selection <path>]
---

Create or update **$ARGUMENTS**. Shared rules: `.claude/harness/AGENT.md`.

1. Read only behavior-settling sources (code, tests, `openspec/specs`); reuse
   settled answers, resolve facts yourself.
2. Run `claude-foundation change start --template`; save its `minimalDraft`
   (no `version`, no heredoc) at `.foundation/drafts/<id>.json`: `intent`,
   `requirements[{description with SHALL, scenarios[{when, then}]}]`,
   `tasks[{outcome, verify, paths}]`; `verify` is an existing test command
   failing on wrong behavior. Compiler infers the rest. Write
   prose in the requested document language, else the request's.
3. Run `claude-foundation change start .foundation/drafts/<id>.json`:
   - `EDIT`: fix every named field in one batch, rerun.
   - `ASK_USER`: ask, record each answer in the draft, rerun.
   - `DONE`: packet files and tasks print; do not reopen them.

Read `.claude/skills/change/references/workflow.md` completely only for a
draft declaring `impact` medium/high, `riskSignals`, `integrations`, external
operations, several repositories; lane `standard`; or a revision or
amendment (a keyword like billing only adds review). It owns
agreement-detail and document-language rules. Read sibling
`semantic-intake.md` for discovery rows or an `ASK_USER` frontier.

Edit, never abandon, a change: `change revise <id> <draft>` before
Build, `change amend <id> <amendment>` after; handle each like step 3. Write
no product code during Change.

## Gate: spec approval

Unless the request approved the spec, present packet links, scope, behavior,
acceptance criteria, and open questions; validation is not approval. Record
it with `claude-foundation advance <id> --approve-spec --decision-ref <ref>`
or those flags on the start/revise/amend call applying it. Change stops
here.

Report outcome, decisions, and next action in the user's language.
