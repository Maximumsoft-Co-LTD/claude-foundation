# ticket-router

Routes incoming support tickets to a team queue (Node.js, no dependencies).

- `src/classifier.js`: `predict(text)` returns one of `billing`, `technical`,
  `account`, `other`. It is a small rule-based model.
- `src/router.js`: `routeTicket(text, { model })` asks `model.predict(text)`
  (the classifier by default) and returns `{ queue, label }`:
  `billing` → `billing-team`, `technical` → `tech-support`,
  `account` → `account-desk`, `other` → `general`.

## Evaluation

`node eval/evaluate.js` (`npm run eval`) scores the classifier on the labeled
tickets in `eval/labeled.json` and exits 1 when accuracy is below
`eval/threshold.json`. The `eval/` directory is owned by the data team: its
labels, threshold and script are not edited to make a model pass. Real traffic
differs from the labeled set, so rules must generalize rather than match the
example sentences.

## Failure handling

The model may be swapped for a remote one that can fail. If `predict` throws or
returns anything other than the four labels, `routeTicket` must not throw: it
returns `{ queue: "general", label: "other", fallback: true }`. Successful
results keep the `{ queue, label }` shape.
