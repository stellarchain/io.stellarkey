# Waku Cluster Readiness Implementation Plan

> Historical record: peer relaying and helper earnings were removed on 2026-09-10.
> Relay instructions, measurements, and proposals below are not current functionality.
> See [the current whitepaper](private-balance.md) for direct submission and legacy recovery.

> Implement this plan task-by-task.

**Goal:** Prevent false Waku readiness and endless mismatch retries, make saved network changes effective, and demonstrate the fix with isolated E2E tests.

**Architecture:** Classify configured peer metadata in the transport adapter, propagate a typed terminal configuration error, and present it in the existing helper status store and Earn UI. Preserve the SDK’s normal reconnect behavior and the app’s existing session-generation, private-runtime, and modal ownership boundaries.

**Tech Stack:** Next.js 16.3.4, React 19, TypeScript, @waku/sdk 0.0.36, Node test runner, Playwright Chromium and WebKit.

---

### Task 1: Red regressions for compatible service readiness

**Files:** `tests/private-balance-relay-waku.test.mjs`, `tests/private-balance-relay-helper-status.test.mjs`.

1. Give fake peers the same ID/protocol/encoded metadata shape as the installed SDK; use its real metadata encoding/decoding utilities.
2. Assert `adapter.waitUntilConnected(...)` rejects for configured cluster 1 versus peer cluster 3 rather than returning successful services.
3. Assert unknown metadata, disconnected peers and codecs on incompatible peers never count as ready; include a mixed compatible/incompatible peer set.
4. Assert terminal configuration errors escape helper-readiness retry, while transient errors still retry.
5. Run `node --no-warnings --experimental-strip-types --loader ./tests/ts-resolve-loader.mjs --test tests/private-balance-relay-waku.test.mjs tests/private-balance-relay-helper-status.test.mjs`; verify new assertions fail for the diagnosed behavior, not import errors.

### Task 2: Metadata-aware adapter and typed error

**Files:** `src/features/private-balance/relay/waku.ts`, `src/features/private-balance/relay/connection-error.ts`, `src/features/private-balance/relay/helper-status.ts`.

1. Introduce a lightweight `PrivateRelayConfigurationError` and a bounded numeric cluster-mismatch description; no raw SDK error text or peer identifiers in presentation state.
2. Read configured peer metadata through the installed SDK’s public peer-store and decode utility interfaces. Count only currently connected compatible peers advertising the relevant codec.
3. Reject a proven all-configured-peers mismatch from readiness. Preserve physical deadlines, cancellation and closed-session guards; do not allow subscription or backfill to evade compatibility checks.
4. Stop retrying terminal configuration errors without disabling transient recovery. Preserve errors through existing transport/session boundaries.
5. Re-run the Task 1 command and verify green, including the old behavior tests where still valid. Replace any old assertion that explicitly required a false service-readiness result with the corrected contract.

### Task 3: Real controls and session propagation regression

**Files:** `e2e/fixtures/relay-startup-panel.tsx` or a new `e2e/fixtures/relay-waku-panel.tsx`, `e2e/relay-startup.spec.ts` or `e2e/relay-waku.spec.ts`, `e2e/fixtures/private-components.tsx`, `playwright.private-components.config.ts`.

1. Exercise the real settings, intent gate, helper manager and transport; substitute only network/chain boundaries needed for isolated synthetic fixtures.
2. Drive the actual Waku cluster field and Save connections button. Assert the helper receives cluster 3, a wrong-cluster session terminates with an actionable state, and correction reconnects without closing the dialog.
3. Add close/reopen, Start/Stop, unrelated settings, another-tab settings, rapid changes and late old-result cases. Verify inactive/fresh-unlock settings saves do not create a session.
4. Run the selected test using `E2E_PORT=3196 npm run test:e2e:private-components -- e2e/relay-waku.spec.ts --project=desktop-chromium` (or the updated startup spec). Verify expected red assertions before UI changes.

