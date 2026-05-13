# Plan: <title>

**Spec**: [./spec.md](./spec.md)
**Type**: feat | fix | refactor | chore | docs | spike
**Status**: draft | approved | done

## Approach
2–3 sentences on strategy + the main tradeoff considered.

For **fix** type: step 1 of `Steps` below MUST be "write failing regression test for <bug>" — encoded against the Reproduction in `spec.md`.
For **refactor** type: include a one-line *behavior-equivalence statement* — what behaviour stays identical and how that gets verified (existing tests / new char-test / golden file).
For **spike** type: this section names the question being answered and what evidence will count as an answer.

## Steps
1. <action> — `path/to/file.ext:line` (new | edit | delete)
2. ...

## Files touched
| Path | Change | Why |
|------|--------|-----|
| `path/to/file.ext` | new/edit | ... |

## Risks
| Risk | Likelihood | Mitigation |
|------|------------|------------|
| ... | low/med/high | ... |

## Rollback
How to undo the change if it ships broken. Required for any step that touches: a database migration, a destructive script, a config flag in prod, a binary cutover, or a public API contract. Otherwise write "N/A — change is reversible by reverting the commit."

- Trigger: <what tells us we need to roll back>
- Steps: <ordered, copy-pasteable>
- Data loss?: <none | partial — describe>

## Out of scope
What this plan explicitly does NOT cover. For **spike** runs, this is where you say "no production code lands from this run — `engineer` writes `recommendations.md` only".
