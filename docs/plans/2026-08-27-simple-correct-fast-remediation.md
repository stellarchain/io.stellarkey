# Simple, Correct, Fast Remediation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove every actionable audit finding while preserving StellarKey as a backend-free, local-first Stellar wallet and merchant terminal.

**Architecture:** Treat Horizon observations as immutable external facts and persist them independently from fallible business projections such as inventory. Keep every money-moving state transition idempotent and keyed by the exact network, destination, operation, asset, and memo. Land low-risk bounded changes first, then use characterization tests to make the larger persistence and context refactors safe.

**Tech Stack:** Next.js 16 static export, React 19, TypeScript, Stellar SDK/Horizon, Web Crypto, IndexedDB, Node test runner, Playwright Chromium/WebKit.

---

## Delivery rules

- Preserve the no-backend requirement. Browser storage, static assets, and direct Stellar services remain the only runtime dependencies.
- Use red-green-refactor for every behavior change.
- Keep monetary arithmetic in integer minor units or exact Stellar decimal strings.
- Never discard or relabel an observed on-chain payment because a downstream projection fails.
- Commit every independently verified feature separately.
- Do not modify the user-owned `.playwright-mcp/` directory in the main checkout.

### Task 1: Make confirmed payment intake independent from inventory

**Files:**
- Modify: `src/lib/merchant/orders.ts`
- Modify: `src/lib/merchant/reconciliation.ts`
- Modify: `src/lib/merchant/types.ts`
- Test: `tests/merchant-watch.test.mjs`
- Test: `tests/merchant-orders.test.mjs`

1. Add a failing regression with two awaiting orders for the final tracked unit; settle both exact on-chain payments and assert both payments and orders are durably settled.
2. Add an explicit inventory exception/backorder record to the settled order instead of throwing after payment confirmation.
3. Keep stock application idempotent and prevent a second settlement from decrementing it twice.
4. Run the focused merchant tests, then the complete unit suite.
5. Commit as `fix: preserve confirmed merchant payments`.

### Task 2: Base charge expiry on the ledger timestamp

**Files:**
- Modify: `src/lib/merchant/match.ts`
- Modify: `src/lib/merchant/reconciliation.ts`
- Modify: `src/lib/merchant/counter-codes.ts`
- Test: `tests/merchant-watch.test.mjs`
- Test: `tests/merchant-counter-codes.test.mjs`

1. Add failing boundary tests for a payment created before expiry but observed after it, a payment created after expiry, and an invalid Horizon timestamp.
2. Parse the immutable Horizon `createdAt` once and use it for payment eligibility while retaining local observation time separately.
3. Fail safely into reconciliation for malformed timestamps rather than guessing.
4. Verify focused and full tests.
5. Commit as `fix: use ledger time for merchant expiry`.

### Task 3: Scope watcher cursors to destination accounts

**Files:**
- Modify: `src/lib/merchant/types.ts`
- Modify: `src/lib/merchant/defaults.ts`
- Modify: `src/lib/merchant/storage.ts`
- Modify: `src/hooks/useMerchant.tsx`
- Modify: `src/components/merchant/MerchantSettingsSheets.tsx`
- Test: `tests/merchant-storage.test.mjs`
- Test: `tests/merchant-watch.test.mjs`

1. Add failing migration and watcher tests proving independent cursors for two receiving accounts on one network.
2. Replace network-only cursor keys with network-plus-destination keys and migrate legacy cursors conservatively.
3. Poll every distinct destination referenced by unresolved charges/invoices/codes, plus the current receiving account.
4. Surface outstanding-destination monitoring when the receiving account changes.
5. Verify and commit as `fix: monitor every merchant destination`.

### Task 4: Isolate unresolved-payment refunds

**Files:**
- Modify: `src/lib/merchant/refunds.ts`
- Modify: `src/hooks/useMerchant.tsx`
- Modify: `src/components/merchant/OrderDetailModal.tsx`
- Test: `tests/merchant-refunds.test.mjs`
- Test: `tests/merchant-watch.test.mjs`

1. Add failing tests proving underpaid, overpaid, late, and duplicate receipts cannot enter the order-refund path or exceed their received source amount.
2. Require a paid order and settled charge for ordinary refunds.
3. Route unresolved receipts exclusively through source-payment reversals and track cumulative reversed source-asset amounts.
4. Verify and commit as `fix: bind refunds to settled payment sources`.

