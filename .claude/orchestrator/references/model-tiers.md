# Model tiers — the single policy note

Who runs on what, and why. `dev-agent-guard.sh` enforces this mechanically (Cases 4–6); `INDEX.md` mirrors the table. Change tiers HERE first, then frontmatter, then INDEX.

| Role | Tier | Why |
|---|---|---|
| Orchestrator (main agent) | session model | Judgment-heavy: interview, gate fold, size/field calls, fanout arbitration. On Opus 4.8 sessions verify effort ≥ high (`orchestrator.md` preamble). |
| `pm` | opus | Spec quality over spec cost — every later phase anchors on `spec.md` (promoted 2.6.5). |
| `lead` | sonnet default, opus escalation | The one worker allowed to vary (guard Case 4 exempts it). Escalation list: `references/lead.md > Model note`. Mode C (security) always opus. |
| `engineer` `qa` `retro` `uxui` | sonnet | Execution work guided by plan/test-plan artifacts; the artifacts carry the judgment. |
| `team-best-practice-researcher` `team-code-reviewer` `team-silent-failure-hunter` | sonnet | Open-ended judgment: research synthesis, whole-diff review, error-path reasoning. |
| `team-codebase-explorer` `team-code-simplifier` `team-comment-analyzer` `team-pr-test-analyzer` `team-type-design-analyzer` | haiku | Narrow single-lens pattern work against an explicit output template — tier buys speed, template carries the rigor. |
| `general-purpose` / `Explore` built-ins | floor (default sonnet) | No frontmatter pin → would inherit the main tier. Guard Case 6 requires an explicit `model=` equal to the floor; override the floor per-machine with `CLAUDE_DEV_FLOOR_MODEL`. |

Rules of thumb:

- **Escalate runs, not roles.** For a run whose failure cost dwarfs token cost (L-tier plan, security-sensitive, big migration, overnight autonomous), run the SESSION on the highest tier available and keep worker pins unchanged — the orchestrator's judgment is where tier pays.
- **Inline-fallback upgrades are visible, not silent.** The registry inline-fallback always spawns `general-purpose` at the floor — for a haiku-pinned role that is a tier UP; the `Dispatched-as` note must say so (cost drift stays auditable).
- **Wall-clock/cost claims are generation-dated.** Re-validate "tier X ≈ tier Y at Z cost" claims when the model family changes before letting them steer a default.
