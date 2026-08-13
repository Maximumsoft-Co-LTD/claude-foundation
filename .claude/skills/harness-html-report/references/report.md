# Harness HTML report — procedure

## Scope

Default to the active change (`.foundation/runtime/` state; ask which change
when several exist under `openspec/changes/`). "Latest change" with no active
one = newest `proof.json` `createdAt` under `.foundation/receipts/`; its packet
is usually archived at `openspec/changes/archive/<date>-<id>/`. A repo-wide
report covers every change that has receipts.

## Data sources (read-only)

| Section | Source |
|---|---|
| Change intent, tasks ledger | `openspec/changes/<id>/proposal.md`, `tasks.md`, `design.md` |
| Gate outcomes | `.foundation/receipts/<id>/*.json` — always `discovery`, `test`, `proof`, `review`; profiles may add more (e.g. `compatibility`, `mutation`) |
| Evidence runs | `.foundation/evidence/<id>/` (collect/proof run directories) |
| Review attempts | `.foundation/receipts/<id>/review-attempts/` |
| Profile and budget | `openspec/config.yaml`, `foundation.json` |
| Attestations | `.foundation/attestations/` |

Missing files are normal (change not yet proven or landed): render the section
as "not yet run", never invent a status.

## Metrics sources (read-only)

Per-change telemetry lives in `.foundation/logs/<id>/`:

| Metric | Source |
|---|---|
| Walltime + duration per phase/operation | `operations.jsonl` — `phase`, `startedAt`, `finishedAt`, `durationMs`, `exitCode` |
| Tokens and cost per request/model | `events.jsonl` — `modelId`, input/output/cache tokens; group by `operationId` for per-phase totals; aggregates in `operations.jsonl` (`requests`, `cost`) |
| Phase transitions, model tier, context mode | `phase-context.jsonl` |
| Human wait time | `user-transitions.jsonl` |
| Command duration per evidence run | receipt `observed` field (e.g. `exit 0; 19425ms`) |
| Quality / defects | `review.json` verdicts and findings, `review-attempts/` retry count, failed test claims |

Token/cost fields in `operations.jsonl` are `null` when host telemetry is
unavailable — report the `measurement` note verbatim, never a bare made-up
number. When `events.jsonl` still has per-request tokens, a cost estimate is
allowed only if every derived figure is marked "ประมาณการ" and the assumed
per-MTok rates are stated inline next to it.

Quality and improvement signals are derived, not stored: slowest phases,
repeated proof runs, blocked operations (`status == "blocked"` counts per
phase), review retries, waivers, and failed claims become an "improvement
candidates" list with each item citing its source row.

## Report structure

Write all report prose in Thai. Keep identifiers, file paths, and receipt
verdicts verbatim in their original language, with a Thai explanation beside
any quoted verdict.

1. Header: change id, assurance profile, date, overall verdict (all gates
   green / pending / failed).
2. KPI scorecard, directly under the header — one card per dimension, each
   named explicitly (Thai + English keyword): Quality (gates/claims passed),
   Bug (found/fixed/open), Time (loop walltime), Speed (busy time, fastest
   suite), Token (output + cache totals), Cost (real or labeled estimate),
   Improve (count of derived proposals), Well (overall health verdict with
   its evidence). Never bury these inside prose tables only.
3. Per-phase table: one row per phase — walltime span, busy time, requests,
   output/cache tokens, cost — plus a totals row. Say explicitly that span
   includes human wait while busy is harness command time only.
4. Gate table: every receipt provider with status, the `observed` value
   quoted, claim counts, and command duration.
5. Tasks: done/total from `tasks.md`, listing unfinished items.
6. Bugs: review findings and failed claims — found/fixed/open, each with its
   downstream effect (e.g. a re-proof forced by the fix).
7. Risks and waivers: anything a receipt flags, attestations, review waivers.
8. Improvement candidates: derived list per the metrics section.

Every claim must trace to a file listed above. Quote verdicts from receipts
verbatim; never summarize a failure into a pass.

## Render and publish

- If the host provides an Artifact tool: load the host `artifact-design`
  skill first, then write the HTML file and publish. Keep the favicon and
  file path stable across re-publishes of the same change's report.
- Otherwise: write the HTML to `docs/reports/harness-report-<id>.html` and
  tell the user the path.

HTML constraints either way: fully self-contained (inline CSS, no external
requests), theme-aware light/dark, wide tables scroll in their own container,
under 16 MB.
