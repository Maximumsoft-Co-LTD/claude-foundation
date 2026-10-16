# Payment webhooks receiver

Receives payment events from the PayRail provider (Node.js, no dependencies).

`createServer({ secrets, clock })` from `src/server.js` returns an
`http.Server`. `secrets` is an array of active signing secrets (default: the
comma-separated `PAYRAIL_WEBHOOK_SECRETS`); `clock()` returns the current time in
milliseconds (default `Date.now`). `node src/server.js` listens on `PORT`.

## Routes

| Method | Path | Behavior |
|---|---|---|
| `POST` | `/webhooks/payrail` | Records the event and returns `200 {"status":"processed"}` |
| `GET` | `/events` | `200 {"events":[...]}`: processed events in arrival order |
| `GET` | `/health` | `200 {"ok":true}` |

Malformed JSON returns `400 {"error":"invalid_json"}`; any other route returns
`404 {"error":"not_found"}`.

The provider's delivery contract is in `PAYRAIL-WEBHOOKS.md`.
