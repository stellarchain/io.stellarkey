# Relay startup implementation plan

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
