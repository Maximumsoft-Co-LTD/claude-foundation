# sandbox Delta

## ADDED Requirements

### Requirement: Multi-repository worktree synchronization is conflict-atomic

`sandbox sync` SHALL replay every moved writable repository sandbox onto its
current target commit, SHALL prepare every replay before replacing any live
sandbox, and SHALL leave every live sandbox and recorded base unchanged when
any repository replay conflicts.

#### Scenario: Multiple targets move cleanly

- **WHEN** two writable repository targets advance and their sandbox diffs
  replay cleanly
- **THEN** sync advances both sandboxes and both recorded bases and preserves
  the sandbox changes plus the newly landed target content

#### Scenario: One repository conflicts

- **WHEN** replay preparation succeeds for one repository but conflicts in a
  second repository
- **THEN** sync reports the second repository and path, removes all temporary
  replay artifacts, and leaves both original sandboxes and recorded bases
  unchanged
