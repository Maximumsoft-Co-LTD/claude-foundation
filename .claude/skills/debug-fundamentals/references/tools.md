# Diagnostic tools and multi-hop incidents

Make the system tell you what it did instead of reasoning about what it should
do. Use the lightest tool that answers; move down a layer only when the layer
above cannot see the fault.

## Tool ladder

| Tool | Reach for it when | Note |
|---|---|---|
| Print / log at boundaries | Most bugs; "which value, which invocation?" | Print existence → identity → type → shape → value; tag every line (`[chargeOrder] after validate:`) |
| Structured log (JSON, `request_id`, `event`) | Filtering one request's path across many lines | Follow the codebase's conventions; add them only when the bug is cross-cutting |
| Debugger (conditional breakpoint, logpoint, watch) | Rich nested state, stepping through a decision | No interactive UI: dense structured prints at each step instead |
| Distributed tracing (OTel, Jaeger) | Bug crosses service boundaries | Missing attribute (order id, payload size)? Add it — cheapest high-value fix |
| System level (`strace`, `tcpdump`, eBPF, `lsof`) | App says success but nothing happened; timeouts, DNS, EAGAIN loops | Below the app layer |
| Production instrumentation | No local repro | Ship an instrumented build, wait for the next occurrence; a fix without repro is a guess |

Rules that save the most time:

- Print at the boundaries of the suspect region. Boundary values right → bug is
  inside; wrong → outside (bisection in miniature).
- Log before the throw, not after; log the error branch, not only the happy path.
- Capture values, do not just hover; the bug is often the pattern across calls.
- Debug logs are debt: delete them after the regression test passes, or promote
  the useful boundary events to the project logger.

## Multi-hop incidents

Single-process bugs are about *what*; distributed bugs about *when*, *where*,
and *in what order*. First move: get one correlation id (`X-Request-Id`, OTel
`traceparent`) through every service and log line; if none exists, add it before
continuing. Then pull every line for one failing id, sort by time, and walk
forward — the first surprise is where to dig. Finish one case before starting
the next.

| Shape | Tells | Usual cause → fix |
|---|---|---|
| Duplicate delivery | Same message id twice; "impossible" `UNIQUE` violation | At-least-once delivery + non-idempotent consumer → idempotent consumer (`ON CONFLICT DO NOTHING`, dedup key); not the producer |
| Lost message | 200 returned, no consumer log; producer count > consumer count | Unchecked send, dual-write, ack-before-process, wrong topic → outbox, ack after process, fix subscription; not a blind retry |
| Out of order | State goes backwards; update before create | No global order (retries, many producers) → partition by entity key, or order-independent consumer |
| Read-modify-write race | Count off by one; `count = count + 1` in app code | Concurrent requests → one SQL statement, `SELECT … FOR UPDATE`, optimistic version, or single consumer per key |
| Clock skew | Timestamps go backwards; job runs twice around DST | Host clocks disagree → UTC internally, monotonic clock for durations, tolerance on cross-host compares |
| Retry storm | Latency spike in one service, CPU spikes everywhere, no recovery after the root fix | Unbounded retries → bounded retries with backoff and jitter, circuit breaker, load shedding; never retry 4xx |
| Split brain | Two primaries; `charged` in one service, `pending` in another | Several sources of truth → one source, others reconcile from it |

Anti-patterns: "it's a flake, just retry"; adding retries before knowing why it
failed; reading one service's logs when the bug sits on the boundary; trusting
"the API returned 200" instead of checking the side effect.

The fix usually belongs to another skill: queue delivery, ordering and retries →
`queue-fundamentals`; races and partial failures → `database-fundamentals`;
adapter-level serialization, retries and timeouts → `hexagonal-backend`.
Instrumentation added during the hunt stays until the regression test passes;
the harness receipts, not the log lines, are the proof.
