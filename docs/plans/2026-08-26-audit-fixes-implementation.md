# Audit Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Repair every accepted audit finding while preserving wallet signing behavior and intentional mobile pinch-zoom policy.

**Architecture:** Introduce typed resource and storage boundaries, then migrate merchant persistence to revisioned encrypted storage. Reduce network/render fan-out after correctness is protected, and promote critical browser journeys into release gates.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Web Crypto, Web Locks/BroadcastChannel, IndexedDB or versioned local envelope migration, Node test runner, Playwright.

---

### Task 1: Document and baseline the program

**Files:**
- Create: `docs/plans/2026-08-26-audit-fixes-design.md`
- Create: `docs/plans/2026-08-26-audit-fixes-implementation.md`

1. Record the accepted scope, including the explicit decision to keep pinch zoom disabled.
2. Run `npm test`, `npm run typecheck`, and `npm run lint`; expect all to pass.
3. Commit with `docs: plan audit remediation program`.

### Task 2: Make wallet refresh partial, bounded, and stale-safe

**Files:**
- Create: `src/lib/wallet-refresh.ts`
- Modify: `src/hooks/useWallet.tsx`
- Modify: `src/lib/api.ts`
- Modify: `src/lib/prices.ts`
- Test: `tests/wallet-refresh.test.mjs`

1. Write failing tests for independent resource settlement, preservation of previous values, and timeout of hanging market requests.
2. Run the focused test and confirm failures are caused by the missing refresh coordinator/deadline behavior.
3. Add a typed coordinator returning per-resource success/error results. Add bounded fetch helpers for CoinGecko calls and reuse a single Horizon account snapshot for balances/reserve inputs.
4. Update the provider to commit successful resources independently and expose scoped errors without blanking balances.
5. Run the focused test, full unit suite, typecheck, and lint.
6. Commit with `fix: make wallet refresh partial and bounded`.

### Task 3: Fail closed on unreadable vault and merchant storage

**Files:**
- Create: `src/lib/storage-load.ts`
- Modify: `src/lib/vault.ts`
- Modify: `src/hooks/useWallet.tsx`
- Modify: `src/components/WalletApp.tsx`
- Create: `src/components/StorageRecoveryScreen.tsx`
- Modify: `src/lib/merchant/storage.ts`
- Modify: `src/hooks/useMerchant.tsx`
- Test: `tests/storage.test.mjs`
- Test: `tests/merchant-storage.test.mjs`

1. Write failing tests for corrupt JSON, malformed account entries, and future versions returning explicit recovery outcomes while preserving raw data.
2. Add discriminated load results and structural vault validation.
3. Add a wallet recovery phase with raw export and confirmed reset actions. Expose merchant storage issues, block writes, and provide equivalent export/reset actions.
4. Verify focused and full checks.
5. Commit with `fix: add fail-closed local data recovery`.

### Task 4: Make every merchant commit durable-first

**Files:**
- Create: `src/lib/merchant/commit.ts`
- Modify: `src/hooks/useMerchant.tsx`
- Test: `tests/merchant-storage.test.mjs`
- Test: `tests/merchant-runtime.test.mjs`

1. Write failing tests proving storage rejection leaves UI state/revision unchanged and is not described as a Horizon outage.
2. Implement one transaction helper that derives from the latest committed store, saves first, then publishes state.
3. Replace the permissive settings/catalogue/cursor/expiry write paths and add typed storage error presentation.
4. Verify and commit with `fix: make merchant mutations durable-first`.

### Task 5: Keep merchant reporting live across clock boundaries

**Files:**
- Create: `src/hooks/useClock.ts`
- Modify: `src/hooks/useMerchant.tsx`
- Test: `tests/merchant-reporting.test.mjs`
- Test: `tests/merchant-runtime.test.mjs`

1. Write failing fake-time tests for settlement prompt hour, midnight, month transition, visibility catch-up, and DST-safe local day changes.
2. Implement a shared external-store clock with minute/day/month snapshots.
3. Make reporting and settlement derivations depend on the smallest relevant token.
4. Verify and commit with `fix: refresh merchant time boundaries`.

### Task 6: Prevent multi-tab lost updates and duplicate watchers

**Files:**
- Create: `src/lib/merchant/coordination.ts`
- Modify: `src/lib/merchant/types.ts`
- Modify: `src/lib/merchant/storage.ts`
- Modify: `src/hooks/useMerchant.tsx`
- Test: `tests/merchant-coordination.test.mjs`

