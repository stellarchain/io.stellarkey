# Private Balance Protocol Review — SOTA / Efficiency / Simplicity / Correctness / Speed

**Date:** 2026-09-02
**Revision reviewed:** `cc45d23` (main, clean tree)
**Scope:** `protocol/private-balance/` (circuits, `crates/protocol`, `contracts/pool`, `packages/browser`) and `src/features/private-balance/runtime/`

> The working tree moved during this review — the revision in the session's opening `git status`
> is no longer present. Every measurement below is against `cc45d23`.

**Test state at time of review:** `cargo test --workspace` all green; `packages/browser` 37/37.

---

## Implementation outcome

The recommendations were treated as hypotheses and recompiled or benchmarked before implementation.
The machine-readable evidence is
`protocol/private-balance/results/review-validation.json`; the harness is
`protocol/private-balance/spikes/scripts/run-review-validation.mjs`.

| Item | Decision | Measured result | Implementation |
|---|---|---|---|
| PKCS#8 X25519 import | Accept | Byte-identical shared secret; warm native median improved 80.31% in the recorded three-trial run | Native WebCrypto imports the raw scalar through RFC 8410 PKCS#8; the portable fallback remains |
| Remove dummy `lane` | Accept | 23,437 → 22,909 constraints (−528 exactly) | Removed from the circuit and witness schema |
| Ternary depth-17 tree | Accept | Complete production circuit: 14,876 constraints, 13 public inputs, 124 private inputs; 36.53% below baseline | Replaced the binary tree in Circom, Rust, Soroban, browser, cache, vectors, and manifests |
| Sapling-style X25519 diversification | Defer | Diversified-envelope opening remains materially slower, but the proposal lacks a complete reviewed variable-base KEM and cofactor specification | RFC 9180 remains unchanged |
| Consume outgoing envelopes | Accept | Existing 157-byte envelopes were already present for each output | Scanner now authenticates them to recover external recipient fingerprints and memos from seed plus chain data |
| Reduce deposit nullifier storage | Accept with correction | Storing neither dummy nullifier would allow exact proof replay; one durable replay key is sufficient | Deposits persist one nullifier; transfers and withdrawals persist both |
| Share Merkle primitive | Accept | Static review confirmed three unchecked string literals and duplicate consensus hashing | Contract imports the canonical raw ternary hash and empty-root table from the protocol crate |
| Remove redundant total range | Accept | 22,909 → 22,846 constraints (−63 exactly) | One 63-bit decomposition remains after equality |
| Derive output roles | Accept | 22,846 → 22,844 constraints and 152 → 150 private inputs | `outputReal` is derived from output value rather than supplied as witness data |

The resulting circuit fits the 2¹⁴ Groth16 domain. The generated development zkey is 9,121,500
bytes and its point-compressed transport is 6,227,870 bytes. The prior Testnet pools bind different
circuit and contract hashes, so they were not relabeled. The replacement artifacts ship with an
authenticated empty deployment catalogue and development use disabled until fresh asset-pinned
Testnet pools are deployed and verified.

The original analysis below is retained as the review record. Where a prototype caveat conflicts
with this section, this section records the completed implementation and test result.

---

## 1. Verdict

| Axis | Grade | Short version |
|---|---|---|
| **SOTA** | Strong, two gaps | Sapling-class design, ahead of anything else on Stellar. But the Merkle tree wastes the sponge rate, and diversified addresses are bolted onto stock DHKEM instead of done Sapling-style. |
| **Efficient** | 24–36% on the table | Measured by compiling variants, not estimated. |
| **Simple** | Protocol yes, runtime no | `crates/protocol` + circuits are tight. The 9.1k-line runtime carries a *second* privacy system. |
| **Correct** | Holds up | Circuit review found no soundness break. Two real hazards, both structural rather than exploitable. |
| **Fast** | Scanning is 3–6× slower than its own floor | And proving is one discrete cliff away from halving. |

### What is already right

Poseidon2 (width 4, rate 3) over BN254 with Groth16 verified by the Stellar host; RFC 9180 HPKE;
diversified addresses; dummy-input indistinguishability (`inputReal` + `inputDummySecret`);
OVK outgoing envelopes; view tags; an in-circuit relayer fee; frontier Merkle append in both
the contract and the client; `--O2` on every circom invocation. Several of these were open
findings in the previous audit round and are now closed.

