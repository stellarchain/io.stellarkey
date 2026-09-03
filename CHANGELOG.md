# Changelog

All notable changes to StellarKey are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Linked public Private Payments deposits and withdrawals to their exact Stellar explorer transactions while rejecting synthetic restored-history identifiers.
- Added domain-separated outgoing viewing keys and fixed authenticated recovery envelopes for reconstructing sent Private Payments from seed and chain data.

### Changed

- Flattened the Private Payments setup progress into the modal shell with a clearer live status, prominent percentage, and transform-animated progress rail.
- Unified public and private asset artwork: XLM now uses the Stellar mark on black, while private assets reuse their normal logo with a shield notch labelled "Private asset".
- Displayed the selected local-currency equivalent beside numeric XLM network fees throughout public and Private Payments flows, retaining useful precision below one cent.
- Displayed the canonical Stellar mark for native XLM in wallet asset rows and details, matching issued-asset logo treatment.
- Shortened Private Payments addresses to checksummed Base58 using the `tskpay_` Testnet and `skpay_` Mainnet prefixes, with compact deployment binding and network-specific validation.
- Replaced sparse Private Payments actions with fixed two-nullifier, two-output packages that include recipient and sender-recovery ciphertexts for every lane.
- Isolated each Private Payments pool and catalogue deployment to one immutable asset, removing caller-selected asset fields from contract actions.
- Persisted authenticated incremental Merkle nodes so spends load only selected witness paths instead of rebuilding the tree from complete pool history.
- Batched contiguous archived Private Payments records into the largest freshly simulated restoration footprint within an 80% resource-fee safety margin, saving progress after every confirmed batch.
- Replaced the binary depth-32 Private Payments tree with a ternary depth-17 tree across the circuit, contract, Rust protocol, browser, authenticated incremental cache, manifests, and vectors.
- Reduced the Private Payments circuit from 23,437 to 14,574 constraints and 11 public inputs by removing redundant lane, range, relayer, and action-binding constraints, deriving output roles, using a ternary tree, and explicitly proof-binding the contract-derived canonical action hash; development proving now fits the pinned `pot14` transcript.
- Retired the incompatible Testnet Private Payments pools, regenerated every artifact binding, and published fresh asset-pinned XLM and USDC development pools with authenticated manifests and deployment evidence.
- Used RFC 8410 PKCS#8 imports for native X25519 shared-secret derivation while retaining the portable fallback.
- Accelerated Private Payments recovery scans with RFC 9180-compatible WebCrypto key handles, view-tag-first owner hashing, and bounded 8-output parallel batches selected by paired nine-trial controls while retaining record-order state updates.
- Reduced Private Payments contract cost with one public-input MSM, single-pass public-signal derivation, a precomputed immutable asset field, and fixed-width field arithmetic that removes runtime arbitrary-precision integers.
- Disclosed that the development Private Payments client self-submits transfers and withdrawals from the user's public Stellar account; fee-bump sponsorship alone does not hide that inner transaction source.
- Re-pinned development proof generation to the PSE degree-14 Perpetual Powers of Tau transcript after its hash and complete contribution/beacon chain verified and the prior endpoint stopped serving its authenticated artifact.
- Deferred merchant archive code until an explicit backup or restore action so merchant security hardening does not increase wallet startup JavaScript.

### Removed

- Removed support for the previous `tks1` and `sks1` Private Payments address encodings; existing testnet private state must be recreated.
- Removed compatibility with the previous binary-tree Private Payments state and deployment artifacts.
- Removed retired archive-page constants from Private Payments constructors, deployment bindings, manifests, runtime validation, and generated clients now that every archive record occupies its own persistent entry.

### Fixed

