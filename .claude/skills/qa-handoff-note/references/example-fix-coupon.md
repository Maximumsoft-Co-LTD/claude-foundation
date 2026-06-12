# Worked example — a filled `qa-note.md` for a `fix` run

A `fix` note where **Section 4 leads**: reproduce the original bug *on the dev environment* using the spec's reproduction steps, show it's gone, then confirm the normal cases still work. Note the lighter Section 1 (a guest storefront flow, no login) and the regression-test pointer.

---

# QA Note: Coupon double-applies on rapid "Apply" clicks

**Run**: .workflow/0009-fix-coupon-double-apply/ · **Type**: fix
**Spec**: [./spec.md](./spec.md) (acceptance criteria + Reproduction) · **Automated tests**: [./tests.md](./tests.md)
**Environment**: https://dev.shop.example.com (storefront) · **Deployed build**: fix/coupon-double-apply @ build #511

> Black-box guide for testing on the dev environment. Acceptance criteria live in spec.md. No need to run any code.

## 1. Where & how to access it on dev
- **Login**: none — use a guest cart on the storefront.
- **Go to**: add any item to the cart → open **Cart** → the coupon field is under the order summary.
- **Test data**: coupon code **`SAVE100`** (= ฿100 off, seeded active on dev). Any in-stock product works; ฿500 items make the maths easy to read.

## 2. Focus areas & risk hotspots
- **The Apply button** — the fix locks it while a coupon request is in flight. The whole bug is the rapid double-click, so hammer that.
- **Also re-check**: remove-then-reapply the same coupon, and applying a *different* second coupon — the fix touches the shared "apply coupon" path, so confirm those still behave.
- **Push hard on**: spam-clicking Apply; throttling the network (DevTools → Slow 3G) then double-clicking while the spinner shows.

## 3. Known limits / not covered
- This run fixes **only the double-click race**. Stacking two *different* coupons is allowed by design and unchanged — don't confuse it with the bug.
- Coupon **expiry / eligibility validation is untouched** this run.

## 4. Test scenarios
**Reproduce the original bug on dev** (from spec.md > Reproduction — must now be fixed)
1. Cart with one ฿500 item → type `SAVE100` → click **Apply twice, fast**.
   - **Before the fix**: discount ฿200, total ฿300 (the bug — applied twice).
   - **Now (expected)**: discount ฿100, total ฿400 — applied once only. [AC: a coupon applies at most once per cart]

**Normal cases still work**
2. Apply `SAVE100` once → ฿100 off, total ฿400.
3. Apply → **Remove** → Apply again → still ฿100 off (not stacked).
4. DevTools → throttle to Slow 3G → double-click **Apply** → spinner locks the button; single ฿100 discount when it settles. [AC: applies at most once even under slow network]

**Regression test**: the engineer committed `cart-coupon.spec` (the "double-apply" test) ahead of the fix — it fails on build #510 (pre-fix) and passes on #511. See tests.md > Regression test.
