# Settings Security Categories Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the Settings security controls into four semantic, mobile-friendly categories without changing behavior.

**Architecture:** Keep the existing `SettingsPage` root grid and `RowButton` controls. Replace only the left-column wrapper with four labelled `section` elements and independent `list-group` containers, preserving callbacks and values exactly.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Playwright WebKit/Chromium.

---

### Task 1: Categorize the Settings security controls

**Files:**
- Modify: `e2e/accessibility.spec.ts`
- Modify: `src/components/SettingsPage.tsx`

**Step 1: Write the failing browser assertion**

After navigating to Settings, require the headings `Recovery`, `Device Security`, `Signing Security`, and `Privacy & Feedback`, and require the old `Security & Backup` label to be absent.

**Step 2: Run the focused test to verify it fails**

Run:

```bash
npx playwright test e2e/accessibility.spec.ts --project=iphone-webkit
```

Expected: failure because the four headings do not exist.

**Step 3: Implement the minimal category split**

In `SettingsPage.tsx`, preserve the left grid column and each existing `RowButton`, but render four `section` elements with accessible heading IDs. Use `space-y-6`, one `list-group` per category, and `sep` only on second/subsequent rows.

**Step 4: Verify focused and release behavior**

Run:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npx playwright test e2e/accessibility.spec.ts --project=desktop-chromium --project=iphone-webkit --project=ipad-webkit
```

Expected: all commands pass with no horizontal overflow or blocking accessibility violations.

**Step 5: Commit**

```bash
git add e2e/accessibility.spec.ts src/components/SettingsPage.tsx
git commit -m "feat: categorize security settings"
```