- Isolated local Next.js development output from production builds so verification cannot strand an open test session on stale UI chunks.
- Kept Private Payments setup on the modal's neutral surface and automatically dismissed it after the completed progress state, removing the tinted panel and mandatory final acknowledgement.
- Reduced first-time Private Payments setup latency by reading independent historical ledger timestamps with bounded RPC concurrency while preserving both authenticated head checks.
- Shortened first-time Private Payments setup by preventing the underlying action gate from launching a duplicate sync, preparing the originally selected asset last, and moving shared proving-file warm-up out of the critical path while presenting XLM and USDC as one monotonic progress bar.
- Kept the market chart geometry stable while switching periods, labelled retained data with its real range, and cancelled stale range requests before they could overwrite the latest selection.
- Kept first-time Private Payments setup in progress while every verified asset synchronizes, restoring the originally selected asset before success so XLM and USDC never hand off to separate preparation screens.
- Asked for Private Payments consent once per wallet, kept its success confirmation open until Done, and automatically prepared newly selected asset-pinned pools inside Send, Receive, and Add without replacing their modal shells.
- Kept private-asset readiness and verified balances deployment-specific, and cleared private runtime controls immediately when the active account or network changes.
- Treated issued-asset trustlines as spendable whenever Horizon reports full authorization, even when it also reports maintain-liabilities capability, and validated leading-zero Private Payment amounts with specific zero/value guidance instead of a generic error.
- Retried one semantically read-only RPC `getNetwork` probe after a transient transport or malformed-body response, preventing Firefox from rejecting a healthy endpoint while preserving fail-closed network-identity checks.
- Matched live Private Payments contracts against the binary verifier-key digest published in their manifests, retained initialized workers after first-time setup persistence, automatically resynchronized once when action preparation observes non-current chain state, selected a CORS-capable independent Testnet witness RPC, and kept witnessed checks live after old deployment ledgers age out of rolling RPC retention.
- Corrected the Private Balance whitepaper and public security copy to match optional routine RPC witnessing, provider-diversity assumptions, deployment and ceremony evidence limits, envelope bindings, diversifier collision bounds, restoration fee margins, runtime failure behavior, and the live Testnet deployment boundary.
- Kept Private Payments recovery lossless when a browser exposes partial or transiently failing native X25519 by dropping unusable handles and retrying envelope key agreement with the reviewed portable implementation.
- Paper-wallet certificates now print an imported account's actual secret key, reserve the vault recovery phrase for mnemonic-derived accounts, bind the certificate identity to the revealed material, and state when other account types need separate backups.
- Kept idle Private Payments pools withdrawable while deposits are paused by refreshing the current spend root atomically in every private send or withdrawal, with the refresh disclosed in review.
- Matched returned Private Payments archive records to their requested ledger keys, treated zero-lifetime entries as archived, and bounded every restoration footprint by the canonical action count.
- Funded reusable private-payment accounts for the full reviewed Private Balance fee cap and refused sweeps before signing when the one-time account cannot preserve both its minimum reserve and fee budget.
- Removed Horizon transaction joins from reusable-payment discovery, retried oversized pages at smaller limits, and advanced its durable cursor only to paging tokens the payments response actually returned.
- Made reusable private-payment recovery rescan retained chain history after seed import, and compacted terminal receipt history without dropping newly actionable payments at the encrypted cache limit.
- Preserved transaction max-time evidence when upgrading durable submission records, bounded polling for legacy records without an expiry, and kept merchant payment reversals actionable until their refund is canonically confirmed.
- Restored Private Payments records belonging to archived accounts, omitted records for genuinely unavailable accounts with a warning, and added account-scoped sensitive-record cleanup for new archival.
- Accepted the wallet's canonical Private Payments activity keys in encrypted transaction-note backups, rejected invalid note writes, omitted malformed optional note entries with a restore warning, and verified fresh backup bytes before returning them.
- Made merchant integrity manifests and wallet backup identities independent of browser locale, while transparently resealing authenticated stores created under legacy affected collations.
- Prevented account-label writes from creating a vault that the wallet's own decoder refuses, and kept rename failures visible without reporting success.
- Corrected the remaining Private Payments page copy that contradicted the hosted Testnet-only development preview policy.
- Neutralized spreadsheet formulas in wallet activity CSV exports and applied the same shared encoding to merchant reports.
- Enforced the same bounded, visible contact-name rules for JSON imports and direct persistence as the contact editor.
- Merchant setting fields now wait for durable authorization and storage, restore the last saved value after rejection, and show the failure.
- Merchant reconfiguration now updates the currently active owner in multi-owner stores.
- New merchant orders retain an immutable shift identity, so a device-clock rollback cannot remove sales from shift reports.
- Issued-asset balances now retain Horizon authorization and clawback flags, block locally known frozen sends, and disclose issuer clawback authority.
- Copied recovery phrases and secret keys now offer an explicit clipboard-clear action and warn that clipboard managers may retain them.
- Prevented merged mnemonic-derived accounts from being recreated at an archived HD index or appearing twice after account recovery; existing duplicate derived metadata is repaired on load while preserving the selected account.
- Kept non-sensitive payment-received feedback visible when Merchant Mode locks the operator immediately after settlement.
- Preserved the exact case of Stellar asset codes when adding and deduplicating trustlines.
- Allowed the key-bearing wallet to unlock when non-signing contact or note records are corrupt, while preserving those records for recovery and surfacing contacts as unavailable.
- Identified a key-authenticated account in the destructive backup-restore review, labeled watch-only and hardware identities honestly, and bound backup-health records to the exact exported or restored bytes.
- Bounded and validated Horizon fee statistics before rendering or transaction fee selection so malformed endpoint data cannot crash the wallet.
- Enforced SEP-29 memo-required destination checks for single and multi-recipient payments while exempting muxed addresses that carry their routing ID intrinsically.
- Applied inactivity auto-lock while a newly created vault is still displaying its recovery phrase, and made idle timing monotonic across device-clock changes.
- Required fresh wallet-password authorization before saving or resetting custom Stellar endpoints, and corrected public disclosures that wallet history uses SDF Horizon independently.
- Made full reset clear wallet-owned IndexedDB, session storage, service workers, and executable caches before reloading, and stopped a new worker revision from serving lazy chunks from older caches.
- Rejected payment amounts outside Stellar's signed 64-bit stroop range before rendering or submission.
- Kept Next.js telemetry disabled for local development and production builds without tracking an environment file.
- Loaded the offline password guessability dictionaries only when creating or changing a vault, keeping wallet startup within its existing JavaScript budget.

