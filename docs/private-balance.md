# StellarKey Private Balance Whitepaper

- **Protocol:** V1 replacement design
- **Implementation status:** Testnet-only development candidate
- **Document revision:** 2026-09-02

## Abstract

Private Balance is an opt-in shielded note pool for Stellar. It lets a software
wallet deposit a supported public asset, transfer value between private notes,
and withdraw back to a public Stellar address. Groth16 proofs authorize internal
transfers without publishing the spent notes, private transfer amount, recipient,
change lane, or memo. Deposits and withdrawals retain their public endpoints and
amounts.

The implemented system is deliberately local-first. Key derivation, archive
scanning, note selection, witness construction, proof generation, transaction
review, and signing run in the browser. There is no application backend,
StellarKey-operated relayer, indexer, hosted viewing-key service, or third-party
wallet database. Stellar RPC and the asset-pinned pool contract provide the
canonical public state and encrypted recovery transcript.

This is not a production or Mainnet claim.
The authenticated deployment catalogue is empty. Development deployment use is
disabled, and Mainnet independently rejects Private Payments. The checked-in
artifacts make the replacement protocol reproducible, but no active pool is
currently advertised.

## 1. Design goals and non-goals

The implementation targets five properties:

1. **Value conservation.** A proof and the pool contract jointly enforce exact
   63-bit integer balance across private inputs, private outputs, public value,
   and any relayer fee.
2. **Private internal transfers.** A transfer does not publish its private
   amount, recipient, selected notes, or change role.
3. **Seed-based recovery.** Seed plus authenticated chain data can recover owned
   notes, spent status, outgoing recipient fingerprints, and memos without a
   StellarKey server.
4. **Fail-closed clients.** A wallet may spend only after its archive transcript,
   action count, incremental Merkle state, contract head, and independent RPC
   views agree.
5. **Deployment isolation.** Every pool, key hierarchy, address, artifact set,
   and local record is bound to a network, realm, contract, and single asset.

The design does not hide network metadata, the pool or asset, action timing, the
fee-paying Stellar account, deposits, withdrawals, or the public action kind. It
does not guarantee a minimum privacy set, protect a compromised browser, or
make an unaudited single-party proving setup safe for real value.

## 2. System architecture

Each immutable asset-pinned pool is a separate privacy and state domain.
There is no shared arbitrary-asset tree: a deployment constructor pins exactly
one Stellar Asset Contract together with the network ID, realm, guardian,
circuit hash, verification-key hash, Poseidon2 parameter hash, tree parameters,
address format, encryption suite, and deployment-binding hash.

| Component | Implemented responsibility |
| --- | --- |
| Browser vault | Holds the Stellar seed and derives deployment-bound private keys only after explicit user intent. |
| Isolated worker | Scans ciphertext, maintains private note state, constructs witnesses, and proves actions. |
| Public Merkle cache | Stores authenticated, disposable commitment nodes and checkpoints; it contains no note plaintext. |
| Pool contract | Verifies proofs, enforces nullifier uniqueness, updates the tree, moves the pinned asset, and appends recovery records. |
| Primary Stellar RPC | Supplies ledger state, simulation, submission, confirmation, and archive restoration. |
| Independent witness RPC | Corroborates network identity, ledger hashes, the deployment checkpoint, and the complete contract head. |
| Static application origin | Serves hash-pinned manifests, circuit Wasm, proving material, and verification data. |

The protocol includes a relayer address and fee in transfer and withdrawal
actions, but it does not require a hosted relayer service. The submitting wallet
binds the selected relayer and may choose a zero relayer fee. The transaction
independently has a public network-fee payer. Any non-zero relayer fee is public
and is paid by the pool only when the proof authorizes it.

## 3. Deployment-bound keys and private addresses

A supported software account derives a 64-byte privacy session root from the
raw Stellar seed plus the protocol version, network ID, realm ID, pool contract
ID, and Stellar account public key. Domain-separated expansion produces:

- `ask`, the private spending authorization field;
- `nk`, the nullifier derivation field;
- an incoming X25519 viewing key;
- an outgoing viewing key;
- a base owner commitment; and
- a separate deployment-bound local-storage key.

