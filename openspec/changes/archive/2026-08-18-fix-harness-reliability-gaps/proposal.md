# Change: fix harness reliability gaps

## Why

Runtime API 23 still permits stale evidence when a command names an untracked
script outside its declared inputs, reports a copy-mode Land conflict for
already-identical content, cannot safely recover a sandbox after its project is
moved, and ships contradictory API setup instructions. These gaps undermine
evidence integrity and make concurrent or relocated work require manual
workarounds.

## What changes

- Validate and bootstrap explicit input coverage for workspace files named by
  executable provider commands.
- Treat byte-and-mode-identical copy targets as already reconciled during Land.
- Add an identity-checked recovery path that rebinds a moved project's sandbox.
- Keep shipped runtime API instructions synchronized with the runtime pins.
- Preserve the fresh-session Claude reviewer behavior and regression coverage.

## Impact

- **Impact:** high
- **Coupling:** coupled
- **Affected surfaces:** evidence validation/bootstrap, receipt identity, copy
  apply, sandbox recovery, CLI/help, shipped agent/setup instructions, tests
- **Security triggers:** evidence integrity and path resolution

## Non-goals

- Broadly hashing unrelated untracked files.
- Relaxing receipt provenance, exact reviewer sessions, or overwrite guards.
- Changing release version numbers or consumer application fixtures.
