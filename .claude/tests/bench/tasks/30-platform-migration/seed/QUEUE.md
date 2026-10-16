# Moving jobs from cron to the queue worker

Ops is retiring the crontab. Jobs will be delivered by a queue worker instead,
and both paths must run side by side during the transition, producing the same
results for the same store and time.

## Target interface

`src/queue.js` exports `createQueue()`, returning a queue with:

- `enqueue(job, { at })`: appends a job message. `at` is an ISO-8601 UTC time.
- `size()`: number of pending messages.
- `drain(store)`: runs every pending message in FIFO order against `store` and
  returns one entry per message, shaped exactly like the cron runner's entries
  (`{ job, at, result }` or `{ job, at, error }`). A failing job never stops the
  messages after it. A message for an unknown job yields
  `{ job, at, error: "unknown job: <name>" }`. Drained messages are removed.

`src/queue.js` also exports `scheduleDue(queue, at)`, which enqueues exactly the
jobs the cron runner would run at `at`, in the same order, and returns how many
it enqueued.

## Parity

For any store and time, `scheduleDue(q, at); q.drain(store)` must return the
same entries and leave the store in the same state as `runCron(store, at)`.
`node bin/cron.js` must keep working unchanged until the crontab is removed.
