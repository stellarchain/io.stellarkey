# Private Balance Roadmap

**Updated:** 2026-09-04

This file records prospective Private Balance work. Checked items are complete;
unchecked items are hypotheses that still require the stated validation. Nothing
in this file changes the behavior or guarantees documented in
[`private-balance.md`](private-balance.md).

## Implemented Testnet work

- [x] Remove the observed clear-diversifier **lane-role** fingerprint without
  replacing the reviewed X25519 HPKE construction.
  - Every one of the three envelopes in an action now carries the same random
    action diversifier. An observer therefore cannot identify recipient,
    change, relay-fee, or dummy lanes from different clear diversifiers.
  - This is deliberately not described as a hidden diversifier. The four bytes
    remain clear because the current scanner needs them before X25519
    decryption. Reusing a receive address still links whole actions that carry
    its diversifier.
  - Fully removing the bytes remains deferred until there is an independently
    reviewed diversified-key-agreement construction, cross-language vectors,
    seed-only recovery evidence, and physical-phone scan measurements.

- [x] Replace the separate XLM and USDC pools with one governed,
  asset-private Testnet pool.
  - Internal transfers publish neither the asset contract nor registry index.
    Deposits and withdrawals still publish the unavoidable asset, amount, and
    public endpoint.
  - Notes and outgoing records encrypt the immutable registry index, while the
    circuit binds the corresponding private full asset field into inputs and
    all three output commitments.
  - The contract has an append-only asset registry. Its administrator can add
    assets, set them to `Active` or `ExitOnly`, and hand control to a new
    administrator through a two-step transfer. Entries are never deleted or
    reindexed because historical notes must remain withdrawable.
  - XLM is index 0 and Testnet USDC is index 1 in the published deployment.
    Both are Active. Registry and deployment checkpoints are committed in the
    fixture evidence and public manifest.
  - Every action now appends three output packages. The additional lane permits
    an encrypted same-asset peer fee without revealing the asset of an internal
    transfer. This reduces depth-17 capacity to 43,046,721 actions, still far
    above a realistic Testnet workload.

- [x] Implement optional browser-to-browser relayed submission for private
  transfers and withdrawals.
  - Keep direct self-submission available. Never switch from relayed to direct
    submission without explicit user approval because that reveals the user's
    Stellar account as the transaction source.
  - Keep deposits unchanged: the public deposit source and amount remain
    visible and the source must authorize the asset movement into the pool.
  - Run discovery, quote selection, proof delivery, failover, simulation,
    signing, submission, and confirmation in the open-source browser client.
    Do not introduce a StellarKey backend, operated relay, indexer, custody, or
    server-side private state.
  - The sender broadcasts only a bounded quote request through at least two
    configurable public Nostr relay origins. Every valid reply is shown with its
    peer source account, same-asset fee, and expiry; the sender explicitly picks
    one. Only that selected peer receives the job through NIP-44 v2 encrypted
    messages under ephemeral Nostr identities.
    These public relay services are not StellarKey servers, but they do observe
    IP addresses, timing, and the public request. NIP-44 does not provide
    forward secrecy or post-quantum confidentiality.
  - The peer fee is a normal encrypted note in the action's third lane. It uses
    the same private asset as the payment, so an internal transfer does not add
    a public token call. Selecting another peer requires a new proof because
    the fee note is proof-bound to that peer's private address.
  - Keep "use a privacy relay" and "help relay payments" as separate settings.
    Helping is explicit opt-in and every job requires a manual modal approval.
  - Let the person explicitly probe current availability without publishing an
    asset, amount, destination, note, or proof input. Keep the result in memory,
    exclude the active account, rank unique peers by fee, and label it as a
    point-in-time observation rather than durable connectivity. Obtain fresh
    proof-bound quotes again for the actual payment.
  - Display each authenticated offer immediately, stop blocking after the first
    configured Nostr relay accepts a publish, and enable peer selection after
    700 ms without a new or lower-fee offer. Keep the original hard window only
    as the no-response deadline; do not add presence heartbeats or background
    polling.
  - Treat Nostr discovery requests as ephemeral: subscribe before publishing,
    report **Connected** only after at least one public relay WebSocket connects,
    show the real connecting/reconnecting/unavailable state, retry total startup
    outages and rejected subscriptions, and automatically reconnect and
    resubscribe after a dropped WebSocket, beginning with a one-second retry and
    bounded exponential backoff. Do not equate a connected socket with proof
    that a relay accepted every subscription. Own and cancel the connection
    deadline, socket, and retry timers when the helper session ends.
  - Keep helpers using the active Stellar account ineligible. If one answers,
    explain immediately that testing requires a different Testnet account while
    retaining the normal discovery deadline, both in the availability check and
    the live transfer or withdrawal review. An ineligible reply must never
    suppress a slower eligible peer.
  - Before approval, the helper validates the exact unsigned transaction,
    source, network, pool method, time bounds and fee caps; decrypts exactly one
    matching fee note; and simulates the exact transaction. Signed XDR is
    rechecked before the peer submits it.
  - Automated protocol, replay, transport, review, settings, transaction, and
    CSP tests pass. A controlled desktop pair over the configured public Nostr
    relays improved the one-peer path from 5,196 ms to a first visible offer in
    378-431 ms and a stable selection in 1,079-1,132 ms across three optimized
    runs. Real multi-peer discovery/submission p50/p95, peer churn, and iPhone
    WebKit measurements remain release evidence, not implemented guarantees.
  - A four-sample isolated diagnostic completed same-account exchanges in
    577-815 ms and returned different-account eligible offers in 639-672 ms.
    The result supports retaining Nostr and fixing eligibility/readiness UX
    instead of adding WebRTC signalling and ICE complexity; current discovery
    retains its hard deadline after an ineligible response. Sanitized evidence is in
    `protocol/private-balance/results/relay-eligibility-repro-2026-09-04.json`.

## Remaining validation

- [ ] Run physical-phone proving, scanning, and Nostr relay tests on iPhone
  WebKit and Android Chromium.
- [ ] Record real two-peer quote, signing, submission, confirmation, churn, and
  adversarial-job p50/p95 evidence before considering any non-development use.
- [ ] Complete a public multi-party phase-2 ceremony, reproducible build proof,
  and independent circuit/contract review before Mainnet.

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