### Security

- Retained audited RFC 9180 note encryption, asset-pinned pool isolation, and Soroban-native Poseidon2 hashing after rejecting unreviewed consensus alternatives in explicit decision records.
- Corrected the Private Payments Merkle-domain invariant: the Poseidon2 length IV separates arities only, while same-arity separation depends on explicit slot-zero domains and Poseidon2 preimage/collision resistance.
- Bound the reduced eleven-signal Groth16 statement to the exact canonical action field and added a proof-mutation regression for that public input.
- Recovered sender-authenticated external recipient fingerprints and memos from outgoing envelopes during seed-only scans without persisting full private recipient addresses.
- Persisted one replay nullifier for deposits instead of two while keeping exact proof replay impossible; transfers and withdrawals continue to persist both.
- Shared the canonical ternary Merkle hash and empty roots between the protocol crate and pool contract, with Poseidon2 length-IV separation documented as a consensus rule.
- Disabled production-hosted Testnet Private Payments deployment use until fresh deployment evidence matches the replacement circuit, verifier, contract, and manifest hashes; Mainnet remains refused.

- Replaced source-text merchant security assertions with executable boundaries covering charge voiding, retained-record access, owner reauthentication, and every Merchant-to-Wallet navigation decision.
- Derived Private Payments manifest proving-key verification evidence from a successful pinned `snarkjs zkey verify` run instead of a literal claim.
- Required complete generated-artifact toolchains and the locked Private Payments Rust workspace in CI and tagged releases, and scheduled the ignored 100,000-action recovery model as a separate Gate B workflow.
- Made the shipped Private Payments manifest-tamper browser test unconditional and fixture-independent so CI and release verification cannot silently skip the fail-closed UI assertion.
- Made wallet inactivity locking use the larger of monotonic and forward wall-clock elapsed time, with focus, visibility, and page-resume checks so device suspend cannot preserve an unlocked session.
- Applied one current-receiving-account quarantine to charges, invoices, and counter codes; stale charges no longer settle or regenerate requests, and printed invoices replace stale, void, paid, draft, or incomplete payment instructions with a withdrawal notice.
- Enforced customer-note and customer-erasure authority inside the merchant domain, limited irreversible erasure to active owners, and retained actor-attributed hashed-address audit events after deletion.
- Centralized Merchant Mode exit authorization in the shared navigation transition, covering the mode switcher, mobile tabs, keyboard shortcuts, command actions, and in-flow redirects.
- Required comp authority for discounts that reduce a ticket to zero, recorded those giveaways as comps, and retained payment and open-shift authorization for their automatic settlement.
- Normalized muxed merchant payers to one base-account customer identity while preserving exact refund routes, made customer-history enrichment non-fatal, deduplicated settlement by transaction facts, and required staff review for reused invoice and counter-code routes.
- Kept merchant break-glass recovery reachable across wallet locks and reloads, used wallet reauthentication when an unreadable store cannot prove its staff roster, and retained raw recovery export after erase failures.
- Kept every merchant payment reconciliation actionable outside the 200-row presentation tray, derived the tray from durable records, and added owner-only bounded cleanup with an audit disposition for every row.
- Bound Multi-Sig Studio edits to canonical signer state, required explicit in-session provenance for signer additions, rejected stale or conflicting authority, and displayed full changed signer keys before signing.
- Added schema-validated BN254/BLS12-381 proving benchmarks with verified desktop smoke evidence, explicit pending phone and Soroban measurements, and no premature curve selection.
- Corroborated Private Payments recovery checkpoints, overlapping ledger hashes, and contract heads across independent RPC providers; disagreement now preserves the last authenticated state as status unknown, with routine witness checks and their access-pattern tradeoff exposed in settings.
- Hid Private Payments input/output lane roles behind private circuit selectors, secret-derived dummy nullifiers, randomized zero-value dummy notes, randomized lane ordering, and fresh self-output diversifiers.
- Bound each Private Payments deployment hash, manifest, proof asset field, archive record, and token transfer to the pool's constructor-pinned asset contract.
- Bound the incremental Merkle cache to the deployment, archive cursor, transcript head, root, frontier, and commitment count, with verified recovery after corruption.
- Removed private recipient and amount handoffs from browser storage, restored reusable-receipt discovery to the authenticated wallet birthday, terminated proof workers on cancellation, bound live contract circuit hashes to the manifest, and added Rust policy checks to tagged releases.
- Prevented issuer-logo referrer leakage, fully redacted long witness values, and escaped paper-wallet QR attributes before constructing print HTML.
- Revalidated wallet and merchant refund authority after durable transaction journaling, prevented settled charges from being voided, expired stale Mainnet issued-asset quotes, and cleared decrypted merchant snapshots on lock and unmount.
- Re-read the persisted signing-password policy at every signing boundary, required the same authorization for reusable private-receipt sweeps, rejected malformed federation memos, and rejected backup exports if the vault changes after password verification.
- Cleared transient mnemonic seed, SLIP-10 key, chain-code, and derivation buffers after constructing each Stellar account keypair.
- Reserved Merchant Mode enablement for its password-gated lifecycle action, rejected invalid merchant state before persistence, and stopped retention controls from reporting success before a durable save.
- Prevented a PIN verification started before a concurrent merchant lockout from activating an operator or unlocking the customer display after the lockout commits.
- New and changed vault passwords now require a Good or Strong guessability rating and a stable NFC Unicode representation; existing password unlock remains compatible.
- Public security and privacy guidance now accurately describes the production-hosted Testnet development fixture, its single-party setup risk, and the current private-address diversifier correlation limit.
- Corrected Private Payments documentation to describe the production-hosted Testnet development fixture accurately, cleared locally owned HPKE secret/plaintext buffers, and required immutable attested release artifacts before deployment.
- Bound public payment signing to an immutable account, network, destination, asset, amount, memo, fee, and signer-path review snapshot, and added exact on-device Trezor receive-address verification.
- Required current staff authority for retained merchant views and exports, fresh owner authorization before leaving Merchant Mode, writer ownership before settlement polling, and active counter-code status before constructing printable payment artifacts.
- Revoked password and passkey unlocks that finish after a lock, and serialized backup restore against an early, cross-tab reset epoch so erased credentials cannot be resurrected.
- Bound transaction finality, merge recovery, expiry decisions, and merchant settlement reads to canonical SDF Horizon; configurable endpoints can still submit transactions but cannot fabricate confirmation or unlock retries.
- Moved offline XDR signing into the vault's generation-revocable, key-wiping signer scope while retaining fresh password and live authority checks.
- Rejected imported transaction envelopes with a zero maximum time so cosigner authorization cannot be retained indefinitely.
- Closed secret-bearing paper-wallet print windows when their parent modal closes or the wallet locks, resets, or receives a peer-tab lock.
- Preserved signed-transaction recovery records after untrusted Horizon 4xx responses and allowed only exact-hash canonical lookup results to resolve prepared submissions.
- Enforced current staff or owner authorization for merchant lifecycle, recovery erasure, charge voiding, customer mutations, takings, and customer records, with latest-revision checks at persistence boundaries.
- Kept the privacy shield above portal dialogs, stopped charge monitoring from synthesizing staff activity, quarantined counter codes after receiving-account rotation, and neutralized spreadsheet formulas in merchant CSV exports.
- Bound multi-signature authority reads to SDF Horizon so a custom endpoint cannot hide retained signers, revoked hardware approvals completed after wallet lock, and made emergency reset revoke signing authority and erase the vault before fallible browser-storage cleanup.
- Repaired Private Payments address and proving-key provenance across the browser, encrypted storage, contract, manifest, and deployment tooling; testnet continues to use explicitly disclosed single-party development proving material, while every non-development release still requires ceremony and audit evidence.
- Pinned and hash-verified the phase-one transcript, added zkey-to-R1CS verification, checked browser distributables for drift, disabled npm lifecycle scripts by policy, and wired generated/reproducible artifact checks into CI and tagged releases.
- Preserved every authenticated Private Payments note leaf with a distinct leaf-aware wallet identity, bound transfer review to the full canonical recipient address, and replaced the 32-bit check code with a 128-bit SHA-256 code.
- Required the active merchant owner and a fresh wallet-password check for payment-routing changes and reconfiguration, rejected pure watch-only receiving accounts, enforced report permissions, and quarantined invoices after destination drift.
- Made multi-signature configuration transactions explicitly write every retained signer so threshold safety cannot depend on endpoint-reported signer state.
- Kept Private Payments receive-address rotation separate from the canonical self-output identity and rejected any self-output whose keys do not match its stamped diversifier.
- Revoked in-flight software signers on lock, reset, or session replacement; bound transaction confirmation to the requested canonical hash; and erased Private Payments IndexedDB records during a full wallet reset.
- Bound encrypted merchant metadata to the exact stored-record ciphertext set and required explicit, schema-valid successful Horizon operations before settling orders.
- Enforced active-owner checks inside merchant settings writes, revalidated refund permissions at the signing boundary, and persisted cross-tab exponential PIN backoff in encrypted merchant storage.
- Added monotonic vault revisions to reject stale cross-tab account writes and vault-bound exponential backoff for repeated password verification failures.
- Bound backup-health status to the recoverable wallet credential set, deeply authenticated every nested credential and archive before restore, and enforced file, decoded-data, collection, and keystore identity limits on imports.
- Bound one-time and reusable Private Payments addresses to the exact pool deployment and rejected legacy or cross-deployment recipients before proof or transaction construction.
- Added password-authorized, fee-capped restoration for exact archived Private Payments records before canonical recovery resumes.
- Required explicit per-session Private Payments activation, removed exact balances from cross-tab broadcasts, labeled ledger progress as selected-RPC data, and added dev proving-key risk to testnet opt-in.
- Patched high and moderate circuit-tooling advisories, enforced nested npm and Rust dependency policy in CI, removed unsafe release-tag interpolation, ignored all environment files, and corrected the installed Stellar SDK script allowlist.
- Rejected common and wallet-themed new vault passwords with a maintained offline guessability estimator while preserving existing vault compatibility.
- Required Multi-Send to present and sign an immutable per-recipient review snapshot instead of broadcasting directly from the editable form.
- Cleared backup authentication and revealed material at narrower lifecycle boundaries, required fresh authorization for nested encrypted exports, and moved paper-wallet printing out of CSP-blocked inline code.
- Corrected Private Payments preview and ceremony provenance to the shipped artifact hashes and removed an unused per-nullifier RPC lookup that could weaken spend unlinkability if activated.

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