---

## 2. The circuit is 75% Merkle tree, and the tree is the wrong arity

Measured with circom 2.2.3, `--O2`:

```
non-linear constraints: 23437
linear constraints:         0
public inputs:             13
```

That is **85 Poseidon2 permutations × 264 constraints**, distributed as:

| Component | Inputs | Perms each | Count | Total perms |
|---|---|---|---|---|
| `MerkleParent` | 3 | 1 | 64 | **64** |
| `NoteCommitment` | 6 | 2 | 4 | 8 |
| `Nullifier` | 6 | 2 | 2 | 4 |
| `DummyNullifier` | 4 | 2 | 2 | 4 |
| `OwnerCommitment` | 4 | 2 | 1 | 2 |
| `DiversifiedOwnerCommitment` | 3 | 1 | 2 | 2 |
| `ActionBinding` | 3 | 1 | 1 | 1 |

**Merkle path hashing is 64 of 85 permutations — 75% of the circuit.**

Every node is `H(DOMAIN_MERKLE_NODE, left, right)`. The sponge rate is 3, so one of three slots
goes to a constant. A ternary node costs the *same single permutation* and is
log₂3 = 1.585× shallower for the same capacity.

### Measured, by compiling the variants

| Variant | Constraints | Capacity | Groth16 domain |
|---|---|---|---|
| today (binary, depth 32) | 23,437 | 4.29 B leaves | 2¹⁵ → pot15, 14.1 MB zkey |
| ternary, depth 21 | **17,729** (−24%) | 10.5 B leaves | 2¹⁵ |
| ternary depth 17 + `lane` fix | **15,009** (−36%) | 129 M leaves | **2¹⁴ → pot14, ~7 MB zkey** |

The last row crosses a discrete cliff. Under 16,384 the setup drops to pot14 and the
FFT/Lagrange sections roughly halve. That is the Gate 0 mobile-proving blocker and the
first-use artifact download, addressed by one change.

129 M leaves = 64 M actions. For scale, Tornado ships at 2²⁰ = 1 M leaves.

It also cuts the contract from roughly 35 host Poseidon2 calls per action to about 20
(`append_leaf_to_frontier` plus the full `compute_tree_root` walk).

### The cost of this change

The ternary node must drop the domain constant to fit three children in the rate.
That is safe here — the sponge length IV already separates a 3-input node from the 6-input
note commitment, and landing on `DOMAIN_DIVERSIFIED_OWNER` in slot 0 requires a Poseidon2
preimage — but it is a real hygiene trade and should be recorded as a decision.

**The domain cannot instead be folded into the capacity IV.** `poseidon2_hash` calls
`soroban_p2_hash::<4, Bn254Fr>` (`crates/protocol/src/poseidon2.rs`), which owns the sponge and
fixes the IV at `N · 2⁶⁴`. Worth documenting so nobody re-derives this the hard way.

This must land **before** the phase-2 ceremony. It touches the circuit, `crates/protocol/src/tree.rs`,
`contracts/pool/src/contract.rs`, `packages/browser/src/tree.ts`, the empty-root table, and every vector.

### One-line free win, confirmed

`DummyNullifier` takes `(domain, contextField, dummySecret, lane)` = 4 inputs = 2 permutations.
`lane` is redundant: the circuit already enforces `duplicateNullifier.out === 0`, so two dummy
lanes cannot collide regardless. Dropping it gives exactly 3 inputs = 1 permutation.

Compiled: **23,437 → 22,909**, exactly the predicted 528 constraints.

`circuits/circom/nullifier.circom:26`, plus the `inputDummyNullifier[i].lane <== i;` line in
`action.circom`.

---

## 3. Scanning does three scalar multiplications where one would do

`openRecipientEnvelope` runs for every output of every record
(`src/features/private-balance/runtime/scanner.ts:224`) — two per action.

Measured per envelope, Node 26 on the review machine:

```
openRecipientEnvelope MISS         2681 us   <- 20k envelopes = 54 s
  deriveDiversifiedAddressKeys     1617 us   <- HKDF-SHA512 + a FRESH X25519 keypair
  deriveX25519SharedSecret native   933 us   <- of which ~460 us is a @noble base mult
WebCrypto deriveBits alone          427 us   <- the actual floor
noble base mult (getPublicKey)      323 us
JS Poseidon2 p2(), 1 permutation    168 us
```

