# Security Review Follow-up Plan

**Goal:** Close the reproducible security and integrity gaps that remain after
`19924b9`, while preserving the production-hosted Testnet Private Payments
preview and keeping Mainnet refusal independent.

## Implement

1. Re-read the persisted password-for-signing policy at every authorization
   boundary so an already-open tab cannot use a stale weaker policy.
2. Expose an authorization-only transaction boundary for custom signers and use
   it before reusable-receipt sweep signing.
3. Reject non-string, unsupported, or oversized federation memos before they
   enter Send state.
4. Export backups only from the exact password-verified vault revision; reject
   password-change or account-change races rather than producing a mixed backup.
5. Recheck the captured wallet session and current merchant refund authority
   after durable submission journaling and immediately before broadcast.
6. Reject voiding any charge that is no longer awaiting payment.
7. Make Mainnet merchant quotes expire and refresh; stale or unavailable market
   data must remove the asset from quoting instead of silently retaining a rate.
8. Purge the merchant repository's decrypted snapshot on wallet lock and provider
   unmount.
9. Replace raw private recipient/amount `sessionStorage` handoffs with expiring,
   single-use in-memory intents.
10. Recover reusable receipts from the authenticated wallet birthday rather than
    an arbitrary one-year floor; retain Horizon's binary ledger-time seek.
11. Terminate a proving worker when proof generation is cancelled and rebuild it
    through the existing background sync path before another action.
12. Compare on-chain pool circuit and verification-key hashes with the pinned
    manifest before accepting archive state.
13. Make the tag release depend on the pinned Rust `cargo deny` policy gate.
14. Apply small, bounded defense-in-depth fixes: no-referrer issuer images,
    redaction of long decimal witness values, and escaped paper-wallet QR URLs.

Each behavioral change is test-first and receives focused regression coverage.

## Already closed on this branch

- Canonical transaction finality, account-merge inspection, and merchant payment
  discovery ignore custom Horizon overrides.
- Browser-clock expiry no longer releases an envelope before canonical ledger
  time passes its `maxTime`.
- Password/passkey unlock and restore are lifecycle fenced.
- Concurrent Merchant PIN guesses cannot overtake the persisted lockout.
- Public send review is exact-intent bound and full addresses are shown.
- HD mutable derivation buffers are cleared.
- The development proving material is accurately disclosed and independently
  refused on Mainnet.
- Private artifact reproducibility is already a release prerequisite.

## Do not implement in this batch

- Do not remove hosted Testnet Private Payments. The single-party proving setup
  remains an explicit Testnet risk until a separately reviewed ceremony.
- Do not add Argon2id without a versioned vault wrapper, rollback-safe migration,
  audited browser implementation, and representative mobile benchmarks.
- Do not redesign the cleartext diversifier in-place. That changes address and
  envelope compatibility and requires a versioned protocol migration.
- Do not add an incomplete pool/code TTL restoration route without a reviewed
  contract deployment and exact restoration transaction design.
- Do not prompt follower tabs before reset. Same-origin code already has storage
  authority, while confirmation can leave credentials or private records behind.
- Do not reject common four-digit till PINs as a security boundary. Persisted,
  concurrent-safe throttling is the control; owner actions still require wallet
  authentication.
- Do not promise JavaScript string zeroization or timed clipboard clearing.

## Verification

- Focused Node tests for every accepted behavior.
- TypeScript, ESLint, full application tests, production build.
- Private browser tests, generated/provenance checks, reproducible artifact gate,
  Rust tests and `cargo deny` where available locally.
