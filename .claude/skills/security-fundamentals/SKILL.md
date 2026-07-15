---
name: security-fundamentals
description: Apply security fundamentals — trust boundaries, input validation, output encoding, authn/authz (deny by default), secrets and crypto, least privilege, and supply-chain hygiene. Use BEFORE writing auth/login/session/token code, input parsing or deserialization, anything that builds a SQL/shell/HTML/LDAP string, crypto/password/secret handling, or adding a dependency. The trigger is any code an untrusted caller can reach or that handles untrusted data, even when no principle is named. Skip throwaway scripts and config with no trust boundary.
---

# Security Fundamentals

## Why this exists

Production security incidents trace back to the same handful of missed fundamentals: the string-concatenated SQL query, broken object-level authorization, the committed API key, the unpatched transitive dep. This skill is a **pre-flight** — read it before writing auth, input handlers, query builders, or crypto. Security is cross-cutting, applied last to whichever layer carries the trust boundary (run order + seams: `.claude/rules/fundamentals.md`); the security-specific pairings are [[programming-fundamentals]] (illegal-state elimination = untrusted input as a distinct type) and [[hexagonal-backend]] (the adapter edge is where you validate). Design-time counterpart to the lead's security review (Mode C, `.claude/agents/lead.md`) — that review is a backstop, not a substitute for this pre-flight.

## The 7 principles

Full rule/why/how-to-apply/example for each lives in the linked reference file.

| # | Principle | Compressed rule | Reference |
|---|---|---|---|
| 1 | Draw the trust boundary before you write the code | Name who can reach this code and what they control. Every input crossing from a less-trusted zone to a more-trusted one is a boundary — that's where defenses live. | `references/trust-and-hardening.md` |
| 2 | Validate input at the boundary — canonicalize *before* you check | Decode/normalize/resolve to a single canonical form, then check against an anchored allow-list. Never sanitize hostile input into safe input. | `references/input-and-output.md` |
| 3 | Output encoding is contextual — escape for the sink, never "for safety" | Encode for the specific destination (HTML/JS/URL/SQL/shell/LDAP) at the point of use. For queries and commands, parameterize instead of escaping. | `references/input-and-output.md` |
| 4 | Authenticate once, authorize every access — deny by default, on the server | Identity comes once from the server-side session/token. Authorization checks the specific object *and* action on every access, denying unless explicitly allowed. | `references/authn-authz.md` |
| 5 | Secrets and crypto — vetted primitives, never in the repo | Use a vetted library and the primitive that matches the job (slow hash for passwords, AEAD for encryption, HMAC/signature for integrity, CSPRNG for tokens). Secrets from a manager, never committed. | `references/authn-authz.md` |
| 6 | Least privilege and secure defaults — fail closed | Every actor gets the minimum scope it needs. The default state, and the state on error, is the restrictive one — never fail open. | `references/trust-and-hardening.md` |
| 7 | Dependencies and the supply chain — pin, patch, minimize | Lockfile-pinned, scanned in CI, and minimized. Treat every dependency as code you ship and are responsible for. | `references/trust-and-hardening.md` |

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

- `references/input-and-output.md` — validation and canonicalization patterns, the injection classes (SQL, command, XSS, path traversal, SSRF, deserialization) with concrete before/after fixes, contextual output encoding per sink, and "do this not that" tables; principles 2 and 3's full rule/why/how-to-apply/example.
- `references/authn-authz.md` — session vs token (cookies, JWT validation pitfalls), deny-by-default authorization, the common broken-access-control patterns (IDOR, missing function-level checks, mass assignment), and a secrets/crypto primitive-selection decision guide; principles 4 and 5's full rule/why/how-to-apply/example.
- `references/trust-and-hardening.md` — naming the trust boundary end to end, least-privilege/fail-closed defaults for tokens/DB users/CORS, and dependency/supply-chain hygiene (lockfiles, scanning, minimizing, install-time scripts); principles 1, 6, and 7's full rule/why/how-to-apply/example.
