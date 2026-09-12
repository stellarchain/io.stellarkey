# Private Balance Protocol Review — SOTA / Efficiency / Simplicity / Correctness / Speed

**Date:** 2026-09-03
**Revision reviewed:** `3db528e` (main, clean tree)
**Scope:** `protocol/private-balance/` (circuits, `crates/protocol`, `crates/verifier`, `contracts/pool`, `packages/browser`) and `src/features/private-balance/`

**Test state at time of review:** `npm test` 1,193/1,193 pass; working tree clean before and after.

This is the second review in this series. The predecessor is
[`private-balance-protocol-review-2026-09-02.md`](private-balance-protocol-review-2026-09-02.md),
whose recommendations were implemented in full apart from the deferred Sapling-style key
agreement. Everything below is what remains after that work. Nothing here re-opens an accepted
ADR; the decided items are listed in §11.

---

## 1. Verdict

| Axis | Grade | Short version |
|---|---|---|
| **SOTA** | Strong, one gap | Sapling-class and ahead of anything else on Stellar. Every envelope still publishes the recipient's four-byte diversifier in the clear, so repeat payments to one published address cluster on chain for free. |
| **Efficient** | Good, three left | The circuit and client are tight. The contract emits a full duplicate of every archive record as an event nothing reads, and the verifier pays three scalar multiplications for values fixed at construction. |
| **Simple** | Split | 4.7k lines for protocol + circuits + contract is genuinely lean. The runtime is not: one React context with ~40 members carries two independent privacy systems. |
| **Correct** | Holds | No soundness break. The one defect found is in the evidence, not the code. |
| **Fast** | 3.9× floor left | Scanning has a 3.9× gap to the floor the repo's own harness already measured. Proving is single-threaded and has no measurement against the shipped circuit. |

### Baseline facts

| | |
|---|---|
| Circuit | 14,574 constraints, 11 public inputs, 124 private inputs, 2¹⁴ Groth16 domain |
| Proving key | 8,971,612 B; 6,120,542 B point-compressed; 2,427,581 B Brotli-11 wire |
| Tree | Ternary, depth 17, capacity 3¹⁷ = 129,140,163 leaves = 64,570,081 actions |
| Ceremony | Not run. `vk_delta_2` is byte-exactly the BN254 G2 generator; `ceremonyTranscriptRoot` all-zero; `allowedEnvironment: testnet` |

---

## 2. Finding 1 — the envelope publishes the recipient's diversifier, and it does not have to

**Axes: SOTA, Fast, Simple. Cost: new envelopes and fresh pools, but no circuit change and no re-ceremony.**

`createOutputPackage` writes the recipient's four-byte diversifier into cleartext bytes 1–5 of
every 181-byte recipient envelope:

```
packages/browser/src/encryption.ts:223   recipientEnvelope.set(diversifier, 1);
packages/browser/src/keys.ts:168         deriveDiversifiedScanningKeys(ivk, diversifier)
```

It is there for exactly one reason: the scanner needs the diversifier to derive the child
X25519 key before it can attempt the ECDH.

### The leak

A public 32-bit tag rides on every output. Self, change and dummy outputs draw a fresh random
diversifier (`src/features/private-balance/worker/action-builder.ts:502,534`), so a *repeated*
value on chain is near-certain evidence of two payments to the same published address — random
self-output collisions are ~n²/2³³. Once the recipient lane can be picked out this way, the fixed
two-input/two-output shape stops hiding lane roles as completely as
`protocol/private-balance/docs/threat-model.md` §2 claims.

This is the default path, not an edge case: `ReceivePrivate.tsx:211` offers a manual "New address"
button over one otherwise persistent address.

ADR 0002 acknowledges the leak ("Address reuse can be correlated through the public diversifier")
and mitigates it only with guidance that wallets should issue fresh addresses — which pushes the
cost onto the user and does not work for a QR code someone shows people.

### The option ADR 0002 did not consider

ADR 0002 weighed two designs: keep stock RFC 9180 with a per-diversifier keypair (what ships), or
replace DHKEM with a Sapling-style variable-base KEM (rejected — no independent specification, no
interoperability suite, new hashed-base-point and cofactor surface). That rejection is correct.
There is a third option that neither case covers:

> **Stop diversifying the KEM key. Keep diversification only in the owner commitment.**
>
> - Encrypt to the account's single `hpke_public_key`.
> - Drop the four cleartext bytes from the envelope (181 → 177).
> - The recipient imports one `CryptoKey` handle once and does one `deriveBits` per envelope, then
>   reads the diversifier **out of the decrypted note** and checks
>   `owner_commitment == P2(DOMAIN_DIVERSIFIED_OWNER, base_owner_commitment, d)`.

