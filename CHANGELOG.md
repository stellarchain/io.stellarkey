# Changelog

All notable changes to StellarKey are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.4] - 2026-09-16

### Fixed

- Cancel notification timers when banners are removed or replaced, without restarting the remaining banners' display or exit deadlines.
- Ignore service-worker registration results after their UI owner unmounts, preventing stale update prompts and leaked listeners.
- Keep the local production server running through malformed requests and unavailable build files, without serving the wallet without its generated security headers.
- Show the same payment reference in a new invoice's preview and saved draft.
- Keep invoice Open and Edit controls independently accessible by keyboard and touch, without nesting buttons or duplicating touch-target expansion.
- Keep merchant Insights comparisons and the live-hour chart aligned with local clock time across daylight-saving changes.

### Changed

- Reduce repeated work in merchant customer reconciliation and recent Insights calculations without caching customer or payment data.
- Check pinned Rust formatting during local, CI and release verification, and remove unused dependency licence allowances.
- Build the pinned circuit analyzer with its locked dependencies in CI and release checks.
- Run independent application, private UI and protocol verification jobs concurrently; publish the exact staged release only after every required gate succeeds.
- Split hosted private-component checks across isolated Chromium and iPhone WebKit runners without reducing coverage, and reject lint warnings during verification.
- Synchronize release markers and the whitepaper at 1.0.4, refreshing lockfile provenance without changing dependencies, Protocol V2 artifacts or the Testnet deployment.

### Security

- Record the maintainer's explicit continuation of the physical-device, VoiceOver/NVDA, passkey, Trezor and redistribution/origin sign-off deferral for 1.0.4. These checks are unperformed or unconfirmed, not passed; this exception grants no third-party license rights and does not approve real-value Private Payments.

## [1.0.3] - 2026-09-14

### Added

- Offer network-specific preferred assets in Swap before they are held, and create a missing receiving trustline in the same signed swap transaction with its additional XLM reserve and network fee shown before confirmation.
- Create a fresh shielded address for each new receive request after explicit private intent, retain the request through tab changes, and offer warned saved-address reuse when new issuance is unavailable.
- Show local-only deposit precision and withdrawal amount/timing advice in forms and reviews without changing amounts, delaying submission, or uploading history.

### Fixed

- Use opaque, theme-matched modal surfaces so underlying page content cannot show through mobile sheets, dialogs or confirmation alerts.
- Keep the Send Payment modal open when “Use Regular Send” switches from Private to Public, carrying over the recipient without exposing the private memo or amount.
- Explain on-chain correlation from reused shielded addresses, keep the public submitter disclosure visible, and display the runtime's actual protocol version in receive details.

### Changed

- Synchronize the application, release documentation and whitepaper at 1.0.3, refreshing versioned-lockfile manifest provenance without changing dependencies, cryptographic artifacts or the Testnet deployment.

### Security

- Record the maintainer's explicit continuation of the physical-device, VoiceOver/NVDA, passkey, Trezor and redistribution/origin sign-off deferral for 1.0.3. These checks are unperformed or unconfirmed, not passed; this exception grants no third-party license rights and does not approve real-value Private Payments.

## [1.0.2] - 2026-09-14

### Fixed

- Match pinned modal-footer backgrounds and gutter coverage to the panel surface in light and dark themes.
- Keep field labels above inputs, with hints and validation messages below; simplify the password-length hint without changing validation.
- Start the Stellar trademark notice on a new line after the independence statement in public footers, About and Settings.

### Changed

- Synchronize the application, release documentation and whitepaper at 1.0.2, refreshing versioned-lockfile manifest provenance without changing dependencies, cryptographic artifacts or the Testnet deployment.

### Security

- Record the maintainer's explicit continuation of the physical-device, VoiceOver/NVDA, passkey, Trezor and redistribution/origin sign-off deferral for 1.0.2. These checks are unperformed or unconfirmed, not passed; this exception grants no third-party license rights and does not approve real-value Private Payments.

## [1.0.1] - 2026-09-13

### Fixed

- Correct the homepage's circuit count, public-proof and metadata disclosures, backup requirements and merchant-service limits, and describe the product as a point of sale rather than a card processor in page and sharing metadata.
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
