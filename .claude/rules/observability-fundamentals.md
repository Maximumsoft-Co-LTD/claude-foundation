# Rule: Observability fundamentals by default

**Trigger:** any task that ships runtime code adding a new failure mode or operational surface — adding logging/metrics/tracing, defining an SLO or alert, or diagnosing a production blind spot. Invoke the `observability-fundamentals` skill **before** writing the instrumentation.

**Why:** the difference between a five-minute incident and a five-hour one is whether the system was built to be diagnosable — structured leveled logs, correlation across boundaries, percentile metrics, and alerts on symptoms users feel rather than on noisy causes. Minutes at design time versus staring at a black box during an outage. Unlike `debug-fundamentals` (reactive cause-finding), this is the proactive design that makes that debugging possible. It backs the `plan.md > Observability` section trigger.

The 7 principles, pre-flight checklist, references, and skip list live in `.claude/skills/observability-fundamentals/SKILL.md` — defer to it.
