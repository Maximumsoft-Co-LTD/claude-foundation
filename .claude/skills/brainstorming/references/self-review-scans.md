# Spec self-review — the 5 scans

Deep reference for SKILL.md principle 7. After the spec is written, walk it once with fresh eyes. Fix issues inline; no need to re-review:

1. **Placeholder + ambiguity scan** — any `TBD`, `TODO`, `???`, `appropriate X`, `as needed`, `etc.`, hedging modals (`should`, `would`, `might`) in concrete slots → either resolve or replace with `[NEEDS CLARIFICATION: <who> — <what>]` at the spot it matters.
2. **Content discipline scan** — every section in the spec has its trigger firing; no empty headers, no "N/A"; measurable perf/security/a11y targets are written as ACs (`<attribute>: <target> — measured: <how>` as the AC's verify), not parked in a standalone untestable section; DoD items name concrete artifacts (specific metric / doc path / flag); error/boundary and edges live as sub-bullets under the AC they belong to, never as a standalone section.
3. **Contradiction scan** — does any section contradict another (User journey vs AC, Scope > Out vs AC)? If yes, surface as inline `[NEEDS CLARIFICATION]`.
4. **Scope check** — still one ship-able thing? If decomposition slipped back in, split now.
5. **Verifiability + example + boundary + pre-mortem scan** — for each AC, can you name the exact command or observable that would verify it? If not, the AC is wishful — rewrite it. Then: every *consequential behavioural* AC (one whose behaviour isn't obvious from its single line) has a concrete `e.g.: input → expected output` sub-bullet AND an `on error / at boundary:` line (an explicit behaviour or `none — <default>`) — if either is missing, add it now (this is where mis-spec'd AC and silently-guessed unhappy paths are cheapest to catch). An NFR-class AC (a measurable target with a `measured:` clause) is exempt — its `measured:` clause is its verify and it carries neither sub-bullet. Then name the **top 3 ways this design could fail**: dependency that might not deliver, scope someone could mis-read, AC the implementation could satisfy without satisfying the user. Surface each as a plan `Risk`, a `[NEEDS CLARIFICATION]`, or a Discovery note. This is the "give the agent a way to verify its work" principle from [Claude Code best practices](https://code.claude.com/docs/en/best-practices) applied at spec time, with the pre-mortem half adapted from the Amazon PR/FAQ.

Result: a clean spec, or a spec with inline `[NEEDS CLARIFICATION]` markers listing what's unknown. **Never** mark `approved` while any marker remains — that is what the marker exists to defer to the gate (Phase 1 step 8).

## Anti-pattern

- **Flipping `Status: approved` while any `[NEEDS CLARIFICATION]` marker remains** — `approved` means the spec is complete enough to plan against. If something is unresolved, the marker stays and the gate blocks.
