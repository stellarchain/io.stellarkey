# Changelog

All notable changes to StellarKey are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.5.0] - 2026-09-12

### Added

- Choose System, Light and Dark appearance across wallet and merchant screens.
- Choose another software account to pay Private Payments network fees; the selected wallet account remains the default. Watch-only and hardware fee payers are not supported.
- Recover held private funds with a self-transfer, keeping them reserved until the recovery or original payment is confirmed.
- Recover sent-payment history, recipient check codes and memos from seed. An optional setting disables this for future payments; existing records and backups are unchanged.
- Manage private assets through an administrator-controlled registry with deposit restrictions and two-step administrator transfer.

### Changed

- Private Payments submit directly through the selected RPC. The public transaction source and fee payer remain visible.
- Replaced separate Testnet private pools with one XLM/USDC pool that hides the asset in internal transfers. This remains an unaudited Testnet preview, not a Mainnet feature.
- Shorter checksummed private addresses and a simpler Receive screen with asset, address-type and QR choices.
- Private Payments setup synchronizes available assets in one progress view, then closes automatically.
- Standardized dialog controls, form labels and touch targets, with bottom sheets on phones and reduced-motion support.
- Network fees show local-currency equivalents; public and private assets share consistent icons.
- Removed rate timestamps from the main balance and XLM chart, and the chart refresh button. Prices and chart ranges share five-minute caches and in-flight requests.
- Private-history and Merkle caches now update incrementally; recovery uses batched archive reads and native browser cryptography with a portable fallback.
- Updated Next.js and its ESLint configuration to 16.3.4, and React DOM types to 19.2.7. Development, browser-test and production builds use separate caches.

### Removed

- Peer-relayed private payments, Earn by Relaying, helper settings, Waku/Nostr transports and their dependencies. Existing relay records are retained for recovery, not resubmitted through old routes.
- Old private-pool formats and `tks1`/`sks1` addresses. State from the retired Testnet deployments must be recreated.

### Fixed

- CI and release runners install the Linux system libraries required to build the pinned Stellar CLI with its default features.
- Appearance choices survive blocked browser storage and stay synchronized across open tabs; corrected text and control contrast in both themes.
- Claim-review fee details remain legible in light mode; inactive tab and segmented-control labels have stronger contrast on translucent dark panels.
- Account rows and the combined portfolio include public and saved private balances, with labelled Testnet reference values. Switching accounts no longer changes which funds are counted.
- Dialogs retain their shell and keyboard focus during tab changes, menu selection and asynchronous actions; closing restores focus to the opener.
- Late QR, file-read, pagination and dialog results cannot replace newer requests. Loading, copy and error feedback stays beside the relevant action.
- Restored browser zoom and corrected narrow-screen overflow, keyboard positioning, footer spacing and Settings scroll/focus behavior.
- Private Receive has explicit stopped and retry states. Worker and simulation errors no longer misreport an account switch or discard pending payment status.
- Read-only private-contract queries accept storage-only restoration. Archived records are restored in reviewed, fee-capped batches.
- Private sends and withdrawals remain available when deposits are paused, including after the pool has been idle.
- Private recovery scans all retained history after seed import, preserves actionable receipts and archived-account records, and handles inconsistent recipient metadata and partial native X25519 support.
- Corrected backup identities, imported-key paper wallets and derived-account recovery. Corrupt optional contacts or notes no longer prevent vault unlock.
- Preserved asset-code case and issuer authorization/clawback flags; corrected spendable balances, required destination memos and Stellar amount limits.
- Charts and exchange rates retain their real observation times. Stale merchant quotes require a fresh rate instead of silently using cached prices.
- Merchant edits report success only after saving, retain drafts on failure, and update the active owner. Orders retain a fixed shift ID through device-clock changes.

### Security

- Enabled immutable GitHub releases so newly published release assets and their tags cannot be replaced.
- Updated ESLint's YAML parser to js-yaml 4.3.2 and included development dependencies in the application high/critical security gate.
- Enabled repository secret scanning, push protection, Dependabot security fixes and CodeQL analysis; protected main-branch review/CI requirements and immutable release tags.
- Detached private-payment status watchers stop publishing after wallet lock, account or endpoint changes, lost tab ownership, or unmount, while preserving already-authorized canonical transaction tracking.
- Payment signing uses the exact reviewed transaction and rechecks account, network, session and password policy. Multisig edits use canonical signer state; hardware approvals cannot survive a wallet lock.
- Lock and session changes revoke pending unlocks, signing, discovery and queued edits. Inactivity locking covers recovery screens and device sleep; full reset clears wallet-owned browser storage.
- New and changed passwords require a Good or Strong rating; existing passwords still unlock. Vault revisions and password/PIN backoff reject stale writes and throttle repeated guesses.
- Private spend proofs require consent and durable input reservations before RPC preparation. Cancellation or transaction expiry cannot release funds exposed by a proof.
- Private notes and proofs are bound to their deployment and asset, and receive addresses to their pool. Recovery verifies archive records, cache checkpoints and independent RPC evidence.
- New private receive addresses use randomized diversifiers; rotation rejects locally recorded reuse. Unused address history is encrypted and requires a backup, not seed-only recovery.
- Public transaction confirmation and merchant settlement use canonical Horizon results, not submission acknowledgements or custom-endpoint claims. Uncertain refunds remain tracked.
- Merchant routing, refunds, customer erasure, reports and wallet exit recheck current staff or owner authority. Invoices and counter codes are quarantined after receiving-account changes.
- Backup and import validation checks credential identities, schemas and size limits. CSV exports escape spreadsheet formulas; issuer logos omit referrers and paper-wallet output escapes QR attributes.
- Private panels clear on close; secret print windows close on lock. Temporary key/plaintext buffers receive best-effort cleanup, and copied secrets offer an explicit clipboard-clear action.
- Overrode Trezor's installed Stellar SDK parser with TOML 4.2.0. Embedded browser code and the remote Trezor popup are outside this override.
- Release checks verify pinned proving artifacts and generated code, run Rust, protocol and browser checks, and reject leftover test fixtures. Wallet browser tests disable screenshots, video and traces and use synthetic data with restricted failure reports.

## [1.4.1] - 2026-09-01

### Changed

- Made the hash-pinned Private Payments preview available from production-hosted StellarKey when the wallet is on Stellar Testnet; Mainnet remains unavailable.

### Fixed

- Kept private-asset status markers within their mobile row bounds.

### Security

- Added an explicit unaudited `testnet-preview` manifest state without weakening ceremony, audit, or deployment-evidence requirements for beta and production manifests.

## [1.4.0] - 2026-08-31

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
- Clarified that production Private Payments remains a testnet-only preview and refuses Mainnet.

### Fixed

- Kept merchant setup behind its lazy provider boundary so opening it cannot fail while the merchant runtime loads.
- Made the isolated Private Payments circuit gate package its internal browser dependency and import only the required proof helper so clean release runners resolve dependencies without loading unrelated encryption modules.
- Scoped the Private Payments analyzer path to the GitHub Actions step where runner metadata is available, restoring CI and tagged-release execution.

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
