# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Always-on skill rule and full skill body for `architecture-fundamentals` — the system-level layer above hexagonal that names boundaries (bounded contexts, module-vs-service), single-owner data, sync vs async, resilience (timeouts, retries, breakers, bulkheads), eventual vs strong consistency, observability (RED/USE, SLI/SLO, tracing), and backwards-compatible contract evolution. Includes `references/` deep dives on boundaries, communication, resilience, and observability. CLAUDE.md working-agreement run order updated: hexagonal → architecture → queue.
- `install.sh`: structured `CLEANUP` array for legacy file removal. Dry-run lists pending deletions; apply pass loops the array and reports a `removed` count. Future fixes that drop a previously-installed file just add a row. ([7a20615](../../commit/7a20615))
- Interactive workflow slides example — single-file static deck (no build, no deps) walking the `/dev` workflow across 12 slides, each with its own widget (type-aware matrix picker, agent tiles, gate mock, animated flow, security trigger paths, live `state.json`). Content sourced from `WORKFLOW.md`. ([278402d](../../commit/278402d))
- Zero-install todolist example under `examples/`, produced by run `0002-feat-todolist-app` on branch `examples/todolist`. Workflow artifacts under `.workflow/` are intentionally excluded — only the example ships. ([5b70308](../../commit/5b70308))
- Always-on skill rules and full skill bodies for `programming-fundamentals`, `database-fundamentals`, `hexagonal-backend`, `queue-fundamentals`, and `debug-fundamentals`, including per-skill `references/` deep dives. ([ed0329e](../../commit/ed0329e), [f79b663](../../commit/f79b663))
- `.workflow/_templates/` blueprints — `spec.md`, `plan.md`, `review.md`, `security.md`, `tests.md`, `recommendations.md`, `retro.md`, `epic.md`, `state.json`. ([ed0329e](../../commit/ed0329e))
- `.workflow/INDEX.md` run registry and `.workflow/FOLLOWUPS.md` carry-over registry (never overwritten on re-install). ([ed0329e](../../commit/ed0329e))
- `.claude/hooks/lint.sh` PostToolUse lint dispatcher and `.claude/settings.json` hook wiring (only installed when missing). ([ed0329e](../../commit/ed0329e))
- `install.sh` with `--dry-run`, `--force`, `--yes`, and `--source` flags; self-copy guard. ([ed0329e](../../commit/ed0329e))
- Initial five-agent set under `.claude/agents/`: `pm`, `lead`, `engineer`, `qa`, `retro`. ([ed0329e](../../commit/ed0329e))
- `/dev` slash command and `WORKFLOW.md` flow reference. ([ed0329e](../../commit/ed0329e))

### Changed

- Documentation and agent specs refreshed for **type-aware** execution — `feat`, `fix`, `refactor`, `chore`, `docs`, `spike` no longer all run the same phases. `qa` and `retro` carry the brunt of the type-aware behavior (regression-first for `fix`, skipped with stub for `chore` / `docs` / `spike`, recommendations-only for `spike`). ([7ec293f](../../commit/7ec293f), [f79b663](../../commit/f79b663))
- `pm` agent now receives interview Q&A as input rather than running the interview itself; `AskUserQuestion` removed from its tool list. ([acf8964](../../commit/acf8964))
- `README.md` and `WORKFLOW.md` updated to describe the main-agent orchestrator role and the five remaining sub-agents. ([acf8964](../../commit/acf8964))
- `install.sh` extended to install the new skills, rules, hooks, templates, and follow-up registries. ([7ec293f](../../commit/7ec293f), [f79b663](../../commit/f79b663))

### Fixed

- `/dev`: orchestrator + spec interview moved from a sub-agent into the main agent. Claude Code sub-agents cannot use `Agent` (no nested spawns) or `AskUserQuestion` (no user prompts), so the previous design silently failed at the first hop. Orchestrator promoted to a main-agent script at `.claude/orchestrator.md`, loaded by `/dev`. `install.sh` gained an upgrade-cleanup block so existing targets lose the stale sub-agent file. ([acf8964](../../commit/acf8964))

### Removed

- `.claude/agents/orchestrator.md` sub-agent file (replaced by the main-agent script at `.claude/orchestrator.md`). ([acf8964](../../commit/acf8964))

---

_No tagged releases yet. Once a version is cut, move entries from `[Unreleased]` into a dated section (e.g. `## [0.1.0] - YYYY-MM-DD`)._
