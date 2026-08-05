# Quality and performance baseline methodology

Status: M0 measurement contract

Last updated: 2026-08-04

## Baseline, not benchmark claims

This document defines how Changeloop establishes and compares baselines. It does
not claim that any roadmap performance gate currently passes. Results become
evidence only when a committed or release-attached run record contains the exact
revision, environment, workload, raw samples, and verification status described
below.

The current deterministic baseline consists of:

- `.claude/tests/run-all.sh`, whose suites cover harness, installer, hooks,
  context budgets, concurrency, upgrade compatibility, and other Foundation
  invariants listed in `.claude/tests/README.md`;
- `tests/oracle/runtime-api-12.json`, pinned to Foundation revision
  `9a54190cafddec6546a63acbc606a86480da8b74` and compared exactly by
  `scripts/oracle/differential-runner.mjs`;
- `tests/oracle/runtime-api-13.json`, pinned to Foundation revision
  `2e76097623e1ffdf145685dbcd59a127434cda33`, together with the live checkout's
  API declaration in `.claude/harness/protocol.json` and write-compatibility
  check in `cli.sh`;
- workspace Rust tests and generated-type checks as they are introduced.

The historical `.claude/tests/bench/` runner targets the retired `.workflow/`
orchestrator and explicitly is not current release evidence. Its lessons about
deterministic oracles, answer-key isolation, request-level token deduplication,
variance, and stale comparisons inform this method; its stored scores are not a
Changeloop baseline.

## Reproducible run record

Every baseline run writes a versioned JSON record plus raw sample artifacts. The
record includes:

- Git revision, dirty-tree digest, build profile, Rust/Node versions, lockfile
  hashes, feature flags, protocol/database versions, and executable hash;
- OS/kernel, architecture, CPU model and logical count, physical memory,
  filesystem type, power mode, thermal state when available, and whether the run
  is bare metal, VM, or CI;
- workload/corpus version and hashes, provider/model snapshot for live runs,
  pricing-catalog version, and redaction profile;
- warm-up count, measured repetitions, sample order/randomization seed,
  concurrency, timeout, and isolation settings;
- every raw duration/count/byte/cost observation, exclusions with reasons, and
  median, p95, dispersion, and confidence interval where applicable;
- process exit status, correctness gate, resource-leak result, and the exact
  command needed to reproduce the run.

Wall time uses a monotonic clock around the user-visible operation. CPU and
resident memory come from an OS-level process-tree sampler. Event latency is
measured at enqueue and client receipt using the same monotonic clock. Provider
overhead requires router timestamps around the same upstream request and excludes
declared retry/backoff time. Never infer child usage from a top-level provider
envelope.

The first reference-machine record defines the named reference machine; this
document does not invent its hardware. Changing hardware, OS major version,
compiler profile, or storage class creates a new baseline series rather than
silently replacing the reference.

## Correctness before speed

A performance sample is valid only if its functional oracle passes. Crashes,
timeouts, proof failures, dropped events, replay mismatches, or missing accounting
are recorded as failures and excluded from latency percentiles; the report shows
both failure count and valid-sample count. Excluding a slow but correct observation
requires a predeclared environmental reason and preserves the raw sample.

Run on a clean checkout with isolated config/data/runtime directories and no
production credentials. Pin dependencies and workload hashes. Disable unrelated
scheduled work where the reference protocol allows it, record warm/cold cache
state, and run comparison revisions in interleaved order to limit thermal and
time-of-day bias.

## Roadmap performance gates

### CLI help/status startup under 250 ms warm

Measure executable invocation through complete stdout flush and exit for
`cloop --help` and `cloop status`. Prime executable/library and relevant read-only data
caches with five unmeasured runs, then collect at least 30 samples per command.
Both command medians and p95 are reported; the gate uses p95 under 250 ms on the
reference machine. `status` uses a fixed quiescent fixture database and no
provider/network call.

### TUI ready under 750 ms

Use a pseudo-terminal and define ready as the first complete, keyboard-responsive
frame carrying a ready event. Exclude provider authentication by using a local
authenticated fixture profile. After five warm-ups, collect at least 30 samples;
the p95 must be under 750 ms. A painted but non-interactive frame does not count.

### Local event relay p95 under 50 ms

Send a deterministic mix of message-part, lifecycle, and job events over each
MVP local transport, timestamping server enqueue and client callback. Run at idle
and at the declared steady-state concurrency with at least 10,000 events per
transport. Report p50/p95/p99, queue depth, and dropped/backpressured events. The
gate is p95 below 50 ms with zero silent drops.

### Graceful shutdown under two seconds

