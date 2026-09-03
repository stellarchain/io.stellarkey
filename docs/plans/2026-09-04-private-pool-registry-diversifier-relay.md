# Private Pool Registry, Diversifier, and Peer Relay Implementation Plan

> **For the implementing agent:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the two asset-pinned testnet pools with one administrator-curated asset-private pool, remove the measured lane-role diversifier fingerprint, and add explicit optional frontend-only peer-relayed submission.

**Architecture:** Keep one append-only on-chain asset registry and one shielded tree. Bind a private per-action asset field in a three-output Groth16 circuit, expose the registry asset only at deposit/withdraw boundaries, and encode the immutable registry index inside both encrypted plaintexts. Use a third private output as the peer fee and a lazy, encrypted Nostr transport for optional browser-to-browser submission; direct submission remains an explicit alternative.

**Tech Stack:** Rust/Soroban SDK 25, Circom 2.1.6, Groth16/snarkjs, TypeScript, Web Worker, React 19, Next.js static export, Stellar SDK, Nostr WebSocket transport, Node test runner, Playwright.

---

### Task 1: Replace the canonical action and plaintext models

**Files:**
- Modify: `protocol/private-balance/packages/browser/src/action.ts`
- Modify: `protocol/private-balance/packages/browser/src/note.ts`
- Modify: `protocol/private-balance/packages/browser/src/encoding.ts`
- Modify: `protocol/private-balance/packages/browser/src/encryption.ts`
- Modify: `protocol/private-balance/packages/browser/src/archive.ts`
- Test: `protocol/private-balance/packages/browser/test/protocol-v1.test.mjs`
- Test: `protocol/private-balance/packages/browser/test/multiasset.test.mjs`
- Test: `protocol/private-balance/packages/browser/test/vectors.test.mjs`

**Step 1: Write failing model tests**

Add tests requiring:

- exactly three output packages;
- no public `relayer` or `relayerFee` fields;
- an optional boundary asset and `assetIndex` for deposit/withdraw only;
- a zero public asset field for internal transfers;
- a four-byte big-endian asset index in recipient and outgoing plaintext;
- output indices `0`, `1`, and `2` in both AAD functions; and
- an optional archive asset/index only for public boundaries.

**Step 2: Run the focused package tests and verify RED**

Run: `npm --prefix protocol/private-balance/packages/browser test`

Expected: failures describing the old two-output, public-relayer, and zero-reserved-byte models.

**Step 3: Implement the new canonical types**

Use these invariants:

```ts
type AssetBoundary = {
  index: number;
  asset: { kind: 1; payload: Uint8Array };
};

interface ActionModel {
  outputs: [OutputPackageModel, OutputPackageModel, OutputPackageModel];
  asset?: AssetBoundary;
  // no relayer or relayerFee
}
```

Keep protocol version `1` as requested; this testnet migration replaces that
version rather than introducing a compatibility version. Preserve the 128-byte
plaintext sizes by changing `reserved: Uint8Array(15)` to `assetIndex: u32`
plus `reserved: Uint8Array(11)`. Do not change the 181-byte recipient envelope.

**Step 4: Run the focused tests and verify GREEN**

Run: `npm --prefix protocol/private-balance/packages/browser test`

Expected: all package tests pass.

**Step 5: Commit**

```bash
git add protocol/private-balance/packages/browser
git commit -m "feat: define asset-private three-output actions"
```

### Task 2: Change the circuit with mutation coverage

**Files:**
- Modify: `protocol/private-balance/circuits/circom/action.circom`
- Modify: `protocol/private-balance/circuits/test/action.circuit.test.mjs`
- Modify: `protocol/private-balance/circuits/scripts/run-mutation-tests.mjs`
- Modify: `protocol/private-balance/circuits/scripts/inspect-constraints.mjs`
- Modify: `protocol/private-balance/scripts/generate-proof-vectors.mjs`

**Step 1: Write failing circuit-shape and mutation tests**

Require a private nonzero `actionAssetField`, three output witnesses and public
commitments, no `relayerFeeField`, and these equations:

```text
transfer: public assetField = 0
deposit/withdraw: public assetField = actionAssetField
every input/output note: note.assetField = actionAssetField
sum(inputs) + deposit = sum(three outputs) + withdrawal
```

Add negative witnesses for cross-asset inputs, boundary asset mismatch, zero
private asset, transfer leaking a nonzero public asset, and mutation of output 2.

