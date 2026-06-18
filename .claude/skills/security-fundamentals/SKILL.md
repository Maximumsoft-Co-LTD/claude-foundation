---
name: security-fundamentals
description: Apply security fundamentals — trust boundaries, input validation, output encoding, authn/authz (deny by default), secrets and crypto, least privilege, and supply-chain hygiene. Use BEFORE writing auth/login/session/token code, input parsing or deserialization, anything that builds a SQL/shell/HTML/LDAP string, crypto/password/secret handling, or adding a dependency. The trigger is any code an untrusted caller can reach or that handles untrusted data, even when no principle is named. Skip throwaway scripts and config with no trust boundary.
---

# Security Fundamentals

## Why this exists

Production security incidents trace back to the same handful of missed fundamentals: the string-concatenated SQL query, broken object-level authorization, the committed API key, the unpatched transitive dep. This skill is a **pre-flight** — read it before writing auth, input handlers, query builders, or crypto. Security is cross-cutting, applied last to whichever layer carries the trust boundary (run order + seams: `.claude/rules/fundamentals.md`); the security-specific pairings are [[programming-fundamentals]] (illegal-state elimination = untrusted input as a distinct type) and [[hexagonal-backend]] (the adapter edge is where you validate). Design-time counterpart to the lead's security review (Mode C, `.claude/agents/lead.md`) — that review is a backstop, not a substitute for this pre-flight.

## The 7 principles

---

### 1. Draw the trust boundary before you write the code

**Rule:** Before the first line, name who can reach this code and what they control. Every input that crosses from a less-trusted zone to a more-trusted one is a boundary, and the boundary is where defenses live.

**Why:** Security is a property of the *path*, not a function — you can't defend what you haven't located. Most injection and access-control bugs aren't "check written wrong" but "never realized this value came from the user." For each untrusted input, ask: who can send this, what can they control, and what's the blast radius if it's hostile? No STRIDE workshop needed — just ask the question before trusting the value.

**How to apply:**
- Mark every input as trusted or untrusted at the point it enters. Treat "from another internal service" as untrusted unless that service is itself authenticated and authorized — internal does not mean safe (server-side request forgery and confused-deputy bugs live here).
- For each untrusted input, write one sentence: *what can the caller control, and what is the blast radius if it is hostile?* A filename controls a path (traversal). A redirect URL controls where the browser goes (open redirect). A user id in the body controls whose data you fetch (IDOR).
- Distinguish authenticated from anonymous reachability. An endpoint reachable before login has a strictly larger attack surface than one behind auth.
- Watch the indirect boundaries: deserialization (the object graph is attacker-controlled), template rendering (the template string may be), regular expressions over user input (catastrophic backtracking — ReDoS), and any value that later becomes part of a command, query, path, or URL.

**Example:**
```ts
// The boundary is invisible until you name it.
// This handler trusts THREE untrusted inputs without realizing it:
app.get('/files/:name', async (req, res) => {
  const path = `./uploads/${req.params.name}`        // name → path traversal (../../etc/passwd)
  const userId = req.query.userId                     // userId → IDOR (whose files?)
  const next = req.query.redirect                     // redirect → open redirect
  res.sendFile(path)
})

// Boundary named, each input's blast radius noted, defenses placed (see principles 2-4):
//  - name: canonicalize + confine to uploads dir (traversal)
//  - userId: ignore it; derive identity from the session (authz, principle 4)
//  - redirect: allow-list of internal paths only (open redirect)
```

---

### 2. Validate input at the boundary — canonicalize *before* you check

**Rule:** Validate every untrusted input where it enters, against an allow-list of what is permitted, *after* reducing it to a single canonical form. Reject what does not match; never try to sanitize hostile input into safe input.

**Why:** A check on a non-canonical input is bypassable — `../`, `..%2f`, `..%252f` are the same path wearing disguises. **Canonicalize first, then validate**: decode, normalize Unicode, resolve the path, lowercase the host, *then* compare. Allow-list over deny-list always: a deny-list enumerates attacks you thought of; the attacker only needs the one you didn't.