The note plaintext already carries the diversifier at bytes 12–16
(`crates/protocol/src/note.rs`, `NotePlaintext::serialize`), and `openRecipientEnvelope` already
re-checks the plaintext copy against the cleartext one
(`packages/browser/src/encryption.ts:309`). The cleartext copy is therefore pure redundancy that
exists only to break a key-selection circularity this design does not otherwise have.

What does *not* change: the circuit, the note plaintext layout, the owner-commitment derivation,
the address length. RFC 9180 base mode is left *more* intact than today, which hand-derives a
fresh RFC 9180 keypair per diversifier through a re-implementation of `DeriveKeyPair`
(`packages/browser/src/keys.ts:117-140`).

### The measurement already exists

`protocol/private-balance/results/review-validation.json`, `scanPath.variants`, median
microseconds per foreign envelope, Node 26 / M3 Max:

| Variant | µs/envelope | Notes |
|---|---:|---|
| `current` | 1141.8 | pre-review path (HKDF-SHA512 + fresh keypair) |
| `reordered` | 990.1 | measured, not shipped |
| `webcrypto` | 249.9 | **what ships today** — 2 scalar mults + 2 WebCrypto imports per envelope |
| `ideal` | 64.3 | one imported handle, one `deriveBits`, one view-tag hash |

The `ideal` row is precisely where this change lands: **3.9× the shipping path**, and 17.8× the
pre-review one. The scanner also stops doing an HKDF-SHA512 extract/expand, an RFC 9180
`DeriveKeyPair`, a PKCS#8 import and a base-point multiplication on every foreign envelope, which
deletes `deriveDiversifiedScanningKeys` from the hot path entirely.

### The trade, stated plainly

Two addresses issued by the same account become linkable to somebody holding both, because they
would share one public key. That is a genuine loss, and it is the property Sapling's hashed base
point exists to preserve.

It is smaller than what is paid today. A global passive chain observer is the stronger adversary
in `threat-model.md`, and the current design loses to it on every repeat payment, for free, with
no collusion required — whereas the new leak requires an adversary to hold two addresses that were
handed out separately.

### If the trade is unwanted

The honest interim is not a protocol change:

- default the Receive screen to a fresh diversifier per payment request rather than a persistent
  address with a manual rotate button;
- put a bounded LRU on `deriveDiversifiedScanningKeys` keyed by diversifier.

Note that `review-validation.json` decision #2 rejected caching *one handle across* distinct
diversifiers, which is correct — every diversifier produces a distinct RFC 9180 scalar. A cache
*per* diversifier is a different and valid thing. It collapses repeat traffic and does nothing
against an adversarial mix of fresh diversifiers, so it is a mitigation, not a fix.

### Sequencing

No circuit, proving-key or ceremony impact — the view tag and envelope layout are outside the
Groth16 statement. It does invalidate existing envelopes, so it wants to land with the fresh pools
that the phase-2 ceremony requires anyway. Cheap now; expensive after real deployments exist.

---

## 3. Finding 2 — every action emits a full duplicate of the archive record as an event nothing reads

**Axis: Efficient. Cost: contract only, hours.**

```
contracts/pool/src/contract.rs:217   emit_shielded_action(env, &record);
contracts/pool/src/events.rs:4       #[contractevent(topics = ["shielded_action"], ...)]
                                     pub struct ShieldedAction { pub record: ArchiveRecord }
```

`ArchiveRecord` contains both complete `OutputPackage`s — 2 × (32 + 181 + 157) = 740 bytes of
payload before XDR field keys and the remaining ten fields. Roughly 1.3–1.5 KB is published as an
event on every deposit, transfer and withdrawal.

Two lines earlier, `archive::append_record` wrote that identical record to persistent storage. The
same payload is also already present in the transaction's invocation arguments. Three copies.

**Nothing consumes the third one.** There is no `getEvents` call anywhere in `src/`, `protocol/`,
`e2e/` or `tests/`; the client reads archive records through direct ledger-entry reads
(`src/features/private-balance/runtime/archive-client.ts:409,497`). And
`protocol/private-balance/scripts/check-no-backend.mjs` forbids an indexer, so no third party is
intended to consume it either.

**Fix:** emit `(action_index, transcript_head)`. The action stays observable and the hash chain
stays externally checkable, and roughly 95% of the event bytes go away. No proof, vector, manifest
or client change.

