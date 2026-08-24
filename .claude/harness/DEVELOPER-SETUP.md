# Developer setup

Foundation v3.4.4 front-loads material decisions so Build and Prove can run to a
bounded conclusion without repeatedly interviewing the developer. The shipped
workflow adds:

- one `/feature` entry point for discovery, one Decision Sheet, Change, Build,
  review, and Prove; Land remains an explicit delivery action;
- grounding of production entry points, activation hazards, failure semantics,
  real wire behavior, observability, and test topology before Build;
- strictest-wins low/medium/high review routing with at most two delivered AI
  review waves: one full packet and one finding-bound delta;
- deterministic repair closure after the second AI review instead of a third AI
  loop or a mandatory human approval;
- resumable `proof advance`, which reruns only stale providers and reuses
  content-bound receipts for unchanged inputs;
- Codex-only and Claude-Code-only coding/review configurations that retain a
  distinct read-only reviewer identity and fresh session; and
- durable `handoffs.yaml` packets for AWS, Terraform, secrets, cluster, and
  other external operations that the developer is not authorized to perform.

Before the first Foundation packet on a developer machine:

1. Install Node.js 20.19 or later.
2. Verify `claude-foundation version` is `3.4.4` and the repository runtime API
   is `26`. A delta between the two is advisory while both doctors still pass:
   the CLI forwards to the runtime installed in the project, so an older CLI
   prints `warning: project runtime API … differs from CLI API …` and keeps
   working. Only a doctor that exits non-zero is a blocked machine.
3. When the CLI itself is behind, upgrade it: `brew upgrade claude-foundation`.
   If instead the pinned source is absent, clone tag `v3.4.4` from
   `Maximumsoft-Co-LTD/claude-foundation` into
   `~/.local/share/claude-foundation/3.4.4`.
4. Install or refresh the runtime inside the project with
   `claude-foundation init <project-path>`. The equivalent entrypoint inside a
   source checkout is `bash /path/to/claude-foundation/install.sh
   <project-path> --yes`.
5. Add `~/.local/bin` to `PATH`, then run
   `claude-foundation doctor --stage change`.
6. Install and authenticate the reviewer CLI your project selects:
   - Codex: `npm install -g @openai/codex && codex login`
   - Claude Code: `npm install -g @anthropic-ai/claude-code && claude auth login`
7. Set the committed `foundation.json` review profile once. A Codex-only team
   uses `defaultReviewer: "codex-sol"`; a Claude-Code-only team uses
   `defaultReviewer: "claude-opus"`. Set `fallbackReviewers` to configured
   reviewer names followed optionally by `"main-session"`, and set
   `infraFailureThreshold` to bound infrastructure retries per reviewer. The
   route never runs after `fail` or `inconclusive`; `main-session` is explicit
   self-review and requires `independence: "self"`. Foundation automatically reuses complete AI
   subject provenance only when its session matches the ambient host; otherwise
   the caller supplies the `--main-session-*` provenance fields. When coding and review use the same
   provider/model family, also set `diversity: "single-model"`, but keep
   `independence: "required"` so Foundation still requires a distinct reviewer
   identity and fresh session.
8. Run `claude-foundation doctor --stage prove`. It checks the selected CLI,
   authentication and required headless/read-only flags and prints the exact
   install, login or upgrade command when the machine is not ready.

Safe single-family profiles (merge either selection into the existing
`review` object; keep the shipped `reviewers` map):

```json
{ "review": { "independence": "required", "diversity": "single-model", "defaultReviewer": "codex-sol" } }
```

```json
{ "review": { "independence": "required", "diversity": "single-model", "defaultReviewer": "claude-opus" } }
```

Do not set `independence: "self"` merely because one model family is used.
That separate waiver permits the same identity/session and is not needed for
Codex-only or Claude-Code-only operation.

Developers do not need AWS, secret-store, cluster-admin, Terraform-apply, or
production-deploy credentials merely to complete Build and Prove. `/change`
records those operations in `handoffs.yaml`; send
`claude-foundation handoff packet <change> --id <H00n>` to the named owner.
After the operator accepts or completes it, record only their name, ticket/run,
and evidence reference with `handoff record`—never copy a secret value into the
change or record.

Do not substitute another package, tag, or runtime. `.agents/skills` exposes
the canonical Foundation skills to Codex. `.codex/foundation-rules` exposes
behavioral rules. `.codex/hooks` is a readable compatibility link only; Codex
does not execute project tool-call hooks. Install the documented Git hook
explicitly if repository-side mutation guards are required.

## Daily use

Use `/feature <PRD or backlog group>` for normal product delivery. It reads the
requirement, architecture, production path, and test topology before presenting
all material questions in one Decision Sheet. Once confirmed, the agent runs
Change → Build → Review → Prove without reopening locked choices.

Existing changes can use `/change`, `/build`, `/prove`, and `/land` separately.
A deterministic failure resumes at the affected provider. First-review findings
receive one delta review; after two delivered AI waves Foundation uses current
test, mutation, integration, and static evidence to close verified repairs. It
asks again only for a real contract contradiction or new material risk, not for
warnings or optional improvements.

When an operation needs authority the developer does not have, send the
generated handoff packet to its named owner. Record only the operator name,
ticket or run, and evidence reference after completion. Never put AWS keys,
passwords, tokens, or other secret values in the change, receipt, or chat.
