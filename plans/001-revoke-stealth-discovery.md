# Plan 001: Revoke and drain reusable-payment discovery

> **Executor instructions:** Read fully. Use executing-plans and test-driven-development if available. Run each verification gate; stop on the conditions below. Record results before updating the status in `plans/README.md`, unless a reviewer owns the index. No conversation context is required.
>
> **Drift check:** Run `git diff --stat 3e8dca7d021767138bc21c790f7ef59cc2fce309..HEAD -- src/lib/vault.ts src/lib/indexed-db.ts src/features/private-balance/runtime/provider.tsx src/features/private-balance/runtime/stealth-discovery-operation.ts src/features/private-balance/runtime/stealth-runtime.ts src/features/private-balance/runtime/stealth-sync.ts src/features/private-balance/runtime/stealth-horizon.ts src/features/private-balance/runtime/stealth-cache.ts src/features/private-balance/runtime/coordination.ts tests/private-balance-stealth-*.test.mjs tests/private-balance-vault.test.mjs tests/vault-v3.test.mjs tests/indexed-db.test.mjs tests/private-balance-runtime.test.mjs e2e/private-components.spec.ts e2e/fixtures/private-components.tsx CHANGELOG.md plans/001-revoke-stealth-discovery.md plans/README.md`. Inspect `git status --short` too. Compare changed implementation against the excerpts below; unexpected drift requires replanning.

**Goal:** Lock, session/context replacement, teardown, leadership loss and approved data removal stop further discovery work and prevent stale results/cache resurrection.

**Architecture:** Give each scan a revocable operation identity, AbortController and completion promise. Reuse vault generation checks, propagate cancellation through readers and the cache write boundary, then abort and drain before approved removal.

**Tech stack:** React 19.2.8, Next.js 16.3.3 static App Router export, TypeScript, browser fetch/IndexedDB, Node tests, Playwright Chromium/WebKit. No new dependency or protocol format.

## Status

- Priority: P1
- Effort: M
- Risk: HIGH — asynchronous key lifetime and persistence, not cryptographic changes
- Depends on: none
- Category: security / bug
- Planned at: `3e8dca7d021767138bc21c790f7ef59cc2fce309`, 2026-09-06
- Execution: IMPLEMENTED — final integrated verification and review results recorded below and in the execution index

## Why this matters

A controlled local test paused a page, locked the vault, removed the discovery cache, then released the page. The old scan continued and recreated encrypted cache data. Cleanup eventually overwrites buffers, but only after the unrevoked scan settles. Fix the lifetime, not just visible loading; this is not evidence of theft or a remote ownership oracle.

## Current state

- `src/lib/vault.ts:128` already captures session authority:

  ```ts
  export function createSessionRevocationGuard(): () => void {
    const expected = sessionGeneration;
    assertSessionGeneration(expected);
    return () => assertSessionGeneration(expected);
  }
  ```

  `lockVault`, `clearSessionSecrets` and `establishVaultSession` advance the generation. `withPrivacySessionRoot` wipes buffers after its callback settles. Do not globally change that callback's authority: already-consented durable payment writes may intentionally complete after lock.
- `runtime/provider.tsx:448` checks leader/unlocked state only at scan entry. Identity/success/error callbacks guard only `providerMountedRef`; finalization is unconditional:

  ```ts
  const tracked = run.finally(() => {
    stealthRunRef.current = null;
  });
  ```

  Cleanup aborts the relay chain and terminates the shielded worker, not main-thread stealth discovery. `disableLocalData` checks reservations, then clears shielded/discovery storage without draining the scan.
- `runtime/stealth-sync.ts:197` has no signal or revocation checks around page reading, matching, encrypted commit or progress:

  ```ts
  const page = await input.reader.readPage({
    cursor: state.cursor,
    lowerBoundCreatedAt: state.lowerBoundCreatedAt,
    limit: MAX_STEALTH_ANNOUNCEMENTS_PER_PAGE,
  });
  ```

