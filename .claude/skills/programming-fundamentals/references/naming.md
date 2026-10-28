# Naming

A name should let the reader skip reading the body.

- **Variables:** name what the value represents, not how it was computed
  (`activeUsers`, not `filteredUserList`). Encode units (`timeoutMs`,
  `priceCents`). Booleans read as questions (`isReady`, `canRetry`). Do not
  abbreviate domain words.
- **Functions:** value-returning functions are named for the value
  (`totalCents()`); acting functions for the action (`sendInvoice()`). A name
  that needs "and" is two functions. Avoid `handle`, `process`, `manage`,
  `do`. Keep pairs symmetric (`open`/`close`, `acquire`/`release`).
- **Types:** named for the domain meaning (`Money`, not
  `IntegerWithCurrency`). `Data`, `Info`, `Manager`, `Helper`, `Util` mean the
  type has no identity yet.
- **Files and folders:** file name matches the primary export; folder names
  describe the role (`payments/`), not the technology (`stripe/`).

Smells: `data`/`temp`/`result` as return values or fields; `getX` that does
I/O (use `fetch`/`load`); `utils`/`common` graveyards; Hungarian notation in
typed languages. Short mathematical names and spec-matching names are fine in
context. Read the line aloud: if a teammate would ask "what is `proc_data`?",
rename.
