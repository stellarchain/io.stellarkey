# Private relay reliability implementation plan

**Goal:** Prevent the reproduced address-selection and human-approval failures, and distinguish an earlier unresolved payment from a newly exposed proof without weakening reservations.

**Architecture:** Preserve the current protocol, encrypted journal, manual signing, and canonical reconciliation. Put recipient compatibility checks before relay discovery, tie human approval to its existing expiry, and keep error presentation separate from spend finality. Work in an isolated worktree; do not access a real wallet session or submit payments.

**Stack:** React 19.2.8, Next.js 16.3.3 App Router, Stellar SDK 17.0.1, Nostr tools, Node tests and isolated Playwright Chromium/WebKit fixtures.

## Evidence and decisions

- A valid default private address has a zero diversifier; the relay selection encoder and worker reject it. An in-memory reproduction accepts a rotated nonzero diversifier and rejects the default before proof construction. Do not silently alter the recipient, choose direct submission, or remove helper receive-address reuse protection. Show actionable compatibility guidance before connecting to relays.
- `requestSignature` uses the messenger's 20-second transport timeout while helper approval remains valid for up to the existing five-minute quote lifetime. A fake-clock reproduction closes the sender subscription with the helper approval still unexpired. Use the actual remaining approval lifetime, not a new fixed delay or an extension of the quote.
- `PrivateActionInFlightError` occurs before a new deposit's proving/signing/network work, but shares the same display rule as `PrivateProofExposedError`. A synthetic deposit reproduction preserves the earlier journal and notes. Give these states distinct copy; do not release or reset earlier inputs.
- Review the helper's signed-response publication boundary: an acknowledgement can arrive after the sender's submission request. Store the exact approved response before publication; retain fail-closed ownership and expiry checks.
- Existing unknown payments are not repaired by changing a timeout. Automatic input release, proof reissue, direct fallback, and a new cryptographic cancellation protocol are explicitly out of scope.

## Task 1 — Relay recipient preflight

Files: `relay/recipient.ts`, `components/SendPrivate.tsx`, `components/usePrivateActionController.ts`, `copy.ts`, `tests/private-balance-relay-recipient.test.mjs`, isolated relay fixture/tests.

1. Write tests for default-address guidance, nonzero address compatibility, malformed/wrong-network rejection, and no address echo in errors.
2. Run the focused tests and observe the missing implementation fail.
3. Reuse one local decoder/compatibility check for form validation and ordinary/chained relay entry; guard asynchronous validation by recipient and mode. No prefetch, persistence, or logging.
4. Verify before-discovery rejection, correction/retry, direct-mode independence, and dialog identity/focus using synthetic browser fixtures.

## Task 2 — Human approval deadline and signed handoff

Files: `relay/session.ts`, `components/PrivateRelayHelperManager.tsx`, new focused relay approval tests.

1. Add fake-clock tests: approval beyond 20 seconds succeeds before the existing deadline; expiry, abort, and session close clean up; expired replies are ignored.
2. Reproduce a sender submission arriving before publication acknowledgement.
3. Implement deadline-bounded waiting and store the exact authorized signed response before exposing it. Never automatically sign or submit again; prevent overlapping approval taps. Keep errors honest when signing succeeded but delivery is uncertain.
4. Run relay session, authentication, transport, preparation, lifecycle and proof-exposure tests.

## Task 3 — Earlier-payment blocking state

Files: `copy.ts`, `tests/private-balance-proof-exposure.test.mjs`, isolated component fixture/tests.

1. Add a failing test distinguishing blocked-new-action copy from current-proof exposure. Verify no claim that the earlier payment failed, no retry-as-unspent action, and no secret-bearing underlying cause rendering.
2. Split the copy rules, explicitly state that the new action did not start, and direct users to the existing background canonical checks without promising a deadline or automatic release.
3. Keep the prior-action gate and storage/reconciliation behavior unchanged. Test reserved notes/journals remain intact.

## Verification and handoff

Run focused Node tests during each red/green cycle; then typecheck, full Node suite, lint, isolated Chromium/WebKit regression tests with artifacts disabled, production build and bundle gates. Record actual results here. Update Unreleased changelog entries with the implementation. Request independent read-only code review before integration. Preserve the user's unrelated untracked notes and plans. No remote push, deployment, or real payment verification.

### Commands

`node --no-warnings --experimental-strip-types --loader ./tests/ts-resolve-loader.mjs --test tests/private-balance-relay-*.test.mjs tests/private-balance-proof-exposure.test.mjs`

`npm run typecheck` · `npm test` · `npm run lint`

`node scripts/test-private-components.mjs --workers=2`

`npm run build` · `npm run test:bundle` · `npm run check:bundle`

## Implementation and verification — 2026-09-05

Implemented the three scoped repairs plus the helper handoff/duplicate-operation fixes. The compatibility check runs in the recipient form and before ordinary/chained relay discovery; a defensive selection check remains. Direct mode still accepts valid default addresses. Human approval uses the earlier absolute quote/payout expiry (at most the existing 300 seconds), while ordinary machine exchanges retain their 20-second default. Session close, abort, expiry and publication failure tear down response waits.

The helper records the exact approved envelope/hash before publishing its signed response. Same-tick approval clicks sign once; submission is claimed once per quote, including RPC or acknowledgement uncertainty. Unknown signature delivery does not invite a second approval. Dismissing its notice preserves exact authorization and the sequence lease until submission/expiry/session cleanup. Late completions cannot resurrect a replaced context. The close control stays mounted and focus moves intentionally to stable review details while native buttons are disabled.

### Reproducible before/after evidence

