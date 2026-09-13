# Changelog

All notable changes to StellarKey are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-09-13

### Added

- Establish 1.0.0 as the stable starting application baseline for the self-custodial Stellar wallet and local-first merchant point of sale.
- Support public Stellar payments, account management, encrypted backups, passkeys, optional Trezor signing, and merchant payment tracking.
- Include current-format Private Payments with direct RPC submission, encrypted recovery, and implementation-bound documentation; this feature remains unaudited and Testnet-only.
- Publish the Private Payments whitepaper as maintained Markdown, standalone LaTeX, PDF, and an arXiv source archive.

### Changed

- Start a new source-history and release baseline under the maintainer's Git identity. Previous development history and release numbering are retired.
- Build and publish releases manually from a clean, verified checkout, retaining checksum inventories, a CycloneDX SBOM, immutable releases, and local application, Rust, circuit and artifact checks.

### Removed

- GitHub Actions workflows, scheduled model runs, automatic CodeQL scans, and Dependabot update jobs. Dependency alerts, secret scanning and push protection remain enabled.
- Pre-baseline application compatibility and migrations. Unsupported encrypted state and backups are rejected without rewriting or deleting their data.

### Security

- Keep Private Payments Mainnet promotion closed and preserve proof-exposure reservations, explicit transaction confirmation, and encrypted recovery boundaries.
- Record the maintainer's one-release deferral of physical-device, assistive-technology, passkey, Trezor and redistribution/origin sign-off; these checks are unperformed or unconfirmed, not passed.
