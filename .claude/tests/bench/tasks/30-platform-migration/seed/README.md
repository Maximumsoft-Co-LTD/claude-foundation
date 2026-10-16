# Platform jobs

Background jobs for the account platform (Node.js, no dependencies). Today a
system crontab runs `node bin/cron.js <store.json> <iso-time>` every minute.

## Jobs

`src/jobs.js` defines the jobs. Each job receives `(store, { at })`, may mutate
the store, and returns a JSON-serializable result.

| Job | Due when (UTC) | Effect |
|---|---|---|
| `expire-sessions` | minute divisible by 15 | removes sessions whose `expiresAt` is at or before `at`; result `{ expired }` |
| `daily-digest` | 00:00 | builds one digest per user with `digest: true`; result `{ sent, recipients }` |
| `purge-audit` | 03:30 | drops audit entries older than 30 days; result `{ purged }` |

## Cron runner

`runCron(store, at)` from `src/cron.js` runs every due job in the table order
above and returns one entry per job: `{ job, at, result }`, or
`{ job, at, error }` with the thrown message when a job fails. A failing job
never stops the jobs after it. `bin/cron.js` prints that array as JSON and
writes the store back.

## Store

```json
{ "sessions": [{ "id": "s1", "expiresAt": "2026-10-01T00:00:00Z" }],
  "users": [{ "id": "u1", "email": "a@example.com", "digest": true }],
  "audit": [{ "id": "a1", "at": "2026-09-01T00:00:00Z" }],
  "outbox": [] }
```