---

## 4. Finding 3 — the verifier does three scalar multiplications per proof for values that never change

**Axes: Efficient, Fast. Cost: same VK, same proofs, no re-ceremony.**

`crates/verifier/src/verify.rs:105-112` builds `K = IC[0] + Σ signal[i]·IC[i+1]` with an 11-point
`g1_msm`. But:

- `public_signals[0]` is `context_field` and `public_signals[1]` is `asset_field`. Both are
  computed once in `__constructor` and stored in `PoolConfig`
  (`contracts/pool/src/contract.rs:299-300`), and each pool is pinned to one immutable asset by
  ADR 0003. They are constant for the pool's entire lifetime.
- `public_signals[2]` is `actionKindField`, which the circuit constrains to exactly {1, 2, 3}
  (`circuits/circom/action.circom:79-83`).

**Fix:**

1. Precompute `ic_base = IC[0] + context_field·IC[1] + asset_field·IC[2]` in the constructor and
   store the 64-byte G1 point. MSM over the remaining nine, then `g1_add(ic_base, terms)`.
2. Precompute the three `k·IC[3]` points and select with a `g1_add`, taking the MSM to eight.

The contract has no upgrade entry point and the verification key is embedded in the Wasm and
hash-pinned by the constructor against `EXPECTED_VERIFICATION_KEY_HASH`, so the precomputation
cannot drift from the key it was derived against.

Secondary benefit: once the IC contribution is precomputed, `context_field` and `asset_field` are
no longer needed in the hot path at all, which composes with Finding 4.

For scale, the previous round's move to a single MSM plus the 11-signal statement measured
39,614,514 → 29,287,953 instructions (−26.07%). This trims about 27% of that MSM's points.

---

## 5. Finding 4 — the immutable half of `PoolConfig` is read and rewritten on every action

**Axis: Efficient. Cost: contract only.**

Soroban instance storage is a single ledger entry, so `DataKey::{Config, Asset, Tree, Meta,
DepositPause}` are read and written together on every action.

Seven of `PoolConfig`'s thirteen fields are compile-time constants that `__constructor` already
asserts equal to the values embedded in the Wasm (`contracts/pool/src/contract.rs:241-248`):
`protocol_version`, `poseidon2_parameter_hash`, `circuit_hash`, `verification_key_hash`,
`tree_depth`, `root_window_ledgers` — and `network_id`, which is available for free from
`env.ledger().network_id()`.

That is roughly 220 bytes carried through every action's read and write footprint for data the
contract already contains. Keep them out of the stored struct and reconstruct them in the
`config()` view, which is the only place they are read.

Retained per-deployment fields: `realm_id`, `guardian`, `context_hash`, `deployment_binding_hash`,
and — unless Finding 3 lands — `context_field` and `asset_field`.

---

## 6. Finding 5 — the checked-in curve benchmark measures a circuit that no longer exists

**Axes: Correct, Fast. Cost: evidence, not code.**

`protocol/private-balance/results/curve-benchmark.json` carries
`generatedAt: 2026-09-02T02:57:31.721Z` and reports, for both curves:

| | benchmark | shipped (`public/protocol/private-balance/v1/manifest.json`) |
|---|---:|---:|
| `constraintCount` | 23,437 | 14,574 |
| `publicInputCount` | 13 | 11 |
| `provingKeyBytes` | 14,739,008 | 8,971,612 |

It describes the pre-ternary circuit. The gate around it validates shape, not identity:
`tests/private-recovery-gate.test.mjs:114-147` asserts `constraintCount > 0`, that both curves are
present, and that no winner is declared — but never binds `circuit.r1csSha256` to
`manifest.artifacts.r1csSha256`.

Because `decision.status` is `pending-physical-device-evidence`, this is the artifact a Gate-0
curve choice would be made against: a circuit 61% larger and a key 64% larger than the one
actually shipped, with correspondingly pessimistic proving times (`bn254` p50 1,060.8 ms).

This is the same class of gap as the hand-typed `zkeyVerified: true` literal recorded in the
2026-09-02 audit: a green check not derived from the thing it certifies.

**Fix:** regenerate the benchmark, and add one assertion tying its `r1csSha256` (and
`provingKeySha256`) to the manifest so it cannot silently rot again.

**While the harness is out:** record a per-action Testnet `minResourceFee` and read/write footprint
for deposit, transfer and withdraw. The repo currently contains no measured on-chain cost for a
single action anywhere — `results/archive-gate.json` measures restoration fees only, and
`curve-benchmark.json`'s `contract` block is all `null` with `status: "pending"`. That is the
number Finding 2 and Finding 4 should be judged against.

