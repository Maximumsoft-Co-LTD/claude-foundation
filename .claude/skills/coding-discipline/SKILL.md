---
name: coding-discipline
description: Apply the behavioral guardrails that keep an AI coding session honest — surface assumptions instead of guessing, write the minimum code that solves the problem, keep every diff surgical, and turn the task into a verifiable goal. Use BEFORE starting any code change, large or small — implement, add a feature, fix, refactor, "clean this up". This is the conduct layer; it routes to the construction, git, and debug/qa skills rather than duplicating them. Skip pure config edits, one-line shell, and throwaway scripts.
---

# Coding Discipline

## Why this exists

Adapted from [Andrej Karpathy's observations on LLM coding pitfalls](https://x.com/karpathy/status/2015883857489522876) (via [andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills)) and the [ponytail](https://github.com/DietrichGebert/ponytail) stance — always-on digest at `.claude/rules/fundamentals.md > Conduct digest` (+ `Ponytail` for principle 2). These are **conduct** gaps, not knowledge gaps: silent wrong assumptions, bloated abstractions, side-effect edits to code you don't understand. This skill governs *how you show up*; domain skills govern *what you build* — run this first as the stance check, then the layer-appropriate fundamental.

**Tradeoff:** biases toward caution over speed. For genuinely trivial tasks, use judgment. Full rationale, worked example, and per-skill mapping cut from this diet: `references/details.md`.

## The 4 principles

### 1. Think Before Coding

**Rule:** Don't assume. Don't hide confusion. Surface tradeoffs *before* the first line — a 20-second clarification beats a 20-minute rewrite.

**How to apply:**
- State assumptions explicitly. If a request has more than one reasonable reading, name the readings — don't pick one in silence.
- If a simpler approach exists than the one implied, say so and push back.
- If something is genuinely unclear, stop and name exactly what's confusing.

**Defer to:** the *lightweight, always-on* version. When scope is ambiguous, oversized, or needs a real design conversation (2–3 approaches, requirement-slot interview, spec self-review), hand off to [[brainstorming]] rather than improvising a half-interview here.

### 2. Simplicity First

**Rule:** Write the minimum code that solves the *stated* problem. Nothing speculative — unrequested "flexibility"/config is the most common self-inflicted complexity.

**How to apply:** walk the **decision ladder**, stop at the first rung that solves it:
1. **Does it need to exist?** — if not, don't build it (principle 1's YAGNI, at code granularity).
2. **Stdlib / language built-in solve it?** — use it.
3. **Native platform/framework feature?** — use it.
4. **Already-installed dependency?** — use it (a *new* dependency isn't a free rung — [[security-fundamentals]] owns that call).
5. **Can it be one line?** — the smallest correct expression wins.
6. **Only then** — write the minimum code that solves it.

**Lazy, not negligent:** the ladder trims *solution bloat* only — never the trust-boundary validation, error/data-loss handling, authorization, or accessibility the task needs. Mark a deliberate shortcut inline with a `ponytail: <upgrade path>` comment so the deferral is visible and harvestable, never silently lost.

Whatever rung you land on: no features/options/config beyond what was asked, no error handling for impossible scenarios, no abstraction for a single call site (inline first, extract only on the second real use). The test: *would a senior engineer call this overcomplicated?*

**Defer to:** [[programming-fundamentals]] owns deeper code mechanics (complexity/Big-O, illegal states, pure core); `/simplify` owns the *post-hoc* cleanup pass on a diff — don't pre-run its catalog, just don't build the complexity.

### 3. Surgical Changes

**Rule:** Touch only what the request requires. Clean up only the mess your own change made.

**Why:** Orthogonal edits — reformatting, "improving" a comment, refactoring code that wasn't broken — bloat the diff, bury the real change, and risk breaking code you didn't fully understand.

**How to apply:**
- Don't reformat, rename, or refactor adjacent code that isn't part of the task. Match existing style even if you'd do it differently — consistency is a feature.
- If you spot unrelated dead code or a real bug nearby, *mention* it; don't fix it inline. Let the user decide.
- Do remove imports/variables/functions that *your* change orphaned. Don't remove pre-existing dead code unless asked.

**Relation:** the write-time cousin of [[git-workflow]]'s atomic-commit discipline — a surgical diff is what makes an atomic commit and reviewable PR possible.

### 4. Goal-Driven Execution

**Rule:** Turn the task into a verifiable success criterion, then loop until it's met — "make it work" is unverifiable; a concrete criterion lets you iterate independently and *know* you've finished.

**How to apply:**
- Restate the task as a checkable goal: "add validation" → "tests for the invalid inputs pass"; "fix the bug" → "a test that reproduces it now passes"; "refactor X" → "the existing tests stay green before and after."
- For multi-step work, name each step's own verification (`step → verify: check`); template: `references/details.md > 4. Goal-Driven Execution`.

**Defer to:** the *stance* lives here, the *machinery* elsewhere. OpenSpec evidence claims define what must be proven and `/prove` runs the applicable deterministic providers. For a bug, [[debug-fundamentals]] owns "reproduce first, fix the cause, pin it with a regression test."

## Pre-flight checklist

Before you touch code, four questions:

1. **Assumptions** — have I stated them, and named any genuine ambiguity instead of silently choosing?
2. **Simplicity** — did I walk the ladder (stdlib / native / already-installed dep before new code), and is this the minimum that solves the *asked* problem, with nothing speculative?
3. **Surgical** — does every changed line trace to the request, with no orthogonal edits riding along?
4. **Goal** — do I have a concrete, checkable definition of done?

If any answer is "I don't know," resolve it before writing.

## Relation to other skills

Thin **behavioral wrapper** — routes, doesn't re-teach: [[brainstorming]] (scope/ambiguity), [[programming-fundamentals]] (code mechanics), `/simplify` (post-hoc cleanup), [[git-workflow]] (commits enabled by surgical diffs), [[debug-fundamentals]] and `/prove` (verification). Full per-skill mapping: `references/details.md > Relation to other skills`.

Run order: this skill *first* as the conduct check, then the layer-appropriate domain skill (canonical order: `.claude/rules/fundamentals.md`; for a bug, `debug-fundamentals` runs first).

## When to skip

- Pure config edits with no logic (env vars, versions, formatter rules).
- One-line shell commands or trivial REPL exploration.
- Throwaway scripts you'll delete within the hour.

For anything else — even the "small" feature or "quick" fix — the four principles apply.
