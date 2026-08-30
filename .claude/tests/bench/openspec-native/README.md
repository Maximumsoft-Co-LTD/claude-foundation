# OpenSpec-native efficiency benchmark

This is the current benchmark surface for the installed OpenSpec-native
Foundation runtime. It does not reuse the retired `.workflow/` runner in the
parent directory.

The runner records one
`foundation-openspec-native-scorecard-v1` JSON row per execution. Its trusted
speed value is the runner's monotonic wall-clock stopwatch. Claude's result
envelope duration is retained only as `hostEnvelopeDurationMs` because it may
exclude sub-agent time.

## Safety boundary

A live run refuses any project that does not contain both:

- an installed `.claude/harness/foundation.mjs`; and
- `.foundation-benchmark.json` containing `{ "disposable": true }`.

The runner never creates or deletes the project. Prepare a disposable project
explicitly:

```bash
BENCH_PROJECT="$(mktemp -d)"
./install.sh "$BENCH_PROJECT" --yes
printf '{"disposable":true}\n' > "$BENCH_PROJECT/.foundation-benchmark.json"
```

Do not add that marker to a real project.

## Live run

```bash
npm run bench:openspec-native -- \
  --scenario todolist-r2 \
  --project "$BENCH_PROJECT" \
  --prompt "/dev create app todolist" \
  --repeat 1 \
  --timeout-ms 1800000
```

Extra Claude arguments must be passed as repeated, literal `--claude-arg`
values. The runner does not enable a permission bypass itself.

The append-only scorecard defaults to
`.claude/tests/bench/results/openspec-native-scorecards.jsonl`. Per-run host
metadata, stderr, and the formatted scorecard are kept under
`results/openspec-native-runs/<run-id>/`. The results directory is ignored by
Git.

Live runs retain Claude's verbose `stream-json` as `host.stream.jsonl`. A
timeout can therefore keep observed browser and task-mirror counts even when
the final result envelope never arrives. Cost remains unavailable in that case;
the scorecard never guesses dollars from an external price table.

## Collection-only verification

Fixtures and recovered runs can be scored without launching Claude:

```bash
npm run bench:openspec-native -- \
  --collect-only \
  --scenario todolist-r2 \
  --project "$BENCH_PROJECT" \
  --change-id <change-id> \
  --run-id recovered-1 \
  --wall-ms <measured-wall-ms> \
  --output /tmp/native-scorecards.jsonl
```

If wall time, usage, cost, operations, or quality was not measured, the field
is `null` and its measurement state is `unavailable`; absence is never rendered
as zero. A run is complete only when the host completed, no tasks remain, and a
passing durable proof exists.

The schema is
[`../config/openspec-native-scorecard.schema.json`](../config/openspec-native-scorecard.schema.json).
Targets remain in
[`../config/openspec-native-targets.json`](../config/openspec-native-targets.json).

## Workload matrix and repeat gate

Do not tune only for the todolist sentinel. The release matrix must cover these
distinct control paths:

| Class | Representative work | Required terminal truth |
|---|---|---|
| Greenfield | CLI and browser app from an empty repository | Change never creates product code; Build and Prove complete |
| Brownfield | Focused bug fix with existing tests and architecture | Baseline digests remain strict; rapid lane stays rapid |
| Contract/data | Public API or persisted-format migration | Compatibility, rollback, and invariant evidence pass |
| Multi-repository | Producer/consumer contract change | Scoped leases, topology, and ordered proof complete |
| External authority | Deploy, secret, IAM, or human acceptance | One handoff, no polling, truthful waiting state |
| Long-running evidence | Integration/browser/provider command | External time is measured and no duplicate execution occurs |
| Resume/recovery | Timeout, crash, stale lock, or exhausted budget | Resume starts at the first incomplete operation |
| Non-code | Investigation or documentation-only request | No unnecessary Build/Prove lifecycle is invented |

Run one disposable sentinel first. Continue to paid repeats only when it reaches
its expected terminal state and reports walltime, usage, operation counts, and
quality without unknown fields that the comparison needs. Then use at least
three repeats per changed workload class; never ratchet from a timeout, a single
run, or two runs that selected materially different product surfaces.
