# StellarKey Production Readiness Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove every confirmed code-owned production-readiness finding while preserving StellarKey's static, backend-free architecture.

**Architecture:** Persist authority-free transaction recovery records durably and journal refund intent before any broadcast. Stage service-worker releases until the user safely reloads, build one immutable GitHub release artifact from a clean checkout, and keep hosting provider concerns outside the wallet runtime. Performance work uses the repository's authenticated in-memory snapshot and stream health rather than weakening conflict or reconciliation guarantees.

**Tech Stack:** Next.js 16 static export, React 19, TypeScript, IndexedDB/localStorage, Stellar Horizon, Node test runner, Playwright, GitHub Actions.

---

### Task 1: Enforce safe software-vault passwords

**Files:**
- Modify: `src/lib/password-strength.ts`
- Modify: `src/lib/vault.ts`
- Modify: `src/components/Onboarding.tsx`
- Modify: `tests/password-strength.test.mjs`
- Modify: `tests/vault.test.mjs`

**Step 1: Write the failing tests**

Add tests proving common, repeated, sequential, and sub-twelve-character passwords are rejected by the direct vault API while long password-manager values and four-word passphrases remain valid. Add a source contract proving onboarding consumes the shared validator instead of duplicating a length check.

**Step 2: Run tests to verify RED**

Run: `npm test -- --test-name-pattern='vault password|weak password'`

Expected: FAIL because `initializeVault("password123")` currently succeeds and onboarding gates only on length.

**Step 3: Implement the policy**

Export a shared `validateNewVaultPassword(password)` result from `password-strength.ts`. Require at least 12 characters and reject score 0/1; call it from `initializeVault` and onboarding. Do not change existing unlock or encrypted-backup restore compatibility.

**Step 4: Verify GREEN and commit**

Run the focused tests, then `npm run typecheck`.

Commit: `fix: enforce safe vault passwords`

### Task 2: Keep transaction dialogs locked during signing and broadcast

**Files:**
- Modify: `src/components/SendModal.tsx`
- Modify: `tests/submission-ui.test.mjs`

**Step 1: Write the failing test**

Assert the Send modal guards `onClose`, disables backdrop/Escape dismissal, and removes the header close action while `stage === "sending"`, matching the existing Batch Send pattern.

**Step 2: Verify RED**

Run: `npm test -- --test-name-pattern='send dialog.*signing'`

Expected: FAIL because SendModal always passes `dismissable` and `onClose`.

**Step 3: Implement and verify**

Use `onClose={stage === "sending" ? () => undefined : onClose}`, `dismissable={stage !== "sending"}`, and omit the header close callback while sending. Run the focused test and typecheck.

Commit: `fix: lock send dialog during submission`

### Task 3: Persist all authority-free transaction recovery across browser sessions

**Files:**
- Modify: `src/hooks/useWallet.tsx`
- Modify: `src/lib/submission.ts`
- Modify: `tests/submission.test.mjs`
- Modify: `tests/wallet-security.test.mjs`

**Step 1: Write the failing tests**

Add tests that a prepared payment, swap, trustline, multisig change, and refund recovery handle survives a new browser session with empty `sessionStorage`; invalid and expired records remain fail-closed; reset removes the durable queue; and the stored representation contains only hash, network, status, label, expiry, and authority-free action metadata.

**Step 2: Verify RED**

Run: `npm test -- --test-name-pattern='pending transaction.*browser close|durable pending'`

Expected: FAIL because only account-merge reconciliation uses `localStorage`.

**Step 3: Implement durable recovery**

Move the pending queue to a versioned localStorage key, migrate the legacy session value once, write it synchronously before Horizon POST, and restore the prior value if persistence fails. Preserve canonical hash/network deduplication, final-resolution cleanup, wallet reset behavior, and never persist XDR, signatures, passwords, secrets, or keys.

**Step 4: Verify and commit**

Run focused submission/security tests and typecheck.

Commit: `fix: persist transaction recovery across sessions`

### Task 4: Journal merchant refunds before broadcasting

**Files:**
- Modify: `src/lib/merchant/types.ts`
- Modify: `src/lib/merchant/refunds.ts`
- Modify: `src/hooks/useMerchant.tsx`
- Modify: `tests/merchant-refunds.test.mjs`
- Modify: `tests/submission.test.mjs`

**Step 1: Write the failing state-machine tests**

Add a `prepared` refund lifecycle and prove it reserves refundable capacity before send. Add failure-injection coverage for: intent persistence failure (no POST), successful intent plus definite rejection, accepted/unknown broadcast plus result-persistence failure, recovery after reload, and duplicate retry prevention.

**Step 2: Verify RED**

Run: `npm test -- --test-name-pattern='refund intent|refund broadcast persistence'`