A four-byte diversifier derives an address-specific owner commitment and an
address-specific X25519 key pair. Fresh self-output diversifiers prevent change
from reusing the displayed receive address. Spending authority stays common to
the account while issued receive addresses can rotate.

The current Base58 address format is intentionally shorter than the retired
format. `tskpay_` addresses are exactly 128 ASCII characters on Testnet and
`skpay_` addresses are exactly 127 on Mainnet. The decoded form contains a
one-byte format marker, an 84-byte payload, and a four-byte checksum. The
payload contains:

- a 16-byte deployment tag;
- a four-byte diversifier;
- a 32-byte owner commitment; and
- a 32-byte recipient X25519 public key.

The prefix is included in the checksum, and the deployment tag is derived from
the immutable deployment binding. Wrong-network, wrong-deployment, malformed,
aliased-key, and mistyped addresses therefore fail before payment construction.
Address reuse can still correlate the same recipient off-chain.

## 4. Cryptographic suite

The implemented V1 suite is:

| Purpose | Construction |
| --- | --- |
| Proof system | Groth16 over the BN254 scalar field |
| Circuit hash | Poseidon2 over BN254 `Fr`, width 4, rate 3, capacity 1, `x^5`, 8 full rounds and 56 partial rounds |
| Recipient encryption | RFC 9180 base mode: DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, AES-128-GCM |
| Outgoing recovery | Outgoing-viewing-key authenticated encryption with deployment- and output-bound associated data |
| Archive transcript | SHA-256 hash chain rooted in a deployment-specific genesis value |
| Address body | Base58 with a prefix-bound SHA-256 checksum and deployment tag |

All field elements are canonical 32-byte big-endian values below `Fr`. Protocol
integers use fixed-width encodings and private values are bounded to 63 bits.
The manifest pins every consensus parameter and artifact hash.

## 5. Notes, commitments, and output packages

A 128-byte decrypted note plaintext contains the protocol version, a real/dummy
flag, value, diversifier, owner commitment, note randomness `rho`, an optional
memo of at most 32 bytes, and reserved zero bytes.

The note commitment binds the deployment context field, asset field, owner
commitment, value, and `rho`. The owner commitment already incorporates the
address diversifier. The memo is authenticated by encryption but is not a
separate circuit input or note-commitment field.

Every action publishes exactly two non-zero, distinct commitments.
Zero-value dummy notes represent unused outputs; they are never absent or zero
commitments. Each receives fresh randomness, owner material, diversifier,
recipient ciphertext, outgoing ciphertext, and a normal-looking commitment.
The circuit derives `outputReal` from `value != 0`; the wallet does not provide
output role as independent witness data.

Each 370-byte output package consists of:

- a 32-byte commitment;
- a 181-byte recipient envelope; and
- a 157-byte outgoing envelope.

The wallet independently randomizes real/dummy input lane ordering and
recipient/change or real/dummy output lane ordering before building commitments
and encryption envelopes.

## 6. Fixed-shape actions

Every Deposit, Transfer, and Withdraw has two input lanes and two output lanes.
Real inputs carry a note witness and a depth-17 membership path. Dummy inputs
carry a fresh secret that produces a non-zero public dummy nullifier, while
their unused membership data has one canonical private zero form. The public
slots do not disclose the private `inputReal` selectors.

| Action | Public information | Private statement |
| --- | --- | --- |
| Deposit | Kind, source, amount, pool, asset, commitments, nullifiers, timing and fee payer | Both inputs are dummy; at least one output is real, and private outputs sum to the deposited value. |
| Transfer | Kind, pool, asset, anchor root, relayer and fee, commitments, nullifiers, timing and fee payer | At least one owned input and one real output; recipient, amount, note count and change role remain private. |
| Withdraw | Kind, public recipient and amount, pool, asset, anchor root, relayer and fee, commitments, nullifiers, timing and fee payer | At least one owned input; any remainder becomes private change. |

For all actions the circuit enforces:

```text
sum(private inputs) + public deposit
  = sum(private outputs) + public withdrawal + relayer fee
```

Each individual value and one post-equality total receive a 63-bit range check.
The public action kind selects which public term is active.

## 7. Groth16 statement

The production-shaped development circuit has 14,876 constraints, 13 public
inputs, and 124 private inputs when compiled with Circom 2.2.3 and `--O2`. It
fits a `2^14` Groth16 domain.

