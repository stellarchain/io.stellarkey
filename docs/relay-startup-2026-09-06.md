# Relay startup implementation plan

Stored directly in `docs/` to follow the release-tree policy, which excludes `docs/plans/`.

> Use the systematic-debugging and test-driven-development skills for each step.

**Goal:** Start the helper from Earn without requiring an unrelated Private tab visit, and never call an inactive helper “Connecting”.

**Architecture:** Keep the existing runtime consent gate and Nostr transport. A successful explicit Start/Resume (or enabling helper settings) requests the private runtime. A saved opt-in alone does not load private material on unlock; Earn presents Paused and an explicit Resume action. Runtime preparation, actual socket readiness, and unavailable states remain separate. Preserve account/network cleanup and manual transaction approval.

**Tech stack:** React 19.2.8, Next.js 16.3.3, nostr-tools 2.25.1, Node tests and isolated Playwright Chromium/iPhone WebKit fixtures.

## Decisions

- Chosen: repair startup intent and status at existing controls. No new transport or networking library.
- Rejected: automatically mount the private runtime from a global saved preference; this expands private-data loading without fresh intent for the current unlock/account.
- Deferred: event-driven socket status and a broader retry-owner rewrite. Existing transport already races the two configured relays and reconnects. Neither is required to fix an unmounted manager.
- Prevent unrelated storage events / sender-only preferences from restarting the helper: retain semantically unchanged helper preferences. Real fee, endpoint, account, deployment, or readiness changes still invalidate the session.
- Keep Home row styling, modal identity, payment protocol, signing and reservation semantics unchanged.

## 1. Reproduce before implementation

- Add `e2e/fixtures/relay-startup-panel.tsx` using the real runtime control provider, runtime mount policy, Earn controls, helper manager and status store. Replace only the session/network boundary with controlled readiness; no real wallet, keys, messages, chain calls or outbound traffic.
- Add an opt-in fixture switch to `e2e/fixtures/private-components.tsx`, and `e2e/relay-startup.spec.ts` to the isolated runner's testMatch.
- Verify fresh unlock → Start requests runtime → preparing → connecting → actual connected. Verify saved opt-in does not start until Resume, failed saving never requests runtime, failure status, stop during setup, and account changes.
- Add storage/no-op preference lifecycle regression: unrelated events and sender-only edits must not recreate the connected helper. Real helper edits must.
- Run `E2E_PORT=3195 node scripts/test-private-components.mjs relay-startup.spec.ts --project=desktop-chromium`; observe the original missing-startup failure.

## 2. Minimal fix

- `PrivateRelaySettings.tsx`: request runtime only after a successful explicit enabling save; add Resume for saved participation with no runtime request, using saved settings independently of unfinished edits. Stop remains available. Advanced enabling settings uses the same intent path.
- `PrivateRelayEntry.tsx`: distinguish paused/unrequested, wallet preparation/error, and manager connection states without changing Home's layout or mounting the private panel implicitly.
- `relay/preferences.ts` and `PrivateRelayHelperManager.tsx`: compare helper-relevant values before changing effect dependencies, ignore unrelated storage keys, and preserve the URLs reference when unchanged. Never suppress security-relevant effect dependencies.
- Re-run new tests to green; update existing Earn test expectations only where the old test asserted the misleading inactive Connecting label.

## 3. Verify and document

- Run focused Node relay tests, all Node tests, typecheck, lint, isolated Earn/startup/helper tests on desktop Chromium and iPhone WebKit, production build and bundle gates. Keep wallet screenshots, video and traces disabled; synthetic fixture DOM only.
- Record results and limitations here; update `CHANGELOG.md` [Unreleased] and durable interaction rules.
- Review diff for unchanged Home styles, protocol code and actual transaction approval; commit one logical fix. No release tag, network transaction or remote push is part of this task.

## Baseline and sources (accessed 2026-09-06)

