# Change: cut hook startup cost, bound the audit log, and unblock authority review responses

## Why

Three defects were measured during the changeloop review
(`docs/reports/changeloop-review-2026-08-08.md`) and deferred as non-goals from
the fix that landed on 2026-08-09. Each is now the leftover cost of a loop that
otherwise works.

- **Every mutating tool call pays for a Node start.** `phase-mutation-guard.mjs`
  is wired as a `PreToolUse` hook on `Edit|Write|MultiEdit|NotebookEdit|Bash`.
  Measured on this repository: bare `node -e ''` is 44ms, the guard is 53ms, and
  `sh -c ':'` is 3ms. So 44 of those 53ms are interpreter startup and only ~9ms
  is the guard's own work — and on a stock install with no active change the
  guard's own answer is "nothing to enforce, exit 0". That is ~50ms burned per
  call, roughly 30s across a 500-call session, to reach a decision a shell test
  can make.
- **`.foundation/logs/guardrail-audit.jsonl` has no bound.** It reached 2,495
  rows / 422KB here, and nothing in the runtime ever prunes it. The row that
  produced that volume is already fixed, but an append-only audit file with no
  rotation is still a file that grows without limit in every consumer project.
- **`authority record` cannot record a review.** Its flag schema accepts only
  `--request` and `--response`, but the receipt path it calls requires subject
  provenance and fails with `review requires at least one --subject-actor` — a
  flag the command rejects. `validateResponse` already copies `response.evidence`
  verbatim into those flags, so the response file *can* carry provenance; the
  emitted template simply never shows the fields, so an operator following the
  template hits a dead end with no supported way out. Recording this change's own
  predecessor required falling back to `evidence record`.

## What changes

- A shell prefilter answers the common "no phase to guard" case without starting
  Node, and delegates to the existing guard whenever anything might need
  enforcing. Block mode always delegates, so enforcement still fails closed.
- The installer retires the previously wired `phase-mutation-guard.mjs` command
  when it wires the prefilter, so an upgraded project runs one guard, not two.
- `recordAudit` rotates `guardrail-audit.jsonl` at a size cap, keeping one
  previous generation.
- The review response template carries reviewer type and subject provenance, and
  the receipt error names the response file when the request came through the
  authority bridge.

## Impact

- **Impact:** medium
- **Coupling:** coupled
- **Affected surfaces:** shipped hook (`phase-mutation-guard`), shipped hook
  wiring in `.claude/settings.json`, installer hook merge, authority response
  template and receipt diagnostics
- **Security triggers:** the phase guard is a mutation boundary. The prefilter
  may only skip work the guard itself would have skipped: `block` mode always
  delegates, and any recorded phase context delegates. Widening that skip is the
  risk this change carries, and the evidence below pins it.

## Non-goals

- Changing what the guard enforces once a phase is active.
- Turning on `block` mode by default; rollout stays audit-only.
- Rotating any log other than the guardrail audit file.
