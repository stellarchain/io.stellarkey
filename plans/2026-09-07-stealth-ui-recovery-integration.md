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

## Initial integration review and verification

- Kept `main`'s private runtime, wallet signing context, recovery lineage, proof consent, reservations and canonical confirmation code unchanged. The held-balance shortcut now enters the UI branch's existing Recovery step in the shared Private Payments settings shell.
- Read-only review identified sensitive data retained through exit, still-actionable cancelled confirmations, pinch-zoom restrictions, nested-scroll ownership and drag-cancellation defects. Added failing synthetic browser regressions before fixing these boundaries. Shell appearance and exit geometry remain, while sensitive bodies are removed immediately.
- Added normal/reduced-motion drag cancellation checks, a positive dismissal check, and settings/recovery navigation checks. A nested-sheet test additionally reproduced WebKit restoring focus to the previous panel instead of its tapped opener; pointer/keyboard intent now remains distinct.
- The original UI worktree remains active. Its later tooltip/menu containing-block correction was adopted after the existing iPhone positioning checks reproduced the problem; the original worktree and index remain untouched.
- Final application Node suite: 1,783 passed, zero failed/skipped. Lint: zero errors, three existing marketing-image warnings. Application and focused synthetic-fixture TypeScript checks passed again after all experiments were removed.
- A separate, clean production verification snapshot at `bbc55f745b18939cbae1766879b4f73f76fdc823` excludes the live synthetic route. Static build, fixture-clean checks before/after build, and all five bundle tests passed.
- Measured JavaScript, raw/gzip bytes: landing 646,892/199,341; initial 1,203,028/353,312; unlocked wallet 775,641/171,406; merchant 546,730/150,610; hardware 1,047,527/210,139. These validate the source branch's documented budget re-baseline; no additional limits were raised or checks removed.
- Generated-artifact reproducibility passed in the production-check worktree after installing the separately locked circuit dependencies. No protocol, deployment-manifest or artifact changes were produced.
- Full synthetic component run: 593 of 594 passed, zero skipped. The only failed case was the Chromium 4× CPU-throttled relay-feedback lab check against its existing 100 ms limit. Three isolated integration reruns yielded one pass and two failures; three unchanged-`main` (`fcdeabd`) control runs yielded two passes and one failure at the same assertion.
- Scalar-only diagnostics placed the delay in subsequent paint frames, not the button's state update. A measurement-cache optimization and an entrance-settling experiment did not resolve it and were both reverted, along with all temporary diagnostics. The timing assertion and application code remain unchanged from the reviewed production snapshot.
- Production wallet, merchant, motion and accessibility browser checks: 42 passed, seven platform-specific skips, zero failures across desktop Chromium, iPhone WebKit and iPad WebKit. Required private overlay/continuity/manifest checks: all 16 passed, zero skipped. Browser-protocol tests: all 58 passed.
- Integration was paused before merging into `main` because of the intermittent timing failure. No test limit was raised, case skipped, branch deleted, push made or release tagged.
- Human VoiceOver/NVDA, physical-device pinch and funded-wallet/network checks are not represented by this automation and were not performed.

## Follow-up verification — 2026-09-08

- The user requested that remaining issues be fixed and the result merged into `main`; no failing gate was waived.
- Five fresh, consecutive Chromium runs of the unchanged 4× CPU-throttled feedback test passed without retries, with the original 100 ms maximum intact. Earlier failures remain documented above. The double-frame measurement is a rendering-opportunity lab proxy and includes host scheduling delay; the current evidence does not establish a product-code defect in that case.
- A final read-only review identified a possible abandoned mouse-press defect. A new real-pointer browser regression failed before the fix: leaving the sheet before pointer capture, releasing outside, then hovering back started a drag. Movement now cancels tracking when the primary button is no longer held. The regression also verifies that the next deliberate drag still dismisses.
- All 26 focused integration-safety browser checks passed on Chromium and iPhone WebKit, including normal/reduced-motion abandoned-press cases, subsequent deliberate dismissal, pinch permission, nested scrolling, cancelled confirmations and drag cancellation. The scoped fix passed independent review.
- The unchanged timing assertion failed again during the full clean-worktree run. Temporary scalar-only instrumentation compared both boundaries for the same 15 synthetic clicks: the task after the first frame measured 25.2–49.3 ms, while four second-frame callbacks exceeded 100 ms (up to 131.1 ms). All temporary instrumentation was removed.
- Corrected both lab proxies to observe the expected DOM acknowledgement, then wait for a frame and its zero-delay task. This follows the [Chrome team's post-render approximation](https://codelabs.developers.google.com/understanding-inp#13); it is not an actual INP or physical-display measurement. The original five samples, worst-sample assertion, 4× Chromium CPU throttle and 100 ms maximum remain intact.
- Added deterministic tests that execute the exact E2E measurement callbacks. They failed against the two-frame version and require waiting through acknowledgement and rendering, rejecting DOM-only and pre-render measurements while charging delayed state updates and rendering work above 100 ms.
- All seven measurement regressions passed, followed by ten timing browser runs (five Chromium, five iPhone WebKit), with no failures, skips or retries. Independent review approved the scoped measurement correction.
- The complete `npm run release:verify` command passed from clean snapshot `8d0568c76be562a0e49cb470f3b2b40301d6cf3a` with both fixes included. It passed generated-artifact reproducibility, application type checking, all 1,790 Node tests, all 58 nested browser-protocol tests, lint, the production dependency severity gate, the safe reporter checks, all 16 required overlay/continuity/manifest tests and all 598 required synthetic component tests. Both required browser suites had zero failures, skips or retries.
- Fixture cleanup passed before and after the production build, which passed together with all five build-dependent bundle tests and the bundle-budget check. Final JavaScript raw/gzip bytes: landing 646,915/199,348; initial 1,203,051/353,317; unlocked wallet 775,641/171,406; merchant 546,730/150,610; hardware 1,047,527/210,139.
- The final public browser pass completed 445 cases: 124 passed, 321 expected fixture/environment/platform skips, zero failures or retries. These skips do not replace the dedicated required suites, which ran all their cases above.
- Lint retains three existing marketing-image warnings and no errors. The production audit retains 10 low-severity vulnerable packages; that package count is not a count of distinct advisories. No severity gate was waived, dependency forced, hardware support removed, cryptography replaced, release tagged or remote branch pushed.
- The verification worktree remained clean after the full command. Only this verification record differs from its verified source/test snapshot. Preserve the original dirty UI worktree, its later edits, and the three untracked main-worktree documents during the local merge and temporary-worktree cleanup.
- Human VoiceOver/NVDA, physical-device pinch, funded-wallet/network testing and separate Rust/circuit jobs were not performed by this application verification.
