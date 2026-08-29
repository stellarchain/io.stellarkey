<p align="center">
  <img src="./public/stellarkey-logo-readme.svg" alt="StellarKey logo" width="112" height="112">
</p>

# StellarKey

<p align="center">
  <strong>A self-custodial Stellar wallet and local-first point of sale.</strong><br>
  Your keys, wallet records, and merchant data stay under your control.
</p>

<p align="center">
  <a href="https://stellarkey.io">Open StellarKey</a> ·
  <a href="https://stellarkey.io/security">Security</a> ·
  <a href="https://stellarkey.io/support">Support</a> ·
  <a href="./CHANGELOG.md">Changelog</a>
</p>

StellarKey is an open-source, backend-free Stellar wallet built with Next.js 16,
React 19, and `@stellar/stellar-sdk` 17. Production is a static export. Vault
encryption, recovery, transaction construction, review, and signing happen in
the browser; the app connects directly to Stellar services.

> [!CAUTION]
> StellarKey is financial software. Start with testnet and small amounts. Always
> verify the network, destination, asset issuer, amount, memo, and transaction
> details before signing or broadcasting.

## Why StellarKey

| Principle | What it means |
| --- | --- |
| **Self-custodial** | Software-account secrets are encrypted locally and opened only for the operation that needs them. Optional Trezor signing keeps approval on the hardware device. |
| **Backend-free** | There are no StellarKey application servers, accounts, sessions, relays, indexers, analytics services, or server-side databases. |
| **Local-first** | Wallet and merchant records live in browser storage. Encrypted backups and exports—not a hidden cloud account—are the recovery path. |
| **Verifiable** | Every production build exposes its source commit through the UI and `/release.json`; release artifacts include checksums, an SBOM, and provenance. |

## Capabilities

| Area | Included |
| --- | --- |
| **Wallet** | Mainnet and testnet accounts, balances, bank-style activity, trustlines, claimable balances, payments, batch payments, account merge, and Stellar DEX strict-send or strict-receive swaps |
| **Transaction safety** | Exact seven-decimal arithmetic, typed memos, live reserve inputs, reviewed signing intent, multisig envelopes, durable submission recovery, and SEP-7 unsigned payment links |
| **Local security** | Password-encrypted vaults, encrypted contacts and private notes, failure-atomic backups, watch-only accounts, inactivity auto-lock, optional WebAuthn PRF unlock, and complete local reset |
| **Hardware** | Trezor address discovery and on-device Stellar signing through the official Trezor Connect popup |
| **Merchant Mode** | Encrypted transactional records, cash and external-card tenders, Horizon-confirmed crypto sales, staff permissions, shifts, refunds, invoices, counter codes, customers, loyalty, reports, and treasury handoffs |
| **Installable app** | Static PWA shell, offline reopening, iPhone and iPad safe-area handling, and staged service-worker updates |

Ledger signing is not implemented and is intentionally unavailable. Passkey
unlock appears only when the browser provides genuine WebAuthn PRF output;
unsupported devices retain password unlock without a simulated biometric path.

## Security model

| Boundary | StellarKey behavior |
| --- | --- |
| **Key material** | A random vault master key is password-wrapped. Sensitive records are encrypted beneath it, and secret bytes are scoped to the operation that requested them. |
| **Browser storage** | The encrypted vault and preferences use browser storage. Merchant records use encrypted, transactional IndexedDB storage. Data is origin- and browser-profile-specific. |
| **Network access** | Horizon and RPC requests go directly to HTTPS endpoints. Endpoint identity is checked against the selected Stellar network, reads are bounded, and retries are limited to safe requests. |
| **Service worker** | Only the static application shell is cached. Wallet records, merchant data, prices, and Stellar responses do not enter the service-worker cache. |
| **Passkeys** | Face ID or Touch ID can unwrap the existing local master key through an origin-bound WebAuthn PRF credential. The password and encrypted backup remain recovery paths. |
| **Hardware wallets** | Trezor support is optional and lazy-loaded only after a hardware action. The browser sends the reviewed transaction to Trezor Connect for device approval. |
| **Merchant monitoring** | Settlement monitoring is foreground-only. Visibility recovery reconciles missed payments after reopening; StellarKey does not claim background execution after the browser suspends it. |

StellarKey cannot reverse a Stellar transaction, recover a lost recovery phrase,
decrypt a vault without an authorized unlock path, or restore local records that
were never backed up. A compromised device, browser, extension, DNS record,
release artifact, or backup can defeat application-level protections.

