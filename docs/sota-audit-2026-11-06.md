# StellarKey SOTA Audit — 2026-11-06

## Scope and convention

- **Branch:** `audit/sota-simple-correct-fast`
- **Main baseline:** `a66a4771adb583bcfd30802c12c8e8bbe225927f`
- **Convention:** simple → correct → fast. Prefer the smallest change that establishes correct behavior, then optimize measured costs.
- **Method:** source inspection, project test suites, production build/bundle analysis, and disposable synthetic diagnostics against real callbacks. No live Stellar submission, funded account, real wallet session, or external write was used.
- **Workspace note:** Concurrent working-tree edits appeared during the audit and were preserved. Final production output used the updated dirty tree, including Next.js 16.4.5; it is not a clean release artifact for the named main commit.
- **Audit-authored changes:** This report is the only requested audit artifact. No product source, test, dependency, release, or Git history changes were made by the audit.

## Executive summary

The existing architecture has strong privacy, transaction-recovery, lazy-loading, and release guardrails. A broad rewrite is not warranted. The highest-leverage work is to make asynchronous ownership consistent across wallet refreshes and every signing flow, then tighten recovery/reset semantics. Performance work should follow those correctness fixes and use the existing UX and bundle measurements.

Seven product findings are prioritized below, followed by one timing-sensitive test issue. Six findings were reproduced with synthetic fixtures; the performance finding is source- and bundle-supported but its runtime rendering benefit has not been profiled.

## Findings

### [COR-01] P1 — Delayed refreshes can display another account's data

- **Evidence:** `src/components/SendModal.tsx:774`, `src/components/SendModal.tsx:818`, and `src/components/BatchSendModalBody.tsx:299` schedule uncancelled four-second refreshes. `src/hooks/useWallet.tsx:989` builds each refresh around the account/network captured by that render; publication occurs at `:1033–1117`. Request generations order callbacks but do not establish that an old callback still belongs to the visible account.
- **Observed:** After hydrating account B, invoking a previously captured account-A refresh replaced B's balances and prepended A's activity into B's history in a synthetic callback diagnostic.
- **Impact:** Switching accounts after an accepted send can show incorrect balances and cross-account activity. This is both a correctness and privacy-boundary problem.
- **Effort:** S (hours, including regression tests).
- **Risk:** LOW. The delayed refresh is redundant with canonical submission tracking and visible-wallet refresh behavior.
- **Confidence:** HIGH. Reproduced against the real provider callback with synthetic data.
- **Fix sketch:** Remove the three delayed timers. Also bind refresh entry and publication to the current account/network/endpoint identity so a stale caller cannot become the newest authority merely by starting later. Add a regression test that invokes account A's captured refresh after account B is active.

### [COR-02] P1 — Revalidate account/network context across every signing flow

- **Evidence:** Ordinary send and swap capture signing context at `src/hooks/useWallet.tsx:2466` and `:2697`. Stealth submission (`:2523`), batch sends (`:2547`), claims (`:2580`), account merge (`:2607`), trustline changes (`:2629` and `:2651`), multisig updates (`:2753` and `:2783`), and co-signing (`:2839`) lack the equivalent guard. `src/lib/vault.ts:131–134` detects lock/reset/session replacement, not account or network replacement.
- **Observed:** In the same synthetic context-replacement diagnostic, ordinary send refused before API loading, while account merge signed and made a mocked POST with the stale account.
- **Impact:** An asynchronous module load, password approval, preparation request, or hardware interaction can finish under an obsolete review context. Depending on the flow, this can sign or submit an action the user no longer sees in the active wallet context.
- **Effort:** L (multiple signing modules and a broader behavioral matrix).
- **Risk:** HIGH because this touches financial signing boundaries, although the existing signing-context harness provides a strong verification pattern.
- **Confidence:** HIGH. The missing guards and representative stale merge were directly confirmed.
- **Fix sketch:** Reuse one reviewed-context guard for every flow and assert it before software signing, after hardware approval, and immediately before submission. Thread the guard through the relevant API/multisig/stealth functions. Extend `tests/signing-security-ui.test.mjs` across account, network, ABA replacement, unmount, approval, preparation, journal, and pre-POST gaps for every signing operation.

### [COR-03] P2 — Release pending-poll ownership after loading failures

- **Evidence:** `src/hooks/useWallet.tsx:1440` adds the transaction identity to `pendingPolls` before `loadWalletApi()` at `:1452`. The identity is deleted only after successful loading/resolution at `:1464`. `retryPendingTransaction` at `:1807` calls the same latched callback.
- **Observed:** A synthetic dynamic-import rejection left the identity in `pendingPolls`; an immediate retry returned without attempting another API load.
- **Impact:** Canonical transaction status and dependent merchant finalization can remain stuck until the wallet remounts, even after the user explicitly requests a status check.
- **Effort:** S.
- **Risk:** MED because retry scheduling must preserve the existing expiry/manual-check policy and avoid duplicate polling.
- **Confidence:** HIGH. Reproduced against the real callback.
- **Fix sketch:** Put loading and lookup inside a handled boundary and always release the in-flight identity in `finally` when ownership is current. Retry only still-current records with bounded scheduling, and add a failed-load-then-successful-manual-retry regression test.

