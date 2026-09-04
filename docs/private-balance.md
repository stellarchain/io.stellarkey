# StellarKey Private Balance Whitepaper

- **Protocol:** V1 replacement design
- **Implementation status:** Live Testnet development deployment, validated in StellarKey; not for real value
- **Document revision:** 2026-09-04

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
wallet database. Stellar RPC and the unified pool contract provide the
canonical public state and encrypted recovery transcript.

This is not a production or Mainnet claim. The authenticated deployment
catalogue advertises one live XLM/USDC development pool on Testnet, and
StellarKey explicitly enables its exact hash-pinned manifest. Its deployment
evidence validates the read-back configuration, append-only asset registry,
and initial tree state, and records deployment and post-registry checkpoint
hashes. Mainnet independently rejects
Private Payments. The proving material is still a single-party development
setup and must not be used for real value.

## 1. Design goals and non-goals

The implementation targets five properties:

1. **Value conservation.** A proof and the pool contract jointly enforce exact
   63-bit integer balance across private inputs, three private outputs, and
   public value. An optional peer fee is one of the private outputs.
2. **Private internal transfers.** A transfer does not publish its private
   amount, recipient, selected notes, or change role.
3. **Seed-based recovery.** Seed plus authenticated chain data can recover owned
   notes, spent status, outgoing recipient fingerprints, and memos without a
   StellarKey server.
4. **Fail-closed clients.** A wallet may spend only after its archive transcript,
   action count, incremental Merkle state, and contract head agree. Independent
   RPC corroboration is mandatory for initial or full-history synchronization
   and enabled by default for routine synchronization.
5. **Deployment and asset binding.** Every key hierarchy, address, artifact set,
   and local record is bound to a network, realm, and contract. Every note also
   binds one immutable on-chain registry index and its full asset field.

The design does not hide network metadata, the pool, action timing, the
transaction source, deposits, withdrawals, or the public action kind. Deposits
and withdrawals reveal their asset; an internal transfer does not publish it.
Direct mode self-submits from the user's public Stellar account. Optional relay
mode uses an explicitly opted-in peer's account instead. It
does not guarantee a minimum privacy set, protect a compromised browser, or
make an unaudited single-party proving setup safe for real value.

## 2. System architecture

One deployment is one privacy and state domain. Its constructor binds the
network ID, realm, initial asset administrator, guardian, circuit hash,
verification-key hash, Poseidon2 parameter hash, tree parameters, address
format, encryption suite, and deployment-binding hash. The contract maintains
one shared tree and an append-only asset registry. The administrator can add
assets or set them `Active`/`ExitOnly`; entries cannot be deleted or reindexed.

| Component | Implemented responsibility |
| --- | --- |
| Browser vault | Holds the Stellar seed and derives deployment-bound private keys only after explicit user intent. |
| Isolated worker | Scans ciphertext, maintains private note state, constructs witnesses, and proves actions. |
| Public Merkle cache | Stores authenticated, disposable commitment nodes and checkpoints; it contains no note plaintext. |
| Pool contract | Verifies proofs, enforces nullifier uniqueness, updates the shared tree and registry, moves boundary assets, and appends recovery records. |
| Primary Stellar RPC | Supplies ledger state, simulation, submission, confirmation, and archive restoration. |
| Different-origin witness RPC | Corroborates network identity, any retained deployment-checkpoint ledger, a current overlapping ledger hash, and the complete contract head during mandatory initial/full-history checks and, by default, routine checks. |
| Static application origin | Serves hash-pinned manifests, circuit Wasm, proving material, and verification data. |
| Public Nostr relays | Optionally carry bounded peer discovery and encrypted selected-peer messages. They are not operated by StellarKey and see connection metadata. |

Transfer and withdrawal need no user Soroban authorization: the proof authorizes
the state transition. Direct mode still signs an inner transaction from the
user's public Stellar account, so that source links the action to the account.
A fee-bump sponsor changes the outer fee source but leaves the inner source
public.

