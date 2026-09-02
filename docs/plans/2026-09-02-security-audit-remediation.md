# Security Audit Remediation Implementation Plan

> **For the implementing agent:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reproduce, prioritize, and fix the security-audit findings that remain true on the current
branch without weakening working controls or fabricating deployment evidence.

**Architecture:** Put validation at vault, merchant-store, authority, and submission choke points;
make optional backup metadata tolerant per entry; keep UI trays and caches as bounded projections of
durable truth; and replace security source greps with behavioral tests.

**Tech Stack:** Next.js 16.3, React 19, TypeScript 6, Node test runner, Playwright, Stellar SDK 17,
Soroban Rust, Circom/snarkjs, IndexedDB/localStorage/Web Locks.

---

### Task 1: Prevent self-corrupting vault labels

**Files:** `src/lib/backup-schema.ts`, `src/lib/vault.ts`,
`src/components/RenameAccountModal.tsx`, `src/hooks/useWallet.tsx`,
`tests/vault-v3.test.mjs`, `CHANGELOG.md`

1. Add a test that writes a 257-character label and proves the live vault stays readable.
2. Run it and confirm it fails because `updateAccountLabel` writes an undecodable vault.
3. Export the decoder limit, validate every vault immediately before persistence, bound the writer,
   and update React state only after persistence succeeds.
4. Add the input limit and surface save errors without closing or showing a success toast.
5. Run focused vault and component-boundary tests, then commit.

### Task 2: Canonicalize merchant integrity ordering

**Files:** `src/lib/merchant/repository.ts`, `src/lib/vault.ts`,
`tests/indexed-db.test.mjs`, `tests/vault-v3.test.mjs`, `CHANGELOG.md`

1. Add a regression with `aa`, `ab`, `dd`, and `df` record suffixes proving digest identity across
   English, Danish, Welsh, and Hawaiian collation.
2. Confirm the current locale-based implementation fails.
3. Replace integrity ordering and backup-identity ordering with a code-unit comparator.
4. On digest mismatch, authenticate against the finite legacy collations identified by the audit and
   reseal only after one matches; otherwise retain the corrupt verdict.
5. Run repository/backup tests and commit.

### Task 3: Make transaction-note backups self-consistent

**Files:** `src/lib/vault.ts`, `src/lib/backup-schema.ts`, `tests/vault-v3.test.mjs`,
`tests/private-balance-backup.test.mjs`, `CHANGELOG.md`

1. Add a backup round-trip test for a journal-less `private:<deployment>:<activity>` note key and a
   malformed optional key.
2. Confirm the private key rejects the whole backup today.
3. Define one shared transaction-note key predicate used by write and read paths.
4. Accept canonical private activity keys; omit unknown optional keys with a reported warning rather
   than rejecting key recovery.
5. Validate a freshly exported backup before returning it and record backup health only afterward.
6. Run focused backup tests and commit.

### Task 4: Recover archived-account private backups

**Files:** `src/lib/vault.ts`, `src/features/private-balance/runtime/backup.ts`,
`src/hooks/useWallet.tsx`, `tests/private-balance-backup.test.mjs`, `tests/vault-v3.test.mjs`,
`CHANGELOG.md`

1. Add a test that archives an account with private state, exports, inspects, and restores the file.
2. Confirm inspection fails on the accounts-only key resolver.
3. Resolve storage keys from live plus archived accounts in the embedded backup vault.
4. Make a truly unknown private record a reported omission, not a whole-backup rejection.
5. Purge known account-scoped private data prospectively when archival completes, without touching
   public wallet or merchant records.
6. Run focused tests and commit.

### Task 5: Bind multisig configuration to canonical, explicit authority

**Files:** `src/components/MultiSigStudioModal.tsx`, `src/lib/multisig.ts`, `src/lib/api.ts`,
`tests/domain.test.mjs`, `tests/multisig-review.test.mjs`, `CHANGELOG.md`

1. Add a behavioral test where custom and canonical Horizon return different signer sets.
2. Confirm the modal seed can grant the custom endpoint's phantom signer and remove a hidden real one.
3. Seed the form from canonical Horizon, track keys explicitly added/reweighted in-session, and reject
   any positive addition without that provenance.
4. Show every addition and removal in full before signing; recheck canonical authorization at submit.
5. Replace the relevant source-name grep with the behavioral test and commit.

### Task 6: Keep every reconciliation row resolvable

**Files:** `src/lib/merchant/reconciliation.ts`, `src/lib/merchant/invoices.ts`,
`src/lib/merchant/storage.ts`, `src/lib/merchant/shifts.ts`, merchant reconciliation tests,
`CHANGELOG.md`

1. Add a test with one genuine unresolved row followed by more than 200 dust rows.
2. Confirm the row leaves the tray, cannot resolve, and permanently blocks shift close.
3. Resolve against the reconciliation record itself and derive/cap only the rendered tray projection.
4. Add a bounded owner-authorized bulk resolution that records every disposition.
5. Bound/coalesce retained dust without dropping genuine value or falsifying Z-reports.
6. Run merchant reconciliation/shift tests and commit.

