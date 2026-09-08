# StellarKey UX engineering standards

These are implementation contracts, not visual aspirations. They apply to every wallet and merchant surface.

## 1. Stable interaction identity

- Local state changes must not close, remount, route, or replay the entrance animation of their containing surface.
- Keep navigation, dialog shells, headings, close controls, tab lists, and stable form context outside lazy, Suspense, and asynchronous boundaries.
- Never put a tab-, step-, asset-, or request-dependent `key` on an overlay, portal, backdrop, shell, or ancestor unless the explicit product requirement is to destroy all descendant state.
- Selection feedback is urgent. Update it in the same event turn; do not wait for data, chunks, proofs, prices, or network responses.
- Clear sensitive state explicitly at the narrowest owning boundary. Do not rely on broad remounting as a security control.
- Explicit subpage navigation initializes the destination's actual scroll owner and focus after commit; ordinary data updates do neither. Settings uses deterministic top-of-destination navigation (including Back), focusing its heading or stable named wrapper without another browser focus scroll. Lazy child readiness must not replay that initialization. Existing shared Modal ownership takes precedence.

## 2. Overlay contract

Every modal dialog, sheet, drawer, popover, menu, and tooltip defines:

- a single owner for `open` state;
- trigger, intentional-close, Escape, and outside-interaction behavior;
- initial focus and restoration target;
- stack level, portal destination, and nested-overlay behavior;
- background inertness and scroll locking for its complete visible lifetime;
- accessible name and optional concise description;
- enter/exit motion tied only to actual opening/closing;
- local loading/error boundaries inside stable chrome;
- narrow/mobile sizing using the visual viewport;
- sensitive rendered-state cleanup on panel leave and close.

Modal requirements:

- `role="dialog"`, `aria-modal="true"`, and a visible `aria-labelledby` title.
- Focus moves intentionally inside on open, remains trapped, and returns only after actual close.
- The background is inert for pointer, keyboard, and accessibility-tree interaction.
- Escape closes only when dismissal is safe. A blocked close explains why.
- Nested overlays do not unlock scroll or uninert the background while a parent remains open.
- The shell remains mounted during internal mode, tab, validation, refresh, or submission-state changes.
- Owner components pass controlled `open`; they do not conditionally erase the component before its exit lifecycle when animation/focus restoration matters.

Shell primitives (`src/components/ui.tsx`) and how to use them:

- `Modal` presents a bottom sheet below the `sm` breakpoint and a centred card above it (`presentation="auto"`). Confirmations and yes/no interrupts use `presentation="alert"` (centred, never dismissed by tapping outside, Escape still cancels). Full-surface takeovers use `presentation="fullscreen"`. Palette-style dialogs use `anchor="top"`.
- Sheets carry a grabber, swipe down to dismiss (from the grabber/header anywhere, from the body once scrolled to the top), and rest above the visual viewport when the keyboard is open.
- `busy` is the single close policy: while true, Escape, backdrop, drag and the header close control are blocked; the close control stays visible, disabled, and describes why (`busyReason`). Never hide the close control and never hand-wire `dismissable={!busy}`.
- `dirty` marks unsaved user input; gestures and the close control then ask "Discard changes?" first. Back navigation within a dialog never prompts.
- The shell holds its last size and presentation through the exit animation, so owners clear sensitive content immediately (`{open ? … : null}`). Only non-sensitive display content may use `useRetainedForExit` or `useMountedThroughExit`; lazy loading is not permission to retain keys, addresses, balances, transaction data or drafts after close. Closing shells are inert and cancelled confirmation actions are revoked immediately.
- Sheet surfaces permit pinch zoom. Downward touches inside a scrolled nested list belong to that list; pointer/touch cancellation or multiple touches reset the sheet without dismissal or replaying its entrance.
- Initial focus lands on the dialog itself so its name is announced first; pass `initialFocus` only when the sheet exists to collect text (rename, password, PIN, an editor whose first field is the title). Never focus the close control.
- `ModalHeader` (title, subtitle, `onBack` for multi-step flows, `action` for a trailing text control), `ModalBody` (`p-4 sm:p-6` with a vertical stack), `ModalFooter` (Cancel/Back leading, primary trailing; `stack` puts the primary on top) and `ConfirmModal` (verb-labelled confirmation) are the only chrome. Embedded panels report stage titles and Back to their owning shell through `onHeaderChange`.
- Destructive actions use `Button variant="danger"` (the tinted iOS red) both as the trigger and as the confirming button; uncommon irreversible actions always confirm through `ConfirmModal`.
- `data-app-surface` marks the root of every app phase so the shell can make the background inert.

