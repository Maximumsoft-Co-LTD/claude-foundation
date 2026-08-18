# Change: make multi-repository sandbox sync replay every writable worktree atomically and keep review evidence valid when only repository base commit identities change without content changes

## Why

A consumer multi-repository round had to abandon and reopen an otherwise
unchanged change when the control repository advanced. `sandbox sync` already
replays a moved base for a single worktree, but deliberately stops at the
multi-repository boundary. The same round then paid another independent review
because the composite workspace hash includes each repository's `baseHead` even
when every tracked byte is unchanged. Both are harness recovery/cost defects.

## What changes

- `sandbox sync` stages replayed worktrees for every moved writable repository
  before replacing any live sandbox, then advances all successful repository
  bases together. A replay conflict leaves every live sandbox untouched and
  names the repository and path that must be merged.
- Composite workspace and code hashes are derived from repository content and
  contract revision, not commit identity. Target-head drift remains enforced by
  the existing explicit Land guards, while unchanged content keeps current
  proof and review evidence valid after a history-only base movement.

## Impact

- **Impact:** high
- **Coupling:** coupled
- **Affected surfaces:** shipped sandbox runtime, composite evidence identity,
  protocol pins, deterministic multi-repository tests, operator documentation
- **Security triggers:** none

## Non-goals

- Product fixes from either consumer report.
- The external `agent-tool` provider-routing defect and the external `rtk`
  output defect; neither is implemented by this harness.
- Automatically resolving a real content conflict or weakening target-head
  Land guards.
