# Private Payments Protocol Replacement Implementation Plan

> **For the implementing agent:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Testnet Private Payments protocol in place with fixed-shape private actions,
asset-pinned pools, compact `skpay_`/`tskpay_` addresses, outgoing recovery, incremental Merkle
storage, batched archive restoration, and corroborated RPC checkpoints.

**Architecture:** Keep manifest protocol version 1 and Groth16's two-input/two-output action width,
but regenerate every bound artifact and deployment. Each pool pins one asset; the circuit privately
selects real and dummy lanes while the contract always consumes two nullifiers and appends two
commitments. Public tree state is cached incrementally per pool, sender metadata is recovered from
an outgoing viewing key, and recovery checkpoints require two independent RPC views.

**Tech Stack:** Circom 2/Groth16, Rust and `soroban-sdk`, TypeScript/Web Workers, IndexedDB, RFC 9180
HPKE, SHA-256/Poseidon2, Stellar RPC, Node test runner, and Cargo tests.

---

### Task 1: Replace private-address encoding

**Files:**
- Create: `protocol/private-balance/packages/browser/src/base58.ts`
- Modify: `protocol/private-balance/packages/browser/src/address.ts`
- Modify: `protocol/private-balance/packages/browser/src/index.ts`
- Modify: `protocol/private-balance/packages/browser/test/vectors.test.mjs`
- Modify: `protocol/private-balance/packages/browser/test/rust-differential.test.mjs`
- Modify: `protocol/private-balance/crates/protocol/src/address.rs`
- Modify: `protocol/private-balance/crates/protocol/tests/address.rs`
- Modify: `protocol/private-balance/crates/test-support/src/bin/generate-key-address-cases.rs`
- Modify: `protocol/private-balance/scripts/generate-conformance-vectors.mjs`
- Modify: `protocol/private-balance/vectors/addresses-v1.json`
- Modify: `src/features/private-balance/runtime/receive.ts`
- Modify: `src/features/private-balance/runtime/storage.ts`
- Modify: `src/features/private-balance/worker/client.ts`
- Modify: `src/features/private-balance/worker/messages.ts`
- Modify: `src/lib/private-address.ts`
- Modify: `tests/private-address.test.mjs`
- Modify: `tests/private-balance-receive.test.mjs`
- Modify: `tests/private-balance-worker-isolation.test.mjs`

**Step 1: Write failing TypeScript and Rust address tests**

Test canonical `skpay_` and `tskpay_` round trips, 16-byte deployment tags, Base58 ambiguous-character
exclusion, prefix-bound checksum mutations, wrong-deployment rejection, low-order X25519 rejection,
and unconditional rejection of `tks1...`/`sks1...` strings. Assert an encoded Testnet address is at
most 128 ASCII characters.

**Step 2: Verify red**

Run:

```bash
npm --prefix protocol/private-balance/packages/browser test -- --test-name-pattern=address
cargo test -p private-balance-protocol --test address
node --no-warnings --experimental-strip-types --loader ./tests/ts-resolve-loader.mjs \
  --test tests/private-address.test.mjs tests/private-balance-receive.test.mjs
```

Expected: FAIL on missing Base58 codec and new prefixes.

**Step 3: Implement the exact format**

Use:

```ts
export type PrivateAddressPrefix = 'skpay_' | 'tskpay_';
export const PRIVATE_ADDRESS_DEPLOYMENT_TAG_BYTES = 16;
export const PRIVATE_ADDRESS_PAYLOAD_BYTES = 84;

// body = format(1) || deploymentTag(16) || diversifier(4) ||
//        ownerCommitment(32) || hpkePublicKey(32) || checksum(4)
// checksum = SHA256("StellarKey private payment address checksum" ||
//                   utf8(prefix) || bodyWithoutChecksum).slice(0, 4)
```

Implement canonical leading-zero-preserving Base58 encode/decode in both languages. Require the
format byte, exact decoded length, exact re-encoding, valid owner field, and valid X25519 key. The
deployment tag is derived from the authenticated 32-byte binding hash with domain-separated
SHA-256 and compared in constant-time where available.

**Step 4: Regenerate vectors and build browser output**

Run:

```bash
node protocol/private-balance/scripts/generate-conformance-vectors.mjs
npm --prefix protocol/private-balance/packages/browser run build
```

