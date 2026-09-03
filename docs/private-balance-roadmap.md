# Private Balance Roadmap

**Updated:** 2026-09-04

This file records prospective Private Balance work. Checked items are complete;
unchecked items are hypotheses that still require the stated validation. Nothing
in this file changes the behavior or guarantees documented in
[`private-balance.md`](private-balance.md).

## Planned experiments

- [ ] Remove the observed clear-diversifier output-role fingerprint without
  breaking scanning or recovery.
  - First test a matched-lane mitigation: use the same clear diversifier for
    both outputs in each action while retaining the reviewed X25519 HPKE
    envelope.
  - Keep a fully hidden diversifier as a separate cryptographic workstream. Do
    not delete the current four bytes: the scanner needs them before decryption.
  - Require an independently reviewed diversified-key-agreement specification,
    cross-language vectors, seed-only recovery proof, and physical-phone scan
    benchmarks before replacing HPKE.
  - Evidence and gates are recorded in
    [`private-balance-hidden-diversifier-unified-pool-research-2026-09-04.md`](private-balance-hidden-diversifier-unified-pool-research-2026-09-04.md).

- [ ] Design and prototype one immutable asset-private XLM/USDC pool on
  testnet.
  - Hide the asset only for internal transfers; deposits and withdrawals retain
    their unavoidable public SAC, amount, and endpoint boundary data.
  - Bind the ordered two-asset allowlist into the deployment, put a compact
    asset index in both recipient and outgoing encrypted plaintext, and bind
    the full private asset field into every note commitment. Use the public
    zero sentinel—not the hidden asset—in outgoing authenticated data so
    seed-only sender recovery is not circular.
  - Do not add arbitrary asset admission or a mutable token registry.
  - Start with two outputs. Treat a third private-relayer-fee output as a
    separate measured decision because it increases tree/archive growth and
    changes peer failover semantics.
  - Freeze the circuit only after cross-asset mutation tests, Soroban resource
    simulations, tree-capacity analysis, and physical-phone proving/scanning
    measurements pass. A changed R1CS requires a fresh phase-2 ceremony.
  - Evidence and gates are recorded in
    [`private-balance-hidden-diversifier-unified-pool-research-2026-09-04.md`](private-balance-hidden-diversifier-unified-pool-research-2026-09-04.md).

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
  - Resolve the unified-pool fee conflict before selecting that design: a
    public SAC payout reveals the asset of an otherwise asset-private transfer,
    while an encrypted fee note normally binds a selected peer and makes
    failover require reproving.
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
