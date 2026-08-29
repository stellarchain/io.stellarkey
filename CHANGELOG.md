# Changelog

All notable changes to StellarKey are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Future release changes are recorded here before publication.

## [1.1.0] - 2026-08-29

### Added

- Added a public trust center, source and build verification links, release artifacts with checksums and an SBOM, and an automated verified deployment path to Cloudflare Pages.
- Added editable exact-send and exact-receive Stellar DEX swaps with quote-bound review and an immutable completion receipt.
- Added optional device-local passkey unlock, Trezor signing support, encrypted contacts and notes, and complete encrypted wallet backup and restore flows.
- Added local-first merchant tools for staff, shifts, orders, invoices, counter codes, customer records, refunds, reporting, and foreground payment reconciliation.

### Changed

- Adopted the StellarKey identity and production install artwork throughout the wallet, public pages, exports, metadata, and home-screen experience.
- Improved iPhone and iPad layouts, safe-area handling, controls, contrast, settings hierarchy, swap entry, and merchant workflows.
- Reworked the public fee comparison around dated first-party UK rates and explicit processing, network, conversion, and off-ramp cost boundaries.
- Partitioned wallet and merchant subscriptions, lazy-loaded merchant and hardware journeys, and added enforceable bundle budgets.

### Fixed

- Hardened transaction submission and recovery so ambiguous, accepted, failed, and cross-tab states remain distinguishable and durable.
- Corrected merchant settlement, duplicate-payment, overpayment, invoice, refund, stock, and multi-tab reconciliation behavior.
- Corrected portfolio aggregation, issuer-aware asset identity, reserve loading, Horizon failure reporting, and mobile overflow across wallet and merchant screens.
- Made application updates staged and recoverable instead of allowing mixed service-worker release files.

### Security

- Introduced password-wrapped vault master keys, scoped secret access, stronger new-vault password policy, authenticated merchant records, and failure-atomic restore behavior.
- Validated issuer domains as bare hostnames, bounded Stellar TOML responses, encrypted contacts at rest, and minimized paper-wallet blob URL lifetime.
- Bound every exported document to its actual inline-script hashes and retained response-only protections in the static host policy.
- Updated the direct cipher dependency to 2.4.0 and added conservative weekly npm and GitHub Actions maintenance proposals with SHA-pinned workflows.

### Removed

- Removed obsolete proof-of-concept migration paths, recovery compatibility code, promotional tooling, stale implementation plans, scaffold assets, and unused compatibility exports.