**How to apply:**
- Validate at the boundary, once, into a typed value — then the rest of the code works with a value it can trust. This is [[programming-fundamentals]] "parse, don't validate": the output of the boundary is a `Email`, a `SafePath`, a `UserId`, not a raw `string` you re-check everywhere.
- Canonicalize before comparing: URL-decode (until stable), Unicode-normalize (NFC), resolve `..` and symlinks for paths, lowercase hosts. Then check.
- Use allow-lists for format (regex anchored with `^...$`), range (numeric bounds), length (cap it — unbounded input is a DoS vector), and set membership (one of an enum).
- Validation is not output encoding (principle 3). Validating that an input is a well-formed name does **not** make it safe to drop into HTML or SQL — that is the sink's job. Do both.
- For structured input, validate against a schema (zod, pydantic, JSON Schema) and reject unknown fields rather than ignoring them.

**Example:**
```python
# Bad — checks the raw input, attacker sends an encoded form to slip past
def get_file(name: str):
    if ".." in name:                      # deny-list, pre-canonicalization
        raise Forbidden()
    return open(f"/data/{name}")          # name = "%2e%2e%2fsecret" decodes later → escape

# Good — canonicalize, then validate against the real boundary
import os
BASE = "/data"
def get_file(name: str):
    if not re.fullmatch(r"[a-zA-Z0-9._-]{1,64}", name):   # allow-list, anchored
        raise BadRequest()
    full = os.path.realpath(os.path.join(BASE, name))     # canonicalize (resolves .. and symlinks)
    if os.path.commonpath([BASE, full]) != BASE:          # confinement check on canonical form
        raise Forbidden()
    return open(full)
```

---

### 3. Output encoding is contextual — escape for the sink, never "for safety"

**Rule:** Encode data for the specific place it is going — HTML body, HTML attribute, JavaScript, URL, SQL, shell, LDAP — at the moment it goes there. For queries and commands, don't escape at all: parameterize. There is no such thing as generically "sanitized" data.

**Why:** Injection = attacker-controlled data interpreted as code by a downstream parser (SQL, shell, HTML/JS, LDAP). HTML-escaping a value then dropping it in SQL does nothing — contexts have different metacharacters. "I sanitized it" is meaningless without "for what sink." For SQL and shell, the only robust answer is not to build the string at all — one missed escape is a full compromise.

**How to apply:**
- SQL: parameterize. `db.query("... WHERE id = $1", [id])`, never `"... WHERE id = " + id`. Identifiers that can't be parameters (table/column names) must come from an allow-list, never from user input.
- OS commands: pass an argument array to `execFile`/`spawn`/`subprocess.run([...])`, never a string to a shell. If you find yourself reaching for `shell=True` or `exec(cmd)`, stop — restructure so there is no shell.
- HTML: escape contextually (`<`, `>`, `&`, `"`, `'`) and remember the context within HTML differs — body text, attribute value, inside a `<script>`, inside a URL attribute, and inside CSS each need different encoding. Use the framework's auto-escaping (React, Jinja2 autoescape, Razor) and treat any "raw"/`dangerouslySetInnerHTML`/`mark_safe` as a red flag requiring justification.
- URLs: `encodeURIComponent` for query/path segments. LDAP, XML, CSV (formula injection), and shell each have their own escaping; reach for a vetted encoder for that sink, not a hand-rolled regex.
- Encode at the sink, late — not early and stored. Storing pre-escaped data causes double-encoding bugs and means the same value can't be safely reused in a different context.

**Example:**
```ts
// Bad — string-built SQL and a shell command, both injectable
db.query(`SELECT * FROM users WHERE email = '${email}'`)   // ' OR '1'='1
exec(`convert ${filename} out.png`)                        // ; rm -rf /

// Good — parameterized query; argument array, no shell
db.query('SELECT * FROM users WHERE email = $1', [email])
execFile('convert', ['--', filename, 'out.png'])           // argv defeats shell injection; `--` (or rejecting a leading `-`) stops the filename being parsed as a flag

// HTML: let the framework escape; raw insertion is the exception that needs a reason
element.textContent = userComment            // safe — text node, not parsed as HTML
element.innerHTML = userComment              // XSS — userComment = "<img src=x onerror=...>"
```

---

### 4. Authenticate once, authorize every access — deny by default, on the server

**Rule:** Authentication (who are you) happens once per request and establishes identity. Authorization (may you do *this*, to *this object*) happens at every access, on the server, derived from that identity — never from a value the client supplied. Default to deny.

