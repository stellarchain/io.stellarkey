# Simple, Correct, Fast — System Hardening Implementation Plan (004)

Repository convention: plans live under `plans/`; `tests/release-gate.test.mjs` explicitly forbids the obsolete `docs/plans/` directory. This takes precedence over a skill's generic output-path example.

> Execute task-by-task using test-driven development and independent spec/quality reviews. The user approved all audit findings with “fix everything”; no routine approval checkpoint is required between bounded tasks.

**Goal:** Resolve F01–F12, reconcile K02, investigate and safely address K01 and the signing-context lead from the 2026-09-06 system audit.

**Architecture:** Keep the static React/Next.js wallet and its existing primitives. Give dismissal, freshness, sensitive-state publication and untrusted transport work one coherent owner each. Preserve canonical transaction confirmation, authenticated storage, current cryptography, private-intent boundaries and existing product design.

**Tech stack:** Next 16.3.3 static App Router, React 19.2.8, TypeScript 6.0.3, Node tests, Playwright Chromium/WebKit, Stellar SDK 17.0.1, Nostr 2.25.1 and existing browser private protocol.

**Starting source commit:** `8397a3584f0aba37032f2146f130ba9484a494d8`. Workspace: `/Users/admin/Documents/codegen/0x/.worktrees/revoke-stealth-discovery`. Reuse this isolated branch; do not modify, merge into or restart the main checkout. Keep the audit report historical and append completion evidence separately.

## Design decision

Use narrow shared contracts plus behavioral regressions. Per-screen patches would leave bypass paths; a broad state/library rewrite would enlarge the financial/security review surface without fixing a demonstrated requirement. The selected approach preserves retained UI and existing safe behavior, then removes redundant/contradictory policies. New abstractions require at least two real consumers. No visual rebrand, extra animation, fake delays, new backend, Mainnet transaction, live fixture deployment, automatic force-upgrade or weakened safety gate.

## Workflow and common gates

For each independently scoped task:

1. Re-read its implementation and direct callers; verify the audit root cause still applies.
2. Add the smallest real regression first. Run it against current code and record the expected assertion failure, not a module/import error.
3. Implement the smallest correct boundary. Use `apply_patch`; preserve unrelated edits.
4. Run that test and the related existing suite, then typecheck. Fix regressions without weakening assertions or budgets.
5. Update `[Unreleased]` in `CHANGELOG.md` for behavior, security, dependency or stored-data changes. Commit only explicit task files with a factual message.
6. Obtain independent spec review, then independent quality review. Fix important findings before beginning another implementation task.

Root focused test command prefix: `node --no-warnings --experimental-strip-types --loader ./tests/ts-resolve-loader.mjs --test` followed by the exact test files. Run `npm run typecheck` after each TS task. Browser tests must use safe diagnostics and synthetic/non-usable data, meaningful conditions rather than fixed sleeps. Only one implementation agent and one browser/build owner at a time; independent read-only research/review may run alongside it. Never print secrets, transaction payloads, private addresses, amounts or hashes.

## Task 1 — Safe and complete verification (F02 → F01)

Files: `playwright.config.ts`, `playwright.private-components.config.ts`, `scripts/test-private-components.mjs`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `package.json`, `tests/release-gate.test.mjs`, `tests/private-balance-release-gate.test.mjs`; add a narrow safe reporter/config test under `tests/` or `scripts/` if needed. Read `protocol/private-balance/scripts/run-testnet-e2e.mjs` and `e2e/private-balance/helpers.ts` as callers; change them only to enforce safe runner behavior. Do not change dependency versions in this task.

1. Add a failing gate assertion that wallet configs disable screenshots/traces/video and required isolated/browser-protocol suites execute in CI and release.
2. Ensure locator/reporter failures cannot serialize private state on live paths. Prefer fixed labels and structural summaries. Validate with a synthetic sentinel, not a usable key or private payment.
3. Add explicit commands for the existing isolated runner and nested protocol tests. Share their gate between CI/release without removing existing static/build/bundle/Rust/circuit requirements. Required fixture cases must not silently skip; live Testnet tests stay opt-in.
4. Ensure isolated fixture creation and verified cleanup precede the production build; reject a leftover fixture in source/export. Preserve server ownership and do not reuse another worktree's process.
5. Run focused release-gate tests and config collection checks; execute actual browser/protocol suites with safe configuration. Final aggregate runs happen after all source changes.

