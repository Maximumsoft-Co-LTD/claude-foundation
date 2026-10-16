# Gateway configuration

Configuration loader for the API gateway (Node.js, no dependencies).

`loadConfig({ env = process.env, file })` from `src/config.js` returns a frozen
config object. `file` is an optional path to a JSON object of settings. Each
setting resolves in this order: environment variable, then config file, then
default. Invalid values throw `ConfigError` at startup; the message names the
setting, the source, and the bad value, for example:

```text
invalid port from PORT: "80a" (expected an integer from 1 to 65535)
```

`node bin/print-config.js [config.json]` prints the resolved config as JSON, or
prints the error message to stderr and exits with code 1.

## Settings

| Key | Env | Default | Valid values |
|---|---|---|---|
| `port` | `PORT` | `8080` | integer 1-65535 |
| `logLevel` | `LOG_LEVEL` | `"info"` | `debug`, `info`, `warn`, `error` |
| `upstreamUrl` | `UPSTREAM_URL` | `"http://localhost:9000"` | `http:` or `https:` URL |

An environment variable set to the empty string counts as unset. Unknown keys in
the config file are rejected with `unknown setting in <file>: "<key>"`.
