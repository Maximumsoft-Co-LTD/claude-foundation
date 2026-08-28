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