Done: default wallet capture paths are off/safe; mandatory isolated suite executes on Chromium and iPhone WebKit; all nested protocol tests execute; normal entry points share these requirements and leave no fixture route.

## Task 2 — Honest market freshness and retained charts (F03, F12)

Files: `src/lib/prices.ts`, `src/lib/api.ts` market functions, `src/hooks/useWallet.tsx`, `src/hooks/useMerchant.tsx`, related market consumers, `src/lib/merchant/charge.ts` only if quote validation needs its existing contract; tests `tests/market-currency.test.mjs`, `tests/merchant-money.test.mjs`, and a new focused freshness test if useful. Follow actual caller types rather than casting away changed data.

1. Reproduce a successful synthetic price fetch followed by a 60-minute clock advance and HTTP 503. Assert original observation time is retained and a real-money quote is refused.
2. Model market samples as value plus genuine observation time/status; cache reads do not refresh age. Apply to asset, native XLM and non-USD FX input. Keep fixed Testnet behavior explicit and distinct.
3. Retain safe display data with age/status, but fail closed before constructing a new Mainnet quote if any required input is unavailable/stale. Do not lose cart/form effort.
4. Add timestamps to chart cache entries; retain the accurately labelled series while revalidating expired ranges. Preserve existing stale-request lane and avoid competing fetch systems.
5. Test cache hits/outages/retry, stale FX and native price, issuer/network isolation, deterministic money rounding, expired chart revisits and out-of-order completions.

Done: every money quote uses genuinely fresh required inputs; caches do not fabricate freshness; charts update after expiry without blanking or stale publication. Related merchant/security/unit tests and typecheck pass.

## Task 3 — Revocable merchant repository publication (F04)

Files: `src/lib/merchant/repository.ts`, `src/hooks/useMerchant.tsx`, vault session helpers in `src/lib/vault.ts` only where required, `tests/merchant-commit.test.mjs`, `tests/merchant-security-boundaries.test.mjs`, existing real-provider synthetic fixtures if needed.

1. Add a delayed in-memory driver test: start load → clear snapshot → release read → cache must remain cleared. Test loadCommitBasis cannot return a prior-session plaintext snapshot.
2. Introduce a repository generation/session lifetime invalidated on clear/disposal, checking before every cache publication and around load/reseal/commit awaits. Do not expose a test-only cache inspector.
3. Guard hook success/error/finally and external reload publication with the originating session. Synchronous lock/reset invalidation must precede stale completion; copied key cleanup alone is not cancellation.
4. Preserve already-consented durable commits and journals, CAS conflict behavior, legacy reseal rules and authenticated metadata checks. A completed storage transaction is not revocable.
5. Exercise deferred load/reload/reseal/commit with lock, unmount, reset and replacement session, plus existing multi-tab conflict and corruption tests.

Done: no old generation can restore plaintext/error/UI state after revocation; authorized durable work remains recoverable; relevant repository/security tests and typecheck pass.

## Task 4 — Operation ownership and accessible feedback (F05, F07–F09)

Files: `src/components/ui.tsx`, `src/components/ClaimableBalancesModal.tsx`, `src/components/AddAccountModal.tsx`, `src/components/Toast.tsx`, `src/components/SettingsPage.tsx`, `src/components/merchant/CustomerDetailModal.tsx`, `src/components/merchant/PaymentLinksPage.tsx`, actual Toggle/Field/Select callers, and Dashboard handoffs only if needed. Tests: `tests/airdrop-ui.test.mjs`, `tests/ui-loading-contract.test.mjs`, `tests/interaction-continuity.test.mjs`, `e2e/ux-primitives.spec.ts`, `e2e/overlay-contract.spec.ts`, corresponding synthetic fixture panels. Split logical fixes into separate commits.