- `runtime/stealth-horizon.ts` uses a URL-only request callback for ledger/payment/transaction/operation requests, bounded parallel lookups and page-size retries. `src/lib/horizon.ts` already supports `getHorizonJson(url, { signal })`; reuse it.
- `runtime/stealth-cache.ts:275` awaits encryption before CAS. Fresh-cache CAS expects `null`, so deletion is not cancellation. `src/lib/indexed-db.ts:170` also awaits database open/reads before writes; a check only in the caller misses that boundary.
- `runtime/coordination.ts` owns expiring localStorage leases; a cached `leaderRef` can lag a takeover. Check fresh ownership without renewing/reclaiming a lease from stale work.
- Follow the deferred promises/MemoryDriver in `tests/private-balance-stealth-runtime.test.mjs`, identity-checked `queuedBackgroundSync` finalization in the provider, and existing mutex/pending-action guards.

## Commands you will need

Run from an isolated executor worktree with Node >=22.22.2 <27 and npm >=11.19.0 <13.

| Purpose | Command | Expected |
| --- | --- | --- |
| Environment | `node --version && npm --version` | Supported versions |
| Focused tests | `node --no-warnings --experimental-strip-types --loader ./tests/ts-resolve-loader.mjs --test tests/private-balance-stealth-*.test.mjs tests/private-balance-vault.test.mjs tests/vault-v3.test.mjs tests/indexed-db.test.mjs tests/private-balance-runtime.test.mjs` | Exit 0 after implementation |
| Types/lint | `npm run typecheck && npm run lint` | Exit 0 |
| Full unit suite | `npm test` | Exit 0 |
| Synthetic fixtures | `E2E_PORT=3217 node scripts/test-private-components.mjs` | Required Chromium/iPhone WebKit cases pass; fixture cleaned up |
| Overlay regressions | `E2E_PORT=3218 npm run test:e2e:private-ui` | Both configured projects pass |
| Build/budget | `npm run build && npm run test:bundle && npm run check:bundle` | Exit 0; no unexplained growth |
| Artifacts | `npm run private:check-generated` | Exit 0; deterministic regeneration leaves tracked artifacts unchanged |
| Patch hygiene | `git diff --check && git status --short` | No whitespace errors; scoped changes only |

Use a different unused port if either fixture port is occupied; never kill a user's server. The fixture runner creates a temporary route and must run only in the executor worktree. Keep its screenshots/traces/video disabled. Full `npm run release:verify` is a separate clean-worktree release gate; report dependency/environment failures without waiving them.

The artifact check regenerates local manifests, clients and vectors before comparing hashes; it is not read-only and does not deploy a transaction. Run it only in the isolated worktree. Its proof-vector verifier also requires the locked circuit dependencies: `npm --prefix protocol/private-balance/circuits ci --ignore-scripts --no-audit --no-fund`.

## Scope

Only modify:

- `src/lib/vault.ts` — narrow synchronous revocation notification, preserving other callers.
- `src/lib/indexed-db.ts` — optional guarded/abortable single-record CAS.
- `src/features/private-balance/runtime/provider.tsx`
- `src/features/private-balance/runtime/stealth-discovery-operation.ts` — create if needed for refresh/removal lifecycle, not a general async framework.
- `src/features/private-balance/runtime/stealth-runtime.ts`
- `src/features/private-balance/runtime/stealth-sync.ts`
- `src/features/private-balance/runtime/stealth-horizon.ts`
- `src/features/private-balance/runtime/stealth-cache.ts`
- `src/features/private-balance/runtime/coordination.ts`
- Existing `tests/private-balance-stealth-*.test.mjs`; create `tests/private-balance-stealth-revocation.test.mjs`.
- `tests/private-balance-vault.test.mjs`, `tests/vault-v3.test.mjs`, `tests/indexed-db.test.mjs`, `tests/private-balance-runtime.test.mjs`.
- `e2e/private-components.spec.ts`, `e2e/fixtures/private-components.tsx` — synthetic lifecycle/real IndexedDB checks only.
- `CHANGELOG.md`, this plan and `plans/README.md`.

Out of scope: protocol/circuit/contract changes, package upgrades, address rotation, relay startup redesign, global request cancellation, storage schema migration, resetting pending actions, signing/broadcasting, deployment, unrelated UI changes, historical reports and the user's untracked document.

## Git workflow

Use isolated branch `advisor/001-revoke-stealth-discovery`; preserve the dirty main worktree and do not stage unrelated untracked files. Read `AGENTS.md`, `CONTRIBUTING.md`, and installed Next guides `node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md` and `node_modules/next/dist/docs/01-app/02-guides/static-exports.md` before code. Keep source/tests/Unreleased Security note in one logical commit, e.g. `fix: revoke reusable payment discovery with its session`; sign off using the executor's own identity where required. No push, merge, release or server restart.

