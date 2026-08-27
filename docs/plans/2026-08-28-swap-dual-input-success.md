# Dual-Input Swap and Completion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Pay and Receive independently editable with correct Stellar execution semantics, repair the swap layout on mobile, and replace the post-confirmation banner with a receipt-quality success experience.

**Architecture:** Add strict-receive routing and submission beside the existing strict-send path, then bind both through a discriminated quote/execution intent. Refactor `SwapPage` around the last-edited side, a shared responsive amount card, and immutable submitted receipt state. Keep all network access browser-side and preserve static export.

**Tech Stack:** Next.js 16 Client Components, React 19, TypeScript, Tailwind CSS 4, Stellar SDK path-payment operations, Horizon REST, Node test runner, Playwright.

---

### Task 1: Add strict-receive routing and exact upward slippage

**Files:**
- Modify: `tests/swap.test.mjs`
- Modify: `tests/domain.test.mjs`
- Modify: `src/lib/stellar-domain.ts`
- Modify: `src/lib/swap.ts`

**Steps:**

1. Add failing tests for `/paths/strict-receive`, destination/source asset parameters, lowest-source route selection, and issued/native identity.
2. Add a failing exact-arithmetic test that requires a slippage-adjusted send maximum to round upward by one stroop when necessary.
3. Add a failing transaction test proving the builder emits `pathPaymentStrictReceive` with exact destination amount and bounded `sendMax`.
4. Run the focused tests and confirm they fail for the missing functions.
5. Implement `findStrictReceiveRoute`, `swapStrictReceive`, and the upward-slippage helper with seven-decimal integer arithmetic.
6. Run the focused tests, typecheck, and commit the routing feature.

### Task 2: Bind exact-pay and exact-receive intent through the wallet boundary

**Files:**
- Modify: `tests/swap.test.mjs`
- Modify: `src/lib/transaction-intent.ts`
- Modify: `src/hooks/useWallet.tsx`

**Steps:**

1. Add failing tests for quote keys that differ by intent side and discriminated immutable quote limits.
2. Change the request identity to include strict-send/strict-receive mode and the exact edited amount.
3. Change the bound quote to a discriminated union carrying either `destinationMinimum` or `sendMaximum`.
4. Change the wallet `swap` API to dispatch to the matching strict operation without weakening submission tracking.
5. Run focused tests and typecheck, then commit the intent boundary.

### Task 3: Redesign the responsive dual-input swap form

**Files:**
- Modify: `tests/swap-ui.test.mjs`
- Modify: `tests/mobile-ui.test.mjs`
- Modify: `e2e/fixtures.ts`
- Modify: `e2e/wallet.spec.ts`
- Modify: `src/components/SwapPage.tsx`

**Steps:**

1. Add failing source tests requiring two labelled decimal inputs, responsive min-width containment, and mode-specific guarantee text.
2. Extend the Horizon fixture with a strict-receive response and add a Playwright flow that edits each side independently.
3. Run the tests and confirm failure because Receive is currently static text.
4. Refactor the form to store Pay and Receive values plus the last-edited side, request the matching route, and keep stale quotes fail-closed.
5. Extract a shared amount-card presentation with fluid type, bounded selectors, wrapped labels, and 320px-safe quick actions and analytics.
6. Run focused Node, Chromium, and iPhone WebKit tests; commit the UI feature.

### Task 4: Add confirmation and receipt-quality success states

**Files:**
- Modify: `tests/swap-ui.test.mjs`
- Modify: `e2e/wallet.spec.ts`
- Modify: `src/components/SwapPage.tsx`
- Modify: `src/components/Dashboard.tsx`

**Steps:**

1. Add a failing browser test that submits a fixture swap and expects a dedicated confirmed receipt with debit, credit, hash, and navigation actions.
2. Add failing source assertions that success retains an immutable submitted quote instead of clearing it on confirmation.
3. Run the focused tests and verify the current reset-plus-banner behavior fails.
4. Add submitting and success stages, snapshot the exact reviewed quote, and render responsive progress/receipt states.
5. Pass Home and Activity navigation callbacks from Dashboard; keep Swap Again local and explicit.
6. Run focused tests, accessibility/containment checks, typecheck, and commit the completion feature.

### Task 5: Release verification and integration

**Files:**
- Modify only if verification exposes a regression.

**Steps:**

1. Run `npm run release:verify` and require a zero exit code.
2. Review `git diff --check`, the complete branch diff, and commit history.
3. Fast-forward the verified branch into `main` while preserving user-owned untracked files.
4. Repeat the release gate on merged `main`.
5. Rebuild/restart the existing HTTPS LAN server and smoke-test the swap screen with iPhone WebKit.
