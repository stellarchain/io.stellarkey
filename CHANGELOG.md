# Changelog

All notable changes to StellarKey are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-08-29

### Added

- Added a source-controlled public changelog page and release-history maintenance rules for contributors and coding agents.
- Added bounded weekly dependency-maintenance proposals for npm packages and GitHub Actions.

### Changed

- Merchant records now accept only the current production schema; unsupported proof-of-concept records remain untouched instead of being reconstructed with fallback values.

### Fixed

- Corrected the public fee comparison with dated first-party UK rates, exact integer arithmetic, editable inputs, and explicit processing, network, conversion, off-ramp, and operating-day assumptions.

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
