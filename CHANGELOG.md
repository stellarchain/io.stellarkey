# Changelog

All notable changes to StellarKey are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Update Next.js and its lint configuration to 16.4.5, Stellar SDK to 17.4.0 for the app and installed Trezor adapter, and Tailwind CSS to 4.3.4; refresh current artifact provenance without changing cryptographic artifacts or historical deployment bindings.
- Animate only the changing properties on onboarding and address-book controls.

### Fixed
- Announce incomplete erasure and initialize focus on its recovery heading when no newer control owns focus.
- Label zero-limit trustline operations as removals in wallet activity.
- Keep signing disabled and show an explicit retry screen when wallet erasure leaves storage, merchant records, private records, service workers, or caches uncleared.
- Revalidate the reviewed wallet account, network, and session across batch payments, claims, merges, trustlines, multisig changes, co-signing, and reusable private payments before signing and submission.
- Keep refresh callbacks bound to the visible account, network, and endpoint, remove redundant delayed refreshes, and release failed transaction-status polls for retry.
- Bound Friendbot requests and error bodies, and time out stalled verified Private Payments artifact downloads without rejecting slow transfers that keep making progress.

## [1.1.1] - 2026-11-06

### Changed

- Replace the unpublished 1.1.0 candidate after release verification exposed a dialog focus race; synchronize application versions and the whitepaper at 1.1.1.

### Fixed

- Preserve focus in Select and menu portals when a dialog’s delayed initial focus runs after keyboard interaction.

### Security

- Retain the maintainer-approved manual-check deferral and exact RUSTSEC-2026-0387 exception for the replacement candidate; the checks remain unperformed or unconfirmed and the advisory remains unresolved.

## [1.1.0] - 2026-11-06

### Changed

- Update the pinned Cloudflare Wrangler action to 4.1.3 and retain its reviewed Node 24 runtime requirement.
- Update Next.js and its lint configuration to 16.4.2, React to 19.3.1, Stellar SDK to 17.3.0, and the browser test toolchain.
- Migrate optional hardware signing to Trezor Connect 10.0.1 and Suite Web, with the matching bootstrap-frame policy and device-protocol compatibility tests. The Suite core remains hosted by Trezor; its reference implementation is a development-only test dependency.
- Prepare application release 1.1.0 with synchronized version markers and whitepaper; Private Payments remains the V2.1 development protocol.
- Refresh the pinned Node setup and artifact upload/download Actions used by CI and release verification.

### Fixed

- Run the complete browser verification matrix on macOS with Playwright 1.65.0, preserving native animation checks despite Linux WebKit rendering regressions.
- Pin hosted circuit analysis to Ubuntu 24.04 and GCC 12 so the unchanged legacy Z3 dependency builds after the ubuntu-latest image migration.
- Refresh Private Balance build provenance while preserving the historical deployment lock and binding current browser maintenance inputs.
- Retain custom credential-header protection across JavaScript realms during HTTP redirects and correct IPv6 link-local and cross-family subnet classification in installed dependencies.
- Set the CMake compatibility policy for the pinned circuit analyzer's legacy Z3 build on hosted runners.
- Match wallet and merchant control accessible names to their visible labels and values.

### Security

- Apply compatible Axios, image-processing, source-map, TOML, PBKDF2 and brace-expansion patches, preserving the strict HPKE deployment-history checks.
- Preserve the reviewed recursion-depth guard in Next.js lint dependencies and check every public signal in the twelve-signal Rust verifier mutation suite.
- Update Rust constant-time utilities to ctutils 0.4.4 without changing the deployed pool Wasm.
- Record the maintainer-approved 1.1.0 exception for RUSTSEC-2026-0387 in Soroban host dependencies. The crypto-bigint advisory remains unresolved.
- Record the maintainer’s explicit 1.1.0 deferral of physical-device, VoiceOver/NVDA, passkey, Trezor and redistribution/origin sign-off checks. They remain unperformed or unconfirmed, not passed; this grants no third-party license rights or approval for real-value Private Payments.

## [1.0.5] - 2026-09-22

### Changed

- Prepare application release 1.0.5 with synchronized version markers and whitepaper; name the Private Payments protocol release V2.1 while retaining encoded protocol identifier 3.

- Private Payments Protocol V2.1 uses one entrypoint and archive-record shape with proof-bound public inflow, outflow, and append fields. Ordinary withdrawals append three commitments even when no private change remains. At verified tree saturation, exact-input withdrawals can skip appending; these capacity exits remain publicly distinguishable. Boundary deposits and withdrawals remain public, and every action persists both nullifiers.

- Raise the maximum reviewed private-action resource fee from 1 XLM to 2 XLM for the V2.1 development pool; the separate classic inclusion fee and explicit approval remain in force.

### Security

- Remove published action-kind labels and the normal-wallet append distinction between exact-input and change-producing withdrawals. Match the fresh capacity counter to the authenticated checkpoint before choosing exit mode, and reject a worker or withdrawal-chain review that changes the expected append policy.

### Removed

- Removed the published action kind from proofs, the pool contract entrypoints, and the authenticated archive records. Current clients support only the replacement V2.1 development pool; V2 deployment-bound notes, addresses, proofs, and encrypted backups are rejected rather than migrated.

### Fixed

- Verify that independently rebuilt R1CS, witness Wasm, and pool Wasm match the checked-in artifacts and published manifest hashes.
- Explain incompatible or damaged Private Payments backup records without exposing their contents, and preserve the existing wallet when validation fails. Public-only backups remain compatible.

- Derive V2.1 backup storage keys correctly during import. Encrypt new V2.1 recipient envelopes with the V2.1 HPKE context while retaining authenticated recovery of early V2.1 development envelopes written with the V2 HPKE context. Obsolete V2 note plaintexts remain rejected.

- Validate V2.1 proof-vector metadata and restore the security-constraint mutation checks after the circuit migration.
- Stop offering an already-loaded release after a refresh, reconcile stale offline-worker update banners, and make stalled activation retryable without clearing wallet data or forcing other open tabs to reload.

## [1.0.4] - 2026-09-16

### Fixed

- Cancel notification timers when banners are removed or replaced, without restarting the remaining banners' display or exit deadlines.
- Ignore service-worker registration results after their UI owner unmounts, preventing stale update prompts and leaked listeners.
- Keep the local production server running through malformed requests and unavailable build files, without serving the wallet without its generated security headers.
- Show the same payment reference in a new invoice's preview and saved draft.
- Keep invoice Open and Edit controls independently accessible by keyboard and touch, without nesting buttons or duplicating touch-target expansion.
- Keep merchant Insights comparisons and the live-hour chart aligned with local clock time across daylight-saving changes.
- Keep local-currency network-fee labels readable on raised dark review surfaces.

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
