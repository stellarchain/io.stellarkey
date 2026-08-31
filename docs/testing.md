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

Private Balance unit tests cover protocol encodings, circuit/contract parity, archive verification, encrypted storage, isolated workers, exact transaction review, durable submission recovery, bounded restoration, mirrors, public-cache root verification, coordination, and factual privacy copy. The production gate must keep the development manifest unmounted. Full setup/payment/recovery journeys, archive-expiry drills, ceremony hashes, and physical-device proof memory/background behavior remain release evidence and cannot be replaced by mocked unit tests.

## Isolated Private Balance testnet fixture

The normal test and release commands never deploy contracts. To inspect the
reproducible fixture plan without network mutation, run:

```sh
node protocol/private-balance/scripts/testnet-fixture.mjs
```

A live public-testnet fixture requires three independent signals: `--deploy`,
either `--ephemeral` or an explicit `--source`, and the
`PRIVATE_BALANCE_TESTNET_DEPLOY=1` environment variable. The ephemeral mode
creates and funds a signer inside a temporary Stellar CLI configuration, then
deletes that configuration after deployment. Example:

```sh
PRIVATE_BALANCE_TESTNET_DEPLOY=1 node protocol/private-balance/scripts/testnet-fixture.mjs --deploy --ephemeral
```

The tool derives the canonical testnet network ID and native-XLM SAC, predicts
the salted pool ID, computes the V1 deployment binding, loads the exact manifest-pinned public pool
Wasm, verifies its SHA-256 before any network mutation, requires the deployed ID to match, and
rereads immutable pool state.
It writes only redacted public fixture evidence below
`protocol/private-balance/results/fixtures/`; it never writes a test manifest
into the production `public/` tree. Fixture evidence is not ceremony, audit,
beta, or release approval and becomes disposable whenever testnet resets.

## Minimal Private Balance browser MVP

The bounded live MVP runner builds the production application against the exact
public-testnet fixture, funds fresh test accounts through Friendbot, and runs
seven Chromium journeys plus four cross-browser smoke checks:

```sh
node protocol/private-balance/scripts/run-testnet-e2e.mjs
```

The journeys cover two isolated profiles, real deposits and canonical reconciliation, consolidation,
private send with recipient output and sender change, withdrawal, lock/restart, ambiguous submission,
encrypted-backup restore, seed-only recovery, endpoint switching, private receive validation,
fail-closed manifest tampering, and critical accessibility. Firefox, desktop WebKit, iPhone WebKit,
and iPad WebKit then repeat the setup/receive smoke path. The runner temporarily builds with an exact
fixture-manifest hash and a generated development-fixture flag; both tracked release files are
restored byte-for-byte even on failure. It writes only redacted public evidence to
`protocol/private-balance/results/mvp-e2e.json` after every journey passes. Test account secrets exist
only in the runner's child-process environment and are never written to the evidence file.

This is deliberately minimal MVP evidence. It does not replace archive-expiry
and paid-restoration drills, the full browser and physical-device matrix, the
parameter ceremony, independent security audits, or final beta/release
approval.
