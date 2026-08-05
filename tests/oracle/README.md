# Runtime API oracles

Each schema-v2 JSON file is an executable compatibility baseline bound to the full Git
revision that introduced that runtime API:

- API 12: `9a54190cafddec6546a63acbc606a86480da8b74`
- API 13: `2e76097623e1ffdf145685dbcd59a127434cda33`

Current Foundation development must not be used to refresh an older baseline.

Regenerate and verify the committed fixture:

```sh
node scripts/oracle/capture-runtime-api.mjs --api 12 --output tests/oracle/runtime-api-12.json
node scripts/oracle/capture-runtime-api.mjs --api 13 --output tests/oracle/runtime-api-13.json
npm run test:oracle
npm run test:m9-slice1
```

Compare a Rust compatibility executable by replacing `--candidate-ref` with
`--candidate-bin target/debug/cloop`. Use repeatable `--candidate-prefix <arg>`
arguments when an adapter needs arguments before each fixture command. The
runner compares exit status, stdout, stderr, and selected post-command filesystem
state. JSON state is compared semantically after sorting object keys. Canonical
working-directory paths, timestamps, snapshot IDs, SHA-256 values, and file counts
are normalized because they are intentionally machine- or checkout-dependent;
all other output remains byte-exact.

The final three scenarios exercise repository topology, active runtime-state
projection, relevant-workspace hashing, and snapshot persistence. The Rust
candidate uses `cloop legacy-runtime --api 12|13` so modern public commands retain
their Changeloop contracts while the one-major-version migration adapter remains
explicit.

M9 parity slice 3 uses `m9-parity-slice-3.json` to run the Node reference and
Rust candidate against identical authority-denial, telemetry-unknown, Land
conflict, rollback, and recovery expectations:

```sh
npm run test:m9-slice3
```

The comprehensive M9 gate supersedes the individual slices in CI. It executes
the 18 pinned API 12/13 cases plus 29 exact semantic fixtures for evidence,
policy, lifecycle/review, snapshots, telemetry, transactional Land and archive:

```sh
npm run test:m9-parity
```

`m9-coverage.json` maps each case to its Node Foundation API, Rust API and
protected invariant, and records the external/platform behaviors that cannot be
represented honestly by a deterministic language differential. JSON object key
order is canonicalized; exit status, stderr and non-JSON stdout remain exact.