## Steps

### 1. Capture the failing lifecycle regression

Create the revocation test with real vault lock, synthetic inputs, MemoryDriver and deferred pages. Pause after reading starts, revoke the captured session, then release a page with `hasMore: true`. Assert no second page, new cache commit or progress/result callback. Separately invalidate/drain, remove cache and deliver a late completion; assert it remains absent. One expected abort rejection must not hide a missing cache assertion.

**Verify:** Run the focused command. New behavioral assertions fail on current behavior; existing unrelated tests pass. Missing imports/syntax errors are not valid red evidence. Record test names, never fixture values.

### 2. Add narrow revocation and operation identity

Provide a removable subscription to captured-session revocation in `vault.ts`. Invalidate synchronously at all three generation-changing paths, not on a later React effect. Reuse `createSessionRevocationGuard`; listeners contain no secrets and a listener failure must not prevent locking.

Represent a scan as `{ identity, controller, assertActive, completion }`. Assert captured vault authority, exact runtime scope, operation identity and current lease ownership/expiry. Add a read-only lease assertion in `coordination.ts`; missing/foreign/expired/malformed/unreadable leases fail closed. Normal renewal by the same live owner must work. An old operation cannot regain authority after unlock or takeover.

**Verify:** Run `node --no-warnings --experimental-strip-types --loader ./tests/ts-resolve-loader.mjs --test tests/private-balance-vault.test.mjs tests/vault-v3.test.mjs tests/private-balance-runtime.test.mjs tests/private-balance-stealth-revocation.test.mjs`. Vault/scope cases pass; explicitly record scanner integration cases still red until the next steps.

### 3. Cancel network and matching work

Propagate signal/activity assertion through runtime, sync, every `readPage`, and the Horizon callback to `getHorizonJson`. Check before work and after each await: cache load/decrypt, page fetch, matching, and progress. Prevent queued parallel lookups and page-size retries after abort. The malformed-announcement catch may skip invalid public points, but must not swallow revocation.

Do not use `Promise.race` to claim cleanup while abandoned crypto still holds borrowed buffers. Abort cooperative transport; ignore uncooperative late results and drain owned work before disposing of buffers it uses. Never log request URLs or records.

**Verify:** Focused tests pass the late-page, no-second-read and stale-progress cases, including a reader that ignores abort. Existing point validation, cursor/order/history and retry tests remain green.

### 4. Fence writes and serialize removal

Thread optional `{ signal, assertActive }` through discovery commit and single-record CAS; callers omitting it retain existing behavior. Assert after encryption and inside the real IDB transaction after open/reads and before writes. Abort that transaction on revocation, clean listeners and consume transaction rejections. Already-committed writes cannot be retroactively cancelled; do not claim otherwise.

Prevent new discovery while removal is active; abort and await its completion before purge. Use the existing runtime mutex to exclude shielded sync/preparation around the pending-action check and deletion, without awaiting a scan under a lock it needs. Recheck scope/session/lease before deletion. Preserve pending actions/build reservations and the existing refusal to delete unresolved data. On failure, preserve data and report only the current operation's error.

**Verify:** Focused tests and synthetic fixtures pass revocation during encryption, delayed database open, queued CAS, fresh-cache `expectedRevision: null`, two-owner takeover before deletion, pending-proof refusal, and committed-before-lock followed by removal. No stale cache reappears after successful removal. Other IDB/merchant tests remain green.

### 5. Guard provider publication and teardown

Gate identity/success/error/finalizer with the captured operation/scope. Only the current run clears its ref/pending/error. Clear rendered discovery state on lock/account/network/deployment change; abort on unmount/leadership loss. Ordinary lock cancellation must not produce a payment-failure message or republish after unlock. A fresh explicit refresh can proceed after the old scope drains. Keep dialog shells/focus and explicit Start/Resume relay behavior unchanged.

**Verify:** Focused tests, synthetic browser fixtures, overlay tests and types/lint pass. Add controlled old-failure-after-new-success, old-finalizer-after-new-start, account/network switch, unmount/remount and lock→unlock cases. Browser fixtures exercise production lifecycle code, not only a mock reducer.

### 6. Record review evidence