Expected: FAIL because the refund record is first created after `send()` returns.

**Step 3: Implement write-ahead intent**

Generate the refund ID and immutable payment terms first, persist a `prepared` record with no transaction hash, then call `send()`. The wallet's synchronous durable recovery queue protects the canonical transaction before POST. Reconcile the prepared merchant record to accepted, unknown, confirmed, or failed after send; if the second merchant write fails, retain the prepared reservation and recover by matching the durable wallet submission metadata. Only canonical failure or explicit pre-broadcast abandonment releases capacity.

**Step 4: Verify and commit**

Run merchant refund, repository, submission, and typecheck tests.

Commit: `fix: journal refunds before broadcast`

### Task 5: Stage service-worker updates safely

**Files:**
- Modify: `public/sw.js`
- Modify: `src/components/ServiceWorkerRegistration.tsx`
- Modify: `tests/service-worker-upgrade.test.mjs`
- Modify: `e2e/pwa.spec.ts`

**Step 1: Write the failing upgrade test**

Model an old live client requesting an old lazy chunk after the new worker installs. Assert the new worker waits, keeps the old cache, accepts an explicit `SKIP_WAITING` message, and reloads clients only after `controllerchange`.

**Step 2: Verify RED**

Run: `node --test tests/service-worker-upgrade.test.mjs`

Expected: FAIL because install calls `skipWaiting()` and activate deletes the prior cache immediately.

**Step 3: Implement staged updates**

Remove automatic `skipWaiting`, handle a same-origin `SKIP_WAITING` message, retain the immediately previous revision during activation, and expose an accessible in-app update prompt whose action posts the message and reloads exactly once on `controllerchange`.

**Step 4: Verify and commit**

Run the worker test, PWA Playwright journey, typecheck, and CSP checks.

Commit: `fix: stage pwa updates safely`

### Task 6: Make releases clean, immutable, and independently verifiable

**Files:**
- Create: `scripts/assert-clean-release.mjs`
- Create: `scripts/create-release-artifact.mjs`
- Create: `.github/workflows/release.yml`
- Modify: `package.json`
- Modify: `next.config.ts`
- Modify: `src/app/release.json/route.ts`
- Modify: `tests/production-discovery.test.mjs`
- Modify: `docs/release-checklist.md`

**Step 1: Write failing release tests**

Prove the release preflight rejects tracked and nonignored untracked changes, rejects a supplied SHA that differs from `HEAD`, validates release manifest semantics, and emits a deterministic inventory with SHA-256 for every `out/` file plus an archive checksum.

**Step 2: Verify RED**

Run the production-discovery tests. Expected: FAIL because `release:verify` accepts dirty builds and no artifact inventory exists.

**Step 3: Implement build-once release automation**

Add a clean-tree preflight to `release:verify`. On `v*` tags, GitHub Actions checks out the exact SHA, verifies it, builds once, creates `stellarkey-<version>.tar.gz`, `SHA256SUMS`, `release-files.json`, and an npm CycloneDX SBOM, uploads GitHub artifact attestations, and publishes those exact files to the GitHub release. Do not rebuild during deployment.

**Step 4: Verify and commit**

Run focused tests, lint workflow YAML mechanically, and run a local clean-tree artifact dry run.

Commit: `feat: publish verifiable release artifacts`

### Task 7: Add open-source governance and production operations

**Files:**
- Create after owner decision: `LICENSE`
- Create: `CONTRIBUTING.md`
- Create: `SECURITY.md`
- Create: `SUPPORT.md`
- Create: `CODE_OF_CONDUCT.md`
- Create: `.github/CODEOWNERS`
- Create: `docs/production-deployment.md`
- Create: `tests/production-docs.test.mjs`
- Modify: `README.md`
- Modify: `public/.well-known/security.txt`

**Step 1: Write failing governance tests**

Require every file, supported-version policy, protected obfuscated contact route, release/rollback/runbook sections, header verification, DNS/TLS/mail checks, and automated `security.txt` expiry margin.

**Step 2: Verify RED**

Run: `node --test tests/production-docs.test.mjs`

Expected: FAIL because the governance and deployment files are absent.

**Step 3: Implement**

Use the owner-selected license. Document a static host that applies `out/_headers`, apex/www redirects, TLS, DNS, MX/SPF/DKIM/DMARC, exact-artifact deployment, rollback, service-worker recovery, security-report triage, domain-loss response, and external probes. Keep addresses obfuscated in tracked public source.

**Step 4: Verify and commit**

Run focused docs/security tests and lint.

Commit: `docs: add open source and production governance`

### Task 8: Close public browser and install-surface gaps

