# Follow-ups

Items surfaced by past `retro` runs that didn't fit in their original scope. `retro` appends. `pm` reads on every new interview and asks the user whether any open item is now in scope. When a run consumes a follow-up, `retro` marks its status `consumed-by: <run-id>` and leaves the row in place for auditability.

## Open

<!-- First retro appends here. Use F0001 as the first ID. -->

| ID | From run | Item | Type hint | Priority | Status |
|----|----------|------|-----------|----------|--------|
| F0001 | 0002-feat-fanout-team-research | Pre-create stub `team-*.md` at install-time OR document "session restart required after first install" prominently — first-run UX today is the inline-fallback, not real parallel dispatch. | chore | high | open |
| F0002 | 0002-feat-fanout-team-research | Single source of truth for the `FANOUT_REQUESTED:` allowlist regex — currently duplicated in `SKILL.md:150` and `.claude/orchestrator.md:100`. | refactor | med | open |
| F0003 | 0002-feat-fanout-team-research | Roster of 6 team-agent names duplicated across 5 places (`SKILL.md:16-21`, `TEAM.md:17-22`, `lead.md:77`, `review.md` template, `WORKFLOW.md:88`). Refactor to single canonical roster + references. | refactor | med | open |
| F0004 | 0002-feat-fanout-team-research | `implement:<phase-list>` fanout shape races `state.json` Case 3 guard. Drop the shape, relax guard, or namespace `state.json` per-phase. | refactor | high | open |
| F0005 | 0002-feat-fanout-team-research | `1a.` step numbering at `lead.md:77/110/52`, `qa.md:32`, `engineer.md:27` breaks the flat 1..N pattern. Renumber or move to bulleted sub-steps. | chore | low | open |
| F0006 | 0002-feat-fanout-team-research | `model:` YAML field inconsistent across the 6 team forks (2 `opus`, 4 `inherit`). Pick one. | chore | low | open |
| F0007 | 0002-feat-fanout-team-research | `When to invoke` section present in 4/6 team forks. Either all or none. | chore | low | open |
| F0008 | 0002-feat-fanout-team-research | Plan step 3 verify-clause `grep -E "too.broad\|no constraint\|vague output"` is case-sensitive; substance starts with capitals. False-fail risk. | fix | low | open |
| F0009 | 0002-feat-fanout-team-research | Candidate AC11 (signal validator as a runnable hook) and AC12 (registry-refresh discipline as a preflight) for a follow-up `/dev` run. | feat | med | open |
| F0010 | 0002-feat-fanout-team-research | `WORKFLOW.md:148` agent-map row understates the return path (says "to the calling /dev sub-agent for synthesis"; real path is sub-agent → orchestrator → re-spawn). | docs | low | open |
| F0011 | 0002-feat-fanout-team-research | `SKILL.md:53-65` has both code block and bullet list explaining the same 5 shapes — pick one. | chore | low | open |
| F0012 | 0002-feat-fanout-team-research | `TEAM.md:22-23` 7th bullet (`team-dispatching-skill-source`) conflates pattern-source with agent-fork under the `^- team-` shape. Sub-section the pattern source. | docs | low | open |
| F0013 | 0002-feat-fanout-team-research | Plan step 19's verify-clause still cites `smoke-review.md`; AC10 evidence correctly cites `review.md`. Spec-vs-plan coherence drift. | fix | low | open |
| F0014 | 0002-feat-fanout-team-research | Add `.workflow/*/.last_worker_return` (engineer's ship-note marker file) to `.gitignore`. | chore | low | open |
| F0015 | 0002-feat-fanout-team-research | Trigger-heuristic syntax drifts across the 5 fanout callsites (`≥ 2 independent`, `≥ 2 distinct`, `≥ 2 of {…}`). Normalize phrasing. | chore | low | open |

## Closed

Items consumed by a later run. Keep these — they're the audit trail.

<!-- `retro` moves rows here when a later run consumes the item, or when the user marks `wont-do`. -->

| ID | From run | Item | Consumed by | Date consumed |
|----|----------|------|-------------|---------------|

## Conventions

- **ID** — `F` + 4-digit counter, monotonically increasing across all retros. `retro` reads this file to pick the next number.
- **From run** — the `NNNN-type-slug` of the run that surfaced the item.
- **Type hint** — what *kind* of `/dev` run would consume this. Not binding; `pm` can override after interview.
- **Priority** — `low | med | high`. `high` is reserved for known-broken behaviour or security carry-over from `security.md`.
- **Status** — `open | in-progress | consumed-by:<run-id> | wont-do (reason)`.
- Move rows from `Open` to `Closed` when status becomes `consumed-by:…` or `wont-do`.