**Interim placeholder.** I timed the shipped circuit through a copy of
`scripts/generate-proof-vectors.mjs` (Node 26, M3 Max, snarkjs single-thread, four runs per action
after warm-up, machine under other load): deposit 1.31–1.74 s, transfer 0.75–0.98 s, withdraw
0.82–1.72 s; median 1.35 s across twelve samples. Too noisy to check in as evidence — which is
exactly the point. No proving number for the shipped circuit exists in the repo, and no number
from a physical phone exists for any circuit.

---

## 7. Finding 6 — proving is single-threaded because the app is not cross-origin isolated

**Axis: Fast. Deferred by the previous review; restated because the other half of the blocker is now solved.**

`public/_headers` sets `Cross-Origin-Opener-Policy: same-origin-allow-popups` and no
`Cross-Origin-Embedder-Policy`, so `crossOriginIsolated` is false, `SharedArrayBuffer` is
unavailable, and snarkjs runs the MSM and FFT on one thread inside the worker
(`src/features/private-balance/worker/private-balance.worker.ts:287`).

The 2026-09-02 review deferred this pending physical-device and subresource-compatibility
evidence, which was right. It is restated here because the artifact half of the Gate-0 blocker is
now closed — 24.26 MB → 8.97 MB, 2.43 MB on the wire — leaving threading as the single largest
remaining lever on perceived speed.

The concrete unknown worth measuring is whether `COEP: credentialless` holds on iOS Safari for
this static export. The surface is favourable: the app has no cross-origin subresources, and its
RPC traffic is CORS `fetch`, which COEP does not constrain. Note that COOP must also move to
`same-origin`, which drops the popup allowance currently granted.

---

## 8. Finding 7 — one React context carries both privacy systems and forty members

**Axis: Simple. Cost: mechanical.**

`src/features/private-balance/runtime/provider.tsx` is 2,216 lines and exposes a single context
whose value (`runtimeValue`, lines 2124-2185) spans the ZK pool, the stealth system
(`stealthMetaAddress`, `stealthPayments`, `stealthLatestLedger`, `stealthSyncing`, `stealthError`,
`refreshStealth`, `prepareStealthSweep`, `submitStealthSweep`), RPC witness configuration,
encrypted-storage accounting, tab leadership, chained send and full verification.

ADR 0007 decided both systems ship, and that decision is sound — they are complementary, not
interchangeable, and the ADR's own reasoning is that their key derivation, storage, sync, recovery
and terminology must stay separate. Sharing one provider works against that. Splitting stealth
into its own context is mechanical and does not reopen the ADR; it lets a component, and a reader,
depend on one system without loading the vocabulary of the other. It is the cheapest available
reduction in the runtime's surface area.

Two smaller items alongside it:

- `PoolError::AlreadyInitialized` and `PoolError::UnauthorizedGuardian`
  (`contracts/pool/src/errors.rs:7,22`) are declared and never constructed, yet they appear in
  `protocol/private-balance/generated/pool-client/src/index.ts:83,98` as outcomes a caller should
  handle.
- The 1,661 lines of `runtime/stealth-*.ts` remain the largest single block of complexity in the
  feature. That is an accepted ADR 0007 cost, recorded here only so it stays visible.

---

## 9. Checked and sound

Worked through by hand rather than trusted to the tests. Recorded so a future reviewer does not
re-derive them.

- **Ternary is provably the right arity.** Cost per lane is `⌈a/3⌉ · log_a N`, minimised at
  `a = 3` (0.910, against 1.116 for arity 6, 1.366 for 9, 1.443 for 4). Given that Soroban's
  `soroban_p2_hash::<4, Bn254Fr>` fixes width 4 / rate 3, depth-17 ternary is optimal rather than
  a compromise. ADR 0004's reasoning holds for the same reason.
- **The Merkle position mux is exact.** `circuits/circom/merkle.circom:54-70` resolves to
  `[cur, s0, s1]`, `[s0, cur, s1]` and `[s0, s1, cur]` for p = 0, 1, 2 respectively, and matches
  `crates/protocol/src/tree.rs::compute_root_from_path` and the TypeScript.
- **Value conservation cannot wrap.** Each of the at-most-four addends is 63-bit range-checked, the
  sum stays far below the BN254 scalar modulus, and `totalInput === totalOutput` plus the single
  63-bit decomposition on `totalInput` transfers the bound to the output side. The removal of the
  second range check in the previous round is safe.
