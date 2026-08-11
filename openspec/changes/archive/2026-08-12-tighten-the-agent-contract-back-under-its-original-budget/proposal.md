# Change: tighten the agent contract back under its original budget

## Why

The previous change raised `AGENT.md`'s word budget from 150 to 175 to fit one
new instruction, on the finding that the tightest phrasing naming the tool
measured 159. That finding held only for the phrasing tried at the time. The
section still carried avoidable connective tissue — "Use", "when applicable",
"the host's structured question tool", repeated "and" — and removing it brings
the file back to 150 words with every rule intact. A budget raised past what
the content needs is slack no future edit has to justify, so it is withdrawn.

## What changes

- `AGENT.md` is tightened from 171 to 150 words. No rule is dropped: the loop,
  state ownership, packet and sandbox rules, evidence placement, the unproven
  pass ban, Land authority, translation, hiding, the question channel and its
  fallback, the offer/recommend/no-pass-bias rules, natural answers, metadata
  ownership, and both pointers all survive.
- The 175-word budget reverts to 150, and its raise rationale is removed.
- The fallback assertion tracks the reworded sentence: `plain text when` becomes
  `plain text otherwise`.

## Impact

- **Impact:** low
- **Coupling:** isolated
- **Affected surfaces:** shipped agent contract, documentation and context
  budget test suites
- **Security triggers:** none

## Non-goals

- Dropping any rule to hit a number. The word count fell out of tightening; it
  was not the target.
- Touching the sentences pinned by existing assertions — `Harness output is a
  machine handoff` and `never present only the option that makes the workflow`
  are unchanged.
