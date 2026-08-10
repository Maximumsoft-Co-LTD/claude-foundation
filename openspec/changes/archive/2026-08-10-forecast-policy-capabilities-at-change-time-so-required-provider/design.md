# Design

## Current state

- `policyAnalysis(id)` (`runtime/workflow/packet-runtime.mjs`) built `files`
  from `canonicalChangedSurface(id, state)`, dropped anything under
  `openspec/changes/`, then walked a literal `defaults` rule table plus
  `.foundation/policy.json` rules, memoizing per change in `policyCache`.
- The rules were already a pure function of a path list. Nothing in the table
  consults change state, the filesystem, or git — the only reason they could
  not run at change time is that their *input* came from files that changed.
- `doctor --stage change` already printed a `policy-capabilities` check at
  `level: "info"`. At change time it printed `none inferred from changed
  surface`: accurate, and useless.
- `reviewPolicy` (`evidence-contract.mjs`) unions
  `state.evidenceCapabilities`, the contract's claim capabilities, and
  `policyCapabilities(id)`. Its review-forcing list and its diversity list were
  inline literals.
- `contractFingerprint` hashes `reviewPolicy`'s whole return object. Its
  comment is explicit that a project which never opts into a waiver must keep
  producing the byte-identical shape, or upgrading Foundation re-fingerprints
  every in-flight change.
- `change resolve` parses with `parseStrictCommandFlags`, so a new flag must be
  added to the schema in `cli-router.mjs` or it is rejected outright.

## Decisions

- **Decision:** Extract the rule table into `capabilitiesForPaths(paths)` and
  have `policyAnalysis` call it with the changed surface.
  - **Why:** The forecast must not be a second copy of the rules. Two tables
    would drift, and a forecast that disagrees with enforcement is worse than
    no forecast — it teaches the author to distrust it.
  - **Rejected:** A separate forecast rule table tuned for globs. Cheaper to
    write, guaranteed to drift.

- **Decision:** The `openspec/changes/` filter moves inside
  `capabilitiesForPaths`.
  - **Why:** "A change's own packet never pulls a capability" is a property of
    the rules, not of how the path list was obtained. Both callers need it.
  - **Rejected:** Filtering in each caller. Duplicates a rule that must not
    diverge.

- **Decision:** Match the rules against both the literal declared glob and the
  repository files that glob expands to, and union the result.
  - **Why:** The two useful declarations fail in opposite directions. A
    forecast for a file that does not exist yet (`web/app/page.tsx`) only
    matches literally; a broad directory glob (`web/**`) only matches through
    expansion. Taking either alone silently under-forecasts, which is the exact
    failure this change exists to remove.
  - **Rejected:** Expansion only — cannot see new files, which is most of what
    a change adds. Literal only — cannot see `web/**`.

- **Decision:** Expansion and matching live beside the rule table in
  `packet-runtime`, behind one `forecastCapabilities(globs)` entry point, not
  in the command that first needed them.
  - **Why:** Two commands warn about the same declared surface. Building the
    walk inside `doctor` left `validate` matching only literal globs, so the
    two disagreed about the same input on the first try. One entry point makes
    that class of disagreement unrepresentable.
  - **Rejected:** A helper local to diagnostics. It is where the first caller
    lived, not where the behavior belongs.

- **Decision:** Surface is declared explicitly via `resolve --surface`, never
  inferred from the intent text.
  - **Why:** `change-lifecycle` already carries the scar of inferring policy
    from prose: `includes("access")` fired on "accessibility". A wrong forecast
    the author did not write is a support burden with no owner.
  - **Rejected:** Deriving globs from `tasks.md` `[paths:]`. Those exist only
    after planning, which is after the point where the forecast pays.

- **Decision:** Forecast warns; it never fails a command or gates a phase.
  - **Why:** A forecast is a prediction about files that do not exist. Making
    it binding would let a mis-declared surface *reduce* required evidence,
    turning a cost optimization into an evidence hole. Enforcement stays with
    `policyAnalysis` over the real changed surface at Prove.
  - **Rejected:** Failing validate on a gap. Converts an advisory into a
    blocker that authors would route around by declaring nothing.

- **Decision:** Export the review capability lists as frozen module constants
  and read them from both `reviewPolicy` and the forecast, leaving
  `reviewPolicy`'s return value untouched.
  - **Why:** The forecast needs to answer "will this need a reviewer?" from the
    same lists, but `contractFingerprint` hashes `reviewPolicy`'s output. A
    shared constant gives one source of truth at zero fingerprint risk.
  - **Rejected:** Extending `reviewPolicy` with a forecast field.
    Re-fingerprints every in-flight change.

- **Decision:** Bound the walk to the static prefix of each declared glob, with
  a hard entry cap.
  - **Why:** `doctor` runs constantly. A declared surface must never turn it
    into a whole-repository scan, and an author who declares `**` should pay a
    truncated forecast rather than a hang.
  - **Rejected:** Walking from the repository root and filtering. Same answer,
    unbounded cost.

## Compatibility and migration

- `state.declaredSurface` is new, optional, and absent on every existing
  change. Every code path treats absent as "no forecast": no `surface:` line in
  `RESOLVED`, no forecast rows in `doctor`, no warning in `validate`. Output is
  byte-identical to a runtime without this feature.
- `doctor --json` gains rows in its existing `checks` array. The array is
  already heterogeneous and consumers read it by `name`, so its `version: 1`
  shape is unchanged and no bump is warranted.
- No protocol pin moves. `reviewPolicy`'s output, the evidence schema, the
  packet schema, and every provider contract are untouched — which is the
  point of the constant-extraction decision above.
- Rollback is deleting the check, the flag, and the flag-schema entry; a stale
  `declaredSurface` in runtime state is simply ignored.

## Risks

| Risk | Mitigation | Evidence owner |
|---|---|---|
| Extracted rule table changes inference behavior | The full suite re-runs the unchanged `policyAnalysis` path, and a forecast test pins that declaring a surface leaves `policy-capabilities` reading real changed files | test |
| Forecast is trusted as enforcement and a mis-declared surface hides a required capability | Pin that `policy-capabilities` is unaffected by `declaredSurface` | test |
| Two commands forecast differently for the same surface | One `forecastCapabilities` entry point; both callers go through it | test |
| `reviewPolicy` output drifts and re-fingerprints in-flight changes | Lists hoisted to constants with no change to the returned object | test |
| Glob expansion walks a large repository on every doctor run | Walk bounded to each glob's static prefix with a 5000-entry cap | test |