1. Write failing tests for stale revision rejection, serialized writes, storage-event reload, watcher lease election, lease expiry, and environments without Web Locks.
2. Add revision/writer metadata without weakening v1/v2 migration.
3. Serialize commits, broadcast revisions, reload newer commits, and allow only the lease owner to poll.
4. Verify and commit with `fix: coordinate merchant tabs and watcher ownership`.

### Task 7: Enforce privacy and retention promises

**Files:**
- Create: `src/lib/merchant/crypto.ts`
- Modify: `src/lib/merchant/storage.ts`
- Modify: `src/lib/merchant/customers.ts`
- Modify: `src/lib/vault.ts`
- Modify: `src/components/BackupWizardModal.tsx`
- Modify: `src/components/merchant/TaxRecordsPage.tsx`
- Test: `tests/merchant-storage.test.mjs`
- Test: `tests/storage.test.mjs`

1. Write failing tests proving merchant PII is absent from stored plaintext, legacy migration is lossless, backups round-trip merchant data, and retention removes expired notes/provenance while preserving unresolved audit graphs.
2. Add an authenticated encrypted merchant envelope derived through the unlocked vault boundary.
3. Migrate plaintext only after a verified encrypted commit. Include the envelope in full backup/restore and expose a standalone encrypted archive.
4. Correct retention behavior and explanatory copy.
5. Verify and commit with `feat: encrypt and retain merchant data safely`.

### Task 8: Reduce network and React fan-out

**Files:**
- Create: `src/hooks/useWalletResources.ts`
- Create: `src/hooks/useMerchantRuntime.ts`
- Modify: `src/hooks/useWallet.tsx`
- Modify: `src/hooks/useMerchant.tsx`
- Modify: `src/app/page.tsx`
- Test: `tests/wallet-refresh.test.mjs`
- Test: `tests/merchant-runtime.test.mjs`

1. Write failing cadence/deduplication tests and stable-value source contracts.
2. Separate market, account, and activity cadence; coalesce account snapshot calls; cancel obsolete requests.
3. Memoize/split command and runtime values so wallet price/loading changes do not invalidate unrelated merchant command consumers.
4. Verify and commit with `perf: reduce wallet polling and provider fanout`.

### Task 9: Promote critical browser journeys into CI

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/fixtures.ts`
- Create: `e2e/wallet.spec.ts`
- Split: `e2e/merchant.spec.ts`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Remove only superseded: `scripts/verify-*.mjs`

1. Create failing Playwright cases for onboarding, corrupt recovery, unlock, hardware/watch-only, send/swap review, merchant reload, multi-tab conflict, offline launch, and runtime accessibility checks.
2. Add reusable storage/Horizon fixtures and isolated test contexts.
3. Split the merchant mega-journey into independent specs and promote equivalent wallet scripts before deleting duplicates.
4. Run production-build browser tests and commit with `test: promote wallet journeys to release gates`.

### Task 10: Tighten CSP and secure the installed-app shell

**Files:**
- Create: `src/proxy.ts`
- Create: `src/lib/security-policy.ts`
- Create: `public/sw.js`
- Create: `src/components/ServiceWorkerRegistration.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `next.config.ts`
- Test: `tests/security-policy.test.mjs`
- Test: `tests/app-icon.test.mjs`
- Test: `e2e/pwa.spec.ts`

1. Write failing tests for a per-request nonce, named core services plus decentralized HTTPS issuer metadata, development allowances, strict service-worker headers, shell-only caching, and offline cold launch.
2. Implement the installed Next 16 Proxy nonce pattern and force dynamic rendering only where required.
3. Register a same-origin service worker that caches immutable shell assets and never caches ledger/API responses or user data.
4. Preserve `maximumScale: 1` and `userScalable: false` exactly.
5. Verify and commit with `security: harden CSP and offline app shell`.

### Task 11: Final verification and review

**Files:**
- Modify documentation only if verification reveals a mismatch.

1. Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, all Playwright projects, and `npm run audit:prod`.
2. Check `git status --short`, inspect every feature commit, and confirm no unrelated work was modified.
3. Review the implementation against every accepted audit item and this plan.
4. Commit any verification-document correction separately; otherwise create no empty commit.
