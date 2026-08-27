# iOS-Style Merchant Settings Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn Merchant Settings from a dense two-column edit form into an iOS-style grouped summary screen with focused, contextual edit sheets.

**Architecture:** Keep `MerchantSettings` as the client-side feature boundary and preserve all local-only persistence through `useMerchant`. The root becomes a stable hierarchy of disclosure rows with concise current-value summaries. A single discriminated `activeSheet` state presents one scoped `Modal` at a time for Business, Payments, Accepted Assets, Tax, Tax Rates, Tips, Settlement, or Device; existing Staff, Tax Records, and Peripherals remain dedicated child pages.

**Tech Stack:** Next.js 16 client components, React 19, TypeScript, Tailwind CSS, existing modal/list primitives, Node test runner, Playwright.

**Design basis:** Apple HIG recommends keeping infrequently changed preferences in Settings, using disclosure indicators for hierarchy, and using sheets only for short, scoped tasks. The redesign follows that distinction: navigation rows on the root, focused forms in sheets, no nested sheets, and explicit confirmation for the destructive Merchant Mode action.

---

### Task 1: Lock the new Merchant Settings contract

**Files:**
- Modify: `tests/settings-layout.test.mjs`

**Step 1: Write the failing source-contract test**

Assert that:

- the responsive two-column root remains;
- the marked root region contains disclosure rows but no inline `DraftInput`, `Select`, `SegmentedControl`, `TextRow`, or `ChoiceRow` editors;
- Business details, Payment setup, Accepted assets, Tax, Tax rates, Tips, Settlement, and This device each open a named settings sheet;
- Tax Records, Staff & terminals, and Peripherals remain direct child-page navigation rows;
- Tax rates are rendered only in their dedicated sheet;
- Turn off Merchant Mode opens a confirmation dialog before calling the persisted disable action;
- the component declares one active sheet state rather than independent overlapping modal flags.

**Step 2: Run the focused test and verify it fails**

```bash
node --no-warnings --experimental-strip-types --loader ./tests/ts-resolve-loader.mjs --test tests/settings-layout.test.mjs
```

Expected: FAIL because the root still contains direct editors and has no focused settings sheets.

**Step 3: Commit the red test**

```bash
git add tests/settings-layout.test.mjs
git commit -m "test: define iOS merchant settings hierarchy"
```

### Task 2: Replace root editing with grouped summary navigation

**Files:**
- Modify: `src/components/merchant/MerchantSettings.tsx`

**Step 1: Add the settings destination model**

Define a `MerchantSettingsSheet` union and one `activeSheet` state. Add `openSheet`, `closeSheet`, and `navigateFromSheet` helpers so sheet dismissal and child-page navigation cannot overlap.

**Step 2: Build the grouped root**

Render two responsive columns of `Section` and `Row` groups:

- Business: Business details and Latest receipt.
- Payments: Payment setup and Accepted assets.
- Checkout: Tax, Tax rates, Tips, and Tax records.
- Settlement: Settlement rules.
- Operations: This device, Staff & terminals, Peripherals, and Offline storage.
- Merchant Mode: the destructive turn-off action.

Each editable category reports its current value and uses a chevron. No text field, picker, segmented control, or toggle remains on the root.

**Step 3: Add destructive confirmation**

The root turn-off row opens a confirmation modal. Only its destructive confirm button calls `handleTurnOff`; cancel and close preserve Merchant Mode.

**Step 4: Run the focused hierarchy test**

Expected: root and confirmation assertions pass; detail-sheet assertions can remain red until Task 3.

**Step 5: Commit the root feature**

```bash
git add src/components/merchant/MerchantSettings.tsx
git commit -m "feat: add iOS merchant settings hierarchy"
```

### Task 3: Move every editor into one focused sheet system

**Files:**
- Modify: `src/components/merchant/MerchantSettings.tsx`

**Step 1: Add the shared sheet shell**

Use the existing `Modal` and `ModalHeader` so focus trapping, visual-viewport handling, safe-area behavior, and scroll locking remain centralized. Sheet titles describe the task, and only one sheet can be open.

**Step 2: Move Business, Payments, and Assets**

- Business details: shop name, tax ID, address, and receipt footer.
- Payment setup: receiving account, display currency, charge expiry, memo-less tolerance, and charge auto-lock behavior.
- Accepted assets: the existing exact-issuer asset toggles and zero-selection warning.

**Step 3: Move Tax, Rates, and Tips**

- Tax: included/added mode and keypad default rate; close the sheet before navigating to Tax Records.
- Tax rates: editable rate names and percentages on its own dedicated surface.
- Tips: prompt mode, percentage/fixed presets, threshold, and net calculation.

**Step 4: Move Settlement and Device**

- Settlement: conversion, slippage, sweep threshold, retained float, treasury, prompt time, due handoffs, blocked explanations, and reserve disclosure.
- Device: terminal name and storage status/action.

**Step 5: Preserve receipt preview without stacking sheets**

Keep Latest receipt on the root so `ReceiptSheet` never opens on top of another settings sheet.

**Step 6: Run focused tests, TypeScript, and lint**

```bash
node --no-warnings --experimental-strip-types --loader ./tests/ts-resolve-loader.mjs --test tests/settings-layout.test.mjs
npm run typecheck
npm run lint -- src/components/merchant/MerchantSettings.tsx tests/settings-layout.test.mjs
```

Expected: all pass.

**Step 7: Commit the sheet feature**

```bash
git add src/components/merchant/MerchantSettings.tsx tests/settings-layout.test.mjs
git commit -m "feat: add focused merchant settings sheets"
```

### Task 4: Browser and release verification

**Files:**
- Modify only if a verified responsive or accessibility defect is found.

**Step 1: Run the merchant browser journey**

```bash
npm run test:e2e:merchant
```

Confirm Merchant Settings still exposes Tax Records, Staff & terminals, and the install handoff through their existing accessible names.

**Step 2: Run the release gate**

```bash
npm run typecheck
npm test
npm run lint
npm run build
npm run check:bundle
```

Expected: every command exits 0.

**Step 3: Inspect and merge**

```bash
git status --short
git diff main...HEAD --check
git log --oneline main..HEAD
```

Fast-forward `main`, rerun the focused settings test, rebuild the static export, restart the existing HTTPS-serving chain, and verify the LAN URL serves the new settings bundle.
