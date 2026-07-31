---
name: security-fundamentals
description: Apply security fundamentals to auth/session/token code, untrusted input, SQL/shell/HTML/file/network sinks, secrets, crypto, dependencies, and other trust boundaries. Covers canonical validation, contextual output safety, deny-by-default authorization, vetted primitives, least privilege, and supply-chain hygiene. Skip work with no untrusted boundary.
---

# Security fundamentals

This is cross-cutting. Load it in addition to one primary construction skill
when a trust boundary is present.

## Rules

1. Name the actor, trust boundary, controlled inputs, assets, and failure blast
   radius before coding.
2. Canonicalize then validate at ingress with an anchored allow-list; turn
   accepted input into a trusted type.
3. Parameterize SQL and subprocess arguments. Encode output for its exact
   HTML/URL/LDAP sink. Validate resolved file paths and outbound destinations.
4. Derive identity from a verified server-side session/token. Authorize the
   specific action and object every time; default to deny and fail closed.
5. Use vetted primitives: slow password hash, AEAD encryption, signature/HMAC
   integrity, CSPRNG tokens, constant-time secret comparison. Never invent
   crypto or log secrets.
6. Give users, services, DB roles, tokens, files, and CORS policies the minimum
   scope and lifetime.
7. Minimize, pin, review, and scan dependencies; treat install scripts and
   transitive code as shipped code.

## Check before finishing

- Are authn and authz distinct, server-side, and covered for cross-user access?
- Do missing config, parser errors, and dependency failure remain restrictive?
- Are secrets absent from code, logs, URLs, errors, and artifacts?
- Are replay, fixation, CSRF, SSRF, traversal, injection, and mass assignment
  relevant, and if so tested?

References: `references/authn-authz.md`, `input-and-output.md`, and
`trust-and-hardening.md`. Read only the matching threat/sink.
