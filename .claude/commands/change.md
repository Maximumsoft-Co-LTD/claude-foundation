---
description: Create or complete an OpenSpec change and evidence contract.
argument-hint: <intent|existing-change> [--prototype-selection <path>]
---

Create or update **$ARGUMENTS**. Shared rules: `.claude/harness/AGENT.md`.

1. Read only sources that settle the behavior: code, tests, and
   `openspec/specs`. Reuse settled answers; resolve facts yourself.
2. Run `claude-foundation change start --template` and save its
   `minimalDraft` (no `version`) at `.foundation/drafts/<id>.json`: `intent`,
   `requirements[{description with SHALL, scenarios[{when, then}]}]`, and
   `tasks[{outcome, verify, paths}]`; `verify` is an existing test command
   that fails when the behavior is wrong. The compiler infers the rest. Write prose in the requested document
   language, otherwise the request's language.
3. Run `claude-foundation change start .foundation/drafts/<id>.json`:
   - `EDIT`: fix every named field in one batch, rerun.
   - `ASK_USER`: ask, record each answer in the draft, rerun.
   - `DONE`: packet files and tasks are printed; do not reopen them.

Read `.claude/skills/change/references/workflow.md` completely only for a
draft declaring `impact` medium/high, `riskSignals`, `integrations`, external
operations, or several repositories; lane `standard`; or a revision or
amendment (a keyword like billing only adds review). It owns the
agreement-detail and document-language rules. Read its sibling
`semantic-intake.md` for discovery rows or an `ASK_USER` frontier.

Edit an existing change, never abandon it: before Build use `change revise`;
after, one semantic amendment. Do not implement product code during Change.

## Gate: spec approval

Unless the request approved the spec, present packet links, scope, behavior,
and acceptance criteria; validation is not approval. Record it with
`claude-foundation advance <id> --approve-spec --decision-ref <ref>`. Change
stops here.

Report outcome, decisions, and next action in the user's language.
