# feed-api

The feed API used by the Pocketfeed mobile apps and the web site (Node.js, no
dependencies).

`createApp({ minClientVersion })` from `src/app.js` returns
`{ handle(request) }`. A request is `{ method, path, headers }` with lowercase
header names; a response is `{ status, headers, body }` where `body` is a JSON
value. `node bin/serve.js` serves it over HTTP on `PORT` (default 3000).

Routes: `GET /health`, `GET /api/feed`, `GET /api/profile`. Anything else is
404 `{ "error": "not_found" }`.

Mobile release rules are in [docs/client-versions.md](docs/client-versions.md).
