# Security review: <title>

**Plan**: [./plan.md](./plan.md)
**Reviewed**: YYYY-MM-DD
**Trigger**: <which sensitive-path bucket the diff touched — auth | crypto | sql | html | path | exec | deserialise | secrets | network>
**Verdict**: pass | fix-required

## Threat model (one paragraph)
What an attacker would try given this diff. Trust boundaries crossed. Who can reach the new code.

## Checklist
Walk every applicable row. Mark ✓ / ✗ / N/A with a one-line note. Inline checklist — no separate skill needed.

### Input handling
- [ ] All user input validated at the boundary, not deep inside
- [ ] No string concatenation into SQL / shell / HTML / paths
- [ ] Parser/decoder choice safe for untrusted input (no `pickle.loads`, no `yaml.load`, no eval)

### Authn / authz
- [ ] Every new endpoint has an explicit authz check (not "the middleware probably catches it")
- [ ] Session/token storage is httpOnly + secure + SameSite where applicable
- [ ] No new "admin" code path skips the existing authz layer

### Secrets + crypto
- [ ] No hard-coded secrets, API keys, or test credentials in the diff
- [ ] No custom crypto — using the platform's standard library / vetted lib
- [ ] PRNG used for security purposes is a CSPRNG

### Output / rendering
- [ ] Untrusted text escaped on the way out (HTML, JSON, log lines)
- [ ] Redirect targets validated against an allowlist
- [ ] Error messages don't leak stack traces / internal paths to end users

### Infra-adjacent
- [ ] File path joins go through `path.join` / `filepath.Clean` and reject `..`
- [ ] New outbound network call has a timeout and a target allowlist
- [ ] New process exec doesn't shell out with user input

## Findings

### Blocking (severity = high)
- `path:line` — <issue> → <fix>

### Non-blocking (severity = medium / low)
- `path:line` — <issue> → <fix or accepted risk>

## Sign-off
pass | fix-required (counts against the review cycle budget)