**Step 2: Compile only and verify RED**

Run: `npm --prefix protocol/private-balance/circuits run compile`

Run: `npm --prefix protocol/private-balance/circuits test`

Expected: new shape/mutation tests fail against the old circuit.

**Step 3: Implement the minimal circuit**

Generalize output arrays and duplicate-commitment checks to three lanes. Keep
two input lanes and depth 17. Replace the public relayer fee with the third
output in the public signal list so the public-input count remains 11.

**Step 4: Regenerate the development proving key and inspect constraints**

Run: `npm --prefix protocol/private-balance/circuits run setup:dev`

Run: `npm --prefix protocol/private-balance/circuits run inspect:constraints`

Expected: constraints stay below 16,384 and public inputs equal 11. Record the
exact measured count in `inspect-constraints.mjs`; do not copy the spike estimate.

**Step 5: Run circuit tests and mutation tests**

Run: `npm --prefix protocol/private-balance/circuits test`

Run: `npm --prefix protocol/private-balance/circuits run test:mutation`

Expected: all pass.

**Step 6: Commit**

```bash
git add protocol/private-balance/circuits protocol/private-balance/scripts/generate-proof-vectors.mjs
git commit -m "feat: prove hidden assets with three outputs"
```

### Task 3: Update the shared Rust protocol and cross-language vectors

**Files:**
- Modify: `protocol/private-balance/crates/protocol/src/action.rs`
- Modify: `protocol/private-balance/crates/protocol/src/archive.rs`
- Modify: `protocol/private-balance/crates/protocol/src/encryption.rs`
- Modify: `protocol/private-balance/crates/protocol/src/encoding.rs`
- Modify: `protocol/private-balance/crates/test-support/src/model.rs`
- Modify: `protocol/private-balance/crates/test-support/src/recovery.rs`
- Modify: `protocol/private-balance/crates/test-support/tests/model_actions.rs`
- Modify: `protocol/private-balance/scripts/generate-conformance-vectors.mjs`
- Modify: `protocol/private-balance/vectors/*.json`

**Step 1: Write failing Rust tests**

Test all three action kinds, three distinct outputs, hidden transfer assets,
boundary asset/index encoding, private fee conservation as an ordinary output,
and mixed-asset recovery. Add cross-asset mutation tests.

**Step 2: Verify RED**

Run: `cargo test --manifest-path protocol/private-balance/Cargo.toml -p private-balance-protocol -p private-balance-test-support`

Expected: compile or assertion failures caused by the old action/archive shape.

**Step 3: Implement matching Rust serialization**

Mirror the TypeScript byte order exactly. Reject a transfer carrying a public
asset and reject a deposit/withdraw without a canonical asset/index.

**Step 4: Regenerate and verify vectors**

Run: `node protocol/private-balance/scripts/generate-conformance-vectors.mjs`

Run: `node protocol/private-balance/scripts/generate-proof-vectors.mjs`

Run: `npm --prefix protocol/private-balance/packages/browser test`

Run: `node protocol/private-balance/scripts/verify-proof-vectors.mjs`

Expected: JavaScript and Rust agree on every canonical hash/public signal.

**Step 5: Commit**

```bash
git add protocol/private-balance/crates protocol/private-balance/scripts protocol/private-balance/vectors
git commit -m "feat: bind asset-private actions across protocol models"
```

### Task 4: Add the append-only asset registry and ExitOnly contract state

**Files:**
- Modify: `protocol/private-balance/contracts/pool/src/storage.rs`
- Modify: `protocol/private-balance/contracts/pool/src/errors.rs`
- Modify: `protocol/private-balance/contracts/pool/src/events.rs`
- Modify: `protocol/private-balance/contracts/pool/src/action.rs`
- Modify: `protocol/private-balance/contracts/pool/src/archive.rs`
- Modify: `protocol/private-balance/contracts/pool/src/contract.rs`
- Modify: `protocol/private-balance/contracts/pool/tests/config.rs`
- Create: `protocol/private-balance/contracts/pool/tests/asset_registry.rs`
- Modify: `protocol/private-balance/contracts/pool/tests/deposit.rs`
- Modify: `protocol/private-balance/contracts/pool/tests/transfer.rs`
- Modify: `protocol/private-balance/contracts/pool/tests/withdraw.rs`

**Step 1: Write failing contract tests**

Cover:

- constructor stores one asset administrator and no pinned asset;
- only that address can add or change assets;
- duplicate SACs fail and indices never move or get reused;
- `Active -> ExitOnly -> Active` changes deposit eligibility;
- ExitOnly still allows withdrawals;
- internal transfer touches no asset registry entry or SAC;
- boundary actions resolve the exact public index/address;
- a cross-asset proof/action is rejected;
- two-step admin transfer requires old-admin proposal and new-admin acceptance;
- tree index advances by exactly three leaves per action; and
- all action/archive writes roll back if token movement fails.

**Step 2: Verify RED**

Run: `cargo test --manifest-path protocol/private-balance/Cargo.toml -p private-balance-pool`

Expected: missing registry types/methods and old pinned-asset assertions.

**Step 3: Implement storage and methods**

Add `AssetStatus::{Active, ExitOnly}`, `AssetConfig`, append-only registry
storage, reverse lookup, TTL extension, and events. Add:

```rust
add_asset(env, asset) -> u32
set_asset_status(env, index, status)
asset_count(env) -> u32
asset(env, index) -> AssetConfig
asset_index(env, asset) -> Option<u32>
propose_asset_admin(env, next)
accept_asset_admin(env)
```

Do not add asset deletion or index reassignment. Deposit requires `Active`;
withdraw accepts either state. Transfer does not read an asset entry.

**Step 4: Implement three-output execution/archive**

Remove public relayer storage and token payout. Append and archive three output
packages. Store boundary asset/index as optional fields and omit them for
private transfers.

**Step 5: Verify GREEN and snapshot changes**

Run: `cargo test --manifest-path protocol/private-balance/Cargo.toml -p private-balance-pool`

Expected: all pool tests pass with reviewed snapshot diffs.

**Step 6: Commit**

```bash
git add protocol/private-balance/contracts/pool
git commit -m "feat: add governed private asset registry"
```

### Task 6: Regenerate verifier, contract client, and release artifacts

**Files:**
- Modify: `protocol/private-balance/contracts/pool/src/generated_artifacts.rs`
- Modify: `protocol/private-balance/crates/verifier/src/verifying_key.bin`
- Modify: `protocol/private-balance/crates/verifier/src/vk.rs`
- Modify: `protocol/private-balance/generated/pool-client/**`
- Modify: `public/protocol/private-balance/v1/circuit.wasm`
- Modify: `public/protocol/private-balance/v1/circuit.zkey`
- Modify: `public/protocol/private-balance/v1/circuit.zkey.pc`
- Modify: `public/protocol/private-balance/v1/verification-key.json`
- Modify: `public/protocol/private-balance/v1/pool.wasm`

**Step 1: Add failing generated-artifact assertions**

Update `tests/private-balance-artifacts.test.mjs` and
`tests/private-balance-circuit-toolchain.test.mjs` to require three outputs,
the new exact constraints, and matching verifier hashes.

**Step 2: Verify RED**

Run: `node --no-warnings --experimental-strip-types --loader ./tests/ts-resolve-loader.mjs --test tests/private-balance-artifacts.test.mjs tests/private-balance-circuit-toolchain.test.mjs`

Expected: old hashes/shapes fail.

**Step 3: Generate artifacts through repository scripts**

Run: `npm run private:generate`

Do not hand-edit generated clients, verifier bytes, WASM, zkey, or manifests.

**Step 4: Verify reproducibility**

Run: `npm run private:check-generated`

Run: `npm run private:check-reproducible`

Expected: both pass.

**Step 5: Commit**

```bash
git add protocol/private-balance/generated protocol/private-balance/contracts/pool/src/generated_artifacts.rs protocol/private-balance/crates/verifier public/protocol/private-balance/v1
git commit -m "build: regenerate private pool artifacts"
```

### Task 5: Replace the per-asset manifest catalogue

**Files:**
- Modify: `protocol/private-balance/manifests/development.json`
- Modify: `protocol/private-balance/manifests/testnet.template.json`
- Modify: `protocol/private-balance/scripts/testnet-fixture.mjs`
- Modify: `protocol/private-balance/scripts/run-testnet-e2e.mjs`
- Modify: `protocol/private-balance/scripts/generate-manifest.mjs`
- Modify: `src/lib/private-balance-manifest.ts`
- Modify: `src/lib/private-balance-expected-manifest.ts`
- Modify: `src/lib/private-balance-expected-catalogue.ts`
- Modify: `src/lib/private-balance-assets.ts`
- Test: `tests/private-balance-manifest.test.mjs`
- Test: `tests/private-balance-assets.test.mjs`
- Test: `tests/private-balance-runtime-selection.test.mjs`

