# On-shift Operators Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a local-only multi-operator roster with one PIN-verified current operator and a simpler iOS-style switching interface.

**Architecture:** Extend the reconciled encrypted merchant store with an on-shift staff roster and operator-lock preferences. Keep authorization bound to the existing in-memory PIN session, expose focused roster actions through `useMerchant`, and replace the always-visible switch form with modal PIN and lock controls.

**Tech Stack:** Next.js 16 App Router, React 19 client components, TypeScript, Node test runner, Tailwind CSS.

---

### Task 1: Persist and reconcile the operator roster

**Files:**
- Create: `src/lib/merchant/operators.ts`
- Modify: `src/lib/merchant/types.ts`
- Modify: `src/lib/merchant/defaults.ts`
- Modify: `src/lib/merchant/storage.ts`
- Modify: `src/lib/merchant/setup.ts`
- Modify: `src/lib/merchant/permissions.ts`
- Test: `tests/merchant-operators.test.mjs`
- Test: `tests/merchant-storage.test.mjs`

1. Write tests for roster activation, locking, removal, setup defaults, and malformed persisted IDs.
2. Run the focused tests and verify they fail because the roster API is absent.
3. Add the minimal schema, reconciliation, and pure roster transitions.
4. Run the focused tests and verify they pass.

### Task 2: Expose secure session actions and lock policies

**Files:**
- Modify: `src/hooks/useMerchant.tsx`
- Test: `tests/merchant-operators.test.mjs`
- Test: `tests/merchant-runtime.test.mjs`

1. Add failing source and behavior tests for PIN-gated roster entry, explicit locking, roster exit, and timeout setup.
2. Run the focused tests and verify the expected failures.
3. Expose `onShiftStaff`, `lockStaffSession`, and `endStaffSession`; extend `switchStaff` to join the roster.
4. Add inactivity listeners and lock immediate till settlements after a sale when configured.
5. Run the focused tests and verify they pass.

### Task 3: Replace the active-operator form with the on-shift interface

**Files:**
- Modify: `src/components/merchant/StaffTerminalsPage.tsx`
- Test: `tests/merchant-permissions.test.mjs`
- Test: `tests/merchant-runtime.test.mjs`

1. Add failing surface tests for the new labels, roster controls, modal PIN entry, and removal of the persistent switch form.
2. Run the focused tests and verify the expected failures.
3. Build the compact current-operator row, roster buttons, add-operator flow, PIN modal, and locking modal.
4. Verify mobile touch targets, accessible names, focus behavior, and error announcements.
5. Run the focused tests and verify they pass.

### Task 4: Full verification and feature commit

**Files:**
- Verify all changed files and existing merchant behavior.

1. Run type checking, the complete unit suite, lint, and production build.
2. Inspect the final diff and confirm `.playwright-mcp/` is untouched.
3. Commit the feature to `main` with a focused message.