**Files:**
- Create: `e2e/public-release.spec.ts`
- Create: `public/icon-maskable-512.png`
- Modify: `src/app/manifest.webmanifest`
- Modify: `src/app/not-found.tsx`
- Modify: `docs/testing.md`
- Modify: `README.md`
- Modify: `tests/production-discovery.test.mjs`
- Modify: `playwright.config.ts`

**Step 1: Write failing tests**

Cover every public route, protected contact action, canonical/title metadata including 404, 320px overflow, maskable icon safe-zone metadata, manifest installability, and Chromium/WebKit support declarations.

**Step 2: Verify RED**

Run focused Node and Playwright tests. Expected: FAIL for missing public-release journey, maskable icon, and 404 metadata.

**Step 3: Implement and verify**

Add route metadata, a safe-zone maskable icon, full browser matrix, and correct stale product/provenance wording. Run browser tests and commit.

Commit: `fix: complete public release surfaces`

### Task 9: Reduce merchant persistence work without weakening CAS

**Files:**
- Modify: `src/lib/indexed-db.ts`
- Modify: `src/lib/merchant/repository.ts`
- Modify: `src/hooks/useMerchant.tsx`
- Modify: `tests/merchant-indexeddb.test.mjs`

**Step 1: Write failing performance-contract tests**

Instrument driver calls and prove an ordinary local commit does not `getAll()` or decrypt the complete retained history, while an external revision/conflict still performs a full authenticated reload. Prove prefix reads use a bounded IndexedDB key range.

**Step 2: Verify RED**

Expected: FAIL because `commitStore` calls `repository.load()` on every mutation and `readPrefix()` calls `getAll()`.

**Step 3: Implement**

Use `IDBKeyRange.bound(prefix, prefix + "\uffff")` for prefix reads. Add a repository metadata-revision read/CAS path and commit from the authenticated in-memory snapshot while the exclusive writer lock is held; retain full reload for bootstrap, revision-channel updates, import, and conflict recovery.

**Step 4: Verify and commit**

Run IndexedDB, repository, merchant multi-tab, and full merchant tests.

Commit: `perf: avoid full merchant reloads on local writes`

### Task 10: Make live Horizon streaming control reconciliation polling

**Files:**
- Modify: `src/hooks/useWalletResources.ts`
- Modify: `src/hooks/useWallet.tsx`
- Modify: `tests/wallet-resources.test.mjs`

**Step 1: Write failing scheduler tests**

Prove a healthy EventSource reduces active-account safety polling, errors restore the 15-second fallback, visibility transitions reconcile immediately, and background accounts use a slower staggered cadence.

**Step 2: Verify RED**

Expected: FAIL because stream health does not affect polling.

**Step 3: Implement and verify**

Track `connecting/open/degraded` stream state. Use 60-second safety reconciliation while open, 15 seconds while degraded, and a slower staggered background cadence. Preserve immediate refresh after mutations and visibility restoration.

Commit: `perf: make wallet polling stream aware`

### Task 11: Split merchant subscriptions by stable domain

**Files:**
- Modify: `src/hooks/useMerchant.tsx`
- Modify: `src/components/merchant/*.tsx`
- Modify: `tests/context-boundaries.test.mjs`
- Modify: `e2e/merchant.spec.ts`

**Step 1: Write failing render-boundary tests**

Prove minute-clock/reporting updates do not invalidate peripherals/settings/ticket consumers and ticket edits do not invalidate reporting-only consumers.

**Step 2: Verify RED**

Expected: FAIL because one 3,000-line context value publishes all domains.

**Step 3: Implement incrementally**

Expose stable runtime, till, records, staff, reporting, and settings contexts or selector-backed external-store hooks. Migrate leaf consumers one domain at a time while retaining a temporary compatibility hook only at the provider boundary.

**Step 4: Verify and commit**

Run context, merchant, accessibility, and render-count tests.

Commit: `refactor: split merchant domain subscriptions`

### Task 12: Final release gate and integration

**Files:**
- Modify only if verification reveals a regression.

**Step 1: Review every requirement**

Confirm all P0/P1/P2 findings have a test, implementation, documentation, and separate commit. Confirm no backend runtime was introduced and pinch zoom remains disabled.

**Step 2: Run the complete gate**

Run: `npm run release:verify`

Expected: typecheck, all Node tests, lint, production audit, static build, bundle budgets, Chromium, iPhone WebKit, and iPad WebKit all pass.

**Step 3: Independent review**

Review the complete diff from `6d1ed6a54b1e53e5f83a3ed66ab3471435109cc1` and resolve every Critical/Important finding.

**Step 4: Merge**

Fast-forward `main` only after the clean release gate. Preserve the original checkout's untracked `.playwright-mcp/` and `scripts/promo/` directories.
