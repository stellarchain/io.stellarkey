# UI and recovery integration plan

**Goal:** Merge the `revoke-stealth-discovery` worktree's UI/UX and animation design into `main`, preserving `main`'s recovery, signing, session and transaction-safety logic wherever the changes overlap.

**Architecture:** Integrate a stable source snapshot on a separate worktree. Keep the new shared dialog shells, sheet/card/alert presentation, footer/header layout, motion and feedback conventions. Compose the current recovery action into those shells instead of replacing its consent, reservation or signing flow.

**Stack:** Next.js 16.3.3, React 19.2.8, TypeScript, existing encrypted private-balance runtime, Node tests and privacy-safe synthetic Playwright checks.

## Source and boundaries

- `main`: `fcdeabd3cb40343bac2fb0fcfc36e9709740550a`; fresh merged-main verification passed 1,765 Node tests before this task.
- Source: the uncommitted UI work on `feat/modal-ios-consistency`, based on `4e276f82bc3bdaf0fb2cc830ce627024de7a71b6`.
- Source snapshot: `8a432eb5f584667c1071596f616c9c325b3e6c7d`, tree `e850c7fa7caf1dcaa9120369bfcd7ef6c4e98fd8`, on `snapshot/modal-ios-consistency`. A separate temporary Git index captured 156 changed/new files, excluding `src/app/private-component-fixture/`. Two successive source-tree captures matched. The original worktree/index and running tests were not changed.
- Integration branch/worktree: `integration/stealth-ui-recovery` at `.worktrees/stealth-ui-recovery`.
- Do not merge remote dependency branches, change cryptography/contracts/manifests, fund wallets, push, release, or stop unrelated processes. Preserve the three original untracked documents in the main worktree.

## Steps

1. Verify the fresh integration-worktree baseline with `npm test`; inspect the new shared modal and lazy-shell ownership boundaries.
2. Merge the source snapshot without committing. Resolve overlapping `PrivateActionReview.tsx`, `PrivateBalanceCard.tsx`, `PrivateRecovery.tsx`, `tests/private-balance-recovery-ui.test.mjs` and changelog entries explicitly. Keep the current private runtime, wallet signer and recovery lineage unchanged.
3. Preserve the source's embedded `PrivateRecoveryContent` path while keeping the direct held-balance shortcut available. Share content and busy reporting; all dismissal paths remain blocked during signing/history restoration but local proof preparation remains intentionally cancellable. Keep proof consent and password approval separate.
4. Run the existing recovery and signing regressions before fixing any integration failures. Add focused behavioral coverage for any new failure before production fixes. Exercise the combined controls through the actual wallet/provider/worker, both canonical winners, stale consent/signing, and delayed cleanup.
5. Run full Node tests, application/fixture type checks, lint, required synthetic component checks and relevant public overlay/motion/accessibility checks on Chromium and iPhone WebKit. Keep screenshots, traces and video disabled and diagnostics structural. Verify shell/backdrop identity, busy policy, focus, inertness, scroll locks, rapid changes, exit geometry and reduced motion.
6. Review the combined change independently, including lazy private bodies, secret clearing, motion ownership and safe transaction publication. Do not lower an existing test or budget gate merely to accept the merge; validate the source's documented budget changes against the build graph.
7. Update `[Unreleased]` for any integration-specific user-visible/safety changes, build the static export after fixture cleanup, check bundle budgets, and record exact verification results and human-test limitations here.
8. Commit the verified integration, fast-forward local `main` only if its tip has not moved unexpectedly, and verify the merged result. Remove only clean, inactive, fully merged temporary branches/worktrees. Compare the original active worktree against the source snapshot before any cleanup; preserve later edits or active processes.

## Acceptance

- iPhone sheet/card/alert layout, new shared chrome, motion, focus and feedback design are retained.
- Held-input recovery, explicit proof sharing, original-versus-recovery race handling, durable reservations, vault/account/network/provider revocation and the before-sign guard remain intact.
- No new lazy boundary owns a dialog shell or triggers private data without intent; sensitive content is cleared on close while only non-sensitive exit geometry is retained.
- User files and the existing main development server remain available. Automated checks do not stand in for human VoiceOver/NVDA or physical-device testing.
