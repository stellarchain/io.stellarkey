# iOS Tax Records Hub Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the long Tax Records form with a summary-first iOS/iPadOS records hub and focused task sheets without changing reporting arithmetic or requiring a backend.

**Architecture:** Keep `TaxRecordsPage` as the data owner and introduce one discriminated `activeSheet` state. The root renders current-period figures and disclosure rows only; sheet content owns export controls, retention, archive explanation, rates, history, and compliance details. Reuse the shared `Modal`, `ModalHeader`, `SettingsRow`, `SettingsSection`, and `SheetBody` primitives.

**Tech Stack:** Next.js 16 client components, React 19, TypeScript, Tailwind CSS 4, Node test runner, Playwright.

---

### Task 1: Define the native records hierarchy

**Files:**
- Modify: `tests/settings-layout.test.mjs`
- Modify: `tests/merchant-reporting.test.mjs`

**Step 1: Write the failing tests**

Assert that `TaxRecordsPage.tsx` declares a single `TaxRecordsSheet` state, renders a summary-first `data-tax-records-hub`, uses `lg:grid-cols-2`, supplies dialog disclosure rows for export, archive, retention, rates, history, and compliance, and keeps `Select`/date inputs outside the marked root hub region.

**Step 2: Run tests to verify they fail**

Run: `node --no-warnings --experimental-strip-types --loader ./tests/ts-resolve-loader.mjs --test tests/settings-layout.test.mjs tests/merchant-reporting.test.mjs`

Expected: FAIL because the existing page is a single long form with no sheet state or hub marker.

**Step 3: Commit the tests**

```bash
git add tests/settings-layout.test.mjs tests/merchant-reporting.test.mjs
git commit -m "test: define iOS tax records hub"
```

### Task 2: Build the summary-first hub

**Files:**
- Modify: `src/components/merchant/TaxRecordsPage.tsx`

**Step 1: Implement the root hierarchy**

Add `TaxRecordsSheet = "period" | "rates" | "export" | "archive" | "retention" | "history" | "compliance"`, `activeSheet`, and one `openSheet()` helper. Render the selected period as a disclosure row beside the current figures in a primary summary surface. Render grouped `SettingsRow` actions with visible current values and `opensDialog` semantics. Use a one-column phone layout and `lg:grid-cols-2` iPad/desktop layout.

**Step 2: Keep root interactions read-focused**

Ensure report format, date range, basis, retention selector, preview output, downloads, export history details, and compliance prose do not render inside `data-tax-records-hub`.

**Step 3: Run the focused tests**

Run the Task 1 test command.

Expected: PASS.

**Step 4: Commit the hub**

```bash
git add src/components/merchant/TaxRecordsPage.tsx
git commit -m "feat: redesign tax records as an iOS hub"
```

### Task 3: Add focused sheets and polished states

**Files:**
- Modify: `src/components/merchant/TaxRecordsPage.tsx`
- Modify: `e2e/merchant.spec.ts`

**Step 1: Write the failing browser journey**

Open Tax Records at an iPhone viewport, assert the hub does not overflow horizontally, open Export report, verify the focused form and action buttons, close it, and verify focus returns to the disclosure row.

**Step 2: Run the focused Playwright test and verify it fails**

Run: `npx playwright test e2e/merchant.spec.ts --grep "Tax records hub" --project=webkit-iphone`

Expected: FAIL until the new named journey and sheet interaction exist.

**Step 3: Implement sheet content**

Use one shared `Modal`. Period selection owns the available period list. Export owns format, dates, basis, preview, and export actions. Retention owns its selector and explanation. Archive has a scoped explanation and download action. Rates and history use grouped read-only rows with clear empty states. Compliance contains the concise product-boundary disclosure.

**Step 4: Run focused source and browser tests**

Run the Task 1 command and the focused Playwright command.

Expected: PASS.

**Step 5: Commit the sheets and journey**

```bash
git add src/components/merchant/TaxRecordsPage.tsx e2e/merchant.spec.ts
git commit -m "feat: add focused tax record sheets"
```

### Task 4: Release verification and integration

**Files:**
- Verify only

**Step 1: Run source quality gates**

Run: `npm test && npm run typecheck && npm run lint`

Expected: 447+ tests pass, typecheck and lint exit 0.

**Step 2: Run the production gates**

Run: `npm run build && npm run check:bundle`

Expected: static export succeeds and the initial JavaScript budget passes.

**Step 3: Inspect the complete diff and self-review**

Verify accessibility, one-sheet-at-a-time behavior, 44-point targets, iPhone overflow, iPad layout, local-only persistence, and unchanged reporting truthfulness.

**Step 4: Merge and restart**

Fast-forward `main`, restart the static server on `127.0.0.1:3003`, and verify `https://192.168.0.180:3000/` plus generated assets return HTTP 200.