Commit generated `dist/address.*`, `dist/base58.*`, and the vector update because the root package
consumes the checked-in browser distribution.

**Step 5: Run focused tests until green**

Run the commands from Step 2 plus `npm test -- --test-name-pattern='private address|receive payload'`.

**Step 6: Commit**

```bash
git add protocol/private-balance/packages/browser protocol/private-balance/crates/protocol \
  protocol/private-balance/crates/test-support protocol/private-balance/scripts \
  protocol/private-balance/vectors/addresses-v1.json src/features/private-balance/runtime/receive.ts \
  src/features/private-balance/runtime/storage.ts src/features/private-balance/worker \
  src/lib/private-address.ts tests/private-address.test.mjs \
  tests/private-balance-receive.test.mjs tests/private-balance-worker-isolation.test.mjs
git commit -m "feat: shorten private payment addresses"
```

### Task 2: Derive outgoing viewing keys and fixed outgoing ciphertexts

**Files:**
- Modify: `protocol/private-balance/packages/browser/src/keys.ts`
- Modify: `protocol/private-balance/packages/browser/src/encoding.ts`
- Modify: `protocol/private-balance/packages/browser/src/encryption.ts`
- Modify: `protocol/private-balance/packages/browser/test/vectors.test.mjs`
- Modify: `protocol/private-balance/crates/protocol/src/constants.rs`
- Modify: `protocol/private-balance/crates/protocol/src/keys.rs`
- Modify: `protocol/private-balance/crates/protocol/src/encoding.rs`
- Modify: `protocol/private-balance/crates/protocol/src/encryption.rs`
- Modify: `protocol/private-balance/crates/protocol/tests/keys.rs`
- Modify: `protocol/private-balance/crates/protocol/tests/encryption.rs`
- Modify: `protocol/private-balance/vectors/keys-v1.json`
- Modify: `protocol/private-balance/vectors/encryption-v1.json`

**Step 1: Write failing key-separation and recovery tests**

Assert deterministic but domain-separated incoming/outgoing keys, two fixed-size outgoing envelopes,
successful sender recovery of real and dummy outputs, AEAD failure after changing deployment, asset,
action nonce, lane, commitment, or ciphertext, and inability of the outgoing key to open recipient
envelopes or spend notes.

**Step 2: Verify red**

Run the browser vector tests and:

```bash
cargo test -p private-balance-protocol --test keys --test encryption
```

Expected: FAIL because no outgoing key/envelope exists.

**Step 3: Implement separated key derivation**

Add `DOMAIN_OVK = "SKSB_OVK_V1"`, derive a 32-byte outgoing viewing key from the privacy session
root and full key context, and include it only in `ExpandedSpendingKey`/`FullViewingKey` worker-side
structures. Define a versioned fixed plaintext and envelope. Seal with an AEAD key derived from
`ovk`, recipient ephemeral key material, and the complete output AAD; include a one-byte view tag
for bounded scanning.

**Step 4: Regenerate vectors, build, and verify green**

Run the conformance-vector generator, browser build/test, and Rust tests.

**Step 5: Commit**

```bash
git add protocol/private-balance/packages/browser protocol/private-balance/crates/protocol \
  protocol/private-balance/vectors/keys-v1.json protocol/private-balance/vectors/encryption-v1.json
git commit -m "feat: add outgoing private payment recovery"
```

### Task 3: Make the circuit fixed-shape and lane-private

**Files:**
- Modify: `protocol/private-balance/circuits/circom/action.circom`
- Modify: `protocol/private-balance/circuits/circom/nullifier.circom`
- Modify: `protocol/private-balance/circuits/circom/note.circom`
- Modify: `protocol/private-balance/circuits/test/action.circuit.test.mjs`
- Modify: `protocol/private-balance/crates/protocol/src/action.rs`
- Modify: `protocol/private-balance/crates/protocol/tests/action.rs`
- Modify: `protocol/private-balance/crates/test-support/src/model.rs`
- Modify: `protocol/private-balance/crates/test-support/tests/model_actions.rs`
- Modify: `protocol/private-balance/packages/browser/src/action.ts`
- Modify: `protocol/private-balance/packages/browser/test/protocol-v1.test.mjs`

**Step 1: Write failing circuit cases**

