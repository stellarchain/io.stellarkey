# Remove Private Relaying Implementation Plan

> Implement this plan task-by-task, with independent inventory and code review.

**Goal:** Remove all application functionality for sending through a peer or earning by relaying, while preserving direct private payments and safe recovery of existing encrypted records.

**Architecture:** The wallet becomes direct-submission-only. Remove relay UI, runtime entry points, networking, worker helper operations, relay-only dependencies, and operational tooling. Preserve only authenticated legacy data validation and canonical recovery required to avoid releasing previously exposed inputs or losing historical records. Published circuit, contract, proof, and archive formats remain unchanged; their reserved fee-output lane is not a new relay feature.

**Tech Stack:** Next.js 16.3.4 static export, React 19, TypeScript, Stellar SDK, encrypted IndexedDB, Node test runner, isolated synthetic Playwright Chromium and iPhone WebKit.

**Baseline:** `main` at `0d9d6737`; isolated branch `refactor/remove-private-relaying`. `npm ci --no-audit --no-fund` succeeded and `npm test` passed 1,875 tests with zero failures/skips. The root worktree and its three pre-existing untracked documents are out of scope.

**Plan location:** This repository's release checks exclude `docs/plans/`; this document uses the existing top-level `docs/` convention instead.

## Scope and safety decisions

- Remove Earn/helper participation, sender relay preferences, endpoints/cluster settings, quote selection, fee agreement, relay approval dialogs, helper signing/submission, relayed consolidation, and all Waku/Nostr transport imports.
- Preserve deposit, direct send, direct withdrawal, direct chained consolidation, private receive, outgoing history, proof disclosure consent, and ambiguous-outcome reconciliation.
- Direct mode publicly identifies the submitting Stellar account. Do not silently convert a stale relayed draft/review into a direct submission; reject it and require a new review.
- Legacy pending records, proof-exposure holds, archive fee outputs, and old encrypted backups must remain readable. Already exposed or submitted actions remain held/reconcile-only according to existing canonical rules. Remove obsolete consent only with an atomic, tested migration that does not release those holds.
- Do not change protocol cryptography, contracts, circuits, deployed pool identity, proving binaries, or historical published changelog entries. Dependency-lock changes may require refreshing generated toolchain-provenance hashes only.
- Do not inspect a real wallet or restart/delete the user's Waku services. Browser checks use only isolated non-usable synthetic fixtures, with screenshots/traces/video disabled and the safe reporter.

## Task 1: Direct-only action boundary and runtime

**Files:** `src/features/private-balance/runtime/{provider,action-flow,action-transaction,proof-disclosure,submission,storage,types}.ts[x]`, `src/hooks/usePrivateBalanceRuntime.tsx`, worker client/messages/worker/action-builder, and focused runtime tests.

1. Add failing behavioral tests for rejection of legacy relay draft/preparation/submission inputs before storage, proof sharing, signing, or networking. Retain direct preparation/submission tests. Add regression tests for old pending relay holds and canonical reconciliation.
2. Run the new tests with `node --no-warnings --experimental-strip-types --loader ./tests/ts-resolve-loader.mjs --test tests/private-balance-no-relay.test.mjs`; verify the old implementation fails for the intended removal requirements.
3. Implement direct-only runtime APIs: `prepareAction(draft, onProgress?, signal?, authorizeDisclosure?)` and `submitAction(review)`. Remove helper/relay-chain entry points and remote preparation/submission branches. Keep ownership, cancellation, proof-exposure commit ordering, and canonical outcome tracking.
4. Remove worker helper payout and fee-verification entry points and prevent new peer-fee-bearing actions. Keep fixed protocol lanes and historical decoding/validation intact.
5. Isolate the minimum legacy journal schema/validation needed by storage and backups. Remove initiation/execution logic; preserve held inputs and validate migration using encrypted-state fixtures.
6. Run focused direct action, submission, proof exposure, storage, backup, recovery, chained send, and worker tests. Do not delete shared safety tests because they currently use a relay-generated fixture: replace setup with an isolated legacy-record fixture.

## Task 2: Remove relay controls and preserve direct interaction behavior

**Files:** `src/components/{Dashboard,PrivateBalanceRuntimeBoundary}.tsx`, `src/features/private-balance/components/{SendPrivate,WithdrawPrivate,PrivateActionReview,PrivateProtocolSettings,usePrivateActionController,PrivateReviewSimulation}.ts[x]`, all `PrivateRelay*.tsx` components, related unit tests, and isolated component fixture/spec wiring.

1. Add failing direct-only UI/structural tests: no Earn/helper mount, settings, submission selector, quote picker, relay socket creation, or runtime intent from old preferences; direct send/withdraw remain available.
2. Remove those controls and relay-only state while preserving modal shells, close policy, focus/inertness/scroll lock, explicit private intent, direct proof-sharing consent, cancellation, stale-result ownership, and direct chained-send behavior.
3. Adapt controller calls to Task 1's direct-only signatures. Display direct-source metadata disclosure; do not present relay alternatives or helper fees.
4. Remove relay-only synthetic fixtures/specs. Keep required component, private UI, overlay, manifest, and legacy recovery gates, adapting fixtures rather than weakening capture or skip policies.
5. Run focused tests plus synthetic browser checks for direct send/withdraw/recovery, old preferences, close/reopen, rapid navigation, cancellation, and narrow iPhone WebKit accessibility. Parent coordinates exclusive browser/build execution.

