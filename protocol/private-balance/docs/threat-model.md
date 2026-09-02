# Threat Model and Security Invariants (V1)

## 1. Assets and security objectives

- Conservation of value: private inputs plus a public deposit equal private outputs plus public
  withdrawal and relayer fee, using exact bounded integers.
- Double-spend and replay prevention: accepted real nullifiers are persistent and unique; a deposit
  retains one durable dummy nullifier so the same proof cannot be replayed.
- Spend authorization: only a valid note witness and the required spending/nullifier secrets can
  satisfy the proof.
- Transcript integrity: commitments, archive records, action count, frontier, Merkle root, and
  deployment checkpoint must reconcile before state becomes spendable.
- Confidentiality: internal-transfer amount, recipient, selected real lanes, change lane, and memo
  are not published as plaintext.
- Recovery: seed plus authenticated chain data recovers owned notes and sender-authenticated outgoing
  fingerprints/memos; an encrypted backup additionally preserves local application metadata.

## 2. Public information and correlation

The pool, pinned asset, action time, proof, anchor root, nullifiers, commitments, encrypted packages,
and transaction source are public. The development client self-submits transfers and withdrawals,
so that source is the user's public Stellar account and directly links the shielded action to it.
A fee-bump sponsor changes only the outer fee source; it does not hide the inner transaction source.
Deposits and withdrawals also reveal amount and public
endpoint. Pool size, timing, repeated public endpoints, address reuse outside the chain, voluntary
disclosure, or a small anonymity set can correlate activity. Fixed two-input/two-output actions hide
lane roles; they do not hide the public action kind or guarantee anonymity.

RPC providers and network observers see IP address, timing, selected deployment, ledger ranges,
simulations, restoration attempts, and submissions. Cross-checking independent providers reduces
the risk of accepting a fabricated ledger view but exposes access patterns to more operators.

## 3. Cryptographic and proving boundaries

The development Groth16 key is single-party material. Passing zkey/R1CS verification proves
consistency, not absence of retained setup toxic waste. A holder of that secret could forge proofs.
Real-value use requires a public ceremony, independent transcript verification, circuit and contract
review, reproducible artifacts, and deployment evidence bound to the same hashes.

Merkle parents are raw three-input Poseidon2 hashes. The pinned Poseidon2 length IV separates hashes
by arity only, including their separation from longer protocol hashes. Every other arity-three
protocol hash reserves rate slot zero for a distinct domain constant. Separation from a
raw Merkle parent additionally assumes Poseidon2 preimage and collision resistance, so an attacker
cannot engineer a reachable note commitment or parent equal to a fixed domain constant. Tree arity,
child ordering, depth, empty roots, the length IV, and the domain-slot convention are consensus
inputs and must not change independently.

Recipient and outgoing encryption is constructed outside the circuit. The proof binds note
commitments but does not prove that ciphertext is decryptable or addressed honestly. A malicious
sender can burn its own value into an undecryptable recipient output. Wallet-generated change is
self-checked, but the protocol cannot recover value intentionally encrypted incorrectly by another
sender.

## 4. Browser and local-state boundary

The design assumes the application origin, loaded code, browser cryptography, dependency graph,
device, and unlocked session are not compromised. A malicious extension, origin, artifact, browser,
or operating system can read keys or alter reviewed intent. Secret values stay inside explicit
intent-gated worker/vault boundaries, but JavaScript cannot guarantee physical memory erasure.

Sensitive notes, viewing state, outgoing metadata, checkpoints, and pending actions are encrypted
and deployment-bound in IndexedDB. The Merkle node cache contains public data but is authenticated
against the encrypted checkpoint and canonical chain. Corruption fails closed. No backward state
migration exists for this replacement protocol.

## 5. Availability and recovery boundary

The protocol has no StellarKey backend, operated relayer, or indexer. The contract accepts
third-party submission and proof-bound relayer fees, but the current client does not use a relay.
Availability depends on a usable
Stellar RPC, retained or restorable ledger state, sufficient public XLM for fees, browser storage,
and access to the proving artifacts. Independent RPC disagreement intentionally disables spending.

Archive records receive the configured maximum TTL when written but are not refreshed forever.
After eviction, seed-only recovery requires paid restore-footprint transactions. The wallet batches
only a freshly simulated contiguous prefix whose footprint, resource use, and fee remain within the
reviewed limits, then confirms and rereads it. A user who cannot pay restoration fees or reach an RPC
that can restore the entries may be temporarily unable to recover, even though confidentiality and
ownership are unchanged.

An interrupted or ambiguous submission keeps its inputs reserved until canonical chain evidence
establishes confirmation or safe absence. RPC `PENDING`, Horizon acceptance, and timeout are not
ledger confirmation.

## 6. Out of scope

The protocol does not hide network metadata, protect against endpoint-wide traffic analysis,
guarantee a minimum anonymity set, undo public deposits/withdrawals, recover a deliberately malformed
ciphertext, prove membership in a curated association set, recover a lost seed and lost encrypted
backup together, or make Testnet development
proving material safe for real funds.
