# Orchestrator reference — M/L design chain

> Loaded on demand by the main agent (`.claude/orchestrator.md`, op 3 Design). Holds the
> two Design sub-steps an **XS/S run never executes**: the brownfield-M/L shared
> understand map, and the L full spawn chain. **Read only when `size` ∈ {M, L}** — at M
> for Context (when brownfield), at L for both. XS/S go straight to op 3b (the combined
> `lead` spawn) and skip this file entirely.

## a. Context (brownfield M/L — shared understand map)

`field=brownfield` AND `size∈{M,L}` → build `.workflow/<id>/context.md` **once**: spawn
`team-codebase-explorer` (one, or one per disjoint integration point — from
`spec.md > Constraints > Integration points` at L; **at M the spec doesn't exist yet
(combined fast path): take the points from the requirements digest and build `context.md`
BEFORE the combined spawn** — in one message — **seed from `.workflow/CONTEXT.md`
(repo-level ledger, when it exists) + spec-prep findings (op 2) — dispatch only for points
neither covers**) mapping current state (entry→flow→callers/blast-radius→invariants, each
`path#anchor`) + UI surface (when it renders) + test infra; synthesise into
`_templates/context.md` (fanout = evidence — you write it). Set `context_built=true`.

**Replaces** the per-slice plan-prep / UI-surface / baseline re-walks — sub-steps b/c pass
`context.md` to `lead`/`qa`. **Shared evidence, not authority**: a wrong fact hits all three
slices, so each spot-checks load-bearing claims and owns its final map; it never gates
correctness (Phase-2 review/test/baseline still backstop).

Skip (greenfield / XS / S) → none; the slices cold-walk (pure optimisation, never a hard
dependency).

## c. L — full chain

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
understand/lock: re-spawn `lead` plan-revise for `plan.md > Current state` (**no
`context.md` on a mid-run upgrade** — the revise walk stands in); for
`test-plan.md > Baseline` the `qa` spawn writes it at M/L (XS/S add the row inline).
