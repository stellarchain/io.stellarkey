# StellarKey Shielded Balance Protocol Specification (V2)

## 1. Status and deployment boundary

Shielded Balance V2 is an opt-in note pool implemented by a Soroban contract, a Groth16 circuit,
and a local browser wallet. One deployment owns one shielded tree and an append-only,
administrator-curated asset registry. The network, realm, initial asset administrator, guardian,
circuit hash, verification-key hash, and Poseidon2 parameter hash are deployment-bound.
StellarKey 1.5.1 is the application baseline. The authenticated catalogue publishes one
development pool with XLM at registry index 0 and USDC at index 1. Only the current
deployment-bound state, address, proof and backup encodings are supported.

The committed proving material is development-only. It is suitable for reproducible Testnet work,
not real value or Mainnet.

## 2. Cryptographic parameters

- Field: BN254 scalar field `Fr`, modulus
  `21888242871839275222246405745257275088548364400416034343698204186575808495617`.
- Proof: Groth16 with 11 public inputs. The current `--O2` circuit has 40,594 constraints and uses
  the pinned power-17 Powers-of-Tau transcript.
- Hash: Poseidon2 over BN254 `Fr`, width 4, rate 3, capacity 1, `x^5` S-box, 8 full rounds, 56
  partial rounds, and the implementation's length IV `N * 2^64`.
- Encryption: RFC 9180 base mode DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, AES-128-GCM.
- Tree: incremental ternary Merkle tree of depth 64 (private 17+47 hierarchy) with capacity `3^64` leaves.
- Action shape: two input lanes and three output lanes for every action.

All byte encodings, field conversions, Poseidon2 parameters, envelope lengths, and deployment
constants are pinned by the manifest and cross-language conformance vectors.

Consensus and operational review decisions are recorded in
[`0002-private-note-key-agreement.md`](decisions/0002-private-note-key-agreement.md),
[`0008-governed-asset-private-pool.md`](decisions/0008-governed-asset-private-pool.md), and
[`0004-poseidon2-capacity-domain.md`](decisions/0004-poseidon2-capacity-domain.md),
with association-set and stealth-subsystem boundaries in
[`0006-association-sets.md`](decisions/0006-association-sets.md), and
[`0007-stealth-subsystem.md`](decisions/0007-stealth-subsystem.md).

## 3. Notes and commitments

The 128-byte encrypted note plaintext contains its version and flags, value, diversifier, owner
commitment, randomness `rho`, optional memo, immutable asset-registry index, and reserved bytes.
`NoteCommitment` hashes the deployment context, full asset field, owner commitment, value, and
`rho` under its explicit domain. The diversified owner commitment binds the address diversifier.
The memo and asset index are authenticated by the envelopes, while the circuit binds the full asset
field rather than the compact index. A commitment is always a non-zero field element and every
normal action appends exactly three commitments; a FullInputExit binds but does not append its three dummy commitments.

A zero-value output is a dummy note, not an absent slot. Its commitment, randomness, keys,
diversifier, recipient envelope, and outgoing envelope are freshly constructed in the same format
as a real output. The private `outputReal` selector is derived in-circuit as `value != 0`; it is not
independent witness data. The wallet randomizes recipient, change, and dummy lane ordering.
All three recipient envelopes in an action carry the same clear four-byte action diversifier. This
prevents a clear-diversifier lane-role fingerprint, but it does not hide that diversifier or
make repeated use of one receive address unlinkable across actions.

## 4. Merkle tree

`MerkleParent(left, middle, right)` is the raw three-input Poseidon2 hash. It intentionally has no
string domain field because all three rate elements are occupied by children. Poseidon2's length IV
separates hashes by arity only: it separates this construction from the six-input note commitment,
but not from another three-input hash. Every other arity-three protocol hash must therefore put its
distinct domain constant in rate slot zero. The raw Merkle construction relies on Poseidon2 preimage
and collision resistance: making a valid note commitment or parent equal one of those fixed domain
constants must remain computationally infeasible. This is a protocol decision; changing arity,
child order, depth, IV, domain-slot convention, or empty roots changes consensus.