Two independent problems.

### 3a. `deriveNative` recomputes the public key in JS on every call

`packages/browser/src/x25519.ts:35` calls `x25519.getPublicKey(privateKey)` purely to fill the
JWK `x` field before importing the private key.

PKCS#8 import (RFC 8410: a fixed 16-byte prefix + the raw 32-byte scalar) needs no public key at all.
Verified working, producing a byte-identical shared secret:

```
ECDH as shipped (jwk + noble base mult)    702 us
ECDH via pkcs8 (no base mult at all)       430 us    1.6x
```

```js
const PKCS8_PREFIX = Uint8Array.from([
  0x30,0x2e,0x02,0x01,0x00,0x30,0x05,0x06,0x03,0x2b,0x65,0x6e,0x04,0x22,0x04,0x20,
]);
function pkcs8(raw) { const o = new Uint8Array(48); o.set(PKCS8_PREFIX, 0); o.set(raw, 16); return o; }
// crypto.subtle.importKey('pkcs8', pkcs8(sk).buffer, { name: 'X25519' }, false, ['deriveBits'])
```

In a browser, where `deriveBits` costs ~40 µs rather than 427, this step drops from roughly
370 µs to roughly 85 µs. Isolated fix, no protocol change. Keep the `@noble` fallback path.

### 3b. The structural one: diversification is bolted onto stock DHKEM

The diversifier arrives *inside the envelope*, so `deriveDiversifiedAddressKeys` must derive a
whole new HKDF-SHA512 keypair per envelope before the ECDH can begin — and the view tag cannot be
checked until after all of it, so it buys no early exit on the expensive part.

Sapling avoids this precisely: `pk_d = [ivk]·g_d` with `g_d = hash_to_curve(d)` means the
recipient does **one** variable-base multiply regardless of which issued address was used.

On X25519 the equivalent is a hashed base point (Elligator2 / RFC 9380) —
`deriveBits({ name: 'X25519', public: P })` computes `sk·P` for any `P`, so the native fast path
survives. Watch cofactor-8 handling with a variable base.

This is the protocol-level change; 3a is worth doing regardless.

---

## 4. Efficiency: state paid for and not used

- **`openOutgoingEnvelope` is never called by the wallet.** It appears only in
  `packages/browser/test/vectors.test.mjs`; nothing under `src/features/private-balance/runtime/`
  reads it. That is **157 B × 2 = 314 bytes of permanent archive state per action** for
  sender-side history recovery that is not wired up. Either wire it into the scanner — it is the
  cheap HMAC path, and it is how a restored wallet recovers its *sent* history — or drop it
  until it is used.

- **Deposits burn two nullifier entries for nothing.** Every action marks 2 nullifiers
  permanently, including deposits with zero real inputs. For `PrivateTransfer` that is genuine
  anonymity. For `Deposit` it buys nothing: `actionKindField` is a public signal and
  `deposit_source` is a public address in the archive record, so an observer already knows it is
  a deposit with no real inputs. The same argument applies to `Withdraw`'s kind.

- **Redundant range check.** `totalInputRange` and `totalOutputRange` are both `CheckBits(63)`
  despite `totalInput === totalOutput` three lines above. 63 constraints.

---

## 5. Correctness

No soundness break found. The dummy-lane scheme holds up:

- the `selectedNullifier` mux is correct;
- `DummyNullifier` has its own domain, so an attacker cannot steer a dummy onto a victim's
  future real nullifier;
- `duplicateNullifier.out === 0` is unconditional and matches the contract's `validate_slots`;
- only real lanes are bound to the anchor root;
- the `anchor_root == tree_before.current_root` re-add at `contracts/pool/src/contract.rs:97`
  correctly closes the idle-pool root-expiry hole.

Two hazards worth fixing:

### 5a. String-literal domain in the contract

`contracts/pool/src/contract.rs` lines 45, 69 and 71 call `p2("SKSB_MERKLE_NODE_V1", …)` with a
string literal rather than `DOMAIN_MERKLE_NODE`. `domain_field()` falls through to
`bytes_to_field(SHA-256(label))` for any unrecognised string, so a typo yields a *different but
perfectly valid* domain: no compile error, no runtime error, just a contract tree that silently
diverges from every client. Use the constant.

