# Private payments privacy implementation plan

User authorization: implement the privacy audit recommendations. Base: f0df81d.
Workspace: .worktrees/privacy-hardening; branch feat/private-payments-privacy.

Goal: close proven privacy leaks while retaining authenticated recovery, exact transaction review, and explicit pending/unknown states.

Architecture: keep the current immutable note pool and proof statement operational. Version the browser relay protocol where required, authenticate the advertised Stellar key before selection, preserve submission policy in encrypted state, and route proof-bearing preparation and outcome handling through the chosen helper/common archive. Preserve recent reconnect/readiness fixes. Independently specify changes requiring new cryptography, services or deployments.

Stack: Next.js static export, React, Stellar SDK, TypeScript browser workers, Nostr transport, encrypted IndexedDB, Circom/Rust pool.

## Task 1 — Authenticated relay offers

Add a canonical, domain-separated account-key signature binding network, pool, request, reply key, peer relay key, claimed account, quote, fee and expiry. Quotes lacking valid authorization cannot enter ranking or receive selections. Sign only through the existing revocable software signer after helper opt-in; no arbitrary payload signing API or secret export. Account key possession and transaction threshold eligibility remain distinct. Test tampering, another account, stale/cross-request replay, replacement offers and genuine encrypted exchange. Update the relay version/topic consistently when breaking encoding.

Scope: relay protocol/session/account-authorization module, helper manager, narrow wallet signing interface, relevant tests. Root will manage shared release notes.

## Task 2 — Durable routing and confirmation

Persist direct/relay routing on prepared actions, validate it on load/backup and keep it immutable during state transitions. New relayed actions never automatically use a direct sender RPC for broadcast or transaction-hash lookup. Legacy records with unknown routes must reconcile conservatively without automatic broadcast. Confirm relayed actions from authenticated common archive scans; failed/expired/unknown status must not release notes prematurely. Test crash after signing, restart without helper, old state and expired actions.

Scope: runtime types/storage/action-flow/provider/submission and tests.

## Task 3 — Less revealing recovery requests

Correction from implementation tracing: new stealth scans already use the retained-history floor, not wallet birthday. Preserve this stronger common boundary, remove the latent reader timestamp binary search, and normalize legacy cached lower bounds without discarding authenticated forward cursors. Tests compare external request targets across birthdays and cover retained-history boundaries and recovery completeness.

Scope: stealth runtime/Horizon/sync and tests.

## Task 4 — Relay preparation

Extend encrypted helper negotiation to prepare/simulate the proof-bound operation. The sender verifies the returned exact operation, network, helper source, time/fee bounds, and envelope before signing/submitting through the helper. Refuse sender-RPC simulation fallback. Helpers continue local simulation and manual transaction approval. Keep all jobs bounded/replay-checked and never log payloads. Integration tests must exercise the real message codec/session and review.

Scope: relay protocol/session/review, helper manager, action flow/provider/controller and tests; perform after Task 1 to avoid concurrent edits.

## Task 5 — Consolidation and discovery metadata

Make each consolidation step eligible for explicit relay selection and cumulative private/network fee caps; preserve reservations, expiry and confirmation between steps. Reduce unnecessary clear discovery fields and pad encrypted payload classes without claiming network anonymity. Test fragmented balances, cancellations and stale negotiation.

## Task 6 — Historical recovery choice and protocol research

Implement optional outgoing-history minimization only where the existing recovery classifier can represent the loss honestly and fixed envelope shape remains intact. Do not silently opt users out of recovery. Write a concrete versioned hidden-diversifier specification and fee-separation/transport deployment requirements; no unreviewed custom KEM in enabled production paths. Preserve live deployment compatibility.

## Verification and handoff

For each security/behavior change: failing behavioral test, implementation, focused suite, independent specification review, then code-quality review. Update CHANGELOG.md Unreleased per logical feature. Read bundled Next.js client/static-export docs before writing code (completed). Avoid new overlay shells; if touched, run the relevant accessibility and overlay tests.

Commands:

~~~sh
node --no-warnings --experimental-strip-types --loader ./tests/ts-resolve-loader.mjs --test tests/private-balance-relay-*.test.mjs tests/private-balance-submission.test.mjs tests/private-balance-storage.test.mjs tests/private-balance-stealth-horizon.test.mjs
npm run typecheck
npm run lint
npm test
npm run build
~~~

Before release, use npm run release:verify from a clean worktree. No mainnet deployment, ceremony claim or third-party service operation is implied by local implementation. Record exact remaining infrastructure/independent-review dependencies.

## Implementation checkpoints (2026-09-04)