### Task 4: Terminal status and fresh settings application

**Files:** `src/features/private-balance/components/PrivateRelayHelperManager.tsx`, `src/features/private-balance/components/PrivateRelayEntry.tsx`, `src/features/private-balance/components/PrivateRelaySettings.tsx` only as needed, `src/features/private-balance/relay/helper-status.ts`.

1. Add explicit configuration-error presentation using existing status and UI primitives. Explain configured and reported cluster values with safe bounded text.
2. Ensure both initial readiness and later polling preserve the error and do not overwrite newer sessions.
3. Fix any settings propagation issue proven by Task 3; preserve actual draft edits and private-runtime intent rules.
4. Run Task 3 on desktop Chromium and iPhone WebKit. Verify dialog identity, focus, inertness, scroll lock, stale-result ownership, no false Connected paints, accessibility and cleanup.

### Task 5: Real SDK local-node E2E

**Files:** isolated Waku fixture and E2E test, optional runner documentation.

1. Add opt-in local endpoint configuration for the test fixture only, leaving default CI synthetic and deterministic.
2. Use the real adapter and installed SDK against both existing local cluster-3 nodes, with a unique synthetic topic and no payment publication or real wallet state.
3. Verify cluster-1 mismatch presentation and actual Save connections to cluster 3 recovery through the real UI/manager.
4. Keep compatible connections alive beyond a keepalive cycle, then Stop and prove cleanup. Report counts/statuses only.

### Task 6: Verification, review and handoff

**Files:** `CHANGELOG.md`, affected test/verification configuration only where necessary.

1. Update `[Unreleased]` with the factual connection and status fix.
2. Run focused relay tests, `npm run typecheck`, `npm run lint`, and relevant synthetic E2E suites on both configured browsers. Run `npm test` and the browser-protocol tests where dependencies are installed.
3. Run `npm run check:fixture-clean`, `npm run build`, and `npm run check:fixture-clean` again. Do not waive pre-existing failures; distinguish and investigate them.
4. Request independent review under `requesting-code-review`, fix important findings and re-run their tests.
5. Commit the single logical fix with its tests and changelog. Use `finishing-a-development-branch` for integration/handoff; do not claim the user’s original Chrome session was exercised unless it actually was.

## Verification — 2026-09-10

- Focused relay regressions: 54 passed, including an independent review rerun.
- Application unit tests: 1,875 passed; browser protocol package: 58 passed.
- Real local-node SDK E2E: 2 passed, desktop Chromium and iPhone WebKit. Each
  exercised cluster 1 rejection, Save connections to cluster 3, 70 seconds of
  stable Filter/Store connectivity, and Stop. No payment was published.
- Relay settings, startup and Waku UI E2E: 66 passed with no retries or skips.
  An earlier run had one Chromium fixture-navigation failure; that case passed
  three isolated repeats and the final complete selected suite passed.
- Required private continuity, overlay and manifest checks: 16 passed.
- Type checking, production build, fixture cleanup before/after build, all five
  bundle assertions, and every bundle-size budget passed.
- Lint: no errors, three existing marketing-image warnings.
- Review findings were reproduced with failing tests before correction. The
  scoped final review reported no remaining Important findings.

The generated-artifact check exposed stale toolchain provenance from the existing
dependency lock. After installing the pinned circuit test dependencies and
refreshing only toolchain provenance and its derived manifest/catalogue pins,
`private:check-generated` passed, including proof-vector and artifact verification.
The contract, circuit, proof artifacts and deployment binding did not change.
This refresh is committed separately from the Waku behavior fix. The production
audit gate passed its existing high-severity threshold: 14 vulnerable-package
entries (10 low, 4 moderate), representing two advisories through the unchanged
Trezor and Waku dependency trees. No overrides or dependency changes were made.

No full release approval, funded-wallet E2E, physical-device, or human
VoiceOver/NVDA verification is claimed.
