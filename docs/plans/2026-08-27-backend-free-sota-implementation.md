# Backend-Free SOTA Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship every prioritized audit improvement while preserving a fully client-only Stellar wallet and the intentional mobile no-zoom behavior.

**Architecture:** Convert production to a static Next.js export, replace merchant localStorage with encrypted IndexedDB, make backup restore failure-atomic, migrate the vault to a wrapped master-key schema, and add optional local WebAuthn PRF unlock. Consolidate direct Stellar networking, reduce eager providers, add foreground-terminal durability, and make WebKit a release gate.

**Tech Stack:** Next.js 16 static export and SRI, React 19, TypeScript, Web Crypto, IndexedDB, WebAuthn PRF, Stellar SDK 17, Node test runner, Playwright Chromium/WebKit.

---

### Task 1: Static production deployment

**Files:** Modify `next.config.ts`, `src/app/page.tsx`, `src/lib/security-policy.ts`, `playwright.config.ts`, `package.json`, `public/sw.js`; delete `src/proxy.ts`; create `scripts/static-server.mjs`, `public/_headers`; test `tests/security-policy.test.mjs`, `tests/browser-release.test.mjs`, `e2e/pwa.spec.ts`.

1. Write tests requiring `output: "export"`, SRI, no request APIs/Proxy, static security headers, and a server that serves `out/` with those headers.
2. Run the focused tests and confirm they fail because production is dynamic.
3. Implement the static build and test-only static server; update service-worker shell discovery for exported assets.
4. Run focused tests, `npm run build`, and the PWA browser test.
5. Commit `feat: ship a backend-free static wallet`.

### Task 2: Failure-atomic backup restore and backup health

**Files:** Modify `src/lib/vault.ts`, `src/components/BackupWizardModal.tsx`, `src/components/SettingsPage.tsx`; create `src/lib/backup-schema.ts`, `src/lib/backup-health.ts`; test `tests/storage.test.mjs`, `tests/backup-health.test.mjs`, `e2e/wallet.spec.ts`.

1. Add failing behavior tests for malformed nested payloads, invalid settings, write failure rollback, and backup export/verification timestamps.
2. Verify the tests fail on the current partial decoder and sequential writes.
3. Add a complete decoder, snapshot/checked-write/rollback transaction, and local backup-health state.
4. Add unobtrusive backup status/reminders and re-run focused plus wallet browser tests.
5. Commit `fix: make wallet recovery failure-atomic`.

### Task 3: Encrypted IndexedDB merchant persistence

**Files:** Create `src/lib/indexed-db.ts`, `src/lib/storage-health.ts`, `src/lib/merchant/repository.ts`; modify `src/lib/merchant/storage.ts`, `src/hooks/useMerchant.tsx`, merchant recovery/settings UI; test `tests/indexed-db.test.mjs`, `tests/merchant-storage.test.mjs`, `tests/merchant-coordination.test.mjs`, `e2e/merchant.spec.ts`.

1. Add failing tests for copy-verify-switch migration, transactional revision writes, quota failure, persistence health, and preservation of unlimited retention.
2. Verify failures, then implement an injectable IndexedDB repository and legacy envelope migration.
3. Convert provider commit/load coordination to awaited repository transactions; no UI success may precede durable commit.
4. Surface persistence/quota status and encrypted recovery export; run merchant behavior and browser tests.
5. Commit `feat: persist merchant records transactionally`.

### Task 4: Safe iOS installation handoff

**Files:** Create `src/lib/install-handoff.ts`; modify `src/components/Dashboard.tsx`, `src/components/SettingsPage.tsx`, `src/components/Onboarding.tsx`, `src/app/manifest.ts`; test `tests/ios-pwa-ui.test.mjs`, `tests/install-handoff.test.mjs`, `e2e/pwa.spec.ts`.

1. Add failing tests for standalone detection, pre-install backup requirement, and empty standalone recovery guidance.
2. Implement browser-only state and UI that records a verified backup and blocks/warns before installation as appropriate.
3. Verify regular onboarding, installed onboarding, and manifest behavior in browser tests.
4. Commit `feat: protect wallet handoff into iOS web apps`.

### Task 5: Vault master-key schema and just-in-time secrets

**Files:** Modify `src/lib/types.ts`, `src/lib/crypto.ts`, `src/lib/vault.ts`, `src/hooks/useWallet.tsx`, signing/export UI; create `src/lib/vault-keys.ts`; test `tests/storage.test.mjs`, `tests/domain.test.mjs`, `tests/hardware.test.mjs`, `e2e/wallet.spec.ts`.