**Step 1: Write failing manifest/runtime tests**

Require one pool deployment, one `assetAdminAddress`, one registry checkpoint,
and a metadata array keyed by immutable on-chain index. Reject duplicate or
non-contiguous initial indices and any manifest claiming admission authority.

**Step 2: Verify RED**

Run the three focused tests above with the root test command.

Expected: old two-manifest catalogue assumptions fail.

**Step 3: Implement the single-pool schema**

Treat on-chain registry state as authoritative. Keep manifest assets as curated
display metadata only. Make unknown admitted SACs display a bounded contract
fingerprint until client-side SEP-41 metadata resolves.

**Step 4: Verify GREEN**

Run the focused tests again.

Expected: all pass.

**Step 5: Commit**

```bash
git add protocol/private-balance/manifests protocol/private-balance/scripts src/lib tests/private-balance-manifest.test.mjs tests/private-balance-assets.test.mjs tests/private-balance-runtime-selection.test.mjs
git commit -m "feat: load one on-chain private asset registry"
```

### Task 7: Build mixed-asset actions and match output diversifiers

**Files:**
- Modify: `src/features/private-balance/worker/messages.ts`
- Modify: `src/features/private-balance/worker/client.ts`
- Modify: `src/features/private-balance/worker/action-builder.ts`
- Modify: `src/features/private-balance/worker/private-balance.worker.ts`
- Modify: `src/features/private-balance/runtime/coin-selection.ts`
- Test: `tests/private-balance-action-builder.test.mjs`
- Test: `tests/private-balance-worker.test.mjs`
- Test: `tests/private-balance-coin-selection.test.mjs`

**Step 1: Write failing worker tests**

Require:

- note selection filtered by immutable asset index;
- hidden transfer public asset sentinel;
- three randomized output lanes;
- recipient, change, dummy, and relay outputs all carrying the same clear
  diversifier for one action;
- a peer payout address derived for a supplied action diversifier;
- direct submission producing no positive relay fee note; and
- relayed submission conserving value with exactly one positive peer fee note.

**Step 2: Verify RED**

Run the three focused root tests.

Expected: old per-asset/two-output behavior fails.

**Step 3: Implement the builder**

Replace `relayerFee`/`relayer` intents with an optional validated peer fee
recipient and amount. Randomize all three lane positions after constructing
semantic outputs. Reuse one action diversifier while deriving each owner/HPKE
key from its own wallet key material. Keep every key check inside the worker.

**Step 4: Verify GREEN**

Run focused tests and `npm run typecheck`.

Expected: pass.

**Step 5: Commit**

```bash
git add src/features/private-balance/worker src/features/private-balance/runtime/coin-selection.ts tests/private-balance-action-builder.test.mjs tests/private-balance-worker.test.mjs tests/private-balance-coin-selection.test.mjs
git commit -m "feat: build matched-diversifier multi-asset proofs"
```

### Task 8: Scan and persist one mixed-asset history

**Files:**
- Modify: `src/features/private-balance/runtime/archive-client.ts`
- Modify: `src/features/private-balance/runtime/scanner.ts`
- Modify: `src/features/private-balance/runtime/storage.ts`
- Modify: `src/features/private-balance/runtime/types.ts`
- Modify: `src/features/private-balance/runtime/portfolio.ts`
- Modify: `src/features/private-balance/runtime/publication.ts`
- Modify: `src/features/private-balance/runtime/provider.tsx`
- Test: `tests/private-balance-archive-client.test.mjs`
- Test: `tests/private-balance-scanner.test.mjs`
- Test: `tests/private-balance-storage.test.mjs`
- Test: `tests/private-balance-sync.test.mjs`
- Test: `tests/private-balance-activity.test.mjs`

**Step 1: Write failing recovery tests**

Scan an interleaved XLM/USDC transcript containing incoming and outgoing
transfer records with no public asset. Recover the encrypted asset index,
resolve it against registry state, verify the full commitment, and partition
balances/activity correctly. Reject unknown indices, mismatched fields, and
registry rewrites.

**Step 2: Verify RED**

Run the five focused tests.

Expected: old archive parsing and asset-pinned storage fail.

**Step 3: Implement one runtime and one scan**

