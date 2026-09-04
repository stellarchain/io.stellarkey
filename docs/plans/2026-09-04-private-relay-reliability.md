# Private Relay Reliability Implementation Plan

> **For the implementing agent:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make browser relay discovery report the real reason for same-account failure quickly and keep opted-in helper browsers visibly connected after WebSocket interruption, without adding a StellarKey server or weakening privacy eligibility.

**Architecture:** Retain Nostr as the encrypted public rendezvous layer because the measured different-account path already returns in about 0.6 seconds and WebRTC would still require signaling plus ICE/STUN/TURN. Extend quote discovery to count, but never select, replies from the active Stellar account. Extend the bounded Nostr transport with connection readiness/status, enable reconnection, and publish a memory-only helper status consumed by Home.

**Tech Stack:** Next.js 16 client components, React 19, TypeScript, `nostr-tools` 2.25.1, Node test runner, Playwright.

---

### Task 1: Distinguish an ineligible same-account helper from an absent peer

**Files:**
- Modify: `tests/private-balance-relay-availability.test.mjs`
- Modify: `tests/private-balance-relay-settings.test.mjs`
- Modify: `tests/private-balance-send.test.mjs`
- Modify: `src/features/private-balance/relay/session.ts`
- Modify: `src/features/private-balance/relay/availability.ts`
- Modify: `src/features/private-balance/components/PrivateRelayAvailability.tsx`
- Modify: `src/features/private-balance/components/usePrivateActionController.ts`

1. Add a behavioral test proving a same-account quote remains unselectable, is counted as ineligible, and settles after the short quiet window instead of the hard no-response deadline.
2. Run the focused relay tests and confirm they fail because no ineligible-peer result exists.
3. Track distinct excluded accounts in `requestQuotes`, emit their count without exposing new data, and start the quiet timer on the first excluded response.
4. Propagate the count through the explicit availability check and actual send discovery.
5. Show targeted copy explaining that another browser using the same Stellar account is online but cannot add privacy; retain the normal no-peer copy otherwise.
6. Run the focused tests and commit the green change.

### Task 2: Make helper connectivity truthful and recoverable

**Files:**
- Modify: `tests/private-balance-relay-transport.test.mjs`
- Modify: `tests/private-balance-relay-settings.test.mjs`
- Create: `tests/private-balance-relay-helper-status.test.mjs`
- Modify: `src/features/private-balance/relay/transport.ts`
- Modify: `src/features/private-balance/relay/nostr.ts`
- Create: `src/features/private-balance/relay/helper-status.ts`
- Modify: `src/features/private-balance/relay/session.ts`
- Modify: `src/features/private-balance/components/PrivateRelayHelperManager.tsx`
- Modify: `src/features/private-balance/components/PrivateRelayEntry.tsx`

1. Add tests requiring reconnect-enabled Nostr pools, an abortable at-least-one-relay readiness boundary, and a memory-only observable helper state.
2. Run the focused tests and confirm they fail for the missing behavior.
3. Add bounded transport readiness/status methods; connect to all configured relays concurrently and succeed once at least one connection is live.
4. Enable `nostr-tools` reconnection and retain its existing ping checks.
5. Start helper subscriptions before awaiting readiness, publish `Connecting`, `Listening`, `Reconnecting`, or `Unavailable` from memory only, and clear status on cleanup.
6. Render the truthful helper state on Home instead of equating a saved preference with a live socket.
7. Run focused unit tests, typecheck, and the helper Playwright flow; commit the green change.

### Task 3: Record the measured decision and verify the complete change

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/private-balance-roadmap.md`
- Modify: `docs/private-balance.md`
- Create: `protocol/private-balance/results/relay-eligibility-repro-2026-09-04.json`

1. Record the sanitized same-account versus different-account experiment: same account answered but settled with zero eligible quotes after the short quiet window; different account yielded one eligible quote in under one second.
2. Update the whitepaper and roadmap to distinguish transport latency, helper eligibility, ephemeral-event readiness, and reconnect behavior. State that WebRTC was not selected because it still needs signaling/ICE infrastructure and can reveal peer network addresses.
3. Add factual `[Unreleased]` changelog entries.
4. Run focused tests, full tests, typecheck, lint, production build, and relevant private UI browser checks.
5. Review the diff for secret/XDR/address/transaction data and commit.
6. Merge into `main`, remove the worktree and feature branch, restart the local server from `main`, and verify `/app` responds.