## Task 3: Remove transports, dependencies, and obsolete tooling

**Files:** `src/features/private-balance/relay/`, `src/lib/private-relay-quote-signing.ts`, relay runtime planners/executors, `package.json`, `package-lock.json`, relay-only tests/scripts, browser config and safety assertions.

1. Add failing structural/dependency tests ensuring production source has no Waku/Nostr/helper imports and the four relay-only direct dependencies are absent.
2. Delete exact tracked relay-only targets after checking their remaining importers. Remove `@waku/sdk`, `@chainsafe/libp2p-yamux`, `@libp2p/mplex`, and `nostr-tools` from the manifest and regenerate the npm lockfile without unrelated upgrades.
3. Remove relay-only measurement/live-node tooling and obsolete runner wiring. Keep required non-relay verification gates and safe reporter behavior.
4. Run `npm run typecheck`, focused tests, `npm test`, and `npm run test:private-protocol`; investigate every failure without dropping unrelated coverage.

## Task 4: Current documentation and release notes

**Files:** `CHANGELOG.md`, `README.md`, current privacy/security/private-payment public pages, marketing copy, relevant current `docs/` and operational guidance.

1. Add `[Unreleased]` Removed/Changed entries explaining removal of relay/earn functionality and direct-only submission, including public submitting-account metadata and preserved historical recovery.
2. Remove current instructions and claims advertising peers, Nostr/Waku, helper earnings, fee negotiation, or relay deployment. Clearly mark retained historical design documents as historical; do not rewrite published release history or user-owned untracked documents.
3. Preserve accurate documentation of the immutable protocol and archived fee lanes. Update related documentation tests to the supported direct-only behavior.

## Task 5: Complete verification and independent review

1. Run fresh `npm run typecheck`, `npm test`, `npm run test:private-protocol`, `npm run lint`, and relevant accessibility checks.
2. Run required synthetic component and private UI suites in both configured browsers, plus safe-reporter checks; no real wallet use, captures, gate waivers, or blanket skips.
3. Run `npm run private:check-generated`; install the circuit project's locked dependencies if needed. Verify any generated changes are provenance metadata only, not circuit/proof/deployment changes.
4. Run `npm run check:fixture-clean`, `npm run build`, `npm run check:fixture-clean`, `npm run test:bundle`, and `npm run check:bundle`. Run production audit and distinguish remaining package counts/advisories from removed relay dependencies.
5. Request independent spec-compliance review, resolve gaps, then request code-quality/safety review. Review removal completeness, old-data handling, direct payment behavior, and tests.
6. Commit the coherent removal with its changelog, report actual verification results, and request local-main integration according to the branch-finishing workflow. No push, release, tag, or external service deletion is authorized.

## Done criteria

- No user can start, configure, select, approve, or earn from peer relaying.
- No production import or installed relay-only dependency can start Waku/Nostr networking.
- New private actions use the explicitly reviewed direct account; stale relay inputs fail closed.
- Existing private funds/history/backup records remain readable and exposed or uncertain actions retain canonical recovery protections.
- Direct UI, runtime, protocol, safe synthetic browser, build, bundle, and generated-manifest checks pass; no unrelated verification gate is removed.

## Execution record — 2026-09-10

**Status:** Relay removal is implemented and independently reviewed. Integration remains blocked by the shared-UI browser failures below; the separately approved restore-feedback fix is recorded at the end of this document. The branch is not merged and the aggregate application/release gate is not green.

### Implemented

- Removed peer/Earn controls, helper participation and approvals, relay selection and fees, runtime relay entry points, Waku/Nostr networking, and relay-only tooling and tests. Converted shared recovery and multi-wallet tests to direct RPC scenarios instead of deleting their safety coverage.
- Added direct-only rejection boundaries before preparation, proof disclosure, signing, storage, and submission. Kept explicit public submitting-account disclosure and direct chained sends.
- Retained validated legacy encrypted journals and canonical recovery. Retiring obsolete relay-chain consent does not release exposed inputs, pending actions, or issued-address history.
- Removed four direct dependencies and 172 installed package entries. No packages were added and retained package versions, integrity values, and resolved URLs are unchanged.
- Refreshed only dependency-provenance hashes and their authenticated manifest/catalogue pins. Published protocol, proving artifacts, contracts, and deployment bindings are unchanged. Published changelog entries for 1.4.1 and older are byte-identical to the base branch.
- Independent runtime and UI spec/quality reviews completed. Fixed review findings around duplicate confirmation ownership, busy-state focus, immediate Escape handling, and direct-review contrast; added focused regressions and real-control synthetic browser coverage.

### Verification evidence