### Task 7: Restore merchant break-glass recovery

**Files:** `src/hooks/useMerchant.tsx`, `src/components/merchant/MerchantPage.tsx`,
`src/components/MerchantRuntimeBoundary.tsx`, merchant runtime tests, `CHANGELOG.md`

1. Drive a corrupt store through lock/reload and prove export/reset are unreachable or rejected.
2. Require wallet reauthentication, not merchant-session authority, when a storage issue exists.
3. Keep the provider/recovery panel reachable independently of the unreadable store's enabled flag.
4. Await reset, surface failure, and preserve the raw export until reset succeeds.
5. Run behavioral runtime tests and commit.

### Task 8: Normalize merchant payer identity and settlement evidence

**Files:** `src/lib/merchant/watch.ts`, `src/lib/merchant/customers.ts`,
`src/hooks/useMerchant.tsx`, merchant watch/customer tests, `CHANGELOG.md`

1. Add valid muxed and malformed `from_muxed` cases plus a customer-ledger failure case.
2. Normalize customer identity to the base G account while preserving the refund destination.
3. Make customer-ledger enrichment non-fatal to payment commit/cursor advancement.
4. Deduplicate by canonical transaction identity and constrain invoice/counter settlement to current
   destination and remaining amount; ambiguous reusable-code payments go to review.
5. Run merchant watch/reconciliation tests and commit.

### Task 9: Preserve submission expiry and authoritative rejection

**Files:** `src/lib/api.ts`, `src/lib/submission.ts`, `src/hooks/useWallet.tsx`,
`src/hooks/useMerchant.tsx`, submission/refund tests, `CHANGELOG.md`

1. Persist a prepared transaction, overwrite it with `status_unknown`, reload, and prove `expiresAt`
   is currently lost.
2. Merge durable identity at the persistence choke point and retain max-time evidence.
3. Bound legacy no-expiry polling and expose manual status checking.
4. Surface parsed canonical rejections while retaining uncertainty for non-authoritative submission
   endpoints; do not mark refunds/reconciliations final before confirmation.
5. Run submission/refund tests and commit.

### Task 10: Make private recovery and stealth scanning convergent

**Files:** private archive/stealth cache, Horizon, sync, transaction, provider components and tests,
`CHANGELOG.md`

1. Add regressions for omitted archive-key prefixes, 10,001 owned receipts, oversized joined pages,
   empty/short-page cursor gaps, and insufficient one-time-account sweep fees.
2. Diff requested/returned archive keys and verify restoration indices against `action_count`.
3. Compact terminal stealth entries while retaining bounded dedup state; never drop a newly owned
   receipt merely to advance.
4. Remove joined transaction amplification, retry oversized pages with smaller limits, and advance
   only to a returned paging token with a bounded rewind window.
5. Budget sweep accounts from simulated action cost and fail review before signing when insufficient.
6. Run private runtime tests and commit in independent cache/network/sweep commits.

### Task 11: Keep idle pools withdrawable

**Files:** Soroban pool contract/storage, generated client, runtime action flow, Rust/Node tests,
`CHANGELOG.md`

1. Add a Rust test that expires the current root while deposits are paused and attempts withdrawal.
2. Add a permissionless idempotent `touch_root` entry point callable while paused.
3. Invoke/simulate it automatically when the selected root needs refreshing and show exact review
   state rather than generic retry copy.
4. Run Rust tests and regenerate bound artifacts only after Testnet deployment consent is separate.
5. Commit source and tests without fabricating live evidence.

### Task 12: Close remaining authority and backup correctness gaps

**Files:** Merchant discount/customer/destination code, auto-lock, paper/backup UI, multisig submit,
their focused tests, `CHANGELOG.md`

1. Make zero-total settlement require comp plus payment/open-shift authority and record it as a comp.
2. Put Merchant Mode exit authorization at the navigation transition choke point.
3. Authorize customer mutation in the domain layer and audit destructive changes.
4. Apply current-destination quarantine to charges and all print surfaces.
5. Measure auto-lock with monotonic and wall clocks plus resume events.
6. Print an imported account's actual secret, authenticate the restore identity, and bind backup-health
   identity to the exported bytes.
7. Add behavioral tests and commit each logical fix independently.

### Task 13: Strengthen CI and release assurance

**Files:** `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `package.json`, Playwright
Private Payments security spec/helper, release tests/docs, `CHANGELOG.md`

1. Split the fixture-independent manifest-tamper browser test from live Testnet journeys.
2. Require it in CI/release; leave funded live journeys scheduled/tag-gated and evidence-driven.
3. Run locked Rust workspace tests in CI/release and schedule the ignored 100k model gate.
4. Replace authorization source greps with behavioral tests and add workflow assertions that fail on
   skipped security suites.
5. Run final verification from a clean worktree and document manual evidence still pending.

