# Private Balance Roadmap

**Updated:** 2026-09-10

This file records prospective Private Balance work. Checked items are complete;
unchecked items are hypotheses that still require the stated validation. Nothing
in this file changes the behavior or guarantees documented in
[`private-balance.md`](private-balance.md).

## Implemented Testnet work

- [x] Remove the observed clear-diversifier **lane-role** fingerprint without
  replacing the reviewed X25519 HPKE construction.
  - Every one of the three envelopes in an action now carries the same random
    action diversifier. An observer therefore cannot identify recipient,
    change, historical fee, or dummy lanes from different clear diversifiers.
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
  - Every action now appends three output packages. The additional lane remains part of the immutable protocol;
    historical encrypted same-asset fee outputs remain readable. This reduces depth-17 capacity to 43,046,721 actions, still far
    above a realistic Testnet workload.

- [x] Remove peer relaying and helper earnings.
  - Keep only direct submission with explicit public-account disclosure.
  - Remove discovery, quotes, helper settings, approval, and Waku/Nostr dependencies.
  - Reject stale relay reviews; preserve encrypted legacy pending records, old
    fee-note decoding, and conservative canonical recovery without rebroadcast.
  - Retire obsolete consent atomically without releasing held inputs.

## Remaining validation

- [ ] Run physical-phone proving, scanning, and direct payment tests on iPhone
  WebKit and Android Chromium.
- [ ] Record real direct signing, submission, confirmation, recovery, and
  adversarial-RPC p50/p95 evidence before considering any non-development use.
- [ ] Complete a public multi-party phase-2 ceremony, reproducible build proof,
  and independent circuit/contract review before Mainnet.

## Evaluated and not planned

- [x] Reject disposable ephemeral gas accounts as a way to hide the submitting account.
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
  - Use explicitly reviewed direct submission with a public-account disclosure.
    Peer relaying has been removed; there is no peer fallback.
