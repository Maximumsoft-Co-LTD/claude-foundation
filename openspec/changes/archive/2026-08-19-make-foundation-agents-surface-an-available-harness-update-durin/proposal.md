# Change: Make Foundation agents surface an available harness update during Investigate, Change, and immediately before Build without checking during Prove or Land

## Why

A copied project harness can remain stale after a new Foundation release, and an agent currently has no dynamic signal that tells the user when the CLI or project runtime should be refreshed.

## What changes

- Resolve and cache the latest stable release at user scope with bounded network behavior and deterministic SemVer comparison.
- Attach update status to Investigate and Change host instructions and to the pre-Build packet, while omitting checks from Prove, Review, and Land.
- Tell agents to notify the user once when an update is discovered and remind before Build if unresolved, without blocking work or performing an update.
- Expose a read-only update check command for explicit inspection and JSON automation.

## Impact

- **Impact:** high
- **Coupling:** coupled
- **Affected surfaces:** CLI, host protocol, project runtime packets, agent policy, tests, and documentation
- **Security triggers:** none

## Non-goals

- Automatically upgrading Homebrew, pulling a source checkout, or refreshing project-owned files
- Blocking Change or Build merely because a newer stable release exists
- Binding transient release or cache state into instruction, workspace, proof, or receipt identity
