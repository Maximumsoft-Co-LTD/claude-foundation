# Change: Maximize harness guidance and automation

## Why

The version-aware feedback round completed safely, but the implementation agent still acted as glue between Build, Review, repair, Proof, telemetry ingestion, and Land. Its largest reported "quiet" Prove interval was actually productive repair after a completed review, host-execution telemetry was measured but attributed to an unsupported source, and several recoveries still depended on interpreting prose or broad regular expressions. The harness should own every deterministic transition and measurement while leaving semantic implementation and real authority with the agent and user.

## What changes

- Normalize host-execution provenance, make blocker fallback ambiguity-safe, measure TAP totals exactly, and preserve explicit unavailable data for historical schemas.
- Make legacy-default diagnostics intent-aware and compute source-cohort digests lazily with contained failure semantics.
- Derive bounded repair work from current blocker/major review findings, persist repair intervals, and selectively invalidate evidence from the observed repair surface.
- Add one additive high-level `advance` command that returns deterministic machine actions and can converge safe local steps without invoking a model or inferring authority.
- Produce a deterministic feedback snapshot that separates implementation, reviewer, repair, external wait, and genuinely unattributed time; expose exact evidence reuse/invalidation and safe Land recovery.

## Impact

- **Impact:** high
- **Coupling:** coupled
- **Affected surfaces:** runtime telemetry, proof and review orchestration, agent dispatch, upgrade diagnostics, feedback reporting, protocol and installer ownership
- **Security triggers:** public-compatibility, privacy, execution-authority

## Non-goals

- Letting the core runtime invoke a model, edit product code, accept review findings without workspace evidence, or decide a contract amendment.
- Automatically committing, pushing, publishing, opening a pull request, waiving a gate, overwriting a conflict, or changing project-owned policy.
- Reclassifying unavailable measurements as idle, human wait, zero, or pass.
- Removing or changing existing public command names and arguments.
