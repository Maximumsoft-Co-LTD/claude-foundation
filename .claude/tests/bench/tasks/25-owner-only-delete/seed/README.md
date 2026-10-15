# Notes service

A tiny in-memory notes HTTP API (Node.js, no dependencies).

Start it with `node src/server.js` (port `PORT`, default 3000). Tests use
`createServer()` from `src/server.js` and listen on port 0.

## Authentication

Requests identify the caller with the `X-User` header. Known accounts live in
`src/users.js`; a missing or unknown `X-User` is an anonymous request.

| User | Role |
|---|---|
| `alice` | member |
| `bob` | member |
| `ada` | admin |

## Routes

All bodies are JSON.

| Method | Path | Behavior |
|---|---|---|
| `POST` | `/notes` | Signed-in callers only (`401 {"error":"unauthenticated"}` otherwise). Body `{"title": string}` with a non-empty trimmed title (`400 {"error":"invalid_title"}`). Returns `201 {"id","title","owner"}`; `owner` is the caller. |
| `GET` | `/notes` | Public. `200 [note, ...]` in creation order. |
| `GET` | `/notes/:id` | Public. `200 note` or `404 {"error":"not_found"}`. |
| `DELETE` | `/notes/:id` | `204` with an empty body, or `404 {"error":"not_found"}`. |

Any other route returns `404 {"error":"not_found"}`; malformed JSON returns
`400 {"error":"invalid_json"}`.
