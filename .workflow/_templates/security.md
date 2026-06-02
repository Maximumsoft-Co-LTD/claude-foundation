# Security review: <title>

**Plan**: [./plan.md](./plan.md)
**Reviewed**: YYYY-MM-DD
**Trigger**: <bucket the diff touched — auth | crypto | sql | html | path | exec | deserialise | secrets | network>
**Verdict**: pass | fix-required

## Threat model (one paragraph)
What an attacker would try given this diff. Trust boundaries crossed. Who can reach the new code.

## Checklist
Walk ONLY the buckets your `Trigger` names; mark ✓ / ✗ / N/A with a one-line note. Inline — no separate skill needed.

- [ ] **Input** — validated at the boundary, not deep inside; no string-concat into SQL / shell / HTML / paths; safe parser for untrusted input (no `pickle.loads`, no `yaml.load`, no eval)
- [ ] **Authn / authz** — every new endpoint has an explicit authz check (not "middleware probably catches it"); session/token storage httpOnly + secure + SameSite; no admin path skips the existing authz layer
- [ ] **Secrets / crypto** — no hard-coded secrets / API keys / test creds in the diff; no custom crypto (use the platform / a vetted lib); CSPRNG for security-purpose randomness
- [ ] **Output** — untrusted text escaped on the way out (HTML / JSON / logs); redirect targets validated against an allowlist; errors don't leak stack traces / internal paths
- [ ] **Infra-adjacent** — path joins go through `path.join` / `filepath.Clean` and reject `..`; new outbound call has a timeout + target allowlist; new process exec doesn't shell out with user input

## Findings

### Blocking (severity = high)
- `path:line` — <issue> → <fix>

### Non-blocking (severity = medium / low)
- `path:line` — <issue> → <fix or accepted risk>

## Sign-off
pass | fix-required (counts against the review cycle budget)
