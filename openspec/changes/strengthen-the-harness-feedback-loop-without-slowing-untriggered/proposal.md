# Change: Strengthen the harness feedback loop without slowing untriggered work

## Why

Foundation has strong change, proof, and landing controls, but its current
workflow leaves three useful feedback mechanisms implicit: exploratory
prototypes, independently attributable review, and human acceptance of
subjective product decisions. Its Git worktree isolation is also easy to
misread as a security boundary suitable for unattended execution. Add these
capabilities without adding work to changes that do not trigger them.

## What changes

- Report workspace isolation separately from execution-boundary evidence, never
  treat detection as authorization, parse unattended intent monotonically before
  telemetry or subprocesses, and reject unattended mode until a trusted host-owned
  attestation mechanism exists.
- Offer an optional throwaway prototype command without adding a required
  lifecycle phase or proof artifact, and reject prototype origins from receipts
  and proof bundles.
- Emit a compact, fresh-context reviewer packet and record enough provenance to
  enforce independent or diverse review policies across committed and dirty
  repository surfaces.
- Require external human acceptance only for changes that explicitly declare a
- Persist a monotonic, tamper-evident review-attempt history so deleting a current
  receipt cannot reset the AI-review limit.
- Revalidate structured review and acceptance fields whenever evidence is used,
  while keeping the immutable proof snapshot authoritative after finalization.

## Impact

- **Impact:** medium
- **Coupling:** coupled
- **Affected surfaces:** CLI, runtime state, evidence receipts, packets,
  installed commands, documentation, and deterministic tests
- **Security triggers:** execution-boundary classification for unattended agents

## Non-goals

- Enabling Allow All or any host permission bypass automatically.
- Treating a Git worktree or copied workspace as an OS security sandbox.
- Making prototypes, human approval, or cross-family review mandatory for all
  changes.
- Moving model invocation or an unbounded agent loop into the deterministic
  runtime.
- Claiming protection from an actor that can replace the runtime and every
  machine-owned state file; host-owned attestation remains a separate boundary.
