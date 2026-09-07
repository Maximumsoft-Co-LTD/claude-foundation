# Change: Reduce Change and Prove wall time by making the harness own deterministic preparation, reuse and dependency-aware parallel execution without weakening review or delivery authority

## Why

Users currently wait on sandbox setup during Change, repeated lifecycle checks, serialized provider and repository preparation, and single-session Build execution even when work is independent

## What changes

- Change persists and validates the agreement without creating or setting up an isolated workspace, and the first Build advance creates that workspace exactly once
- The harness dispatches them concurrently up to available configured capacity while conflicting, unknown-scope, and dependent tasks remain serialized
- The harness schedules them concurrently within resource and capacity limits, reuses valid results, cleans up partial failures, and reports blocked dependency closure truthfully
- Versioned telemetry attributes non-overlapping substage duration, queueing, reuse, executed nodes, and peak concurrency without double-counting parent duration
- The agent invokes change start and advance routes while the harness owns validation, setup, scheduling, evidence reuse and recovery instead of requiring repeated primitive commands

## Impact

- **Impact:** high
- **Coupling:** coupled
- **Affected surfaces:** code
- **Security triggers:** 

## Non-goals

- none
