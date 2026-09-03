# Private Pool Registry, Diversifier, and Peer Relay Design

**Date:** 2026-09-04

**Status:** Accepted for testnet implementation

## Goals

Replace the current per-asset testnet pools with one asset-private pool that:

- has one on-chain asset administrator;
- admits assets without deploying another pool;
- can stop new deposits for an asset without blocking withdrawals;
- hides the asset of internal transfers;
- removes the measured clear-diversifier output-role fingerprint without
  breaking scanning or seed-only recovery; and
- supports an optional browser-to-browser privacy relay without a StellarKey
  backend.

The migration deliberately replaces the current testnet state. There is no
backward-compatibility or balance-migration path.

## On-chain asset registry

The constructor stores `asset_admin` instead of a pinned asset. Registry
indices are append-only `u32` values. Each entry stores the SAC contract
address, its canonical asset field, and one of two states:

- `Active`: deposits, private transfers, and withdrawals are usable.
- `ExitOnly`: new deposits are rejected; existing notes can still transfer
  privately or withdraw publicly.

Only `asset_admin` can add an asset or change its state. An address-to-index
mapping rejects duplicates. An index and its asset address are never deleted or
reassigned, because historical encrypted notes contain that index. Asset-admin
rotation uses a two-step propose/accept flow so a typo cannot irreversibly lose
registry control.

The administrator cannot seize notes, forge proofs, learn amounts, block
private transfers, or block withdrawals. Because internal transfers hide their
asset from the contract, `ExitOnly` intentionally cannot disable internal
transfers for one asset. The administrator controls admission, not custody.

## Asset-private actions

All admitted assets share one commitment tree, root window, nullifier set, and
archive transcript. The circuit receives a private nonzero
`actionAssetField`. Every real input and output note is committed with that
field, so one action cannot mix assets.

Deposits and withdrawals include a public asset index. The contract resolves
the registry entry and supplies its full asset field as the public
`assetField`. The circuit requires the private and public fields to match.
Internal transfers expose neither an asset address nor an index; their public
`assetField` is zero, and the circuit requires that zero only for transfer
actions.

The recipient and sender-recovery plaintexts use four formerly reserved bytes
for the immutable asset index. After decryption, the scanner resolves the
index, recomputes the full asset field, and authenticates the note commitment.
Internal outgoing-envelope AAD uses the public zero asset sentinel, avoiding a
circular dependency during sender recovery.

## Three fixed output lanes

Every action appends exactly three output packages. The third lane enables a
private peer-relay fee without publishing the transferred asset:

- Direct submission: unused lanes are normal-looking encrypted zero-value
  dummy notes.
- Peer-relayed submission: one lane is a positive-value note encrypted to the
  selected peer; the circuit treats it as an ordinary private output.

The public `relayer`, `relayer_fee`, and relayer payout token call are removed.
The canonical action hash already binds all three commitments and ciphertexts,
so a peer cannot redirect its fee or alter the payment. The peer decrypts its
fee lane and validates the complete action locally before it signs or submits.
The public-signal count remains 11: the removed relayer-fee signal is replaced
by the third output commitment.

Three outputs increase leaf and archive growth by 50% relative to the current
two-output protocol. The measured circuit remains within the existing
`2^14` Groth16 domain at depth 17. This cost is accepted for the testnet relay
prototype and must be re-measured before any production ceremony.

## Matched-lane diversifiers

The four clear diversifier bytes remain in the 181-byte X25519 HPKE envelope.
Deleting them would make decryption circular and break seed-only recovery.

Instead, all three output lanes in one action use the same clear diversifier.
For a private payment, the recipient address supplies it. Wallet-owned change
and padding keys are derived for that value. For deposits and direct
withdrawals, the wallet chooses a fresh action diversifier and derives every
output for it.

For a relayed action, the selected peer derives a one-time private fee address
for the action diversifier during an encrypted negotiation. Different wallets
derive different keys for the same diversifier, so this does not share key
material. This removes the zero-versus-random lane-role fingerprint measured on
all ten existing testnet transfers. It does not hide repeated use of a rotated
address; a fully hidden diversifier remains a separate reviewed cryptographic
project.

## Frontend-only peer relay

Relay use and helping relay are independent, opt-in settings. Direct
self-submission remains available, but the client never silently falls back to
it because doing so exposes the user's Stellar account as transaction source.

The initial transport is a small, replaceable gossip interface implemented in
the static browser app. Public Nostr relays carry short-lived, signed events;
StellarKey operates no relay, backend, indexer, or private state. Users can
configure multiple relay URLs. Transport code is loaded only after explicit
relay intent.

The interaction is:

1. The sender publishes a bounded request from an ephemeral gossip identity.
2. Opted-in peers return encrypted quotes containing fee and expiry policy.
3. The sender selects one quote and privately sends the action diversifier and
   asset index.
4. The peer returns a one-time private fee address derived for that
   diversifier.
5. The sender creates the proof and sends the bounded action/proof job through
   the encrypted channel.
6. The peer validates structure, proof binding, expiry, fee note, simulation,
   and spending limit, then explicitly approves wallet signing and submission.
7. The sender independently confirms the transaction through its configured
   Stellar RPC.

No request contains the sender's Stellar account or private keys. Peers and
gossip relays still observe network metadata and timing. The selected peer
learns the action's asset and offered fee. A disappearing selected peer requires
selecting another quote and generating a new proof, because the private fee
output is encrypted to that peer. The UI states this before proof generation.

The relayer cannot modify the action: proof verification binds its canonical
hash. It can decline, delay, front-run submission of the identical action, or
learn the job it was selected to relay. Duplicate submissions converge on the
same nullifiers, and only one can succeed.

## Client and product migration

Private Payments becomes one setup and one private address across all admitted
assets. Asset availability comes from the authenticated on-chain registry;
manifest metadata supplies curated presentation for the initial testnet assets
but is not admission authority.

An authenticated admin-only settings panel supports adding a SAC and switching
`Active`/`ExitOnly`. Ordinary users see an asset's current state and cannot
attempt a deposit when it is exit-only. Private receive does not require
per-asset setup.

The send and withdraw reviews expose a `Submission` choice:

- `Privacy relay`: quote, select peer, prove, wait for peer review, submit,
  confirm.
- `My Stellar account`: explicit warning, prove, sign, submit, confirm.

Preparing, awaiting quote, proving, awaiting peer, signing, submitting,
pending, confirmed, rejected, failed, and status-unknown remain distinct states.

## Validation gates

Before the new testnet deployment is advertised, the implementation must pass:

- circuit positive, mutation, underconstraint, and cross-asset tests;
- Rust model and contract tests for admin authorization, append-only indices,
  `ExitOnly`, hidden transfers, withdrawal liveness, and three-leaf updates;
- deterministic browser/Rust/archive vectors;
- scanner recovery of mixed assets and outgoing activity from a seed;
- matched-diversifier tests for all action and dummy shapes;
- relay protocol tests for malformed jobs, replay, quote expiry, peer failure,
  no silent direct fallback, and sender absence from submitted XDR;
- desktop and iPhone WebKit interaction tests for explicit intent, focus,
  cleanup, stale quote handling, and status transitions;
- regenerated artifacts, a new development zkey, a newly deployed testnet
  contract, and live XLM/USDC deposit-transfer-withdraw smoke tests; and
- updated whitepaper, recovery, deployment, security, and roadmap statements.

The generated development zkey remains testnet-only. These changes require a
new public phase-2 ceremony and independent review before production use.
