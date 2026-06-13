# Input and Output Handling

Injection is one bug wearing many costumes: a value the attacker controls crosses into an interpreter (SQL parser, shell, HTML/JS engine, filesystem, LDAP, an HTTP client) and gets read as instructions instead of data. The two defenses are symmetric: **validate on the way in** (is this the shape I expect?) and **encode/parameterize on the way out** (keep this on the data side of the sink). They are not interchangeable — you need both, because validation can't know every downstream sink and encoding can't know business rules.

## Validation: at the boundary, allow-list, canonical-first

### Canonicalize, *then* check

A check that runs against a non-canonical form is bypassable. The same logical value has many encodings; the attacker picks one that fails your check but is decoded into the dangerous form by the downstream interpreter.

```
../../etc/passwd          # raw
..%2f..%2fetc%2fpasswd    # URL-encoded
..%252f..                 # double-encoded (decoded once by proxy, again by app)
....//                     # nested — strip-once "../" → "../"
..%c0%af                   # overlong UTF-8 encoding of ../ (decodes past naive filters)
```

Order: **decode until stable → Unicode-normalize (NFC) → resolve (`..`, symlinks, case for hosts) → THEN compare against the allow-list.** For paths, resolve to an absolute real path and confirm it is under the intended base directory (`commonpath`/`startsWith` on the *resolved* path, not the input).

### Allow-list, not deny-list

| Goal | Do this | Not that |
|---|---|---|
| Username | `^[a-z0-9_]{3,32}$` (anchored) | strip out characters you think are bad |
| File extension | one of `{".png", ".jpg"}` | reject `.exe`, `.sh`, … (you'll miss `.svg`) |
| Sort column | `column in {"name","created_at"}` | escape the column name into SQL |
| Redirect target | one of a known internal path set | "must start with our domain" (`evil.com?x=ourdomain.com`) |
| Numeric input | parse to int + range check | regex for "looks numeric" |

A deny-list is a list of attacks you've thought of; the attacker only needs the one you haven't. Anchor every regex with `^...$` (an unanchored `[a-z]+` matches a substring of hostile input). Cap length on everything — unbounded input is a denial-of-service vector (huge body, ReDoS via catastrophic backtracking, billion-laughs XML).

### Parse, don't validate

Validate once at the edge into a *typed* value, then the rest of the code can't forget. This is the [[programming-fundamentals]] instinct: the boundary returns an `Email`, a `SafePath`, a `PositiveInt` — not a `string` everyone re-checks (and someone eventually doesn't).

```ts
// Boundary returns a branded type; downstream can't pass a raw string
type Email = string & { readonly __brand: 'Email' }
function parseEmail(raw: unknown): Email {
  if (typeof raw !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw) || raw.length > 254)
    throw new BadRequest('email')
  return raw.toLowerCase() as Email
}
```

Use a schema validator for structured input (zod, pydantic, JSON Schema) and **reject unknown fields** rather than silently dropping them — silently ignoring extra fields is how mass-assignment bugs hide (see authn-authz.md).

## Output: encode for the sink, or don't build the string at all

### SQL — parameterize, never concatenate

```ts
// Injectable
db.query(`SELECT * FROM users WHERE email = '${email}' AND active = ${active}`)
//   email = "x' OR '1'='1"  → returns every row

// Safe — value travels in a separate channel the parser never treats as SQL
db.query('SELECT * FROM users WHERE email = $1 AND active = $2', [email, active])
```

Parameters cover *values*. They cannot parameterize **identifiers** (table/column names) or **keywords** (`ASC`/`DESC`). Those must come from a server-side allow-list:

```ts
const SORT = { name: 'name', date: 'created_at' } as const   // allow-list maps input → real column
const col = SORT[req.query.sort] ?? 'created_at'             // unknown → safe default
db.query(`SELECT * FROM users ORDER BY ${col} ${req.query.dir === 'asc' ? 'ASC' : 'DESC'}`)
```

ORMs parameterize automatically — until you reach for a raw-SQL escape hatch (`db.raw`, `text()`, string-interpolated `WHERE`). Those are the lines to scrutinize.

### OS commands — argument array, no shell

```python
# Injectable: a shell parses the string, so ; | $() & all become operators
os.system(f"convert {filename} out.png")        # filename = "x.png; rm -rf /"
subprocess.run(f"convert {filename} out.png", shell=True)   # same hole

# Safe from SHELL injection: no shell, filename is one opaque argument.
# Still pass `--` (or reject a leading `-`) so it can't be parsed as a flag by the tool itself
subprocess.run(["convert", filename, "out.png"])            # shell=False is the default
```

