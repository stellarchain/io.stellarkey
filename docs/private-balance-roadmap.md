# Private Balance Roadmap

**Updated:** 2026-09-03

This file records prospective Private Balance work. Checked items are complete;
unchecked items are hypotheses that still require the stated validation. Nothing
in this file changes the behavior or guarantees documented in
[`private-balance.md`](private-balance.md).

## Planned experiments

- [ ] Prototype optional peer-relayed submission for private transfers and
  withdrawals.
  - Keep direct self-submission available. Never switch from relayed to direct
    submission without explicit user approval because that reveals the user's
    Stellar account as the transaction source.
  - Keep deposits unchanged: the public deposit source and amount remain
    visible and the source must authorize the asset movement into the pool.
  - Run discovery, quote selection, proof delivery, failover, simulation,
    signing, submission, and confirmation in the open-source browser client.
    Do not introduce a StellarKey backend, operated relay, indexer, custody, or
    server-side private state.
  - Use multiple configurable, independent public gossip transports. Treat
    every transport and peer as untrusted and disclose their network-metadata
    visibility.
  - Evaluate a protocol change in which the proof binds the relayer fee but not
    a particular fee recipient. The submitting peer must authenticate its
    payout address, allowing the same proof to fail over without reproving.
  - Keep "use a privacy relay" and "help relay payments" as separate settings.
    Relaying for other users must be explicit opt-in with local fee and spending
    limits.
  - Validate before implementation: sender absence from the transaction and
    permanent archive, proof/action non-malleability, replay and competing-peer
    behavior, invalid-job resource exhaustion, XLM and issued-asset payout
    eligibility, real Soroban fee economics, discovery/submission p50 and p95,
    peer churn, browser shutdown, and iPhone WebKit behavior.

## Evaluated and not planned

- [x] Reject disposable ephemeral gas accounts as a no-peer fallback.
  - A generated Ed25519 keypair is not a Stellar account. It cannot supply a
    transaction sequence number or pay fees until an existing account creates
    or sponsors it and its reserve.
  - Withdrawing native XLM from the pool cannot create a nonexistent classic
    account. Creating it from the user's public account establishes the graph
    link the design is intended to avoid.
  - A claimable balance does not bootstrap the account: claiming is a
    transaction whose source account must already exist, sign, have a sequence
    number, and pay the fee.
  - Withdrawing XLM to an already-created ephemeral account and then using it as
    a transaction source publicly links the withdrawal endpoint to subsequent
    pool actions. It also adds reserve, key-recovery, dust, and account-lifecycle
    complexity.
  - Preserve the honest fallbacks instead: wait for a peer, retry another peer,
    or let the user explicitly choose direct self-submission with a privacy
    warning.
