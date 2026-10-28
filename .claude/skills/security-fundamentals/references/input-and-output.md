# Input validation and output encoding

Injection is attacker-controlled data read as instructions by a downstream
interpreter. Two defenses, both required: validate on the way in, encode or
parameterize on the way out.

## Canonicalize, then validate against an allow-list

A check on a non-canonical form is bypassable: `../`, `..%2f`, `..%252f`,
`....//`, and `..%c0%af` are the same path in disguise.

Order: decode until stable → Unicode-normalize (NFC) → resolve (`..`,
symlinks, host case) → compare against the allow-list. For paths, resolve to
an absolute real path and confirm it is under the base directory.

```python
BASE = "/data"
def get_file(name: str):
    if not re.fullmatch(r"[a-zA-Z0-9._-]{1,64}", name):   # anchored allow-list
        raise BadRequest()
    full = os.path.realpath(os.path.join(BASE, name))     # canonical form
    if os.path.commonpath([BASE, full]) != BASE:          # confinement
        raise Forbidden()
    return open(full)
```

| Goal | Do this | Not that |
|---|---|---|
| Username | `^[a-z0-9_]{3,32}$` | strip characters you think are bad |
| File extension | one of `{".png", ".jpg"}` | reject `.exe`, `.sh` (you will miss `.svg`) |
| Sort column | `column in {"name","created_at"}` | escape the column name into SQL |
| Redirect target | known internal path set | "must start with our domain" |
| Numeric input | parse to int + range check | regex for "looks numeric" |

Anchor every regex. Cap length on everything; unbounded input is a DoS vector.

## Parse, don't validate

Validate once at the edge into a typed value (`Email`, `SafePath`,
`PositiveInt`); downstream code cannot forget a check it never had to make.
Use a schema validator (zod, pydantic, JSON Schema) for structured input and
reject unknown fields; silently ignoring extras is how mass assignment hides.

## Encode for the sink, or do not build the string

- **SQL:** parameterize values (`WHERE id = $1`). Identifiers and keywords
  cannot be parameters; map them through a server-side allow-list. Scrutinize
  every ORM raw-SQL escape hatch.
- **OS commands:** argument array (`execFile`, `subprocess.run([...])`), never
  a string to a shell. Pass `--` or reject a leading `-` so the value cannot
  become a flag.
- **HTML/JS:** escaping is per context (body, attribute, JS string, URL
  attribute, CSS). Let the framework auto-escape; every raw opt-out
  (`dangerouslySetInnerHTML`, `v-html`, `innerHTML`, `mark_safe`) needs a
  written reason and DOMPurify with an allow-list. A `Content-Security-Policy`
  without inline script is a backstop, not a substitute.
- **Other sinks:** `encodeURIComponent` per URL segment; RFC 4515 escaping for
  LDAP; prefix `= + - @` cells for CSV; strip CR/LF from header and log values;
  allow-list redirect targets.
- Encode at the sink, late. Stored pre-escaped data double-encodes and cannot
  be reused in another context.

```ts
db.query('SELECT * FROM users WHERE email = $1', [email])
execFile('convert', ['--', filename, 'out.png'])
el.textContent = userComment            // safe text node
```

## Injection classes

| Class | Fix |
|---|---|
| SQL injection | parameterize; allow-list identifiers |
| Command injection | argument array, no shell |
| XSS | contextual escaping + CSP; avoid raw-HTML sinks |
| Path traversal | canonicalize + confine to a base dir |
| SSRF | allow-list hosts; reject private/loopback IPs on the resolved address; no redirects; egress proxy |
| Insecure deserialization | data-only formats (JSON) + schema; never `pickle`/`Marshal`/native |
| XXE | disable external entities and DTDs |
| ReDoS | linear-time regex, length cap, timeout |
| Template injection | never build templates from user input |

## Checklist for an input-handling diff

1. Every untrusted input identified where it enters (body, query, header,
   path, upload name, queue message, deserialized field)?
2. Each canonicalized before any check, then validated against an anchored
   allow-list for format, range, length, and set?
3. Boundary produces a typed value rather than a raw string re-checked later?
4. All SQL parameterized, all subprocesses argument arrays?
5. Every HTML/URL/LDAP/CSV/header value encoded for that sink; every raw-HTML
   opt-out justified and sanitized?
6. Server-side fetch of a user URL: host allow-list, resolved-IP check, no
   redirects?
7. Untrusted data never deserialized into live objects?