### Task 5: Reconcile invoice overpayments explicitly

**Files:**
- Modify: `src/lib/merchant/invoices.ts`
- Modify: `src/lib/merchant/types.ts`
- Modify: `src/hooks/useMerchant.tsx`
- Modify: relevant invoice/reconciliation UI
- Test: `tests/merchant-invoices.test.mjs`

1. Add a failing test for a 12-unit payment against a 10-unit invoice.
2. Preserve the full receipt, settle only the amount due, and create an explicit overpayment reconciliation for the excess.
3. Keep invoice totals, customer history, takings, and refund availability internally consistent.
4. Verify and commit as `fix: surface merchant invoice overpayments`.

### Task 6: Enforce one merchant memo namespace

**Files:**
- Modify: `src/lib/merchant/charge.ts`
- Modify: `src/lib/merchant/invoices.ts`
- Modify: `src/lib/merchant/counter-codes.ts`
- Test: `tests/merchant-counter-codes.test.mjs`
- Test: `tests/merchant-invoices.test.mjs`
- Test: `tests/merchant-watch.test.mjs`

1. Add failing collision tests across orders, invoices, and counter codes.
2. Centralize memo reservation/validation and use unambiguous typed prefixes.
3. Preserve existing issued references as immutable legacy records while rejecting new collisions.
4. Verify and commit as `fix: unify merchant payment references`.

### Task 7: Make the all-account portfolio truthful

**Files:**
- Modify: `src/hooks/useWallet.tsx`
- Modify: `src/components/Dashboard.tsx`
- Modify or create: portfolio aggregation helper
- Test: relevant wallet/dashboard tests

1. Add failing tests with XLM and issued assets spread across two accounts.
2. Maintain complete per-account asset snapshots with network identity, freshness, and failure state.
3. Aggregate exact asset identities and verified prices; never silently omit an account or asset.
4. Show a clear partial/unavailable state when the complete total cannot be established.
5. Verify and commit as `fix: total every wallet asset accurately`.

### Task 8: Anchor wallet recovery to independent vectors

**Files:**
- Modify: `tests/vault-v3.test.mjs` or create `tests/hd-vectors.test.mjs`

1. Add published BIP-39 entropy/mnemonic/seed vectors.
2. Add published SLIP-0010 Ed25519 child-key vectors.
3. Add fixed mnemonic/index-to-Stellar-address compatibility vectors derived independently.
4. Verify and commit as `test: anchor wallet recovery to standards vectors`.

### Task 9: Test full IndexedDB backup recovery and rollback

**Files:**
- Modify: `e2e/merchant.spec.ts`
- Modify or create: deterministic backup fixtures/drivers
- Test: `tests/storage.test.mjs`

1. Add a failing browser journey that creates merchant history, exports a full backup, clears wallet-owned stores, restores, and verifies wallet plus exact merchant records.
2. Add a failure-injection test proving cross-store rollback restores both localStorage and IndexedDB.
3. Verify and commit as `test: cover indexeddb wallet recovery`.

### Task 10: Gate a settlement smoke flow on iPhone WebKit

**Files:**
- Modify: `playwright.config.ts`
- Create or modify: focused WebKit merchant settlement spec

1. Add a runner-managed iPhone WebKit flow for till unlock, exact crypto settlement, reload, and catch-up reconciliation.
2. Keep the exhaustive journey Chromium-only and the WebKit smoke deterministic.
3. Verify Chromium and WebKit projects.
4. Commit as `test: gate merchant settlement on webkit`.

### Task 11: Cache negative and in-flight asset metadata lookups

**Files:**
- Modify: `src/lib/toml.ts`
- Modify: `src/components/Dashboard.tsx`
- Test: `tests/asset-metadata.test.mjs`

1. Add failing tests for concurrent lookup deduplication, a negative-result TTL, and transient retry behavior.
2. Add an in-flight promise map and distinguish positive, stable-negative, and transient results.
3. Batch dashboard logo state updates.
4. Verify and commit as `perf: deduplicate asset metadata lookups`.

### Task 12: Schedule merchant expiry and index reporting joins

**Files:**
- Modify: `src/hooks/useMerchant.tsx`
- Create: focused merchant selectors/index helper
- Test: merchant runtime/report tests

