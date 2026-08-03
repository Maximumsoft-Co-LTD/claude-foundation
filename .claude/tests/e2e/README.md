# Historical live E2E runner

`run-e2e.sh` targets the retired `.workflow/` phase orchestrator. It expects
legacy templates and artifact linting that are not shipped by Runtime API 8.
Do not use its live mode as release evidence for the OpenSpec-native product.

Current product contracts remain in `.claude/tests/run-all.sh`. Consumer-level
speed, quality, cost, and feedback-boundary measurements belong in the separate
`claude-foundation-lab` repository.