The 13 public inputs, in verifier order, are:

1. deployment context field;
2. pinned asset field;
3. action kind;
4. anchor root;
5. public deposit or withdrawal value;
6. relayer fee;
7. relayer identity field;
8. action field;
9. action binding;
10. and 11. two nullifiers; and
12. and 13. two output commitments.

The private witness proves owner authorization, real-input membership, correct
real or dummy nullifier derivation, distinct spent leaves, output commitments,
fixed action shape, and conservation of value. Network, realm, pool, asset,
action nonce, public endpoints, relayer, and output context are folded into the
public context/action bindings checked again by the contract.

Encryption is intentionally outside the circuit. A valid proof binds an output
commitment but does not prove that its ciphertext is decryptable or honestly
addressed. A malicious sender can therefore burn its own value into an
undecryptable output. Wallet-generated change is derived and self-checked before
submission, but the protocol cannot repair deliberately malformed ciphertext.

## 8. Ternary incremental Merkle tree

The commitment tree is ternary and depth-17. Its capacity is
`3^17 = 129,140,163` leaves. Because every action appends two commitments, the
public leaf count advances by exactly two per accepted action.

A parent is the raw three-input Poseidon2 permutation over ordered left, middle,
and right children. All three rate elements are occupied, so the Merkle parent
has no string-domain field. Separation from longer protocol hashes depends on
the pinned Poseidon2 input-length IV. Arity, ordering, depth, empty roots, and
the length IV are consensus parameters.

The contract and browser use the same generated empty roots and canonical hash
implementation. The contract maintains a 34-node frontier—two slots for each of
17 levels—and recomputes the current root after the two appends.

The browser persists an authenticated incremental Merkle node store. Its
checkpoint binds the deployment, archive cursor, transcript head, commitment
count, root, and complete frontier. Verified batches atomically append nodes;
non-contiguous or corrupted cache state fails closed. An ordinary spend reads
the selected logarithmic paths instead of reconstructing every historical
commitment. The node cache is public, disposable, and excluded from backups.

Non-deposit actions may spend against a known recent root. The root window is
1,440 ledgers. A spend against the current root refreshes it transactionally,
and `touch_root` permissionlessly keeps the current canonical root available
without moving value.

## 9. Pool contract state transition

The pool constructor rejects any network or artifact configuration that differs
from the compiled constants and recomputed deployment binding. The implemented
contract exposes Deposit, Transfer, Withdraw, read-only configuration/head
methods, permissionless current-root refresh, and guardian-authorized deposit
pause. It has no arbitrary-asset entrypoint.

For an action, the contract atomically:

1. checks the pinned asset and canonical action encoding;
2. enforces the deposit pause or verifies a recent anchor root;
3. rejects already-spent durable nullifiers;
4. checks remaining tree capacity;
5. reconstructs the 13 public signals and verifies the Groth16 proof;
6. persists replay protection;
7. appends both commitments and updates the root/frontier;
8. appends the authenticated archive record and transcript head;
9. moves the pinned asset for a deposit, withdrawal, or relayer fee; and
10. emits the shielded-action event.

Any failure, including token movement or budget failure, rolls back the whole
invocation. Transfers and withdrawals persist both nullifiers. Deposits have no
real inputs and their public kind reveals that fact, so the contract stores only
the first dummy nullifier as an exact-proof replay key. Storing zero would allow
proof replay; storing the second adds no replay protection.

The guardian can pause new deposits but cannot rewrite history or bypass proof
verification. Transfers and withdrawals remain governed by their normal proof,
root, and nullifier rules.

## 10. Recipient and sender recovery

The recipient envelope lets the incoming viewing key test and decrypt an owned
note. Its associated data binds the deployment, context, asset, commitment,
action nonce, and output index. Wrong-context and tampered ciphertext fail
authentication.

The outgoing envelope is authenticated by the outgoing viewing key. During a
seed-only scan it lets the sender recover an external recipient fingerprint and
memo, even when prior local note history is absent. Seed-recovered activity
retains the fingerprint, not the full reusable address. Ordinary sends
separately retain the full private address in the encrypted recent-recipient
list for convenience. Change and dummy outputs use the same envelope sizes and
are not presented as external payments.