1. Add failing tests for v3 creation/migration, password-free session state, password verification, just-in-time derivation/decryption, key zeroing, and unchanged public account identities.
2. Implement raw-key authenticated encryption and wrapped master-key schema with v1/v2 migration.
3. Convert signing access to scoped async secret use and security-sensitive exports to point-of-use password verification.
4. Run all vault, signing, hardware, and wallet journey tests.
5. Commit `feat: minimize unlocked vault key exposure`.

### Task 6: Optional local passkey unlock

**Files:** Create `src/lib/passkey-prf.ts`; modify vault schema/helpers, `src/components/LockScreen.tsx`, `src/components/SettingsPage.tsx`; test `tests/passkey-prf.test.mjs`, `tests/storage.test.mjs`, `e2e/wallet.spec.ts`.

1. Add failing tests for PRF capability, credential registration, wrapping/unwrapping the existing master key, unsupported output, cancellation, removal, and password fallback.
2. Implement WebAuthn with random local challenges and strict PRF output validation.
3. Add enable/remove controls and a guarded Face ID/Touch ID unlock button.
4. Run focused and wallet browser tests.
5. Commit `feat: add backend-free passkey unlock`.

### Task 7: Direct Stellar endpoint resilience

**Files:** Modify `src/lib/horizon.ts`, `src/lib/api.ts`, `src/lib/stellar.ts`, `src/hooks/useWallet.tsx`, network settings UI, security policy/static headers; create `src/lib/stellar-endpoints.ts`; test `tests/horizon-client.test.mjs`, `tests/domain.test.mjs`, new `tests/stellar-endpoints.test.mjs`, browser fixtures.

1. Add failing tests for HTTPS validation, network identity checks, bounded read retries, `Retry-After`, health selection, and partial account settlement.
2. Route every Horizon read through the bounded client and remove duplicate ping helpers.
3. Add user-configurable Horizon/RPC settings with test/reset and no bundled secret.
4. Run network, wallet, swap, merchant watcher, and browser tests.
5. Commit `feat: harden direct Stellar connectivity`.

### Task 8: Foreground merchant terminal guarantees

**Files:** Create `src/hooks/useWakeLock.ts`; modify `src/hooks/useMerchant.tsx`, merchant runtime/status UI; test `tests/merchant-runtime.test.mjs`, `tests/merchant-live-time.test.mjs`, `e2e/merchant.spec.ts`.

1. Add failing tests for wake-lock acquisition/release, visibility catch-up poll, and unsupported browsers.
2. Implement the hook and foreground status without claiming background monitoring.
3. Run focused and merchant browser tests.
4. Commit `feat: make foreground payment monitoring explicit`.

### Task 9: Bundle and provider refactor

**Files:** Split `src/hooks/useWallet.tsx`, `src/hooks/useMerchant.tsx`, and `src/components/Dashboard.tsx` into domain state/actions and lazy boundaries; create `scripts/check-bundle-budget.mjs`; modify scripts and tests.

1. Add characterization tests for stable action/state subscriptions and a failing bundle-budget assertion.
2. Extract pure services and selector-oriented contexts without changing behavior.
3. Lazy-load merchant and advanced signing modules based on unlocked persisted capability.
4. Build, record the new route budget, and run all unit/browser tests.
5. Commit `perf: reduce wallet startup and rerenders`.

### Task 10: WebKit, accessibility, supply chain, and dead contracts

**Files:** Modify `playwright.config.ts`, `.github/workflows/ci.yml`, `package.json`, E2E tests, settings UI and vault/network dead helpers; create release checklist documentation.

1. Add WebKit iPhone/iPad projects and behavioral accessibility checks for onboarding, lock, dashboard, send review, settings, and merchant till.
2. Pin GitHub Actions to commit SHAs, install both engines, verify static output and bundle budget in CI.
3. Remove unreachable trash/biometric/duplicate ping code and placeholder Wallet Standard/Soroban navigation.
4. Run typecheck, all unit tests, lint, production audit, static build, Chromium E2E, and WebKit E2E.
5. Commit `chore: enforce the backend-free release gate`.

### Task 11: Final cross-feature verification

**Files:** Update `README.md`, release checklist, and implementation notes only where verified behavior changed.

1. Exercise migration fixtures, offline cold launch, backup restore rollback, passkey fallback, direct-network errors, and merchant resume.
2. Run the complete release command from a clean static build.
3. Inspect final dependency audit and bundle diagnostics; document accepted residual constraints.
4. Commit `docs: document the backend-free wallet architecture`.
