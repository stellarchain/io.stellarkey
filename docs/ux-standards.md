# StellarKey UX engineering standards

These are implementation contracts, not visual aspirations. They apply to every wallet and merchant surface.

## 1. Stable interaction identity

- Local state changes must not close, remount, route, or replay the entrance animation of their containing surface.
- Keep navigation, dialog shells, headings, close controls, tab lists, and stable form context outside lazy, Suspense, and asynchronous boundaries.
- Never put a tab-, step-, asset-, or request-dependent `key` on an overlay, portal, backdrop, shell, or ancestor unless the explicit product requirement is to destroy all descendant state.
- Selection feedback is urgent. Update it in the same event turn; do not wait for data, chunks, proofs, prices, or network responses.
- Clear sensitive state explicitly at the narrowest owning boundary. Do not rely on broad remounting as a security control.

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

## 3. Tabs and segmented controls

- Use Tabs for mutually exclusive content panels. Use SegmentedControl for filters or direct mode values that do not own tab panels.
- Every Tabs and SegmentedControl instance has an explicit accessible name. Native form labels use `htmlFor`; captions for composite controls use ordinary text elements rather than unbound labels.
- Tabs use `tablist`, `tab`, and `tabpanel`, with `aria-selected`, `aria-controls`, and reciprocal `aria-labelledby`.
- Horizontal tabs implement Left/Right, Home, and End. Tab moves from the active tab to panel content.
- Automatic activation is allowed only when the selected indicator and useful panel appear without disruptive latency. Otherwise selection is still immediate, while the waiting portion receives a scoped fallback.
- Pointer activation does not move focus unexpectedly. Leaving a sensitive tab unmounts and clears sensitive panel state according to its feature policy.

## 4. Loading contract

Choose feedback by actual scope:

- synchronous/local: immediate selected, pressed, or changed state; no loader;
- button mutation: preserve label width, disable duplicate submission, set `aria-busy`, show compact progress without erasing purpose;
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

## 7. Motion contract

- Motion explains open/close, hierarchy, selection, continuity, or completion; decoration alone is insufficient.
- Central tokens define a small set of durations/easings.
- Prefer `transform` and `opacity`. `transition: all` is prohibited in new or touched shared components.
- Do not animate large regions for local changes or stack multiple animations for one action.
- Interaction remains available while non-blocking motion completes.
- `prefers-reduced-motion: reduce` removes spatial/non-essential motion and leaves state understandable.
- Spinners stop on success, error, cancel, or timeout. Continuous motion represents active work only.

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