If you think you *need* a shell (pipes, globbing), you almost always don't — do the piping in code, or pass a fixed command with the untrusted part as an argument. `shell=True`, `os.system`, backticks, and `eval`/`exec` on anything attacker-influenced are red flags requiring justification.

### HTML/JS — contextual escaping; the context within HTML matters

Escaping is per-context. The same value needs different treatment in each place:

| Context | Example sink | Encoding needed |
|---|---|---|
| HTML body | `<p>HERE</p>` | `< > & " '` → entities |
| HTML attribute | `<div title="HERE">` | entity-encode + always quote the attribute |
| JS string | `<script>var x = "HERE"</script>` | JS string escaping (or better: pass via `JSON.stringify`/data attribute) |
| URL in `href`/`src` | `<a href="HERE">` | URL-encode + validate scheme (`javascript:` is XSS) |
| CSS value | `<div style="width:HERE">` | CSS escaping (rare; avoid) |

Let the framework do it. React, Vue, Angular, Jinja2 (`autoescape`), Razor escape HTML by default. The dangerous APIs are the opt-outs: `dangerouslySetInnerHTML`, `v-html`, `innerHTML`, `mark_safe`, `| safe`, `Html.Raw`. Each is a place auto-escaping is turned off — treat every one as needing a written reason, and if the content is user-derived, run it through a vetted sanitizer (DOMPurify) configured with an allow-list of tags/attributes.

```ts
el.textContent = comment    // safe: a text node, never parsed as markup
el.innerHTML  = comment     // XSS: comment = '<img src=x onerror=alert(document.cookie)>'
```

Defense in depth for XSS: a `Content-Security-Policy` that disallows inline script turns many injection bugs from exploitable into inert. It's a backstop, not a substitute for encoding.

### Other sinks, same rule

- **URL building** — `encodeURIComponent` each user-supplied path/query segment; don't string-concat into a URL.
- **LDAP** — escape `( ) * \ NUL` per RFC 4515; use the driver's escaping function, not a hand-rolled one.
- **CSV / spreadsheets** — formula injection: a cell starting with `= + - @` is executed by Excel/Sheets. Prefix with `'` or reject.
- **Headers / log lines** — strip CR/LF from any user value put into an HTTP header (response splitting) or a log line (log forging).
- **Redirects** — validate the target against an allow-list of internal paths; never `redirect(req.query.next)` raw (open redirect → phishing).

## The injection classes, with the fix in one line each

| Class | What it is | Fix |
|---|---|---|
| SQL injection | user value parsed as SQL | parameterize; allow-list identifiers |
| Command injection | user value parsed by a shell | argument array, no `shell=True` |
| XSS (stored/reflected/DOM) | user value parsed as HTML/JS | contextual escaping + CSP; avoid raw-HTML sinks |
| Path traversal | user value escapes a directory | canonicalize + confine to a base dir |
| SSRF | user value becomes a URL the server fetches | allow-list hosts; block internal/metadata IPs; no redirects |
| Insecure deserialization | attacker controls the object graph | don't deserialize untrusted data into live objects; use data-only formats (JSON) + schema, never `pickle`/`Marshal`/Java native |
| XXE | user XML references external entities | disable external entities / DTDs in the parser |
| ReDoS | user input triggers catastrophic backtracking | linear-time regex, input length cap, timeout |
| Template injection | user value is part of the template, not the data | never build templates from user input; pass it as a variable |

### SSRF deserves a note

Server-Side Request Forgery: the server fetches a URL the user supplied (webhook, image proxy, link preview), and the attacker points it at `http://169.254.169.254/` (cloud metadata, credentials) or `http://localhost:6379/` (internal Redis). Validating the URL string isn't enough — DNS rebinding and redirects defeat it. Defenses, layered: allow-list the destination hosts you actually need; resolve the hostname and reject private/loopback/link-local IP ranges *on the resolved address*; disable following redirects; use a dedicated egress proxy with no access to the internal network.

## Checklist for an input-handling diff

1. Is every untrusted input identified at the point it enters (body, query, header, path, upload name, queue message, deserialized field)?
2. Is each one canonicalized **before** any check, then validated against an anchored allow-list (format, range, length, set)?
3. Does the boundary produce a typed value the rest of the code trusts, rather than a raw string re-checked downstream?
4. Is every SQL built with parameters (identifiers from an allow-list), every subprocess called with an argument array (no shell)?
5. Is every value bound for HTML/URL/LDAP/CSV/headers encoded for *that* sink, and is every raw-HTML opt-out justified and sanitized?
6. For any server-side fetch of a user URL: host allow-list, resolved-IP check, no redirects?
7. Is untrusted data ever deserialized into live objects (pickle/native)? If so, replace with a data-only format plus schema validation.