- Completed Tasks 1–4 on the isolated branch, including account-authenticated
  padded v2 negotiation, durable route-preserving recovery, conservative expiry
  corroboration, birthday-independent discovery, helper-side preparation and
  encrypted-only action kind. Also completed bounded encrypted address issuance
  history preserved across full-verification reset/rollback.
- Task 5 is being integrated. Its fixed-reference fee-aware planner passed
  specification and independent quality review; budgets bound both worst-case
  private fees and cheaper-quote value growth, and legal-pair selection handles
  signed-64-bit boundaries. Each execution step must retain fresh explicit peer
  choice and confirmed owned-output lineage.
- Task 6 migration requirements are drafted in
  `docs/private-payments-next-format-migration.md` in the branch. No new KEM,
  format deployment or anonymity service is enabled. Optional outgoing-history
  omission is implemented in the worker and pure preference panel with explicit
  consent and recovery ON by default; encrypted runtime wiring remains underway.
  Synthetic full-history recovery tests cover sends, helper fees, self-transfers,
  withdrawals and ON/OFF/ON transitions; no incoming/spent-note loss was found.
- Checkpoint verification: 1,296 unit tests, production build and bundle gates
  passed before the last helper-lifecycle tests. The 15 focused Chromium/iPhone
  WebKit private-UI tests passed. Public accessibility checks passed 3/4 in dev;
  the remaining iPhone navigation was intercepted by the Next development-tools
  badge and must be rerun against a fresh static build.
- Generated-artifact verification passed after installing the pinned nested
  circuit dependencies; generated files stayed unchanged. Production dependency
  audit reports 13 existing findings (5 high), in Trezor transitive dependency
  paths, with no automatic fix. Root dependency versions are unchanged. This
  prevents claiming a clean complete release verification.

## Review escalation (2026-09-05)

- Task 5 specification and quality reviews passed the fixed-note, dual-fee,
  explicit choice and canonical-owned-output logic. A stale old-chain completion
  clearing replacement UI was fixed with exact operation ownership and a deferred
  completion regression.
- Review established that a disclosed transfer/withdraw proof can be rewrapped
  in a fresh transaction and its current root can be refreshed. Envelope expiry
  is therefore not a spend-proof deadline. Implementation now adds explicit
  pre-disclosure spend consent, durable exposure records before helper/RPC calls,
  pre-exposure chain fee authorization, and conservative retention on cancellation,
  rejection and expiry. No unreviewed protocol deadline is invented.
- Synthetic real-component browser checks are being added for recovery consent,
  stale account completion, chain picker steps, cancellation, stable modal shell,
  focus, inertness, scroll lock, reduced motion and iPhone WebKit. Network access
  is blocked outside the local fixture server; screenshots/traces/video are off.

## Consolidation checkpoint (2026-09-05)

- Committed Task 5 as `44776a9` after specification and independent quality
  approval. Backup restore preserves legacy possibly exposed reservations;
  canonical conflicting spends reconcile them without treating absence or time
  as proof invalidation. Full checkpoint: 1,355 tests passed, lint passed with
  three pre-existing marketing image warnings.
- Root-owned Task 6 worker, preference panel and settings mount passed spec
  review and 50 focused tests. Eight synthetic Chromium/iPhone-WebKit component
  checks pass, including post-save keyboard focus. The runner now blocks HTTP
  and WebSocket traffic outside its exact owned origin; production configuration
  rejects a fixture route left behind by a killed test process.
- Encrypted runtime preference wiring is implemented and its separate review is
  underway. Full integrated suite: 1,367 passed. Typecheck, lint, production build,
  five bundle tests and bundle budgets pass. Final synthetic browser coverage is
  ten checks (success/failure focus), existing private UI is 15/15, and production
  critical-wallet accessibility is 4/4. The dev-tools badge issue does not occur
  in the production build. The pre-existing production audit remains a release
  blocker; no dependency override was applied.

## Completed client-hardening handoff (2026-09-05)

- Task 6 specification and independent quality reviews approved; new runtime
  tests verify consent, scoped CAS, immutable policy, restore behavior and
  metadata minimization. Committed as `0ed4c84`; migration/handoff docs in
  `0a37602`, followed by a verification-record commit.
- `npm run release:verify` started from a clean implementation worktree, passed
  generated artifacts, typechecking, 1,367 tests and lint, then stopped at the
  pre-existing 13-findings production dependency audit (five high). Complete
  release verification is not green. Build/bundle and 29 browser checks passed
  separately; generated files remain unchanged.
- No new pool/cryptographic suite, ceremony, anonymity service or live payment
  deployment was performed. No merge/push/PR/tag is authorized or executed.
  Main remains at `f0df81d` with its original untracked user files preserved.
