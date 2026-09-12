# Private Receive Recovery and Sheet Design Implementation Plan

**Goal:** Replace Receive's false endless-loading screen with actionable runtime states and simplify the receive sheet using Apple's hierarchy, feedback and sheet guidance.

**Architecture:** Keep the existing Modal, persistent Public/Private Tabs, lazy private panel and runtime authority boundaries. The receive panel presents the actual runtime state; it never equates a missing address with active loading. Recovery invokes existing sync or explicit tab takeover without resetting local data, automatically rotating an address, or creating a new payment. Existing sync can resume previously authorized signed direct transactions; the UI does not promise that sync can never submit anything.

**Tech stack:** Next.js 16.3.4, React 19, Tailwind 4, shared controls, Node regression tests and isolated synthetic Chromium/iPhone WebKit checks.

## Evidence and constraints

- The user supplied a screenshot of Private/Shielded receive stuck on “Your address is loading — one moment”, then reported “Stopped safely” in private status. The underlying runtime exception was not available; deployment metadata is not an error diagnosis.
- `PrivateReceiveContent` currently checks only `configured` when the address is missing. It ignores runtime phase/error, leadership and reusable-address discovery state. A foreground sync failure deliberately clears the worker/address and publishes `safe-error` while retaining `configured`, reproducing the false loading screen.
- The outer Receive shell does not currently forward private address-rotation busy state. Local asynchronous QR, rotation and retry publication must remain owned by the active opening/account/network and address request.
- Existing uncommitted Add-funds fixes, footer edits and user documents must remain intact. Implement in the running main workspace; use an isolated mirrored workspace for synthetic browser checks. Production builds can run in main after fixture-clean validation: `next.config.ts` separates development (`.next-dev`) from production (`.next`), preserving the running development session.
- Do not access a real wallet, fetch wallet RPC data, log/render captured secrets, retain wallet screenshots, or change cryptography, deployment or stored-data formats.

## Design direction

Keep Public/Private as the only broad segmented switch. Replace the floating asset pill and second wide segmented bar with a compact group of labelled Asset and Address type rows using the existing Select. The QR and address become the focal point, Copy Address the primary action, and Share/Save/New address secondary actions. Keep the privacy differences visible and place protocol/reuse explanation in a disclosure.

Use the application's existing Apple-style system typography, spacing, touch targets and restrained surfaces. Do not add fonts, imagery, animation libraries, new modal primitives or a separate address-choice screen. All states use the same padded content geometry; errors must not escape the scrollable body or obscure Close.

## Implementation steps

1. Add failing receive-state and real-control regressions for configured safe-error, genuine loading, follower takeover, missing reusable address, retained valid address, lock/session replacement and failed/repeated explicit retry.
2. Add a small deterministic receive-state selector and use it in `src/features/private-balance/components/ReceivePrivate.tsx`. Separate loading, stopped/unavailable, other-tab and setup states. Show the safe error presenter and explicit Sync/Use in This Tab actions as appropriate. Never release reservations or automatically rotate/repeat an action.
3. Redesign `PrivateReceiveContent` and the private branch of `src/components/ReceiveModal.tsx` with grouped labelled controls. Preserve the shared Modal/Tabs shell, manual tab activation, owning-modal Select portal, urgent selection feedback, privacy disclosures and native Close/Escape behavior.
4. Bind QR success/failure, retries and rotation feedback to current ownership; clear private content on close or scope replacement. Forward actual private mutation busy state to its owner without treating background sync as a reason to trap the user.
5. Extend isolated fixtures to exercise actual Receive controls and at least one real provider stop/recovery path. Test shell/backdrop identity, inertness, scroll locks, pointer/keyboard selection, stale results, close/reopen, reduced motion, 200% reflow and iPhone WebKit. Disable screenshots/traces/video and report fixed labels/structural accessibility diagnostics only.
6. Run focused regressions, affected continuity/QR/accessibility suites, typecheck, lint, full unit tests and fixture-clean production build/bundle checks. Update `[Unreleased]` and obtain independent review. Record the underlying runtime-cause limitation if no new evidence identifies it.

## References

- [Apple sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)
- [Apple feedback](https://developer.apple.com/design/human-interface-guidelines/feedback)
- [Apple loading](https://developer.apple.com/design/human-interface-guidelines/loading)
- [Apple segmented controls](https://developer.apple.com/design/human-interface-guidelines/segmented-controls)

## Verification

- Reproduced the old stopped-address UI using the actual receive component before implementing the fix.
- Receive-state, canonical payload, and actual provider callback regressions: 45 passed, including session revocation, queued rotation, and stale durable-commit completion.
- Complete unit suite: 1,758 passed, zero skipped.
- Typecheck passed. Lint passed with the same three existing marketing `<img>` warnings; changed source files have no warnings.
- Main-workspace production build passed, with fixture-clean checks before and after. All five bundle tests and every existing JavaScript/artifact budget passed without raising limits. The development server stayed running on port 3000.
- Affected direct-runtime, recovery, QR and modal-ownership suites: 196 Chromium/iPhone WebKit checks passed, zero skipped. This includes actual Receive recovery under reduced motion, animation and 200% equivalent reflow, manual keyboard activation, rapid switching, shell/backdrop identity, scroll locks and structural accessibility audits.
- Final Receive pass: 26 Chromium/iPhone WebKit checks passed, zero skipped, including explicitly delayed real-provider rotation, disabled dismissal/type/asset controls during mutation, synchronous disposal of stale private output, session revocation/ABA, and the existing address-migration publication tests. The final production build and all bundle checks passed again after these changes.
- Generated protocol artifacts and provenance verification passed; cryptography, deployment bindings and stored-data formats remain unchanged.
- Independent review identified and resolved pre-paint busy propagation, vault-session provenance, stale worker cleanup, and queued root-borrow checks.
- Verification uses isolated synthetic vaults and controlled transports, with screenshots, traces and video disabled. No real wallet/session was inspected. Human VoiceOver/NVDA and physical-device pinch checks remain unperformed.
- This fixes the false loading/dead-end presentation and provides explicit recovery. The underlying exception that stopped the user's original runtime remains unidentified because only generic status/deployment metadata was supplied. A persistent external failure will remain visible and retryable; it is not represented as a successful connection.
- This is not release approval: the full 588-case synthetic suite was intentionally stopped to narrow this task's verification, and `release:verify` was not run from the dirty worktree. No commits, tags, deployments, dependency updates, or published release changes were made.