## 3. Tabs and segmented controls

- Use Tabs for mutually exclusive content panels. Use SegmentedControl for filters or direct mode values that do not own tab panels.
- Every Tabs and SegmentedControl instance has an explicit accessible name. Native form labels use `htmlFor`; captions for composite controls use ordinary text elements rather than unbound labels.
- Tabs use `tablist`, `tab`, and `tabpanel`, with `aria-selected`, `aria-controls`, and reciprocal `aria-labelledby`.
- Horizontal tabs implement Left/Right, Home, and End. Tab moves from the active tab to panel content.
- Automatic activation is allowed only when the panel appears without disruptive latency. Lazy or intent-gated Private panels use `activationMode="manual"`: Arrow/Home/End move focus without selecting or loading; Enter/Space/pointer explicitly activate, immediately update selection, and show a panel-local fallback if needed.
- Pointer activation does not move focus unexpectedly. Leaving a sensitive tab unmounts and clears sensitive panel state according to its feature policy.

## 4. Loading contract

Choose feedback by actual scope:

- synchronous/local: immediate selected, pressed, or changed state; no loader;
- button mutation: preserve label width, disable duplicate submission, set `aria-busy`, show compact progress without erasing purpose;
- focus-retaining retries and copy actions: keep the control mounted, use `aria-disabled` with a synchronous owner guard when native disabling would lose focus, and keep the pending announcement outside any busy region that would defer it;
- card/field/panel: retain accurate content or reserve the eventual layout with a local skeleton/status;
- route: retain shared layout/navigation and use route loading only for route work;
- measurable multi-stage work: show honest stage text or determinate progress;
- indeterminate compact work: use a labeled spinner only when retained content is not clearer.

Rules:

- Acknowledge input within 100 ms in the defined lab profile.
- Never add fake delay or wait for animation completion before enabling the next safe action.
- Do not blank a page or dialog for local work.
- Centralize anti-flicker timing; arbitrary component `setTimeout` loading delays are prohibited.
- Preserve user input after recoverable errors.
- Provide retry/cancel/safe navigation when supported.
- Model critical async state explicitly: `idle | pending | success | empty | recoverable-error | terminal-error`, extended only by real domain states.
- Abort requests or ignore stale results after a mode/tab/query change.
- Bind async results to their actual owner (account/network/session/request), including success, failure and final cleanup. A stale `finally` must not clear a newer pending state. A failed visible pagination sentinel stops until explicit retry.
- QR images and their download links are usable only when the completed image's payload equals the current request. A still-valid old image is nevertheless wrong for newly edited payment instructions; hide it immediately and retain the reserved QR area.
- Status announcements use `aria-live`/`role=status` sparingly and do not repeat on every render.

## 5. Stellar transaction contract

Applicable UI stages are explicit:

`preparing → awaiting-approval → signing → submitting → submitted/pending-confirmation → confirmed`

Terminal or exceptional outcomes are explicit:

`rejected | failed | timed-out/status-unknown`

- RPC `PENDING` or Horizon asynchronous acceptance is not confirmation.
- A timeout is uncertain, not failed. Preserve the hash/envelope tracking needed to reconcile it.
- Prevent duplicate submission. Retry only under the domain rules for the identical transaction or after authoritative expiry/rebuild.
- Recoverable validation/signature/network errors keep safe user input and provide a next action.
- Success wording is reserved for ledger-confirmed state unless the copy explicitly says “submitted” or “sent to the network.”
- Never put secrets, mnemonic words, private receive addresses, proof inputs, unnecessary XDR, notes, addresses, amounts, or hashes into console logs, analytics, performance marks, screenshots, or test fixtures.

## 6. Shared component contract

Every shared interactive component documents and tests:

