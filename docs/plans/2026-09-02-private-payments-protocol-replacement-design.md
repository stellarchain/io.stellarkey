# Private Payments protocol replacement design

## Decision and compatibility boundary

Replace the current Testnet Private Payments protocol in place. There is no second protocol,
compatibility decoder, migration path, or dual deployment. The manifest continues to declare
`protocolVersion: 1`, but every circuit, proving artifact, contract Wasm, deployment binding,
address, ciphertext, archive record, cache namespace, and test vector is regenerated together.
The application rejects the retired deployment and deletes its incompatible local private state
after explicit activation of the replacement. Public wallet and merchant data remain untouched.

The replacement keeps Groth16 and the existing two-input/two-output action width. It improves
privacy by making all four lanes look occupied, isolating assets in separate pools, randomizing
lane order, and adding sender recovery. It improves performance by persisting an incremental
Merkle store and restoring multiple archived entries per reviewed transaction. It improves data
integrity by comparing independently operated RPC views and binding recovery to checkpoint
hashes. Recursive proofs and a new proving system are out of scope until measurements show that
proof aggregation, rather than witness construction or browser proving, is the bottleneck.

Each allowlisted asset gets its own immutable pool contract. The asset contract address is a
constructor argument stored in instance state; deposit and withdrawal entrypoints no longer
accept a caller-selected asset. Deployment scripts create the XLM and USDC pools independently
and publish one manifest entry per pool. An on-chain factory is unnecessary for the fixed Testnet
catalogue and would add authority and audit surface without improving privacy.

## Fixed-shape action and pool state

Every action publishes two nonzero nullifiers, two nonzero commitments, two fixed-length recipient
envelopes, and two fixed-length outgoing envelopes. Input and output lane order comes from browser
cryptographic randomness and is never sorted back into semantic order. Recipient, change, real,
and dummy roles are private witness data. Deposit and withdrawal direction and public amount remain
public because the asset transfer itself is public; the goal is to hide private note arity and lane
roles, not facts already exposed by the Stellar Asset Contract call.

A real input proves Merkle membership and derives its nullifier from the note and nullifier key. A
dummy input skips membership through a constrained private selector and derives a unique nonzero
nullifier from fresh dummy randomness plus the action context. The contract consumes and stores
both nullifiers, so a chain observer cannot identify the real-input count from zero lanes. This
intentionally doubles nullifier storage for one-input actions.

A real output has a positive value. A dummy output is a zero-value note with fresh `rho`, a valid
random owner commitment, a fresh throwaway HPKE recipient key, and a normal recipient envelope.
Both kinds produce nonzero commitments and identical public widths. The circuit constrains selector
bits, dummy values, positive real values, commitment preimages, value conservation, public deposit
or withdrawal amount, root membership for real inputs, and action-context binding. The scanner
decrypts and credits only positive notes whose commitment recomputes; zero-value notes never enter
the spendable-note set.

The pool validates both nullifiers and commitments, rejects duplicates within and across actions,
checks every public signal against the invoked method and pinned asset context, updates both
nullifier keys atomically, appends both commitments, and writes one immutable archive record. All
loops and ledger footprints remain fixed-width.

## Addresses, viewing keys, and ciphertexts

The shareable address becomes a literal network prefix followed by a Base58 body with a
domain-separated four-byte checksum:

`prefix || base58(format || deployment_tag || diversifier || owner_commitment || hpke_public_key || checksum)`

The Mainnet prefix is `skpay_`; Testnet is `tskpay_`. “Pay” makes the value visibly shareable and
avoids confusion with Stellar's `S...` secret seed. The checksum covers the literal prefix and all
body bytes, so editing only the prefix is invalid. `deployment_tag` is the first 16 bytes of a
domain-separated SHA-256 digest of the full deployment binding. The decoder recomputes the tag
from the authenticated manifest before accepting the address. The remaining fields stay four,
32, and 32 bytes respectively, for an 84-byte payload and an approximately 127–128-character
address. Base58 excludes visually ambiguous `0`, `O`, `I`, and `l` characters.

Key expansion derives separate incoming and outgoing viewing keys. For every output, the builder
emits a recipient HPKE envelope and a sender-decryptable outgoing envelope. The outgoing plaintext
contains the output index, real/dummy selector, recipient address material, value, memo, note
randomness, and a commitment check, all bound by AEAD additional data to the deployment, asset,
action nonce, commitment, and lane. Seed recovery scans the immutable archive, opens outgoing
envelopes with the outgoing viewing key, and reconstructs sent recipients and memos without a
local backup. Incoming ciphertext alone can credit notes; outgoing recovery metadata can never
create balance or spending authority.