For idle, streaming-provider, child-agent, PTY/job, LSP, and backpressured-client
fixtures, request shutdown and measure until processes exit, locks release,
pending requests receive terminal states, and durable data is flushed. Use at
least 20 repetitions per state. Every valid case must finish within two seconds;
forced cleanup after that is a recorded gate failure, not graceful success.

### Eight-hour bounded-growth soak

Run the declared mixed workload for at least eight hours with conversations,
mutations in disposable worktrees, reconnects, child cancellation, jobs, and
project creation/disposal. Sample RSS, open files, processes, tasks, queue depth,
SQLite/WAL size, event rows, and artifact bytes at a fixed interval. All queues
and retention stores have configured caps or compaction behavior. Pass requires
no orphan resources, no silent event loss, and no unbounded post-steady-state
growth; the report states the numeric caps and fitted growth slope rather than
using visual inspection alone.

### Provider router overhead below 5%

Use the hermetic replay server with controlled upstream delays spanning short and
long responses, streaming and non-streaming, tools, and large payloads. Measure
paired direct-adapter and routed requests in randomized order. Router overhead is
`(routed wall - upstream fixture wall) / upstream fixture wall`; deliberate retry
and backoff intervals are subtracted and reported separately. Require correctness
first and report distributions by case. The aggregate gate uses total paired
wall time and must remain below 5%; no case may hide a pathological absolute
delay, so per-case deltas are retained.

The hermetic probe records a versioned per-case matrix for OpenAI and Anthropic:
short and long text responses, tool calls, large payloads, streaming delivery
and non-streaming delivery. Every case needs 30 paired direct/routed samples,
identical normalized events and a recomputed ratio below 5%; missing,
duplicated, unsupported or self-reported cases fail release assessment. The MVP
native adapters currently request SSE only, so both non-streaming cases are
reported as explicit coverage gaps and the matrix remains diagnostic. These
fixtures isolate local router overhead and must never be described as upstream
provider performance.

### Replay 10,000 events under two seconds

Populate a fixed database with the versioned 10,000-event fixture, restart the
server, connect from a cursor immediately before the fixture, and measure until
the client validates the last event ID. Run cold and warm variants with at least
20 samples each; the roadmap gate applies to p95 on the named reference-machine
variant. Verify exact count/order, bounded client/server memory, and zero duplicate
delivery at the application layer.

## Agent quality evaluation

Quality workloads are versioned repositories with hidden deterministic oracles,
declared risk/scope, proof requirements, and a maximum operation budget. They
span clean/dirty worktrees, language ecosystems, task sizes, migrations,
concurrency, security boundaries, and failure recovery. Prompts never contain or
expose hidden acceptance data to either arm.

For each run record:

- task completion and executable proof result;
- regression count and unnecessary-diff bytes/files;
- tool calls by class and failed/repeated calls;
- repair cycles, repeated-cause and doom-loop outcomes;
- input/output/cache/reasoning tokens with completeness flags, cost, and catalog;
- wall time and time to first useful edit;
- child-agent accepted contribution, conflicts, latency, tokens, and unused work;
- permission, provenance, lifecycle, secret, and repository-scope violations.

Deterministic tests and acceptance oracles decide correctness wherever possible.
A model judge is secondary, pinned separately from the executing model, blind to
arm identity, and never overrides a deterministic failure. Report results per
task/provider/risk tier plus aggregate distributions; never collapse blocked,
infrastructure, authority-required, and incorrect outcomes into one failure rate.

Run identical workloads without children where safe to quantify subagent
contribution versus overhead. Cross-provider comparisons use capability-matched
profiles and disclose unavailable features rather than silently lowering the
risk tier. Use at least five repetitions for stochastic model runs initially;
increase repetitions until the predeclared confidence target can resolve the
minimum effect of interest. A single run is diagnostic, not a baseline.

## Comparison and regression policy

Before/after runs use the same reference series, workload hashes, configuration,
and pricing catalog, with interleaved sample order. Compare correctness and safety
first, then latency/cost. A faster or cheaper revision with a new deterministic
failure, evidence gap, or authority violation is a regression regardless of its
aggregate score.

Publish raw samples, summaries, exclusions, and environment manifest locally or
as redacted release artifacts. Mark provider-live results with capture time and
usage completeness. Do not overwrite a baseline: append a new run linked to its
predecessor. Any threshold or workload change requires a reviewed version bump
and cannot retroactively turn a failed release into a pass.

## M0 completion and later release evidence

M0 completes when the schemas/runner can create a reproducible record, the
current deterministic harness and API 12/API 13 oracles are named as
compatibility baselines, and the first reference-machine run is scheduled.
Numeric roadmap gates become release evidence only after those measurements
exist. GA additionally requires all functional/security, compatibility-matrix,
soak, release-supply-chain, and quality gates in `docs/roadmap.md`; this
methodology does not narrow them.