**Why:** **Broken access control is the most common serious web vulnerability** — the happy path works perfectly; the bug only appears when an attacker changes the id in the URL. Authn proves identity; it says nothing about whether this user may read invoice 4012. Deny by default: absence of explicit allow = denial; new endpoints start locked so a forgotten check fails closed. The check must be server-side — a hidden UI element is not authorization.

**How to apply:**
- Derive the actor's identity from the authenticated session/token on the server. Never trust a `userId`, `role`, `isAdmin`, or `tenantId` that arrived in the request body, query string, or a client-set header — those are attacker-controlled (principle 1).
- Authorize the *specific object and action*, not just "is logged in." The check is `can(actor, 'read', invoice)`, and it must run on the actual object you are about to return, after you load it. Function-level checks (is this user an admin) and object-level checks (does this invoice belong to this user) are different; you need both.
- Default deny: route guards and policy checks should reject unless a rule explicitly permits. Prefer a central policy layer over scattered `if (user.role === ...)` checks that drift.
- Sessions and tokens: cookies `HttpOnly` + `Secure` + `SameSite`; rotate the session id on privilege change (login, role elevation) to prevent fixation; short-lived access tokens with refresh; validate JWT signature *and* `alg` (reject `none`), `exp`, `aud`, `iss` — see `references/authn-authz.md`.
- Enforce authorization at the lowest layer that has the object — ideally in the use case / service, so every transport (HTTP, gRPC, job) inherits it, not bolted onto one controller.

**Example:**
```ts
// Bad — authenticated but not authorized; trusts the id and never checks ownership
app.get('/invoices/:id', requireLogin, async (req, res) => {
  const invoice = await db.invoices.find(req.params.id)   // any logged-in user reads ANY invoice
  res.json(invoice)                                       // IDOR — change :id, read the world
})

// Bad — trusts a client-supplied role
if (req.body.role === 'admin') { /* ... */ }              // attacker just sends role=admin

// Good — identity from the session, object-level authz, deny by default
app.get('/invoices/:id', requireLogin, async (req, res) => {
  const invoice = await db.invoices.find(req.params.id)
  if (!invoice) return res.sendStatus(404)
  if (invoice.ownerId !== req.session.userId) return res.sendStatus(404)  // not 403: don't confirm existence
  res.json(invoice)
})
```

---

### 5. Secrets and crypto — vetted primitives, the right tool, never in the repo

**Rule:** Never invent your own cryptography. Use a vetted library, pick the primitive that matches the job (hashing ≠ encryption ≠ signing, and password hashing is its own category), and keep secrets out of source control and out of logs.

**Why:** Crypto is the one area where "looks correct and round-trips" is no evidence of security — a reused nonce destroys a stream cipher, a non-constant-time compare leaks a token byte by byte, and a fast hash for passwords means an attacker brute-forces the DB overnight. Choosing the wrong primitive is as fatal as a weak one: encryption ≠ integrity, signature ≠ confidentiality, passwords need a *slow* hash. Call the vetted library for the purpose it was built for; tune the cost, don't replace the algorithm.

**How to apply:**
- Passwords → `argon2id` (preferred), `scrypt`, or `bcrypt`. Never a general-purpose hash, never homegrown salting. The library handles the salt and work factor; tune the cost, don't replace the algorithm.
- Symmetric encryption → authenticated encryption (AES-GCM, ChaCha20-Poly1305) via libsodium / your platform's vetted module. Never ECB. Never reuse a nonce. If you're choosing a mode by hand, you're already in danger.
- Integrity/authenticity → HMAC (shared secret) or a digital signature (asymmetric, e.g. Ed25519). Compare MACs and tokens with a **constant-time** comparison (`crypto.timingSafeEqual`, `hmac.compare_digest`), never `==`.
- Randomness for anything security-relevant (tokens, ids, nonces, salts) → a CSPRNG (`crypto.randomBytes`, `secrets.token_bytes`), never `Math.random()` / `random.random()`.
- Secrets (API keys, DB passwords, signing keys) → environment / a secrets manager, injected at runtime. Never committed — and this repo's `protect-secrets.sh` hook blocks reading `.env` and credential files for exactly this reason. Keep them out of logs, error messages, and exception traces, and assume any secret ever committed (even removed in a later commit) is compromised and must be rotated.
- See `references/authn-authz.md` for the password-hashing and primitive-selection decision rules.

