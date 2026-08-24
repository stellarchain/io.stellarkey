# iOS PWA Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make hierarchical navigation, scrolling, vault password feedback, and installed-PWA top spacing behave like a polished iPhone app.

**Architecture:** Keep the existing component system and introduce one reusable iOS navigation control plus one pure password-strength helper. Apply global scrollbar suppression without changing overflow behavior. Consume the iOS safe-area inset only in standalone display mode so normal Safari layout remains unchanged.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, Node test runner.

---

### Task 1: Shared iOS Back Control

**Files:**
- Modify: `src/components/ui.tsx`
- Modify: `src/components/SettingsPage.tsx`
- Modify: `src/components/Onboarding.tsx`
- Test: `tests/ios-pwa-ui.test.mjs`

1. Write a failing source-level regression test requiring a shared 44-point, symbol-only `IOSBackButton` with an accessible label.
2. Run `npm test -- tests/ios-pwa-ui.test.mjs` and confirm it fails because the component is absent.
3. Implement the shared control with the existing chevron icon family and use it for Settings and onboarding hierarchy navigation.
4. Run the focused test and the complete suite.
5. Commit as `feat: standardize iOS back navigation`.

### Task 2: Hide Scrollbar Chrome Globally

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/components/Dashboard.tsx`
- Test: `tests/ios-pwa-ui.test.mjs`

1. Write a failing test requiring global Firefox and WebKit scrollbar suppression and no stable scrollbar gutter.
2. Run the focused test and confirm the expected failure.
3. Replace pointer-specific custom rails with global scrollbar suppression while retaining all overflow and touch scrolling behavior.
4. Run the focused test and complete suite.
5. Commit as `style: hide scrollbar chrome across the app`.

### Task 3: Vault Password Strength Meter

**Files:**
- Create: `src/lib/password-strength.ts`
- Modify: `src/components/Onboarding.tsx`
- Create: `tests/password-strength.test.mjs`
- Test: `tests/ios-pwa-ui.test.mjs`

1. Write failing behavioral tests for empty, common, short, passphrase, repeated, and high-entropy-looking passwords.
2. Run the focused tests and confirm the helper import fails.
3. Implement a deterministic offline scorer returning a 0-4 score, label, color, and actionable feedback.
4. Add a four-segment, `role="meter"` component beneath new-vault password fields only; keep the existing eight-character creation minimum.
5. Run focused and complete tests.
6. Commit as `feat: add vault password strength feedback`.

### Task 4: Standalone iOS Safe Area

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/components/Dashboard.tsx`
- Modify: `src/components/Onboarding.tsx`
- Modify: `src/components/LockScreen.tsx`
- Modify: `src/components/WalletApp.tsx`
- Modify: `src/components/Toast.tsx`
- Test: `tests/ios-pwa-ui.test.mjs`

1. Write a failing regression test requiring a standalone-only safe-area token and top-level screen consumption.
2. Run the focused test and confirm the expected failure.
3. Add `app-safe-top` and safe overlay/toast spacing using `env(safe-area-inset-top)` only under `display-mode: standalone`.
4. Apply the class to every app phase and ensure fixed overlays keep controls below the status bar.
5. Run focused tests, all tests, typecheck, lint, production build, and `git diff --check`.
6. Commit as `fix: respect the iOS standalone safe area`.