- Source diagnosis: `PrivateRelaySettings.save` persisted helpRelay but never requested runtime; the manager mounts only inside the explicitly requested private runtime; Entry mapped store `off` to Connecting.
- Previous-turn read-only transport probe: first relay ready in 117, 80, 77 ms; median 80 ms, slowest 117 ms. Node 26.7.0, local network, three fresh adapters. Not browser/field measurements; no events published or wallet material used.
- [React effect lifecycle](https://react.dev/reference/react/useEffect#removing-unnecessary-object-dependencies): semantically unchanged preference objects must not restart connections; retain real dependencies.
- Installed Next.js `node_modules/next/dist/docs/01-app/03-api-reference/01-directives/use-client.md`: keep this local interactive state client-side; no route navigation/loading boundary changes.

## Implementation notes

- Reproduced the original failure in desktop Chromium: Start left `requested=false` until the meaningful assertion timed out. This is a real-controls integration fixture with substituted external sessions, not a full chain-runtime or wallet test.
- Baseline: 1,425 Node tests passed on c06fe5c. New preference identity tests failed before implementation, then passed.
- Added and observed failing tests for paused configuration saving accidentally requesting runtime, retry returning to initial Connecting, keyboard Resume losing focus when its control was removed, and external Stop removing a focused paused Stop control. Corrected these at the existing control/manager boundaries.
- The primary participation button now stays mounted through Start/Resume/Stop. A preference refresh transfers focus only when it will remove the focused secondary paused Stop button; it does not move focus from other controls.
- Pointer focus is tested separately from keyboard focus: iPhone WebKit touch can retain the previously focused input, while Chromium focuses the button. Both retain focus inside the modal. No artificial focus jump is required to imitate another browser.
- The production-build guard correctly rejected a build attempted during the temporary fixture run. Production build verification must run after the runner removes its owned fixture; no release guard was weakened.
- The existing release-tree test excludes `docs/plans/`; moved this new document into the established `docs/` location and removed only the empty directory created for it.

## Final verification

- All Node tests: **1,427 passed, 0 failed** (68.0 s), with the document rename staged so tracked-file checks see the correct path. Command: `node --no-warnings --experimental-strip-types --loader ./tests/ts-resolve-loader.mjs --test --test-reporter=spec --test-concurrency=4 tests/*.test.mjs`.
- `npm run typecheck`: passed. `npm run lint`: no errors; three unchanged marketing `no-img-element` warnings.
- `E2E_PORT=3195 node scripts/test-private-components.mjs relay-startup.spec.ts relay-earn.spec.ts private-components.spec.ts`: **80 passed**, desktop Chromium and iPhone 16 WebKit, 2.2 min. Includes 20 new startup cases (10 per browser), 22 Earn cases and 38 existing private/helper/approval cases. Accessibility scans cover WCAG A/AA rules at 320px; no automated violations. Human VoiceOver/NVDA and real-device touch were not claimed.
- `npm run build`: passed, **22 static pages**, 320 document-scoped CSP hashes; no synthetic fixture route. `npm run test:bundle`: **5 passed**. `npm run check:bundle`: all existing gates pass without threshold changes.
- Independent review found the paused-save consent and external-stop focus issues; both were reproduced, corrected and re-reviewed without further blocking findings.
- Exact source comparison against c06fe5c confirmed Home trigger markup/styles and the Earn modal shell markup are byte-for-byte unchanged. No changes to transport, SDK versions, signing, proof/reservation or transaction submission code.

### Interaction evidence

Before: the integration fixture reproduced Start leaving runtime intent false, so no manager/socket was created. After: Start sets intent, preparation keeps the shell interactive, and the real manager publishes Connected only after controlled session readiness. A connected helper remains at one session creation and zero closes across unrelated storage and sender-only preference changes; a real fee change still closes/recreates it.

Five warm samples per profile, Node 26.7.0 / Next dev, local synthetic UI, no remote network, no actual wallet data. A paint proxy uses animation frames, not field INP or network readiness. Separate final timing run after other checks finished:

| Lab profile | Modal paint median / slowest | Start feedback median / slowest |
| --- | --- | --- |
| Desktop Chromium, 4× CPU throttle | 35 / 47 ms | 36 / 67 ms |
| iPhone 16 WebKit emulation | 38 / 57 ms | 22 / 35 ms |

The earlier full-suite run shared the machine with lint/Node verification (desktop Start 80 / 85 ms; iPhone 23 / 25 ms); both runs remain under the 100 ms acknowledgement gate. These are synthetic local UI timings, not evidence of faster blockchain operations. The transport itself was deliberately unchanged.

### Bundle evidence and limitations

Compared with the existing c06fe5c root export: initial JavaScript **1,165,206 → 1,165,206 raw bytes**, unlocked **763,398 → 763,396**, private provider/card **264,360 → 264,358**. Landing, merchant, hardware and proving artifacts are unchanged. All emitted JS remains 119 chunks: **6,137,548 → 6,159,464 raw bytes** (+21,916), aggregate default gzip **1,800,072 → 1,808,924** (+8,852). This includes the optional UI/copy additions and Turbopack re-partitioning: emitted-module inventory has no new module IDs, but six existing hashing/StrKey/byte-utility modules gain a second registration in the new crypto fallback chunk. No new dependency was added and startup journeys did not grow; optimizing the compiler's optional-chunk duplication is deferred.

The pre-existing worker-report ambiguity documented in `relay-reliability-plan-2026-09-05.md` still applies. It reports **752,895 → 775,450**, selecting a different already-existing fallback chunk (6,350 versus 28,906 bytes). Both fallback files are byte-identical in both exports, as are all eight common worker-report chunks, including the actual `turbopack-worker` file. The provider chunk is one byte smaller because of generated import references. This is not a change to worker/proving source or artifacts; no budget was weakened.

### Deliberately unchanged

- Nostr endpoint selection, parallel first-healthy-relay readiness, encryption and connection deadlines; no P2P migration or new data service.
- Saved preference format and automatic transaction-signing policy (manual approval remains required).
- Global callback/readiness dependencies that invalidate helpers for actual account, deployment, fee-policy or wallet-state changes.
- Full live-chain, real-wallet and human screen-reader verification remains outside this synthetic test run. No real keys, payments, proof inputs or signatures were used or exposed.