Native WebCrypto imports raw X25519 private material through PKCS#8 and avoids a
redundant JavaScript base-point multiplication. The portable implementation
remains as a fallback, and both paths must derive byte-identical shared secrets.
Locally owned shared-secret, plaintext, ephemeral-key, and derived-key buffers
are cleared in `finally` paths where the runtime permits.

## 11. Canonical archive and restoration

Every accepted action writes one immutable persistent archive record keyed by
its action index. It includes the action/ledger indices, starting leaf index,
kind, asset, nonce, anchor and resulting roots, two nullifiers, two complete
output packages, public value and endpoint, and relayer data. Each record hash
commits to the prior transcript head, so deletion, reordering, insertion, or
mutation breaks recovery.

A seed-only recovery starts at the deployment genesis, reads records in order,
recomputes each record hash and action field, rebuilds the incremental tree,
opens incoming and outgoing envelopes, derives owned nullifiers, and reconciles
the final action count, transcript head, frontier, and Merkle root. Only then is
the recovered balance spendable.

Persistent archive records can move into Stellar state archival after their TTL
expires. Restoration discovers only the contiguous unavailable prefix, derives
the exact ledger keys locally, freshly simulates candidate restore footprints,
and selects the largest safe contiguous batch within the configured fee and 80%
resource margins. Each bounded restore operation is signed and confirmed against
its exact transaction hash. A confirmed batch is durable on-chain and advances
only in-memory restoration progress. After the selected range finishes, the
canonical sync rereads the records, validates the transcript and tree, and
persists an encrypted scan checkpoint. An interruption before that sync commits
causes a rescan; cancellation or ambiguous status never reports a batch as
confirmed.

Restoration therefore reduces round trips and signatures without trusting an
RPC-expanded footprint. It is a liveness and fee dependency: confidentiality
and ownership remain, but a user who cannot fund restoration may be unable to
recover old history at that time.

## 12. RPC authenticity and client finality

The wallet uses a primary RPC selected by the user and an independent RPC pinned
by the deployment manifest. Before accepting a spendable head it compares:

- both network passphrases;
- the manifest-pinned deployment checkpoint hash;
- an overlapping ledger hash at the latest sequence common to both providers;
- the complete pool configuration;
- action count and transcript head; and
- next leaf index, 34-node frontier, and current root.

The two contract heads may be retried a bounded number of times to allow normal
ledger skew. An unavailable witness, mismatched overlapping ledger hash, stale
head, inconsistent tree count, or persistent head disagreement disables
spending and preserves the last authenticated snapshot. It is never converted
into a false zero balance.

Using independent RPC providers reduces reliance on one fabricated ledger view,
but exposes the wallet's pool, timing, ledger ranges, and recovery access pattern
to more operators. It is an explicit authenticity/privacy tradeoff, not a
network-identity-hiding mechanism.

RPC `PENDING`, Horizon acceptance, and timeouts are not ledger confirmation. The
wallet keeps preparing, signing, submitting, pending, confirmed, rejected,
failed, and status-unknown states distinct. Ambiguous submissions keep their
input notes reserved until canonical evidence proves confirmation or safe
absence.

## 13. Local state and execution boundary

Owned notes, decrypted activity, outgoing metadata, recovery progress,
checkpoints, and pending actions are encrypted and authenticated in
deployment-bound IndexedDB records. A full encrypted wallet backup includes
these sensitive records but excludes the disposable public Merkle cache.

Private panels and the proving worker load only after explicit intent. Lock,
account/network change, leadership loss, manifest rejection, or runtime failure
clears in-memory private state and terminates the worker. One scoped browser tab
holds the synchronization lease; followers receive only redacted state and may
take over after lease expiry.

JavaScript cannot guarantee physical memory erasure. The design assumes the
served application, browser, operating system, device, dependencies, artifacts,
and reviewed transaction are not compromised. A malicious extension or origin
can defeat every browser-level privacy control.

## 14. Privacy boundary

| Hidden for an internal transfer | Public or observable |
| --- | --- |
| Private transfer amount | Pool contract and pinned asset |
| Recipient private address | Public action kind |
| Which note lanes are real | Anchor root, two nullifiers and two commitments |
| Whether a real output is recipient or change | Fixed-size encrypted output packages |
| Memo plaintext | Relayer address/fee and fee-paying Stellar account |
| Spending and viewing secrets | Transaction timing and network metadata |

