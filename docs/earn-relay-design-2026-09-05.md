# Earn by relaying — product redesign

Date: 2026-09-05. Base: `b59c7c4`. Branch: `design/earn-relay`.

Scope correction, 2026-09-06: the user preferred the existing Home entry. Its original compact gift-icon row, spacing, copy and status label have been restored; the redesigned modal and its safety/interaction improvements remain unchanged. The measurements below describe the original redesign delivery, before this Home-only correction.

## Scope and design decision

The previous delivery repaired relay negotiation and signature ownership. It did not redesign Earn. This delivery changes the real Home entry and Earn dialog, retaining the existing protocol, approval manager, private-data lifecycle, and product identity.

Use a focused control panel: own participation status first, fee second, explicit Start/Stop next, network tools last. Alternatives considered: a minimal setup sheet (too little ongoing connection feedback), or an expanded Home dashboard (too much space for an optional activity, no trustworthy earnings/history data to populate it). No invented income, yield, activity, or peer-demand metrics. No new dependencies, fonts, animation library, or secret preloading.

Visual direction: system typography, larger deliberate type hierarchy, black/charcoal surfaces, restrained existing blue and semantic green/amber, generous internal spacing, flat sections instead of nested settings cards. A small static network motif explains the relay role; it does not pretend to show traffic. The fee is the main editable element. Endpoint editing and peer checks are secondary disclosures. Keep all important consent facts before the start action.

## Baseline

React 19.2.8, Next 16.3.3 App Router/static export, Tailwind 4, shared native Modal/Button/Field/Toggle; local preference persistence plus an in-memory helper-status subscription. Inspected the installed Next `use-client` guide before implementation.

Existing user flow: Home → Earn → check other peers → helper toggle → two public relay URLs → small fee input → long notice → Save relay settings → modal closes. Other-peer availability is visually ahead of the user's own participation. Saving hides connection progress. The enabled preference and real connection status are different states and must remain so.

| Baseline issue | Priority / impact | Remediation |
| --- | --- | --- |
| Technical endpoints and other-peer discovery lead the dialog | P1 / every opening, unclear next action | Status and fee first; progressive disclosure |
| Saving explicitly closes Earn | P1 / every save, hides acknowledgement and connecting state | Controlled stable shell; local acknowledgement |
| Start/stop is a draft toggle plus a generic Save button | P1 / repeated control friction | Explicit immediate Start/Stop; edits saved separately |
| Fee/reward presentation suggests earnings without explaining costs | P1 / financial misunderstanding | Explain payment-asset reward, XLM network cost, no guaranteed profit |
| Small muted text and undifferentiated settings rows | P2 / scanability on mobile | Larger primary type, clearer contrast and grouping |

Fresh baseline: `node --test tests/private-balance-relay-settings.test.mjs`: 6/6 pass. Prior integrated main: 1,424 Node tests, 78 synthetic component browser tests. This is not field data or a new full-suite result.

## Implementation plan

1. Add synthetic Earn fixture using real entry/settings/status store, with no wallet keys and no helper/signing manager. Add failing behavior tests for the new visible hierarchy, explicit control, stable shell, recoverable errors, keyboard/mobile/reduced-motion behavior. Update the old source contract that required Save to close only together with replacement behavioral coverage.
2. Redesign `PrivateRelayEntry.tsx`: Home entry, stable shared Modal, honest live status, static network motif, secondary peer tools. Never mount peer tools before explicit intent; closing clears them.
3. Redesign `PrivateRelaySettings.tsx` helper presentation: prominent labelled fee editor, costs/consent, explicit Start/Stop and local saved state. Preserve the full advanced-settings presentation and separate `useRelay` opt-in. Stop must use saved valid settings, not validate unfinished edits. Keep typed values on recoverable error. Never echo arbitrary storage error text.
4. Exercise existing approval/relay coverage unchanged. Run typecheck, Node tests, lint, isolated Chromium/iPhone WebKit tests, production build and bundle checks. Record structural/behavioral evidence and representative lab timings without wallet values.
5. Update CHANGELOG and durable UX rules, review the diff, commit and make the redesign available in the user's working app. No remote push, deployment, transaction submission, or branch deletion is implied.

## Shared interaction decisions

- Visibility, persisted participation, draft preferences, connection status, and network-tool disclosure are independent.
- No loader for synchronous preference changes. `role=status` announces saved/start/stop feedback without moving focus. Network status is honest: enabling is not connected, and connected is not an accepted or confirmed payment.
- Start explicitly opts into automatic encrypted account-possession offers, never automatic transaction signing. Explain public source identity, Nostr IP/timing exposure, and the need to keep StellarKey open/unlocked. Stop cannot revoke a signature already shared.
- Use existing motion/focus tokens. No entrance replay, continuous decorative motion, fake counters, or artificial delays. Mobile inputs at least 16px; clear targets and narrow-screen reflow.
- Wallet screenshots/video/traces remain disabled under AGENTS.md. Use synthetic behavioral tests and structural/geometry diagnostics; human assistive-technology checks remain separate.

## Research ledger

All accessed 2026-09-05; official sources only.

