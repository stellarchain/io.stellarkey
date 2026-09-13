# Threat Model and Security Invariants (V2)

## 1. Assets and security objectives

- Conservation of value: private inputs plus a public deposit equal three private outputs plus a
  public withdrawal, using exact bounded integers. The application constructs recipient,
  change and dummy outputs, without private peer fees.
- Double-spend and replay prevention: accepted real nullifiers are persistent and unique; a deposit
  retains one durable dummy nullifier so the same proof cannot be replayed.
- Spend authorization: only a valid note witness and the required spending/nullifier secrets can
  satisfy the proof.
- Transcript integrity: commitments, archive records, action count, frontier, and Merkle root must
  reconcile before state becomes spendable. Every provider-reported retained copy of the deployment
  checkpoint must also match the authenticated manifest; after it ages out, current common-ledger
  and complete-head agreement remain mandatory.
- Confidentiality: internal-transfer amount, recipient, selected real lanes, change lane, and memo
  are not published as plaintext.
- Recovery: seed plus authenticated chain data recovers owned notes and sender-authenticated outgoing
  fingerprints/memos; an encrypted backup additionally preserves local application metadata.

## 2. Public information and correlation

The pool, action time, proof, anchor root, nullifiers, three commitments, encrypted packages, and
transaction source are public. Deposits and withdrawals additionally reveal the registry asset,
amount, and public endpoint. Internal transfers publish no asset contract or registry index; the
asset remains private only if ciphertext and behavioral correlation do not reveal it. Fixed
two-input/three-output actions and matched envelope diversifiers hide lane roles; they do not hide
the public action kind or guarantee anonymity. Reusing one private receive address still links
whole actions through its clear four-byte diversifier.

Direct submission uses the user's Stellar account as the transaction source and links the action
to it. A fee-bump sponsor changes only the outer fee source. Direct submission is the only
supported application path. Unsupported pending records fail validation without
signing, rebroadcast, hash lookup or a compatibility recovery path.

RPC operators see the connecting IP address, timing, selected deployment, ledger ranges,
simulations, restoration attempts, and submissions. With authenticated HTTPS and uncompromised
endpoints, passive network observers see connection endpoints, timing, sizes, and volume, but
cannot directly read encrypted RPC contents. Traffic analysis and public-ledger correlation
remain possible. Cross-checking different-origin providers
reduces the risk of accepting a fabricated ledger view when their operators are actually
independent, but exposes access patterns to more endpoints. The shipped SDF-primary/Ankr-witness
pair is operator-diverse; the runtime cannot prove the same for a custom primary.

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

Recipient HPKE base mode does not authenticate the sender's identity. Memo authenticity is not
proof of its author's identity or the truth of its contents. Recipient-key compromise can expose
historical ciphertexts; diversified-address rotation does not provide forward secrecy against
compromise of the seed or incoming viewing key.

Note conservation assumes correct token-transfer behavior at the deposit/withdrawal boundary;
the pool does not compare custody balances before and after a token call. Underlying token
authorization revocation can block movement, and permitted clawback can remove pooled backing
without canceling private notes. The pool registry administrator and underlying token
administrator are separate roles. No automatic insolvency resolution is implemented.

## 4. Browser and local-state boundary

The design assumes the application origin, loaded code, browser cryptography, dependency graph,
device, and unlocked session are not compromised. A malicious extension, origin, artifact, browser,
or operating system can read keys or alter reviewed intent. Secret values stay inside explicit
intent-gated worker/vault boundaries, but JavaScript cannot guarantee physical memory erasure.

Sensitive notes, viewing state, outgoing metadata, checkpoints, and pending actions are encrypted
and deployment-bound in IndexedDB. The Merkle node cache contains public data but is authenticated
against the encrypted checkpoint and canonical chain. Corruption fails closed.
StellarKey 1.0.0 accepts only the current deployment-bound record formats;
unsupported encrypted state is rejected without mutation.

## 5. Availability and recovery boundary

The protocol has no StellarKey backend, operated relayer, or indexer. Peer relaying
and helper earnings are removed. Availability depends on a usable Stellar RPC,
retained or restorable ledger state, sufficient public XLM for direct submission,
browser storage, and access to the proving artifacts. Different-origin RPC disagreement intentionally disables spending.

The depth-64 commitment tree is finite, but full-input exits append no leaves and
skip its capacity guard. Normal actions still require three free slots. A partial
withdrawal that creates change can therefore fail at saturation, whereas fully
consuming one or two owned notes can exit subject to proof, root, token, fee and
ledger availability. Multiple independent exit steps are not an atomic aggregate.
The u128 archive counter is finite and cold recovery/storage costs still grow.

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
guarantee a minimum anonymity set, undo public deposits/withdrawals, make a reused clear
diversifier unlinkable, recover a deliberately malformed
ciphertext, prove membership in a curated association set, recover a lost seed and lost encrypted
backup together, or make Testnet development
proving material safe for real funds.