Optional privacy-relay mode discovers another opted-in browser wallet through
at least two configured public Nostr relay origins. The selected helper supplies
the Stellar transaction source, pays the public network fee, manually approves
the exact reviewed transaction, and earns a proof-bound encrypted note in the
same asset. No public relayer address or fee exists in the contract action or
archive. StellarKey runs no relay backend and never silently falls back from
relay to direct mode. Public Nostr operators still observe connection IPs,
timing, and discovery messages; the selected peer sees the action asset, fee,
proof, and exact transaction.

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
address-specific X25519 key pair. All three outputs in one action deliberately
carry one common clear action diversifier. For a transfer this is the recipient
address diversifier; change, peer-fee, and dummy lanes are constructed to match
it. Deposits and direct withdrawals choose a fresh random action diversifier;
a relayed withdrawal uses the peer fee-address diversifier. This prevents the
clear bytes from identifying output roles inside an action while retaining the
reviewed X25519 scan path. It does not hide the diversifier: reusing a receive
address can still link the whole actions that carry it. Spending authority stays
common to the account while issued receive addresses can rotate.

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
and aliased-key addresses fail before payment construction. The four-byte
checksum makes accidental corruption or a mistyped address overwhelmingly
likely to fail, but a 32-bit checksum is an error detector, not a guarantee or
an authentication code. Address reuse can still correlate the same recipient
off-chain.

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
The manifest directly pins the runtime constants and artifact hashes it exposes;
those hashes transitively bind the remaining circuit, contract, hash, and
encoding parameters in the authenticated artifacts.

## 5. Notes, commitments, and output packages

A 128-byte decrypted note plaintext contains the protocol version, a real/dummy
flag, value, diversifier, owner commitment, note randomness `rho`, an optional
memo of at most 32 bytes, the immutable four-byte asset-registry index, and 11
reserved zero bytes.

The note commitment binds the deployment context field, asset field, owner
commitment, value, and `rho`. The owner commitment already incorporates the
address diversifier. The memo is authenticated by encryption but is not a
separate circuit input or note-commitment field.

Every action publishes exactly three non-zero, pairwise-distinct commitments.
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
recipient/change/peer-fee/dummy output lane ordering before building commitments
and encryption envelopes.

## 6. Fixed-shape actions

Every Deposit, Transfer, and Withdraw has two input lanes and three output lanes.
Real inputs carry a note witness and a depth-17 membership path. Dummy inputs
carry a fresh secret that produces a non-zero public dummy nullifier, while
their unused membership data has one canonical private zero form. The public
slots do not disclose the private `inputReal` selectors.

| Action | Public information | Private statement |
| --- | --- | --- |
| Deposit | Kind, source, amount, pool, registry index, asset, three commitments, nullifiers, timing and fee payer | Both inputs are dummy; at least one output is real, and private outputs sum to the deposited value. |
| Transfer | Kind, pool, anchor root, three commitments, nullifiers, timing and transaction source | At least one owned input and one real output; asset, recipient, amount, peer fee, note count and output roles remain private. |
| Withdraw | Kind, public recipient and amount, pool, registry index, asset, anchor root, three commitments, nullifiers, timing and transaction source | At least one owned input; any remainder and optional encrypted peer fee occupy private outputs. |

For all actions the circuit enforces:

```text
sum(private inputs) + public deposit
  = sum(private outputs) + public withdrawal
```

Each individual value and one post-equality total receive a 63-bit range check.
The public action kind selects which public term is active.

## 7. Groth16 statement

The production-shaped development circuit has 15,114 constraints, 11 public
inputs, and 128 private inputs when compiled with Circom 2.2.3 and `--O2`. It
fits a `2^14` Groth16 domain.

The 11 public inputs, in verifier order, are:

1. deployment context field;
2. boundary asset field (zero for an internal transfer);
3. action kind;
4. anchor root;
5. public deposit or withdrawal value;
6. canonical action field;
7. and 8. two nullifiers; and
9. through 11. three output commitments.

The private witness includes the full action asset field and proves owner
authorization, real-input membership, correct real or dummy nullifier
derivation, distinct spent leaves, three output commitments, fixed action shape,
and conservation of value. Deposits and withdrawals prove that the private full
asset field equals the public registered boundary asset; transfers require the
public boundary field to be zero. The canonical action field hashes the network,
realm, pool, optional boundary asset/index, nonce, anchor root, complete outputs,
and public endpoints. It contains no relayer metadata. A non-zero circuit constraint gives this public
field a non-zero Groth16 input coefficient; a proof-mutation regression confirms
that changing it invalidates the proof. The contract derives the field itself.

