# Subtle Asset Favorite Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the asset-modal favorite control visually quieter without changing its behavior or accessibility.

**Architecture:** Keep favorite state and persistence in `Dashboard` and retain the existing `AssetDetailModal` props. Change only the modal presentation and add source-level regression assertions for the compact treatment.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 4, Node test runner.

---

### Task 1: Specify the compact favorite row

**Files:**
- Modify: `tests/ios-pwa-ui.test.mjs`

**Step 1: Write the failing test**

Extend the asset favorite test to require a `min-h-11` neutral row, the `Favorite` label, and a trailing selected checkmark. Assert that `Favorite asset`, `Favorites appear first on Home`, and the visible `On`/`Off` status are absent.

**Step 2: Run the test to verify it fails**

Run: `node --test --test-name-pattern="asset favorites" tests/ios-pwa-ui.test.mjs`

Expected: FAIL because the current control is a prominent gold card with subtitle and status text.

### Task 2: Implement and verify the quieter control

**Files:**
- Modify: `src/components/AssetDetailModal.tsx`
- Test: `tests/ios-pwa-ui.test.mjs`

**Step 1: Write the minimal implementation**

Replace the large favorite card content with a compact neutral row. Preserve the callback, `aria-pressed`, and asset-specific `aria-label`; use gold only for the active star and a small trailing checkmark.

**Step 2: Run focused verification**

Run: `node --test --test-name-pattern="asset favorites" tests/ios-pwa-ui.test.mjs`

Expected: PASS.

**Step 3: Run the release gate**

Run: `npm test && npm run typecheck && npm run lint && npm run build && npm run check:bundle`

Expected: all tests and checks pass.

**Step 4: Commit**

Commit the tested UI refinement, merge it to `main`, restart the static server, and verify the updated chunk over HTTPS.