Add deposit, zero-change transfer, one-input transfer, two-input transfer, consolidation, and full
withdrawal cases. For each, run several input/output permutations and assert identical public
semantics with two nonzero nullifiers/commitments. Add negative cases for non-boolean selectors,
dummy nonzero value, real zero value, unconstrained dummy nullifier, skipped real membership,
duplicate lanes, and broken conservation.

**Step 2: Verify red against the current compiled circuit**

Run `npm --prefix protocol/private-balance/circuits test` and confirm the new cases fail for the
zero-lane/left-packed behavior.

**Step 3: Implement private selectors**

Replace public `inputEnabled`/`outputEnabled` semantics with private `inputReal[2]` and
`outputReal[2]` bits. Real inputs enable membership/nullifier constraints. Dummy inputs constrain
value to zero and derive a nonzero nullifier from dummy randomness and action context. Real outputs
must be positive; dummy outputs must be zero but still constrain a complete randomized commitment.
Reject duplicate public nullifiers and commitments inside the circuit.

**Step 4: Compile and run security gates**

Run:

```bash
npm --prefix protocol/private-balance/circuits run compile
npm --prefix protocol/private-balance/circuits run inspect:circomspect
npm --prefix protocol/private-balance/circuits run inspect:underconstraint
npm --prefix protocol/private-balance/circuits test
npm --prefix protocol/private-balance/circuits run test:mutation
```

**Step 5: Update Rust/TypeScript action models and verify green**

Keep public action width fixed; remove code paths that treat zero public fields as disabled lanes.
Run protocol, model, and browser package tests.

**Step 6: Commit**

```bash
git add protocol/private-balance/circuits/circom protocol/private-balance/circuits/test \
  protocol/private-balance/crates/protocol protocol/private-balance/crates/test-support \
  protocol/private-balance/packages/browser/src/action.ts \
  protocol/private-balance/packages/browser/test/protocol-v1.test.mjs
git commit -m "feat: hide private action lane roles"
```

### Task 4: Randomize builder lanes and create normal dummy outputs

**Files:**
- Modify: `src/features/private-balance/worker/action-builder.ts`
- Modify: `src/features/private-balance/worker/messages.ts`
- Modify: `src/features/private-balance/worker/private-balance.worker.ts`
- Modify: `src/features/private-balance/runtime/scanner.ts`
- Modify: `tests/private-balance-action-builder.test.mjs`
- Modify: `tests/private-balance-scanner.test.mjs`
- Modify: `tests/private-balance-worker.test.mjs`

**Step 1: Write failing builder/scanner tests**

Inject deterministic random bytes and assert both lane permutations occur, self outputs never reuse
the default/previous diversifier, every action has two nonzero output packages and nullifiers,
dummy ciphertexts have the normal width, and the scanner never credits a decrypted zero-value note.

**Step 2: Verify red**

Run the three test files directly with the root Node loader. Expected: FAIL on `ZERO_DIVERSIFIER`,
left-packed inputs, and zero output packages.

**Step 3: Implement minimal randomized construction**

Use Web Crypto through the existing worker randomness adapter. Apply an unbiased Fisher–Yates
shuffle independently to input and output specs. Generate a fresh dummy input secret and a fresh
throwaway X25519 recipient for every dummy output. Generate fresh nonzero four-byte diversifiers
for every self output. Never log or return real/dummy selectors outside the worker proof input.

**Step 4: Verify green and commit**

```bash
git add src/features/private-balance/worker src/features/private-balance/runtime/scanner.ts \
  tests/private-balance-action-builder.test.mjs tests/private-balance-scanner.test.mjs \
  tests/private-balance-worker.test.mjs
git commit -m "feat: randomize private action lanes"
```

### Task 5: Pin one asset per pool and catalogue deployment