Encryption is intentionally outside the circuit. A valid proof binds an output
commitment but does not prove that its ciphertext is decryptable or honestly
addressed. A malicious sender can therefore burn its own value into an
undecryptable output. Wallet-generated change is derived and self-checked before
submission, but the protocol cannot repair deliberately malformed ciphertext.

## 8. Ternary incremental Merkle tree

The commitment tree is ternary and depth-17. Its capacity is
`3^17 = 129,140,163` leaves. Because every action appends three commitments, the
public leaf count advances by exactly three per accepted action, for a maximum
of 43,046,721 complete actions.

A parent is the raw three-input Poseidon2 permutation over ordered left, middle,
and right children. All three rate elements are occupied, so the Merkle parent
has no string-domain field. The pinned Poseidon2 length IV separates hashes by
arity only. Every other arity-three protocol hash puts a distinct domain
constant in rate slot zero; separation from the raw parent additionally relies
on Poseidon2 preimage and collision resistance. Arity, ordering, depth, empty
roots, the length IV, and the domain-slot convention are consensus parameters.

The contract and browser use the same generated empty roots and canonical hash
implementation. The contract maintains a 34-node frontier—two slots for each of
17 levels—and recomputes the current root after the three appends.

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
methods, permissionless current-root refresh, guardian-authorized deposit
pause, and an administrator-authorized append-only asset registry.

Registry indices are permanent and contiguous. The asset administrator can add
a Stellar Asset Contract, switch it between `Active` and `ExitOnly`, and hand
authority to a new administrator through a propose/accept sequence. `ExitOnly`
blocks deposits but preserves transfers and withdrawals for existing notes.
The contract cannot delete, replace, or reindex an entry.

For an action, the contract atomically:

1. resolves and checks the public registered asset for a deposit/withdrawal, or
   requires no public asset for a transfer, and checks canonical encoding;
2. enforces the deposit pause or verifies a recent anchor root;
3. rejects already-spent durable nullifiers;
4. checks remaining tree capacity;
5. reconstructs the 11 public signals and verifies the Groth16 proof;
6. persists replay protection;
7. appends all three commitments and updates the root/frontier;
8. appends the authenticated archive record and transcript head;
9. moves the registered asset only for a deposit or withdrawal; and
10. emits the shielded-action event.

Any failure, including token movement or budget failure, rolls back the whole
invocation. Transfers and withdrawals persist both nullifiers. Deposits have no
real inputs and their public kind reveals that fact, so the contract stores only
the first dummy nullifier as an exact-proof replay key. Storing zero would allow
proof replay; storing the second adds no replay protection.

The guardian can pause all new deposits but cannot rewrite history or bypass
proof verification. The separate asset administrator controls admission and
status but cannot spend notes or alter historical registry identities.
Transfers and withdrawals remain governed by their normal proof, root, and
nullifier rules.

## 10. Recipient and sender recovery

The recipient envelope lets the incoming viewing key test and decrypt an owned
note. Its HPKE information and associated data directly bind the protocol
context (network, realm, and pool), commitment, action nonce, and output index;
the recomputed commitment binds the recovered registered asset and note fields. The outgoing
envelope's associated data additionally binds the deployment-binding hash and
asset field directly. Wrong-context and tampered ciphertext fail authentication.

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
kind, nonce, anchor and resulting roots, two nullifiers, three complete output
packages, and public value and endpoint. Deposit and withdrawal records include
the public registry index and asset; transfer records contain neither. No record
contains a relayer, fee recipient, or public peer-fee amount. Each record hash
commits to the prior transcript head, so deletion, reordering, insertion, or
mutation breaks recovery.

A seed-only recovery starts at the deployment genesis, reads records in order,
recomputes each record hash and action field, rebuilds the incremental tree,
trial-decrypts transfer envelopes against the corroborated registry, validates
the encrypted asset index and full commitment, derives owned nullifiers, and reconciles
the final action count, transcript head, frontier, and Merkle root. Only then is
the recovered balance spendable.