1. First reproduce busy header/alternate-close and stale completion after reopen. Give every exit path the same guarded close policy; use existing `closeDisabled`, and bind completion to its originating instance. Distinguish cancellable preparation from non-cancellable submission.
2. Keep all Public/Private shell/backdrop/focus/scroll-lock identities unchanged. Verify pointer/keyboard/rapid switching, stale cleanup, reduced motion and iPhone WebKit.
3. Add polite supplementary toast announcements and persistent local recoverable merchant errors, with retained input and retry and duplicate-action protection where required. Never show raw sensitive errors or move focus for a toast. Remove touched `transition-all`.
4. Require meaningful Toggle names. Forward Field's `id`, `aria-describedby`, `aria-invalid` through Select to its actual trigger using narrow typed props. Test rendered relationships, not only source regex.
5. Make Tooltip hover transfer persistent across trigger/content and Escape-dismissible without moving focus. Respect focus/blur, nested-modal Escape and reduced motion; no arbitrary display delays.
6. Replace Add Account's guessed derivation subtitle with accurate mode wording; only use authoritative account metadata. Test imported/watch/archived/mixed accounts without deriving keys to preview UI.

Done: all concrete UI findings resolved through existing primitives; deferred operation, real composition, keyboard/axe and mobile tests pass; existing visual identity is preserved. Human screen-reader/physical zoom checks remain explicitly unverified.

## Task 5 — Recipient-local metadata failure containment (F06)

Files: `src/features/private-balance/runtime/scanner.ts`, `tests/private-balance-scanner.test.mjs`; protocol opener/types only if essential. Do not change circuits, contracts, proof inputs, note encoding, address format, keys or published artifacts.

1. Modify the existing synthetic scanner fixture in a new test so the envelope's duplicate asset index disagrees with its authenticated commitment asset; require valid surrounding outputs/actions to remain recoverable.
2. Derive the canonical index from the authenticated registry when safe, or isolate an invalid envelope as recipient-local failure. Choose based on actual commitment/opening guarantees, not generic catch-and-continue.
3. Preserve archive/root/nullifier/registry/transcript failures and the exact balance/accounting model. Shared proof reservations must never be released to bypass this issue.
4. Test mixed outputs, incoming/outgoing recovery, later valid cursor progression and negative canonical-corruption controls; run scanner, recovery, submission and protocol known-answer tests.

Done: malformed redundant recipient metadata cannot poison unrelated canonical scanning; authenticated corruption still fails closed; cryptographic/deployment artifacts remain unchanged.

## Task 6 — Bound Nostr transport bookkeeping (F10)

Files: `src/features/private-balance/relay/nostr.ts`, session/transport helpers only as necessary, `tests/private-balance-relay-transport.test.mjs`, `tests/private-balance-relay-availability.test.mjs`, related relay tests. Do not replace Nostr or add transport anonymity claims.

1. Add a socket-free actual-library regression showing upstream retention exceeds the configured application capacity; require bounded retention in the adapter's actual path after implementation.
2. Bound duplicate bookkeeping and incoming frame/structure work before expensive parse/verification. Application-only replay pruning is not a fix for the library's earlier Set.
3. Preserve signature/filter validation, deadlines, physical cancellation, reconnect, identity, multi-relay semantics and once-per-quote signing/submission authority. Ensure invalid early IDs cannot poison valid later delivery.
4. Test sustained unique/duplicate/invalid/oversized input, eviction, reconnection and pending once-only guards. Report structural counts, never payloads.

Done: input processing and deduplication have explicit bounds, normal interoperability and approval safety remain, and complete relay regression suite passes.

## Task 7 — Incremental verified cache append (F11)

Files: `src/features/private-balance/runtime/public-cache.ts`, `src/lib/indexed-db.ts` only for a justified atomic range/checkpoint operation, `runtime/sync-machine.ts` callers, tests `tests/private-balance-public-cache.test.mjs`, `tests/indexed-db.test.mjs`, relevant sync/recovery tests.