Each input witness carries 64 pairs of sibling nodes and one position trit per level. Position must
be 0, 1, or 2 and selects the leaf/node's ordered place among the two siblings. The leaf index is
decomposed in base 3. Only real input lanes must reconstruct the public anchor root; dummy lanes use
private dummy secrets and remain independent of the tree.

The contract and browser maintain a 128-node frontier, two slots per level. Clients persist an
authenticated incremental node store keyed by deployment and verified transcript checkpoint, so an
ordinary spend reads the selected logarithmic paths instead of reconstructing all pool history.

The parent hash applies the width-four permutation to the ordered three children and a capacity
cell initialized to `3 * 2^64`, returning the first state element. It is a three-input hash, not a
three-wide permutation.

Deposit, Transfer and Withdraw append three leaves and return `TreeFull` when fewer
than three remain. FullInputExit (kind 4, entrypoint `full_input_exit`) proves that
all output values are zero and the selected input total equals public withdrawal.
It skips the append guard, preserves root/frontier/leaf count, and remains usable
at saturation subject to normal proof, nullifier, token and ledger conditions.
Both modes share real nullifiers; changing action kind cannot replay a spent note.

Positions and archive counters use u128 and 16-byte big-endian canonical encoding.
The browser uses BigInt and strict decimal strings in storage. A record binds its
independent action index and starting leaf position. Exits advance only the former;
clients must never infer the leaf count as three times the archive action count.
Both the finite `3^64` leaf bound and u128 archive bound remain explicit. Multi-note
full-balance withdrawals use consecutive <=2-input exits, not consolidation; the
wallet's one-approval 64-step/15-minute bound and fee caps remain in effect.

## 5. Nullifiers and fixed arity

A real nullifier binds the note secret, leaf identity, and deployment context. A dummy nullifier
binds a fresh secret and context, uses its own domain, and omits a lane number. The circuit selects
between real and dummy nullifiers privately, requires both public slots to be non-zero and distinct,
and constrains real lanes to the anchor root.

Transfers and withdrawals persist both nullifiers. Deposits have no real input and publicly reveal
their action kind, so the contract persists only the first dummy nullifier as an exact-proof replay
key. Persisting neither would allow replay; persisting the second adds no replay protection.

## 6. Value balance and actions

Values are 63-bit unsigned integers. Each input and output value is range constrained. The circuit
computes one total equality:

`sum(inputs) + publicDeposit = sum(outputs) + publicWithdrawal`.

Only one total needs an additional 63-bit decomposition after equality. The public action kind
selects these external flows:

- Deposit: a public source, registry index, asset, and amount enter the pool; both private input
  lanes are dummy.
- Transfer: value moves only between same-asset private notes; public value and public asset fields
  are zero. The full action asset field is private.
- Withdraw: a public destination, registry index, asset, and amount leave the pool; one or two
  private inputs may be real.
- FullInputExit: the same boundary fields as Withdraw, but all three output values
  are zero and public value equals the full selected input value. No leaves append.

The eleven public signals, in verifier order, are the deployment context field, boundary asset
field, action kind, anchor root, public value, canonical action field, two nullifiers, and three
output commitments. The boundary asset field is zero for a transfer and equals the registered full
asset field for a deposit or withdrawal. A separate private action asset field binds every real
input and all three output commitments, and must equal the public field at transparent boundaries.
The action field is the canonical external hash of the network, realm, pool, optional boundary
asset/index, nonce, anchor root, complete output packages, and public endpoints. It contains no
relayer or relayer-fee field. Its explicit non-zero circuit constraint gives it a non-zero Groth16
input coefficient; mutating it invalidates a proof. The contract derives that field itself and
independently validates canonical non-zero, distinct slots before accepting the proof.

The application constructs recipient, change and zero-value dummy outputs;
it does not construct private peer-fee outputs. Every action has three output
lanes, with FullInputExit binding but not appending its dummy commitments.

## 7. Encryption and recovery transcript

