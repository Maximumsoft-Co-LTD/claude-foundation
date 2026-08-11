# Design

## Current state

- `install.sh` writes a marked block into the target `CLAUDE.md` whose only
  Foundation reference is `@.claude/harness/AGENT.md`.
- `.claude/harness/AGENT.md` "Human interaction" states the decision protocol
  in prose and closes with "Use `fundamentals.md` for skill routing and
  `orchestrator.md` for policy."
- `.claude/rules/fundamentals.md:10-12` carries the actual rule, including the
  tool name.
- `run-context-budget-tests.sh:47` caps AGENT.md at 150 words. It currently
  measures exactly 150.
- The command files that create decision points — `change.md:22`,
  `prove.md:11`, `land.md:20-21` — describe them in prose and sit at 130/135,
  118/120, and 119/120 words.
- `run-doc-consistency.sh` asserts several shipped sentences verbatim
  (`assert_file_contains`) but nothing about how a decision is asked.

## Decisions

- **Decision:** fix AGENT.md only.
  - **Why:** it is the one file a consumer is guaranteed to load, so it is
    where the instruction has leverage.
  - **Rejected:** repeating the instruction in all four decision-bearing
    command files. Three of them have between one and eight words of headroom,
    so it would force four budget decisions to state four times what the
    inherited contract can state once.

- **Decision:** AGENT.md's budget rises 150 → 175; the rewritten file measures
  171. The user made this call when the limit bound.
  - **Why:** the section had to carry a rule it did not carry before, and
    rewording could not absorb it — the tightest phrasing that still named the
    tool measured 159, and the remaining 9 words were each another rule. The
    budget suite's own guidance forbids silently compressing content to fit and
    requires the user to choose between raising the limit, moving detail to
    selectively loaded documentation, and deliberately shortening; option two
    is what caused this defect, and option three was the compression the
    guidance forbids.
  - **Rejected:** cutting an existing rule from the contract to stay at 150.
  - **Note:** the raise is recorded beside the existing per-file raises for
    `change.md` and `build.md`, so the standing budget still binds elsewhere.

- **Decision:** the pointer line cites `fundamentals.md` for conduct as well as
  skill routing.
  - **Why:** the current wording is why the rule is orphaned. An agent told
    that a file is for *skill routing* has no reason to read it for conduct,
    and the tool instruction lives under conduct.

- **Decision:** the regression is a `assert_file_contains` in
  `run-doc-consistency.sh`, not a new suite.
  - **Why:** that suite already pins shipped sentences and is the lowest
    deterministic boundary that would have caught this — the defect is a
    sentence missing from a shipped file. A new suite would add a script, a
    `run-all.sh` line, and a README row to assert one string.

- **Decision:** no runtime enforcement.
  - **Why:** the harness cannot observe which channel a host question used, and
    inventing state to track it would be the parallel-state failure the
    contract already forbids. This is an instruction defect with an instruction
    fix.

## Compatibility and migration

Instruction-only. AGENT.md is a managed file, overwritten on install, so
consumers pick the wording up on their next `install.sh` or
`claude-foundation init`. No pin, schema, receipt, or fingerprint is involved.
Rollback is reverting the file.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| The reworded section drops one of the rules it already carried | The scope, translation, hiding, recommendation, and ownership sentences are each asserted or re-read against the original; the doc suite pins the added one | `test` |
| The budget raise becomes a precedent that erodes every other limit | The raise is named for one file with its reason recorded, the standing 120-word command budget and every other named limit are untouched, and `run-context-budget-tests.sh` still fails closed at 175 | `test` |
| The instruction lands but command files still read as prose-only | Accepted and named as a non-goal: the command files inherit AGENT.md, and stating it four more times costs four budget decisions | `test` |
