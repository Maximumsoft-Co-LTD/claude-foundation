# Project Tracker API

A JSON REST API for small teams: accounts and sessions, projects with role-based
membership, tasks with a status workflow, filtered task lists, and a per-project
activity log. Runtime: Node.js 20 or newer, CommonJS, using only built-in
modules (`node:http`, `node:fs`, `node:crypto`, `node:test`, ...). Do not add
dependencies.

## Module contract

`src/server.js` exports `createServer({ dataFile, now })`. It returns an
`http.Server` that is not yet listening; the caller calls `listen()`.

- `dataFile` — path of the JSON file that stores all state.
- `now` — optional function returning the current time as a `Date`; defaults to
  `() => new Date()`. Every timestamp, session expiry, and "today" used by the
  overdue filter comes from `now()`, never from `Date.now()` directly.

`GET /health` keeps returning `200 {"ok":true}` without authentication.

All timestamps are ISO 8601 strings produced by `Date#toISOString()`. All ids
are server-assigned unique strings; client-supplied `id`, `createdAt`,
`updatedAt`, `ownerId`, `createdBy`, `projectId`, and unknown fields are ignored.

## Responses and errors

Every response except `204` has a JSON body and
`content-type: application/json`. Errors are JSON objects with a string
`error` message:

| Status | When | Body |
|---|---|---|
| `400` | Field validation failure | `{"error": "...", "field": "<field>"}` |
| `400` | Body is not valid JSON or is not a JSON object | `{"error": "..."}` |
| `401` | Missing, malformed, unknown, logged-out, or expired token; bad login | `{"error": "..."}` |
| `403` | Authenticated project member whose role does not allow the action | `{"error": "..."}` |
| `404` | Unknown route, missing resource, or project the caller cannot see | `{"error": "..."}` |
| `409` | Conflict: duplicate email, duplicate member, illegal status transition | `{"error": "...", "field": "<field>"}` |

An unknown route (any method/path combination not listed below) is `404`
whether or not the request is authenticated.

For a known route, checks run in this order and the first failure wins:

1. authentication (`401`);
2. project visibility — a project that does not exist and a project the caller
   is not a member of produce the **identical** `404` status and body, so
   non-members cannot learn that a project exists;
3. existence of the addressed task or member (`404`);
4. request body JSON (`400`);
5. role permission (`403`);
6. field validation (`400`), in the field order of the tables below;
7. conflicts (`409`).

A request that fails any check changes nothing.

## Users and sessions

### `POST /users` (no authentication)

Registers a user. Body `{ "email", "password", "name" }`.

| Field | Rule |
|---|---|
| `email` | string; trimmed and lowercased; exactly one `@` with non-empty text on both sides, a `.` somewhere after the `@`, no whitespace; at most 254 characters. Unique case-insensitively: a duplicate is `409` with `field: "email"` |
| `password` | string of 8–128 characters (not trimmed) |
| `name` | string; trimmed; 1–100 characters |

`201` with the public user `{ "id", "email", "name", "createdAt" }`.

Passwords are stored only as a salted hash produced with `crypto.scrypt` (a new
random salt per user). The password, its hash, and its salt never appear in any
response.

### `POST /sessions` (no authentication)

Logs in. Body `{ "email", "password" }`; the email is matched after trimming and
lowercasing. Unknown email or wrong password is `401` (same response for both).

`201` with `{ "token", "expiresAt", "user" }` where `token` is an opaque random
string (at least 128 bits of randomness; it must not encode the user id or
email), `expiresAt` is exactly 24 hours after `now()`, and `user` is the public
user. Every login creates a new, independent session.

### Authentication

Every other route requires `Authorization: Bearer <token>`. A missing header,
another scheme, an unknown token, a logged-out token, or a token whose
`expiresAt` is at or before `now()` is `401`.

### `DELETE /sessions`

Logs out the calling session. `204`. That token is `401` afterwards; the user's
other sessions keep working.

### `GET /users/me`

`200` with the caller's public user.

## Projects

Project: `{ "id", "name", "description", "ownerId", "createdAt", "updatedAt" }`.

| Field | Rule |
|---|---|
| `name` | required on create; string; trimmed; 1–100 characters |
| `description` | string of at most 2000 characters; defaults to `""` |

Roles: `owner` (the creator; exactly one per project), `editor`, `viewer`.

| Action | owner | editor | viewer |
|---|---|---|---|
| Read project, members, tasks, activity | yes | yes | yes |
| Update project | yes | yes | no |
| Delete project | yes | no | no |
| Add or remove members | yes | no | no |
| Create, update, delete tasks | yes | yes | no (see assignee exception) |

A forbidden action by a member is `403`. Anything by a non-member is `404`.

### `POST /projects`

Creates a project owned by the caller. `201` with the project.

### `GET /projects`

`200 {"items": [...]}` — the projects the caller is a member of, in creation
order.

### `GET /projects/:id`

`200` with the project.

### `PATCH /projects/:id`

Partial update of `name` and/or `description` with the create rules. `200` with
the updated project; `updatedAt` becomes `now()`.

### `DELETE /projects/:id`

`204`. The project, its members, tasks, and activity are gone; later requests
for it are `404`.

### `GET /projects/:id/members`

`200 {"items": [{ "userId", "role", "name", "email" }]}` — the owner first, then
the other members in the order they were added.

### `POST /projects/:id/members`

