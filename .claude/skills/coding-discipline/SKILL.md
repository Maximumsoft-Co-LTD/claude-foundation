---
name: coding-discipline
description: Apply the behavioral guardrails that keep an AI coding session honest — surface assumptions instead of guessing, write the minimum code that solves the problem, keep every diff surgical, and turn the task into a verifiable goal. Use BEFORE starting any code change, large or small — implement, add a feature, fix, refactor, "clean this up". This is the conduct layer; it routes to the construction, git, and debug/qa skills rather than duplicating them. Skip pure config edits, one-line shell, and throwaway scripts.
---

# Coding Discipline

## Why this exists

Adapted from [Andrej Karpathy's observations on LLM coding pitfalls](https://x.com/karpathy/status/2015883857489522876) (via the MIT-licensed [andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills)) and the [ponytail](https://github.com/DietrichGebert/ponytail) stance (its always-on digest lives in `.claude/rules/fundamentals.md > Ponytail`). The failure modes are **conduct** gaps, not knowledge gaps — the model already knows better but: makes silent wrong assumptions without checking, overcomplicates and bloats abstractions (1000 lines where 100 would do), and changes/removes code it doesn't understand as a side effect. This skill governs *how you show up to a code task*; the domain-fundamentals skills govern *what you build*. Run this as the stance check, then the layer-appropriate fundamental.

**Tradeoff:** biases toward caution over speed. For genuinely trivial tasks, use judgment.

## The 4 principles

### 1. Think Before Coding

**Rule:** Don't assume. Don't hide confusion. Surface tradeoffs *before* the first line, not after the mistake.

**Why:** The most expensive LLM failure is picking one interpretation silently and running 200 lines down the wrong road. A 20-second clarification beats a 20-minute rewrite.

**How to apply:**
- State assumptions explicitly. If a request has more than one reasonable reading, name the readings — don't pick one in silence.
- If a simpler approach exists than the one implied, say so and push back.
- If something is genuinely unclear, stop and name exactly what's confusing.

**Defer to:** the *lightweight, always-on* version. When scope is ambiguous, oversized, or needs a real design conversation (2–3 approaches, requirement-slot interview, spec self-review), hand off to [[brainstorming]] rather than improvising a half-interview here.

### 2. Simplicity First

**Rule:** Write the minimum code that solves the *stated* problem. Nothing speculative.

**Why:** "Flexibility"/"configurability" nobody asked for is the most common self-inflicted complexity — a guess about a future that rarely arrives, and a tax on every reader until then.

**How to apply:**

Walk the **decision ladder** before writing — stop at the first rung that solves the *stated* problem, descend only when the rung above genuinely doesn't:
1. **Does it need to exist?** — if the stated problem doesn't require it, don't build it (principle 1's YAGNI, at code granularity).
2. **Does the standard library / language built-in solve it?** — reach for it before hand-rolling.
3. **Is there a native platform feature?** — the runtime, framework, or database may already do it.
4. **Does an already-installed dependency solve it?** — use what's in the lockfile before writing the code yourself. (Adding a *new* dependency is **not** a free rung — a dependency is its own complexity and trust boundary; [[security-fundamentals]] owns that call.)
5. **Can it be one line?** — the smallest correct expression wins.
6. **Only then** — write the minimum code that solves it.

**Lazy, not negligent:** the ladder trims *solution bloat*, never the trust-boundary validation, error/data-loss handling, authorization, or accessibility the task needs — those are required behaviour, not speculative extras. "One line" never means "skip the unhappy path." Mark a deliberate shortcut (stub, deferred generalisation, narrower-than-ideal impl) inline with a `ponytail: <upgrade path>` comment so the deferral is visible and harvestable, never silently lost.

Then, whatever rung you land on:
- No features, options, or config beyond what was asked. No error handling for impossible scenarios.
- No abstraction for a single call site. Inline first; extract only on the second real use.
- The test: *would a senior engineer call this overcomplicated?* If 200 lines could be 50, rewrite it.

**Defer to:** *write-time intent*. [[programming-fundamentals]] owns deeper code mechanics (complexity/Big-O, illegal states, pure core); `/simplify` owns the *post-hoc* cleanup pass on a diff. Don't pre-run the simplify catalog — just don't build the complexity.

### 3. Surgical Changes

**Rule:** Touch only what the request requires. Clean up only the mess your own change made.

**Why:** Orthogonal edits — reformatting, "improving" a comment, refactoring code that wasn't broken — bloat the diff, bury the real change, and risk breaking code you didn't fully understand. Every changed line should trace to the request.

**How to apply:**
- Don't reformat, rename, or refactor adjacent code that isn't part of the task. Match existing style even if you'd do it differently — consistency is a feature.
- If you spot unrelated dead code or a real bug nearby, *mention* it; don't fix it inline. Let the user decide.
- Do remove imports/variables/functions that *your* change orphaned. Don't remove pre-existing dead code unless asked.

**Relation:** the write-time cousin of [[git-workflow]]'s atomic-commit discipline — a surgical diff is what makes an atomic commit and reviewable PR possible.

### 4. Goal-Driven Execution

**Rule:** Turn the task into a verifiable success criterion, then loop until it's met.

**Why:** "Make it work" is unverifiable — you can't tell when you're done and the user becomes the test harness. A concrete criterion lets you iterate independently and *know* you've finished.

**How to apply:**
- Restate the task as a checkable goal: "add validation" → "tests for the invalid inputs pass"; "fix the bug" → "a test that reproduces it now passes"; "refactor X" → "the existing tests stay green before and after."
- For multi-step work, write a brief plan where each step names its own verification:
  ```
  1. [step] → verify: [check]
  2. [step] → verify: [check]
  ```

**Defer to:** the *stance* lives here, the *machinery* elsewhere. In `/dev`, `qa` authors/runs tests and maps them to acceptance criteria. For a bug, [[debug-fundamentals]] owns "reproduce first, fix the cause, pin it with a regression test." Adopt the goal-driven framing; route actual verification to them.

## Pre-flight checklist

Before you touch code, four questions:

1. **Assumptions** — have I stated them, and named any genuine ambiguity instead of silently choosing?
2. **Simplicity** — did I walk the ladder (stdlib / native / already-installed dep before new code), and is this the minimum that solves the *asked* problem, with nothing speculative?
3. **Surgical** — does every changed line trace to the request, with no orthogonal edits riding along?
4. **Goal** — do I have a concrete, checkable definition of done?

If any answer is "I don't know," resolve it before writing.

## Relation to other skills

A thin **behavioral wrapper** that routes work to the skills owning each concern — it does not replace or re-teach them:

- [[brainstorming]] — the full ambiguity/scope conversation (principle 1 is its micro-version; escalate when design is genuinely open).
- [[programming-fundamentals]] — code mechanics (principle 2's intent → its concrete rules: illegal states, pure core, complexity).
- `/simplify` — post-hoc cleanup of a written diff (principle 2 prevents the mess; `/simplify` removes what slipped through).
- [[git-workflow]] — commits/branches/PRs (principle 3's surgical diffs make atomic commits possible).
- [[debug-fundamentals]] + `qa` agent — verification (principle 4 sets the stance; they author the tests).

Run order: this skill *first* as the conduct check, then the layer-appropriate domain skill (canonical order: `.claude/rules/fundamentals.md`; for a bug, `debug-fundamentals` runs first).

## When to skip

- Pure config edits with no logic (env vars, versions, formatter rules).
- One-line shell commands or trivial REPL exploration.
- Throwaway scripts you'll delete within the hour.

For anything else — even the "small" feature or "quick" fix — the four principles apply.