1. Add fake-clock tests proving the next expiry is scheduled without one-second full scans.
2. Index charge-to-order joins and awaiting charges for summaries.
3. Recompute historical summaries only when their inputs or visible surface require it.
4. Verify and commit as `perf: bound merchant history work`.

### Task 13: Version and prune the offline shell cache

**Files:**
- Modify: `public/sw.js`
- Modify: build/security-header script if it injects the revision
- Test: relevant security/PWA tests

1. Add a failing two-version service-worker upgrade test proving stale hashed chunks are removed.
2. Use a build revision/current asset set and preserve offline navigation atomically.
3. Never cache Horizon responses, wallet data, or merchant records.
4. Verify and commit as `fix: prune obsolete pwa shell assets`.

### Task 14: Budget unlocked, merchant, and hardware chunks

**Files:**
- Modify: `scripts/check-bundle-budget.mjs`
- Modify: `tests/bundle-budget.test.mjs`
- Modify: `package.json` only if a named command is required

1. Add failing fixture tests showing an oversized dynamic chunk is detected.
2. Read the Next build manifest or deterministic resource map and assign separate budgets to initial, unlocked, merchant, and hardware journeys.
3. Verify against a fresh production export.
4. Commit as `build: budget lazy application chunks`.

### Task 15: Defer the full merchant runtime

**Files:**
- Modify: `src/components/UnlockedWalletShell.tsx`
- Modify: `src/hooks/useMerchant.tsx`
- Create: thin merchant bootstrap/provider boundary as required
- Test: bundle and merchant-context tests

1. Add a failing bundle/source-boundary test proving the disabled wallet shell does not eagerly import the full merchant runtime.
2. Dynamically mount the full provider when Merchant Mode is enabled or first opened, following the installed Next 16 lazy-loading guidance.
3. Preserve existing enabled stores, navigation, and cross-tab state.
4. Verify and commit as `perf: defer merchant runtime until needed`.

### Task 16: Move merchant history to record-level encrypted persistence

**Files:**
- Modify: `src/lib/merchant/repository.ts`
- Modify: `src/lib/merchant/storage.ts`
- Modify: `src/lib/merchant/types.ts`
- Modify: `src/hooks/useMerchant.tsx`
- Test: repository, migration, concurrency, recovery, and browser tests

1. Characterize current conflict, rollback, pruning, and export semantics.
2. Introduce versioned encrypted object stores for append-heavy records plus a small metadata record.
3. Implement copy-verify-switch migration with an atomic journal and rollback.
4. Preserve full-backup compatibility and multi-tab revision conflict detection.
5. Benchmark constant-sized updates against a large retained history.
6. Verify and commit migration separately from caller adoption.

### Task 17: Partition wallet and merchant state boundaries

**Files:**
- Modify: `src/hooks/useWallet.tsx`
- Modify: `src/hooks/useMerchant.tsx`
- Modify: consumer hooks/components incrementally
- Test: context stability and domain behavior tests

1. Add render/subscription characterization tests.
2. Split stable commands from high-frequency account, market, till, watcher, ledger, reporting, and settings state.
3. Migrate consumers in bounded groups while keeping compatibility hooks temporarily.
4. Remove compatibility layers after all consumers move.
5. Verify and commit each domain extraction separately.

### Task 18: Correct recovery documentation and retire stale harnesses

**Files:**
- Modify: `src/components/merchant/TaxRecordsPage.tsx`
- Modify: `src/lib/vault.ts`
- Modify/delete: obsolete `scripts/verify-*.mjs` and `scripts/wrapup.mjs` after inventory
- Modify: `package.json`
- Test: documentation/source-policy and Playwright tests

1. Correct the merchant archive description and supported backup versions.
2. Inventory every standalone browser script; promote unique checks into `e2e/` and retain only explicit manual hardware probes.
3. Remove obsolete scripts and the direct `playwright` dependency if unused.
4. Verify and commit documentation separately from tooling cleanup.

## Final verification

Run, in order:

```bash
npm run typecheck
npm test
npm run lint
npm run audit:prod
npm run build
npm run check:bundle
npm run test:e2e
npm run release:verify
```

Review every commit and the final diff for custody, amount arithmetic, migration rollback, offline upgrades, and accidental plaintext persistence. Merge the verified feature branch into `main` without touching unrelated user files.
