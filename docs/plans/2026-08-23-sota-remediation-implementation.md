# Wallet SOTA Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Eliminate all concrete audited correctness, security, reliability, performance, accessibility, test, dependency, DX, and documentation defects while preserving the existing local-first wallet model.

**Architecture:** Introduce pure, testable policy seams for immutable transaction intent, full asset identity, transaction inspection, Horizon request state, and versioned storage decoding. Keep React responsible for presenting those domain results, and make every asynchronous commit account/network scoped.

**Tech Stack:** Next.js 16.3 App Router, React 19, TypeScript 5.9, `@stellar/stellar-sdk` 17, Node test runner, Playwright, ESLint.

**Working-tree exception:** The audited application is uncommitted on `main`; do not commit or reset user-owned changes. Use failing tests and scoped diffs as checkpoints.

---

### Task 1: Bind asset identity and transaction intent exactly

**Files:**
- Create: `src/lib/transaction-intent.ts`
- Modify: `src/lib/toml.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/api.ts`
- Modify: `src/components/AssetDetailModal.tsx`
- Modify: `src/components/SendModal.tsx`
- Modify: `src/components/SwapPage.tsx`
- Test: `tests/domain.test.mjs`
- Test: `tests/swap.test.mjs`
- Test: `tests/payuri.test.mjs`

1. Write failing tests proving a changed swap form invalidates the previous quote key; an unsupported SEP-7 credit asset is rejected; TOML metadata requires an exact code and issuer match; SAC IDs differ by network and validate as contract StrKeys; Horizon activity preserves issuer and maps strict-send/receive destination fields correctly; and spendable balances subtract selling liabilities.
2. Run the focused tests and confirm each fails for the audited behavior.
3. Add pure quote-key and supported-payment-asset helpers. Store the quote key with the quote and require equality before review and submission.
4. Parse TOML currency entries structurally enough to bind exact issuer plus code. Rename unverified domain UI to issuer-declared and expose verified branding only on exact binding.
5. Derive native and credit SAC IDs with `Asset.contractId(networkPassphrase)` and validate them before rendering/copying.
6. Extend `AssetBalance` and `ActivityItem` with liabilities and full asset identity. Correct Horizon path-payment mapping and update displays/exports.
7. Run focused tests, then the full unit suite.

### Task 2: Make signing review and multisig fail closed

**Files:**
- Create: `src/lib/transaction-review.ts`
- Modify: `src/lib/multisig.ts`
- Modify: `src/components/MultiSigStudioModal.tsx`
- Modify: `src/components/SettingsPage.tsx`
- Modify: `src/hooks/useWallet.tsx`
- Test: `tests/domain.test.mjs`
- Test: `tests/hardware.test.mjs`

1. Write failing tests for account-merge high threshold, per-operation source thresholds, issuer-complete payment/path review, opaque Soroban rejection, explicit network assertion, and partial multisig configuration when current high weight is unmet.
2. Run the focused tests and verify the expected failures.
3. Decode supported classic operations into a typed review model including source, issuer, limits, memo, fee, time bounds, and danger classification. Unknown/opaque operations are non-signable.
4. Calculate required weight per effective operation source and verify signatures against each source account. Remove the impossible inferred network-mismatch check and require explicit selected-network confirmation.
5. Route configure/disable multisig through a partial-envelope result when local weight is insufficient. Do not submit until every source requirement is satisfied.
6. Make the offline signer review the same model before requesting a password and signing. Verify the active account is a valid signer.
7. Run focused and full unit tests.

### Task 3: Model transaction broadcast ambiguity

**Files:**
- Modify: `src/lib/horizon.ts`
- Modify: `src/lib/api.ts`
- Modify: `src/hooks/useWallet.tsx`
- Modify: `src/components/SendModal.tsx`
- Modify: other transaction success surfaces under `src/components/`
- Test: `tests/domain.test.mjs`

1. Write failing tests for a response body that exceeds the deadline, a network failure after the transaction hash is known, and confirmation lookup by hash.
2. Verify the tests fail for the existing unbounded submission path.
3. Make Horizon deadlines cover headers and body parsing. Compute the transaction hash before broadcast and return a typed `status_unknown` result when submission may have escaped.
4. Persist pending transaction identity before submission, poll by hash, prevent equivalent blind retries, and distinguish submitted, confirmed, failed, and unknown UI states.
5. Reuse dynamic fee policy across send, swap, batch, trustline, merge, claim, and multisig construction where supported.
6. Run focused and full tests.

### Task 4: Validate and atomically restore vault data

**Files:**
- Create: `src/lib/storage-schema.ts`
- Modify: `src/lib/vault.ts`
- Modify: `src/lib/contacts.ts`
- Modify: `src/hooks/useWallet.tsx`
- Test: `tests/storage.test.mjs`

1. Write failing round-trip and rejection tests for every vault account kind, invalid active account, malformed indices, invalid auto-lock values, malformed contacts/notes/settings, future versions, wrong passwords, and failed restore preservation.
2. Verify the focused tests fail for shallow validation and mutation-before-validation.
3. Add versioned runtime decoders and migrations for vault, backup, contacts, notes, and settings. Reject invalid fields with actionable errors.
4. Stage the entire decoded payload before mutation. Snapshot wallet-owned keys, commit validated stores, and roll back on a write failure.
5. Set session secrets only after every account derivation/decryption succeeds. Clamp auto-lock to supported positive values.
6. Run storage and full unit tests.

### Task 5: Scope and coalesce asynchronous data work

**Files:**
- Modify: `src/hooks/useWallet.tsx`
- Modify: `src/lib/api.ts`
- Modify: `src/lib/horizon.ts`
- Modify: `src/lib/toml.ts`
- Modify: `src/components/Dashboard.tsx`
- Test: `tests/domain.test.mjs`

