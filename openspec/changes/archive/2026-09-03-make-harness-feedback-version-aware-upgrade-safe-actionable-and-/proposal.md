# Change: Make harness feedback version-aware and upgrade-safe

## Why

Three real user runs showed that useful safety gates were difficult to diagnose, historical defaults survived upgrades without enough context, budgets were poorly calibrated, and delivered code could diverge from the harness lifecycle. The harness must distinguish old behavior from current behavior and give one exact recovery path without weakening proof or authority.

## What changes

- Bind metrics and generated feedback reports to the exact Foundation source cohort rather than a semantic version alone.
- Detect known legacy-default drift during install, update, and doctor flows and provide a previewable, explicit migration route for supported active changes.
- Persist redacted typed blocker cause and recovery data, and reject critical-case provider wiring before Build when the selected adapter cannot produce the required observations.
- Derive request and token budgets from the compiled execution surface and detect out-of-band delivery without treating it as proof, authority, or archive completion.

## Impact

- **Impact:** high
- **Coupling:** coupled
- **Affected surfaces:** runtime telemetry and metrics, installer and upgrade diagnostics, evidence validation, budget and Land diagnostics
- **Security triggers:** privacy, public-compatibility

## Non-goals

- Automatically update installations, overwrite project-owned policy, edit machine-owned proof, or infer user authority.
- Prevent Git commits, pushes, deployments, or pull requests performed outside Change Loop.
- Estimate missing provider cost or convert unavailable measurements into zero.
- Change public command names or require existing active changes to rewrite their OpenSpec agreement.
