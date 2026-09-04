# Multi-repository runtime binding remediation

**Date:** 2026-09-04  
**Status:** Implemented and deterministically verified on the working tree  
**Scope:** post-v3.5.4 source cohort, without creating an OpenSpec change

This follow-up records the repo-wide bug review requested after the harness
simplification release. Canonical behavior lives in [WORKFLOW.md](../../WORKFLOW.md)
and the compiled OpenSpec packet remains the agreement source of truth.

## Outcome

The declared repository selection now controls the lifecycle from Build through
Land. A change selecting one non-root child is composite even when the root has
no product writes. Once isolated, every selected child must retain one complete
runtime binding: workspace path, catalog target, access mode, and base head.
The runtime never substitutes the live checkout when that binding is missing.

The user-facing commands remain `/investigate`, `/change`, `/build`, `/prove`,
`/land`, and `/dev`. Users gain no manual protocol step. The agent follows the
same `advance --through build|proven|archived` route and uses the recovery action
returned by the harness.

## Findings fixed

| Failure shape | Prior risk | Resolution |
|---|---|---|
| Missing isolated child record | Selection could fall back to the live target | Validate the runtime record before resolving a selected child |
| Root-only snapshot fallback | A declared child could disappear from proof identity before runtime rows existed | Decide composite snapshots from declared selection |
| Missing or invalid worktree | Provider readiness did not independently reject every selected isolated repository | Report repository infrastructure failure before provider execution |
| Divergent base-head readers | Changed surface, review packet, and provider manifest could describe different bases | Centralize mode-aware base binding in the runtime core |
| Runtime record count used as topology | A single child or missing record could take root-only Apply/Land paths | Classify composite scope from any declared non-root selection |
| Incomplete inspect output | Selected-but-unrecorded and invalid worktrees were invisible | Report union of declared and recorded rows with typed status |
| Inspection invoked `git` from `PATH` | A repository-controlled executable could run during a read-only diagnostic | Resolve inspection selection without spawning Git |
| External arbitrary directory passed doctor | A moving dependency could be treated as pinnable | Require every selected external repository to be Git initialized |
| Partial child binding had no executable repair | The advertised recreate route stopped on the existing root sandbox | Make `sandbox create <change> --all` recover existing canonical worktrees and create only missing children |
| Git-valid path was accepted without repository ownership | A worktree from another repository could masquerade as the selected child | Compare common Git directories for the worktree and catalog target before selection or proof |
| Proof hashed before repository health | A missing child could throw before typed recovery was constructed | Inspect repository infrastructure first and return the existing sandbox repair command |
| `advance` swallowed or leaked dependency failures | Agents received a generic diagnosis or a process failure; a progressing chain also stopped after 32 cycles | Preserve exact failures in the six-action envelope and converge on semantic progress rather than a fixed count |

## Recovery contract

For an incomplete isolated selection, run:

```bash
claude-foundation sandbox inspect <change>
```

Preserve recoverable work, then repair or recreate the binding through the
existing command:

```bash
claude-foundation sandbox create <change> --all
```

It reconstructs a missing record for a canonical owned worktree and creates
only children that are actually absent. A foreign or non-canonical worktree is
left untouched for inspection. If the change cannot be recovered, retire it
explicitly with `change abandon`; do not delete machine state or continue with a
partial repository set. This is an infrastructure boundary, not a request for
new product intent.

Proof in a current pre-isolation workspace remains compatible. The stricter
rule activates when isolated state claims a child binding, and at Apply/Land
where a non-root selection must use the composite transaction path. This avoids
adding a blocking turn to evidence-only flows while preserving Build and Land
isolation.

## Regression ownership

The fixes have focused unit and integration coverage across repository topology,
snapshot identity, provider infrastructure, review packets, Apply, Land,
inspection, diagnostics, installer compatibility, and documentation. The
`SEM-LIFECYCLE-SAFETY` suite now carries 22 exact mutants. The added cases kill
regressions in worktree ownership, pre-hash infrastructure routing, partial
sandbox recovery, exact `advance` failures, and progress-based convergence
while retaining the preceding lifecycle-safety cases.

## Verification result

| Gate | Result |
|---|---|
| Focused runtime regressions | PASS; advance, topology, infrastructure, readiness, sandbox, and inspection tests |
| Multi-repository integration contract | PASS; 135/135 assertions, including action-envelope and in-place binding recovery |
| Full authoritative harness suite | PASS; 198/198 shared suites completed |
| `SEM-LIFECYCLE-SAFETY` | PASS; 22/22 exact mutants killed |
| OpenSpec strict validation | PASS; 21/21 items |
| Bilingual documentation consistency | PASS; 132/132 assertions |
| Website production build | PASS; 37 pages |
| `git diff --check` | PASS |

No paid model scenario, commit, tag, publication, or release is part of this
remediation without separate authority.