Deposits reveal their public source and amount. Withdrawals reveal their public
recipient and amount. The asset is public for every action, so the privacy set is
per asset-pinned pool rather than cross-asset. Fixed two-by-two arity and
randomized lanes obscure input/output roles but cannot create a large privacy
set when the pool is small or activity is uniquely timed.

The RPC operator and a network observer can see the user's IP address, request
timing, selected pool, queried ledger ranges, simulations, restoration attempts,
and submitted transactions. Timing and pool activity remain public. Pool size,
deposits, withdrawals, repeated public endpoints, private-address reuse,
voluntary disclosure, or browser compromise may correlate otherwise hidden
transfers.

Private Balance must not be described as hiding all identities, defeating all
tracing, or guaranteeing privacy.

## 15. Measured implementation

The protocol-review harness compiles each circuit variant sequentially and
records machine-readable results. The accepted replacement measures:

| Metric | Implemented result |
| --- | ---: |
| Constraints | 14,876, down from 23,437 (36.53%) |
| Public / private inputs | 13 / 124 |
| R1CS | 6,981,468 bytes |
| Witness Wasm | 154,609 bytes |
| Development proving key | 9,121,500 bytes |
| Point-compressed proving-key transport | 6,227,870 bytes |
| Compressed HTTP wire size recorded in manifest | 2,464,278 bytes |
| Canonical BN254 proof | 256 bytes |
| Tree | Ternary depth 17, 129,140,163 leaves |

In the recorded three-trial Node.js run on an Apple M3 Max, native X25519 p50
fell from 435.583 microseconds with JWK plus redundant public derivation to
85.750 microseconds with PKCS#8, an 80.31% median improvement. This is a local
microbenchmark, not physical-phone latency evidence.

The earlier BN254/BLS12-381 comparison is also desktop smoke evidence. BLS12-381
is not selected: physical-phone proving and Soroban verifier resource evidence
remain pending, and a production curve change would require reviewed hash
parameters, a new verifier, new artifacts, a fresh ceremony, and new pools.
Recursive proofs are not implemented because measurements have not demonstrated
a batching bottleneck that justifies the added protocol and toolchain surface.

Sapling-style variable-base diversification is likewise deferred. It measured
as a possible scan optimization, but replacing the current RFC 9180 KEM without
a complete reviewed variable-base X25519/cofactor construction would trade
performance for protocol risk.

## 16. Deployment and trust status

The replacement remains Protocol V1 and deliberately replaces the old Testnet
design in place. There is no backward-compatible state migration. Previous
Testnet pools bind different circuit, tree, contract, and verification-key
hashes; their manifests and fixture evidence were retired rather than relabeled.
Old balances and addresses are not presented as part of the replacement.

The current proving key was created by a single-party setup. It passes
`snarkjs zkey verify` against the repository's pinned Powers-of-Tau transcript.
That verifies consistency; it does not make these artifacts safe for real value.
Anyone retaining the phase-2 secret could forge proofs.

The replacement is deliberately unavailable until fresh asset-pinned Testnet
pools are deployed and their transactions, checkpoints, contract configuration,
artifacts, and recovery evidence all bind to the same hashes. Real-value or
Mainnet promotion additionally requires a public multi-party phase-2 ceremony,
independent transcript verification, reproducible builds, physical-device
proving measurements, Soroban resource measurements, external circuit and
contract review, and end-to-end recovery drills.

## 17. Normative sources and operational guidance

This whitepaper explains the implemented design. Consensus and byte-level rules
remain normative in the repository sources:

- [Protocol V1 specification](../protocol/private-balance/docs/protocol-v1.md)
- [Threat model](../protocol/private-balance/docs/threat-model.md)
- [Canonical encoding](../protocol/private-balance/docs/encoding.md)
- [Protocol review and measurements](private-balance-protocol-review-2026-09-02.md)
- [Recovery guide](private-balance-recovery.md)
- [Safe support guide](private-balance-support.md)
- [Incident-response playbook](private-balance-incident-response.md)

If this whitepaper conflicts with the generated manifest, conformance vectors,
circuit, or contract compiled for a deployment, the deployment-bound code and
authenticated artifacts govern that deployment and the documentation must be
corrected.
