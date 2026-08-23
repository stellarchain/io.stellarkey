# Wallet SOTA Remediation Design

## Scope and safety invariants

This remediation covers every concrete defect from the 2026-08-23 audit. It does not claim to deliver the separately identified product programs—full Soroban wallet support, WalletConnect/mobile, Blockaid, or passkey smart accounts—in the same patch. Instead, it establishes the transaction, identity, storage, test, and permission boundaries those programs require.

The primary invariant is that the value a user reviews is the exact value the wallet signs. Every transaction draft must bind network, source account, operation sources, full asset identity `(network, code, issuer)`, amount, memo, fee, time bounds, and operation-specific limits. A form mutation invalidates its quote or draft synchronously. Unsupported or opaque intent fails closed rather than falling back to another asset or showing a warning next to an enabled signing button.

The second invariant is identity completeness. Issued assets are never represented by code alone. Issuer metadata is self-declared unless the `stellar.toml` currency entry matches both code and issuer. SAC IDs are derived from the SDK and active network passphrase. Activity, exports, transaction review, price alerts, and cached metadata retain issuer and network.

The third invariant is explicit transaction state: prepared, signed, submitting, submitted-with-known-hash, confirmed, failed, or status-unknown. A network failure after broadcast must never be presented as a safely retryable failure.

## Architecture

Small pure modules will own critical policy rather than duplicating it across React components. Asset identity and Horizon mapping remain in the data layer. A transaction-inspection module will decode classic operations into a complete, typed review model and calculate authorization requirements per effective source account. Unknown operations are marked non-signable. Multisig configuration uses the same partial-envelope workflow as payments when the existing high threshold cannot be met locally.

React forms keep editable input separate from immutable quotes/drafts. Swap quotes carry a request key and are valid only while that key equals the current form key. SEP-7 parsing returns either a supported exact asset or a blocking error; it never selects native XLM by default for an unsupported credit asset. Federation resolution owns its memo and clears it when the destination changes.

Horizon requests use a single abortable helper whose deadline includes body consumption. Wallet refreshes are keyed by network and public key, coalesced while in flight, and commit results independently so one price or history outage cannot hide a fresh balance. Pagination and metadata requests carry the same identity key. Account responses are reused for balances, reserve inputs, and liabilities.

Vault and backup data use explicit versioned runtime decoders. Restore validates and migrates the complete payload in memory before any mutation, snapshots prior storage, commits all stores, and restores the snapshot if a write fails. Invalid preferences cannot disable security controls.

## User experience and trust

The offline signer becomes a transaction-review signer: it decodes the envelope before requesting a password, verifies the active account is an authorized signer, shows network selection as an explicit user assertion because XDR does not encode a network, and blocks opaque operations. Security health and asset badges report facts only. A domain is “issuer-declared” until exact TOML issuer binding succeeds; SEP-8 is shown only when an actual SEP-8 endpoint/capability has been verified. The nonfunctional price alert is removed until a real foreground/background notification design exists.

Modals use a stack so only the topmost dialog handles Escape and focus restoration. Dropdown triggers are real buttons supplied by the caller, not wrapper controls around buttons. Segmented controls expose selected state. Large modals mount only while open, which preserves Next.js dynamic-import code splitting.

Product identity is normalized to “Stellar Wallet” while legacy `polaris.*` storage keys remain unchanged for compatibility. Trezor Connect receives the canonical application name, origin, and a documented support contact. Security documentation states the web-origin/XSS, extension, Horizon, metadata, hardware-popup, weak-password, and supply-chain trust boundaries.

## Testing and delivery

Every behavior change follows red-green-refactor. Pure Node tests cover quote keys, asset binding, Horizon operation mapping, liabilities, SAC derivation, transaction inspection, multisig threshold/source analysis, broadcast ambiguity, backup decoding, and stale-response guards. Playwright uses intercepted Horizon, price, federation, and Trezor boundaries with isolated storage; no real secret or live account is required. CI gates onboarding/unlock, exact-asset payment intent, swap review, backup restore, account/network races, topmost-modal behavior, and submission-status UX.

The current audited implementation is extensive uncommitted work on `main`. Creating a worktree from `HEAD` would omit it, so this remediation is performed in place without commits. Each tranche is independently reviewed and verified, and unrelated user changes are preserved.
