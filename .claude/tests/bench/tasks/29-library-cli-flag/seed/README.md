# wordstat

A tiny text-statistics library and CLI (Node.js, no dependencies). Other teams
import the library and call the CLI from shell scripts, so both are public
contracts.

## Library

`require("wordstat")` exports `countText(text)`, which returns
`{ words, lines, chars }`:

- `words`: runs of non-whitespace characters.
- `lines`: newline-terminated lines, plus one for trailing text without a newline.
- `chars`: Unicode code points.

## CLI

```text
wordstat <file>
```

Prints three lines to stdout:

```text
words: 12
lines: 3
chars: 64
```

Exit codes are stable and scripts depend on them:

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | usage error (missing file argument, unknown option, extra arguments); usage goes to stderr |
| 2 | the file cannot be read; the reason goes to stderr |

Nothing is written to stdout when the exit code is not 0.