- **Deposit replay is closed.** One persisted dummy nullifier is sufficient. Swapping the two
  nullifier slots changes `signals[7]`/`signals[8]` and the canonical action field, so the proof
  fails; substituting a different `deposit_source` changes the action field for the same reason.
- **Absent `require_auth` on transfer and withdraw is safe.** The relayer address and fee are
  inside the canonical action field, so a front-runner reproduces an identical state transition and
  pays the transaction fee to do it. The user's submission then fails with
  `NullifierAlreadySpent`, which is the documented ambiguous-submission path the client already
  handles.
- **The idle-pool root hole is closed.** Re-registering the anchor when it equals the current root
  (`contracts/pool/src/contract.rs:136-143`) plus the permissionless `touch_root` keeps a quiet pool
  spendable while deposits are paused.
- **The pairing check is right.** Canonical-signal checks, G1 negation and the four-pair check all
  hold. `negate_g1_y(0) = 0` is correct because BN254 has no 2-torsion, so `(0,0)` can only be the
  encoded point at infinity.
- **The guardian cannot trap funds.** `set_deposits_paused` covers deposits only; withdrawals and
  transfers stay open under every guardian state. That asymmetry is correct and worth keeping
  deliberately.

---

## 10. Recommended order

| # | Change | Effort | Payoff |
|---|---|---|---|
| 1 | Trim the `shielded_action` event to `(action_index, transcript_head)` | Hours | ~1.3–1.5 KB of billed event payload per action; nothing downstream reads it |
| 2 | Precompute the constant IC terms; trim `PoolConfig` | A day | ~27% of the verifier MSM's points and ~220 B off the hot instance entry; same VK and proofs |
| 3 | Regenerate and manifest-bind the curve benchmark; capture a per-action Testnet fee | A day | Restores the artifact a Gate-0 decision depends on |
| 4 | Decide the diversifier question | Protocol change | Closes on-chain address linkability and lands on the measured 3.9× scan floor. **Wants to precede the ceremony's fresh pools.** |
| 5 | Measure `COEP: credentialless` on a physical iPhone | Gate 0 | The last large proving lever |
| 6 | Split the stealth context out of the provider | Opportunistic | The cheapest reduction in runtime surface area |

Items 1, 2, 3 and 6 are independent of the ceremony. Item 4 changes the envelope but not the
circuit, so it needs fresh pools but not a new proving key.

---

## 11. Not re-litigated

- **Self-submission (ADR 0005).** The client puts the user's own account in the relayer field and
  signs the inner transaction, linking every shielded spend to a public Stellar identity. The
  contract and circuit already carry the bound relayer and fee, so a relay costs no ceremony. This
  remains the single largest privacy hole in the system and is correctly framed as a beta blocker
  rather than a bug.
- **The ceremony.** `vk_delta_2` in `public/protocol/private-balance/v1/verification-key.json` is
  still byte-exactly the BN254 G2 generator; `ceremonyTranscriptRoot` is all-zero and
  `allowedEnvironment` is `testnet`. Known, gated twice in code, unchanged.
- **Asset-pinned pools (0003), capacity-domain separation (0004), association sets (0006), the
  variable-base KEM (0002).** Each rejects a specific proposal with reasoning this review agrees
  with. Finding 1 is not a re-run of ADR 0002 — it is a third option that neither the accept nor
  the reject case covered.
- **Encryption is not bound in-circuit.** A malicious sender can burn its own value into an
  undecryptable envelope. Known Sapling property, now correctly recorded in `threat-model.md` §3.

---

## 12. Caveats on these numbers

- The scan-path microsecond figures are the repo's own `review-validation.json`, measured under
  Node 26 on an M3 Max — not a browser. Browser WebCrypto X25519 is faster in absolute terms, which
  makes the JavaScript-side HKDF and `DeriveKeyPair` work *relatively worse*, not better, so the
  3.9× in Finding 1 is a floor rather than a ceiling.
- The proving times in §6 were measured on a machine under concurrent load and vary by more than
  2× within a single action kind. They are cited to demonstrate that no trustworthy number exists,
  not as evidence in themselves.
- The event and instance-entry byte figures in Findings 2 and 4 are derived from the XDR shapes,
  not measured against a live ledger. Recommendation 3 exists to replace them with measurements.
- Constraint counts are `--O2`, consistent with every build script in the repo.
- This is a read-only review. No source file was modified; the working tree was clean at `3db528e`
  before and after.