| Source | Guidance | Decision |
| --- | --- | --- |
| [WAI modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) | Named modal, contained focus, inert background, restoration only on close | Retain shared Modal; don't close on preference save; keyboard regression tests |
| [WCAG 4.1.3 status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) | Announce state changes without forcing focus | Local polite feedback; no save toast or focus jump |
| [Stellar fees and resource metering](https://developers.stellar.org/docs/learn/fundamentals/fees-resource-limits-metering) | Smart-contract fees include network/resource costs | Distinguish the helper's requested private reward from XLM costs; do not promise profit |
| Installed Next 16.3.3 `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md` | Browser state and event handlers stay in a client boundary | Existing client components only; no routing/loading changes |

## Verification results

Implemented the focused control panel, not just reliability fixes. The redesign skill informed the fee-first hierarchy, flat surfaces, larger type and progressive disclosure; no brand replacement or decorative continuous motion was introduced.

### Before / after

| Property | Before (`b59c7c4`) | After |
| --- | --- | --- |
| First content | Other-peer discovery | Own participation and real connection status |
| Helper start | Toggle, then generic Save (2 actions) | Start relaying (1 explicit action) |
| Visible relay URL inputs on opening | 2 | 0; both available under Relay connections |
| Fee type | 13px desktop, 16px mobile | 44px desktop, 38px mobile |
| Save result | Dialog closes, connection feedback disappears | Inline acknowledgement; shell and controls stay mounted |
| Stop with invalid unfinished fee/URL | Blocked by Save validation | Stops using last valid persisted settings; retains edits |
| Keyboard disclosure boundary | Native summaries absent from modal focus query | Included; Tab and Shift+Tab remain inside |
| Closing content | Whole overlay removed immediately | Sensitive/peer content clears immediately, only numeric geometry remains during shared exit |

Initial test failed against the old Earn UI because the fee-first control did not exist. Subsequent keyboard tests exposed the shared summary focus omission. The mobile geometry test also failed at 16px before the fee's intended size was made explicit above the global mobile input floor. Neither test was relaxed.

### Lab measurements

Local macOS host, Node 26.7.0, npm 11.19.0, Playwright 1.62.1, owned Next development server on 127.0.0.1:3195, non-usable synthetic fixture, external HTTP/WebSocket denied. Five warm repetitions after hydration per browser. Two animation frames after the actual DOM acknowledgement provide a rendering-opportunity proxy, not field INP. No real wallet, chain work, private values, screenshot, video or trace collection. Network throttling is irrelevant to these synchronous local actions and was not simulated.

| Profile | Modal rendering proxy median / slowest | Start feedback proxy median / slowest |
| --- | --- | --- |
| Desktop Chromium 1280×720, 4× CPU slowdown | 28 / 50 ms | 21 / 26 ms |
| iPhone 16 WebKit, 393×659 CSS viewport, native lab CPU | 30 / 40 ms | 29 / 30 ms |

These are final full-suite run measurements, not a claimed before/after latency improvement or Core Web Vitals result. Both profiles meet the defined 100ms action-feedback gate. The primary target is at least 44px. Desktop Start is visible without scrolling; the compact iPhone viewport needs about 136px of content scroll to reach the full Start control, retaining consent text ahead of it. Neither profile has horizontal overflow; a separate 320px reflow check passes. Physical-device pinch/keyboard and human VoiceOver/NVDA remain unverified.

### Commands and outcomes

- `node --test tests/private-balance-relay-settings.test.mjs`: 6 passed before and after. Replaced the old source assertion requiring Save-to-close with a stable-shell contract plus real browser coverage.
- `npm test`: 1,424 passed.
- `E2E_PORT=3195 node scripts/test-private-components.mjs --workers=2`: 98 passed (78 existing, 20 new Chromium/iPhone cases), 50.6s. Includes normal and reduced motion, repeated start/stop, transient shell/backdrop/scroll-lock observers, focus restoration, stale external preferences, recoverable validation/storage errors, advanced settings, close geometry, 320px layout, and acknowledgement budgets.
- Accessibility: no reported WCAG A/AA axe violations in Earn in Chromium; WebKit scan excludes the existing unsupported color-contrast check. Keyboard tests independently exercise disclosures and focus containment. No manual screen-reader claim.
- `npm run typecheck`: passed.
- `npm run lint`: 0 errors; 3 existing marketing `<img>` warnings.
- `npm run build`: passed, 22 static pages, 319 document-scoped CSP hashes. Temporary fixture absent from production.
- `npm run test:bundle`: 5 passed. `npm run check:bundle`: all existing budgets passed, none raised.
- `git diff --check`: passed. Independent read-only review: no remaining critical/important findings after corrections.

Initial JavaScript: 1,165,140 → 1,165,206 raw bytes (+66, shared native-summary focus selectors); gzip 341,908 → 341,929. Unlocked journey raw JavaScript remains 763,398 bytes. All emitted JS remains 119 chunks: 6,121,116 → 6,137,487 raw bytes (+16,371, optional redesigned UI/settings and release-note content). Using the same Node zlib default on both builds, aggregate gzip is 1,795,904 → 1,800,069 bytes (+4,165). No dependencies, protocol artifacts, signing code or transaction-state semantics changed. The pre-existing bundle worker graph-report caveat is documented separately in the reliability integration note.

### Remaining / deliberately omitted

- P2 / human verification: VoiceOver/NVDA, physical-device zoom and virtual-keyboard comfort; automation is not a substitute.
- P2 / small-screen trade-off: critical consent stays before Start, requiring a short scroll on a 659px-tall iPhone viewport. No obscuring sticky action layer was added.
- No income dashboard, yield claims, fabricated activity, automatic transaction signing, protocol changes, screenshots of wallet data, remote deployment or production transactions. There is no reliable earnings-history model to support new financial metrics.
- This is a scoped product redesign, not a release tag or a new app-wide Core Web Vitals audit. No `release:verify` claim is made.
