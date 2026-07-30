# Orchestrator reference — Size-aware execution matrix

Canonical definition of **how much machinery each phase gets** (type decides *which* phases run; size decides *how much*). `orchestrator.md` (mechanics: `> Size-aware execution`) and `WORKFLOW.md` point here. Size *picker* + greenfield/brownfield *def*: `plan-writing > references/size-tiering.md`.

## Workload profile resolver

Classify the deepest meaningful surface; do not use Size as a proxy for all six axes.

| Axis | Values | Owns |
|---|---|---|
| `work_profile` | `hermetic-logic`, `greenfield-product`, `visual-surface`, `brownfield-fix`, `compatibility`, `security-product`, `coupled-system` | profile defaults |
| `risk` | `low`, `operational`, `contract`, `security` | Review/Security depth |
| `ambiguity` | `low`, `medium`, `high` | Interview depth |
| `evidence[]` | `structural`, `behavioral`, `rendered`, `integration`, `measured`, `security`, `manual` | Test mechanism |
| `volume` | `small`, `medium`, `large` | Implement executor |
| `coupling` | `isolated`, `single-system`, `cross-system` | context/fanout/split |

Defaults: a pure new helper is `hermetic-logic`; an isolated CRUD/UI app is
`greenfield-product`; a primarily visual page is `visual-surface`; every fix is
`brownfield-fix`; caller/API preservation is `compatibility`; auth/session/identity
is `security-product`; coupled layers/contracts are `coupled-system`. A worker may
raise an axis with first-line `PROFILE_UPGRADE:`, `RISK_UPGRADE:`, `SIZE_UPGRADE:`,
or `FIELD_UPGRADE:`; axes never silently shrink mid-run.

Initial Opus-main turn budgets (targets / hard ceilings): hermetic `30/45`,
greenfield product `60/80`, visual `50/70`, brownfield fix `70/100`,
compatibility `100/140`, security `120/170`, coupled system `150/200`.
These are liveness guards, not quality budgets; a high/security finding never
downgrades to fit one.

## Size-aware execution matrix

The orchestrator estimates size (XS/S/M/L — picker in `plan-writing > references/size-tiering.md`) right after the requirements digest and records it in `state.json`; for borderline or operationally risky work the same reference has a scorecard fallback (layers, data, cache, deploy, observability, security, test scope) that calibrates without replacing the hard picker overrides. The plan's `Size` field is a different knob: it governs plan *section gating* and `lead` sets it from the code walk (smaller than the estimate is fine), while `state.json > size` governs *machinery* and only moves up — a larger plan `Size` is a `SIZE_UPGRADE` signal, a smaller one never shrinks the machinery mid-run.

| Step | XS | S | M | L |
|------|----|---|---|---|
| Setup + interview questions | one merged batch (≤4 questions) | one merged batch | setup batch + interview batch (+ bounded dig loop) | same as M |
| Spec + plan | **inline — main writes it**, no spawn, no prep fanout; **single `run.md` artifact** | **inline — main writes the four artifacts** | resolver: inline/fork when interview + code map are warm; otherwise one combined `lead` | same resolver; `pm → lead` only when requirement and design slices need independent owners |
| Test plan (feat/fix/refactor) | folded inline | folded inline | folded into current Design executor | folded by current Design executor; separate `qa` only for a genuinely independent test-contract slice |
| Contract Gate (deterministic + human intent approval) | full | full | full | full |
| Implement | inline (bounded micro-change) | inline below the volume threshold; otherwise one bounded Sonnet `engineer` | one Sonnet `engineer` when execution volume fires; genuinely small warm work may stay inline | same resolver; L alone proves neither a spawn nor an Opus upgrade; fanout only for independent disjoint writes |
| Test | inline for known commands; browser/new harness → `qa` | same as XS | inline for known runner + no browser/new harness; otherwise `qa` | same resolver; category fanout only when it repays coordination |
| Review | **inline in main**, fanout refused (skipped for `chore`/`docs` at XS) | **inline in main**; independent when Sonnet implemented | runtime behaviour or Sonnet implementation → one independent `lead`; mechanical/docs-only → inline | runtime behaviour/Sonnet/security → one independent `lead`; fanout only for multiple substantial independent lenses |
| Security review | trigger-based — check runs before Review; fired → folded into the review spawn | same | same | same |
| Docs + ship | inline (README/JSDoc touch + deterministic git commands); anything larger spawns `engineer` | one merged `engineer` spawn (S exception) | inline for touch-up + deterministic ship; substantial docs only → `engineer` | same resolver; never two spawns merely because size=L |
| Retro | inline | inline | inline, light pass | inline; `retro` only for multi-repo synthesis or explicit deep retrospective |

