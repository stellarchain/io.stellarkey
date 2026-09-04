# ADR 0009: Add an Optional Browser Peer Relay

## Status

Accepted for Testnet development

## Context

Direct submission publishes the user's Stellar account as the inner transaction
source. Fee bumping changes only the outer fee source. Transfers and withdrawals
need no user Soroban authorization because the proof authorizes the state
transition, so an unrelated account can safely be the source if it reviews and
signs the exact transaction.

StellarKey must not operate a backend, custodial relay, indexer, or private
queue. The design must also preserve direct submission and must never expose a
sender by silently falling back to it.

## Decision

Add two independent choices: send through a privacy relay, and help relay other
payments. Both run in the open-source browser client and are off by default.
Deposits remain direct because their public source must authorize the token
movement.

Use at least two configurable public Nostr relay origins for bounded discovery.
Use ephemeral Nostr identities and NIP-44 v2 for selected-peer messages. The
selected peer supplies the transaction source, pays the Stellar network fee,
and receives a proof-bound encrypted same-asset note in the third output lane.
Changing the selected peer requires a new proof.

Before manual approval, the helper validates the exact unsigned transaction,
network, source account, pool method, time bounds and fee caps; rejects auth,
memo, extra operations, and unsupported preconditions; verifies matched output
diversifiers; decrypts exactly one quoted real fee note; and simulates the exact
transaction. After signing, the client compares signed XDR with the reviewed
transaction before the helper submits it.

## Consequences

- Relay mode removes the sender's Stellar account from transaction history and
  from the pool archive. The helper account remains public.
- Public Nostr infrastructure is not a StellarKey server, but its operators see
  connection IPs, timing, and public discovery requests. The selected helper
  sees the asset, fee, proof, and exact job.
- NIP-44 protects message content in transit but provides neither forward
  secrecy nor post-quantum confidentiality.
- Relay availability is best-effort. The honest choices are wait, retry, or
  explicitly prepare a new direct-submission review.
- A helper can refuse or censor, but cannot redirect the encrypted fee note or
  alter a proof-bound transaction successfully.