**Files:**
- Modify: `protocol/private-balance/contracts/pool/src/storage.rs`
- Modify: `protocol/private-balance/contracts/pool/src/contract.rs`
- Modify: `protocol/private-balance/contracts/pool/src/action.rs`
- Modify: `protocol/private-balance/contracts/pool/src/token.rs`
- Modify: `protocol/private-balance/contracts/pool/tests/common/mod.rs`
- Modify: `protocol/private-balance/contracts/pool/tests/config.rs`
- Modify: `protocol/private-balance/contracts/pool/tests/deposit.rs`
- Modify: `protocol/private-balance/contracts/pool/tests/transfer.rs`
- Modify: `protocol/private-balance/contracts/pool/tests/withdraw.rs`
- Modify: `src/features/private-balance/runtime/transaction-builder.ts`
- Modify: `src/features/private-balance/runtime/transaction-review.ts`
- Modify: `src/lib/private-balance-assets.ts`
- Modify: `src/lib/private-balance-manifest.ts`
- Modify: `protocol/private-balance/scripts/generate-manifest.mjs`
- Modify: `protocol/private-balance/scripts/testnet-fixture.mjs`
- Modify: `protocol/private-balance/manifests/development.json`
- Modify: `protocol/private-balance/manifests/testnet.template.json`
- Modify: `tests/private-balance-assets.test.mjs`
- Modify: `tests/private-balance-manifest.test.mjs`
- Modify: `tests/private-balance-testnet-fixture.test.mjs`
- Modify: `tests/private-balance-transaction-builder.test.mjs`

**Step 1: Write failing contract and manifest tests**

Assert constructor storage contains the exact asset contract, all entrypoints omit an asset
argument, the context/public asset field derives only from the pinned asset, calls cannot redirect
token transfers, and each catalogue deployment contains exactly one asset.

**Step 2: Verify red**

Run pool config/deposit/transfer/withdraw tests and the four root tests above.

**Step 3: Implement asset pinning**

Add `DataKey::Asset` to immutable instance configuration. Constructor validates and stores it.
Deposit/withdraw create `TokenClient` only from stored state. Transfer reads the same pinned asset
field for public-signal validation. Remove `asset` from public entrypoint arguments, generated
bindings, transaction construction, and review parsing.

**Step 4: Split the catalogue and fixture**

Generate one pool deployment for XLM and one for USDC; derive unique pool IDs, bindings, cache
namespaces, and addresses. Do not add an on-chain factory.

**Step 5: Verify green and commit**

```bash
git add protocol/private-balance/contracts/pool src/features/private-balance/runtime \
  src/lib/private-balance-assets.ts src/lib/private-balance-manifest.ts \
  protocol/private-balance/scripts protocol/private-balance/manifests \
  tests/private-balance-assets.test.mjs tests/private-balance-manifest.test.mjs \
  tests/private-balance-testnet-fixture.test.mjs \
  tests/private-balance-transaction-builder.test.mjs
git commit -m "feat: isolate private pools by asset"
```

### Task 6: Extend archive records and recover outgoing history

**Files:**
- Modify: `protocol/private-balance/crates/protocol/src/archive.rs`
- Modify: `protocol/private-balance/crates/protocol/tests/archive.rs`
- Modify: `protocol/private-balance/contracts/pool/src/archive.rs`
- Modify: `protocol/private-balance/contracts/pool/tests/record_archive.rs`
- Modify: `protocol/private-balance/packages/browser/src/archive.ts`
- Modify: `protocol/private-balance/packages/browser/test/vectors.test.mjs`
- Modify: `src/features/private-balance/runtime/archive-client.ts`
- Modify: `src/features/private-balance/runtime/scanner.ts`
- Modify: `src/features/private-balance/runtime/types.ts`
- Modify: `tests/private-balance-archive-client.test.mjs`
- Modify: `tests/private-balance-scanner.test.mjs`
- Modify: `tests/private-balance-activity.test.mjs`

**Step 1: Write failing archive/recovery tests**

Assert two recipient and two outgoing envelopes are stored at fixed widths and covered by the
record hash chain. Recover sender recipient/value/memo after deleting local activity metadata;
ensure tampered or dummy outgoing plaintext cannot credit balance.

**Step 2: Verify red, implement fixed record schema, and verify green**

Update canonical encoders in Rust and TypeScript together, then update the contract record and RPC
parser. Scanner tries incoming recovery for balance and outgoing recovery only for historical
metadata. Regenerate archive/encryption vectors.

**Step 3: Commit**

```bash
git add protocol/private-balance/crates/protocol protocol/private-balance/contracts/pool \
  protocol/private-balance/packages/browser protocol/private-balance/vectors \
  src/features/private-balance/runtime tests/private-balance-archive-client.test.mjs \
  tests/private-balance-scanner.test.mjs tests/private-balance-activity.test.mjs
git commit -m "feat: recover outgoing private payment history"
```