- supported sizes and semantic variants;
- idle, hover, pressed, focus-visible, disabled, pending, success, and error behavior;
- icon placement and text-overflow rules;
- narrow viewport, 200% zoom/reflow, pointer, keyboard, and screen-reader behavior;
- touch target (minimum WCAG AA 24×24 CSS px; StellarKey target is 44×44 for primary mobile controls);
- reduced-motion behavior;
- stable accessible name while state changes.

Use semantic tokens for spacing, radius, typography, color roles, focus rings, layers, motion duration/easing, content widths, and breakpoints. One-off values require a demonstrated layout need.

Current shared primitive API contract (preserve the established visual identity):

| Primitive | Supported scope | Required behavior |
| --- | --- | --- |
| Button | primary / secondary / danger / ghost; regular and existing `.btn-sm` | label remains in layout while busy; native pending-disable, caller-owned synchronous guard; inline caller errors; mobile target floor |
| Select | md / sm; optional minimum popup width and preserved option labels | button/listbox pattern, stable IDs, real option focus, disabled skipping, Home/End/typeahead, Escape restore, Tab continuation from trigger |
| Dropdown | existing trigger render prop, left/right placement | first-item focus once per opening; reposition never resets deliberate focus; Tab/Shift+Tab close and continue from trigger |
| Tabs | automatic default / explicit manual; labelled panel | focus, selection and async data are independent; private intent is activation, not focus |
| Modal | regular / wide; controlled open and dismissal policy | stable portal/backdrop/chrome; top-overlay focus/inert/scroll ownership; bounded mobile content |
| CopyButton / HashValue | labelled/icon copy and truncated/full value | generic polite pending/success/failure; visible pending; synchronous write guard; no completion-time focus movement; value/unmount invalidates feedback |

Popover portals inside a Modal belong inside that modal's backdrop, not an inert sibling under `body`. Convert viewport coordinates to the portal's containing block. Disabling/removing a focused popup must leave focus on an enabled owned control without stealing a newer deliberate focus choice.

Clipboard writes cannot be cancelled. Do not race duplicate OS writes, read back the clipboard, or automatically overwrite it later. For sensitive CopyButton use, keep an explicit Clear action after the brief copied announcement ends; explain clipboard-manager persistence. `aria-disabled` is permitted when native disabling would destroy focus, but only with an enforced synchronous action guard and visible pending treatment.

## 7. Motion contract

- Motion explains open/close, hierarchy, selection, continuity, or completion; decoration alone is insufficient.
- Central tokens define a small set of durations/easings.
- Prefer `transform` and `opacity`. `transition: all` is prohibited in new or touched shared components.
- Do not animate large regions for local changes or stack multiple animations for one action.
- Interaction remains available while non-blocking motion completes.
- `prefers-reduced-motion: reduce` removes spatial/non-essential motion and leaves state understandable.
- Spinners stop on success, error, cancel, or timeout. Continuous motion represents active work only.
- Tokens: `--motion-duration-fast` 120 ms (popover and toast exits, Reduce Motion crossfades), `standard` 180 ms (card/dim exits), `emphasized` 220 ms (card/alert entrances), `sheet-in` 380 ms, `sheet-out` 260 ms, `progress` 700 ms. Panel and dim always finish together.
- Reduce Motion replaces sheet, card, alert, popover and toast movement with a fast crossfade; it never removes the exit.
- Dialog files contain no `transition-all` and no numeric `duration-*` literal (`tests/motion-contract.test.mjs` enforces both).

## 7a. Haptics and sound

- Patterns follow their documented meanings. `selection` plays only while a control changes value (`Tabs`, `SegmentedControl`, `Toggle`, `Select` choose). Impact (`light`/`medium`) accompanies a physical metaphor such as a keypad key. Notification (`success`/`warning`/`error`) fires once, at the outcome site, for outcomes only: `warning` means the outcome needs attention (expired, ambiguous), never "about to do something".
- Opening, dismissing, Back, tab and segment switches, chips that fill a field, and navigation play nothing. The shell, `ModalHeader`, `IOSBackButton`, `Dropdown` and `Select` open are silent.
- Never fire two haptics for one event. `triggerHaptic` collapses a repeated type within 150 ms; a caller that already played an outcome passes `{ silent: true }` to `toast`.
- Sounds are opt-in (off until the person turns "Audio & Haptic Feedback" on) and only ever accompany `success` and `warning`; taps and selections stay silent.

