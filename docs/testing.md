# Test strategy

`npm run release:verify` requires a clean worktree and runs `verify:application`, the complete application verification suite. CI and tagged releases also require separate Rust security, circuit analysis and canonical-artifact jobs; the application command does not run those checks. Their local counterparts are `verify:private-rust`, `verify:private-circuits` and `verify:private-artifacts`. Normal browser tests own their production static server, install bounded synthetic network fixtures, and fail on unexpected page or console errors. Required private UI and component tests own an isolated development server. None of these automated gates uses a developer-owned browser session or a funded public-testnet account.

## Coverage map

- `tests/*.test.mjs` covers exact Stellar arithmetic, transaction review and submission recovery, Trezor serialization, standard mnemonic/derivation vectors, current wallet and merchant storage schemas, encryption, reporting, payment reconciliation, responsive UI policies, static security, and bundle boundaries.
- `tests/private-payments-network.test.mjs` runs three real Private Payments wallets (Alice, Bob, Charlie) against one synthetic pool through the production preparation, signing, broadcast, recovery and sync code: deposits, direct payments in every direction, withdrawals, consolidation, RPC and submission failure modes, reinstall-from-seed, and seeded mixed traffic, each checked for value conservation and for agreement between durable state and a fresh archive scan. `tests/helpers/private-payments-network.ts` is the reusable engine.
- `npm run test:hardware` includes real installed Trezor request-schema and device-protocol conversion, nested Stellar SDK transaction utilities, and resolver parser regressions. Device responses and metadata HTTP boundaries are synthetic; see [dependency compatibility and coverage limits](dependency-security.md).
- `npm run test:private-protocol` runs the nested browser protocol package tests and is required by application verification.
- `npm run test:e2e:private-ui` requires the Public/Private continuity, overlay-contract, and manifest-tamper gates in Chromium and iPhone WebKit; `npm run test:e2e:private-components` requires every isolated synthetic private-component scenario in those two projects.
- `npm run verify:private-rust` gates the pool contract, verifier, protocol crate, and deterministic recovery model with Rust 1.97.1. The separate `verify:private-model` command retains the 100,000-action model run without a GitHub schedule.
- `e2e/wallet.spec.ts` covers onboarding, corrupt-data recovery, endpoint preferences, unlock, send and swap review, and watch-only safety.
- `e2e/merchant.spec.ts` covers setup, operators and shifts, cash/crypto/split settlement, reload reconciliation, refunds, invoices, counter codes, customers, reports, full IndexedDB backup/wipe/restore, offline recovery, install handoff, and mobile overflow.
- `e2e/merchant-webkit.spec.ts` gates iPhone reload and payment catch-up.
- `e2e/merchant-tabs.spec.ts` gates multi-tab writer ownership and failover.
- `e2e/pwa.spec.ts` gates CSP, offline shell upgrades, and iOS Home Screen recovery guidance.
- `e2e/public-release.spec.ts` gates every public route, canonical metadata, the protected contact surfaces, 320px overflow, install metadata, and branded 404s in Chromium, iPhone WebKit, and iPad WebKit.
- `e2e/accessibility.spec.ts` gates critical wallet and merchant surfaces in Chromium, iPhone WebKit, and iPad WebKit.
- `e2e/private-manifest-security.spec.ts` unconditionally proves the shipped UI fails closed when the pinned Private Payments manifest bytes change; it needs no funded Testnet fixture.

Physical Trezor signing, passkey prompts, and installed iOS behavior remain manual release boundaries because a headless browser cannot prove the hardware or operating-system interaction. Follow [the release checklist](release-checklist.md) for those checks.

The normal active browser matrix uses desktop Chromium, iPhone WebKit, and iPad WebKit. The base configuration also defines Firefox and desktop WebKit projects restricted to opt-in private browser-smoke tests; those live cases are skipped without a fixture and their funded runner remains blocked. The required isolated matrix uses only Chromium and iPhone WebKit. Screenshots, traces, and video are disabled. The structural-only reporter omits wallet text and raw errors. Playwright 1.63.0 can still capture ARIA context on locator failures, so these tests must use isolated non-usable synthetic fixtures with external transaction traffic blocked. `check:fixture-clean` runs before and after the production build; the build also refuses a leftover synthetic component route. Record human VoiceOver/NVDA and physical pinch zoom checks separately from automated accessibility and 200% equivalent reflow checks.

Private Balance unit tests cover protocol encodings, circuit/contract parity, archive verification, encrypted storage, isolated workers, exact transaction review, durable submission recovery, bounded restoration, mirrors, public-cache root verification, coordination, and factual privacy copy. Production-hosted builds explicitly permit the exact pinned Testnet development fixture; they must reject altered manifest bytes, unapproved development fixtures, and Mainnet use. Full setup/payment/recovery journeys, archive-expiry drills, ceremony hashes, and physical-device proof memory/background behavior remain release evidence and cannot be replaced by mocked unit tests.

The ignored 100,000-action deterministic recovery model is Gate B. GitHub runs it weekly and it can
also be started manually through the `Private Balance Gate B` workflow; it remains separate from the
bounded pull-request suite.

## Direct-only private payments and current-format recovery

The isolated `private-direct.spec.ts` covers direct send and withdrawal, explicit
proof-sharing consent, visible public submitting-account metadata, cancellation,
and stale-result ownership. The recovery fixture covers held proofs, canonical
reconciliation, backup/reload, and actual-provider session replacement in desktop
Chromium and iPhone WebKit. It uses synthetic RPC failures, never a relay service.
`private-balance-no-relay.test.mjs` checks direct-only runtime/dependency boundaries.
`private-balance-baseline.test.mjs` requires unsupported encrypted records and
backups to fail closed without signing, network reads or storage changes.
No Waku or Nostr connection check is needed or supported.

## Isolated Private Balance testnet fixture

The authenticated catalogue currently publishes one Testnet development pool with
XLM and USDC. The exact manifest pin and explicit development-fixture flag permit
that fixture in production-hosted builds; this is not Mainnet or promotion approval.
`npm run private:generate` regenerates local artifacts and cannot make them a
deployment. Retired fixture records are removed so they cannot be mistaken for
or block current deployment evidence. Publishing a replacement deployment requires
fresh evidence matching the current artifacts and explicit authorization before:

```sh
node protocol/private-balance/scripts/generate-manifest.mjs --publish-deployment
```

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

The live runner at `protocol/private-balance/scripts/run-testnet-e2e.mjs` currently
fails closed before build, fixture mutation, funding, wallet import, or navigation.
Playwright 1.63.0 has no supported way to suppress locator-failure ARIA snapshots;
turning off screenshots, traces, and video does not solve that capture path.
Deleting output afterward is insufficient. This runner cannot currently produce
new usable-wallet release evidence.

Its intended funded setup/payment/recovery journeys remain blocked until safe
capture prevention is established and reviewed. The synthetic gates above remain
required and usable, but do not establish live Testnet, physical-device,
archive-expiry, paid-restoration, ceremony, audit, or promotion evidence. Any older
MVP evidence must retain its original date and deployment identity.