Add an Unreleased Security note for revoked discovery/removal-race protection. Record actual pass/fail/skip results in this plan. Run full unit, artifact, production/budget and patch-hygiene commands. Inspect exact paths before the logical commit; do not upgrade dependencies or tag a release.

**Verify:** All listed feature gates pass; any environmental failure is explicit. Full release verification requires its own clean-worktree gate and cannot be silently waived.

## Test plan

Cover lock, clear-session, replacement, late page, abort during matching/encryption/CAS, fresh-null cache removal, takeover, stale success/error/finally, fresh explicit retry, and unchanged proof reservations. Use controlled promises/abort events, no sleeps/services. Include real IndexedDB ordering in browser fixtures: a memory driver alone does not establish it. Preserve birthday, outgoing-history, sweep and signing tests.

## Execution record — first review checkpoint, 2026-09-06

Historical checkpoint retained verbatim below; superseded by the continued execution record following it.

Implementation is uncommitted in `.worktrees/revoke-stealth-discovery` on branch `advisor/001-revoke-stealth-discovery`, based on the planned revision. Main application code and existing servers are unchanged. Plan/index progress is recorded in the original worktree because these handoff documents were already untracked there.

### Completed in steps 1–3

- Reproduced the late-page defect with the real vault and synthetic deferred work. Before the change, a locked scan read another page and a late scan recreated an encrypted cache entry; both behavioral assertions now pass.
- Added synchronous, removable vault-revocation subscriptions for lock, clear-session and replacement. Authority and session buffers are cleared before notification; throwing observers cannot prevent cleanup, and a reentrant lock cannot be undone by session replacement.
- Added an operation identity, abort signal, permanent authority checks and a completion promise that waits for started work to drain. Added fresh, read-only lease validation without renewal or reclamation.
- Threaded optional cancellation through runtime, cache reads, announcement matching and all Horizon subrequests/retries. Already-started parallel lookups drain before completion; no following batch or operation lookup starts after cancellation.
- Independent review found a late encrypted-cache read could still start decryption after abort. A new regression first failed with one post-abort decryption, then passed with none after the read boundary was guarded. The post-decrypt check preserves plaintext cleanup.
- Added 16 lifecycle/revocation regressions and five Horizon cancellation regressions. Existing assertions were preserved. Updated the Unreleased Security note to describe the partial foundation without claiming live integration.

### Verification

Environment: local Darwin arm64, Node 26.7.0, npm 11.19.0; locked dependencies installed in the isolated worktree. Tests use generated in-memory keys and synthetic fixtures, not a personal wallet or live transactions.

| Gate | Result |
| --- | --- |
| Clean baseline `npm test` | 1,427 passed; zero failures/skips; 69.21 s |
| Latest focused command above | 96 passed; zero failures/skips; 7.67 s |
| Latest `npm test` | 1,448 passed; zero failures/skips; 72.62 s |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed with zero errors; three existing `next/no-img-element` warnings in untouched marketing files |
| `npm run build` | Passed; 22 static pages generated |
| `npm run test:bundle` | Five passed; zero failures/skips |
| `npm run check:bundle` | Passed all configured budgets |
| `npm run private:check-generated` | Passed on rerun; three proof vectors verified and tracked generated outputs unchanged |
| `git diff --check` | Passed; only scoped source/tests/changelog changes |
| Independent code review | No outstanding critical/important findings after the cache-read fix; approved continuation, not merge readiness |

Latest bundle sizes: initial application 1,165,289 raw / 341,968 gzip bytes; Private Balance feature 264,977 raw / 71,338 gzip bytes; worker 753,512 raw bytes; protocol artifacts 9,424,602 raw / 6,278,239 gzip bytes. These are production-build budget measurements, not field performance or a measured comparison to a clean-baseline build. Test durations are single runs, not performance benchmarks.

Artifact setup note: the first artifact-check attempt stopped because the nested circuit `snarkjs` dependency was absent. Installed the existing locked nested dependencies without changing the lockfile and reran successfully. Neither attempt produced tracked protocol/artifact changes; generation only updated local files deterministically and did not deploy on-chain.

### Not complete / next batch

The operation helper is not yet connected to the live provider. Cache-write/IndexedDB commit fencing, abort-and-drain removal serialization, provider publication/teardown guards and browser lifecycle tests remain steps 4–6. The full stale-cache resurrection fix is therefore **not complete or active in the running app**. No proof journals or reservations were reset, no protocol format or key derivation changed, and no transaction was signed or submitted.