Persistent archive records can move into Stellar state archival after their TTL
expires. Restoration discovers only the contiguous unavailable prefix, derives
the exact ledger keys locally, freshly simulates candidate restore footprints,
and selects the largest safe contiguous batch accepted by fresh simulation and
whose simulated resource fee fits an 80%-of-configured-cap budget. Each bounded
restore operation is signed and confirmed against
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

The wallet uses a primary RPC selected by the user and a different-origin RPC
pinned by the deployment manifest. The shipped default pairs SDF's
`https://soroban-testnet.stellar.org` primary with Ankr's
`https://rpc.ankr.com/stellar_testnet_soroban` witness. The runtime reuses each
loaded contract specification to bound the public read burst, then verifies
different URL origins, network and ledger agreement; it cannot prove operator
independence if a user selects a custom primary under common control with the
witness. The browser-CORS and five-pass state-corroboration screening behind
this choice is preserved in
[`rpc-witness-validation.json`](../protocol/private-balance/results/rpc-witness-validation.json).
A second-provider witness check is mandatory when
there is no authenticated checkpoint, during seed recovery, and for an explicit
full-history check. Routine witness checks are enabled by default but can be
disabled in protocol settings. Seed recovery and a full history check always
require the witness even when routine checks are disabled. When the witness is
used, the wallet compares:

- both network passphrases;
- the manifest-pinned deployment checkpoint hash against each provider that
  still retains that ledger;
- an overlapping ledger hash at the latest sequence common to both providers;
- the complete pool configuration;
- action count and transcript head; and
- next leaf index, 34-node frontier, and current root.

The two contract heads may be retried a bounded number of times to allow normal
ledger skew. If the deployment checkpoint has aged out of either provider's
rolling retention window, the authenticated manifest remains the pinned trust
anchor; if it has aged out of both, the wallet still requires agreement on a
current overlapping ledger and the complete contract head. Any retained copy
must match the pinned hash. During a witnessed pass, an unavailable witness, mismatched
overlapping ledger hash, stale head, inconsistent tree count, or persistent head
disagreement disables spending and preserves the last authenticated snapshot.
It is never converted into a false zero balance. If the user disables routine
witnessing after a checkpoint exists, later routine passes trust the selected
primary RPC's head alone; this weakens protection against a fabricated ledger
view but does not weaken the mandatory initial, seed-recovery, or full-history
checks.

Using different-origin RPC providers reduces reliance on one fabricated ledger
view when their operators are actually independent, but exposes the wallet's
pool, timing, ledger ranges, and recovery access pattern to more endpoints. It
is an explicit authenticity/privacy tradeoff and an operator-diversity
assumption, not a network-identity-hiding mechanism.

RPC `PENDING`, Horizon acceptance, and timeouts are not ledger confirmation. The
UI and durable action journal distinguish preparation, signing/submission,
broadcast or ambiguous pending state, canonical confirmation, rejection or
failure, and runtime status-unknown. Ambiguous submissions keep their input
notes reserved until canonical evidence proves confirmation or safe absence.

## 13. Optional browser peer relay

For each private transfer or withdrawal, the review UI requires an explicit
choice between **Privacy relay** and **My account**. Relay mode first publishes a
short-lived quote request through at least two user-configurable public Nostr
relay origins. Sender and helper use ephemeral Nostr identities; messages after
discovery are NIP-44 v2 encrypted to the selected peer. Deposits are not
relayable because their public source must authorize the asset transfer.

The selected peer gives the sender a quote and a diversified private fee
address. The sender builds a new proof with the peer's same-asset fee as one of
the three shuffled encrypted outputs and the peer's Stellar account as the
transaction source. The peer validates the exact unsigned transaction, source,
network, pool method, time bounds, fee caps, absence of extra operations/auth,
and matched envelope diversifiers; decrypts exactly one real fee note matching
the quote; and simulates the exact transaction. Only then does it show a manual
approval modal. The peer signs, rechecks the signed XDR, submits through its RPC,
and reports the exact transaction hash.

StellarKey operates no relay or signaling server and stores no relay jobs.
Public Nostr infrastructure is still server infrastructure: its operators see
connections, IP addresses, timing, and the public discovery request. The
selected helper learns the asset, fee, proof, and transaction. NIP-44 does not
provide forward secrecy or post-quantum confidentiality. A helper can refuse or
delay service. Relay mode never silently falls back to direct submission;
changing peers requires a new proof because the encrypted fee note is bound to
the selected peer.