**Never shrinks at any size:** interview+spec · plan · Contract Gate · implement, plus code-type Test + Ship Gate, fired independent Review/Security, state discipline, and the security trigger scan. Optional phases are defined in `WORKFLOW.md > Required vs optional`. Size sets the spawn ceiling and risk hint; the resolver decides machinery per phase.

**Speed profile (spawn ceiling).** Size picks the ceiling, never the phase executor: XS/S=`fast` (0/≤2), M=`standard` (≤3), L=`deep` (≤5). S reserves at most one spawn for volume-routed Sonnet Implement and one for its measured Docs+Ship exception. A ceiling overrun requires a recorded proof. Canonical mechanics: `.claude/orchestrator.md > Speed profiles`.

**Effort by size (main session dial).** xhigh → **L or any security-triggered run**; high → **M**, and whenever main is the requirement-verifier (`model-tiers.md`); medium → **XS/S**. xhigh's deep deliberation is wasted on a small/shallow change (think:output ≫ 10:1); the quality gates never depend on the dial. `orchestrator.md` preamble points here.

## Execution mode (inline / fork / cold-spawn)

Resolve **per phase**, after its inputs are known. Default `inline`; size never proves a spawn.

| Spawn proof | Use | Typical examples |
|---|---|---|
| none; main holds authoritative inputs and code map | `inline` | M design after interview+context, sequential implement, known tests, docs/ship, retro |
| warm Phase-1 context but drafting needs scratch isolation | `fork` | long POC/spec discussion; Phase 1 only |
| independent judgment | `cold-spawn` | runtime-behaviour Review at M/L, Security |
| material context gap | `cold-spawn` | unknown entrypoints across several surfaces; main would repeat a substantial walk |
| tooling isolation | `cold-spawn` | browser/e2e, new test harness, multi-repo coordinator |
| proven parallel payoff | `cold-spawn`/fanout | independent investigations and disjoint writes substantial enough to repay startup |
| execution volume | one bounded Sonnet `engineer` | ≥3 code tasks/files, planned test-fix loop, or >~2K expected generated tokens; avoids repeated Opus coding turns |

Deterministic shell work is never a spawn proof. Record `exec_mode.<phase>` and `exec_reason.<phase>`; examples: `inline/warm-working-set`, `spawn/model-economy:3-tasks`, `spawn/independent-review`. Execution volume applies only to generative Implement work, not Design/Test/Docs/Ship. If no proof can be named, use inline.

**Profile routing supplements, never replaces, the resolver.** `rendered` evidence
requires a cheap real-browser rendered smoke even when full E2E is off. `security`
evidence fires an isolated security judgment. `compatibility` preserves an
independent author boundary. `greenfield-product` may use one bounded Sonnet
Implement worker, but its main must not rediscover or rewrite phase-local tests.
`coupled-system` prefers independently shippable slices when contracts, tests, and
rollback boundaries split cleanly; raw file count is not a split proof.

**Patch lane (XS subtype)** — the "tiny but still worth tracking" case: one file per touched surface, no runtime behaviour surface, no persisted data / API / schema / dependency / security-sensitive path, no executable test surface, no cross-repo coupling. The run `Type` stays `chore`/`docs` (or another type only when `lead` proves no executable behaviour changes); `size` stays `XS`, and the contract still has a digest, one merged confirmation batch, gate, state writes, and security-trigger check. A **wide-but-shallow multi-repo sweep** — the same trivial independent edit across N repos, one file per repo, no shared contract — stays patch-lane, sized by the deepest single repo surface; repo count alone doesn't make it M/L. What shrinks is the machinery: combined `lead` writes compact artifacts, the Test and Review phases default to skipped (a gate-flipped `run <review>` on a patch-lane run is executed inline by the orchestrator — `_templates/review.md` checklist, no `lead` spawn), the skipped-test stub is inline, docs+ship are merged, retro is inline. A worker that discovers executable behaviour, a contract change, multiple files in one repo, cross-repo coupling, or integration risk returns `SIZE_UPGRADE: S` and the run leaves the patch lane.

**Fanout availability.** Default single-pass. Fanout requires independent scopes, disjoint writes, and proven parallel payoff; size only caps it. Gate steering, registry fallback, implement phases, review lenses, security buckets, and the multi-repo surface axis are canonical in `references/fanout-dispatch.md`; do not load that reference until one of those triggers fires.

**Multi-repo boundary.** Implement/Gate/Ship remain pinned to primary `repo_root`; Test/Review/Security may read and judge other repos. Blocking non-primary findings surface to the user. Repo count alone neither raises size nor proves fanout.
