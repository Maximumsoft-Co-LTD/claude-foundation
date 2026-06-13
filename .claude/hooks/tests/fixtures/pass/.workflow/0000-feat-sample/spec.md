# Spec: Sample passing fixture

**ID**: 0000-feat-sample · **Type**: feat · **Status**: approved · **Ship as**: one-drop · **Open PR on ship**: no · **Parent**: none

## Outcome
- **Before:** the linter has no clean fixture to prove a complete run passes.
- **After:** this directory is a minimal, complete, placeholder-free run that the linter exits 0 on.
- **Benefit:** the fixtures test suite can assert the clean-pass verdict.

## Acceptance criteria
- [x] AC1: a complete spec with a Type slot and an acceptance section lints clean.
  - e.g.: running the linter on this directory exits 0.
  - on error / at boundary: none — this fixture is intentionally always clean.
