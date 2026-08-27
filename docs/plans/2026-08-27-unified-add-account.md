# Unified Add Account Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the promotional standalone Trezor launcher with one neutral Add Account flow that retains secure hardware-wallet onboarding.

**Architecture:** `AddAccountModal` remains the only account-onboarding boundary and continues to lazy-load from the dashboard. Its Hardware mode owns Trezor connection, derivation-index selection, device-side address verification, and import. The separate `TrezorModal` and its dashboard launchers are removed so vendor branding appears only where the selected signing method must be identified.

**Tech Stack:** Next.js 16 client components, React 19 state/effects, TypeScript, Node test runner, Tailwind CSS.

---

### Task 1: Protect the unified onboarding contract

**Files:**
- Create: `tests/account-onboarding.test.mjs`
- Modify: `tests/address-display.test.mjs`

**Step 1: Write the failing test**

Add source-contract assertions that:

- the dashboard has no `TrezorModal`, `trezorModalOpen`, or `Trezor Hardware Suite` launcher;
- the account menu exposes `Add Account` through the same `setAddAccountOpen(true)` path;
- Add Account preloads Trezor Connect only while Hardware mode is selected;
- Hardware mode exposes indices 0 through 4 and clears a previously connected address when the index changes;
- the connected full Stellar address remains visible for comparison with the device;
- sales-style strings from the deleted Trezor modal are absent;
- the deleted modal is no longer part of the address-presentation contract.

**Step 2: Run the focused tests to verify they fail**

Run:

```bash
node --no-warnings --experimental-strip-types --loader ./tests/ts-resolve-loader.mjs --test tests/account-onboarding.test.mjs tests/address-display.test.mjs
```

Expected: FAIL because the dashboard still owns the standalone Trezor modal and Add Account has no usable index selector.

**Step 3: Commit the red test**

```bash
git add tests/account-onboarding.test.mjs tests/address-display.test.mjs
git commit -m "test: define unified account onboarding"
```

### Task 2: Make Add Account the only dashboard onboarding entry

**Files:**
- Modify: `src/components/Dashboard.tsx`
- Delete: `src/components/TrezorModal.tsx`

**Step 1: Remove the duplicate modal state and lazy boundary**

Delete the `TrezorModal` dynamic import, `trezorModalOpen` state, rendered modal, and all calls to `setTrezorModalOpen`.

**Step 2: Route every account-creation launcher to Add Account**

Keep the sidebar `+ Add` control, replace the command-palette hardware-suite action with a neutral `Add account` action, and change the compact account menu prop to `onAddAccount` with an `Add Account` row.

**Step 3: Run the focused dashboard contract test**

Run the focused command from Task 1. Expected: the dashboard assertions pass while the Hardware-mode assertions still fail.

**Step 4: Commit the feature**

```bash
git add src/components/Dashboard.tsx src/components/TrezorModal.tsx tests/account-onboarding.test.mjs tests/address-display.test.mjs
git commit -m "feat: unify dashboard account entry points"
```

### Task 3: Bring secure hardware controls into Add Account

**Files:**
- Modify: `src/components/AddAccountModal.tsx`
- Modify: `src/components/SettingsPage.tsx`

**Step 1: Model the verified hardware account as one object**

Replace the loose public-key string with connected public key, exact path, and index returned by `connectTrezorDevice`. Use those returned values when importing so the stored signer cannot drift from the address the user verified.

**Step 2: Add derivation selection and preload behavior**

Warm Trezor Connect when Hardware mode is active. Render indices `0..4`; selecting a new index clears the connected result and any stale error before another connection attempt.

**Step 3: Rewrite the Hardware mode as product UI**

Use neutral copy explaining that keys remain on the device and the displayed address must match its screen. Keep `Trezor` only as the supported signer/action label, remove model lists and promotional claims, show the full grouped address after connection, and label the final action `Add Hardware Account`.

**Step 4: Remove the unused device-selection prop**

Drop `initialDevice` from Add Account and the redundant Settings state because this build supports only real Trezor transport and already rejects simulated Ledger connections.

**Step 5: Run focused verification**

Run the focused command from Task 1. Expected: PASS.

**Step 6: Commit the feature**

```bash
git add src/components/AddAccountModal.tsx src/components/SettingsPage.tsx tests/account-onboarding.test.mjs tests/address-display.test.mjs
git commit -m "feat: add neutral hardware account onboarding"
```

### Task 4: Verify, merge, and refresh the local app

**Files:**
- Verify all modified files and the generated static output.

**Step 1: Run static checks and the full test suite**

```bash
npm run typecheck
npm run lint
npm test
```

Expected: all commands exit 0 and all tests pass.

**Step 2: Build the production export and check its bundle**

```bash
npm run build
npm run check:bundle
```

Expected: static build and bundle budget both pass.

**Step 3: Inspect the final diff and commits**

```bash
git status --short
git diff main...HEAD --check
git log --oneline main..HEAD
```

Expected: only planned files differ, no whitespace errors, and each feature has its own commit.

**Step 4: Merge to `main` and reverify**

Fast-forward `main`, run the focused tests from the merged checkout, rebuild the static export, restart the existing local HTTPS-serving chain, and verify `https://192.168.0.180:3000` serves the new dashboard bundle.
