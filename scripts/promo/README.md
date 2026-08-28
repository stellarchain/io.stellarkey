# Promo capture

A two-minute product film of the wallet and Merchant Mode, recorded from the
real app against real testnet state — including a payment that is genuinely
submitted to Horizon mid-take, so the till flips to **Paid** on camera.

```
node scripts/promo/prepare.mjs --fresh   # once: build the state (funds accounts, rings up a day)
node scripts/promo/record.mjs            # the take  → /tmp/promo/video/*.webm
node scripts/promo/build.mjs [out.mp4]   # encode    → /tmp/promo/meridian-wallet.mp4
```

Point them at a running server with `BASE_URL` (default `http://localhost:3003`).

## Why it works this way

**A persistent browser profile.** The merchant store is encrypted and lives
outside `localStorage`, so fixtures cannot be injected from Node. `prepare.mjs`
grows the state through the app's own UI — onboarding mints the first owner,
which nothing else can do — and `record.mjs` reuses that profile.

**Annotations are drawn in the page.** `overlay.js` is injected into the running
app, so captions, callouts, the spotlight and the cursor composite in the app's
own type and colour instead of being burned on flat by ffmpeg afterwards. The
driver measures targets and passes rects, because the selectors the tour uses
(`:has-text`, `:text-is`) are Playwright's, not CSS.

**Beats are isolated.** Each segment runs inside `beat()`; one broken selector
costs that segment, not the take. The run prints a pass/fail line per beat.

## Accounts

Two funded testnet keypairs, cached under `/tmp/promo/` so re-runs reuse them:
`account.json` is the shop, `customer.json` is the person at the counter.
Delete them (or pass `--fresh`) to start over.