## 14. Local state and execution boundary

Owned notes, decrypted activity, outgoing metadata, canonical scan progress and
checkpoints, and pending actions are encrypted and authenticated in
deployment-bound IndexedDB records. A full encrypted wallet backup includes
these sensitive records but excludes the disposable public Merkle cache.

Private panels and the proving worker load only after explicit intent. Lock,
account/network change, leadership loss, manifest rejection, or a foreground
safety failure clears in-memory private state and terminates the worker. A
transient quiet-background failure retains the last verified snapshot and
worker for a later retry. RPC-authentication disagreement retains the last
authenticated snapshot in memory but disables actions and reports
status-unknown. One scoped browser tab holds the synchronization lease;
followers receive only redacted state and may take over after lease expiry.

The authenticated static catalogue supplies the deployment's checkpointed
asset list without an RPC request during wallet unlock or the first switch to a
Private tab. A live, two-provider registry read occurs only after the user
selects **Refresh asset registry**, after an administrator changes the registry,
or during an explicit runtime retry. This is how another device discovers a
newly admitted asset or status change. A failed explicit refresh retains the
last verified catalogue for the same wallet scope; it never adopts an
uncorroborated or conflicting registry view.

JavaScript cannot guarantee physical memory erasure. The design assumes the
served application, browser, operating system, device, dependencies, artifacts,
and reviewed transaction are not compromised. A malicious extension or origin
can defeat every browser-level privacy control.

## 15. Privacy boundary

| Hidden for an internal transfer | Public or observable |
| --- | --- |
| Private transfer amount and asset | Pool contract and action timing |
| Recipient private address | Public action kind |
| Which note lanes are real | Anchor root, two nullifiers and three commitments |
| Whether a real output is recipient, change, or peer fee | Three fixed-size encrypted output packages |
| Memo plaintext | Direct-mode user source or relay-mode peer source, and public Stellar fee |
| Spending and viewing secrets | Transaction timing and network metadata |

Deposits reveal their public source, asset, and amount. Withdrawals reveal their
public recipient, asset, and amount. Internal transfers publish neither the
asset contract nor registry index, and all registered assets share one action
set. Fixed two-input/three-output arity, randomized lanes, and one matched clear
diversifier per action obscure output roles, but they cannot create a large
privacy set when the pool is small or activity is uniquely timed. Reusing a
private receive address still links whole actions through the clear diversifier.

The RPC operator and a network observer can see the user's IP address, request
timing, selected pool, queried ledger ranges, simulations, restoration attempts,
and submitted transactions. Optional public Nostr relays additionally see peer
discovery metadata, and the selected helper sees the asset, fee, proof, and job.
Timing and pool activity remain public. Pool size,
deposits, withdrawals, repeated public endpoints, private-address reuse,
voluntary disclosure, or browser compromise may correlate otherwise hidden
transfers.

Private Balance must not be described as hiding all identities, defeating all
tracing, or guaranteeing privacy.

The separate Horizon stealth subsystem is complementary, not an alternative
name for the pool. It provides reusable-recipient unlinkability by deriving a
fresh classic destination without proving, but the asset, amount, sender,
timing, account creation, and later sweep can remain linkable. The two systems
retain separate keys, recovery, sync, and user-facing guarantees.

## 16. Measured implementation

The protocol-review harness compiles each circuit variant sequentially and
records machine-readable results. The accepted replacement measures:

| Metric | Implemented result |
| --- | ---: |
| Constraints | 15,114, down from the 23,437 baseline (35.51%) |
| Public / private inputs | 11 / 128 |
| R1CS | 7,107,072 bytes |
| Witness Wasm | 154,930 bytes |
| Development proving key | 9,264,916 bytes |
| Point-compressed proving-key transport | 6,327,606 bytes |
| Compressed HTTP wire size recorded in manifest | 2,498,167 bytes |
| Canonical BN254 proof | 256 bytes |
| Tree | Ternary depth 17, 129,140,163 leaves |
| Transfer verification | 29,287,953 Soroban test-budget instructions |
| Pool Wasm | 71,277 bytes raw; 61,067 bytes after `stellar contract optimize` |

