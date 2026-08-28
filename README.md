# StellarKey

StellarKey is a self-custodial, backend-free Stellar wallet built with Next.js 16, React 19, and `@stellar/stellar-sdk` 17. Production is a static export: vault encryption, recovery, transaction construction, review, and signing happen in the browser. The app talks directly to Stellar services and never sends secret keys, recovery phrases, passkey assertions, or merchant records to an application server.

## Supported capabilities

- Mainnet and testnet balances, activity, trustlines, claimable balances, payments, batch payments, account merge, and Stellar DEX strict-send swaps
- Exact seven-decimal Stellar amount arithmetic, typed memos, live base-reserve calculation, multisig envelopes, and SEP-7 unsigned payment links
- Password-encrypted local vaults and failure-atomic backups, encrypted private transaction notes, watch-only accounts, inactivity auto-lock, and complete local reset
- Optional origin-bound Face ID / Touch ID unlock through WebAuthn PRF, with the wallet password and encrypted backup retained as recovery paths
- Trezor address discovery and on-device Stellar signing through the official Trezor Connect popup
- Local-first Merchant Mode with encrypted transactional IndexedDB storage, cash, external-card, split, and Horizon-confirmed crypto sales; staff permissions; refund approval; shifts; invoices; counter codes; customer/loyalty records; reports; and explicit treasury handoffs

Ledger signing is not implemented and is intentionally unavailable. The app never creates a simulated Ledger account. Passkey unlock is offered only when the browser returns real WebAuthn PRF output; unsupported devices keep password unlock without a simulated biometric path.

## Backend-free architecture

- `npm run build` creates immutable static files in `out/`; there are no dynamic routes, application APIs, server sessions, relays, indexers, or server-side databases.
- The encrypted wallet vault and small preferences stay in browser storage. A random vault master key is password-wrapped, sensitive records are encrypted beneath it, and software-account secrets are opened only for the scoped operation that needs them.
- Merchant operational data is encrypted and committed transactionally in IndexedDB. It is local to the browser and does not synchronize between devices.
- Horizon and RPC requests go directly to HTTPS endpoints selected in Settings. Endpoint identity is checked against the active Stellar network, reads are bounded, and only safe idempotent requests receive limited retries.
- The service worker caches only the static application shell. Wallet records, merchant data, prices, and Stellar responses never enter its cache.
- Merchant settlement monitoring is foreground-only. Visibility recovery and Screen Wake Lock improve an open till, but the app does not claim background monitoring after iOS or the browser suspends it.

## Merchant Mode

Merchant Mode turns one unlocked wallet and browser into a single-device point of sale. Cash and external-card records stay local; crypto payments settle only after Horizon reports the exact network, destination, asset, memo, and amount. Refunds, trustlines, swaps, and treasury transfers always return to the wallet's reviewed signing flow.

Merchant records do not synchronize between devices and are not a cloud backup. Export the accounting records you need before resetting the app or clearing browser storage. Direct ESC/POS, Bluetooth, cash-drawer, and external-display control require a separate hardware bridge and are shown as unavailable when one is not present.

Full wallet recovery accepts the fully encrypted `stellar-wallet-backup` envelope version 2; legacy plaintext version 1 exports are intentionally rejected. The standalone Tax Records merchant archive contains encrypted operational records but no wallet key material, so it cannot restore a wallet by itself. A full encrypted wallet backup includes both the vault and its matching merchant archive.

See [Merchant Mode operations](docs/merchant-mode.md) for setup, daily use, offline behavior, and security boundaries.

## Verify a deployed release

StellarKey starts at release `1.0.0`. Every build embeds the full 40-character Git commit SHA in the public About page and in `/release.json`. Compare that value with the commit attached to the corresponding GitHub release, or run `git rev-parse HEAD` in a checked-out copy. The release manifest also reports whether tracked source changes were present during the build; only a manifest with `"sourceTree": "clean"` and `"verifiable": true` represents the exact named commit.

## Asset and price safety

Credit assets are identified by the complete `(network, code, issuer)` tuple. A matching code alone is never treated as verified or assigned a price. The built-in directory currently contains Circle USDC on mainnet/testnet and EURC on testnet only; custom assets always expose their issuer.

Portfolio values are shown only for mainnet assets with a verified price mapping. Testnet balances are never assigned monetary value. XLM, verified asset prices, and fiat exchange rates come from live CoinGecko data and are cached briefly in memory.

## Local development

Use Node.js 22.22.2+ and npm 11.19.0+ within the supported ranges in `package.json`.

```bash
corepack install
corepack npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Run the complete release gate with:

```bash
npm run release:verify
```

That command runs type checking, the complete unit suite, lint, the production dependency audit, static export, the bundle budget, desktop Chromium journeys, and behavioral/accessibility journeys using iPhone and iPad WebKit profiles. CI runs the same release boundaries on pushes and pull requests. Physical Trezor and installed-device checks remain manual because browser emulation cannot prove them.

## Security and deployment notes

- Serve `out/` over HTTPS and configure the static host to apply `out/_headers`. Passkeys, installed-PWA behavior, and cross-origin security features require a trustworthy origin. Custom Horizon and RPC URLs must use HTTPS.
- The static header policy includes a build-hashed CSP, clickjacking protection, MIME sniffing protection, a restrictive permissions policy, and popup-compatible cross-origin isolation for Trezor Connect.
- The CSP permits outbound HTTPS because users can configure a Horizon endpoint and asset metadata/logos may live on issuer domains.
- Reset deletes all `polaris.*` and `wallet.*` browser storage owned by this app. Back up the recovery phrase or encrypted backup before resetting.
- SEP-7 callback requests and signed/origin-domain requests are rejected until the app can execute and verify those flows fully.
- The Trezor dependency tree has no known high or critical production advisories after the pinned `protobufjs` remediation. Remaining low-severity upstream findings are enforced below the CI failure threshold.

See the [release checklist](docs/release-checklist.md) for real-device, recovery, static-host, and mainnet checks. Pinch zoom remains disabled by product requirement and is asserted by the mobile browser gate.

This remains financial software: test every release with small amounts and verify addresses, asset issuers, memos, network, and transaction details on the signing device before broadcasting.
