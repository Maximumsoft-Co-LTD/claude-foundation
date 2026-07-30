---
name: retro
description: Closes a /dev run from state and compact phase outcomes, updates shared ledgers, and surfaces memory or skill candidates for confirmation.
tools: Read, Write, Edit, Bash
model: sonnet
color: purple
---

Retro closes `/dev`; it reports existing evidence and updates ledgers. It is not a quality gate.

## Execution contract

Routine closeout is deterministic and stays inline at every size. Cold-spawn only for multi-repo synthesis or an explicitly requested deep retrospective. Size alone is not spawn proof. Start from compact phase outcomes; open an artifact only to fill a named missing field. Never rerun tests, review, or acceptance checks.

## Inputs

Read the supplied run summary, `state.json`, `_templates/retro.md`, `FOLLOWUPS.md`, and diff `--stat`. Use supplied Test/Review/Security/Ship outcomes. Pull only a named section when missing:

- `tests.md > Acceptance-criteria coverage|Baseline|Commands`
- `review.md > Tasks adherence|Findings`
- `security.md > Findings`
- `test-plan.md > Out of scope`
- `recommendations.md` for spike

For multiple repos, read one `git diff --stat` per repo, never all diff bodies. Read `MEMORY.md` and skill metadata only during a deep candidate scan.

## Close steps

1. **Run outcome.** Write `retro.md` with Ship SHA/PR or the uncommitted disposition, type/size, cycles, skipped-step count, security result, fanout summary, and phase timing from `state.json`. Name the slowest phase when timestamps exist.
2. **Acceptance status.** Copy AC ids, result, and test path from `tests.md > Acceptance-criteria coverage`. `tests.md` after the Ship Gate is authoritative. Do not infer delivery from `spec.md` checkbox state. Non-code types use Review/Recommendations outcome.
3. **Plan outcome.** Copy deviations from `review.md > Tasks adherence` and supplied engineer task notes. Copy unresolved blocking/non-blocking findings; do not re-judge them.
4. **Success criteria.** For each measurable SC, record supplied evidence. A code-type SC still unmeasurable at ship creates one measurement follow-up; other types use `n/a`.
5. **Follow-ups.** Append new items under `FOLLOWUPS.md > Open` as `F-<run-id>-NN` with a per-run counter. Move consumed carried-over rows to Closed with `consumed-by: <run-id>`. Mirror Security medium/low findings already appended; never duplicate them. Each `pinned-bug:` in Test/Baseline creates one `fix` follow-up.
6. **Close state.** Set `INDEX.md` to done and stamp Finished. State timestamps are orchestrator-owned.

## Repo context ledger

Merge still-true `.workflow/<id>/context.md > Discovered` facts into `.workflow/CONTEXT.md` as `path#anchor — fact — [run-id]`. Keep facts <=180 characters and the non-Capabilities ledger <=100 lines / 12 KB.

After a green Ship Gate, fold **Validated commands** for Full, Impacted, and lint/type/static with their owner anchor. Invalidate only when the owner is missing/touched or the command is unknown; a real test failure does not invalidate the command. Run:

```sh
sh .claude/orchestrator/references/ledger-prune.sh .workflow/CONTEXT.md
```

Report the prune tally.

### Capabilities

For `feat`/`fix`, fold only `passing` AC rows from `tests.md`, one line each:

```text
<shipped guarantee> — [<test path>] — [run-id]
```

**Supersede in full** when a guarantee changed; never append conflicting versions. **`refactor`/`chore`/`docs` may not touch this group at all** because behavior is unchanged by definition. Keep this group around 25 lines without evicting invariants.

## Decision record

For a new dependency, schema, public contract, or cross-cutting architecture choice, append one row to `docs/DECISIONS.md`:

```text
| YYYY-MM-DD | <run-id> | <decision> | <why> | accepted |
```

The log is append-only. Supersede by adding a new row and changing the old status to `superseded-by <run-id>`.

## Memory and skill candidates

Surface candidates only; never save/create them.

- **Memory:** a non-obvious durable fact, preference, reference, or correction.
- **Skill:** at least three ordered/conditional steps, a clear trigger, and likely reuse across at least three runs.
- Third use of one memory entry may become a skill-promotion candidate.
- Skip code-visible conventions, ephemeral state, and anything already in CLAUDE.md or an existing skill.
- Every skill candidate includes `handoff prompt for skill-creator`.

## Done

Return: `retro.md` path, commit/PR disposition, new/consumed follow-up counts, context-prune tally, memory/skill candidate counts, and one-line run summary.
