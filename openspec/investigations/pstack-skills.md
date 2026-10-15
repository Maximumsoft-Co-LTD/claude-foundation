# pstack skills review note

External source, read only: `cursor/plugins` at
`e5136d82418d2db3165ea1050d17577cd618cc05`, directory `pstack/` (MIT; credits
Lauren Tan). 54 skill folders (24 `principle-*`, 30 workflow skills including
`poteto-mode` with its playbooks) and two agents (`poteto-agent`,
`comment-sicko`); about 31k words of SKILL.md. Nothing from it was executed.

The earlier adoption map (`.claude/skills/skill-suite-auditor/references/pstack-adoption.md`)
reviewed Michael Denyer's port at `5062f28` and assigned owners for 58 skills.
Several mapped principles have no matching text in the owner skill today.

## Principles (24)

Covered: boundary-discipline, explain-the-number (performance), fix-root-causes,
laziness-protocol, minimize-reader-load, model-the-domain, prove-it-works,
separate-before-serializing-shared-state, test-behavior-not-implementation,
type-system-discipline; guard-the-context-window is structural only.
Partial: attack-the-premise, encode-lessons-in-structure, exhaust-the-design-space,
experience-first, foundational-thinking, make-operations-idempotent,
redesign-from-first-principles, sequence-verifiable-units, migrate-callers.
Missing: build-the-lever. Conflicts: never-block-on-the-human (spec approval),
outcome-oriented-execution (shippable slices), subtract-before-you-add (no
bundled cleanup). pstack requires naming each principle that shaped a decision;
Change Loop has no such citation rule.

## Workflow skills

Missing: technical-writing (Diátaxis, style rules), unslop (pattern catalog).
Partial with concrete additions: Hillclimb playbook (stop predicate, frozen and
sensitivity-checked harness, attempt log, plateau pivot; the `benchmark` provider
only guards regressions), Perf-issue mantra order and forensics, blast-radius
proof ladder and load-bearing safety fact, correct's enforcement ladder (the
`lessons` command detects repeats but has no ladder or failing-on-past-case
rule), verification-driver Doctor/evidence-survival/drift triage, why's
sources-consulted list including null results, eval blinding.
Covered or conflicting: architect/arena/interrogate/swarm model fan-out, setup
model rewriting, commit/PR/merge playbook steps, autonomy rule for external
actions, poteto-agent (task packets are narrower and cheaper).

## Budget constraint

All SKILL.md bodies total 9463 of 9500 words (37 left); `fundamentals.md` 665 of
700; `AGENT.md` 300 of 300. Each SKILL.md is capped at 700 words. Growth that
exceeds a limit requires the user's budget decision. Skill reference files are
loaded on demand and are mostly unbudgeted, so adoptions belong there.