### [COR-04] P2 — Do not report complete erasure after partial cleanup

- **Evidence:** `src/hooks/useWallet.tsx:1983` awaits cleanup through `Promise.allSettled` but ignores every result, then reaches `window.location.reload()` at `:2002`. The user action is labeled `Erase everything` at `src/components/ResetWalletModal.tsx:63`.
- **Observed:** A synthetic service-worker cleanup rejection was swallowed and the reset callback still reloaded into its reset state.
- **Impact:** Vault signing authority is revoked first, but encrypted merchant/private records, service-worker registrations, or shell caches can remain while the UI implies complete erasure. Residual encrypted state may also matter if an old backup is later restored.
- **Effort:** M (failure-state design and fault-injection coverage).
- **Risk:** MED. The fix must not restore signing authority or leave the wallet unlocked merely because secondary cleanup failed.
- **Confidence:** HIGH. The ignored results and successful continuation were directly exercised.
- **Fix sketch:** Keep key erasure and session revocation authoritative, but aggregate cleanup failures and present an explicit partial-erasure state with retry instead of unconditional success. Add behavioral tests for merchant IndexedDB, private-record, service-worker, cache, and storage failures.

### [COR-05] P2 — Paginate claimable balances beyond the first 20 records

- **Evidence:** `src/lib/api.ts:191–221` performs one `claimable_balances?claimant=…&limit=20` request. `src/hooks/useWallet.tsx:1020` consumes only that result, and the claim modal has no continuation path.
- **Observed:** A synthetic response containing a next-page link resulted in one request and 20 returned records.
- **Impact:** Accounts with more than 20 claimable balances cannot see or select the later records.
- **Effort:** M.
- **Risk:** MED because additional requests and deduplication must remain bounded and stale responses must not merge across accounts/networks.
- **Confidence:** HIGH. The single-page behavior is explicit and reproduced.
- **Fix sketch:** Add bounded cursor pagination with validated, deduplicated balance IDs. Preserve an explicit continuation/retry state when the bound is reached instead of silently truncating.

### [COR-06] P3 — Map zero-limit trust operations to removal

- **Evidence:** `src/lib/api.ts:625–634` assigns every `change_trust` operation the title `Trustline Added` and does not read the operation's `limit` field.
- **Observed:** A synthetic `change_trust` operation with `limit=0.0000000` rendered as `Trustline Added`.
- **Impact:** Wallet activity and exports misrepresent a trustline removal, reducing ledger clarity.
- **Effort:** S.
- **Risk:** LOW.
- **Confidence:** HIGH. Reproduced through `fetchActivity`.
- **Fix sketch:** Include `limit` in the raw operation shape and map an exact zero limit to `Trustline Removed`. Add add/remove activity tests, including CSV output if affected.

### [PERF-01] P3 — Finish narrow-context migration and remove dead aggregate work

- **Evidence:** The compatibility-wide wallet value at `src/hooks/useWallet.tsx:2967–3146` is still consumed by `src/components/Dashboard.tsx:226`, `src/components/SettingsPage.tsx:222`, `src/components/dashboard/Sidebar.tsx:82`, and `src/components/dashboard/ShellChrome.tsx:161`, despite the domain contexts at `src/hooks/useWallet.tsx:540–547`. The merchant aggregate at `src/hooks/useMerchant.tsx:3951–3958` has no production `useMerchant()` callers.
- **Impact:** Market, activity, and pending-transaction changes can rerender unrelated large trees, especially Settings and AccountMenu. The merchant aggregate adds object construction without a consumer. This is also unnecessary compatibility surface in already-large providers.
- **Effort:** M. Migrate smaller consumers first; Dashboard may require view-level subscription boundaries rather than only replacing its hook.
- **Risk:** MED because regrouped dependencies can alter render timing and interaction ownership.
- **Confidence:** MED. Subscription behavior and the unused merchant API are source-confirmed; the rendering/startup benefit is not yet profiled.
- **Fix sketch:** Migrate Settings and AccountMenu/Sidebar to domain hooks, introduce view-level Dashboard subscriptions where useful, and remove the unused merchant aggregate after updating its source-policy test. Compare the existing synthetic UX lab before and after rather than claiming a win from line counts.

## Timing-sensitive test issue

### [TEST-01] P3 — Investigate the abandoned-backup-read browser failure

