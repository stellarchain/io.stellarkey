# Test strategy

StellarKey has one deterministic release path: `npm run release:verify`. Browser tests are owned by the Playwright Test runner, start their own production static server, install bounded network fixtures, and fail on unexpected page or console errors. There are no scripts that depend on a developer-owned browser session, `/tmp` secrets, a pre-running development server, or mutable public-testnet accounts.

## Coverage map

- `tests/*.test.mjs` covers exact Stellar arithmetic, transaction review and submission recovery, Trezor serialization, standard mnemonic/derivation vectors, current wallet and merchant storage schemas, encryption, reporting, payment reconciliation, responsive UI policies, static security, and bundle boundaries.
- `e2e/wallet.spec.ts` covers onboarding, corrupt-data recovery, endpoint preferences, unlock, send and swap review, and watch-only safety.
- `e2e/merchant.spec.ts` covers setup, operators and shifts, cash/crypto/split settlement, reload reconciliation, refunds, invoices, counter codes, customers, reports, full IndexedDB backup/wipe/restore, offline recovery, install handoff, and mobile overflow.
- `e2e/merchant-webkit.spec.ts` gates iPhone reload and payment catch-up.
- `e2e/merchant-tabs.spec.ts` gates multi-tab writer ownership and failover.
- `e2e/pwa.spec.ts` gates CSP, offline shell upgrades, and iOS Home Screen recovery guidance.
- `e2e/public-release.spec.ts` gates every public route, canonical metadata, the protected contact surfaces, 320px overflow, install metadata, and branded 404s in Chromium, iPhone WebKit, and iPad WebKit.
- `e2e/accessibility.spec.ts` gates critical wallet and merchant surfaces in Chromium, iPhone WebKit, and iPad WebKit.

Physical Trezor signing, passkey prompts, and installed iOS behavior remain manual release boundaries because a headless browser cannot prove the hardware or operating-system interaction. Follow [the release checklist](release-checklist.md) for those checks.
