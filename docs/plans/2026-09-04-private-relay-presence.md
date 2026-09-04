# Private Relay Presence Implementation Plan

> **For the implementing agent:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an explicit, privacy-preserving relay availability check and make fee-based peer selection clearer.

**Architecture:** Reuse the existing bounded quote request as a live capability probe. Normalize short-lived replies in a pure helper, close every probe session deterministically, render memory-only availability in the existing relay modal, and prune expired helper state.

**Tech Stack:** React 19 client components, Next.js 16 App Router, TypeScript, Nostr transport, Node test runner.

---

### Task 1: Rank and probe live relay offers

**Files:**
- Create: `src/features/private-balance/relay/availability.ts`
- Modify: `src/features/private-balance/relay/session.ts`
- Test: `tests/private-balance-relay-availability.test.mjs`

**Step 1: Write the failing tests**

Test that quote normalization removes expired replies, keeps the lowest quote for a duplicate peer account, and sorts fees ascending. Test that `checkPrivateRelayAvailability` always closes its injected session on success and failure.

**Step 2: Verify RED**

Run: `npm test -- tests/private-balance-relay-availability.test.mjs`

Expected: FAIL because `relay/availability.ts` does not exist.

**Step 3: Implement the minimum behavior**

Create `rankPrivateRelayQuotes(quotes, nowSeconds)` and `checkPrivateRelayAvailability(input, signal, createSession)`. The check calls `requestQuotes`, returns ranked replies plus `checkedAt`, and closes the session in `finally`. Use the ranking helper for transaction quote results too.

**Step 4: Verify GREEN**

Run: `npm test -- tests/private-balance-relay-availability.test.mjs tests/private-balance-relay-transport.test.mjs`

Expected: all selected tests pass.

### Task 2: Add the explicit availability UI

**Files:**
- Create: `src/features/private-balance/components/PrivateRelayAvailability.tsx`
- Modify: `src/features/private-balance/components/PrivateRelayEntry.tsx`
- Modify: `src/features/private-balance/components/PrivateRelayQuotePicker.tsx`
- Test: `tests/private-balance-relay-settings.test.mjs`
- Test: `tests/private-balance-send.test.mjs`

**Step 1: Write failing interaction contracts**

Require a manual “Check available peers” button, idle/checking/result/empty/error copy, an `aria-live` status, memory-only state, account and ordinary-unit fee rows, and “Lowest fee” in both availability and transaction pickers.

**Step 2: Verify RED**

Run: `npm test -- tests/private-balance-relay-settings.test.mjs tests/private-balance-send.test.mjs`

Expected: FAIL on the missing availability component and lowest-fee marker.

**Step 3: Implement the client component**

Render it only while the existing modal is open. Read deployment context and local relay preferences, start the check only from the button, cancel on unmount, keep results only in component state, and present honest checked-at language. Do not persist a selected peer; actual payment selection continues to use fresh proof-bound quotes.

**Step 4: Verify GREEN and accessibility contracts**

Run: `npm test -- tests/private-balance-relay-settings.test.mjs tests/private-balance-send.test.mjs`

Expected: all selected tests pass.

### Task 3: Bound helper state, document, and verify

**Files:**
- Modify: `src/features/private-balance/components/PrivateRelayHelperManager.tsx`
- Modify: `src/features/private-balance/relay/session.ts`
- Modify: `docs/private-balance.md`
- Modify: `docs/private-balance-roadmap.md`
- Modify: `CHANGELOG.md`
- Test: `tests/private-balance-relay-settings.test.mjs`
- Test: `tests/private-balance-docs.test.mjs`

**Step 1: Add failing lifecycle/documentation tests**

Require expiry-based request cleanup, quote-cache pruning, and documentation that availability is an explicit live probe rather than durable connectivity.

**Step 2: Verify RED**

Run: `npm test -- tests/private-balance-relay-settings.test.mjs tests/private-balance-docs.test.mjs`

Expected: FAIL on missing cleanup and documentation.

**Step 3: Implement bounded cleanup and documentation**

Prune expired helper quotes before lookup/insertion and remove manager request IDs at expiry. Update `[Unreleased]`, protocol documentation, and roadmap with the new behavior and privacy caveat.

**Step 4: Verify the feature and repository**

Run focused tests, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and `npm run check:bundle`. Inspect `git diff --check` and the final worktree status before integration.
