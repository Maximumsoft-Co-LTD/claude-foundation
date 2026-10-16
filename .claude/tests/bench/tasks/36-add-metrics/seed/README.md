# jobrunner

Runs background jobs for the billing service (Node.js, no dependencies).

`createRunner({ handlers, metrics, logger })` from `src/runner.js` returns
`{ run(job, context) }`. A job is `{ id, type, payload }`; `handlers[type]` is
called with the payload and may be sync or async. `context.correlationId` links
the job to the request that enqueued it. `run` resolves `{ ok: true, output }`
on success and `{ ok: false }` on failure; it never rejects for a handler error.
An unknown job type is a programming error and rejects.

## Telemetry conventions

- `metrics.increment(name, labels)` adds 1 to a counter. Label values must be
  low-cardinality (job type, error code); never ids.
- `logger.log(record)` writes one structured JSON record. Every record has
  `level` and `event`; job records also carry `jobId` and `type`.
- Customer data must never reach logs or metric labels. Job payloads hold
  names, emails, phone numbers and card details, and error messages often echo
  them, so neither payloads nor error messages may be logged.
