# Private Balance Review Improvements Implementation Plan

> **For the implementing agent:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Validate the 2026-09-02 protocol review experimentally and ship only demonstrated, security-preserving improvements.

**Architecture:** Keep RFC 9180 DHKEM, replace the binary depth-32 commitment tree with a ternary depth-17 tree only if it crosses the 2^14 circuit threshold, share the tree primitive across Rust/contract/browser/Circom, and make sender recovery consume the already-paid outgoing ciphertext. Preserve one deposit replay key while reducing redundant storage.

**Tech Stack:** Circom 2.2.3, snarkjs Groth16/BN254, Rust 1.97.1, soroban-sdk/Stellar CLI 27, TypeScript, Node test runner, Playwright.

---

### Task 1: Record reproducible review-validation evidence

**Files:**
- Create: `protocol/private-balance/spikes/scripts/run-review-validation.mjs`
- Create: `protocol/private-balance/results/review-validation.json`
- Modify: `tests/private-balance-circuit-toolchain.test.mjs`

1. Add a failing test requiring a pinned review-validation schema, tool versions, baseline constraint count, benchmark sample counts, and an explicit decision for every numbered recommendation.
2. Run `node --test tests/private-balance-circuit-toolchain.test.mjs`; expect failure because evidence is absent.
3. Add a deterministic harness that measures warm native/portable X25519, diversification, current R1CS metadata, artifact sizes, and records security prerequisites separately from timings.
4. Run the harness at least three times; record median and p95, then run the focused test green.
5. Commit as `test: validate private protocol review measurements`.

### Task 2: Optimize native X25519 import

**Files:**
- Modify: `protocol/private-balance/packages/browser/src/x25519.ts`
- Modify: `protocol/private-balance/packages/browser/test/protocol-v1.test.mjs`
- Regenerate: `protocol/private-balance/packages/browser/dist/x25519.js`

1. Add a failing parity test for RFC 8410 PKCS#8 import against the portable X25519 result and low-order rejection.
2. Run the focused browser test and confirm the missing PKCS#8 behavior fails.
3. Add the fixed RFC 8410 X25519 PrivateKeyInfo prefix and import the raw 32-byte scalar as `pkcs8`; retain the portable fallback.
4. Run parity tests and the benchmark. Accept only if secrets are byte-identical and warm native median improves by at least 20% without worse p95.
5. Commit as `perf: avoid redundant X25519 public derivation`.

### Task 3: Validate and reduce circuit-only redundancy

**Files:**
- Modify: `protocol/private-balance/circuits/circom/nullifier.circom`
- Modify: `protocol/private-balance/circuits/circom/action.circom`
- Modify: `protocol/private-balance/packages/browser/src/note.ts`
- Modify: `src/features/private-balance/worker/action-builder.ts`
- Modify: `protocol/private-balance/circuits/test/action.circuit.test.mjs`
- Modify: `tests/private-balance-action-builder.test.mjs`

1. Add failing tests for lane-free dummy-nullifier parity, derived output reality, and one total range check.
2. Confirm failures against the current four-input dummy hash and explicit `outputReal` witness.
3. Remove the dummy lane from every implementation, derive `outputReal` from value-zero checks, and remove the redundant total-output range decomposition while retaining equality.
4. Compile with `--O2`; accept only if the measured count matches the predicted reduction and all negative/mutation tests remain effective.
5. Commit as `perf: remove redundant private circuit witnesses`.

### Task 4: Implement and prove the ternary depth-17 tree

**Files:**
- Modify: `protocol/private-balance/circuits/circom/merkle.circom`
- Modify: `protocol/private-balance/circuits/circom/action.circom`
- Modify: `protocol/private-balance/crates/protocol/src/constants.rs`
- Modify: `protocol/private-balance/crates/protocol/src/poseidon2.rs`
- Modify: `protocol/private-balance/crates/protocol/src/tree.rs`
- Modify: `protocol/private-balance/crates/protocol/tests/tree.rs`
- Modify: `protocol/private-balance/packages/browser/src/poseidon2.ts`
- Modify: `protocol/private-balance/packages/browser/src/tree.ts`
- Modify: `protocol/private-balance/packages/browser/test/protocol-v1.test.mjs`
- Modify: `src/features/private-balance/runtime/merkle-cache.ts`
- Modify: `tests/private-balance-merkle-cache.test.mjs`

1. Change existing tree tests first to require depth 17, arity 3, two siblings per level, trit positions, 3^17 capacity, and fixed cross-language roots; verify red.
2. Add a raw three-input Poseidon2 tree-node function and document that the sponge length IV supplies separation while children remain commitment/tree outputs.
3. Implement Rust and browser ternary root/path/frontier logic with two partial frontier nodes per level.
4. Implement Circom ternary path selection with trit constraints and base-3 leaf-index reconstruction.
5. Compile R1CS. Accept only if public inputs remain 13, constraints are below 16,384, and Rust/browser/Circom vectors match.
6. Run focused tree, circuit, cache, mutation, and 100k model tests.
7. Commit as `feat: use a ternary private commitment tree`.

