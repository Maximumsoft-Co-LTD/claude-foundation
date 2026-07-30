# pm — extended rules

Load a section only when its trigger fires; the core `pm.md` carries everything that fires on every main-mode (spec-writing) invocation.

## Spec-patch mode

**Load when:** re-spawned to apply gate-revise notes that touch **requirements** (the prompt names the notes + the affected sections). This is a targeted edit, not a rewrite.

- **Edit only the affected sections** with `Edit`. Don't rewrite the spec, don't re-render unaffected sections, don't re-run/re-request research — the spec stands except where the notes change it. Keep the rest byte-stable so the orchestrator can re-present only the changed parts.
- Apply the same hard rules to the edited region (NFR → AC, consequential AC carry `e.g.`/`on error`, no invented values, resolve or add markers inline).
- A note that opens a new unfillable slot → embed `[NEEDS CLARIFICATION]` rather than guessing; the orchestrator decides whether to ask one narrow question.
- **Return:** the spec path, a 1–2 line summary of **only what changed** (which sections/AC), and any remaining markers.

## Recruit help (authorized direct nesting)

**Load when:** the parent prompt carries `fanout_authorized: true`, names the spawn proof, and supplies ≥2 independent probe scopes the draft lacks. Probe count and size alone are not authorization. **Draft-first always:** write the spec, then use the authorized probes.

- **When** — ≥ 2 independent probes the digest + repo don't answer. One probe → resolve inline.
- **Split + spawn** — one `team-codebase-explorer` per `codebase-*` fact, one `team-best-practice-researcher` per `best-practice-*` question, in **one message** (parallel), **cap 4**. Give each: run id/type, the spec excerpt, its question, the sections to return.
- **Registry path** (`.claude/skills/fanout-team-agents/SKILL.md`) — read `team_registry`: `live` → by name; `inline-fallback` → `general-purpose` + `model="sonnet"` with `.claude/agents/team-<role>.md` inlined (Case 6 blocks an unpinned general-purpose spawn); `unknown` → try named, fall to inline on `not found`, report the path. A miss never drops you to a single inline lookup. Inline fallback for a haiku-pinned role runs a tier UP (sonnet floor) — say so in the path report so cost drift stays auditable.
- **Integrate + verify yourself** — confirm each helper stayed in scope; you stay the sole writer of `spec.md`. Don't re-probe what the orchestrator already appended.
- **Guardrails** — helpers are read-only, never write `spec.md`/`state.json`. Requirement ambiguity is NOT a probe — a genuine unknown returns as `BLOCKER:`. One level of split; dispatch mechanics + stop-line: `.claude/skills/fanout-team-agents/references/dispatch-mechanism.md > Worker-side nesting contract`.
