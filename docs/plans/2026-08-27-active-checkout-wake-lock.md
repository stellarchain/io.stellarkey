# Active Checkout Wake Lock Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the permanent merchant monitoring banner and scope screen-awake protection to an open, awaiting checkout.

**Architecture:** Keep foreground polling and visibility reconciliation in `useMerchant`. Move `useWakeLock` from the merchant shell into `ChargeSheetInner`, driven by the existing `awaiting` state, and render only a quiet failure retry in that sheet.

**Tech Stack:** React 19, Next.js 16.3, TypeScript, Tailwind CSS 4, Node test runner.

---

### Task 1: Specify checkout-scoped wake protection

**Files:**
- Modify: `tests/merchant-runtime.test.mjs`

**Step 1: Write the failing regression test**

Assert that `MerchantPage` no longer imports or renders `ForegroundMonitoringStatus` or owns `useWakeLock`. Assert that `ChargeSheet` calls `useWakeLock(awaiting)`, says `Watching for payment`, and offers wake-lock retry only for the error or released states. Assert that the old persistent copy is removed.

**Step 2: Verify the test fails**

Run: `node --test --test-name-pattern="screen awake protection" tests/merchant-runtime.test.mjs`

Expected: FAIL because wake protection and its status currently live at the Merchant shell level.

### Task 2: Move wake protection into the checkout

**Files:**
- Modify: `src/components/merchant/MerchantPage.tsx`
- Modify: `src/components/merchant/ChargeSheet.tsx`
- Modify: `src/components/merchant/OfflineStates.tsx`
- Modify: `docs/merchant-mode.md`
- Test: `tests/merchant-runtime.test.mjs`

**Step 1: Implement the minimal behavior**

Remove the global status component and global wake-lock hook. Call `useWakeLock(awaiting)` in `ChargeSheetInner`, change the live label to `Watching for payment`, and add an unobtrusive retry action only when the wake lock reports `error` or `released`.

**Step 2: Verify the focused test passes**

Run: `node --test --test-name-pattern="screen awake protection" tests/merchant-runtime.test.mjs`

Expected: PASS.

**Step 3: Run release verification**

Run: `npm test && npm run typecheck && npm run lint && npm run build && npm run check:bundle`

Expected: all checks pass.

**Step 4: Commit and integrate**

Commit the tested feature, fast-forward `main`, rerun the merged tests and build, restart the static server, and verify the updated bundle over HTTPS.

