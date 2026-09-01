# Security Review Hardening Plan

> **For Codex:** Execute this plan in focused, test-first commits. Preserve production-hosted Testnet Private Payments; keep Mainnet refusal independent and fail closed.

**Goal:** Correct the security-review findings that reproduce against `571f5d1`, preserve the Testnet privacy preview, and avoid changes based only on speculative or stale review text.

**Architecture:** Keep custom endpoints for optional submission and ordinary operational reads, but move security-authoritative finality and merchant settlement reads to the immutable network Horizon configured in `NETWORKS`. Add generation guards for same-tab unlock races and an exclusive, epoch-bound wallet lifecycle transaction for cross-tab restore/reset. Enforce Merchant Mode permissions at context actions and route boundaries. Freeze public-send intent at review time and expose hardware receive verification without moving signing secrets into React state.

**Tech stack:** Next.js 16.3 App Router static export, React 19 client components, TypeScript 6, Node test runner, Playwright, Stellar SDK 17, browser Web Locks/BroadcastChannel/localStorage.

## Evidence decisions

### Implement

- Canonical transaction lookup and confirmed account-merge inspection currently use the configurable Horizon URL despite their security-authoritative names.
- Pending-transaction expiry currently trusts `Date.now()` before treating canonical `not_found` as retryable; use the canonical ledger close time.
- Merchant settlement discovery currently uses configurable Horizon and can be run by a tab that does not hold the merchant writer lock.
- Password/passkey unlock can reinstall a session after a concurrent lock, and React can publish an unlocked phase after a later lock.
- Backup restore can commit after cross-tab reset intent; bind restore to an exclusive lifecycle lock and persistent epoch.
- Corrupt non-key-bearing contacts or transaction notes currently block wallet unlock; quarantine them without deleting the raw encrypted records.
- Leaving an unlocked merchant till for wallet/signing surfaces lacks owner reauthentication.
- Merchant retained-record routes and exports do not uniformly enforce current-session permissions at the action boundary.
- Renaming a terminal during an open shift breaks the report/order join.
- Expired, retired, or old-destination counter codes still generate QR and print-DOM artifacts.
- Normal Send rebuilds from mutable form state after review; freeze and validate a reviewed intent.
- Hardware accounts lack an on-demand receive-address verification action.
- The Testnet development proving key disclosure and security document are factually stale.
- Release deployment verifies a self-supplied checksum but not the previously generated GitHub artifact attestation.
- Best-effort wiping is missing for locally owned private-payment encryption buffers.
- Asset-code input normalization should not uppercase case-sensitive Stellar asset codes.

### Already fixed; retain regression coverage

- Private addresses are deployment-bound and the 170-character storage format is aligned.
- Multisig configuration writes all reviewed signers explicitly and loads signer authority from canonical Horizon.
- SEP-29 memo-required destinations are checked against canonical Horizon; muxed destinations are exempt.
- Signing-review address and issuer values render in full.
- Software and hardware signing callbacks are generation-revoked at the signing boundary.
- Emergency reset erases the vault before fallible IndexedDB/service-worker cleanup and removes private records.
- Private runtime network scanning waits for explicit intent; the integrated Home balance may decrypt the local authenticated cache only.
- Mainnet Private Payments is rejected independently of the development-fixture opt-in.

### Do not implement as stated

- Do not remove Testnet Private Payments. Keep it available with an explicit development trusted-setup warning and no real-value claim.
- Do not label the single immutable SDF Horizon response as a decentralized quorum. It is a trusted canonical provider and failure/disagreement remains unknown.
- Do not add a future Mainnet promotion mechanism around unauthenticated evidence URLs. Mainnet stays unavailable until a separately reviewed, signed promotion design and ceremony exist.
- Do not promise JavaScript string zeroization. Minimize retention and wipe mutable byte arrays where possible.
- Do not automatically erase the clipboard if the app cannot prove it still contains the copied secret; overwriting unrelated user clipboard data is unsafe.
- Do not remove the user-configurable endpoint or broadly narrow CSP `connect-src` without replacing that supported feature.
- Do not treat low-severity Trezor UTXO dependency advisories as reachable in the Stellar signing path without evidence.

## Task 1: Trusted network finality

**Files:** `src/lib/api.ts`, `src/lib/submission.ts`, `src/hooks/useWallet.tsx`, `src/lib/merchant/watch.ts`, focused tests.

1. Add failing tests proving canonical lookups, account-merge inspection, and merchant settlement reads ignore a custom Horizon override.
2. Add a canonical latest-ledger close-time lookup with strict schema validation.
3. Require both canonical `not_found` and canonical ledger time past `maxTime` before releasing an expired pending transaction for retry.
4. Keep unavailable/malformed results as `status_unknown`.
5. Run submission, merchant-watch, and domain tests; update `[Unreleased]` Security notes.

