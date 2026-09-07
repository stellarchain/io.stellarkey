# Relay payment recovery diagnostic test plan

**Goal:** Reproduce and distinguish a failed Alice/Bob/Charlie relay payment from a lost or reserved original deposit, with Alice charging exactly 3 XLM.

**Architecture:** Isolated, non-usable synthetic deployment. Exercise production action preparation, note encryption, Merkle verification, encrypted state transitions, signing/submission classification, canonical sync and recovery. Replace only proof generation, archive transport and helper/RPC responses. Browser checks exercise this pipeline with real IndexedDB; existing helper/controller browser checks cover their controls separately. This is not live three-wallet network E2E and must not be reported as such.

**Tech stack:** Next.js 16.3.3, Playwright Chromium/iPhone WebKit, Stellar SDK, production private-balance cryptography, Node test runner.

## Tasks

1. Add `tests/private-balance-relay-recovery.test.mjs` with success/change, exact spend, two inputs, insufficient fee coverage, pre-disclosure cancellation, post-disclosure rejection/timeout, pending/uncertain submission and canonical recovery assertions. First run establishes missing harness; no production implementation change is authorized.
2. Add shared test-only `e2e/fixtures/relay-recovery-scenario.ts`. Construct real synthetic deposits and encrypted outputs for Alice, Bob and Charlie; call `preparePrivateBalanceActionFlow`, signing/broadcast functions and `syncPrivateBalance`. Assert balances using production selectors and independently decrypted transcript output values, never hard-code runtime outcomes in the fixture.
3. Add `e2e/fixtures/relay-recovery-panel.tsx` and `e2e/relay-recovery.spec.ts`; wire the existing exclusive temporary-fixture runner. Persist with real IndexedDB and prove reload retains reservations/change. No wallet import, real funds, keys, network services, screenshots, videos or traces.
4. Run focused Node tests, browser matrix on both engines, typecheck, lint and fixture-clean gate. Run existing relay interaction cases alongside the new checks. Document expected safety holds separately from bugs; preserve a reproducible diagnostic assertion if the original deposit becomes unavailable indefinitely.
5. Record findings and exact verification in this plan. Do not implement a recovery/security change, release, merge, tag or push. A new proof sharing/recovery policy requires explicit user direction.

## Expected accounting invariants

- Confirmed send: Bob's change + Charlie's payment + Alice's 3 XLM fee equals Bob's original deposit(s), excluding Alice's separate public network fee.
- No proof disclosure: cancellation/failure releases the original input reservation.
- Proof disclosed but absent from canonical transcript: the original value remains encrypted and reserved, with no invented fee/change or confirmation. Expiry alone must not release a reusable proof.
- Later canonical inclusion: input becomes spent exactly once, pending journal reconciles, and each party recovers its own outputs, including after a fresh scan.

## Verification commands

`node --no-warnings --experimental-strip-types --loader ./tests/ts-resolve-loader.mjs --test tests/private-balance-relay-recovery.test.mjs`

`E2E_PORT=3297 npm run test:e2e:private-components -- relay-recovery.spec.ts`

`npm run typecheck` / `npx tsc --noEmit -p e2e/tsconfig.relay-recovery.json` / `npx eslint e2e/fixtures/relay-recovery-scenario.ts e2e/fixtures/relay-recovery-panel.tsx e2e/relay-recovery.spec.ts` / `npm run check:fixture-clean`

## Baseline

Branch `test/relay-payment-recovery`, based on `main` at `4e276f82`. All 1,716 baseline Node tests passed. The existing funded-wallet browser safety guard remains unchanged.

## Findings — reproduced reservation, not established on-chain loss

The production payment-preparation path reproduces the reported disappearing-balance symptom in a controlled environment. With one synthetic 100 XLM Bob deposit, a 10 XLM Charlie payment and Alice's 3 XLM fee:

| Boundary/result | Bob spendable | Bob reserved | Alice received | Charlie received |
| --- | ---: | ---: | ---: | ---: |
| Before preparation | 100 | 0 | 0 | 0 |
| Cancel, prover failure, or quote expiry before sharing | 100 | 0 | 0 | 0 |
| Helper rejects/times out after sharing | 0 | 100 | 0 | 0 |
| PENDING, RPC error, uncertain response, or signing rejection | 0 | 100 | 0 | 0 |
| Synthetic canonical inclusion | 87 | 0 | 3 | 10 |

