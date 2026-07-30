# Model tiers — the single policy note

Who runs on what, and why. `dev-agent-guard.sh` enforces this mechanically (Cases 4–6); `INDEX.md` mirrors the table. Change tiers HERE first, then frontmatter, then INDEX.

| Role | Tier | Why |
|---|---|---|
| Orchestrator (main agent) | session model | Judgment-heavy: interview, gate fold, size/field calls, fanout arbitration. On Opus 4.8 sessions verify effort ≥ high (`orchestrator.md` preamble). |
| `pm` | sonnet | Draft-cheap + **verify-in-main**: spec drafting from a good interview is template-filling, and the main session (opus, resident with the full interview + pre-work) runs the semantic requirement verify at the spec/plan check while plan/gate backstop downstream — so cold `pm` runs sonnet. **When pre-work is substantial** Phase 1 skips the cold spawn entirely and drafts **warm** (fork/inline at main tier — `size-execution.md > Execution mode`); `pm` cold-spawns only at **L** / thin pre-work / `/spec`. |
| `lead` | sonnet default, opus escalation | Omitted model means the Sonnet frontmatter pin. Pass Opus explicitly for Mode C Security and high-stakes planning/review involving cross-subsystem L work, destructive schema migration, or public/breaking contracts. |
| `engineer` | sonnet default, explicit opus escalation | Plans carry the judgment; execution volume normally routes code generation to one bounded Sonnet worker. **L alone is not an escalation.** Pass `model="opus"` only when implementation itself is high-stakes and reasoning-heavy: auth/crypto boundary, destructive/irreversible migration, security remediation, or unresolved public-contract invariants where a wrong write is costly. The prompt includes `model_reason:<trigger>`. |
| `qa` `retro` `uxui` | sonnet | Execution work guided by plan/test-plan artifacts; the artifacts carry the judgment. |
| `team-best-practice-researcher` `team-code-reviewer` `team-silent-failure-hunter` | sonnet | Open-ended judgment: research synthesis, whole-diff review, error-path reasoning. |
| `team-codebase-explorer` `team-pr-test-analyzer` `team-type-design-analyzer` | haiku | Narrow single-lens pattern work against an explicit output template — tier buys speed, template carries the rigor. (`team-code-simplifier`/`team-comment-analyzer` retired 2026-07-15 — folded into `team-code-reviewer` as lenses.) |
| `general-purpose` / `Explore` built-ins | floor (default sonnet) | No frontmatter pin → would inherit the main tier. Guard Case 6 requires an explicit `model=` equal to the floor; override the floor per-machine with `CLAUDE_DEV_FLOOR_MODEL`. |

Rules of thumb:

- **Opus decides; Sonnet produces.** Keep interview, risk/size calls, gate, and final acceptance in a high-tier main session. Route substantial planned implementation to bounded Sonnet; escalate the worker only when its own write requires the high-stakes reasoning above.
- **Inline-fallback upgrades are visible, not silent.** The registry inline-fallback always spawns `general-purpose` at the floor — for a haiku-pinned role that is a tier UP; the `Dispatched-as` note must say so (cost drift stays auditable).
- **Wall-clock/cost claims are generation-dated.** Re-validate "tier X ≈ tier Y at Z cost" claims when the model family changes before letting them steer a default.
- **A pin is the default; prose is not.** Whatever the playbook calls "the default", the tier a spawn actually runs at is the `model` param if one is passed and the frontmatter pin otherwise — so the pin must BE the default, with the exception passed explicitly. Getting this backwards is invisible without telemetry: `.spawn_log` column 3 (`req:` vs `pin:`) and `dev-metrics.sh > spawn_tiers` exist because a benchmark could not otherwise tell which tier it had measured.