Body `{ "userId", "role" }`. `userId` must be the id of an existing user
(`400`, `field: "userId"`); `role` must be `editor` or `viewer` (`400`,
`field: "role"`). A user who is already a member is `409` with
`field: "userId"`. `201 {"userId", "role"}`.

### `DELETE /projects/:id/members/:userId`

`204`. Removing the owner is `400` with `field: "userId"`; a user who is not a
member is `404`. Every task in the project assigned to the removed user becomes
unassigned (`assigneeId: null`). The removed user can no longer see the project.

## Tasks

Task: `{ "id", "projectId", "title", "description", "status", "priority",
"assigneeId", "dueDate", "labels", "createdBy", "createdAt", "updatedAt" }`.

| Field | Rule |
|---|---|
| `title` | required on create; string; trimmed; 1–200 characters |
| `description` | string of at most 5000 characters; defaults to `""` |
| `status` | `todo`, `doing`, or `done`. Tasks are created as `todo`: on create the field may be omitted or `"todo"`, anything else is `400` |
| `priority` | integer 1–5; defaults to `3` |
| `assigneeId` | `null` or the id of a current member of the project; defaults to `null` |
| `dueDate` | `null` or a real calendar date in `YYYY-MM-DD` form (`2026-02-30` is invalid); defaults to `null` |
| `labels` | array of strings; each label is trimmed and lowercased and must be 1–30 characters; duplicates are removed keeping first-occurrence order; at most 5 after de-duplication; defaults to `[]` |

Validation failures are `400` with `field` naming the first invalid field in
the table order above.

### Status workflow

Allowed transitions: `todo → doing`, `doing → done`, and `done → todo` (reopen).
Any other change (`todo → done`, `doing → todo`, `done → doing`) is `409` with
`field: "status"`. A value outside the three statuses is `400` with
`field: "status"`. Setting the current status again is allowed and changes
nothing about the status.

**Assignee exception:** a viewer who is the task's assignee may `PATCH` that
task with a body whose only task field is `status`, moving it to `doing` or
`done`. Reopening (`status: "todo"`), any other field, or a task assigned to
someone else is `403` for a viewer. Owners and editors may make every allowed
transition.

### `POST /projects/:id/tasks`

`201` with the task; `createdBy` is the caller; `createdAt` and `updatedAt` are
`now()`.

### `GET /projects/:id/tasks/:taskId`

`200` with the task. A task id that does not belong to this project is `404`.

### `PATCH /projects/:id/tasks/:taskId`

Partial update of any task field with the rules above. `200` with the updated
task; `updatedAt` becomes `now()` and `createdAt` never changes.

### `DELETE /projects/:id/tasks/:taskId`

`204`; later requests for the task are `404`.

### `GET /projects/:id/tasks`

Query parameters (all optional; filters combine with AND and apply before
pagination):

| Parameter | Meaning | Invalid value |
|---|---|---|
| `status` | tasks with this status | `400`, `field: "status"` |
| `assigneeId` | tasks assigned to this user id | — |
| `label` | tasks carrying this label (compared after trimming and lowercasing) | — |
| `overdue` | `true`: tasks with a `dueDate` strictly before today's UTC date (from `now()`) whose status is not `done`; `false`: every other task | `400`, `field: "overdue"` |
| `sort` | `createdAt` (default), `priority`, or `dueDate` | `400`, `field: "sort"` |
| `order` | `asc` (default) or `desc` | `400`, `field: "order"` |
| `limit` | integer 1–100, default 20 (above 100 is invalid, not clamped) | `400`, `field: "limit"` |
| `offset` | integer ≥ 0, default 0 | `400`, `field: "offset"` |

Sorting:

- `createdAt` sorts by creation order; `desc` reverses it.
- `priority` sorts by the numeric priority in the requested direction.
- `dueDate` sorts by date in the requested direction; tasks without a due date
  come last in both directions.
- Ties are always broken by creation order, ascending.

Response:

```json
{ "items": [/* tasks */], "total": 42, "limit": 20, "offset": 0 }
```

`total` counts every task that matches the filters, ignoring pagination.

## Activity log

### `GET /projects/:id/activity`

`200 {"items": [...]}` — the project's events, newest first (events recorded at
the same instant keep reverse recording order). Every event has
`{ "id", "type", "actorId", "at" }` plus:

| `type` | Recorded when | Extra fields |
|---|---|---|
| `project.created` | the project is created | — |
| `project.updated` | the project is updated | `fields`: provided field names |
| `member.added` | a member is added | `userId`, `role` |
| `member.removed` | a member is removed | `userId` |
| `task.created` | a task is created | `taskId` |
| `task.updated` | a task `PATCH` includes any field other than `status` | `taskId`, `fields` |
| `task.status_changed` | a task's status actually changes | `taskId`, `from`, `to` |
| `task.deleted` | a task is deleted | `taskId` |

`fields` lists the provided (non-status) field names in the order of the field
tables above. A `PATCH` that includes both records `task.updated` first and then
`task.status_changed`, so the status event is listed above it.

## Persistence and concurrency

All state — users, password hashes, sessions, projects, members, tasks, and
activity — is stored as JSON in `dataFile`. Every change is written before its
response is sent, and the file is always complete, valid JSON. A new
`createServer({ dataFile })` on the same file serves the previously stored
state, including still-valid sessions. A missing file means empty state.

Concurrent requests must not lose updates: two `PATCH` requests sent at the
same time to different fields of one task both take effect, and many tasks
created at the same time are all stored.

## Tests

Cover the API with `node --test` tests (`npm test`).