In the recorded three-trial Node.js run on an Apple M3 Max, native X25519 p50
fell from 371.708 microseconds with JWK import to 84.792 microseconds with
PKCS#8 import, a 77.19% median improvement. The complete RFC 9180-compatible
scan path measured 4.57x faster than the prior path. The configured
8-envelope cap measured a 2.323x paired median against adjacent sequential
controls over nine rotated trials. The cap is fixed conservatively from
repeated exploratory runs; the locally fastest candidate is diagnostic, not a
production selector. These are local microbenchmarks, not physical-phone
latency evidence.

The pool size comparison is also like-for-like: baseline revision `69335bd`
and the replacement were built with Stellar CLI 27.0.0, Rust 1.97.1, locked
dependencies, and identical optimization commands. The current governed pool
is 71,277 bytes raw and 61,067 bytes after `stellar contract optimize`, 23.77%
and 23.90% below that baseline respectively. The optimized size was remeasured
locally for this revision; the deployed fixture intentionally uses the exact
unoptimized 71,277-byte manifest-pinned Wasm.

A standalone additional depth-17 association-set membership path compiled to
4,573 constraints. It would raise the current action to at least 19,687
constraints (+30.26%) before any policy logic. No association-set feature is
included without a concrete governance model and end-to-end device and Soroban
measurements. Cross-origin isolation is likewise deferred until a complete
subresource audit and physical-device benchmark exist.

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

## 17. Deployment and trust status

The replacement remains Protocol V1 and deliberately replaces the old Testnet
design in place. There is no backward-compatible state migration. Previous
Testnet pools bind different circuit, tree, contract, and verification-key
hashes; their manifests and fixture evidence were retired rather than relabeled.
Old balances and addresses are not presented as part of the replacement.

StellarKey's authenticated catalogue now publishes one live Testnet pool,
`CBQI…DRUI`, with XLM at registry index 0 and USDC at index 1. Both entries were
read back as `Active`. The checked-in deployment evidence records the pool
identity, locally selected Wasm hash, deployment checkpoint at ledger 4,491,845,
and post-registry checkpoint at ledger 4,491,848. It validates the immutable
configuration, registry contents, deposit-open state, and empty initial
tree/archive head. It does not contain a deployment
transaction hash or independently bind the on-chain executable to the recorded
local Wasm hash. Contract deployment, both registry additions, and their
readbacks succeeded against the public Testnet RPC.

The official Testnet runner passed at source commit `f7c0e78` against manifest
`222e2028be15d94311751d38aaebadb03c9ef53cc76a19e72cdcf0b3fd01be9f`.
It passed ten desktop Chromium tests, including the Home relay-participation
opt-in and the complete two-wallet
deposit, consolidation, private send, ambiguous-submission recovery,
withdrawal, lock/unlock, encrypted-backup restore, local-data removal, and
seed-only recovery lifecycle. It then passed four production browser smoke
tests: desktop Firefox, desktop WebKit, iPhone WebKit emulation, and iPad WebKit
emulation. The sanitized evidence is recorded in
[`mvp-e2e.json`](../protocol/private-balance/results/mvp-e2e.json). iPhone and
iPad emulation is not physical-device evidence, and real Android Chrome remains
untested. No claim in this document treats fixture readback or browser emulation
as an audit, ceremony, physical-device result, or real-value approval. A Stellar
Testnet reset deletes this pool and requires a fresh redeploy, new evidence, and
republished manifest hashes.

The current proving key was created by a single-party setup. It passes
`snarkjs zkey verify` against the repository's
pinned Powers-of-Tau transcript. Those exact SHA-256-selected bytes are PSE's
degree-14 Perpetual Powers of Tau. The checked-in gate
does not run or record a separate `snarkjs powersoftau verify`, so StellarKey
does not claim to have independently validated the transcript's complete
contribution or final-beacon chain. The zkey consistency check does not make
these development artifacts safe for real value. Anyone retaining the phase-2
secret could forge proofs.

The live development pool is deliberately Testnet-only. Real-value or Mainnet
promotion additionally requires deployment transaction evidence, a public
multi-party phase-2 ceremony, independent transcript verification, reproducible
builds, physical-device proving measurements, Soroban resource measurements,
external circuit and contract review, and end-to-end recovery drills.

## 18. Normative sources and operational guidance

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
