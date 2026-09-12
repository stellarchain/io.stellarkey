# Private Action Context Recovery Implementation Plan

**Goal:** Stop reporting an unchanged Add funds wallet as a changed context when its worker fails, and preserve a submitted action's pending outcome through worker recovery.

**Architecture:** Distinguish wallet/session authority from the captured worker's readiness. Preparation and proof disclosure require both. Signing a durably reviewed proof, submission, and owned cleanup require current wallet authority, not the continued health of a completed proof worker. Preserve canonical tracking and exposed-input holds. Never retry a transaction automatically.

**Tech stack:** React/Next.js, TypeScript, real vault revocation and worker-client lifetimes, Node test runner, isolated synthetic Chromium/iPhone WebKit component tests.

## Evidence and limits

- The user reports Add funds without switching account or network. Whether this happened before or after Confirm is not yet known.
- The existing provider guard reproduces the exact reported message when only `worker.failed` changes. This does not establish why the user's worker stopped.
- The preparation catch calls the same guard before recovery, replacing a worker error and bypassing its resync.
- Submission also rechecks the old worker after an awaited post-broadcast sync. That sync can replace or clear the worker after a transaction was already sent; it must not convert a pending result into a pre-submission failure.
- Existing footer changes and three pre-existing untracked documents are unrelated and must remain untouched. No real wallet data or funded transaction is part of verification.

## Implementation and verification

1. Add `tests/private-balance-action-context.test.mjs` to exercise the actual provider callbacks with the real action lifetime, worker client, mutex and vault revocation. Replace only external storage/transport/proof boundaries with isolated synthetic adapters. Reproduce worker-error masking and post-broadcast worker replacement; assert genuine context changes still revoke work.
2. Keep the existing action lifetime API. Capture wallet authority separately from preparation readiness; add a monotonic runtime authority epoch for lease loss, effect retirement and authenticated local-data deletion. Worker recovery must not advance that epoch.
3. Update `capturePrivateActionContext` in `src/features/private-balance/runtime/provider.tsx` and its preparation/submission uses. Bind the proof worker inside each mutex attempt and check it before proof disclosure and review publication. Use wallet authority for signing a durably reviewed proof, submission and owned cleanup. Assert authority again after awaited recovery before publishing errors. Preserve a failed worker's original error and allow the existing resync to rebuild it.
4. Cover the reported context error in `src/features/private-balance/copy.ts` without promising that nothing was sent or inviting an automatic retry. Add focused copy regressions. Do not weaken signing, scope, lease, freshness or proof-exposure checks.
5. Exercise Add funds failure/recovery and pending outcomes through the real controls in the isolated component suite. Run focused context, worker, recovery, direct-only and action-operation tests; then typecheck, lint, the unit suite, fixture-clean build checks and relevant browser/accessibility coverage. Record limitations instead of claiming a real deposit succeeded.
6. Update `[Unreleased]` in `CHANGELOG.md` and obtain an independent review of the completed fix. Keep this change separate from the unrelated footer edit.

## Execution evidence

- The original provider failed all 16 initial focused regressions, including reproducing the exact reported cancellation message when only the real worker client crashed. The revised provider passes all 21 focused cases, including the actual lease-loss callbacks, worker replacement before disclosure or review publication, and conservative fallback copy. The broader focused action/worker/recovery/proof-exposure run passed 80 tests.
- Final `npm test`: 1,742 passed, zero failures/skips. `npm run test:private-protocol`: 58 passed, zero failures/skips. `npm run private:check-generated`: passed.
- Application and recovery-fixture typechecks passed. Lint passed with three pre-existing marketing-image warnings.
- All 80 direct-payment and recovery browser cases passed across Chromium and iPhone WebKit, including all six new Add funds worker-failure/pending/uncertain cases. They check real controls, signing approval, retained dialog/backdrop identity, inertness, scroll lock, focus restoration, pending tracking and automated accessibility. No skipped cases or failed attempts in the final run.
- Production build, five bundle tests and bundle budgets passed. Fixture cleanup passed before and after the build and in the running workspace. Browser/build checks used an isolated copy; all five tested implementation/fixture files were verified byte-identical to the main workspace. The original development server remains running at `127.0.0.1:3000`.
- The synthetic browser fixture now supplies exact source-account/SAC deposit authorization, still checked by the production review validator; it injects real worker error events before building and during pending/uncertain submission. No real-wallet browser data, external submission, screenshots, traces or video are used.
- Independent scoped review found no blockers. A separate pre-existing follow-up remains: `watchBroadcastOutcome`'s detached reconciliation should gain its own revocable publisher authority. This patch guards watcher startup, not its later detached publication.
- No release verification, tag, commit, funded transaction, human assistive-technology or physical-device claim is made by these checks.

## Detached watcher follow-up — 2026-09-12

The detached-publication follow-up above is now addressed. Outcome watchers capture revocable wallet/runtime authority, check it across polling and reconciliation awaits, and serialize journal classification with canonical sync. A completed proof worker may still fail independently. Revocation stops publication and further polling, without undoing an already-authorized durable journal commit.

Thirty new failing regressions established the missing behavior before the fix. The focused action-context, submission, mutex and proof-exposure run then passed all 89 cases, including lock/unlock and lease-loss/reacquisition races, scope/endpoint changes, unmount, queued recovery, and transport/reconciliation failures. These are synthetic, in-memory checks of the production callbacks and vault guards, not evidence of a funded transaction.