These are deterministic synthetic tests, not live-wallet outcomes, network latency measurements, or Core Web Vitals. Environment: macOS, Node 26.7.0/npm 11.19.0, repository-locked dependencies, isolated Next development fixture, Playwright 1.62.1 desktop Chromium and iPhone 16 WebKit. Fixture HTTP/WebSocket traffic is restricted to its owned local origin; screenshots, video and traces are disabled. No actual payment was signed or submitted.

| Scenario | Before | After | Evidence |
| --- | --- | --- | --- |
| Valid default recipient with relay | Discovery precedes a protocol rejection at selection | Zero session creations/quote requests; inline fresh-address guidance | `private-balance-relay-recipient.test.mjs`, `private-components.spec.ts` |
| Approval delivered at 21 seconds with a 120-second expiry | Subscription already closed at 20 seconds | Matching response received; exact expiry still enforced | `private-balance-relay-approval.test.mjs` fake clock |
| Exact submit arrives before signed-publication ACK | Helper rejects; zero RPC submissions | One authorized submission; changed envelopes still rejected | Helper browser regression failed before repair on both engines |
| Same-tick approval clicks | Two signing calls | One signing call | Helper browser regression |
| Duplicate submit after uncertain RPC result | Two RPC calls | One RPC call; attempt retained until cleanup | Review-discovered browser regression, red/green on both engines |
| Lost signature-publication ACK | “Not signed”; another approval offered | Explicit uncertain delivery; approval disabled; dismissal cannot revoke signature | Keyboard/reduced-motion fixture + axe |
| New action with earlier exposed spend | Misidentified as the new payment's shared proof | “Blocked by an earlier payment”; new action not started | Encrypted-memory reservation test + direct-form fixture |
| Form mode changes / recoverable block | No relay-compatible validation | Stale validation ignored; direct mode, amount and memo retained | Browser recipient fixture |

Verification completed:

- Fresh isolated baseline: 113 existing relay/proof-exposure tests passed before editing.
- `npm test`: 1,424 passed, 0 failed (37.5 seconds on the final run).
- `npm run typecheck`: passed; production compilation also typechecked successfully.
- `npm run lint`: 0 errors; the same three existing `next/no-img-element` warnings in marketing components.
- `E2E_PORT=3195 node scripts/test-private-components.mjs --workers=2`: 78 passed, 0 failed (37.4 seconds). Covers shell/backdrop identity, inertness/scroll lock, focus, keyboard, reduced motion, stale validation, cleanup, forms and helper error states.
- Axe: no critical/serious findings in tested states. WebKit retains the repository's existing color-contrast-rule exclusion; Chromium checks contrast after enabled controls have reached their settled opacity. Human VoiceOver/NVDA testing was not performed.
- `npm run build`: passed, 22 generated pages; verified the emitted lazy chunks contain the new preflight/deadline/blocking messages.
- `npm run test:bundle`: 5 passed; `npm run check:bundle`: all existing limits passed, no budget increase or dependency change.
- `npm run private:check-generated`: passed, including three Groth16 proof vectors and unchanged generated artifacts. The initial isolated run lacked the circuit subpackage's `snarkjs`; installing that subpackage with its existing lockfile (`npm ci --prefix protocol/private-balance/circuits --ignore-scripts --no-audit --no-fund`) resolved the verification-only setup issue. No lockfiles or generated outputs changed.
- Independent read-only review found one missing duplicate-after-failure guard, reproduced it, and verified its repair; final review reported no additional concrete correctness/security finding.

### Bundle comparison

Compared the existing `baf9630` export in the main worktree to the isolated fixed export with the repository's measurement code. Initial and unlocked raw JavaScript remain 1,165,140 and 763,398 bytes. The provider/card measurement remains 264,360 bytes. Across all 119 emitted JavaScript chunks, the repair adds 7,957 raw / 2,214 gzip bytes (6,113,159 → 6,121,116 raw bytes); this includes repeated lazy-boundary code and actionable copy, not a new dependency.

The worker budget reporter changes from 726,088 to 752,895 bytes, but this is an existing measurement ambiguity: its global async-module map overwrites duplicate ID 3781 by chunk filename order. The same `createHash` fallback mappings and extra 26,807-byte chunk already exist in the baseline. All nine baseline worker chunks are byte-identical, and the added-to-report fallback chunk is also unchanged. Correcting the reporter to use context-specific mappings is a separate low-priority tooling follow-up; no budget was weakened here.

### Security boundaries and remaining work

- Existing unresolved payments remain unresolved and reserved; this patch does not establish their chain outcome or make shared proofs revocable. No storage reset, expiry-based spend release, secret prefetch, automatic direct fallback or re-proving was added.
- A recipient's valid default Shielded address still requires explicit recipient-side **New address** before relay use. Full default-address relay compatibility would require a separately reviewed change to the helper receive-address reuse policy; it was deliberately not implemented.
- Real peer delivery and live ledger outcomes were not tested. Human assistive-technology testing and the unrelated complete production end-to-end/release pipeline remain separate from this focused repair verification.
- Keep exact approved authorization before any publication; an ACK is not a delivery boundary. Keep human approval deadlines separate from machine timeouts, and never let replay/nonces authorize duplicate signing or uncertain resubmission.
- The same durable relay ownership/preflight rule was added to `AGENTS.md`; `CHANGELOG.md` records the user-visible fixes under Unreleased. On user approval, local `main` was fast-forwarded to `1fa63e6`. Post-merge verification passed: 1,424 Node tests, typecheck and the production build. No remote push, hosted deployment or wallet-state change occurred.