### Task 5: Move the contract to the shared tree rule and retain deposit replay protection

**Files:**
- Modify: `protocol/private-balance/contracts/pool/src/storage.rs`
- Modify: `protocol/private-balance/contracts/pool/src/contract.rs`
- Modify: `protocol/private-balance/contracts/pool/src/action.rs`
- Modify: `protocol/private-balance/contracts/pool/tests/deposit.rs`
- Modify: `protocol/private-balance/contracts/pool/tests/transfer.rs`
- Modify: `protocol/private-balance/contracts/pool/tests/withdraw.rs`
- Modify: `protocol/private-balance/contracts/pool/tests/config.rs`

1. Add failing contract tests for ternary frontier roots, constructor arity binding, a single stored deposit replay key, and rejection when that key is reused.
2. Replace the contract-local string-literal hash with the protocol crate’s shared ternary node function.
3. Store two frontier children per level and use checked base-3 capacity arithmetic.
4. Check and mark only nullifier 0 for deposits; keep both nullifiers for transfers/withdrawals so input-count privacy is unchanged.
5. Assert exact auth, storage, events, and resource estimates in focused tests.
6. Commit as `perf: reduce private pool tree and deposit storage`.

### Task 6: Recover sender history from outgoing envelopes

**Files:**
- Modify: `src/features/private-balance/runtime/scanner.ts`
- Modify: `src/features/private-balance/runtime/types.ts`
- Modify: `tests/private-balance-scanner.test.mjs`
- Modify: `tests/private-balance-backup.test.mjs`

1. Add a failing seed-recovery test where recipient decryption fails but the sender OVK opens a real output and reconstructs the exact recipient private address, value, and memo.
2. Add negative tests for dummy outputs, forged AAD, and unrelated OVKs.
3. Open outgoing envelopes after recipient attempts, validate the decoded plaintext against commitment/context, and record sender metadata without importing the output as an owned note.
4. Ensure activity classification does not double-count self-change or self-transfers.
5. Run scanner, backup, sync, and recovery tests.
6. Commit as `feat: recover private outgoing history from seed`.

### Task 7: Remove misleading branches and document protocol boundaries

**Files:**
- Modify: `src/features/private-balance/runtime/scanner.ts`
- Modify: `protocol/private-balance/docs/protocol-v1.md`
- Modify: `protocol/private-balance/docs/threat-model.md`
- Modify: `protocol/private-balance/README.md`
- Modify: `docs/private-balance.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/private-balance-protocol-review-2026-09-02.md`

1. Add failing documentation tests requiring the exact circuit statement, ternary hash tradeoff, dummy-lane rules, archive restoration cost/liveness, note-encryption griefing boundary, and deferred custom-KEM decision.
2. Remove only zero-slot branches proven unreachable by circuit and contract validation.
3. Expand the protocol and threat-model documentation and append measured decisions to the review.
4. Add factual `[Unreleased]` Changed/Security entries.
5. Commit as `docs: specify private protocol invariants and review decisions`.

### Task 8: Regenerate and redeploy the breaking Testnet protocol

**Files:**
- Regenerate: `protocol/private-balance/circuits/build/**`
- Regenerate: `protocol/private-balance/crates/verifier/src/verifying_key.bin`
- Regenerate: `protocol/private-balance/contracts/pool/src/generated_artifacts.rs`
- Regenerate: `protocol/private-balance/vectors/**`
- Regenerate: `public/protocol/private-balance/v1/**`
- Regenerate: `protocol/private-balance/manifests/development.json`
- Regenerate: `protocol/private-balance/results/fixtures/**`
- Modify: `protocol/private-balance/results/review-validation.json`

1. Run `npm run private:generate` with pinned Circom and Stellar CLI versions.
2. Verify the R1CS uses a 2^14 domain and record raw/compressed proving-key sizes.
3. Run proof-vector and mutation verification before deployment.
4. Deploy fresh per-asset XLM and USDC pools to Testnet and capture exact checkpoint/config evidence.
5. Regenerate catalogue/manifests and run static tamper tests.
6. Run `npm run private:check-reproducible` and the explicit 100k Gate B model.
7. Commit as `build: publish optimized private testnet protocol`.

### Task 9: Final verification and planning cleanup

**Files:**
- Remove: `docs/plans/2026-09-02-private-balance-review-design.md`
- Remove: `docs/plans/2026-09-02-private-balance-review.md`

1. Run `cargo +1.97.1 test --workspace --locked` in `protocol/private-balance`.
2. Run browser-package tests, circuit tests, proof/mutation gates, and reproducibility checks.
3. Run `npm run release:verify` from a clean worktree.
4. Remove completed planning scaffolds because the repository release gate forbids committed plans; retain review and evidence.
5. Commit as `chore: remove completed private protocol plans`.
6. Re-run `npm run release:verify` from the exact final commit and report measured outcomes, rejected hypotheses, Testnet deployment IDs, and manual gates.
