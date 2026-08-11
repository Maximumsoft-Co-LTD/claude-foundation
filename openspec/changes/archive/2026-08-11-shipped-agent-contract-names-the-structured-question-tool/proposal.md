# Change: shipped agent contract names the structured question tool

## Why

`.claude/rules/fundamentals.md` tells an agent to put user decisions through
the host's structured question tool. A consumer project never reliably reads
that line. `install.sh` writes one pointer block into the target's `CLAUDE.md`,
and it references `@.claude/harness/AGENT.md` and nothing else. AGENT.md is
therefore the only Foundation instruction guaranteed to be in context — and its
"Human interaction" section describes the decision protocol entirely in prose
("Ask before authority or consequential choices. Offer reject, inconclusive, or
pause"), never naming a tool. Its closing line cites `fundamentals.md` for
*skill routing*, so nothing sends the reader to the one place the rule lives.

The observed result in a consumer session: a Land-time decision arrived as
plain lettered prose — "ก) rebase, ข) push and open a PR, ค) pause" — instead
of a structured question the user could answer by selecting. The options were
sound; the channel was wrong. A host that offers selectable options is being
handed a paragraph to read instead.

Nothing in the deterministic suites catches this. `interview/` captures and
replays `AskUserQuestion` calls, but no assertion requires the shipped contract
to ask for one.

## What changes

- AGENT.md's "Human interaction" section names the structured question tool
  (`AskUserQuestion`) as the channel for decisions when the session offers one,
  with plain text as the stated fallback.
- Its closing pointer cites `fundamentals.md` for conduct as well as skill
  routing, so the fuller rule is reachable rather than orphaned.
- `run-doc-consistency.sh` asserts the shipped contract names that tool, so the
  instruction cannot silently revert to prose.
- AGENT.md's word budget rises from 150 to 175, deliberately and for that file
  alone, with the reason recorded beside the existing per-file raises. The
  rewritten section measures 171. Rewording alone could not carry the new rule:
  the tightest phrasing that still names the tool measured 159, and every word
  left to cut was another rule the contract already carries.

## Impact

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** shipped agent contract, documentation contract tests
- **Security triggers:** none

## Non-goals

- Editing `change.md`, `prove.md`, `land.md`, or `build.md`. Each sits within a
  word or eight of its budget, the instruction they would each repeat belongs
  in the contract they all inherit, and four copies is the wrong fix for one
  missing sentence.
- Raising any budget other than AGENT.md's. The standing 120-word slash-command
  budget and every other named limit stay exactly where they are.
- Changing `fundamentals.md`, which already states the rule correctly.
- Any runtime behavior. The harness does not and will not enforce which channel
  a question is asked through.
