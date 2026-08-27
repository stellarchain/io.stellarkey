# Merchant Recovery Actions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add direct recovery actions to the missing-staff and missing-shift merchant blockers.

**Architecture:** Keep navigation and modal ownership in `Dashboard`. Pass an `onOpenStaff` callback into `MerchantPage`, and pass the existing shift-sheet opener into `PosTerminal`; render each action only beside the blocker it resolves.

**Tech Stack:** React 19, Next.js 16.3, TypeScript, Tailwind CSS 4, Node test runner.

---

### Task 1: Specify contextual merchant recovery actions

**Files:**
- Modify: `tests/merchant-runtime.test.mjs`

**Step 1: Write the failing test**

Require `Dashboard` to pass `openSettings("staff")` into `MerchantPage`. Require the staff blocker to render `Choose staff`, and require `MerchantPage` to pass its shared shift-sheet opener into `PosTerminal`, whose locked status renders `Open shift` with a 44px touch target.

**Step 2: Verify the test fails**

Run: `node --test --test-name-pattern="merchant blockers offer direct recovery actions" tests/merchant-runtime.test.mjs`

Expected: FAIL because neither blocker currently exposes a direct action.

### Task 2: Wire the existing recovery flows

**Files:**
- Modify: `src/components/Dashboard.tsx`
- Modify: `src/components/merchant/MerchantPage.tsx`
- Modify: `src/components/merchant/PosTerminal.tsx`
- Test: `tests/merchant-runtime.test.mjs`

**Step 1: Implement the minimal callbacks and controls**

Add the staff callback to `MerchantPage`, render it only for the missing-active-staff blocker, and add the shift callback to `PosTerminal` with a compact `Open shift` button shown only while the till is locked.

**Step 2: Verify the focused test passes**

Run: `node --test --test-name-pattern="merchant blockers offer direct recovery actions" tests/merchant-runtime.test.mjs`

Expected: PASS.

**Step 3: Run release verification**

Run: `npm test && npm run typecheck && npm run lint && npm run build && npm run check:bundle`

Expected: all checks pass.

**Step 4: Commit and integrate**

Commit the tested feature, fast-forward `main`, verify the merged result, restart the static server, and confirm the updated bundle over HTTPS.