### Task 7: Persist an authenticated incremental Merkle store

**Files:**
- Modify: `protocol/private-balance/packages/browser/src/tree.ts`
- Modify: `protocol/private-balance/packages/browser/test/frontier.test.mjs`
- Create: `src/features/private-balance/runtime/merkle-cache.ts`
- Modify: `src/features/private-balance/runtime/public-cache.ts`
- Modify: `src/features/private-balance/runtime/scanner.ts`
- Modify: `src/features/private-balance/runtime/sync-machine.ts`
- Modify: `src/features/private-balance/worker/action-builder.ts`
- Modify: `src/features/private-balance/worker/messages.ts`
- Modify: `tests/private-balance-frontier.test.mjs`
- Modify: `tests/private-balance-public-cache.test.mjs`
- Modify: `tests/private-balance-sync.test.mjs`
- Modify: `tests/private-balance-action-builder.test.mjs`

**Step 1: Write failing incremental/cache tests**

Generate randomized commitment sequences and compare incremental roots/paths with
`MerkleNodeStore.fromCommitments`. Persist, reload, and append without replaying old commitments.
Corrupt every checkpoint field and assert pool-local discard/rebuild. Instrument spend preparation
and assert it reads only selected paths rather than all commitments.

**Step 2: Verify red**

Run browser frontier plus the four root test files. Expected: FAIL because public cache stores
chunks but action builder reconstructs the full node store.

**Step 3: Implement transactional cache**

Store `{schema, deploymentHash, cursor, transcriptHead, commitmentCount, root, frontier, nodes}` in
the existing private-payment IndexedDB. Apply each verified archive record in one transaction.
Expose `append`, `root`, and `path(index)`; never expose owned-note identities in the public cache.
Bind the checkpoint to the archive hash chain and authenticated contract head.

**Step 4: Wire witness reads and verify green**

Pass exact selected paths to the worker instead of the commitment list. Retain one linear rebuild
path for missing/corrupt caches. Run randomized differential and 10k recovery gates.

**Step 5: Commit**

```bash
git add protocol/private-balance/packages/browser/src/tree.ts \
  protocol/private-balance/packages/browser/test/frontier.test.mjs \
  src/features/private-balance/runtime src/features/private-balance/worker \
  tests/private-balance-frontier.test.mjs tests/private-balance-public-cache.test.mjs \
  tests/private-balance-sync.test.mjs tests/private-balance-action-builder.test.mjs
git commit -m "perf: persist incremental private Merkle paths"
```

### Task 8: Batch exact archive restoration footprints

**Files:**
- Modify: `src/features/private-balance/runtime/archive-restoration.ts`
- Modify: `src/features/private-balance/runtime/provider.tsx`
- Modify: `src/features/private-balance/components/PrivateRecovery.tsx`
- Modify: `tests/private-archive-restoration.test.mjs`
- Modify: `tests/private-archive-gate.test.mjs`
- Modify: `tests/private-balance-recovery-ui.test.mjs`

**Step 1: Read the relevant Next 16 modal/Suspense guides**

Before touching the component, read the matching files under `node_modules/next/dist/docs/` and
keep the modal shell, focus ownership, inertness, and close behavior outside async boundaries.

**Step 2: Write failing batching tests**

Test largest-safe-prefix selection, resource overflow bisection, one-key fallback, exact local key
order, RPC footprint expansion rejection, confirmation/hash binding, partial progress resume, stale
simulation rejection, and intentional cancellation. Add modal identity/focus tests for progress
updates.

**Step 3: Verify red and implement**

Represent a batch as immutable exact ledger keys plus covered record indices. Grow exponentially,
then binary-search the last safe prefix using fresh simulation and explicit 80% resource margins.
The review signs exactly one selected batch at a time; confirmed batches advance the cursor.

**Step 4: Verify green and commit**

```bash
git add src/features/private-balance/runtime/archive-restoration.ts \
  src/features/private-balance/runtime/provider.tsx \
  src/features/private-balance/components/PrivateRecovery.tsx \
  tests/private-archive-restoration.test.mjs tests/private-archive-gate.test.mjs \
  tests/private-balance-recovery-ui.test.mjs
git commit -m "perf: batch private archive restoration"
```

