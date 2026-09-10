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

