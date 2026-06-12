# Worked example — a filled `qa-note.md`

A realistic, fully-filled note for a `feat` run that adds order refunds to a back-office admin. It exercises all four sections: a gateway-backed flow, real accounts/paths, deliberate gaps, and scenarios with explicit expected results. Use it as the shape to aim for — concrete access, an expected result on every scenario, no code, no secrets.

---

# QA Note: Order refunds (partial & full)

**Run**: .workflow/0007-feat-order-refunds/ · **Type**: feat
**Spec**: [./spec.md](./spec.md) (acceptance criteria) · **Automated tests**: [./tests.md](./tests.md)
**Environment**: https://dev-admin.shop.example.com · **Deployed build**: feat/order-refunds @ build #482

> Black-box guide for testing on the dev environment. Acceptance criteria live in spec.md. No need to run any code.

## 1. Where & how to access it on dev
- **Login**: account `qa.manager@example.com`, role **Store Manager** — credentials in 1Password › "Dev / QA shared accounts" (no access? ask @lead).
- **Go to**: after login → `Orders` (left nav) → open any order with status **Paid** → the new **Refund** button is top-right of the order detail.
- **API** (if testing directly): `POST https://dev-api.shop.example.com/v1/orders/{orderId}/refunds` · auth: Bearer token from `POST /v1/auth/login` with the QA manager account, sent in the `Authorization` header · sample body: `{ "amount": 500, "reason": "customer_request" }` (omit `amount` for a full refund).
- **Test data** (seeded on dev): order **#100231** (paid ฿1,500, refundable), **#100244** (already fully refunded — for the can't-refund-twice case), **#100255** (wired to force an Omise decline — for the gateway-failure case). Need a fresh paid order? Place one on the storefront `https://dev.shop.example.com` with test card `4242 4242 4242 4242`.
- **Feature flag**: `refunds.enabled` is ON for dev (Admin → Settings → Feature flags). If the Refund button is missing, confirm it's still on.

## 2. Focus areas & risk hotspots
- **Refund modal → gateway call** — the new, riskiest flow; it calls the Omise sandbox. Watch for the confirm button double-firing (the spinner should lock it) and for the modal hanging if the gateway is slow.
- **Order status + customer balance update together** — both come from the same action; confirm they never disagree (status `Refunded` / `Partially refunded` **and** the refunded-amount line must match).
- **Also re-check**: the order-list status badge and the customer's **Refunds** tab — both read the same refund records and could show stale totals.
- **Push hard on**: several partial refunds that together exceed the order total; refunding ฿0 or a negative amount; a `Support` (non-manager) role attempting a refund.

## 3. Known limits / not covered
- **Per-refund history timeline is out of scope this run** — you'll see the latest refund state, not a timeline. Spec'd as a follow-up; don't raise it as a bug.
- **Customer email/receipt is mocked on dev** — the "refund email sent" toast shows but no real email goes out. Real send is staging-only.
- **Card payments only** — orders paid by bank transfer have no Refund button by design (gateway refund only). Not a bug.

## 4. Test scenarios
**Happy path**
1. Open paid order **#100231** → click **Refund** → modal opens showing max refundable ฿1,500.
2. Enter ฿500, reason "Customer request", confirm → success toast; modal closes.
3. Order status → **Partially refunded**; refunded line shows ฿500; remaining refundable ฿1,000.
4. Customer **#5567** → **Refunds** tab → one entry ฿500, status `Succeeded`, timestamp = now.
5. Refund the remaining ฿1,000 the same way → status → **Refunded**; the Refund button is now disabled.

**Edge / error**
- Try to refund **#100244** (already fully refunded) → Refund button disabled; via API → `409` `"order already fully refunded"`. [AC: can't refund beyond total]
- Enter an amount greater than the remaining refundable → inline error "Amount exceeds refundable balance"; confirm stays disabled.
- Enter ฿0 or a negative number → inline validation error; no gateway call is made.
- Log in as the **Support** role → the Refund button is hidden; the API returns `403`. [AC: manager-only]
- Refund **#100255** (forces an Omise decline) → error toast "Refund failed, no money moved"; order status unchanged; customer balance unchanged. [AC: a failed refund leaves no partial state]
