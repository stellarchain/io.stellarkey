# Changelog

All notable changes to StellarKey are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added Circle's official USDC and EURC token logos as bundled local verified-asset icons.
- Added USDT0 to Verified Stellar Assets on Mainnet with its exact issuer and a bundled local logo.
- Added Stellar muxed-address payments to Send and Multi-Send, with an explicit base-account plus `MEMO_ID` fallback for Trezor.

### Changed

- Hid verified assets from Add Asset when they are unavailable on the selected network.
- Moved the public version and build hash from beneath the header logo into the footer legal line.
- Merchant charges, invoices, and counter codes now use immutable random payment routes; human order references remain display-only.
- Merchant payment requests default to a muxed destination and offer a consistent Standard or Trezor-compatible request without closing the active sheet.
- Updated landing-page merchant copy to explain muxed-address routing and the Trezor `MEMO_ID` fallback.
- Renamed the charge modal's `MEMO_ID` compatibility option from Trezor to Legacy while retaining explicit Trezor guidance.

### Fixed

- Kept merchant setup behind its lazy provider boundary so opening it cannot fail while the merchant runtime loads.

### Security

- Conflicting or malformed muxed and `MEMO_ID` routes are isolated for review instead of being matched by amount.

## [1.3.0] - 2026-08-31

### Added

- Added Private Payments as a testnet-only preview for configured XLM and USDC, with local zero-knowledge proving, reusable private addresses, encrypted memos, deposits, transfers, withdrawals, and recovery.
- Added private assets and private activity directly to the main wallet, including private receive, recent recipients, notifications, and representative testnet portfolio values.
- Added local vault password rotation and an optional fresh-password confirmation before each transaction signature.
- Added privacy-safe feedback and accessible sidebar tooltips without collecting wallet data or introducing a backend.

### Changed

- Presented private deposits and withdrawals as one bank-style internal transfer with separate signed Public and Private balance postings.
- Kept Public and Private tabs inside stable Send, Receive, and Add Assets dialogs so switching modes no longer closes, remounts, or reanimates the modal shell.
- Resumed private-payment discovery from an encrypted verified ledger cursor bounded by the wallet creation or import time and the one-year recovery window.
- Unified dashboard activity with the full Activity ledger and improved market context, responsive card alignment, address truncation, and narrow-screen containment.
- Simplified Private Payments setup, recovery, progress, asset selection, and disclosures while preserving explicit fee and privacy boundaries.
- Re-baselined the unlocked-wallet JavaScript budget for integrated private assets and signing controls while keeping proving, merchant, and hardware code in separate lazy journeys.

### Fixed

- Restored the encrypted merchant runtime to a user-activated lazy boundary while retaining the wallet shell and pending merchant intent during loading, keeping merchant storage code out of ordinary wallet unlocks.
- Preserved Merchant Mode enablement when restoring an encrypted full-wallet backup.
- Removed indefinite wallet and merchant startup spinners, stale development chunks, and unbounded private withdrawal loading states.
- Corrected shared XLM and USDC setup state, per-asset runtime selection, public USDC fiat values, and private balances during rehydration.
- Corrected the private circuit ownership domain, manifest-bound testnet deployments, source-asset authorization, and transaction simulation failures.
- Preserved private memos through recovery and classified known contract calls as private deposits, withdrawals, or payments instead of generic host-function activity.
- Fixed mobile modal, activity, filter, tooltip, focus-restoration, loading-button, and overflow regressions without changing transaction amounts.

### Security

- Restricted Private Payments to Stellar testnet at manifest, preparation, review, and transaction-builder boundaries, and made the pinned CIVER Gate A mandatory for CI and tagged releases.
- Kept private notes, activity, checkpoints, recovery state, and backups encrypted and context-bound, with proving and key operations isolated in workers and sensitive buffers cleared after use.
- Added fail-closed transaction reviewers, exact simulation and authorization checks, durable signed-action reservations, and conservative on-chain reconciliation.
- Routed supported software, Trezor, multisignature, trustline, swap, and private transactions through one single-use signing-authorization boundary when enabled.
- Kept Private Payments unavailable on Mainnet and withheld production promotion while independent audit or trusted-setup evidence remains incomplete.

