---
name: observability-fundamentals
description: Apply observability fundamentals — the three pillars (logs/metrics/traces), structured leveled logging, correlation ids across services, metrics that answer questions (RED/USE, percentiles), alerting on symptoms not causes, SLI/SLO/error budgets, cost and cardinality discipline. Use BEFORE shipping runtime code that adds a new failure mode or op surface, adding logging/metrics/tracing, defining SLOs or alerts, or debugging a prod blind spot. The trigger is making a running system diagnosable, even when no principle is named. Skip throwaway scripts and pure offline/library code with no runtime op surface.
---

# Observability Fundamentals

## Why this exists

Incidents are made longer by the same handful of missed fundamentals: the failing path that logged nothing; the log firehose that buried the one relevant line; the average-latency dashboard hiding a catastrophic p99; logs with no request id threading them across services; pages on `CPU > 80%` that train on-call to ignore the pager. This skill is a **pre-flight** — read it before shipping code, wiring a metric, or writing an alert. Observability is a property you build in; you can't bolt it on during an incident.

Inverse of [[debug-fundamentals]]: debug is reactive (failure happened, find the cause). Observability is proactive (decide what evidence will exist next time). Pairs with [[architecture-fundamentals]] (service boundaries correlation ids must cross) and [[queue-fundamentals]] (async hops where a trace is the only way to follow a request).

## The 7 principles

Full rule/why/how-to-apply/example for each lives in `references/logs-metrics-traces.md`.

| # | Principle | Compressed rule | Reference |
|---|---|---|---|
| 1 | Know the three pillars and what each is for | Logs are discrete events, metrics are aggregatable numbers, traces are the causal path of one request. Reach for the right pillar for the question — don't make one do another's job. | `references/logs-metrics-traces.md` |
| 2 | Logs are structured and leveled — key-value, not string-concat | JSON/logfmt key-value, at a level that means something (`ERROR` = act), carrying ids/context a stranger needs in six months — never secrets or PII. | `references/logs-metrics-traces.md` |
| 3 | Correlate — one id threaded through every log and across every boundary | Stamp a correlation id at the edge, attach it to every log line, propagate it across every service and queue boundary — rebind on the consume side, don't mint fresh. | `references/logs-metrics-traces.md` |
| 4 | Metrics that answer questions — RED for services, USE for resources, percentiles not averages | RED (rate/errors/duration) for request-serving services, USE (utilization/saturation/errors) for resources. Report latency as p95/p99, never a mean. | `references/logs-metrics-traces.md` |
| 5 | Alert on symptoms users feel, not on causes | Page on what a user experiences (errors, slowness, SLO burn), not a cause (`CPU > 80%`). Every page needs a runbook and a real action, or it's a dashboard panel. | `references/logs-metrics-traces.md` |
| 6 | Define SLI/SLO/error budgets | Define what "healthy" measurably means — SLI (metric), SLO (target), error budget (1 − SLO) — before alerting on it or trading reliability against velocity. | `references/logs-metrics-traces.md` |
| 7 | Cost and cardinality discipline | Bounded, low-cardinality metric labels only; sample high-volume traces/logs; budget retention. Unbounded labels (user_id, raw ids) explode cost and take down the backend. | `references/logs-metrics-traces.md` |

## Pre-flight checklist

Before shipping runtime code with a new failure mode, wiring telemetry, or writing an alert, run through these:

1. **Pillars:** for each question I'll ask in an incident, am I emitting the right pillar — metric for "that/how many," trace for "where," log for "why"? Am I not abusing one pillar to do another's job?
2. **Structured + leveled logs:** are logs key-value (not concatenated strings), at a level that means something (`ERROR` = act), carrying the ids/context a stranger needs in six months — and free of secrets and PII?
3. **Correlation:** does a correlation/trace id get minted at the edge, ride on every log line automatically, and propagate across every HTTP call, queue message, and job — *and get rebound* on the consume side?
4. **Metrics that answer questions:** for each service do I have RED (rate/errors/duration), for each resource USE (utilization/saturation/errors), and is latency a percentile (p95/p99), never an average?
5. **Symptom alerts:** does each paging alert fire on something a user feels (errors, latency, SLO burn) rather than a cause (CPU%), and is every page actionable with a runbook?
6. **SLO defined:** is there an SLI/SLO/error budget that makes "healthy" a number, so the alerts have something real to fire against and reliability tradeoffs have a currency?
7. **Cost & cardinality:** are metric labels all low-cardinality (no `user_id`/raw ids — those go in logs/traces)? Are high-volume traces/logs sampled, levels sane in prod, retention budgeted?

If any answer is "I don't know," stop and find out before writing.

## When to skip this skill

- Throwaway scripts and prototypes deleted within the hour — a `print` is fine.
- Pure offline or library code with **no runtime operational surface** — a parser, a pure data transform, a math utility that another service operates. (Its *caller's* op surface is where this skill applies.)
- Trivial config edits with no new failure mode (a copy tweak, a formatter rule, a constant bump).
- Local-only one-off debugging where the telemetry will never reach production.

For anything else — runtime code that introduces a new way to fail or a new operation to watch, a logging/metrics/tracing change, an SLO or alert definition, or diagnosing a production blind spot — these fundamentals apply. This skill backs the `## Observability` section of `plan.md`: when a `feat`/`fix` ships runtime code adding a new failure mode or op surface, that section names the new log line + metric, and this skill is the standard it's held to.

## How to use this skill in a conversation

Always-on for runtime observability work — `.claude/rules/fundamentals.md` owns the trigger and run order (it's cross-cutting, applied last). Don't ask the user to opt in; if the task matches *When to skip*, say so in one sentence and proceed.

Apply the principles inline, not after the fact: when a code path adds a failure mode, name its metric (RED/USE), its failure log (with ids, no secrets), and whether a trace must span it *alongside the code* — not later; drive any alert off an SLI/SLO + burn rate with a runbook action (an alert with no action is a dashboard panel); for a prod blind spot, name the missing evidence and add the instrumentation so the next incident is shorter. The pre-flight checklist above is the standard to hold the work to. For non-obvious calls (sampling rate, dropping a label for cardinality, an SLO target) say *why* in one sentence — tie instrumentation to the failure mode it illuminates, don't emit telemetry silently.

## Reference files

- `references/logs-metrics-traces.md` — principles 1-7's full rule/why/how-to-apply/example, plus the field manual: structured-log field conventions and level-to-action mapping, RED/USE metric recipes (counter/gauge/histogram), trace/span basics and correlation-id propagation across HTTP/queue boundaries, a worked SLI/SLO/error-budget example with burn-rate alerting, and the cardinality/cost pitfalls with concrete do/don't.