Fresh self outputs always use a newly sampled nonzero diversifier. Recipient addresses remain
reusable, but the normal HPKE encapsulation is fresh for every output. Decoders accept only the new
prefixes and format; the old `tks1...` and `sks1...` forms are removed.

## Incremental Merkle storage and recovery

The worker persists one authenticated public Merkle cache per pool in IndexedDB. It stores the
verified record cursor, transcript head, commitment count, frontier, and the internal nodes needed
to produce paths for currently owned notes. Applying each archive record appends its two
commitments, updates only the affected path/frontier nodes, and commits the new cursor and cache in
one IndexedDB transaction. The scanner accepts the commit only when the recomputed Merkle root and
record hash chain equal the contract's authenticated head.

Spend preparation reads the selected notes' paths directly from this cache, reducing steady-state
witness construction from replaying the full pool history to logarithmic reads and updates. A
missing, partial, wrong-deployment, gapped, or root-mismatched cache is discarded for that pool and
rebuilt from immutable archive records. Seed-only recovery still requires one linear initial scan;
the optimization applies after the first authenticated checkpoint and does not claim impossible
sublinear recovery without an indexer.

Archive restoration accepts a locally derived ordered set of exact persistent ledger keys. The
client grows a candidate batch, simulates the exact restore-footprint transaction, and keeps the
largest prefix inside configured instruction, entry, byte, fee, and transaction-size margins. If a
simulation exceeds a limit, it bisects the candidate until it finds a safe nonempty prefix. Every
batch gets one immutable review showing all keys, the covered record interval, resource ceiling,
and maximum fee. The signed footprint must exactly match the locally derived batch; RPC-added or
reordered keys are rejected. Confirmation is bound to the locally computed transaction hash, and
failure resumes at the first unrestored key without replaying confirmed batches.

## RPC authenticity and failure behavior

The primary RPC remains the only endpoint used for simulation and submission. Recovery and sync
also use a separately configured witness RPC. Before accepting a checkpoint, the client validates
both network passphrases, compares an overlapping ledger sequence and ledger hash, and compares the
pool head with a bounded retry that tolerates ordinary head movement. The manifest pins the
deployment ledger sequence and hash; both providers must serve the same checkpoint during seed
recovery. Provider disagreement is surfaced as “RPC views disagree” and leaves local state at the
last authenticated checkpoint. It never becomes a zero balance, failed payment, or confirmed
transaction.

This is independent-provider corroboration, not local SCP verification. The UI explains that a
second provider learns another copy of the access pattern. Users may disable the witness provider
for ordinary sync, but checkpoint verification is mandatory for seed recovery. Submission status
continues to distinguish preparing, signing, submitting, pending, confirmed, rejected, failed, and
status unknown. A timeout, `PENDING`, or provider majority does not prove ledger confirmation.

Malformed addresses, envelopes, proofs, records, tree nodes, ledger headers, and contract heads
fail closed with stable safe errors. Secret buffers are scoped to the worker operation and cleared
where JavaScript byte arrays permit. Private addresses, proof inputs, ciphertext plaintexts,
transaction XDR, and hashes are not logged, prefetched, measured, or retained outside their
explicit encrypted stores.

## Proving decision and release gates

Before the replacement ceremony, benchmark the frozen circuit on BN254 and BLS12-381 using the
same witness corpus. Record proof size, constraint count, proving-key size, browser p50/p95 proving
time, peak memory on supported physical phones, local verification time, contract instructions,
ledger I/O, transaction bytes, and simulated Soroban fee. Also measure WebAssembly SIMD, threads
where cross-origin isolation is actually available, proving-key streaming, and an optional native
mobile prover. Choose BLS12-381 only if the 128-bit security upgrade fits the supported-device and
on-chain budgets; otherwise keep BN254 explicitly testnet-only and document the security margin.

The final curve gets one fresh circuit-specific phase-2 ceremony, one verification key, and one new
deployment. Development proving material remains quarantined. Release gates cover circuit selector
soundness, dummy indistinguishability at the public schema, lane permutation invariance, nullifier
replay, fixed asset binding, outgoing recovery, address checksum/prefix mutation, incremental tree
equivalence, cache corruption recovery, multi-key restoration splitting, RPC disagreement, and the
full prove-submit-scan lifecycle. Property tests compare randomized action sequences against the
reference model; adversarial tests mutate every proof/public input/ciphertext field; physical-device
results and contract resource reports are committed as evidence.

No recursive, Halo 2, or folding implementation is included. It becomes a separate design only if
measurements show multi-action proof aggregation is the dominant user-visible bottleneck.
