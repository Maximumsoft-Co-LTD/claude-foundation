# Change: Align host adapter capabilities and upgrades

## Why

Foundation exposes one workflow across Claude Code, OpenCode, Cursor, and Codex, but live guard coverage differs by host and adapter upgrades can retain retired Foundation-owned commands. Users need truthful capability reporting and upgrades that converge each host to the current command surface.

## What changes

- Expose a machine-readable and human-readable host capability result that distinguishes live, partial, and unavailable guard coverage without implying parity that the host cannot provide.
- Track Foundation-owned Cursor, OpenCode, and Codex adapter artifacts so an upgrade removes retired commands and prompts while preserving user-owned files.
- Pin cross-host capability truth and upgrade cleanup with deterministic installer and documentation tests.

## Impact

- **Impact:** medium
- **Coupling:** coupled
- **Affected surfaces:** host adapter installers, guard capability contract, installer upgrade tests, operator documentation
- **Security triggers:** host-enforcement

## Non-goals

- Emulate tool hooks in a host that provides no hook API.
- Block Cursor or Codex installation solely because live guards are unavailable.
- Delete an adapter command or prompt that Foundation cannot prove it owns.
- Change Land evidence or authority policy.
