# Change: forecast policy capabilities at change time so required providers are declared before Build

## Why

`policyAnalysis` infers required capabilities from `canonicalChangedSurface` —
the files a change has *already* modified. At `/change` nothing has been
modified yet, so `doctor --stage change` reports `none inferred from changed
surface` and the author signs an evidence contract that policy will later
widen.

The cost is measured. A run audit of a consumer project
(`scaffold-walking-skeleton`, Foundation 3.2.4) finished at **566 requests
against a budget of 160 — 354%** — while tokens ran to only 123% of theirs.
That gap is the whole finding: the overrun was not thinking or writing code,
it was short repeated loops. Evidence execution across eleven providers took
1m46s of a 3h53m run.

Two escalations drove it, and both were knowable before a line was written:

- Touching a `.tsx` file pulled `accessibility`; touching a lockfile pulled
  `dependency-supply-chain`. Each new provider invalidated the whole collected
  evidence set — 5 collect rounds.
- `reviewPolicy` consults `policyCapabilities` too, so a late capability also
  expired the human review signature — 5 review requests for one change.

Nothing about this is a wrong rule. The rules are right; they simply arrive
too late to act on. An author who knew at `/change` that `.tsx` was in scope
would have declared the provider once instead of re-earning evidence twice.

## What changes

- The capability rule table becomes a pure function over a list of paths,
  callable with paths that do not exist yet. `policyAnalysis` keeps calling it
  with the changed surface, so inference is unchanged.
- `change resolve` accepts `--surface <glob,…>`, recording the paths the author
  expects to touch. Declaring nothing keeps today's behavior exactly.
- `doctor --stage change` reports the capabilities that declared surface will
  pull, names the glob that pulls each one, and warns for any that the evidence
  contract does not yet declare a provider for.
- The same check states whether that forecast will require an independent
  reviewer and whether diversity will be demanded, so a signature is not spent
  before the contract stops moving.
- `change validate` warns — never fails — when forecast and declared providers
  disagree, because a forecast is a prediction and the contract stays the
  author's.

## Impact

- **Impact:** medium
- **Coupling:** isolated
- **Affected surfaces:** capability inference (`packet-runtime`), change
  classification (`change-lifecycle`), `change resolve` flag schema,
  `doctor --stage change` output, `change validate` warnings, command registry
- **Security triggers:** none. Forecasting is read-only and advisory: it adds
  no path by which a change can acquire *fewer* capabilities than the changed
  surface demands at Prove. The enforcing call is still `policyAnalysis` over
  real files.

## Non-goals

- Changing which capabilities any rule infers, or the rule table itself.
- Making a forecast binding. Prove still enforces from the real changed
  surface; a wrong forecast must never let a change through with less
  evidence.
- Changing `reviewPolicy`'s return shape. `contractFingerprint` hashes it, so
  altering it would re-fingerprint every in-flight change and invalidate
  evidence nobody asked to re-earn.
- Inferring surface automatically from the intent text. The author declares it.