1. Add a driver work-count test for 10/20/40 appends; current `n*(n-1)` historical record reads must fail the bounded/linear assertion.
2. Use an atomically checked append checkpoint/range and validate only necessary overlap during routine append. Full retained-history integrity validation remains for rebuild/corruption recovery.
3. Support existing persisted caches without deleting user data. Never trust an unauthenticated counter as canonical history. Preserve contiguous ordering, duplicate ranges, authenticated overlap and cross-tab CAS conflict behavior.
4. Test gaps, conflicts, concurrent append/reset, corrupt checkpoint/chunk, legacy cache transition and identical roots. Add real IndexedDB synthetic coverage when the driver transaction contract changes.

Done: routine append work scales with new/overlap data, not whole history; all existing fail-closed guarantees and compatible cache loading remain; count and behavioral tests pass.

## Task 8 — Investigate signing-context continuation

Files: `src/components/SendModal.tsx`, `src/hooks/useWallet.tsx`, `src/lib/signing-authorization.ts`, relevant API before-sign/broadcast callbacks, `src/components/Dashboard.tsx` command palette only if needed; `tests/signing-authorization.test.mjs`, `tests/signing-security-ui.test.mjs`, `tests/submission.test.mjs`, synthetic provider/browser tests.

1. Add a deferred approval/preparation test and attempt account/network selection through the real permitted control path. Determine whether captured old authority continues after visible context change.
2. If reproduced, bind public signing/review to an originating account/network/session token checked before signing and before broadcast, with appropriate hardware/async gaps covered. Do not prevent canonical tracking of a transaction already broadcast.
3. If not reproducible, record the tested guard and rejected lead; do not install blanket global navigation locks without evidence.

Done: either a regression-proven fix with negative controls or concrete evidence that the suspected path is already blocked; no unauthorized transaction or live-key test.

## Task 9 — Dependency release blocker and factual docs (K01, K02)

Files: `package.json`, `package-lock.json`, `src/lib/hardware.ts` only if a reviewed compatible adapter change is required, `tests/hardware.test.mjs`, `README.md`, `docs/testing.md`, security/deployment docs if facts require; `AGENTS.md`, `CHANGELOG.md` and implementation evidence.

1. Research current official upstream versions/advisories and inspect the exact Trezor → nested Stellar SDK → toml and elliptic dependency graph. No `npm audit fix --force`, guessed major override or waiver.
2. Prefer an upstream compatible fix. Any override must have a demonstrated API compatibility rationale and tests covering the actual adapter imports/conversions, not just a reduced advisory count. Do not hand-patch cryptography.
3. If eliminating an advisory requires dropping hardware functionality or a new unverified signing architecture, stop that part for a security-critical decision while completing independent fixes. Document remaining counts, reachability limits and upstream references honestly.
4. Correct stale dependency counts, zoom and deployment-catalogue prose to observed state. Keep release version 1.4.1 and published changelog history unchanged; add factual Unreleased entries.
5. Add durable rules for close ownership, genuine freshness, revocable publishers, scanner failure categories, bounded ingress/append work and required safe verification.

Done: all safely resolvable high-severity paths removed and production audit passes, or the exact external/security blocker is reported without claiming all issues are fixed. Docs match current behavior and residual risks.

## Final verification and handoff

Run serially where CPU/browser contention affects timing: `npm run typecheck`, `npm test`, `npm run lint`, nested protocol suite, safe isolated component suite, safe overlay/manifest suite, relevant normal e2e suite, `npm run private:check-generated`, `npm run build`, `npm run test:bundle`, `npm run check:bundle`, `npm run audit:prod`, and `git diff --check`. Run `npm run release:verify` from a clean committed worktree; preserve any genuine failure and do not tag/release. Relevant Rust/circuit gates may be run when tooling is present; do not deploy or rerun a trusted ceremony.

Record test counts and failures/skips, safe browser matrix, unchanged or explained bundle deltas, before/after cache/dedup work counts, and which physical/human checks remain. Audit every F01–F12/K01/K02/signing-context item to a final result. Update the plans index and delivery evidence. No main-branch merge, push, deployment or server restart unless separately requested.