Read the complete [security policy](SECURITY.md), the public
[security model](https://stellarkey.io/security), and the
[privacy explanation](https://stellarkey.io/privacy).

## Backend-free architecture

- `npm run build` creates immutable static files in `out/`. There are no
  dynamic application routes or runtime server requirements.
- Direct Horizon and RPC access keeps the wallet independent of a proprietary
  application API. Users can select verified HTTPS endpoints in Settings.
- Asset identity is always the complete `(network, code, issuer)` tuple. A
  matching code alone is never treated as verified or assigned a price.
- Portfolio values are limited to mainnet assets with an exact verified price
  mapping. Testnet balances are never assigned monetary value.
- XLM, verified asset prices, and fiat conversion rates come from live
  CoinGecko data and are cached briefly in memory.
- The CSP allows outbound HTTPS because endpoints are user-configurable and
  issuer metadata or logos may be hosted by issuers.

## Merchant Mode

Merchant Mode turns one unlocked wallet and browser into a single-device point
of sale. Crypto payments settle only after Horizon reports the exact network,
destination, asset, memo, and amount. Refunds, trustlines, swaps, and treasury
transfers return to the wallet's reviewed signing flow.

Merchant records do not synchronize between devices and are not a cloud backup.
Export the accounting records you need before clearing browser storage or
resetting the app. Direct ESC/POS, Bluetooth, cash-drawer, and external-display
control require a separate hardware bridge and remain unavailable without one.

A full encrypted `stellar-wallet-backup` version 2 backup contains the vault
and its matching merchant archive. The standalone Tax Records archive contains
encrypted operational records but no wallet key material, so it cannot restore
a wallet by itself. Legacy plaintext version 1 wallet exports are rejected.

See [Merchant Mode operations](docs/merchant-mode.md) for setup, daily use,
offline behavior, recovery, and security boundaries.

## Verify a deployed release

The current release is `1.2.0`. Every build embeds the full 40-character Git
commit SHA in the interface and in
[`/release.json`](https://stellarkey.io/release.json). Compare it with the
commit attached to the corresponding source release or run:

```bash
git rev-parse HEAD
```

The visible `vX.Y.Z · short-hash` identity is present on every public document,
the landing page, onboarding and locked-wallet authentication, loading and
recovery states, and the unlocked application. Selecting a production identity
opens the exact source commit.

Only a release manifest containing `"sourceTree": "clean"` and
`"verifiable": true` represents the exact named commit. Checksums,
`release-files.json`, the SBOM, and provenance attestation bind the published
archive to that source state. [CHANGELOG.md](CHANGELOG.md) provides the
human-readable release history.

## Quick start

Requirements:

- Node.js `>=22.22.2 <27`
- npm `>=11.19.0 <13`

```bash
git clone https://github.com/stellarchain/io.stellarkey.git
cd io.stellarkey
corepack install
corepack npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Use localhost or HTTPS for
passkeys and other secure-context browser features.

Create and serve a production-like static export with:

```bash
npm run build
npm run start
```

The generated release is in `out/`. The development server is not a production
deployment target.

## Testing

| Command | Purpose |
| --- | --- |
| `npm test` | Complete deterministic unit and source-policy suite |
| `npm run typecheck` | TypeScript verification |
| `npm run lint` | ESLint and Next.js rules |
| `npm run test:e2e` | Production build plus the complete Playwright browser matrix |
| `npm run test:hardware` | Deterministic Trezor adapter tests |
| `npm run audit:prod` | High/critical production dependency gate |
| `npm run release:verify` | Clean-tree preflight and every automated release gate |

The browser matrix covers desktop Chromium, iPhone WebKit, and iPad WebKit.
Physical Trezor, installed-PWA, backup/restore, and mainnet checks remain manual
because emulation cannot prove device or network behavior.

## Production deployment

Serve only the verified `out/` artifact over HTTPS and apply the generated
`out/_headers` policy. Each exported HTML document carries a document-specific,
hash-bound CSP; the host headers add response-only protections including
`frame-ancestors 'none'`. Do not rebuild the source on the hosting platform or
mix files from different releases.

The optional `@trezor/connect-web@9.7.3` dependency currently brings ten
low-severity `elliptic` advisories through its Bitcoin/UTXO support graph, not
StellarKey's Stellar signing path. npm offers no fixed stable release. High and
critical production advisories remain release-blocking.

Read the [production deployment runbook](docs/production-deployment.md) and
[release checklist](docs/release-checklist.md) before publishing. Pinch zoom is
disabled by product requirement and covered by the mobile release gate.

## Project documentation

| Document | Purpose |
| --- | --- |
| [Changelog](CHANGELOG.md) | Versioned user-facing changes |
| [Security policy](SECURITY.md) | Supported versions, private reporting, and safe-harbour scope |
| [Support](SUPPORT.md) | Help boundaries and recovery expectations |
| [Contributing](CONTRIBUTING.md) | Development workflow, DCO, and review expectations |
| [Merchant Mode operations](docs/merchant-mode.md) | Setup, daily operations, recovery, and limitations |
| [Testing guide](docs/testing.md) | Automated and physical-device verification |
| [Release checklist](docs/release-checklist.md) | Security, recovery, device, and mainnet release gates |
| [Deployment runbook](docs/production-deployment.md) | Immutable Cloudflare Pages deployment and rollback |
| [Third-party notices](THIRD_PARTY_NOTICES.md) | Dependency and Trezor licensing boundaries |

## Contributing

Issues and pull requests are welcome. Use testnet and disposable data, add a
regression test for defects, keep changes focused, and run
`npm run release:verify` before proposing a release. Report suspected
vulnerabilities through the private process at
[stellarkey.io/security](https://stellarkey.io/security), not a public issue.

See [CONTRIBUTING.md](CONTRIBUTING.md) and
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License and third-party code

Copyright © 2026 StellarKey.

StellarKey's original source is licensed under `AGPL-3.0-or-later`; see
[LICENSE](LICENSE). Network deployment of a modified version requires offering
its users the corresponding source under the same license.

Dependencies and bundled third-party materials retain their own licenses.
Trezor Connect is separately licensed and is not relicensed by StellarKey.
Review [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and obtain any required
distribution authorization before publishing a build that contains it.