### 5b. The frontier append exists twice

`crates/protocol/src/tree.rs` and a re-implementation in `contract.rs` over `Vec<BytesN<32>>`.
Two implementations of one consensus rule that must stay byte-identical. Tests cover it today;
sharing `hash_merkle_parent` at minimum would remove the divergence risk.

### 5c. Note-encryption is not bound in-circuit

Nothing constrains a sender to encrypt a note the recipient can actually open — the envelope is
produced outside the circuit and only the commitment is proven. A malicious sender can produce a
valid proof with an undecryptable envelope, stranding the note. Low severity (the griefer burns
their own funds, and self-change outputs are wallet-controlled), and it is a known Sapling
property, but it belongs in the threat model.

---

## 6. Simplicity

The protocol crate and circuits are genuinely clean and readable. The runtime is not.

- **9,095 lines across ~25 modules**, including a complete **second privacy system**:
  `stealth-cache` / `stealth-horizon` / `stealth-sync` / `stealth-payment` / `stealth-transaction`,
  roughly 1,300 lines, running alongside the ZK pool. Two privacy systems is the single largest
  complexity cost in the codebase. If the stealth path is a hedge, it is worth deciding whether
  it ships.

- **The docs are 4 files totalling ~90 lines.** `protocol/private-balance/docs/protocol-v1.md` is
  11 lines and describes none of the action circuit's constraints, the dummy-lane scheme, or the
  archive transcript. For a protocol heading into an external Gate A/B/C review, that is thin.

- **Dead branches in the scanner.** `if (isZero(output.cm)) continue;` and
  `if (isZero(nullifier)) continue;` are now unreachable — both the circuit and `validate_slots`
  forbid zero slots. Harmless, but misleading to a reader reconstructing the invariants.

- **`outputReal[]` is not an independent witness.** It only ever means "value != 0" and is
  derivable as `1 - IsZero(outputValue[j])`.

- **Archive recoverability depends on paid restores.** `set_archive_record` extends to `max_ttl`
  once and never again, so seed-only recovery past that window relies on
  `restorePrivateArchiveRange` (implemented, with exact-footprint assertions). That is a sound
  design, but the liveness/cost dependency is not stated in `docs/threat-model.md`.

---

## 7. Recommended order

| # | Change | Effort | Payoff |
|---|---|---|---|
| 1 | PKCS#8 X25519 import in `x25519.ts` | Small, isolated | ~2× on every ECDH in the scan loop; no protocol change |
| 2 | Drop `lane` from `DummyNullifier` | One line | −528 constraints (verified) |
| 3 | Ternary Merkle tree at depth 17 | Large | −36% constraints, pot15 → pot14, ~14 MB → ~7 MB key. **Must precede the ceremony.** |
| 4 | Sapling-style diversified keys (`pk_d = [ivk]·g_d`) | Protocol change | Removes the per-envelope keypair derivation |
| 5 | Wire up or delete outgoing envelopes | Small | 314 B/action of permanent state |
| 6 | Skip dummy nullifiers on `Deposit` | Small | 2 permanent entries per deposit |
| 7 | Use `DOMAIN_MERKLE_NODE` instead of the string literal | Trivial | Removes a silent-divergence footgun |
| 8 | Drop one of the two total range checks | Trivial | 63 constraints |

Items 2, 3 and 4 change the protocol and must be sequenced before the phase-2 ceremony.
Items 1, 5, 6, 7 and 8 are independent of it.

---

## 8. Caveats on these numbers

- The microsecond figures are Node 26 on the review machine, **not a browser**. Browser WebCrypto
  X25519 is far faster (~40 µs vs the 427 µs measured here), which makes the `@noble` base
  multiplications *relatively worse*, not better.
- The initial ternary figures came from a cost probe. The implementation outcome above reports the
  complete production circuit and cross-language implementation; it still requires independent
  protocol and circuit review before any non-development release.
- Constraint counts are `--O2`. Under `--O1` (circom's default) the absolute numbers differ;
  all build scripts in this repo already pass `--O2`.