**Example:**
```python
# Bad — homemade "encryption", fast hash for passwords, leaky comparison
token = base64.b64encode(user_id.encode())          # encoding, not encryption — trivially reversed
pw_hash = hashlib.sha256(password.encode()).digest()  # fast hash → whole DB cracked offline
if provided_token == stored_token: ...                # timing leak — guess the token byte by byte

# Good — vetted primitives, right tool for each job, constant-time compare
from argon2 import PasswordHasher                     # slow, salted, tuned
ph = PasswordHasher()
pw_hash = ph.hash(password)                           # store this; verify with ph.verify()

import secrets, hmac
token = secrets.token_urlsafe(32)                     # CSPRNG, unguessable
if hmac.compare_digest(provided_token, stored_token): ...  # constant-time
```

---

### 6. Least privilege and secure defaults — fail closed

**Rule:** Every actor — a token, a DB user, a service account, a file, a CORS policy — gets the minimum scope it needs and nothing more. The default state, and the state on error, is the restrictive one.

**Why:** Least privilege turns a compromise into an incident instead of a catastrophe — blast radius is bounded by what you granted. Granting broad access "to be safe" makes every small breach total. Failing closed is the same instinct on the unhappy path: when an auth check throws, deny; insecure defaults (debug in prod, `cors: *` with credentials, default admin passwords, verbose errors to clients) are vulnerabilities shipped on purpose.

**How to apply:**
- Scope tokens, API keys, and OAuth grants to the narrowest set of actions and resources. A read job gets a read-only token. A webhook verifier needs no write scope.
- The application's DB user is not the schema owner. Grant only the DML it needs; keep DDL and superuser for migrations run separately. One injection then can't reshape the database.
- File and process permissions: least privilege on what you write (no world-writable), run services as a non-root user, drop capabilities you don't need.
- Fail closed: a thrown authz check denies; a missing required config refuses to start rather than defaulting to permissive; an unparseable token is rejected. Never `catch { return true }` on a security decision (see `team-silent-failure-hunter` territory).
- Secure defaults in config: CORS to an explicit origin allow-list (not `*` with credentials), cookies secure by default, TLS required, debug/verbose errors off in production, no default credentials. Send generic error messages to clients; keep the detail in server logs.

**Example:**
```ts
// Bad — broad scope, open defaults, fails open
const db = connect({ user: 'postgres' })              // superuser runs the web app
app.use(cors({ origin: '*', credentials: true }))     // any site can make credentialed calls
function canAccess(u, r) {
  try { return policy.check(u, r) }
  catch { return true }                               // fails OPEN — error → access granted
}

// Good — least privilege, explicit allow-list, fails closed
const db = connect({ user: 'app_rw' })                // SELECT/INSERT/UPDATE on app tables only
app.use(cors({ origin: ['https://app.example.com'], credentials: true }))
function canAccess(u, r) {
  try { return policy.check(u, r) }
  catch (e) { log.error(e); return false }            // fails CLOSED — error → denied
}
```

---

### 7. Dependencies and the supply chain — pin, patch, minimize

**Rule:** Treat every dependency as code you ship and are responsible for. Pin versions with a lockfile, watch for known vulnerabilities, and import as little as you can get away with.

**Why:** A CVE in a transitive dep is as exploitable as one in your own code — unpatched known vulnerabilities are a perennial OWASP top entry. The supply chain is an attack surface: typosquatted names, malicious updates, compromised maintainers, `postinstall` scripts that exfiltrate your env. Every package = trust extended to its whole dependency tree and everyone who can publish to it.

**How to apply:**
- Commit the lockfile (`package-lock.json`, `poetry.lock`, `Cargo.lock`; in Go, `go.mod` pins and `go.sum` verifies) and build from it (`npm ci`, not `npm install`) so the exact resolved tree is reproducible and a surprise version can't appear between builds.
- Run a vulnerability scanner in CI (`npm audit`, `pip-audit`, `osv-scanner`, Dependabot/Renovate) and treat a high-severity advisory in a reachable path as a blocker, not a someday.
- Minimize: prefer the standard library or a small, well-maintained package over a sprawling one. A left-pad-sized dependency is a left-pad-sized risk. Audit a new dependency's own tree before adding it.
- Pin and review updates. Auto-merging dependency bumps without a lockfile-diff review is how a compromised release lands. Be especially wary of install-time scripts (`postinstall`) from packages you don't control.
- Don't run untrusted code with your privileges: avoid `eval` of remote content, sandbox plugins, and verify integrity (subresource integrity for CDN scripts, checksums for downloaded binaries).