The helper-preparation failure has a durable `prepared` / `proofExposure: shared` action, zero broadcast attempts and no signed envelope. The input note still exists in encrypted storage. Expiry cleanup and canonical absence retain the reservation. Real IndexedDB reload checks preserve both this held state and successfully reconciled balances.

### Why the balance disappears

1. `src/features/private-balance/runtime/action-flow.ts:709` commits proof exposure before handing the proved operation to helper preparation. A helper failure occurs after that durable boundary.
2. `src/features/private-balance/runtime/storage.ts:1215` refuses to release an exposed spend. `runtime/submission.ts:146` classifies it as ambiguous even after envelope failure/expiry and canonical absence.
3. `src/features/private-balance/runtime/selectors.ts:4` includes only unspent notes in the spendable balance; it excludes the whole reserved input, not just the payment and fee.
4. `src/features/private-balance/runtime/action-flow.ts` blocks another action while an exposed spend remains unresolved. The reservation is not cleared by a page reload.

This is an availability/recovery limitation, with a security reason: a spend proof authorizes outputs independently of the helper's particular envelope. `protocol/private-balance/contracts/pool/src/contract.rs:135` refreshes an anchor that remains the current root. Quote or envelope expiry therefore does not prove that a disclosed proof can never be used in another envelope. Clearing journals or marking these inputs unspent is not an established safe fix.

### Coverage and limitations

- Seventeen new Node cases cover one/two inputs, exact spend, fractional payment/change, insufficient fee coverage, pre-disclosure failures, helper rejection/timeout, signing rejection, PENDING/error/uncertain submission, unrelated deposits, consolidation preflight, minimized outgoing history, repeated sync and fresh seed-derived scans.
- Twenty-eight new browser checks run on Chromium and emulated iPhone WebKit; eighteen existing relay/controller/proof-consent checks run alongside them. Keyboard cancellation and automated WCAG checks are included. No human VoiceOver/NVDA or physical-device checks were performed.
- Cryptographic note/output construction, encryption, Merkle validation, state persistence and scanning are real. Network/archive responses, proof generation, helper prepared-envelope replies and submission results are controlled test boundaries. Browser persistence uses real IndexedDB; Node storage uses the synthetic in-memory driver.
- The three accounting actors are independent cryptographic identities, not three complete wallet/provider sessions connected through the real helper manager/Nostr transport. Existing helper/controller tests cover those controls separately.
- `confirm()` injects a transcript fixture into the synthetic ledger. It proves reconciliation and output recovery **if inclusion is observed**, not valid-proof execution, actual contract acceptance or a working live relay.
- The actual reason the user's relay send failed remains unverified. These tests do not establish real on-chain loss, a 3 XLM-specific defect, or a safe recovery path for the user's existing held deposit.
- Live funded-wallet testing remains blocked by the existing runner's inability to suppress locator failure snapshots. No real wallet data, funding, or network transaction was used. Screenshots, traces and videos remained disabled.

### Verification recorded

- Baseline: 1,716 Node tests passed.
- Final full Node suite: 1,733 passed, zero failures/skips/todos (`npm test`).
- Focused preparation/submission/proof-exposure/relay-chain/sync matrix: 69 passed, zero failures/skips.
- Browser command: `E2E_PORT=3297 npm run test:e2e:private-components -- relay-recovery.spec.ts private-components.spec.ts --grep 'three-wallet relay|relay|helper|proof sharing'` — 46 passed, zero failures/skips.
- Dedicated fixture TypeScript check and application typecheck passed; focused lint passed without warnings.
- Temporary fixture source/export cleanup and `git diff --check` passed.
- Independent test-fidelity review completed. Added exact failure-stage/cause assertions, returned and durable submission classifications, and counted sender-RPC lookup assertions (zero calls).
- No production source, contract, manifest, dependency or recovery-policy changes. No release, merge, tag or push.
