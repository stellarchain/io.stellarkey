# Settings Layout Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Separate signer badges from addresses and align Merchant Settings with Wallet Settings’ responsive categorized layout.

**Architecture:** Keep all existing settings components, state, validation, and callbacks. Change only the JSX layout boundaries and utility classes, protected by focused source-level regression tests and the existing full release checks.

**Tech Stack:** Next.js 16.3 App Router, React 19, TypeScript, Tailwind CSS 4, Node test runner.

---

### Task 1: Signer identity spacing

**Files:**
- Modify: `tests/settings-layout.test.mjs`
- Modify: `src/components/MultiSigStudioModal.tsx`

**Step 1: Write the failing test**

Add a test that reads `MultiSigStudioModal.tsx` and requires both “This device” badges to use `mt-1 block w-fit`.

**Step 2: Run the test to verify it fails**

Run: `npm test -- tests/settings-layout.test.mjs`

Expected: FAIL because the badges still use `inline-block`.

**Step 3: Write the minimal implementation**

Replace the two local-device badge layout classes with `mt-1 block w-fit`, retaining all color and typography utilities.

**Step 4: Run the test to verify it passes**

Run: `npm test -- tests/settings-layout.test.mjs`

Expected: PASS.

**Step 5: Commit**

```bash
git add tests/settings-layout.test.mjs src/components/MultiSigStudioModal.tsx
git commit -m "fix: separate signer device badges from addresses"
```

### Task 2: Merchant settings category grid

**Files:**
- Modify: `tests/settings-layout.test.mjs`
- Modify: `src/components/merchant/MerchantSettings.tsx`

**Step 1: Write the failing test**

Add a test that requires a one-column-to-two-column responsive grid and exactly two categorized `space-y-6` stacks in Merchant Settings.

**Step 2: Run the test to verify it fails**

Run: `npm test -- tests/settings-layout.test.mjs`

Expected: FAIL because Merchant Settings is still a single `space-y-6` stack.

**Step 3: Write the minimal implementation**

Wrap the existing sections in `grid grid-cols-1 items-start gap-6 md:grid-cols-2`. Put Shop through Settlement in the first `space-y-6` column and Tax through the danger action in the second. Keep page-level explanatory content and the receipt sheet outside the grid.

**Step 4: Run the test to verify it passes**

Run: `npm test -- tests/settings-layout.test.mjs`

Expected: both tests PASS.

**Step 5: Commit**

```bash
git add tests/settings-layout.test.mjs src/components/merchant/MerchantSettings.tsx
git commit -m "feat: align merchant settings with wallet layout"
```

### Task 3: Full verification and integration

**Files:**
- Verify all changed files.

**Step 1: Run static checks and tests**

Run: `npm run typecheck && npm test && npm run lint`

Expected: all commands exit successfully with 0 test failures and no lint errors.

**Step 2: Verify production output**

Run: `npm run build && npm run check:bundle`

Expected: static export succeeds and bundle budgets pass.

**Step 3: Review the diff**

Confirm that the diff contains only layout/test/documentation changes and preserves the user-owned `.playwright-mcp/` directory in the main worktree.

**Step 4: Integrate and serve**

Fast-forward `main`, rebuild its static output, restart the backend on `127.0.0.1:3003`, and verify the HTTPS proxy serves the new UI marker.