**Example:**
```jsonc
// Bad — floating ranges, no lockfile discipline; "install" re-resolves every build
// package.json
{ "dependencies": { "leftpad-clone": "^2.0.0" } }   // ^ silently pulls a malicious 2.4.0
// CI: npm install            ← may resolve a different tree than you tested

// Good — lockfile committed, reproducible install, scanned in CI
// CI:
//   npm ci                   ← builds the exact locked tree, fails on lockfile drift
//   npm audit --audit-level=high   ← high-severity CVE in a reachable dep blocks the build
```

---

## Pre-flight checklist

Before writing code that an untrusted party can reach or that handles untrusted data, run through these in your head:

1. **Trust boundary:** have I named who can reach this code and what each untrusted input controls (its blast radius if hostile)? Did I treat internal callers and deserialized/templated data as untrusted too?
2. **Input:** is every untrusted input validated at the boundary against an anchored allow-list, *after* canonicalization (decode, normalize, resolve)? Is it parsed into a trusted typed value rather than re-checked everywhere?
3. **Output:** is every value bound for SQL parameterized (not concatenated), every subprocess called with an argument array (no shell), and every value bound for HTML/URL/LDAP encoded for *that* sink?
4. **AuthN/AuthZ:** is identity derived from the server-side session/token (never from a client-supplied id/role)? Is every access authorized on the specific object and action, defaulting to deny?
5. **Secrets & crypto:** am I using a vetted library and the right primitive (slow hash for passwords, AEAD for encryption, HMAC/signature for integrity, CSPRNG for tokens, constant-time compare)? Is every secret out of the repo, logs, and error messages?
6. **Least privilege & defaults:** does every token/DB user/file/CORS policy have the minimum scope? Does every security decision fail *closed* on error or missing config?
7. **Dependencies:** is the lockfile committed and the build reproducible (`ci`, not `install`)? Is a vulnerability scanner running, and is the new dependency's tree small and trustworthy?

If any answer is "I don't know," stop and find out before writing.

## When to skip this skill

- Throwaway scripts and prototypes with no untrusted input that will be deleted within the hour.
- Pure config or formatting edits with no trust boundary (env var names, prettier rules, a CI cache key).
- Internal tooling that only the author runs on their own machine against their own data, reachable by no one else.
- Generated boilerplate you are about to delete or that has no logic and no inputs.

For anything else — a request handler, a login or session flow, a parser or deserializer, anything that builds a query/command/markup string, crypto or secret handling, or adding a dependency — these fundamentals apply. When unsure whether an input is untrusted, assume it is.

## How to use this skill in a conversation

Always-on for security-relevant work (the router owns the trigger — don't ask the user to opt in). If the task matches "When to skip", say so in one sentence and proceed. This is the design-time half of `/dev` security; the lead's security review backstop is noted under "Why this exists".

When the skill applies:
- **Request handler / parser** — name the trust boundary first; state what each untrusted input controls before you use it.
- **Query or command** — parameterize / argument array by default; if you ever build a SQL or shell string by concatenation, justify it out loud.
- **Auth** — separate authn from authz explicitly; say which check is identity and which is per-object access; confirm both run server-side.
- **Crypto / secrets** — name the primitive and why it fits the job; never hand-roll, never log a secret.

Non-obvious calls (404 vs 403 to avoid confirming existence, optimistic token validation, large-tree dependency): say *why* in one sentence. Cite the specific pitfall — don't emit code silently.

## Reference files

Deeper guides for individual principles. Read the one that matches the work in front of you; you don't need to read them all upfront.

- `references/input-and-output.md` — validation and canonicalization patterns, the injection classes (SQL, command, XSS, path traversal, SSRF, deserialization) with concrete before/after fixes, contextual output encoding per sink, and "do this not that" tables.
- `references/authn-authz.md` — session vs token (cookies, JWT validation pitfalls), deny-by-default authorization, the common broken-access-control patterns (IDOR, missing function-level checks, mass assignment), and a secrets/crypto primitive-selection decision guide.
