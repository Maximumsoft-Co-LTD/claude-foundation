# Notes API

A small JSON REST API for personal notes. Runtime: Node.js 20 or newer, using
only built-in modules (`node:http`, `node:fs`, `node:test`, ...). Do not add
dependencies.

## Module contract

`src/server.js` exports `createServer({ dataFile })`. It returns an
`http.Server` that is not yet listening; the caller calls `listen()`.
`GET /health` keeps returning `200 {"ok":true}`.

Every response except `204` has a JSON body and
`content-type: application/json`.

## Note

| Field | Rule |
|---|---|
| `id` | string, assigned by the server, unique |
| `title` | required string; trimmed; 1–120 characters after trimming |
| `body` | string, at most 10000 characters; defaults to `""` |
| `tags` | array of strings; each tag is trimmed and lowercased and must be non-empty; duplicates removed (first occurrence order kept); at most 10 after de-duplication; defaults to `[]` |
| `createdAt` | ISO 8601 timestamp set on create, never changed |
| `updatedAt` | ISO 8601 timestamp; equals `createdAt` on create, refreshed on every successful update |

Client-supplied `id`, `createdAt`, `updatedAt`, and unknown fields are ignored.

## Errors

- Validation failure: `400 {"error": "<message>", "field": "<field name>"}`,
  where `field` is `title`, `body`, `tags`, `limit`, or `offset`.
- Request body that is not valid JSON, or not a JSON object: `400 {"error": "..."}`.
- Missing note: `404 {"error": "..."}`.
- Unknown route: `404 {"error": "..."}`.

## Endpoints

### `POST /notes`

Creates a note. `201` with the created note.

### `GET /notes/:id`

`200` with the note, or `404`.

### `PATCH /notes/:id`

Partial update: only the provided `title`, `body`, and `tags` change, with the
same validation as create. `200` with the updated note; `updatedAt` changes and
`createdAt` does not. `404` when the note does not exist. An invalid update
changes nothing.

### `DELETE /notes/:id`

`204` with no body. Later reads, updates, or deletes of that id return `404`.

### `GET /notes`

Query parameters:

- `limit` — integer 1–100, default 20. Any other value (including above 100) is `400` with `field: "limit"`.
- `offset` — integer ≥ 0, default 0. Any other value is `400` with `field: "offset"`.
- `q` — optional; case-insensitive substring match on `title` or `body`.
- `tag` — optional; keeps notes that carry this tag (compared after trimming and lowercasing).

Notes are sorted by `createdAt` ascending (creation order for ties). Filters
apply before pagination. Response:

```json
{ "items": [/* notes */], "total": 42, "limit": 20, "offset": 0 }
```

`total` is the number of notes matching the filters, ignoring pagination.

## Persistence

All notes are stored as JSON in `dataFile`. Every create, update, and delete is
written before its response is sent. A new `createServer({ dataFile })` on the
same file serves the previously stored notes. A missing file means no notes.

## Tests

Cover the API with `node --test` tests (`npm test`).
