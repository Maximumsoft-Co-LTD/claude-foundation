# Orchestrator reference — M/L design chain

> Loaded on demand by the main agent (`.claude/orchestrator.md`, op 3 Design). Holds the
> two Design sub-steps an **XS/S run never executes**: the brownfield-M/L shared
> understand map and the proof-gated L split chain. Read only for M/L.

## a. Context (brownfield M/L — shared understand map)

`field=brownfield` AND `size∈{M,L}` → build `.workflow/<id>/context.md` once. Seed from
`.workflow/CONTEXT.md`, then let main do a bounded walk over named integration points.
If that resolves entry→flow→callers/blast-radius→invariants, UI surface and test infra,
write the map inline. Spawn `team-codebase-explorer` only for unknown entrypoints across
multiple surfaces or another material context gap; dispatch only the uncovered points.
Set `context_built=true` and record `exec_mode.context` + `exec_reason.context`.

**Replaces** the per-slice plan-prep / UI-surface / baseline re-walks — sub-steps b/c pass
`context.md` to `lead`/`qa`. **Shared evidence, not authority**: a wrong fact hits all three
slices, so each spot-checks load-bearing claims and owns its final map; it never gates
correctness (Phase-2 review/test/baseline still backstop).

Skip (greenfield / XS / S) → no `context.md`; the slices walk instead — but every run at
every size **reads `.workflow/CONTEXT.md` (repo ledger) before walking** and covers only
the remainder (`orchestrator.md > Size-aware execution`). Both maps are pure optimisation,
never a hard dependency.

## c. L — split chain (proof-gated)

Default to one combined Design executor. Split only when requirement definition,
architecture and test contract are independent substantial investigations. Record the
proof for every worker; `size=L` is not one.

*Spec:* spawn `pm` with run id, type, the resolved artifact shape (required blocks for this
Type — `size-tiering.md > Artifact shape by Type`), intent, digest+catch-all, full Q&A,
references (URLs inlined), in-scope FOLLOWUPS IDs, spec-prep findings + `Dispatched-as:`
map; it returns path + 3-bullet summary (`pm` direct-nests any
`team-best-practice-researcher` research itself — no signal to dispatch).

*Plan:* **plan-prep fanout first** — **skip when `context_built` (pass its path to `lead`);
else** `repo_root` set AND `spec.md` names ≥2 integration points in **disjoint surfaces** →
one `team-codebase-explorer` per point in one message
(entry→flow→callers/blast-radius→invariants, each `path#anchor`); skip pure-greenfield /
single point. Spawn `lead` plan mode (+ `context.md` when built, else explorer findings +
`Dispatched-as:` map), pass `Type` — **opus** (L-tier: cross-subsystem, schema migration,
public API/contract/breaking).

*Test plan* (feat/fix/refactor only; else append `test-plan` to `skipped_steps`): spawn `qa`
test-plan mode (pass `e2e_visual` + `context.md` when `context_built` — `qa` reads its
`## Test infra` + invariants for Baseline instead of re-reading touched code; off → map
journeys to integration, omit visual/e2e), writes `test-plan.md` (design only).

## Field upgrade backfill (M/L specifics)

`FIELD_UPGRADE: brownfield — <reason>` mid-run → run remaining brownfield and **backfill**
understand/lock inline when the changed scope is already known. Spawn `lead` or `qa` only
when the upgrade itself exposes a material context gap or independent test-contract issue.
