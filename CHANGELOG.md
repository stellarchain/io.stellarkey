# Changelog

All notable changes to StellarKey are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
