# docs-static

Serves the product documentation site from `public/` (Node.js, no
dependencies).

`createStaticHandler(root)` from `src/static.js` returns `handle(urlPath)`,
which resolves `{ status, contentType, body }` (`body` is a Buffer or a string).
`urlPath` is the raw request path, percent-encoded and possibly with a query
string. `node bin/serve.js` serves `public/` over HTTP on `PORT` (default 8000).

- Existing files under the root: 200 with a content type from the extension.
- Missing files and directories: 404.
- Only files inside the root may ever be served.