## Local reproducible runner

`scripts/performance/run.mjs` writes the version-2 local run record described
above. A short diagnostic smoke run is intentionally the default:

```bash
rtk node scripts/performance/run.mjs --mode smoke
```

The runner builds release binaries, uses an isolated configuration directory,
captures raw samples and environment/revision metadata, and writes its record
under `target/performance/`. Its JSON schema is
`tests/performance/run-record.schema.json`. It exercises warm CLI help/status,
keyboard-responsive TUI readiness in a real pseudo-terminal, ordered SQLite
replay, local transport relay, explicit full-queue backpressure, delayed
hermetic provider-router overhead, graceful cancellation
of provider, child-session, PTY/background-job, project-owned LSP and
backpressured-client fixtures, durable recovery of interrupted SQLite-owned
operations, and a configurable storage replay soak.

Release sampling makes the eight-hour duration explicit:

```bash
rtk node scripts/performance/run.mjs --mode release --confirm-8h \
  --reference-machine-id <machine-id> --reference-series <series-id>
```

Both reference identifiers are mandatory, validated stable identifiers. A
release record without them is rejected even if every numeric threshold passes.
The replay probe includes distinct cold and warm process-reopen variants with
per-child RSS-growth sampling. The transport probe includes idle and four-client
steady-concurrency variants for stdio, Unix sockets and HTTP+SSE, records actual
page-buffer depth/capacity, and verifies the bounded client queue's backpressure
signal. Shutdown includes an idle state plus all active resource states. The
router adapters still lack native non-streaming cases; the two source-frozen
eight-hour soaks and named reference-machine run are also external release work.
Those gaps keep current runs diagnostic rather than release evidence.

Neither mode automatically promotes its output to GA evidence. A release-count
run with shortened soak remains diagnostic, and the soak does not yet sample
the full mixed workload, RSS, open files, child process counts, WAL/artifact
retention and post-steady-state growth slope for eight hours. The record keeps
`roadmapPerformanceGatesComplete` and `releaseEvidence` false. A shorter release
diagnostic can use `--soak-seconds N`; it is never reported as an eight-hour
result.

The standalone `mixed-soak-v2.mjs` runner executes all eleven workloads each
cycle. Six bounded hermetic fixtures verify read-only conversation authority,
snapshot mutation/undo in a disposable worktree, SQLite reconnect/cursor replay,
child cancellation/resource release, background/PTY job cancellation and
project create/dispose. Each fixture has a two-second internal deadline; its
process has a three-second watchdog, captured output is capped at 64 KiB, and a
run counts as successful only after the runner validates its typed semantic
result. The remaining queue, relay, router, shutdown and status workloads keep
their existing bounds. Resource sampling, process-group orphan detection and
isolated temporary state apply to every cycle.

The current cycle starts eleven child processes. Its deliberate router delay
matrix contributes about 9.6 seconds of fixture time per cycle; the six mixed
fixtures normally complete well below their two-second limit. Declared
per-process-tree caps remain 512 MiB RSS and 256 file descriptors, with at most
64 KiB fixture-directory growth. The record retains actual cycle count, elapsed
time and resource maxima rather than estimating an eight-hour result from this
cost model.

`node scripts/performance/mixed-soak-v2.mjs --integration <output>` runs one
diagnostic cycle; `--integration-cycles 3 <output>` repeats the complete matrix
to expose immediate RSS, descriptor or orphan trends. Neither mode can qualify
as release evidence. Records include least-squares RSS and descriptor slopes;
the short diagnostic limits are 2,048 KiB/cycle and one descriptor/cycle, while
the absolute caps still apply. Release assessment
still requires at least 100 fully successful cycles across eight hours in
`soak` mode, plus unchanged source/executable/runner integrity; setting
`releaseEligible` or `coverageComplete` in an incomplete record cannot bypass
those checks.

Run records are serialized before publication, written to an exclusive 0600
same-filesystem staging file, fsynced, atomically renamed and followed by a
directory fsync. Staging directories are removed on every exit path. Missing,
truncated or invalid JSON is represented as failed evidence input and cannot be
promoted by the assessor.

Source-freeze identity uses Git's NUL-delimited byte inventory and hashes files
through a fixed 64 KiB buffer. It never UTF-8-decodes repository paths or follows
symlinks; symlink target bytes are identity data. It rejects unsupported entry
types, mutation during hashing, more than 1,000,000 entries, an inventory over
64 MiB, a file over 512 MiB or more than 8 GiB total source bytes. These bounds
fail the evidence run explicitly instead of silently omitting repository data.
