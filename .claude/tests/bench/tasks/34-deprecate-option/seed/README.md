# rows2csv

Converts JSON row files to CSV (Node.js, no dependencies). Reporting jobs call
both the library and the CLI, so option names are public contracts.

## Library

`require("rows2csv").toCsv(rows, { sep = "," })` turns an array of flat objects
into CSV text. The header comes from the keys of the first row; a value that
contains the separator, a double quote, or a newline is quoted with `"` and
inner quotes are doubled. Every line ends with `\n`.

## CLI

```text
rows2csv [--sep <char>] <file.json>...
```

Each file holds a JSON array of rows. The CSV for every file is written to
stdout in argument order. Exit codes: 0 success, 1 usage error (unknown option,
missing value, no files), 2 a file cannot be read or parsed. Nothing is written
to stdout when the exit code is not 0.
