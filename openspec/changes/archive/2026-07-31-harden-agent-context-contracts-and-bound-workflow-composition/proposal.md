# Change: Harden agent context contracts and bound workflow composition

## Why

The context-budget work reduced static prompts but adversarial review found
machine-output, resume, authority, upgrade, scaling, and telemetry gaps. Large
brownfield packets can still fail instead of compacting; task packets can lose
all claims; installed legacy defaults keep the old 64 KiB budget; and the hot
auth skill bundle remains large. These gaps must be closed without weakening
the proof-integrity behavior already delivered.

## What changes

- Make agent/packet output parseable, scoped, resumable, dispatch-safe, and
  bounded by the bytes actually emitted.
- Compact large task, claim, provider, repository, and conflict collections
  into previews, digests, and artifact references.
- Make context telemetry non-blocking and upgrade legacy packet policy safely.
- Route mixed-model work honestly and bound combined skill context while
  restoring load-bearing command semantics.

## Impact

- **Impact:** high
- **Coupling:** coupled
- **Affected surfaces:** runtime CLI, packet/plan schemas, installer policy,
  telemetry, commands, rules, skills, documentation, tests
- **Security triggers:** evidence and task authority

## Non-goals

- Removing required evidence or lowering a risk-triggered model tier.
- Installing application dependencies or committing/pushing user repositories.
- Reworking provider protocols unrelated to context/authority.
