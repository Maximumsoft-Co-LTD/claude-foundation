---
name: observability-fundamentals
description: "Use when adding or reviewing logs, metrics, traces, SLOs, or alerts for a runtime failure surface. Skip offline code; use performance-investigation to explain measurements."
---

# Observability fundamentals

Start from the operator's question and the user's failure, then pick the
signal that answers it. A missing counter is unavailable, never zero.

## Steps

1. Name who is affected, where, since when, and why an operator must be able to
   answer; choose logs, metrics, or traces for each question.
2. Emit structured, leveled events at ownership boundaries with stable
   operation/request identity and actionable context — never secrets or
   unbounded payloads.
3. Propagate correlation and trace context across every process, service, and
   async hop so one request or job can be followed end to end.
4. Measure RED for services and USE for resources; use distributions and
   percentiles for latency, not averages.
5. Define SLIs from user-observable success and latency, then SLOs and error
   budgets that drive decisions. Alert on symptoms that require action, each
   with owner, runbook, severity, and recovery signal.
6. Bound label cardinality, log volume, sampling, retention, and cost. User
   IDs, request IDs, URLs, and error text are not metric labels.

Load this alongside one primary construction skill only when the change adds
or materially alters runtime failure behavior.

## Harness

Record the changed failure surface, SLI, ownership, and required telemetry
evidence in OpenSpec; providers verify emitted signals through the harness.
Configuration presence alone proves nothing; Build never stages or commits.

## References

- `references/logs-metrics-traces.md` — field conventions, log levels, RED/USE recipes, tracing, SLO worked example, cardinality pitfalls
