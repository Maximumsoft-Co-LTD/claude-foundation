# Design

## Current state

- `.claude/hooks/phase-state.mjs` `recordedPhaseContext` walks every directory
  under `.foundation/logs`, parses the last line of each `phase-context.jsonl`,
  and returns the row with the newest timestamp inside the 12-hour freshness
  window. Nothing checks whether that change still exists.
- `.claude/hooks/phase-mutation-guard.mjs` turns that row into the enforced
  phase, resolves the workspace from `.foundation/runtime/<changeId>.json`, and
  blocks in `auto` mode as soon as any phase is established.
- `.claude/hooks/phase-guard-policy.mjs` `shellMutationViolation` refuses every
  mutating shell command during Land unless `FOUNDATION_LAND_TRANSACTION=1`.
- `.claude/harness/runtime/workflow/apply-runtime.mjs` `executeApplyJournal` is
  the only writer of that marker: it sets `process.env` for the duration of the
  apply transaction and restores the prior value in `finally`.
- `.claude/harness/runtime/observability/exec-runtime.mjs` `exec` is a timing
  wrapper. It sets no environment, and the guard inspects the outer `Bash`
  command before `exec` ever spawns, so routing a commit through it changes
  nothing.

## Domain language

| Canonical term | Meaning | Avoid |
|---|---|---|
| active change | a change with an `openspec/changes/<id>` directory | current change |
| orphaned phase row | a fresh phase-context row whose change is not active | stale row |
| delivery command | `git commit` or `git push`, which publish an applied projection without changing tracked content | safe git |
| transaction marker | `FOUNDATION_LAND_TRANSACTION=1`, process-local to the apply transaction | land authority |

## Decisions

- **Decision ID:** DEC-001
  - **Status:** accepted
  - **Decision:** A recorded phase row governs only when `openspec/changes/<id>` exists for its change.
  - **Why:** It is the same fact `changes` already uses to report `missing-active-change`, needs no runtime-state parse, and stays correct for archived, abandoned, deleted, and fixture changes alike.
  - **Rejected:** Filtering on `.foundation/runtime/<id>.json` status, which cannot separate the orphaned fixture that caused this defect because its status is the live-looking `building`; and shortening the freshness window, which only narrows the blast radius while breaking long legitimate phases.
  - **Consequences:** A change whose OpenSpec directory is removed mid-phase stops being enforced, matching the `missing-active-change` signal the harness already reports; explicit `block` mode still refuses when no phase remains.
  - **Supersedes:** none
  - **Superseded by:** none

- **Decision ID:** DEC-002
  - **Status:** accepted
  - **Decision:** Land refuses per operation, permitting only the command words `git commit` and `git push` without the transaction marker.
  - **Why:** The marker exists to stop an agent editing the checkout while the runtime projects a proven sandbox into it, and neither command changes tracked content; the Land contract requires the agent to run them under separate user authority.
  - **Rejected:** Letting `claude-foundation exec` carry the marker to its child, which would make any command whatsoever permissible because the guard inspects only the outer command; and adding a `land commit` runtime command, which creates a public CLI contract for a step Git and the host permission prompt already own.
  - **Consequences:** `git push --force` also passes the guard during Land, leaving force-push safety with `git-workflow` and the host permission prompt where it already lived.
  - **Supersedes:** none
  - **Superseded by:** none

## Compatibility and migration

`FOUNDATION_LAND_TRANSACTION` keeps its meaning and its single writer. No
protocol, command, or installer surface changes; `protocol.json` is untouched.
The refusal string for a non-delivery Land mutation gains a `refused: …`
suffix, so tests asserting the old message match on its stable prefix.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| The word screen misreads a tree mutation as delivery | The allowlist is two exact command words; anything unmatched or opaque such as `sh -c` or a redirect stays refused and is named | test |
| An active change's phase stops being enforced after its directory is removed | The presence check mirrors the harness's own `missing-active-change` signal, and explicit `block` mode still fails closed | test |
| The eligibility scan costs more per tool call | One existence check per candidate directory, evaluated only for rows already inside the freshness window | test |
