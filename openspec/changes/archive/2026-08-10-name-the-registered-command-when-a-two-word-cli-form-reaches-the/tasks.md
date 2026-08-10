# Tasks

> This is the sole implementation ledger.

- [x] **T001** an unregistered command whose next word completes a real public command name fails naming the accepting CLI and the internal token, looked up in the registry rather than derived by rule — `.claude/harness/foundation.mjs` — verify: `sh .claude/tests/harness/run-changeloop-seam-tests.sh` [claims:a-public-two-word-form-names-its-internal-command] [repo:root] [paths:.claude/harness/foundation.mjs]
- [x] **T002** a genuinely unknown command still fails in one plain line and suggests nothing — `.claude/tests/harness/run-changeloop-seam-tests.sh` — verify: `sh .claude/tests/harness/run-changeloop-seam-tests.sh` [claims:an-unknown-command-invents-no-internal-name] [repo:root] [paths:.claude/tests/harness/run-changeloop-seam-tests.sh]
