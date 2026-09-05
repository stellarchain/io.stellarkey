# Immediate Nostr Helper Selection Implementation Plan

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
