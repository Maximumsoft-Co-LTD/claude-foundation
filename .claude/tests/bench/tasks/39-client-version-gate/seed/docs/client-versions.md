# Client versions

Mobile apps send `X-Client-Version: MAJOR.MINOR.PATCH` (for example `3.12.0`)
on every request. Stores roll out new versions over weeks, so the API must keep
serving every supported version at the same time.

- `minClientVersion` (default `"2.4.0"`) is the oldest supported app version.
- Versions compare numerically per part: `2.10.0` is newer than `2.9.9`.
- A supported version, older or newer, gets the normal response.
- A version below the minimum gets status 426 and
  `{ "error": "upgrade_required", "minVersion": "<min>", "message": "<text asking the user to update the app>" }`.
- A header that is not exactly three dot-separated non-negative integers
  (`3.1`, `v3.1.0`, `3.1.0-beta`, `abc`) gets status 400
  `{ "error": "invalid_client_version" }`.
- No header means a web or partner client: serve normally.
- `GET /health` is never gated; load balancers do not send the header.
