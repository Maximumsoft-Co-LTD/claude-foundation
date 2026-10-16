# Invoice archive

Builds storage paths for rendered invoice PDFs (Node.js). Paths are stored in
the billing database and linked from customer emails, so an existing invoice
must always map to the same path.

`invoicePath({ customer, number, title })` from `src/invoice.js` returns
`invoices/<customer-slug>/<number>-<title_slug>.pdf`.

Dependencies are vendored under `vendor/` and installed offline:

```sh
npm ci --ignore-scripts --offline
npm test
```

Security has asked us to move to slugkit 2.0.0 (already vendored under
`vendor/slugkit-2.0.0`); 1.x no longer receives fixes. Vendored packages are
upstream copies and must not be edited.