### Removed

- Removed completed internal implementation plans from the public release tree while retaining maintained protocol, security, recovery, and operations documentation.

## [1.2.0] - 2026-08-29

### Added

- Added selective claimable-balance review with explicit issuer details, trustline gating, exact fee preview, and one atomic transaction for only the balances the user chooses.
- Added account- and network-scoped device-local dismissal for unwanted claimable balances, including a reversible hidden-balances list without any on-chain action or backend.

### Changed

- Linked XLM market values to the wallet's selected display currency instead of presenting a fixed currency independently of wallet settings.

### Fixed

- Corrected the encrypted backup action alignment so its icon, title, and description remain visually aligned across responsive layouts.

## [1.1.0] - 2026-08-29

### Added

- Added a source-controlled public changelog page and release-history maintenance rules for contributors and coding agents.
- Added bounded weekly dependency-maintenance proposals for npm packages and GitHub Actions.

### Changed

- Merchant records now accept only the current production schema; unsupported proof-of-concept records remain untouched instead of being reconstructed with fallback values.
- Routine dependency maintenance now excludes unreviewed TypeScript, ESLint, and Node type-definition majors and uses an accurate dependency label instead of labeling every version update as a security fix.
- Updated the type-checking toolchain to supported TypeScript 6 and Node 22 declarations, matching the production CI runtime without adopting incompatible TypeScript 7 or Node 26 definitions.

### Fixed

- Corrected the public fee comparison with dated first-party UK rates, exact integer arithmetic, editable inputs, and explicit processing, network, conversion, off-ramp, and operating-day assumptions.
- Made clean-checkout CI build the static release before generated bundle assertions and invoke the pinned browser runner through npm, eliminating false failures caused by missing output or unresolved local binaries.
- Split the release accessibility matrix into bounded wallet and merchant scenarios so slower mobile runners cannot exhaust one global journey timeout.
- Updated the SHA-pinned checkout, Node setup, provenance, and Cloudflare deployment actions to reviewed Node 24 runtime releases, removing deprecated action-runtime APIs from CI and release automation.
- Eliminated duplicate same-repository pull-request runs and cancel superseded CI runs while retaining verification on every `main` update.
- Disabled Next.js CLI telemetry for local development, verification, release builds, and CI so framework usage data is never submitted by project commands.
- Kept long Friendbot and encrypted-archive actions contained at narrow iPhone and iPad widths by allowing their labels to wrap without reducing control targets.
- Increased destructive merchant-settings text contrast beyond the WCAG AA boundary instead of relying on a rounding-sensitive minimum.

### Security

- Updated the reviewed direct cipher dependency to 2.4.0 and kept all third-party GitHub Actions pinned to full commit hashes.

### Removed

- Removed obsolete proof-of-concept migration paths, recovery compatibility code, promotional tooling, stale implementation plans, scaffold assets, and unused compatibility exports.

## [1.0.0] - 2026-08-28

### Added

- Released a backend-free self-custody Stellar wallet with encrypted recovery, send and receive, exact-asset portfolio and activity views, editable DEX swaps, multisig tools, and account recovery workflows.
- Added optional device-local passkey unlock and Trezor hardware signing while retaining password recovery and explicit transaction review.
- Added encrypted local-first merchant tools for staff, shifts, orders, invoices, counter codes, customer records, refunds, reporting, and foreground payment reconciliation.
- Added the public trust center, StellarKey install artwork, source and build verification, checksummed release artifacts, an SBOM, and verified Cloudflare Pages deployment automation.

### Security

- Introduced password-wrapped vault master keys, scoped secret access, strong new-vault password policy, authenticated merchant records, failure-atomic restore, issuer-domain validation, bounded Stellar TOML responses, encrypted contacts and notes, and staged service-worker updates.