Persist registry snapshots by pool and index, but refresh the authenticated
on-chain state. Store notes with asset index and SAC identity. Never send note
data, addresses, amounts, proof inputs, XDR, or hashes to telemetry/logging.

**Step 4: Verify GREEN**

Run focused tests and typecheck.

Expected: pass.

**Step 5: Commit**

```bash
git add src/features/private-balance/runtime tests/private-balance-{archive-client,scanner,storage,sync,activity}.test.mjs
git commit -m "feat: recover mixed private asset history"
```

### Task 9: Update transaction building and explicit direct submission

**Files:**
- Modify: `src/features/private-balance/runtime/transaction-builder.ts`
- Modify: `src/features/private-balance/runtime/action-transaction.ts`
- Modify: `src/features/private-balance/runtime/action-flow.ts`
- Modify: `src/features/private-balance/runtime/transaction-review.ts`
- Test: `tests/private-balance-transaction-builder.test.mjs`
- Test: `tests/private-balance-transaction-review.test.mjs`
- Test: `tests/private-balance-submission.test.mjs`

**Step 1: Write failing transaction tests**

Require `asset_index` only on deposit/withdraw calls, three output packages,
no relayer arguments, and no user authorization for transfer/withdraw contract
calls. Verify direct submission uses the user's source only after explicit
selection and preserves every preparing/signing/submitting/pending state.

**Step 2: Verify RED**

Run the focused tests.

Expected: old ABI and automatic direct path fail.

**Step 3: Implement new ABI and state transitions**

Remove the pool-address relayer sentinel. Keep deposit source authorization.
Do not represent RPC `PENDING`, timeout, or Horizon acceptance as confirmation.

**Step 4: Verify GREEN**

Run focused tests and typecheck.

Expected: pass.

**Step 5: Commit**

```bash
git add src/features/private-balance/runtime tests/private-balance-transaction-builder.test.mjs tests/private-balance-transaction-review.test.mjs tests/private-balance-submission.test.mjs
git commit -m "feat: submit unified private pool actions"
```