## Task 2: Wallet lifecycle revocation and ancillary quarantine

**Files:** `src/lib/vault.ts`, `src/hooks/useWallet.tsx`, a small lifecycle helper if justified, focused vault/storage tests.

1. Add failing races for lock-during-password-unlock, lock-during-passkey-unlock, UI publication after lock, and reset-during-restore.
2. Capture and recheck a monotonically increasing in-memory session generation after each unlock await and before session installation.
3. Recheck the installed session before React publishes unlocked state.
4. Broadcast reset intent early and increment a persistent wallet lifecycle epoch.
5. Commit restore only under an exclusive Web Lock when its captured epoch still matches; provide a conservative same-tab fallback.
6. Establish the key-bearing vault session independently of contacts/notes. Surface a recoverable warning and empty derived view for corrupt ancillary records without overwriting raw storage.
7. Run focused vault/storage tests; update `[Unreleased]` Security and Fixed notes.

## Task 3: Merchant integrity boundaries

**Files:** `src/hooks/useMerchant.tsx`, `src/hooks/useMerchantRuntime.tsx`, `src/components/Dashboard.tsx`, merchant route/export/poster components, focused merchant tests.

1. Add failing tests for non-writer polling, owner-gated merchant exit, locked/report-forbidden record routes, export permission revalidation, open-shift terminal rename, and blocked poster artifact absence.
2. Allow watcher leases only to the held writer or explicit no-Web-Locks fallback; release leases and show degraded state on persistence failure.
3. Add an owner-authenticated “leave Merchant Mode” action to the shell context and call it before wallet navigation.
4. Gate retained-record routes and already-open descendants from the provider’s current active operator/capability state.
5. Move invoice/archive export into permission-checked context actions with a commit-time operator recheck.
6. Reject terminal rename while a shift is open.
7. Construct payment URI, QR, poster face, and print portal only while the code is active, current-destination, and reproducible.
8. Run merchant tests; update `[Unreleased]` Security and Fixed notes.

## Task 4: Review binding and hardware receive verification

**Files:** `src/components/SendModal.tsx`, `src/components/ReceiveModal.tsx`, `src/lib/hardware.ts`, wallet context as needed, focused tests.

1. Add a failing Send regression showing form changes after Review cannot change the signed intent.
2. Freeze destination, amount, asset, memo, fee, source account, and network at Review; submit only that snapshot or invalidate review.
3. Add a Trezor-only “Verify on device” receive action that requests the stored derivation path and rejects an address mismatch.
4. Keep the public/private receive modal shell mounted and stable.
5. Run send/hardware/overlay tests; update `[Unreleased]` Added and Security notes.

## Task 5: Testnet privacy disclosure and cryptographic hygiene

**Files:** Private setup UI, `docs/private-balance.md`, private browser encryption implementation/tests, asset input if confirmed.

1. Add a failing UI test for explicit development trusted-setup disclosure before opt-in/deposit.
2. State that the single-party setup could permit forged Testnet proofs and loss of Testnet pool funds; never imply real-value safety.
3. Correct the security document: the pinned development key verifies but lacks a multi-party ceremony and is intentionally allowed only on Testnet.
4. Wipe locally owned ephemeral/private plaintext byte buffers in `finally` blocks where APIs expose mutable arrays.
5. Preserve asset-code case in manual trustline input and add regression coverage.
6. Run private browser, UI, and asset tests; update `[Unreleased]` Security and Fixed notes.

## Task 6: Release integrity and final verification

**Files:** `.github/workflows/release.yml`, release-governance tests/docs, `CHANGELOG.md`.

1. Add a failing workflow test requiring attestation verification of every downloaded deploy artifact.
2. Run `gh attestation verify` for the archive, SBOM, release manifest, and checksums before extraction. Keep checksum verification as defense in depth.
3. Document enabling GitHub immutable releases as a repository-setting release prerequisite; do not claim source code can enforce the setting.
4. Run typecheck, lint, full application tests, private browser/circuit/Rust gates as applicable, production build, bundle checks, and Playwright suites.
5. Record any human hardware, screen-reader, and live-ledger checks that remain external/manual.

## Research ledger

- Next.js 16.3 installed docs, accessed 2026-09-01: client boundaries and lazy Client Components informed keeping security actions in existing client contexts without widening server/client boundaries.
- Stellar SEP-29, accessed 2026-09-01: non-muxed memo-required accounts must be blocked without a transaction memo; confirmed existing behavior.
- GitHub artifact attestation and immutable release docs, accessed 2026-09-01: verify downloaded artifacts with GitHub CLI and enable release immutability as a repository control.
- MDN Web Locks API, accessed 2026-09-01: an exclusive named lock serializes same-origin tabs/workers; informed restore/reset commit serialization.