No browser, iPhone WebKit, overlay or real IndexedDB lifecycle verification is claimed at this checkpoint. No screenshots/traces were captured. Release verification, commits, merging and deployment have not been performed. The executing-plans skill requires review between implementation batches; resume with steps 4–6 after checkpoint feedback, then reassess every done criterion below.

## Continued execution — 2026-09-06

Live provider integration now owns scope-bound scan and incidental reconciliation operations. Layout/session revocation clears completed identity as well as active scans; explicit new-session capture re-arms the snapshot listener even if React batches away an intermediate lock phase. Retained old callbacks cannot borrow a replacement account/network's authority. Late worker cleanup and automatic refresh are bound to their originating scope/session.

Cache guards extend through read, decryption, encryption, compare-and-set and transaction completion. Cancellation of an uncommitted real IndexedDB write waits for rollback. Started parallel transport work drains; aborted or stale operations cannot start another page/batch or publish success/error. Cancellation cannot retroactively undo a transaction already committed.

Removal aborts scans before waiting outside the shared mutex, then checks pending actions/build reservations inside the serialized lane. The minimal necessary extension beyond guarded single-record CAS is an optional guard and expected raw-record map on the existing `replacePrefixVerified`: it atomically removes both stores, compares the exact authenticated state bytes (including expected absence) before deletion, and rolls back on cancellation/mismatch. A concurrent journal writer therefore causes refusal instead of journal loss. No schema, lease epoch, proof reservation or signing-authority change is introduced.

Independent review identified and drove regressions for incidental sweep reconciliation, pre-sign snapshot publication, retained callbacks, concurrent journal writes, stale worker cleanup, old automatic refresh and two vault revocations without a committed React phase change. Durable writes for already-consented signing retain their existing authority; only decrypted discovery publication is gated.

Parent verification before final integration: 101 focused tests passed; full unit suite 1,457/1,457 passed, zero skips (67.27 s); generated artifacts verified unchanged; typecheck passed and touched-source lint has zero warnings. Existing settings coverage was updated from a removed function-name assertion to the stronger atomic expected-snapshot removal contract. Browser regression counts and final build/budget results are recorded in the execution index after the complete run. Tests contain only synthetic fixtures; screenshots, traces and video are disabled.

The main checkout and user servers remain unchanged. Reviewed independent buffer cleanup was committed first (`b2ebeb8`) while discovery race review proceeded; each feature retains a separate logical commit. This is an implementation handoff, not a release certification. The unchanged dependency audit still blocks release (13 transitive findings, 5 high).

## Done criteria

Final feature review: independently approved with no remaining important findings. Browser gate: 54/54 discovery cases, zero skips, 27 desktop Chromium + 27 iPhone WebKit, 1.5 minutes. The three last worker/prefix/second-revocation cases were observed red before the source fix and green afterward (6/6, 21.2 s). Real IDB coverage includes delayed open/read, queued and uncommitted writes, rollback of two-store removal and concurrent raw-snapshot mutation/creation. Full integrated browser, overlay and production build checks follow 002 in the index.

- [x] Regression recorded red before the fix and green after it.
- [ ] No further page/match work starts after revocation and stale callbacks cannot publish.
- [ ] Real IndexedDB tests prove old scans cannot recreate removed cache.
- [ ] Focused/full unit, types/lint, required Chromium/WebKit, build/budget and artifact checks pass.
- [ ] Pending-proof/sweep tests pass without relaxed assertions.
- [ ] Scoped diff, Unreleased note, evidence and verified index status are present.

## STOP conditions

Stop for unexpected drift, two failed attempts at a gate, needed out-of-scope changes, any requirement to discard an exposed-proof journal, a failing cross-tab race requiring durable epoch/schema migration, or a mutex change that alters transaction authority. Do not replace missing IDB race coverage with timeouts, empty catches, weaker tests or localStorage assertions alone.

## Maintenance notes

New awaits/subrequests must preserve scope checks. Transport abortion, stale-result rejection and disposal are distinct. Check every new cache writer at the commit boundary. JavaScript disposal is best effort and cannot erase a request already received by a server. Plan 002 narrows retained key authority while preserving these lifecycle tests.