Each output package contains a 181-byte recipient envelope and a 157-byte outgoing envelope. The
recipient envelope lets the incoming viewing key test and open owned notes. The outgoing envelope
is authenticated under the outgoing viewing key and lets a seed-restored sender recover an external
recipient fingerprint and memo. Change and dummy envelopes use the same fixed sizes.

Envelope associated data binds the deployment and output context. Encryption is intentionally
outside the Groth16 circuit: a valid commitment does not prove that its envelope is decryptable.
This matches the documented griefing boundary and requires wallet implementations to construct and
self-check their own change outputs.

Every accepted action writes a hash-chained archive record containing the public action data,
three commitments, nullifiers, fixed-size envelopes, and tree transition. Transfer records contain
no asset contract, asset index, relayer, or fee recipient. Recovery trial-decrypts each envelope
against registered asset candidates, authenticates the encrypted asset index, and verifies the
full note commitment before accepting a note. Recovery authenticates the record chain, root, and
action count before treating a balance as current.

## 8. Asset registry and administration

Registry indices are assigned contiguously and never reused. The current asset administrator may
add a Stellar Asset Contract, set an existing entry to `Active` or `ExitOnly`, and propose a new
administrator. The proposed administrator must explicitly accept, preventing transfer to an
uncontrolled address. Adding an asset and either administration step require Soroban
authorization. An `Active` asset accepts deposits, transfers, and withdrawals. `ExitOnly` blocks
new deposits while retaining transfers and withdrawals so historical private notes are not trapped.
There is intentionally no delete operation and no index mutation.

The browser treats the on-chain registry as canonical and corroborates it with the same independent
RPC policy as the contract head. Static manifest metadata supplies human-readable labels and known
issuer information; it cannot override a contract address, index, field, or status read from the
contract.

## 9. Archival and RPC authentication

Persistent archive entries can expire into Stellar state archival. Recovery discovers a contiguous
missing prefix, simulates exact restore footprints, selects the largest safe batch within configured
resource and fee margins, requires reviewed authorization, confirms the transaction hash, and
reports in-memory progress after every batch. The canonical sync then rereads the restored records
and commits an authenticated encrypted checkpoint. Interruption before that sync causes a safe
rescan rather than trusting a separately persisted restoration cursor. Restoration fees and RPC retention are
therefore liveness dependencies, not confidentiality assumptions.

The client corroborates the network, any retained copy of the pinned deployment-checkpoint ledger,
a current overlapping ledger hash, and the contract head through different-origin RPC providers for
initial sync, seed recovery, full-history checks, and routine checks by default. A checkpoint aging
out of a provider's rolling ledger-retention window does not expire the deployment: the
authenticated manifest remains the trust anchor, every retained copy must match it, and both RPCs
must still agree on a current common ledger and complete contract head. A user may disable the
routine witness after an authenticated checkpoint exists, accepting primary-RPC-only head trust
for those passes. Witness disagreement preserves the last authenticated state and disables
spending. The shipped SDF-primary/Ankr-witness defaults are operator-diverse, but the runtime can
enforce only origin and ledger-view separation; a custom primary under common control with the
witness defeats the operator-diversity assumption. Multiple endpoints learn more of the client's
access pattern; that privacy tradeoff is explicit.

## 10. Direct-only application submission

The application prepares transfers, withdrawals, and deposits for direct submission
from the user's Stellar account through the selected RPC. The public source and
network fee remain visible. There is no peer submission or private helper-fee route.

Current encrypted records explicitly bind the direct route, proof exposure,
outgoing-history policy and issued-address history. Unsupported records are
rejected before signing, network recovery or storage updates. Current exposed
inputs remain held until canonical reconciliation; a timeout or envelope failure
does not revoke a reusable spend proof. Encrypted backups use the same validation.

## 11. Replacement and ceremony rule

Any change to the circuit, tree, hash inputs, proof schema, verifier, or action encoding invalidates
the proving key and deployment evidence. Regenerate all artifacts and vectors, complete independent
review and the required phase-2 ceremony, then deploy fresh pools. Never relabel an older deployment
or manifest as this protocol.