### Task 9: Corroborate recovery checkpoints across RPCs

**Files:**
- Create: `src/features/private-balance/runtime/rpc-checkpoint.ts`
- Modify: `src/features/private-balance/runtime/archive-client.ts`
- Modify: `src/features/private-balance/runtime/sync-machine.ts`
- Modify: `src/features/private-balance/runtime/provider.tsx`
- Modify: `src/lib/private-balance-manifest.ts`
- Modify: `protocol/private-balance/scripts/generate-manifest.mjs`
- Modify: `src/features/private-balance/components/PrivateProtocolSettings.tsx`
- Modify: `src/features/private-balance/copy.ts`
- Modify: `tests/private-balance-archive-client.test.mjs`
- Modify: `tests/private-balance-sync.test.mjs`
- Modify: `tests/private-balance-settings.test.mjs`
- Modify: `tests/private-balance-manifest.test.mjs`

**Step 1: Write failing checkpoint tests**

Use two deterministic fake RPCs. Cover matching network/ledger/head, moving-head bounded retry,
wrong network, mismatched overlapping ledger hash, mismatched deployment checkpoint, mismatched
contract head, witness outage, and abort. Assert disagreement preserves the last authenticated
state and presents status unknown rather than zero/failed/confirmed.

**Step 2: Verify red and implement corroboration**

The primary remains the submitter. The witness is read-only. Compare network identity, a common
ledger `(sequence, hash)`, manifest-pinned deployment checkpoint, and a stable contract-head read.
Require corroboration for seed recovery; make ordinary-sync witness use explicit and privacy
disclosed. Never log contract queries or transaction hashes.

**Step 3: Verify green and commit**

```bash
git add src/features/private-balance/runtime src/features/private-balance/components \
  src/features/private-balance/copy.ts src/lib/private-balance-manifest.ts \
  protocol/private-balance/scripts/generate-manifest.mjs \
  tests/private-balance-archive-client.test.mjs tests/private-balance-sync.test.mjs \
  tests/private-balance-settings.test.mjs tests/private-balance-manifest.test.mjs
git commit -m "security: corroborate private recovery checkpoints"
```

### Task 10: Add BN254/BLS12-381 and browser-prover benchmarks

**Files:**
- Create: `protocol/private-balance/spikes/scripts/run-curve-benchmark.mjs`
- Create: `protocol/private-balance/spikes/browser/prover-bench.ts`
- Create: `protocol/private-balance/spikes/results/curve-benchmark.schema.json`
- Create: `protocol/private-balance/results/curve-benchmark.json`
- Modify: `protocol/private-balance/circuits/scripts/compile.mjs`
- Modify: `protocol/private-balance/docs/feasibility.md`
- Modify: `tests/private-balance-circuit-toolchain.test.mjs`
- Modify: `tests/private-recovery-gate.test.mjs`

**Step 1: Write failing harness/schema tests**

Assert the harness records curve, constraint count, proof/key sizes, p50/p95 proving, peak memory,
verification time, contract resources, transaction bytes, device/browser identity, SIMD/threads,
and whether the run is physical-device evidence. Reject fabricated empty or desktop-labelled phone
results.

**Step 2: Implement reproducible benchmark commands**

Compile the same circuit corpus for `bn128` and `bls12381` without changing production artifacts.
Run deterministic desktop smoke measurements and emit schema-valid provisional evidence. Leave
physical-phone rows explicitly pending; do not claim a winning curve without them.

**Step 3: Verify and commit**

```bash
git add protocol/private-balance/spikes protocol/private-balance/results/curve-benchmark.json \
  protocol/private-balance/circuits/scripts/compile.mjs \
  protocol/private-balance/docs/feasibility.md tests/private-balance-circuit-toolchain.test.mjs \
  tests/private-recovery-gate.test.mjs
git commit -m "bench: compare private proving curves"
```

### Task 11: Regenerate bound artifacts and replace Testnet deployment metadata

