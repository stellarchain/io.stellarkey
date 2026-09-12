# Immediate Nostr Helper Selection Implementation Plan

> Historical record: peer relaying and helper earnings were removed on 2026-09-10.
> Relay instructions, measurements, and proposals below are not current functionality.
> See [the current whitepaper](private-balance.md) for direct submission and legacy recovery.

> **For the implementing agent:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow explicit selection of an authenticated helper during discovery for payments and every consolidation step, without changing network privacy or proof authorization.

**Architecture:** Discovery exposes its authenticated request alongside live quote snapshots. The controller owns the session as soon as a live quote is exposed and transfers it atomically to selection; stopping discovery cancels only its subscription/publication, never the selected session. Consolidation's explicit choice supports bounded streaming updates. The picker preserves peer row identity/order while identifying the lowest currently available fee.

**Tech Stack:** TypeScript, React 19 client components, existing Nostr v2 sessions, Node test runner and isolated Playwright synthetic fixtures.

---

## Scope and constraints

- Preserve the default 700 ms quiet comparison and hard no-response deadline when no choice is made.
- No automatic helper choice, direct submission fallback, new services/dependencies, cross-payment socket pooling, simulation removal, or changes to authentication, padding, fee caps, proof consent, exposure reservations, and canonical confirmation.
- Quote selection freezes a copy of the exact offer. Ignore late results after choice/cancel/replacement; preserve explicit selection for each chain step.
- Keep dialog shells, focus management, locks and tabs unchanged. Test actual picker/review components with synthetic fixtures and network capture disabled.
- Preserve unrelated untracked files in the main workspace. Work in `.worktrees/nostr-flow` on `feat/nostr-flow`.
- Repository release policy excludes `docs/plans`; retain this implementation record alongside maintained documentation instead of the planning skill's default directory.

## Task 1: Streaming selection primitives

Files: `relay/session.ts`, `relay/chain-choice.ts`, `tests/private-balance-relay-availability.test.mjs`, `tests/private-balance-relay-chain-choice.test.mjs`.

1. Add failing tests for live request context, subscription-only cancellation, immutable quote snapshots, streaming fee-cap enforcement, expired/replaced/duplicate choices, and cleanup.
2. Run focused tests and confirm failures arise from missing behavior.
3. Expose request context with the existing authenticated quote callback. Extend explicit chain choice with opt-in streaming updates; preserve static callers.
4. Run focused tests; keep authentication/exclusion and quiet-window tests passing.

## Task 2: Controller and stable interactive picker

Files: `components/usePrivateActionController.ts`, `components/PrivateActionReview.tsx`, `components/PrivateRelayQuotePicker.tsx`, synthetic fixture/tests and focused controller regression tests.

1. Add failing behavioral tests for selecting while comparing, late offers, stable row/shell identity, keyboard selection, cancellation/replacement and chain-step fee caps.
2. Expose ordinary discovery context before updating visible quotes. Transfer session ownership before canceling collection. Separate chain collection cancellation from the approved chain signal.
3. Enable only live comparison/choice buttons; disable during negotiation. Preserve peer row order and show a truthful lowest-fee badge independent of row number. Announce optional waiting accessibly.
4. Run focused Node tests and synthetic Chromium/iPhone WebKit checks; no live wallet/network traffic or captures.

## Task 3: Documentation, verification and review

Files: `CHANGELOG.md`, `docs/private-balance.md`, this plan.

1. Document optional early selection and unchanged privacy boundaries; do not claim measured production speedups.
2. Run focused tests, full Node tests, fresh TypeScript, lint and build/bundle checks as applicable.
3. Request independent code review, resolve important issues, rerun affected checks.
4. Commit one logical feature with its Unreleased entry; hand off branch/integration choice. Do not publish or deploy.

## Verification commands

```sh
node --no-warnings --experimental-strip-types --loader ./tests/ts-resolve-loader.mjs --test tests/private-balance-relay-availability.test.mjs tests/private-balance-relay-chain-choice.test.mjs tests/private-balance-relay-transport.test.mjs
node scripts/test-private-components.mjs
npx tsc --noEmit --incremental false
npm test
npm run lint
npm run build
npm run test:bundle
npm run check:bundle
```

Expected: focused regression tests fail before implementation; all relevant checks pass afterward. Record limitations and pre-existing failures explicitly.

## Implementation and verification record — 2026-09-05

Implemented explicit live helper selection for ordinary payments and each consolidation step, immutable authenticated discovery snapshots, stable peer rows (including disabled expired slots), cancellation-safe session handoff, account-context cleanup, and duplicate chain-choice protection.

Independent review found and verified fixes for socket ownership and reconnect cleanup: a cancelled discovery waiter cannot close a selected session's socket; a per-physical-socket setup deadline closes stalled attempts; late orphaned sockets close without affecting a replacement connection. The installed Nostr library's event verification, connection-wait default, ping and reconnect behavior remain enabled. No dependencies changed.

Verification against the completed implementation:

- Focused relay regression tests: 58 passed in independent review, with no remaining Critical or Important findings.
- Full Node suite (`npm test`): 1,382 passed, zero failures.
- Synthetic browser suite (`node scripts/test-private-components.mjs`): 22 passed across Chromium and iPhone WebKit. Coverage includes live selection, stable rows, keyboard access, stale results, cancellation, account-context changes, per-step chain selection, duplicate taps and native browser socket setup deadlines.
- Fresh TypeScript (`npx tsc --noEmit --incremental false`): passed.
- Lint (`npm run lint`): zero errors; three existing marketing-image warnings remain.
- Production build (`npm run build`): passed; the temporary synthetic fixture route was removed and is absent from the production route list.
- Bundle regression tests (`npm run test:bundle`): five passed. All named bundle budgets passed (`npm run check:bundle`); the private-balance feature is 70,849 gzip bytes across two chunks.
- Staged whitespace/error check (`git diff --cached --check`): passed.

Browser fixtures used synthetic data and exact-local-origin network interception, with screenshots, video and traces disabled. No live wallets, relay broadcasts, payment transactions, or sensitive data capture were used. Automated accessibility checks ran; human VoiceOver/NVDA and physical-device checks were not performed. This is not a formal cryptographic audit or a release certification; the complete release gate was not run for this non-release branch.

The latency improvement is limited to skipping the remaining comparison wait after an explicit choice. No production latency measurements were collected. Cross-payment socket pooling, simulation reuse, P2P transport, and existing dependency audit findings remain outside this change. The branch is not merged, published or deployed as part of this implementation.
