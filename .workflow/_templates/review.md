# Review: <title>

**Plan**: [./plan.md](./plan.md)
**Spec**: [./spec.md](./spec.md)
**Reviewed**: YYYY-MM-DD
**Verdict**: pass | fix-required
**Cycle**: 1 of max 2

## Plan adherence
One row per plan step. No skipping rows. Deviation needs a one-line reason.

- [x] Step 1 — implemented as planned
- [ ] Step 2 — deviation: <what + why>

## Acceptance-criteria check
One row per `spec.md > Acceptance criteria` bullet. `engineer` is expected to have ticked these already; `lead` re-verifies against the diff and the running code.

- [ ] Criterion 1 — evidence: `path:line` / behaviour observed
- [ ] Criterion 2 — evidence: ...

Any criterion that cannot be ticked here is a **blocking** finding.

## Per-agent findings
(present only when fanout ran; omit for single-reviewer runs)

One `### team-<role>` subsection per worker dispatched in the review-mode fanout (see `.claude/skills/fanout-team-agents/SKILL.md`). Each subsection holds the worker's raw findings (bullets, `path:line`). `lead`'s synthesis sits in `Findings` below; this section is the evidence trail.

**Mandatory provenance line.** The first line of every `### team-<role>` subsection MUST be `**Dispatched-as**: <subagent_type> (<reason-if-fallback>)`. The orchestrator captures each `Agent` invocation's actual `subagent_type` at dispatch time and passes the `Dispatched-as:` map into the synthesis prompt (see `.claude/orchestrator.md > Fanout dispatch > Re-spawn for synthesis`). Without this line a reader cannot distinguish a real `team-<role>` dispatch from the inline-fallback path (`subagent_type="general-purpose"`, role-contract read inline) — both produce byte-identical artifact shapes.

### team-code-reviewer
**Dispatched-as**: `team-code-reviewer` (or `general-purpose` with a one-phrase reason if fallback fired)
- `path:line` — finding

### team-code-simplifier
**Dispatched-as**: `team-code-simplifier` (or `general-purpose` with a one-phrase reason if fallback fired)
- `path:line` — finding

### team-comment-analyzer
**Dispatched-as**: `team-comment-analyzer` (or `general-purpose` with a one-phrase reason if fallback fired)
- `path:line` — finding

### team-pr-test-analyzer
**Dispatched-as**: `team-pr-test-analyzer` (or `general-purpose` with a one-phrase reason if fallback fired)
- `path:line` — finding

### team-silent-failure-hunter
**Dispatched-as**: `team-silent-failure-hunter` (or `general-purpose` with a one-phrase reason if fallback fired)
- `path:line` — finding

### team-type-design-analyzer
**Dispatched-as**: `team-type-design-analyzer` (or `general-purpose` with a one-phrase reason if fallback fired)
- `path:line` — finding

## Findings

### Blocking
- `path:line` — issue → suggested fix

### Non-blocking
- `path:line` — note (carried to retro)

## Sign-off
pass | needs-another-round → see Phase 2 step 5
