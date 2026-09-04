# Fast Private Relay Discovery Implementation Plan

> **For the implementing agent:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make private relay peers and their fees appear as soon as valid offers arrive, while preserving a short comparison period and the existing privacy boundaries.

**Architecture:** Keep discovery explicitly user-triggered and client-only. Let Nostr publishing continue after the first configured relay acknowledges the event, then collect quotes until either no peer answers before the hard deadline or valid quote traffic has been quiet for 700 ms. Stream ranked, deduplicated offers to the availability UI immediately; the payment picker opens after the quiet window so its selectable snapshot is stable.

**Tech Stack:** Next.js client components, React state, TypeScript, nostr-tools, Node test runner, Tailwind utilities.

---

### Task 1: Unblock on the first relay acknowledgement

**Files:**
- Modify: `src/features/private-balance/relay/nostr.ts`
- Modify: `tests/private-balance-relay-transport.test.mjs`

**Step 1: Write the failing test**

Add a test for an exported relay-publish helper using two deferred attempts. Resolve the first attempt and assert the helper resolves with that relay before the second attempt settles. Add an all-failed assertion returning no accepted relay.

**Step 2: Run test to verify it fails**

Run: `node --no-warnings --experimental-strip-types --loader ./tests/ts-resolve-loader.mjs --test tests/private-balance-relay-transport.test.mjs`

Expected: FAIL because the first-success helper is not exported.

**Step 3: Write minimal implementation**

Use `Promise.any` over the configured publish promises, map the first fulfilled promise to its relay URL, and return a one-entry success map. Return an all-false map only after every attempt rejects. Keep the remaining attempts observed by `Promise.any` so later rejection cannot become unhandled.

**Step 4: Run test to verify it passes**

Run the focused transport test and expect all cases to pass.

**Step 5: Commit**

Commit as `perf: unblock private relay publishing early`.

### Task 2: End discovery adaptively and stream ranked offers

**Files:**
- Modify: `src/features/private-balance/relay/session.ts`
- Modify: `src/features/private-balance/relay/availability.ts`
- Modify: `tests/private-balance-relay-availability.test.mjs`

**Step 1: Write the failing tests**

Instantiate the sender session with a controlled messenger. Verify that one valid quote ends discovery after a short injected quiet window instead of the hard timeout, a later unique quote resets the quiet window, no quote waits for the hard timeout, abort cancels both timers, and progressive callbacks receive ranked, deduplicated, self-excluded quotes.

**Step 2: Run test to verify it fails**

Run the focused availability test. Expect failures because `settleWindowMs` and `onQuotes` do not exist and discovery always waits for `quoteWindowMs`.

**Step 3: Write minimal implementation**

Add a validated `settleWindowMs` option defaulting to 700 ms and an optional `onQuotes` callback. Start the hard deadline before publishing. After every accepted quote-set change, emit the ranked snapshot and restart the quiet timer. Resolve on the quiet timer or hard deadline, and clear timers, subscriptions, and abort listeners in every outcome.

Pass the progressive callback through `checkPrivateRelayAvailability`, with `checkedAt` set when each snapshot is emitted.

**Step 4: Run test to verify it passes**

Run focused availability, send, and relay settings tests. Expect all cases to pass.

**Step 5: Commit**

Commit as `perf: settle private relay quotes adaptively`.

### Task 3: Surface instant progress without destabilizing the modal

**Files:**
- Modify: `src/features/private-balance/components/PrivateRelayAvailability.tsx`
- Modify: `e2e/private-balance/setup.spec.ts`
- Modify: `tests/private-balance-relay-availability.test.mjs`

**Step 1: Write the failing tests**

Assert that the component passes an `onQuotes` callback, exposes “Finding peers” before the first result, changes to “Comparing fees” when a progressive quote exists, keeps the ranked rows visible while checking, and retains an `aria-live` status.

**Step 2: Run test to verify it fails**

Run the focused availability test. Expect the new state copy and callback wiring assertions to fail.

**Step 3: Write minimal implementation**

Update state from progressive snapshots without clearing valid rows. Show “Finding peers…” only before the first offer and “Comparing fees…” after it. Present the live count immediately and keep the final availability caveat. Use only transform/opacity-safe existing interaction styles and do not remount the modal shell.

**Step 4: Run test to verify it passes**

Run focused unit tests and the relay modal E2E case.

**Step 5: Commit**

Commit as `feat: stream private relay offers in the UI`.

### Task 4: Document and verify the behavioral change

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/private-balance.md`
- Modify: `docs/private-balance-roadmap.md`

**Step 1: Update documentation**

Document first-ack publishing, immediate progressive offers, the 700 ms fee-comparison quiet window, hard no-response deadline, and the absence of background presence polling.

**Step 2: Run focused verification**

Run relay transport, availability, settings, send, docs, and relevant E2E tests.

**Step 3: Run full verification**

Run `npm run typecheck`, `npm run lint`, `npm run build`, the bundle budget check, and `npm test`.

**Step 4: Remove release-excluded plan file**

The repository release gate excludes `docs/plans`. Remove this implementation-only plan before final verification and record that cleanup in a dedicated commit.

**Step 5: Commit**

Commit documentation and verification evidence as separate logical commits, then use the finishing-a-development-branch workflow to merge and clean up.