1. Write failing tests around a deferred activity page resolving after account/network switch, overlapping refresh triggers, duplicate account fetches, and bounded batch preflight concurrency.
2. Verify the expected failures.
3. Add keyed single-flight refresh and abort control. Reuse the account response for balances, reserve inputs, and liabilities; cache network reserve data briefly.
4. Commit balance, activity, price, and claimable-balance domains independently while preserving stale data plus domain-specific error state.
5. Key pagination by network/public key/generation. Cancel or discard stale pages on switch, lock, and restore.
6. Deduplicate issuer/TOML requests with an in-flight map and bounded concurrency. Bound batch-recipient account checks.
7. Pre-index contacts and cap or virtualize rendered activity history without losing explicit older-history navigation.
8. Run focused and full tests.

### Task 6: Make the UI truthful, accessible, and genuinely lazy

**Files:**
- Modify: `src/components/AssetDetailModal.tsx`
- Modify: `src/components/SettingsPage.tsx`
- Modify: `src/components/ui.tsx`
- Modify: `src/components/Dashboard.tsx`
- Modify: affected modal and segmented-control call sites
- Test: `tests/domain.test.mjs`
- Create: `playwright.config.ts`
- Create: `e2e/wallet.spec.ts`

1. Add failing browser tests for topmost-only Escape, focus restoration, dropdown trigger semantics, segmented selection state, unopened modal chunks, unsupported-alert absence, and factual security/asset labels.
2. Verify the tests fail against the current UI.
3. Remove the nonfunctional price-alert surface and arbitrary percentage security score. Replace assurance copy with factual encryption, auto-lock, hardware, and backup state.
4. Implement a dialog stack so only the topmost modal owns Escape/focus restoration. Make dropdown triggers caller-owned buttons and expose correct ARIA selection semantics.
5. Conditionally mount dynamic modals only while open, with explicit draft-reset behavior.
6. Run Playwright focused tests, accessibility checks, unit tests, and build.

### Task 7: Add deterministic CI and safe developer tooling

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `scripts/seed.mjs`
- Modify: `scripts/verify-multisig.mjs`
- Modify or remove stale `scripts/verify-*.mjs`
- Create: `.nvmrc`
- Create: `.npmrc`

1. Add a deterministic Playwright CI project with mocked Horizon, CoinGecko, federation, and Trezor boundaries, isolated browser storage, trace-on-failure, and no live secrets.
2. Port onboarding, unlock, exact-asset send, stale swap quote, backup restore, account/network race, and hardware cancellation journeys.
3. Replace predictable secret files with private temporary directories, redact logs, and guarantee live-testnet cleanup in `finally`; keep live tests opt-in and separate.
4. Replace or archive stale verification scripts that refer to removed UI.
5. Declare Node `>=22.12`, pin the package manager, align Node types, add watch/coverage commands, and document dependency-advisory exceptions with expiry. Add lifecycle-script allowlisting if compatible with npm and the current dependency tree.
6. Gate CI on unit, browser, typecheck, lint, production audit, and build.

### Task 8: Harden production configuration and documentation

**Files:**
- Modify: `next.config.ts`
- Create: `src/proxy.ts` only if the installed Next.js CSP guide requires it
- Modify: `src/app/layout.tsx`
- Modify: `src/lib/hardware.ts`
- Modify: `README.md`
- Create: `SECURITY.md`
- Create: `docs/architecture.md`

1. Add configuration assertions or browser checks for CSP, HSTS, popup compatibility, and production metadata.
2. Following the installed Next.js 16 CSP guide, choose a nonce-based dynamic policy only if the security gain justifies losing static output; otherwise retain static output with documented SRI/nonce follow-up and tighten every directive currently possible.
3. Normalize public product identity and Trezor manifest metadata while preserving legacy storage keys.
4. Document custody assets, actors, trust boundaries, recovery guarantees, supported Node/browser/device versions, vulnerability disclosure, dependency exceptions, and a release checklist.
5. Document custom Horizon behavior honestly or add the missing verified endpoint editor; do not claim a UI that does not exist.
6. Run typecheck, lint, unit tests, Playwright, production build, and production dependency audit.

### Task 9: Reduce architectural coupling without changing behavior

**Files:**
- Modify: `src/hooks/useWallet.tsx`
- Modify: `src/components/Dashboard.tsx`
- Modify: `src/components/SettingsPage.tsx`
- Create: focused hooks/components under `src/hooks/` and `src/components/`
- Create or modify tests under `tests/` and `e2e/`

1. Add characterization tests for provider session/account, ledger-data, market-data, preference, and transaction boundaries.
2. Extract invariant transaction construction/submission policy without erasing operation-specific validation.
3. Split wallet context into selector-oriented domains or stable sub-contexts so polling and price changes do not rerender unrelated signing UI.
4. Split Dashboard and Settings along existing view boundaries. Remove unreachable trash, biometric, and WebUSB capability APIs after confirming no consumers.
5. Keep all characterization, unit, browser, lint, typecheck, and build checks green after every extraction.

### Task 10: Final independent review and verification

**Files:**
- Review every changed file against `docs/plans/2026-08-23-sota-remediation-design.md`

1. Run the complete unit suite and report exact pass/fail counts.
2. Run deterministic Playwright tests and inspect traces/screenshots for any failure.
3. Run typecheck, lint, production build, and production dependency audit.
4. Review the complete diff for unsupported product claims, issuer-code comparisons, unscoped async commits, opaque signing paths, secret logging, and accidental changes to user-owned work.
5. Obtain independent specification and code-quality reviews; fix every critical or important issue and repeat verification.
