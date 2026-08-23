# Wallet Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the audited custody, transaction-correctness, interoperability, reliability, accessibility, performance, security-header, test, and documentation defects from the current Polaris wallet working tree.

**Architecture:** Introduce small pure domain modules for exact Stellar amounts, canonical asset identity, typed memos, reserve calculations, and Horizon failures. Keep transaction construction shared across direct and multisig flows, disable unsupported security/device claims, and make client state commits network/account scoped. Add behavior-first Node tests around each domain boundary before changing production code.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, `@stellar/stellar-sdk` 17, Node test runner, Playwright, ESLint.

---

### Task 1: Establish a unified regression suite

**Files:**
- Modify: `package.json`
- Create: `tests/domain.test.mjs`
- Create: `tests/payuri.test.mjs`
- Create: `tests/storage.test.mjs`

1. Add failing tests for exact amount normalization, memo construction, canonical asset identity, quadratic batch fees, reserve calculation, Horizon error classification, SEP-7 field names, and destructive reset semantics.
2. Run each test and confirm it fails for the audited behavior.
3. Add a single `npm test` script that runs all Node test files.

### Task 2: Correct transaction-domain behavior

**Files:**
- Create: `src/lib/stellar-domain.ts`
- Modify: `src/lib/format.ts`
- Modify: `src/lib/api.ts`
- Modify: `src/lib/multisig.ts`
- Modify: `src/lib/swap.ts`
- Modify: `src/components/SendModal.tsx`
- Modify: `src/components/BatchSendModal.tsx`

1. Implement string-only 7-decimal amount normalization and arithmetic.
2. Implement canonical native/credit asset construction using issuer presence, not code.
3. Thread a typed memo union through direct and multisig payment construction.
4. Pass the per-operation base fee once to `TransactionBuilder`.
5. Calculate spendable XLM from live account subentry/sponsorship data and the current base reserve, including fees.
6. Run the domain, swap, and hardware tests after each behavior change.

### Task 3: Repair asset provenance and pricing

**Files:**
- Modify: `src/lib/assets.ts`
- Modify: `src/lib/prices.ts`
- Modify: `src/components/FiatValue.tsx`
- Modify: `src/components/AddAssetModal.tsx`
- Modify: asset display call sites under `src/components/`

1. Replace invalid registry records with a minimal checksum-valid, explicitly verified network registry.
2. Key lookup, duplicate detection, logo/metadata, and prices by `(network, code, issuer)`.
3. Always expose issuer identity for credit assets and never price unknown issuers by code alone.
4. Add registry validation and counterfeit-code regression tests.

### Task 4: Make reset and security controls truthful

**Files:**
- Modify: `src/lib/vault.ts`
- Modify: `src/components/ResetWalletModal.tsx`
- Modify: `src/components/Onboarding.tsx`
- Modify: `src/components/LockScreen.tsx`
- Modify: `src/components/SettingsPage.tsx`
- Modify: `src/components/TxDetailModal.tsx`
- Modify: `src/hooks/useWallet.tsx`

1. Make destructive reset delete vault, trash, preferences, contacts, notes, and cached wallet data.
2. Remove the nonfunctional biometric toggle and unlock action; document passkeys as a future smart-account feature.
3. Encrypt transaction notes under the unlocked vault key, with a one-time migration from plaintext.
4. Enforce auto-lock against elapsed wall-clock time on visibility/focus changes.
5. Add storage and lifecycle regression tests where browser-independent seams allow.

### Task 5: Disable unsafe hardware behavior and contain Trezor

**Files:**
- Modify: `src/lib/hardware.ts`
- Modify: `src/components/AddAccountModal.tsx`
- Modify: hardware account rendering/import paths
- Modify: `package.json`

1. Delete the simulated Ledger derivation path and reject Ledger connection/signing with a clear unsupported message.
2. Hide Ledger onboarding controls and detect/reject persisted simulated Ledger accounts.
3. Keep Trezor dynamically loaded and retain its account/signature binding tests.
4. Evaluate only upstream-compatible Trezor dependency remediation; never apply npm's unsafe downgrade automatically.

### Task 6: Repair network reliability, swaps, and SEP-7

**Files:**
- Create: `src/lib/horizon.ts`
- Modify: `src/lib/api.ts`
- Modify: `src/lib/swap.ts`
- Modify: `src/lib/payuri.ts`
- Modify: `src/components/SwapPage.tsx`
- Modify: `src/components/SendModal.tsx`
- Modify: `src/hooks/useWallet.tsx`

1. Add typed Horizon errors that distinguish unfunded accounts, no route, validation failures, rate limiting, server errors, and offline failures.
2. Remove fabricated price-impact/liquidity/spread values and show only quote-derived facts.
3. Implement SEP-7 `destination`, typed memos, network passphrase, callback/origin/signature fields; reject unsupported or invalid signed requests rather than silently weakening them.
4. Scope data caches and async commits by network plus account; abort or ignore stale refreshes.
5. Cache/dedupe price calls and pause polling while the document is hidden.

### Task 7: Accessibility, performance, and browser hardening

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `src/components/ui.tsx`
- Modify: `src/components/Dashboard.tsx`
- Modify: affected icon-only buttons/forms
- Modify: `next.config.ts`

1. Restore browser zoom.
2. Add dialog labels, initial focus, focus trapping, and form label associations.
3. Add accessible names to icon-only controls.
4. Lazy-load large conditional pages and modals using the documented Next.js 16 `next/dynamic` API.
5. Add CSP, frame, referrer, MIME, and permissions headers compatible with Horizon, CoinGecko, Trezor, and Stellar TOML/logo requests.

### Task 8: CI, documentation, and final verification

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `README.md`
- Modify: `package.json`

1. Document custody model, supported hardware, networks, asset identity, commands, threat boundaries, and deployment requirements.
2. Add CI for install, test, lint, typecheck, and production build.
3. Run `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, and `npm audit --omit=dev`.
4. Inspect the final diff for accidental changes to pre-existing user work and record any unresolved upstream advisories.
