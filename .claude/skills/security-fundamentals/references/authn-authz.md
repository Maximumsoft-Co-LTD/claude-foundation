# Authentication, Authorization, Secrets, and Crypto

- **Authentication (authn)** — *who are you.* Establishes identity once per request. Getting this wrong lets an attacker become someone.
- **Authorization (authz)** — *may you do this, to this thing.* Runs at every access, derived from the authenticated identity. Getting this wrong lets an authenticated user touch what isn't theirs.

The overwhelming majority of serious web bugs are **authorization** failures — the authn happy path is obvious and tested; the authz check is the one nobody notices is missing until an attacker increments an id.

## Sessions vs tokens

### Cookie sessions (server-side state)

The server stores session state; the client holds an opaque session id in a cookie. Revocation is trivial (delete the server record). The cookie must be:

```
Set-Cookie: sid=...; HttpOnly; Secure; SameSite=Lax; Path=/
```

- `HttpOnly` — JavaScript can't read it, so an XSS bug can't steal the session directly.
- `Secure` — only sent over HTTPS.
- `SameSite=Lax` (or `Strict`) — the browser won't attach it to cross-site requests, which is the main defense against CSRF. For state-changing forms not covered by `SameSite`, add a CSRF token (double-submit or synchronizer pattern).
- **Rotate the session id on every privilege change** (login, step-up, role elevation). Failing to rotate on login is *session fixation*: the attacker plants a known id before you log in and inherits your authenticated session.

### Tokens (JWT, stateless)

The server signs a token the client holds; no server-side lookup per request. Cheap to scale, **hard to revoke**. Use short-lived access tokens (minutes) + a refresh token with a revocation/denylist.

JWT validation is a field of footguns. Validate **all** of:

- **Signature** — and pin the algorithm. The classic break is accepting `alg: none` (no signature) or letting the attacker switch `RS256`→`HS256` and sign with the *public* key as the HMAC secret. Configure the library with the one algorithm you expect; reject everything else.
- **`exp`** (expiry) and **`nbf`** (not-before) — reject expired/future tokens.
- **`aud`** (audience) and **`iss`** (issuer) — a token minted for a different service or by a different issuer must be rejected, or you have a confused deputy.
- Don't put secrets in the payload — a JWT is signed, not encrypted; anyone can base64-decode and read it.

```ts
// Bad — trusts whatever algorithm the token claims, no aud/exp check
jwt.verify(token, secret)                       // accepts alg:none / alg confusion

// Good — pin algorithm + issuer + audience; library enforces exp
jwt.verify(token, key, { algorithms: ['RS256'], issuer: 'auth.example.com', audience: 'api' })
```

### Passwords (when you own auth)

Prefer delegating to an identity provider (OAuth/OIDC). If you must store passwords:

- Hash with **slow, salted, memory-hard** `argon2id` (first choice), `scrypt`, or `bcrypt`. Library generates the salt; you tune the cost factor, never the algorithm.
- **Never** SHA-256 or MD5 — built to be fast, which is exactly what an offline cracker wants.
- Verify with the library's `verify` (constant-time); never compare with `==`.
- Rate-limit and lock out on repeated failures; same generic error for "wrong password" and "no such user" (don't leak account existence).

## Authorization: deny by default, per-object, server-side

### The shape of a correct check

```
can(actor, action, resource)
```

- **actor** comes from the authenticated session/token, **server-side**. Never from `req.body.userId`, `req.query.role`, or a client-set header — those are attacker-controlled.
- **action** is the specific operation (`read`, `update`, `delete`), not just "is authenticated."
- **resource** is the *actual object you loaded*, checked after you fetch it.

You need **two layers** and they fail differently:

- **Function/route-level** — "may this role hit this endpoint at all?" (admins only on `/admin/*`). Missing this is *missing function-level access control*.
- **Object-level** — "does *this* invoice belong to *this* user?" Missing this is **IDOR / broken object-level authorization** — the single most common high-impact web bug.

### The broken-access-control pattern catalog

| Pattern | The bug | The fix |
|---|---|---|
| **IDOR / BOLA** | `GET /invoices/4012` returns the invoice without checking ownership; attacker enumerates ids | load object, then `if (obj.ownerId !== actor.id) deny` — before returning |
| **Missing function-level check** | `/admin/users` guarded only by a hidden UI link, not a server check | route guard that checks role/permission server-side |
| **Mass assignment** | `User.update(req.body)` lets the client set `role` or `isAdmin` | bind only an explicit allow-list of fields; reject unknown fields |
| **Trusting client role** | `if (req.body.role === 'admin')` | derive role from the server-side session/principal |
| **Forced browsing** | unlinked `/internal/report.pdf` is reachable by URL | authorize the resource, not the presence of a link |
| **Horizontal vs vertical** | user A reads user B's data (horizontal); user reads admin data (vertical) | object-level check catches horizontal; function-level catches vertical — do both |

### Deny by default

Absence of explicit *allow* = *deny*. New endpoints, fields, and actions start locked. A central policy layer (`can(actor, action, resource)`) beats scattered `if (user.role === ...)` checks that drift. When a check errors, deny.

```ts
// Bad — returns the object to any authenticated caller (IDOR)
const doc = await db.docs.find(id)
return res.json(doc)

// Good — object-level authz, deny by default, 404 (not 403) to avoid confirming existence
const doc = await db.docs.find(id)
if (!doc || doc.ownerId !== req.session.userId) return res.sendStatus(404)
return res.json(doc)
```

Return **404 instead of 403** when the caller may not access an object — avoids confirming the id exists (enumeration oracle). Use 403 when existence isn't sensitive.

### Where to enforce it

Put authorization at the lowest layer that has the object — ideally in the use case / application service ([[hexagonal-backend]]), so every transport inherits the same check. Authorization bolted onto one controller is authorization the next entry point forgets.

## Fail closed

Every security decision must default to *deny* on the unhappy path:

```ts
// Fails OPEN — exception grants access
function authorized(u, r) { try { return policy.check(u, r) } catch { return true } }

// Fails CLOSED — error → log → deny
function authorized(u, r) { try { return policy.check(u, r) } catch (e) { log.error(e); return false } }
```

Same for config: a missing required secret/permission should *refuse to start*, not silently default to a permissive value. (`team-silent-failure-hunter` territory — a swallowed error on a security path is the worst kind of silent failure.)

## Secrets and crypto: the primitive-selection decision guide

The fatal mistake is reaching for the wrong tool:

| You want to… | Use | Not |
|---|---|---|
| Store a password | `argon2id` / `scrypt` / `bcrypt` (slow, salted) | SHA-256, MD5, encryption |
| Hide data in transit/at rest | AEAD: AES-GCM or ChaCha20-Poly1305 | ECB mode, "encrypt then forget the auth tag" |
| Prove a message wasn't tampered with (shared secret) | HMAC-SHA256 | any hand-rolled concatenation — `H(secret + data)` is length-extendable, `H(data + secret)` inherits collision fragility; use HMAC |
| Prove origin (public verification) | digital signature (Ed25519, RSA-PSS) | HMAC (verifier needs the secret) |
| Generate a token / id / nonce / salt | CSPRNG: `crypto.randomBytes`, `secrets.token_bytes` | `Math.random()`, `random.random()`, timestamps |
| Compare two secrets/MACs/tokens | constant-time: `timingSafeEqual`, `compare_digest` | `==` / `===` (timing oracle) |

Rules that hold regardless of language:
- **Never roll your own crypto.** Call a vetted library (libsodium/NaCl, your platform's standard crypto module) with defaults.
- **Never reuse a nonce/IV** — catastrophically breaks confidentiality. Let the library generate it.
- **Encryption is not authentication.** Use AEAD so tampering is detected; a bare cipher lets an attacker flip bits.
- **A signed token is not a secret token** — JWTs are readable by anyone. Don't put PII or secrets in a signed-only payload.

### Handling secrets

- Out of source control, always. API keys, DB passwords, signing keys live in env vars or a secrets manager, injected at runtime. This repo's `protect-secrets.sh` hook blocks reading `.env` and credential files (allow-lists `*.example`/`*.template`/`*.pub`).
- **A secret committed once is compromised forever** — even deleted from a later commit, it's in history. Rotate it; don't just `git rm`.
- Keep secrets out of logs, error messages, exception traces, and analytics.
- Scope every secret to least privilege (SKILL principle 6): read job gets read-only key; webhook verifier needs no write scope.

## Checklist for an authn/authz/secrets diff

1. Is identity derived from the server-side session/token, never from a client-supplied id/role/header?
2. Is there both a function-level check (may this role hit this route) and an object-level check (does this object belong to this actor), the latter on the loaded object?
3. Does authorization default to deny, and live at the lowest layer that has the object (so every transport inherits it)?
4. For sessions: `HttpOnly`+`Secure`+`SameSite`, id rotated on login/privilege change, CSRF covered? For JWT: algorithm pinned, `exp`/`aud`/`iss` validated, no `alg:none`?
5. Is the right crypto primitive used for each job (slow hash for passwords, AEAD for encryption, HMAC/signature for integrity, CSPRNG for tokens), all via a vetted library, all compared constant-time?
6. Do security decisions fail *closed* on error and refuse to start on missing config?
7. Are all secrets out of the repo, logs, and error messages — and is anything ever-committed rotated, not just removed?