## 8. Information and terminology

- Use **account address** for a public G/M address, **secret key** for an S key, and **recovery phrase** for mnemonic backup words.
- Always label Mainnet/Testnet where transaction value or validity can be misunderstood.
- Show asset code plus issuer identity for non-native assets; do not imply trust from issuer-controlled metadata.
- Amount formatting uses asset precision, stable rounding, grouping, and consistent trailing-zero policy.
- Truncated addresses always retain an accessible full value and an explicit copy action.
- Errors state what happened, why it matters, and the next safe action. A toast may reinforce but never replace a resolvable inline error.
- Destructive/irreversible confirmation names the action and consequence; generic “Yes” is insufficient.

## 9. Accessibility release contract

- Target WCAG 2.2 AA and current WAI-ARIA Authoring Practices.
- Keyboard paths, focus order/restoration, inert background, Escape, tabs, live status, and copy feedback receive behavioral tests; axe is supplemental.
- Focus indicators are visible, unobscured, and at least equivalent to a 2 CSS px perimeter with sufficient contrast where practical.
- Color is never the only status signal.
- Content reflows at 200% zoom and narrow mobile widths without two-dimensional scrolling, except essential data regions.
- Do not prohibit user zoom in viewport metadata or global touch CSS. Preserve the mobile 16px input floor independently of pinch zoom. Document gesture-specific exceptions and test reflow separately from physical-device pinch behavior.
- Disabled controls are semantically disabled and their reason is available in adjacent text or description when not obvious.
- Manual VoiceOver (iOS/macOS) and NVDA/JAWS checks are recorded as human release checks; automation must not claim they occurred.

## 10. Performance and evidence contract

Quality gates:

- field p75, when privacy-preserving field data exists: LCP ≤2.5 s, INP ≤200 ms, CLS ≤0.1;
- lab visible acknowledgement ≤100 ms;
- client modal shell does not wait for remote data or a feature chunk;
- local tab selected state is immediate;
- avoidable interaction tasks ≥50 ms are investigated;
- no unexpected layout shift, hydration warning, duplicate fetch, infinite render, or repeated animation initialization;
- no unexplained application-JavaScript or dependency-size regression.

Measurement reports state environment, source commit, cold/warm condition, network/CPU profile, sample count, median, and slowest representative run. Synthetic data is never described as field data.

Performance marks use fixed names only, for example:

- `stellarkey:modal-trigger`
- `stellarkey:modal-shell`
- `stellarkey:tab-activate`
- `stellarkey:tab-selected`
- `stellarkey:panel-usable`
- `stellarkey:submit-feedback`

No mark or measure name may contain user or wallet data.

## 11. Required regression coverage

For every critical overlay with asynchronous panels, test:

- stable shell/backdrop identity across panel changes;
- uninterrupted inertness and scroll lock;
- pointer and keyboard focus behavior;
- rapid switching and stale-result rejection;
- scoped loading and error UI;
- intentional close and focus restoration;
- sensitive panel cleanup;
- reduced motion and narrow viewport;
- accessibility scan plus behavioral assertions.

Tests wait for meaningful DOM, accessibility, network, or state conditions. Fixed sleeps are prohibited.

Optional participation controls (including Earn) show real connection readiness separately from persisted enablement. Start/Stop is explicit; Stop does not validate unfinished fee or endpoint edits. Rebase untouched fields after external preference changes and merge only real edits. Keep acknowledgements neutral and clear obsolete messages. Native disclosure summaries belong in modal keyboard containment. Closing clears private content immediately while retaining only its non-sensitive layout dimensions through exit.

Wallet verification must disable screenshots, video and traces. Disable failure DOM snapshots where supported; if the runner cannot, use only isolated synthetic non-usable fixtures, never a real wallet session. Playwright 1.62.1 locator failures retain this limitation (see the dated audit). Raw accessibility node HTML and wallet text are not safe application diagnostics. Use structural counts and fixed labels. Regression observers check transient attribute history as well as final shell identity, scroll lock and inertness. Run normal motion explicitly in addition to reduced motion.
