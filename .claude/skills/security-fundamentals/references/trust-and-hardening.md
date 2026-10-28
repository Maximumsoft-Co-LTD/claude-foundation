# Trust boundaries, least privilege, supply chain

## Draw the trust boundary before code

Security is a property of the path, not a function. Most injection and
access-control bugs are "never realized this value came from the user."

- Mark every input trusted or untrusted where it enters. "From another
  internal service" is untrusted unless that service is authenticated and
  authorized; SSRF and confused-deputy bugs live here.
- For each untrusted input write one sentence: what can the caller control,
  and what is the blast radius if it is hostile? A filename controls a path
  (traversal); a redirect URL controls where the browser goes (open redirect);
  a user id in the body controls whose data you fetch (IDOR).
- Separate anonymous from authenticated reachability.
- Indirect boundaries: deserialization, template strings, regular expressions
  over user input (ReDoS), and any value that later joins a command, query,
  path, or URL.

```ts
// Three untrusted inputs trusted without noticing
app.get('/files/:name', async (req, res) => {
  const path = `./uploads/${req.params.name}`   // traversal
  const userId = req.query.userId                // IDOR: derive identity from the session instead
  const next = req.query.redirect                // open redirect: allow-list internal paths
  res.sendFile(path)
})
```

## Least privilege and fail closed

Every actor (token, DB user, service account, file, CORS policy) gets the
minimum scope; the default state and the state on error are the restrictive
one.

- Scope tokens, API keys, and OAuth grants to the narrowest actions and
  resources. A read job gets a read-only token.
- The application's DB user is not the schema owner: DML only; DDL and
  superuser run migrations separately.
- Services run as non-root; no world-writable files; drop unneeded
  capabilities.
- A thrown authz check denies; missing required config refuses to start; an
  unparseable token is rejected. Never `catch { return true }` on a security
  decision.
- Secure defaults: CORS to an explicit origin allow-list (never `*` with
  credentials), secure cookies, TLS required, verbose errors off in
  production, no default credentials.

```ts
function canAccess(u, r) {
  try { return policy.check(u, r) }
  catch (e) { log.error(e); return false }   // fails closed
}
```

## Dependencies and the supply chain

Every dependency is code you ship. Typosquats, malicious updates, and
`postinstall` scripts are the attack surface.

- Commit the lockfile and build from it (`npm ci`, not `npm install`).
- Run a vulnerability scanner in CI (`npm audit`, `pip-audit`,
  `osv-scanner`, Dependabot/Renovate); a high-severity advisory in a reachable
  path blocks the build.
- Prefer the standard library or a small, maintained package; audit a new
  dependency's tree before adding it.
- Review dependency bumps against the lockfile diff; be wary of install-time
  scripts from packages you do not control.
- Never run untrusted code with your privileges: no `eval` of remote content,
  sandbox plugins, verify checksums and subresource integrity.