**Files:**
- Modify: `protocol/private-balance/circuits/build/**`
- Modify: `protocol/private-balance/crates/verifier/src/verifying_key.bin`
- Modify: `protocol/private-balance/contracts/pool/src/generated_artifacts.rs`
- Modify: `protocol/private-balance/vectors/proofs-v1.json`
- Modify: `protocol/private-balance/manifests/development.json`
- Modify: `protocol/private-balance/results/fixtures/*.json`
- Modify: `src/lib/private-balance-expected-manifest.ts`
- Modify: `src/lib/private-balance-expected-catalogue.ts`
- Modify: `public/private-balance/**`
- Modify: `tests/private-balance-artifacts.test.mjs`
- Modify: `tests/private-balance-release-gate.test.mjs`

**Step 1: Keep development setup quarantined**

Run the artifact generator with development-only entropy. Do not publish or relabel it as a
production ceremony. Generate new Wasm/VK/proofs/manifests/catalogue and two per-asset deployment
bindings. Old hashes and addresses must disappear from expected constants.

**Step 2: Run generated/reproducibility checks**

```bash
npm run private:generate
npm run private:check-generated
npm run private:check-reproducible
npm run private:gate-a
```

**Step 3: Run the non-mutating Testnet deployment plan**

Verify it proposes fresh pool contracts and never attempts migration or an upgrade of the retired
pool. Live deployment remains separately consent-gated by the existing fixture tooling.

**Step 4: Commit**

```bash
git add protocol/private-balance/circuits/build protocol/private-balance/crates/verifier \
  protocol/private-balance/contracts/pool/src/generated_artifacts.rs \
  protocol/private-balance/vectors protocol/private-balance/manifests \
  protocol/private-balance/results/fixtures src/lib/private-balance-expected-manifest.ts \
  src/lib/private-balance-expected-catalogue.ts public/private-balance \
  tests/private-balance-artifacts.test.mjs tests/private-balance-release-gate.test.mjs
git commit -m "build: regenerate private protocol artifacts"
```

### Task 12: Remove retired state, update product copy, and verify release

**Files:**
- Modify: `src/features/private-balance/runtime/storage.ts`
- Modify: `src/features/private-balance/runtime/public-cache.ts`
- Modify: `src/features/private-balance/runtime/backup.ts`
- Modify: `src/app/private/page.tsx`
- Modify: `docs/private-balance.md`
- Modify: `docs/private-balance-recovery.md`
- Modify: `protocol/private-balance/docs/protocol-v1.md`
- Modify: `protocol/private-balance/docs/encoding.md`
- Modify: `protocol/private-balance/docs/threat-model.md`
- Modify: `CHANGELOG.md`
- Modify: `tests/private-balance-docs.test.mjs`
- Modify: `tests/private-balance-backup.test.mjs`
- Modify: `tests/private-balance-vault.test.mjs`

**Step 1: Read relevant Next 16 docs before page changes**

Resolve and read the applicable guides under `node_modules/next/dist/docs/` before editing the App
Router page.

**Step 2: Write failing removal/copy tests**

Assert retired private state and caches are deleted without touching public wallet/merchant data,
old private backups are rejected rather than migrated, all copy uses the new prefixes and per-asset
pools, and no text calls the replacement V2 or promises cross-asset anonymity.

**Step 3: Implement removal and documentation**

Delete only known retired private IndexedDB/cache namespaces after replacement activation. Update
the `[Unreleased]` Added/Changed/Removed/Security sections factually. Document that Testnet balances
and old private addresses are intentionally lost, witness RPCs duplicate access-pattern exposure,
and development proving material remains unsafe for real value.

**Step 4: Run focused verification**

```bash
npm --prefix protocol/private-balance/packages/browser test
cargo test --workspace --manifest-path protocol/private-balance/Cargo.toml
npm run typecheck
npm test
npm run lint
npm run private:check-generated
```

**Step 5: Run full clean-worktree release verification**

Commit the final documentation/removal slice, ensure `git status --short` is empty, then run:

```bash
npm run release:verify
```

Record physical VoiceOver/NVDA and phone-prover checks separately; automation must not claim they
were performed.

**Step 6: Commit**

```bash
git add src/features/private-balance/runtime src/app/private/page.tsx docs \
  protocol/private-balance/docs CHANGELOG.md tests/private-balance-docs.test.mjs \
  tests/private-balance-backup.test.mjs tests/private-balance-vault.test.mjs
git commit -m "feat: replace testnet private payments protocol"
```