| Check | Result |
| --- | --- |
| `npm test` | 1,721 passed; zero failures or skips |
| `npm run typecheck` | Passed |
| `npm run lint` | Zero errors; three existing marketing-image warnings |
| `npm run test:private-protocol` | 58 passed; zero failures or skips |
| `npm run private:check-generated` | Passed; all three proof vectors verified |
| `npm run audit:prod` | Gate passed; ten low-severity package findings from one remaining elliptic advisory in the Trezor dependency tree |
| `npm run test:e2e:reporter` | Two passed; capture and safe-reporting restrictions verified |
| Required private UI / overlay / manifest browser suite | 16 passed across Chromium and iPhone WebKit; zero skips |
| Direct-only component scenarios | 20 passed across Chromium and iPhone WebKit; zero skips |
| Full component suite, default one worker | 563 passed, one failed, zero skips |
| Unchanged Select case, 12 repetitions per browser | 24 passed; zero retries or skips |
| Full component suite, supplemental two-worker run | 561 passed, three failed, zero skips |
| Exported-site Playwright suite | 122 passed, two failed; 303 existing fixture-, environment-, or project-specific skips |
| Production build, fixture cleanup, bundle tests and budgets | Passed; five bundle tests passed |

The required synthetic component and private UI gates remain wired into shared CI and release verification. No failing assertion, accessibility rule, deadline, capture restriction, or required gate was removed to obtain these results.

### Verification blockers requiring follow-up

1. `e2e/restore-feedback.spec.ts` fails at the busy-state assertions in its keyboard/retry and stale-read-error cases. `Onboarding.tsx` changes the Restore description during a file read but does not expose `aria-busy` or the named reading status expected by these tests. The component and tests are unchanged from the base branch. The cancellation and oversized-file cases pass. Approval was requested for a separate, small accessibility fix; no unrelated onboarding change is included here.
2. The default component run fails the Select Tab-continuation focus assertion in `e2e/ux-primitives.spec.ts`. All 24 isolated repetitions pass, but the supplemental full run fails the same case while waiting for its listbox to close. The underlying cause is not established; isolated passes do not clear this failure.
3. The supplemental two-worker run additionally fails the Add Account modal accessibility audit in `e2e/modal-ownership.spec.ts` and one tooltip pointer-transfer case in `e2e/ux-primitives.spec.ts`. Both pass in the default run. Their shared production primitives and tests are unchanged; these failures remain recorded rather than waived.

All browser checks used isolated non-usable synthetic fixtures with screenshots, traces, and video disabled. No real wallet or external relay service was inspected, stopped, or removed. Human VoiceOver/NVDA checks, physical-device pinch testing, live-funded protocol checks, and separate Rust/circuit release jobs are not claimed by this application verification. No release, tag, push, or deployment was performed.

## Approved follow-up: restore busy/status accessibility

The user approved fixing only the pre-existing backup-restore feedback bug in a separate commit. The shared Select, tooltip, and Add Account failures remain outside this follow-up.

**Design:** Reuse the existing request-owned `readingBackup` state. Pass it through an optional `busy` prop to the existing `OnboardPath` button as `aria-busy`. Keep a separate, persistent polite status region outside the busy button, populated and named only during the current read. Do not change file parsing, cryptography, request ownership, retry/replacement behavior, or workflow navigation. Limit the touched onboarding control's CSS transitions to its actual animated properties.

**Implementation and verification plan:**

1. Strengthen `e2e/restore-feedback.spec.ts` with busy/status cleanup, keyboard-focus, and live-region-placement assertions. Include the same four scenarios in iPhone WebKit through `playwright.config.ts`.
2. Run `E2E_PORT=3196 npx playwright test e2e/restore-feedback.spec.ts --project=desktop-chromium --project=iphone-webkit` against the unchanged production export and confirm the missing busy/status failures.
3. Apply the minimal markup/prop fix in `src/components/Onboarding.tsx` and add an `[Unreleased]` Fixed entry in `CHANGELOG.md`.
4. Rebuild with fixture-clean checks before and after, rerun the eight restore scenarios, typecheck, lint the touched files, run the full unit suite and focused onboarding accessibility checks, and request an independent diff review.
5. Record the results here and create one separate fix commit. Do not merge, release, or claim the unrelated browser blockers are resolved.

**Result:** Implemented as the approved isolated markup/prop change, with no file-reading, parsing, or request-ownership changes. The strengthened tests first produced six expected failures across eight cases against the unchanged export (missing busy attributes); after the fix, all eight cases passed across Chromium and iPhone WebKit with zero failures, retries, or skips. The tests cover keyboard focus, announcement placement outside busy ancestry, completion/error cleanup, cancellation, oversized files, and stale-error ownership.

Fresh verification also passed: all 1,721 unit tests, typecheck, touched-file lint with zero warnings, production build, fixture cleanup before/after the build, all five bundle tests and budgets, and three existing onboarding/accessibility browser checks with zero skips. Independent read-only review found no issues. Human screen-reader announcement checks were not performed. Only the restore-feedback blocker is resolved; the earlier Select, tooltip, and Add Account failures were not changed or waived, and the full application gate is not claimed green.
