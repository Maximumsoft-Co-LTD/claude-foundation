# Authentication, authorization, secrets, crypto

Authentication establishes identity once per request. Authorization runs at
every access, on the server, derived from that identity. Most serious web bugs
are authorization failures: the happy path works until an attacker increments
an id.

## Sessions vs tokens

**Cookie sessions:** server-side state, opaque id in a cookie, trivial
revocation. `Set-Cookie: sid=...; HttpOnly; Secure; SameSite=Lax`. Rotate the
session id on every privilege change (login, step-up); not rotating is session
fixation. Add a CSRF token for state-changing forms `SameSite` does not cover.

**JWT:** stateless, cheap to scale, hard to revoke; use short-lived access
tokens plus a refresh token with a denylist. Validate all of: signature with
the algorithm pinned (reject `alg: none` and RS256→HS256 confusion), `exp`,
`nbf`, `aud`, `iss`. A JWT is signed, not encrypted; never put secrets in it.

```ts
jwt.verify(token, key, { algorithms: ['RS256'], issuer: 'auth.example.com', audience: 'api' })
```

**Passwords:** prefer an identity provider. If you store them: `argon2id`
(first choice), `scrypt`, or `bcrypt`; never SHA-256/MD5; verify with the
library's constant-time `verify`; rate-limit and use one generic error for
"wrong password" and "no such user".

## Authorization: deny by default, per object, server-side

The check is `can(actor, action, resource)`: actor from the server-side
session, action the specific operation, resource the object you actually
loaded. Two layers fail differently: function-level ("may this role hit this
route") and object-level ("does this invoice belong to this user"); missing
the second is IDOR/BOLA, the most common high-impact web bug.

| Pattern | Fix |
|---|---|
| IDOR / BOLA | load the object, then deny unless `obj.ownerId === actor.id` |
| Missing function-level check | server-side route guard, not a hidden UI link |
| Mass assignment | bind an explicit field allow-list; reject unknown fields |
| Trusting client role | derive role from the server-side principal |
| Forced browsing | authorize the resource, not the presence of a link |

```ts
const doc = await db.docs.find(id)
if (!doc || doc.ownerId !== req.session.userId) return res.sendStatus(404)  // not 403: do not confirm existence
return res.json(doc)
```

Enforce at the lowest layer that has the object (the use case), so every
transport inherits it. Absence of explicit allow is deny; when a check errors,
deny; missing required config refuses to start.

## Secrets and crypto: pick the primitive

| You want to… | Use | Not |
|---|---|---|
| Store a password | `argon2id` / `scrypt` / `bcrypt` | SHA-256, MD5, encryption |
| Hide data | AEAD: AES-GCM or ChaCha20-Poly1305 | ECB, cipher without an auth tag |
| Prove integrity (shared secret) | HMAC-SHA256 | `H(secret + data)` |
| Prove origin (public verification) | Ed25519 or RSA-PSS signature | HMAC |
| Token / id / nonce / salt | CSPRNG (`crypto.randomBytes`, `secrets.token_bytes`) | `Math.random()`, timestamps |
| Compare secrets | `timingSafeEqual`, `compare_digest` | `==` |

Never roll your own crypto; never reuse a nonce; encryption is not
authentication; a signed token is not a secret token.

Secrets live in env vars or a secrets manager, injected at runtime, never in
source control, logs, error messages, or traces. A secret committed once is
compromised forever: rotate it. Scope every secret to least privilege.

## Checklist for an authn/authz/secrets diff

1. Identity from the server-side session/token, never a client-supplied id,
   role, or header?
2. Both a function-level and an object-level check, the latter on the loaded
   object?
3. Deny by default, enforced at the lowest layer that has the object?
4. Sessions `HttpOnly`+`Secure`+`SameSite`, rotated on privilege change, CSRF
   covered; JWT algorithm pinned, `exp`/`aud`/`iss` validated?
5. Right primitive per job via a vetted library, constant-time comparison?
6. Security decisions fail closed; missing config refuses to start?
7. Secrets out of the repo, logs, and errors; anything ever committed rotated?
