---
name: claude-md
description: Revise, optimise, or generate the root CLAUDE.md — the per-session guide Claude Code reads in this repo — into a fixed nine-section shape (Project Overview, Tech stack, Architecture, Domain Model, Folder Structure, Current State, Team Agent, Roadmap, Common Command) at max heading depth 2, grounded in the actual code and preserving any hand-authored rules. Use on "update / revise / optimize / generate CLAUDE.md", "make a CLAUDE.md for this repo", "tighten my CLAUDE.md", "ปรับ / อัพเดท / สร้าง CLAUDE.md", "ทำ CLAUDE.md ให้ repo นี้" — for an EXISTING codebase (it reads the code, never invents). The deep human-facing docs/ suite is [[init-project-docs]]; this is its lean agent-facing companion.
---

# Revise CLAUDE.md (the agent-facing guide)

`CLAUDE.md` loads into context **every session** — keep it tight, current, true. Rewrite it to one fixed shape, read from the repo, never invented. Companion to [[init-project-docs]] (the long-form `docs/` suite): run that for deep docs, this for the session guide.

## Shape (fixed)

**Max heading depth 2** — `#` title + the nine `##` below, nothing deeper (bullets/tables under each). An **index, not a copy**: where a `docs/` file exists, link it in one line.

| `##` section | Source — grounded, never invent |
|---|---|
| Project Overview | README + entry points → what it is · who for · one-command run |
| Tech stack | manifests + lockfiles — real versions |
| Architecture | top components/boundaries, 1–2 lines (diagram → `docs/ARCHITECTURE.md`) |
| Domain Model | migrations / ORM models — real entities + key relationships |
| Folder Structure | top-level tree, one line per node |
| Current State | built / in-progress / known gaps — code + README + open TODOs; honest unknowns. Standing snapshot (≠ a `/dev` run's `context.md`) |
| Team Agent | `.claude/agents/*.md` → name · role · model; none → "none" |
| Roadmap | **invention-prone** — only README roadmap / milestones / `TODO`; none → "No roadmap found in repo" |
| Common Command | build/run/test/lint from `package.json` / Makefile / CI — real invocations |

## Rules

- **Ground every line** — trace to a file you read; can't find it → one honest line, not filler.
- **Revise, don't replace** — existing `CLAUDE.md`: preserve every hand-authored rule verbatim, reorganise into the nine sections, fill gaps. Absent → create.
- **No secrets** — name env vars, never copy values.
- Large repo → split only genuinely independent subsystem read-outs using native parallel work packages, then synthesize once.

## Skeleton

```markdown
# <Project> — CLAUDE.md
<one line: the per-session guide for Claude Code here. Preserve existing house rules verbatim.>

## Project Overview
<2–3 lines: what · who for · one-command run>
## Tech stack
<languages · frameworks · datastores · build/CI — real versions>
## Architecture
<top components + boundaries; diagram → docs/ARCHITECTURE.md>
## Domain Model
<key entities/tables + relationships that matter>
## Folder Structure
- `src/` — <purpose>   <!-- top-level only, real layout -->
## Current State
<built · in progress · known gaps — grounded; honest unknowns>
## Team Agent
<.claude/agents/*.md → name · role · model; "none" if none>
## Roadmap
<README / milestones / TODO only; "No roadmap found in repo" if none>
## Common Command
- build/test/run/lint: `<real cmds from package.json / Makefile / CI>`
```

## Anti-patterns

Bloating it (loads every session) · `###` depth · inventing stack/schema/agents/roadmap · clobbering hand-authored rules · duplicating `docs/` instead of linking.

## Related

[[init-project-docs]] (deep `docs/` suite — run first, link back) · [[refactoring-fundamentals]] (current-state mindset → Current State).
