# Changelog

All notable changes to StellarKey are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.1] - 2026-09-13

### Fixed

- Restore CI, scheduled recovery-model checks, dependency-update configuration, and verified-release deployment to Cloudflare Pages; workflow-run history cleanup does not remove automation.
- Recover the development commit history while retaining its code changes and the 1.0.0 application baseline. Earlier release tags and release listings remain retired.
- Verify and ship the point-compressed proving key without its redundant oversized raw copy or Finder metadata, and reject deployment assets above Cloudflare Pages' 25 MiB limit. Canonical source artifacts and Protocol V2 are unchanged.
- Remove retired application release labels from development commit messages and public copy while preserving code history. Distinguish the current application release, the stable starting baseline, and the unaudited Testnet-only Protocol V2 feature; clarify recovery and network-request limits.

### Changed

- Synchronize the application, release documentation and whitepaper at 1.0.1, refreshing versioned-lockfile manifest provenance without changing cryptographic artifacts or the Testnet deployment.

### Security

- Record the maintainer's explicit continuation of the physical-device, VoiceOver/NVDA, passkey, Trezor and redistribution/origin sign-off deferral for 1.0.1. These checks are unperformed or unconfirmed, not passed; this exception grants no third-party license rights and does not approve real-value Private Payments.

## [1.0.0] - 2026-09-13

### Added

- Establish 1.0.0 as the stable starting application baseline for the self-custodial Stellar wallet and local-first merchant point of sale.
- Support public Stellar payments, account management, encrypted backups, passkeys, optional Trezor signing, and merchant payment tracking.
- Include current-format Private Payments with direct RPC submission, encrypted recovery, and implementation-bound documentation; this feature remains unaudited and Testnet-only.
- Publish the Private Payments whitepaper as maintained Markdown, standalone LaTeX, PDF, and an arXiv source archive.

### Changed

- Start a new source-history and release baseline under the maintainer's Git identity. Previous development history and release numbering are retired.
- Build and publish releases manually from a clean, verified checkout, retaining checksum inventories, a CycloneDX SBOM, immutable releases, and local application, Rust, circuit and artifact checks.
- Bind generated manifest provenance to the new source baseline and versioned lockfile without changing the cryptographic artifacts or Testnet deployment.

### Removed

- GitHub Actions workflows, scheduled model runs, automatic CodeQL scans, and Dependabot update jobs. Dependency alerts, secret scanning and push protection remain enabled.
- Pre-baseline application compatibility and migrations. Unsupported encrypted state and backups are rejected without rewriting or deleting their data.

### Security

- Keep Private Payments Mainnet promotion closed and preserve proof-exposure reservations, explicit transaction confirmation, and encrypted recovery boundaries.
- Record the maintainer's one-release deferral of physical-device, assistive-technology, passkey, Trezor and redistribution/origin sign-off; these checks are unperformed or unconfirmed, not passed.
