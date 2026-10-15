# Product search

`createCatalog(records)` from `src/search.js` builds a searchable catalog of
product records `{ id, title, tags? }`. Records are treated as immutable once
the catalog is created.

`catalog.search(query, { limit = 20 })` returns up to `limit` hits shaped
`{ id, title, score }`:

- Text is compared case-insensitively and without accents, split into words on
  anything that is not a letter or a digit.
- Every query word must match a word of the title or tags: an exact word scores
  2, a word that merely starts with it scores 1. A query with no words returns
  no hits.
- Only the first matching record for an id is returned.
- Hits are ordered by score, highest first; equal scores keep catalog order.

`npm run bench` prints the current search timing on a generated catalog.