### Task 10: Implement and benchmark the bounded gossip/relay protocol

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/features/private-balance/relay/protocol.ts`
- Create: `src/features/private-balance/relay/crypto.ts`
- Create: `src/features/private-balance/relay/transport.ts`
- Create: `src/features/private-balance/relay/nostr.ts`
- Create: `src/features/private-balance/relay/session.ts`
- Create: `scripts/measure-private-relay.mjs`
- Create: `tests/private-balance-relay-protocol.test.mjs`
- Create: `tests/private-balance-relay-transport.test.mjs`

**Step 1: Write failing pure protocol tests**

Test canonical request/quote/prepare/job/status encodings, hard byte limits,
expiry, network/pool binding, unique nonces, replay rejection, authenticated
encryption, peer payout derivation for the requested diversifier, and redacted
errors. Ensure no sender Stellar address field exists.

**Step 2: Verify RED**

Run the two focused relay tests.

Expected: missing protocol/transport modules.

**Step 3: Add the smallest reviewed Nostr dependency**

Use a pinned package version with signed ephemeral events and NIP-44 v2 for
peer messages. Lazy import it only after explicit relay intent. Update the CSP
only for user-configured `wss:` connections; do not add a StellarKey endpoint.

**Step 4: Implement bounded transport and session state**

Require at least two configurable independent relay URLs for the recommended
mode. Treat relays and peers as untrusted. Close sockets, timers, and pending
promises on cancellation, lock, account switch, network switch, or component
unmount. Never persist job payloads or gossip private keys.

**Step 5: Benchmark before accepting**

Run: `node scripts/measure-private-relay.mjs`

Record local encode/encrypt/decrypt p50/p95, maximum job size, and socket
cleanup. Reject the transport implementation if encrypted payload size exceeds
configured Nostr event limits or local crypto exceeds the documented budget.

**Step 6: Verify GREEN**

Run focused tests, typecheck, lint, and `npm audit --omit=dev --audit-level=high`.

Expected: tests/typecheck/lint pass; dependency posture is no worse than the
recorded baseline, or the dependency is removed and a smaller implementation
is used.

**Step 7: Commit**

```bash
git add package.json package-lock.json src/features/private-balance/relay scripts/measure-private-relay.mjs tests/private-balance-relay-*.test.mjs
git commit -m "feat: add encrypted browser peer relay protocol"
```

### Task 11: Add relay sender/helper UX without destabilizing overlays

**Files:**
- Create: `src/features/private-balance/components/PrivateRelaySettings.tsx`
- Create: `src/features/private-balance/components/PrivateRelayQuotePanel.tsx`
- Create: `src/features/private-balance/components/PrivateRelayInbox.tsx`
- Modify: `src/features/private-balance/components/PrivateProtocolSettings.tsx`
- Modify: `src/features/private-balance/components/SendPrivate.tsx`
- Modify: `src/features/private-balance/components/WithdrawPrivate.tsx`
- Modify: `src/features/private-balance/components/PrivateActionReview.tsx`
- Modify: `src/features/private-balance/components/PrivateSubmissionStatus.tsx`
- Modify: `src/features/private-balance/runtime/provider.tsx`
- Test: `tests/private-balance-relay-ui.test.mjs`
- Test: `tests/private-balance-ui.test.mjs`
- Test: `tests/private-balance-accessibility.test.mjs`
- Test: `e2e/overlay-contract.spec.ts`
- Create: `e2e/private-relay.spec.ts`

**Step 1: Write failing interaction tests**

Cover explicit relay intent, separate help-relay opt-in, direct privacy warning,
no silent fallback, quote expiry/staleness, peer rejection, retry requiring a
new proof, helper manual approval, focus/inertness/scroll lock, rapid switching,
cleanup, reduced motion, and iPhone WebKit.

**Step 2: Verify RED**

Run focused root tests.

Expected: missing UI and state.

**Step 3: Implement with existing primitives**

Keep Modal/Tabs shells, headings, close controls, focus ownership, and scroll
locks outside lazy boundaries. Lazy-load only the panel and Nostr client after
intent. Use shared `Modal`, `Tabs`, `Button`, motion tokens, and safe errors;
do not use `transition: all`.

**Step 4: Verify GREEN**

Run focused unit/accessibility tests, then:

`E2E_NEXT_DEV=1 playwright test e2e/overlay-contract.spec.ts e2e/private-relay.spec.ts --project=desktop-chromium --project=iphone-webkit`

Expected: pass.

**Step 5: Commit**

```bash
git add src/features/private-balance/components src/features/private-balance/runtime/provider.tsx tests/private-balance-relay-ui.test.mjs tests/private-balance-ui.test.mjs tests/private-balance-accessibility.test.mjs e2e
git commit -m "feat: add optional private relay experience"
```

### Task 12: Add the asset administrator interface

**Files:**
- Create: `src/features/private-balance/components/PrivateAssetRegistryAdmin.tsx`
- Modify: `src/features/private-balance/components/PrivateProtocolSettings.tsx`
- Modify: `src/features/private-balance/components/PrivateAssetSelector.tsx`
- Modify: `src/features/private-balance/components/AddPrivateFunds.tsx`
- Modify: `src/features/private-balance/components/PrivateBalanceAssetRow.tsx`
- Test: `tests/private-balance-admin.test.mjs`
- Test: `tests/private-balance-ui.test.mjs`
- Test: `tests/private-balance-accessibility.test.mjs`

**Step 1: Write failing UI/security tests**

Require the controls only when the connected account equals the on-chain admin,
full SAC identity review, explicit signing, `ExitOnly` wording, no delete
control, disabled deposits for exit-only assets, and available withdrawals.

**Step 2: Verify RED**

Run focused tests.

Expected: missing admin panel and state labels.

**Step 3: Implement the interface**

Use shared interaction primitives. Resolve metadata client-side but make the
review show the full contract ID. Keep request/signing/pending/confirmed states
distinct and block double submission.

**Step 4: Verify GREEN**

Run focused tests, typecheck, and accessibility checks.

Expected: pass.

**Step 5: Commit**

```bash
git add src/features/private-balance/components tests/private-balance-admin.test.mjs tests/private-balance-ui.test.mjs tests/private-balance-accessibility.test.mjs
git commit -m "feat: manage private assets on chain"
```

### Task 13: Update roadmap, whitepaper, operations, and changelog

**Files:**
- Modify: `docs/private-balance-roadmap.md`
- Modify: `docs/private-balance.md`
- Modify: `docs/private-balance-recovery.md`
- Modify: `docs/production-deployment.md`
- Modify: `docs/private-balance-support.md`
- Modify: `SECURITY.md`
- Modify: `README.md`
- Modify: `src/app/private/page.tsx`
- Modify: `src/components/marketing/LandingBody.tsx`
- Modify: `CHANGELOG.md`
- Test: `tests/private-balance-docs.test.mjs`
- Test: `tests/private-balance-release-gate.test.mjs`

**Step 1: Write failing documentation assertions**

Require accurate statements for one mutable-admin registry, ExitOnly semantics,
hidden transfer assets, three output lanes, matched clear diversifiers, optional
public gossip relays, direct-submission disclosure, peer metadata, selected-peer
reproofing, and testnet-only development setup.

**Step 2: Verify RED**

Run the two focused tests.

Expected: old per-asset and no-relayer text fails.

**Step 3: Update every public statement**

State explicitly that StellarKey operates no relay/backend and that configured
Nostr relays are third-party servers. Do not call the system 100% private. Mark
roadmap items complete only for behavior verified in this branch. Add factual
`[Unreleased]` entries under Added, Changed, Security, and Removed as applicable.

**Step 4: Verify GREEN**

Run focused tests.

Expected: pass.

**Step 5: Commit**

```bash
git add docs README.md SECURITY.md src/app/private/page.tsx src/components/marketing/LandingBody.tsx CHANGELOG.md tests/private-balance-docs.test.mjs tests/private-balance-release-gate.test.mjs
git commit -m "docs: describe unified private pool and peer relay"
```

### Task 14: Deploy and validate the replacement testnet pool

**Files:**
- Modify: `protocol/private-balance/deployments/testnet-unified.json`
- Modify: `public/protocol/private-balance/v1/manifest.json`
- Modify: `public/protocol/private-balance/v1/catalogue.json`
- Remove: `public/protocol/private-balance/v1/xlm/manifest.json`
- Remove: `public/protocol/private-balance/v1/usdc/manifest.json`
- Modify: `protocol/private-balance/spikes/results/*.json`

**Step 1: Build and dry-run deployment**

Run contract build, artifact verification, and CLI simulations without send.
Confirm the configured `stellarkey-private-testnet` identity is the intended
asset administrator before broadcasting.

**Step 2: Deploy one fresh contract**

Deploy to `https://soroban-testnet.stellar.org`, initialize the new contract,
add XLM and the exact official testnet USDC SAC as indices 0 and 1, and verify
both registry entries from a second independent RPC.

**Step 3: Run live boundary and privacy experiments**

Execute XLM and USDC deposit, internal transfer, and withdrawal. Verify:

- transfer archive has no public asset or relayer;
- all three clear output diversifiers match within each action;
- recipient and outgoing scanners recover the correct asset index;
- ExitOnly blocks a USDC deposit but permits a USDC withdrawal;
- switching back to Active restores deposit;
- transaction source is absent when a second test wallet relays a job; and
- direct fallback occurs only after explicit selection.

Record transaction hashes only in the deployment evidence/results documents,
never telemetry or browser logs.

**Step 4: Regenerate the signed/hash-pinned manifest**

Run repository generation and checks. Delete obsolete per-asset manifests only
after the replacement manifest passes all integrity tests.

**Step 5: Commit**

```bash
git add protocol/private-balance/deployments protocol/private-balance/spikes/results public/protocol/private-balance/v1
git commit -m "deploy: replace private pool on testnet"
```

### Task 15: Complete verification and integrate cleanly

**Files:**
- No production edits unless a failing test first reproduces a defect.

**Step 1: Run security and generated gates**

Run:

```bash
npm run private:gate-a
npm run private:check-generated
npm run private:check-reproducible
cargo test --manifest-path protocol/private-balance/Cargo.toml --workspace
```

**Step 2: Run application verification**

Run:

```bash
npm run typecheck
npm test
npm run lint
npm run audit:prod
npm run build
npm run test:bundle
npm run check:bundle
```

**Step 3: Run critical browser tests**

Run the private UI suite on Chromium and iPhone WebKit. Record human
VoiceOver/NVDA checks separately; automation must not claim they occurred.

**Step 4: Review the diff and worktree**

Confirm no secrets, proving witnesses, notes, addresses, amounts, XDR, or
unnecessary transaction hashes were committed. Confirm the original untracked
`docs/private-balance-protocol-review-2026-09-03.md` remains untouched in the
main worktree.

**Step 5: Merge and clean up**

Use the finishing-a-development-branch workflow. Merge the feature branch into
`main` only after all gates pass, then remove this worktree and delete the
merged feature branch. Do not delete unrelated user branches; remove only
branches proven merged/stale.