- **Evidence:** The full production matrix failed only `e2e/restore-feedback.spec.ts:56` on desktop Chromium. The same scenario passed on iPhone WebKit in that matrix and passed five consecutive isolated desktop Chromium repetitions. The fixture checks button visibility at `e2e/restore-feedback.spec.ts:24` and directly sets the hidden file input at `:57`.
- **Impact:** One failed attempt makes the production gate red even though the product behavior was not reproduced in isolation. The current evidence does not prove a product defect or establish hydration as the cause.
- **Effort:** S for investigation and a deterministic regression guard.
- **Risk:** LOW, provided no arbitrary timeout or capture of wallet content is introduced.
- **Confidence:** MED that the test is timing-sensitive; the exact failing assertion and trigger remain unknown.
- **Investigation:** Add only structural stage diagnostics to identify whether the read count, import heading, status removal, or stale redirect timed out. If hydration is confirmed, wait for deterministic handler readiness before direct input; do not add a fixed sleep or weaken the assertion.

## Performance snapshot

The final production build and bundle gates passed. Relevant gzip measurements and their fixed budgets were:

| Journey | Measured gzip | Budget | Headroom |
| --- | ---: | ---: | ---: |
| Initial wallet route | 352,850 bytes | 360,000 bytes | 7,150 bytes |
| Public landing | 207,354 bytes | 215,000 bytes | 7,646 bytes |
| Unlocked increment | 164,938 bytes | 175,000 bytes | 10,062 bytes |
| Merchant increment | 147,474 bytes | 153,000 bytes | 5,526 bytes |
| Hardware increment | 127,949 bytes | 225,000 bytes | 97,051 bytes |
| Private Balance feature | 71,709 bytes | 140,000 bytes | 68,291 bytes |

The initial route also measured 1,189,167 raw bytes against a 1,350,000-byte raw budget. Private Balance artifacts measured 10,914,961 gzip bytes against a 13,000,000-byte budget, with a 36,028,666-byte two-version cache peak against a 50,000,000-byte budget.

These measurements support preserving lazy boundaries and creating headroom through demonstrated dead-code removal. They do not justify raising budgets, speculative micro-optimization, or a state-management rewrite. No before/after UX profile was run because no performance implementation was requested.

## Verification record

| Check | Result |
| --- | --- |
| Initial main `verify:application:core` | Passed: 2,081 unit/source tests, 64 browser-protocol tests, and 2 reporter tests |
| Final updated `npm test` | **2,087/2,087 passed** |
| Final `npm run typecheck` and `npm run lint` | Passed |
| `npm run private:check-generated` | Passed |
| `npm run test:private-protocol` | 64/64 passed |
| `npm run test:e2e:reporter` | 2/2 passed |
| Focused audit suites | 213 signing/submission/storage/activity/context tests passed; 11 Friendbot/artifact tests passed |
| Private UI browser gate | **16 completed, 0 failed attempts, 0 skipped** |
| Private component browser gate | **724 completed, 0 failed attempts, 0 skipped** |
| Production build with Next.js 16.4.5 | Passed, including TypeScript and static export generation |
| Production bundle tests and budgets | 5/5 tests passed; all measured budgets passed |
| Full production browser matrix | **Failed: 562 completed, 174 passed, 387 skipped, 1 failed attempt** |
| Isolated abandoned-read check | 5/5 desktop Chromium repetitions passed; the matrix iPhone WebKit case also passed |
| `npm run audit:prod` | Zero reported vulnerabilities |
| `npm run audit:all` | Eight moderate vulnerable packages associated with one minimatch advisory; no high/critical findings |

The full application verification command is therefore **not green**, despite the isolated restore repetitions passing. Skipped production checks remain distinct from passes, and the private/live fixtures covered by those skips are not claimed as production-browser coverage.

Not exercised: Rust workspace/security gates, circuit Gate A, canonical-artifact reproducibility, the 100,000-action model, physical Trezor/passkeys/installed-PWA behavior, human VoiceOver/NVDA and physical zoom checks, or funded/live Testnet journeys. No physical-device, release-readiness, Mainnet, ceremony, or real-value Private Payments approval is implied.

## Recommended implementation order

1. **COR-01 and COR-03:** Small, high-leverage ownership fixes with direct regression tests.
2. **COR-02:** Unify all signing-context guards before expanding other transaction work.
3. **COR-04:** Make partial reset outcomes truthful and recoverable.
4. **COR-05 and COR-06:** Complete claim discovery and correct activity semantics.
5. **TEST-01:** Establish a deterministic production-browser gate before relying on it for broader refactors.
6. **PERF-01:** Consolidate contexts only after correctness work, with UX measurements and bundle diffs.

Each user-visible implementation should include its focused tests and the required `[Unreleased]` changelog entry. The audit itself does not alter product behavior and adds no release note.

## Not worth doing

- Do not start a framework or state-library rewrite; the existing boundaries already support targeted fixes.
- Do not raise bundle budgets to accommodate unexamined growth.
- Do not blindly run `npm audit fix --force`; the proposed remediation is a breaking `eslint-config-next` downgrade to 15.5.29.
- Do not enable Mainnet Private Payments or treat headless synthetic checks as live, physical-device, ceremony, or release evidence.
- Do not hide the restore-test failure with retries, arbitrary sleeps, or weaker assertions.
