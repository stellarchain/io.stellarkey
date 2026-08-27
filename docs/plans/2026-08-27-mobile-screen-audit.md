# Mobile Screen Audit Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make every reachable wallet and merchant surface fit, read, scroll, and operate cleanly at supported iPhone and iPad widths without re-enabling zoom or adding a backend.

**Architecture:** Start with real WebKit containment checks that inspect visible descendants, because document-level `scrollWidth` does not detect content clipped inside panels. Fix shared shells and primitives first, then repair wallet and merchant screens with localized responsive rules. Keep the existing dark iOS visual language and static-export architecture.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind CSS 4, global component utilities, Node test runner, Playwright WebKit, axe-core.

---

### Task 1: Add a reusable mobile containment gate

**Files:**
- Modify: `e2e/accessibility.spec.ts`
- Modify: `e2e/fixtures.ts`
- Test: `e2e/accessibility.spec.ts`

**Steps:**

1. Add a helper that inspects visible elements and reports descendants whose bounding rectangles escape their owning screen or viewport, while allowing intentional horizontal scrollers.
2. Make the Horizon fixture accept an exact test balance so a long-but-valid Stellar amount can reproduce the dashboard failure.
3. Add an iPhone WebKit test for a maximum-width balance and confirm it fails on the hero amount.
4. Add coverage for narrow 320px and standard 393px widths.
5. Commit the test harness separately.

### Task 2: Fix shared mobile containment and dashboard hierarchy

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/components/Dashboard.tsx`
- Test: `tests/mobile-ui.test.mjs`
- Test: `e2e/accessibility.spec.ts`

**Steps:**

1. Add failing source-level assertions for shared `min-width: 0`, responsive page gutters, and a fluid numeric display utility.
2. Constrain the shell, panels, list rows, and modal content without hiding actionable content.
3. Render the hero amount and unit as a wrapping, fluid, tabular number group that stays inside the panel at 320px.
4. Tighten the dashboard’s smallest-width action row, fiat chip, alert copy, and asset rows.
5. Run the focused Node and iPhone WebKit tests, then commit.

### Task 3: Audit and repair wallet screens and sheets

**Files:**
- Modify as required: `src/components/Onboarding.tsx`
- Modify as required: `src/components/LockScreen.tsx`
- Modify as required: `src/components/StorageRecoveryScreen.tsx`
- Modify as required: `src/components/SwapPage.tsx`
- Modify as required: `src/components/AddressBookPage.tsx`
- Modify as required: `src/components/SettingsPage.tsx`
- Modify as required: `src/components/ui.tsx`
- Modify as required: wallet modal components under `src/components/`
- Test: `e2e/accessibility.spec.ts`
- Test: `tests/mobile-ui.test.mjs`

**Steps:**

1. Traverse onboarding, lock, home, activity, swap, contacts, and settings at 320px and 393px.
2. Traverse wallet sheets: send/review, receive, asset detail/add asset, transaction detail, add/rename account, backup, multisig, batch send, converter, network status, reset, and paper wallet where fixture state permits.
3. For each failure, add a focused failing assertion before changing production code.
4. Prefer shared modal/list/input fixes; use screen-specific changes only where content semantics differ.
5. Verify readable typography, 44px coarse-pointer targets, safe-area spacing, single-owner vertical scrolling, and no clipped exact values.
6. Commit wallet improvements in cohesive feature commits.

### Task 4: Audit and repair merchant screens and sheets

**Files:**
- Modify as required: `src/components/merchant/*.tsx`
- Modify as required: `src/components/SettingsPage.tsx`
- Test: `e2e/accessibility.spec.ts`
- Test: `e2e/merchant-webkit.spec.ts`
- Test: merchant source tests under `tests/`

**Steps:**

1. Traverse till, orders, catalogue, invoices, counter codes, customers, insights, and merchant settings at 320px and 393px.
2. Traverse setup, shift, charge, tender, receipt, refund, adjustment, record detail, editor, display, and settings sheets where deterministic fixtures permit.
3. Add a failing regression assertion for each distinct shared layout failure.
4. Repair dense tables as compact lists or intentional labelled horizontal scrollers; keep primary actions visible and exact monetary values untruncated.
5. Verify direct recovery actions remain reachable for blocked till states.
6. Commit merchant improvements in cohesive feature commits.

### Task 5: Complete the mobile release gate

**Files:**
- Modify: `e2e/accessibility.spec.ts`
- Modify: `playwright.config.ts` only if the current project matrix cannot express the required width coverage
- Modify: `docs/release-checklist.md` if its mobile checklist is incomplete

**Steps:**

1. Run the full screen matrix in Chromium, iPhone WebKit, and iPad WebKit.
2. Run typecheck, all Node tests, lint, production audit, static build, bundle budgets, and the complete Playwright suite.
3. Review the branch diff for accidental behavior, data, or security changes.
4. Commit the final release-gate and documentation updates.
5. Merge the verified branch into `main`, rebuild the LAN server, and smoke-test the HTTPS URL.
