# StellarKey Shielded Balance Protocol Specification (V1)

## 1. Status and deployment boundary

Shielded Balance V1 is an opt-in note pool implemented by a Soroban contract, a Groth16 circuit,
and a local browser wallet. Each immutable pool is pinned to exactly one Stellar asset contract,
network, realm, circuit hash, verification-key hash, and Poseidon2 parameter hash. The replacement
protocol described here has no backward-compatible state migration. Its prior Testnet deployments
are retired; a fresh deployment and fresh local state are required.

The committed proving material is development-only. It is suitable for reproducible Testnet work,
not real value or Mainnet.

## 2. Cryptographic parameters

- Field: BN254 scalar field `Fr`, modulus
  `21888242871839275222246405745257275088548364400416034343698204186575808495617`.
- Proof: Groth16 with 13 public inputs. The current `--O2` circuit has 14,876 constraints and fits
  a `2^14` Powers-of-Tau transcript.
- Hash: Poseidon2 over BN254 `Fr`, width 4, rate 3, capacity 1, `x^5` S-box, 8 full rounds, 56
  partial rounds, and the implementation's length IV `N * 2^64`.
- Encryption: RFC 9180 base mode DHKEM(X25519, HKDF-SHA256), HKDF-SHA256, AES-128-GCM.
- Tree: incremental ternary Merkle tree of depth 17 with capacity `3^17 = 129,140,163` leaves.
- Action shape: two input lanes and two output lanes for every action.

All byte encodings, field conversions, Poseidon2 parameters, envelope lengths, and deployment
constants are pinned by the manifest and cross-language conformance vectors.

## 3. Notes and commitments

A note contains its asset-bound value, spending-key material, diversifier, randomness, optional
memo, and deployment context. `NoteCommitment` hashes the complete note preimage under its explicit
domain. A commitment is always a non-zero field element and every action appends exactly two
commitments.

A zero-value output is a dummy note, not an absent slot. Its commitment, randomness, keys,
diversifier, recipient envelope, and outgoing envelope are freshly constructed in the same format
as a real output. The private `outputReal` selector is derived in-circuit as `value != 0`; it is not
independent witness data. The wallet randomizes recipient/change and real/dummy lane ordering.

## 4. Merkle tree

`MerkleParent(left, middle, right)` is the raw three-input Poseidon2 hash. It intentionally has no
string domain field because all three rate elements are occupied by children. Poseidon2's length IV
separates this three-input construction from the six-input note commitment and other protocol
hashes. This is a protocol decision: changing arity, child order, depth, IV, or empty roots changes
consensus.

Each input witness carries 17 pairs of sibling nodes and one position trit per level. Position must
be 0, 1, or 2 and selects the leaf/node's ordered place among the two siblings. The leaf index is
decomposed in base 3. Only real input lanes must reconstruct the public anchor root; dummy lanes use
private dummy secrets and remain independent of the tree.

The contract and browser maintain a 34-node frontier, two slots per level. Clients persist an
authenticated incremental node store keyed by deployment and verified transcript checkpoint, so an
ordinary spend reads the selected logarithmic paths instead of reconstructing all pool history.

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

`sum(inputs) + publicDeposit = sum(outputs) + publicWithdrawal + relayerFee`.

Only one total needs an additional 63-bit decomposition after equality. The public action kind
selects these external flows:

- Deposit: public source and amount enter the asset-pinned pool; both private input lanes are dummy.
- Transfer: value moves only between private notes; public deposit and withdrawal are zero.
- Withdraw: public destination and amount leave the pool; one or two private inputs may be real.

The proof also binds the network, realm, pool, asset, current/anchor root, action kind, action
binding, commitments, and nullifiers. The contract independently validates canonical non-zero,
distinct slots before accepting the proof.

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
commitments, nullifiers, fixed-size envelopes, and tree transition. Recovery authenticates the
record chain, root, and action count before treating a balance as current.

## 8. Archival and RPC authentication

Persistent archive entries can expire into Stellar state archival. Recovery discovers a contiguous
missing prefix, simulates exact restore footprints, selects the largest safe batch within configured
resource and fee margins, requires reviewed authorization, confirms the transaction hash, rereads
the restored records, and saves an encrypted resume cursor. Restoration fees and RPC retention are
therefore liveness dependencies, not confidentiality assumptions.

The client corroborates the network, pinned deployment checkpoint, overlapping ledger hashes, and
contract head through independent RPC providers. Disagreement preserves the last authenticated
state and disables spending. Multiple providers learn more of the client's access pattern; that
privacy tradeoff is explicit.

## 9. Replacement and ceremony rule

Any change to the circuit, tree, hash inputs, proof schema, verifier, or action encoding invalidates
the proving key and deployment evidence. Regenerate all artifacts and vectors, complete independent
review and the required phase-2 ceremony, then deploy fresh pools. Never relabel an older deployment
or manifest as this protocol.
