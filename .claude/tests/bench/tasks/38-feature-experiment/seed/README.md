# checkout-view

Server-side checkout page model (Node.js, no dependencies).

`createCheckout({ track, flags })` from `src/checkout.js` returns
`{ render(user) }`. `user` is `{ id }` for a signed-in shopper or `null` for a
guest. `render` returns `{ layout, userId }`; `layout` is `"classic"` today.

- `track(event)` sends one analytics event object.
- `flags.isEnabled(name)` reads a remote operations flag; the value can change
  while the process runs, so read it on every request.

The product team's experiment plan is in
[docs/one-page-checkout.md](docs/one-page-checkout.md).
