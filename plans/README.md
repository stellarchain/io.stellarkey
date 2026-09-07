# Implementation plans and evidence

Current status — 2026-09-07: plans 001–003 and the scoped implementation of plan 004 are complete. The final clean-tree application verification passed at `d4edc1d`: 1,716 Node tests, 58 nested protocol tests, 528 required browser checks, production/build budgets, and 114 active normal browser checks. See [the final hardening results](004-hardening-results-2026-09-07.md) for exact counts, intentional skips, earlier failed attempts, independent reviews and remaining upstream/human/device limits. This is not release, Mainnet or deployment approval.

## Historical completion — privacy plans 001–003, 2026-09-06

The following records preserve their original scope and checkpoint results. Their dependency counts and references to future work are historical; the current result is linked above.

Execution of the three approved privacy plans, started from `3e8dca7d021767138bc21c790f7ef59cc2fce309` on 2026-09-06. Original planning documents in the main checkout are preserved. Implementation is isolated on `advisor/001-revoke-stealth-discovery`; the user requested continuing through every plan without routine approval checkpoints. Separate logical commits and independent reviews retain the intended delivery boundaries without merging between temporary branches.

| Plan | Scope | Status |
| --- | --- | --- |
| [001](001-revoke-stealth-discovery.md) | Revocable discovery, stale-publication protection and atomic local removal | DONE — implemented, independently reviewed and verified |
| [002](002-viewing-only-stealth-discovery.md) | Viewing-only material during network discovery | DONE — implemented, independently reviewed and verified |
| [003](003-owned-secret-buffer-cleanup.md) | Owned key/plaintext scratch-buffer cleanup | DONE — implemented, independently reviewed and verified |

No transaction, deployment, push, main-branch merge or user-server restart is part of this execution. Shared proof reservations and already-consented signing journals keep their existing authority. Cryptographic vectors, addresses, schema and dependencies must remain unchanged.

Release limitation: the fresh production dependency audit reports 13 existing transitive findings (8 low, 5 high), including `toml` under Trezor's older nested Stellar SDK and `elliptic`. No lockfile change or automatic dependency upgrade is included. This blocks clean release certification, not implementation of the scoped fixes.

## What changed

| Boundary | Before | Implemented |
| --- | --- | --- |
| Discovery lifetime | Entry-time unlock/leadership checks could outlive authority | Session/scope/lease checks, physical cancellation, drain completion and stale-publication rejection |
| Local removal | Sequential deletion and a previously checked journal snapshot | Abort/drain, pending/build refusal, atomic two-store rollback and exact authenticated raw-record comparison |
| Recognition authority | Full root/scalar/nonce material retained through network discovery | Only a five-field viewing bundle and owned storage-key copy; preparation roots cleared before transport |
| Temporary buffers | Several failure paths missed cleanup | Allocation-scoped cleanup of owned expansion, hash, note, memo and unreturned output material |

Independent spec and quality reviews approved all three scopes after fixing the reported races and missing cleanup tests. Changes are split into `b2ebeb8` (003), `73229dd` (001), and `95dd2c8` (002). Addresses, signatures, proof vectors, contracts, circuits, encrypted formats and dependencies are unchanged. No real wallet keys or live transactions were used; signing/proof checks use synthetic fixtures.

## Final verification — 2026-09-06

Environment: local Darwin arm64, Node 26.7.0, npm 11.19.0, locked React 19.2.8 / Next.js 16.3.3 / Playwright 1.62.1. The isolated worktree owns its test servers on ports 3217/3218; existing user servers and unrelated processes were not stopped. Browser checks use synthetic fixtures or public UI, never a personal wallet. Times below are single-run test durations, not performance benchmarks.

| Gate / command | Final result |
| --- | --- |
| `npm test` | 1,465/1,465 passed, zero skips, 91.31 s; clean pre-change baseline was 1,427/1,427 |
| `npm --prefix protocol/private-balance/packages/browser test` | 58/58 passed, zero skips; pre-change protocol baseline was 44 tests; unchanged known-answer vectors and 1,000 Rust/TypeScript derivation comparisons |
| Focused discovery browser gate | 54/54 passed, 27 per browser; real provider, vault and IndexedDB with controlled transport/worker boundaries |
| `DEBUG=pw:webserver E2E_PORT=3217 node scripts/test-private-components.mjs` | 174/174 passed, zero skips, 4.1 min; Chromium and iPhone WebKit, including the 54 discovery cases |
| `E2E_PORT=3218 npm run test:e2e:private-ui -- --config=playwright.privacy-verification.config.ts` | 16/16 passed, zero skips, 51.0 s; continuity, focus, inertness, scroll lock, keyboard/reduced motion and manifest tampering on both browsers |
| `npm run typecheck` | Passed after fixture cleanup |
| `npm run lint` | Passed, zero errors; three pre-existing `next/no-img-element` warnings in untouched marketing files |
| `npm run private:check-generated` | Passed; three proof vectors verified; local regeneration left tracked outputs unchanged |
| `npm run build` | Passed; 22 static pages, no synthetic fixture route in source or export |
| `npm run test:bundle` | 5/5 passed, zero skips |
| `npm run check:bundle` | All existing budgets passed without threshold changes |
| `git diff --check` | Passed; no dependency, circuit, contract, vector or public-artifact diff |
| `npm run audit:prod` | **Failed:** 13 existing transitive findings, 8 low / 5 high; no automatic fix available for the reported dependency paths |
| Aggregate `npm run release:verify` | Not run as a release certification; its required production-audit component fails. No release or tag created |

The temporary overlay configuration inherited the private runner's screenshot/trace/video-off settings, selected `public-private-continuity.spec.ts`, `overlay-contract.spec.ts` and `private-manifest-security.spec.ts`, and disabled fixture teardown because no fixture route was created. It was removed after verification. To reproduce, use an equivalent temporary config outside the committed application; never enable private-state captures for convenience.

Local text evidence (temporary files, not durable CI artifacts):

- `/tmp/stellarkey-privacy-final-unit-20260906.log`
- `/tmp/stellarkey-privacy-protocol-final-20260906.log`
- `/tmp/stellarkey-privacy-components-final-20260906.log`
- `/tmp/stellarkey-privacy-overlays-20260906.log`
- `/tmp/stellarkey-privacy-artifacts-final-20260906.log`
- `/tmp/stellarkey-privacy-audit-final-20260906.log`

### Lab interaction checks and non-passing attempts

Warm, post-hydration local interactions; five samples per case, DOM acknowledgement plus two animation frames as a paint proxy. Chromium uses 4× CPU throttling; iPhone WebKit uses device emulation without CPU throttling. Local networking is unthrottled. These are shared-host synthetic measurements, not cold-load results, field Core Web Vitals, real-device measurements or evidence of a privacy-change speedup.

| Final full run | Modal median / slowest | Start feedback median / slowest |
| --- | --- | --- |
| Desktop Chromium, 4× CPU | 44 / 51 ms | 62 / 74 ms |
| iPhone WebKit | 41 / 50 ms | 20 / 24 ms |

Before the successful serial full run, running browser checks alongside the CPU-heavy unit suite produced 173 passes and one timing failure: desktop feedback slowest 103 ms against the unchanged 100 ms limit (median 64 ms). A subsequent attempt timed out during the configured 30-second server startup, before any test executed. No source or threshold change was made for either failure. The same timing test then passed six repeated cases (three per browser; 30 samples per interaction): desktop modal medians 43–46 ms / slowest 52 ms, feedback medians 59–62 ms / slowest 69 ms; WebKit modal medians 37–42 ms / slowest 46 ms, feedback medians 21–23 ms / slowest 35 ms. The final serial 174-test run passed unchanged. Resource contention is a plausible contributor, not a proven cause; no perfectly isolated-host claim is made.

Attempt logs: `/tmp/stellarkey-privacy-components-20260906.log`, `/tmp/stellarkey-privacy-components-isolated-20260906.log`, and `/tmp/stellarkey-privacy-timing-20260906.log`.

### Production size checks

| Boundary | Earlier foundation checkpoint raw / gzip bytes | Final raw / gzip bytes |
| --- | --- | --- |
| Initial wallet | 1,165,289 / 341,968 | 1,166,222 / 342,308 |
| Private feature | 264,977 / 71,338 | 270,471 / 72,885 |
| Private worker | 753,512 / not recorded | 759,006 / not recorded |
| Protocol artifacts | 9,424,602 / 6,278,239 | 9,424,602 / 6,278,239 |

The comparison is to the recorded partial-foundation build, **not** a clean pre-change build. The small JavaScript increases accompany the scoped cancellation, persistence guards and cleanup/viewing helpers; dependencies and budget constants did not change. Feature/worker graphs can overlap and must not be added together. Other final journey sizes: landing 634,266 raw / 195,198 gzip, unlocked 763,398 / 167,306, merchant 534,646 / 145,488, hardware 1,047,493 / 210,130. Two-version artifact cache peak remains 18,849,204 bytes.

## Accessibility, security limits and remaining work

Existing automated axe checks, keyboard navigation, focus restoration, overlay identity and responsive iPhone WebKit checks passed. Some existing WebKit axe scans disable color contrast; this is not complete WCAG AA certification. Human VoiceOver/NVDA testing remains unperformed. Screenshots, traces and video were deliberately disabled; no visual rebrand was made.

Viewing material is still sensitive. Least-privilege discovery does not hide network metadata, provide forward secrecy, or protect an actively compromised unlocked browser. Array overwrites are best effort: immutable strings/bigints and opaque library/CryptoKey memory cannot be guaranteed erased. Revocation stops future authorized work, not a request already received remotely or a storage transaction already committed. Shared proof journals/reservations and already-consented signing writes retain their existing safety model.

No approved implementation step remains. Separate follow-ups, not silently included:

- **P1 / medium, dependency-dependent:** resolve the Trezor transitive `toml` / `elliptic` audit paths before release certification. No forced upgrade or hardware-wallet removal was attempted.
- **P2 / small:** complete human screen-reader and contrast checks before release; automation is not a substitute.
- **P2 / medium:** reduce unlocked-journey size before expanding it; its raw budget has only 1,602 bytes of headroom. Budgets were not relaxed.
- Stronger transport anonymity, new cryptographic constructions, schema migrations and guaranteed memory erasure require separate design/threat-model work; they are not claims or deliverables of these three plans.

## Durable engineering rules

- Treat transport abort, authority revocation, work completion and buffer disposal as distinct responsibilities. Every new await, retry, cache writer and publication needs the originating session/scope check; never acquire fresh authority from an old continuation.
- Compare the authenticated pending/build journal snapshot inside the same transaction that removes local stores, including expected absence. Shared spend proofs cannot be revoked by cancellation, expiry or local deletion.
- Network recognition accepts viewing material only. Never add scalar, nonce, root, full-key references, persistence, exports or telemetry to that bundle. Explicit spending derives its own authority separately.
- Document the owner and transfer of each secret buffer. Start cleanup before the first throwing operation; preserve returned witnesses and borrowed inputs. Require success/error negative controls and unchanged known-answer vectors.
- Keep synthetic private fixtures isolated from production routes. Never capture actual keys, private addresses, notes, proofs, amounts or transaction data in screenshots, traces or instrumentation.

Reference guidance consulted on 2026-09-06: [IndexedDB transaction lifetime](https://w3c.github.io/IndexedDB/#transaction-lifetime) informed in-transaction checks and rollback draining; [DOM AbortSignal](https://dom.spec.whatwg.org/#interface-abortsignal) informed cancellation propagation; [React useLayoutEffect](https://react.dev/reference/react/useLayoutEffect) informed committed-scope cleanup before paint. Behavioral tests establish the application-specific guarantees; these references do not certify cryptographic anonymity or physical memory erasure.

## Follow-on whole-system audit — 2026-09-06

[Simple, correct, fast: system audit](system-audit-2026-09-06.md) reviews the completed implementation at `8397a3584f0aba37032f2146f130ba9484a494d8` alongside the public wallet, merchant flows, shared UI, transport/cache scaling, dependencies and release tooling. It contains twelve vetted findings, the existing dependency blocker, a qualified signing-context investigation, fresh read-only verification results, research references and rejected leads.

Historical status at audit handoff: **audit complete; findings not yet implemented or approved**. The user subsequently approved plan 004 below. Plans 001–003 above remain DONE; the audit remains a record of the source state it reviewed.

Considered and rejected for this follow-on audit: treating the fixed Public/Private shell as still broken; releasing shared-proof reservations on timeout; broad claims of optimistic confirmation, missing journals or issuer-blind matching; and large-file/framework rewrites without measured benefit. See the report for evidence and limitations rather than reopening these as unverified findings.

### 004 — Approved system hardening

The user subsequently requested “fix everything”. [Implementation plan 004](004-system-hardening.md) covers F01–F12, K02, safe resolution of K01 and the qualified signing-context investigation. Status: **DONE within the approved scope**, with [final verification and residual limits recorded separately](004-hardening-results-2026-09-07.md). The work used scoped test-first tasks and independent spec and quality review, preserving the completed privacy plans and main checkout. K01's installed high-severity paths are fixed; embedded/remote upstream code, the remaining elliptic advisory and independent release gates are not represented as resolved.

| Task | Status / evidence |
| --- | --- |
| 1 — Safe complete verification (F01/F02) | DONE — `42d5f528`, independent spec and quality approvals. 174 isolated Chromium/iPhone cases, 16 overlay/manifest cases, 58 nested protocol tests passed, zero skips. Root independently reran 33 focused gate/policy tests, two real synthetic browser safety probes and fixture cleanup; all passed. Typecheck passed; lint has only three existing marketing-image warnings. |
| 2 — Genuine market freshness and chart expiry (F03/F12) | DONE — `dea70d9a`, independent spec and quality approvals. 18 focused behavioral tests and five browser checks passed, including Mainnet expiry/refusal/retry/recovery on Chromium and iPhone WebKit. Typecheck and scoped lint passed. Root independently ran the complete Node suite: 1,492 passed, zero failures. |
| 3 — Revocable merchant publication (F04) | DONE — `8aa1a35a`, independent spec and quality approvals. 134 focused tests and 24 real-provider Chromium/iPhone WebKit cases passed, zero browser retries or skips. Root independently ran the complete final Node suite: 1,564 passed, zero failures or skips, 72.09 s. Typecheck, scoped lint, fixture cleanup and diff checks passed. |
| 4 — Operation ownership and accessible feedback (F05/F07–F09) | DONE — 4a/4b and merchant feedback (4c) have independent spec and quality approvals. Task 4c commits are `51d0c7e`, `27c44cd` and `58ceae4`. Final UI runs passed 58 merchant, 114 primitive, 94 modal and 16 continuity/overlay/manifest cases; the subsequent provider-composition addendum passed all 62 merchant cases. Root independently passed 1,606 Node tests, build, typecheck, lint and all unchanged bundle limits. Historical coverage corrections and intermediate failures are recorded below. |
| 5 — Recipient-local metadata containment (F06) | DONE — `5f2ec45`, independent spec and quality approvals. Two new encrypted-fixture regressions failed at the old redundant-index check before the fix. Root independently passed 152 scanner, recovery, sync, submission, archive and protocol checks, typecheck, scoped lint and generated-artifact verification. |
| 6 — Bounded Nostr ingress and bookkeeping (F10) | DONE — `93f24d2`, independent spec and quality approvals. Actual installed-library tests reproduce upstream retention and verify the adapter's bounds, invalid-ID recovery and original-filter reconnect. Root independently passed 218 relay/submission tests, typecheck, scoped lint and fixture cleanup. Ten existing real-manager browser cases passed across Chromium and iPhone WebKit; coverage limits are recorded below. |
| 7 — Incremental verified cache append (F11) | DONE — `662bdd6` has independent spec and quality approvals. Root independently passed all 1,644 Node tests and 16 actual IndexedDB browser checks; measured append reads now scale linearly. Compatibility, corruption and measurement limits are recorded below. |
| 8 — Signing-context continuation | DONE — `8cb9ced`, `a9364ef`, `75ee135` and `bd15ee9` have independent spec and quality approvals. Root independently passed 1,703 Node tests, 468 affected browser cases, 16 required UI cases and the production/bundle gates. Scope and diagnostic limits are recorded below. |
| 9 — Dependency blocker and factual docs | DONE within the safe-resolution boundary — `bf407e2`, `b4f1802` and `6c50995`, with independent spec and quality approvals. Actual nested parser and Trezor compatibility tests support the scoped TOML 4.2.0 override. The installed production audit now passes with ten low package findings and no high/critical findings. Embedded SDK browser code, remote-core provenance, elliptic and hardware/licensing release limits remain explicit in [dependency evidence](../docs/dependency-security.md). |

### Historical task checkpoints

The paragraphs below retain each task's evidence at that time. References to later tasks or aggregate verification as pending describe those checkpoints, not the final state linked above.

Task 1 disables traces, screenshots and video, uses structural-only failure reporting and makes the synthetic suites mandatory in shared CI/release verification. Playwright 1.62 still creates matcher ARIA snapshots without a supported suppression option: usable Testnet runner/import paths now refuse before build, funding or navigation. Ordinary cleanup is verified, but cannot guarantee cleanup after an uncatchable process kill; only non-usable synthetic fixtures are allowed. This is not live-wallet verification or final release certification.

Task 2 retains genuine asset/native/FX observation times and checks required inputs again at each new Mainnet quote action. Expired charts retain their labelled series during revalidation. Shared-cache concurrency, action-time expiry and retries inside invoice, fixed-code and split-payment dialogs were corrected during review; retries preserve drafts. Browser traffic used entirely synthetic fixtures with external requests intercepted and captures disabled. No live quote, payment or Mainnet transaction was made. Final aggregate verification and bundle measurement remain pending all tasks.

Task 3 revokes repository cache publication, queued edits, PIN actions and asynchronous merchant results with their originating vault and merchant lifetime. Completed encrypted commits remain durable, but cannot republish private state after revocation. Review exposed additional refund handoff failures: recovery identities now survive lock, failed journal writes and a second reload until an authenticated terminal journal commit acknowledges them. The persisted retention hint never establishes a transaction outcome; reload checks the canonical ledger again. An unmatched hint is conservatively retained because another tab may still be committing its journal: it reserves no merchant funds, may cause a bounded recheck after restart, and is cleaned up by authenticated terminal acknowledgement or explicit reset. Successful merchant erasure preserves unresolved transaction tracking, and optional cleanup failure does not turn a confirmed refund into a failed action.

The final Task 3 review also reproduced a queued writer-lock request stranded by same-session reset. Current reset settlement now restarts only pending acquisition, including after failed erasure; held ownership and newer sessions remain untouched. Five focused controls and real Web Locks browser contention tests cover the boundary. All browser data was synthetic, external traffic blocked and captures disabled. Cryptography, encrypted formats and deployment artifacts are unchanged; final aggregate release verification remains pending the other tasks.

Task 4a gives Add Account and claim review each one close policy and an opening-scoped owner for asynchronous results. Header, footer, backdrop, Escape and alternate handoffs share the guard; old success, error and cleanup cannot change a reopened dialog. Submission tracking remains with the wallet after handoff. Canonically confirmed claims can be closed while balances refresh, and refresh failure does not relabel a confirmed transaction as failed. Ordinary parent callback changes no longer restart the tracked confirmation refresh. Account subtitles describe the selected mode without guessing a derivation index.

Verification used real providers and synthetic, externally blocked browser traffic: 74 modal cases, 38 existing primitive cases and 14 required continuity/overlay cases passed across Chromium and iPhone WebKit, with then-labelled normal/reduced-motion cases (coverage correction below). A later 24-case run added eight actual-header wording checks and repeated 16 mode/busy controls. The new contrast check waits for the existing enabled-button opacity transition to finish; no styling or accessibility rule was changed. Metadata-only wording regressions first produced 10 expected failures and 10 passing controls, then passed all 20 cases. Root's final complete Node run passed 1,600 tests in 71.14 s, with zero failures or skips; typecheck, scoped lint, fixture cleanup and diff checks passed. Reviewers independently ran 46 focused tests and 36 new tests respectively. Human screen-reader, physical pinch and hardware-device checks remain unverified.

Task 4b coverage correction: installed Playwright 1.62 did not apply these suites' top-level `reducedMotion` option over the base `contextOptions` setting. The historical counts above remain valid, but their normal-motion coverage claim is withdrawn. The modal and continuity suites now set `contextOptions.reducedMotion` and assert the actual media preference in the browser. Earlier corrected modal attempts passed 80/82 and 79/82 cases. A bounded probe proved that the wording failures counted delayed original entrance events after those same animations had already finished, not a new entrance or a lost shell. The older unlocated claim failures remain unattributed. The observer now distinguishes unchanged completed playback from replacement or restarted playback; real shell/backdrop replay controls include restarting the original animation object. Reduced-motion fault-injection controls explicitly enable entrance keyframes and select CSS animations rather than incidental CSS transitions. Separately, the tooltip containing-block test now waits for its deliberately changed geometry to settle before asserting the exact non-zero offset; it does not change production positioning.

Task 4b shared composition now forwards Field associations to both Select triggers, requires meaningful Toggle names, and keeps tooltips available across trigger/content hover and keyboard focus. Escape respects the active modal, tooltips use their owning modal portal, and a source becoming inert dismisses its tooltip with observer/listener cleanup. Modal opener tracking also resolves an SVG pointer target to its actual control, fixing focus restoration from the real Receive/Add Account icons without changing keyboard opener selection. Source commits are `aa91527`, `161a40f`, `bdfebdf` and `1c886b2`; test-fidelity commits are `5871ddd`, `73341e5` and `5af3db4`. Production changes, geometry checks and the final modal/continuity test addendum all have independent spec and quality approvals.

Fresh final Task 4b runs passed 112 primitive cases, 94 modal cases (82 flow cases plus 12 observer controls), 10 required continuity cases and four overlay cases, with zero failed attempts or skips in these runs. They cover Chromium and iPhone WebKit with runtime-checked motion preferences where applicable. Root independently passed all 1,601 Node tests in 66.73 s, the production build, all five bundle tests, fixture cleanup and unchanged size limits. Initial JavaScript is 1,171,854 raw / 344,102 gzip bytes, an increase of 1,533 / 477 over the Task 4a baseline from the shared UI changes; unlocked raw bytes remain 764,409 and merchant bytes remain 544,268 / 147,952. Hardware and private protocol sizes remain unchanged. Earlier diagnostic failures are recorded above, not represented as clean first attempts. At this checkpoint, merchant feedback (4c), the remaining hardening tasks and final clean-worktree release verification were still pending.

The cumulative production build through Task 4a passed all five bundle tests and all unchanged limits. Unlocked JavaScript was 764,409 raw / 167,655 gzip bytes; merchant JavaScript was 544,268 / 147,952. That intermediate measurement left only 591 and 732 raw bytes of headroom respectively. Hardware and private protocol artifact sizes were unchanged. This was not final release verification.

Task 4c binds each merchant action's pending state, safe local error and supplementary success feedback to its opening and actual merchant/vault lifetime, including failed same-session reset. Customer drafts and explicit retries remain available, unrelated actions remain usable, and a changed payment-request URI revokes stale copy feedback without releasing its outstanding physical clipboard write. Contact add/remove/favorite operations now capture their originating vault session before queueing, check it before encrypted persistence and before publishing plaintext, and preserve already committed encrypted data across lock/unlock. Ordinary contact edits cannot acquire fresh authority from an old continuation; explicit-key initialization and backup paths are unchanged.

The shared Button and Toggle retain native disabled defaults, with a guarded focus-preserving opt-in for these merchant actions. Repeated pointer, keyboard, programmatic and implicit form activation remain blocked while unavailable. When an action disappears, the Start-card heading and same-row copy-menu trigger receive focus only from their own still-current focus owner. Toasts use a stable polite, additions-only live region, retain existing message nodes, wrap longer text and clean up owned expiry timers; the new global success labels contain no customer or code identifiers.

Final Task 4c UI verification passed 266 checks (58 merchant, 114 shared primitive and 94 modal), followed by 16 required continuity/overlay/manifest checks, with zero failed attempts or skips. Both Chromium and iPhone WebKit ran; applicable motion cases assert the actual media preference, and merchant composition passes axe and 200% equivalent reflow checks. Plain Tab failed on the installed WebKit's ordinary enabled-button baseline too; the new navigation controls therefore verify its native Option-Tab path before and during the pending/saved states. This is not a physical keyboard or assistive-technology certification. Earlier expected regressions covered stale contact work and pending/disappearing-control focus loss. Expanded fixture failures also exposed a wrong synthetic-code selection and an alert query including Next's route announcer; those test targets were corrected. An overlapping fixture-teardown/typecheck attempt failed generated route validation, and one focused release command omitted the repository TS loader; the final serial/configured runs passed without weakening either gate.

Root's first Task 4c production measurement failed the merchant budget at 546,290 raw bytes, 1,290 over its unchanged limit. The separately reviewed `58ceae4` addendum composes the six existing typed merchant contexts instead of duplicating their 125-field aggregate and dependency list. All six memo blocks, callbacks, provider nesting and loading boundaries are unchanged. Four real-provider field/value/reference equivalence controls passed before the edit; all 62 merchant checks passed afterward. The probes retain only structural counts and mismatch booleans across configuration, ticket/reporting, network, staff, reset, lock/unlock and remount updates.

Root independently verified the final committed source with all 1,606 Node tests passing in 61.36 s (zero failures or skips), the 22-page production build, all five bundle tests, typecheck, fixture cleanup and diff checks. Full lint passed with only the three existing marketing-image warnings. Final JavaScript measurements are initial 1,172,620 raw / 344,309 gzip bytes, unlocked 764,409 / 167,657, and merchant 543,536 / 148,591. The composition removes 2,754 raw / 204 gzip merchant bytes relative to the failed Task 4c build, leaving 1,464 raw / 1,409 gzip bytes below the same limits. Hardware remains 1,047,493 / 210,130; private feature remains 271,171 / 73,089, worker 759,006 raw, and protocol artifacts 9,424,602 / 6,278,239 with an 18,849,204-byte two-version peak. No budgets, graph measurements, dependencies, cryptographic artifacts or safe reporter settings changed. Human VoiceOver/NVDA, physical pinch and hardware-device checks remain unverified. Tasks 5–9 and final clean-worktree release verification remain pending.

Task 5 uses the recipient opener's existing commitment check to recover the authenticated registry asset instead of rejecting its redundant plaintext index. The scanner's outgoing-index validation, registry checks, canonical action and nullifier checks, tree verification and transcript construction are unchanged; final transcript-head authentication remains with sync. No reservations, note encoding, keys, proof inputs, contracts or deployment artifacts changed.

The new synthetic cases put a wrong registered candidate first, mismatch the recipient index with another registered asset, and use an unregistered index in change and genuinely openable dummy outputs. Both recipient and outgoing envelopes are resealed together. Sender and recipient assertions verify exact note/activity accounting, memo and recipient fingerprint, nullifiers, later valid action recovery, and identical full/incremental trees and transcript hashes. Negative controls preserve canonical rejection boundaries. Both metadata cases failed at the original redundant-index rejection before the source edit; all five scanner tests then passed. Root's expanded run passed 152 tests in 4.52 s with zero failures or skips, followed by typecheck, scoped lint, generated-artifact verification and clean diff/worktree checks. Both independent reviews approved `934cdca..5f2ec45`. Tasks 6–9 and final clean-worktree release verification remain pending.

Task 6 bypasses `nostr-tools` 2.25.1's unbounded pre-verification duplicate set with direct relay subscriptions and a 512-entry FIFO shared across each logical subscription's relays, filters and reconnects. Only filter-matching, signature-verified delivery inserts an ID; invalid early IDs cannot poison a later valid event. The socket boundary rejects frames over 64 KiB and excessive structure before JSON parsing, bounds event shape and encrypted content, and reconstructs canonical signed fields before the SDK's fast scanner. Unused control messages are dropped; accepted control reasons and consumer exceptions cannot enter the identified raw-payload logging paths. These are retained-state and per-frame work limits, not traffic-rate DoS resistance or transport anonymity. Duplicate frames still undergo bounded canonical parsing before avoiding subsequent SDK parsing and signature work.

The actual-library baseline retained 1,024 invalid IDs; the old adapter exceeded the 512-ID target and rejected valid delivery after an invalid event reused its ID. Other expected regressions covered oversized/deep/wide input, raw SDK logging and invalid future timestamps shifting native reconnect filters. Reconnect now belongs to the existing outer retry loop, which retains original filters and resets backoff after a successful subscription. A separate expected regression proved that successful quiet reconnections must not progressively increase their delay; failed setup and immediately closed subscriptions retain bounded backoff. A maximum legitimate 24-KiB-padded NIP-44 message round-trips despite its encrypted content exceeding 32 KiB. Physical deadlines, cancellation, negative publish replies and once-per-quote approval/submission authority remain covered.

Root's fresh final run passed 218 relay and private/public submission checks in 30.85 s, with zero failures or skips, followed by typecheck, scoped lint, fixture cleanup and diff checks. Both independent reviews approved `e8e0bdb..93f24d2`. Ten browser cases passed with zero failed attempts, retries or skips: duplicate approval, exact authorization before acknowledgement, uncertain RPC, lost acknowledgement and account replacement, each on Chromium and iPhone WebKit. These real-manager tests use a synthetic transport and are separate from actual-library deduplication/eviction tests; they do not establish a combined eviction-to-manager path or native-browser WebSocket-wrapper coverage. The browser run preceded the final retry-only correction; final Node checks cover that correction, and the complete release browser gate remains pending. No relay identity, session protocol, dependency, cryptographic artifact or safe reporter configuration changed. Tasks 7–9 and final clean-worktree release verification remain pending.

Task 7 stores immutable public commitment leaves behind an atomically compared generation, revision, count and rolling-digest checkpoint. A warm validated basis checks the necessary tail, overlap and newly appended range; another writer's forward progress is validated against that basis. Cold loading still enumerates and validates retained history. The unkeyed digest checks cache consistency, not canonical chain authenticity: sync's existing Merkle-root and authenticated-head checks remain unchanged. Corruption outside the warm range is detected on full cold validation or rebuild, not by every append. Migration retains legacy records, and a present v2 namespace cannot silently fall back to v1 after corruption or reset. Reset preserves unrelated discovery data and uses a fresh generation to reject old writers.

Measured cumulative work for single-record appends, including checkpoint and transaction checks:

| Appends | Before: records read / JSON-value bytes read | After: records read / JSON-value bytes read | After: read requests / records written |
| --- | --- | --- | --- |
| 10 | 100 / 15,700 | 56 / 10,458 | 72 / 20 |
| 20 | 400 / 62,900 | 116 / 21,774 | 142 / 40 |
| 40 | 1,600 / 252,100 | 236 / 44,414 | 282 / 80 |

The tradeoff is two record writes per append instead of one. Written JSON-value bytes increase from 1,570 / 3,150 / 6,310 to 3,591 / 7,211 / 14,451 for the same sizes. Alternating two driver instances also scales linearly: 75 / 155 / 315 returned records and 13,531 / 28,004 / 56,964 read bytes. These are instrumented storage requests, returned records and serialized value sizes, not physical I/O, native storage overhead or latency benchmarks. The original implementation failed the bounded-read assertion before the source change.

Task 7's related 144 Node checks cover deterministic append/reset races, copied mutable inputs, overlap, gaps, conflicts, corruption, migration and recovery. The sync recovery case verifies archive fallback and identical commitments/root after both public and Merkle caches are corrupted; its pending action is already resolved before corruption, so it does not establish that combined fallback with an active held proof. Other existing held-reservation controls remain intact, and production sync/reservation code did not change. Actual IndexedDB tests cover atomic expectation failures, input snapshots and a two-driver migration/append/overlap/reset integration; these are not native two-tab concurrent stress tests. Four new driver checks failed as expected before the driver edit.

Root independently passed all 1,644 Node tests in 55.73 s and repeated all 16 browser checks on Chromium and iPhone WebKit with zero failures, retries or skips. Typecheck, scoped lint, fixture cleanup and diff checks passed. Both independent reviews approved `c71ef06..662bdd6`; quality review found no critical or important issue and identified the held-proof reporting limit recorded above. All browser fixtures were isolated and synthetic, with captures disabled. Tasks 8–9, final bundle measurement and clean-worktree release verification remain pending.

Task 8 reproduced stale public-payment authority through the actual responsive account menu: open the menu, use the Send shortcut, activate review/confirmation by keyboard, then select another account through its permitted pointer control during approval or preparation. The original changed-account cases signed and posted once; unchanged-account controls remained valid. The real network command was inert behind the overlay, so that control path was rejected as an exploit lead. Supplemental provider-delivered account/network round trips test revocation and fresh authority, but are not evidence that a user can operate an inert control.

Public Send and its co-signed-payment preparation now capture the originating account, network, vault session and context revision before their first asynchronous dependency load. Review authority remains bound to that same origin. Checks cover password approval, credential access, hardware initialization and approval, signing, and the final continuation after prepared-journal completion immediately before POST. Existing merchant authorization remains composed with these checks. A microtask regression caught why checking only inside the prepared callback was insufficient; definite pre-POST cancellation stays outside ambiguous network-outcome handling. Already-broadcast canonical tracking continues, and receipt links retain the originating network. This is not a rewrite of every wallet action or private-relay signing authority.

Send keeps one Tabs ancestry while current private eligibility changes, preserving its draft, review and local cancellation error. A fresh review can intentionally retry. Password approval preserves the originating Confirm control, and a disappearing owned Confirm control can hand focus to the result heading without overriding newer pointer or overlay intent. Removing the unreachable secondary `SendInner` header restored the unchanged unlocked size budget; the actual outer header and private Send shell were not removed.

Root's earlier independent 160-case run passed 157 cases and failed three. Both native-socket failures used an obsolete plaintext fixture rejected by Task 6's canonical Nostr ingress; the fixture now exchanges REQ/EOSE frames while retaining setup-deadline and physical-close assertions. A separate regression proves that background account refresh cannot consume the payment-preparation hold. The first signing failure's exact assertion was not retained. Later repeated runs captured a natural Authorize-to-Close focus change before Enter, matching a controlled initial-focus callback regression and cancelling with zero signatures or POSTs. Another structural witness isolated an axe contrast sample during the existing disabled-to-enabled opacity transition; the assertion now waits for the two actual controls' settled enabled styles without changing CSS or accessibility rules.

The shared Modal addendum captures the opener before initialization, preserves newer in-panel focus, respects the top modal and cancels an obsolete initial-focus callback on close, unmount or retained-shell reopening. Existing mounted lifetime and restoration target policy remain unchanged. Review caught a first candidate's passive opener-capture ordering gap; two tests execute the actual ownership effects with passive work both before and after the opening frame. Browser controls cover ordinary initialization/restoration, pending-frame approval, nested ownership, deferred opening, close/unmount cleanup, rapid reopening and Strict Mode. These structural witnesses support the later diagnosis, not complete retrospective attribution of the earlier 160-case run. Original RED and implementer repetition results were terminal-only evidence, not retained filesystem artifacts.

Root independently verified the final committed candidate with 1,703/1,703 Node tests in 58.586 s; 468/468 affected browser cases (166 private components, 146 shared primitives, 94 modal ownership and 62 merchant feedback); and 16/16 required continuity/overlay/manifest cases. Both browser runs had zero failed attempts, retries or skips, with 234 affected cases per engine. Applicable motion tests assert the actual preference. Typecheck, full lint, the 22-page production build, all five bundle tests, fixture cleanup and diff checks passed. Lint retains only three existing marketing-image warnings. Both reviews approved `1f8134e..bd15ee9`; reviewers inspected source and root evidence without running competing runtimes.

Final cumulative measurements through Task 8, using the unchanged graph definitions and budgets:

| Boundary | Raw bytes | Gzip bytes |
| --- | ---: | ---: |
| Landing | 636,237 | 195,789 |
| Initial wallet | 1,173,842 | 344,673 |
| Unlocked | 764,760 | 167,844 |
| Merchant | 543,536 | 148,591 |
| Hardware | 1,047,527 | 210,139 |
| Private feature | 274,671 | 74,327 |
| Private worker | 762,199 | Not measured |
| Protocol artifacts | 9,424,602 | 6,278,239 |

Unlocked headroom is 240 raw bytes; no threshold was relaxed. The artifact two-version peak remains 18,849,204 bytes. These are cumulative post-Task-8 measurements, not isolated per-task performance claims. Root's temporary text logs are `/tmp/stellarkey-hardening8-root-final-unit-20260907.log`, `/tmp/stellarkey-hardening8-root-final-components-20260907.log`, `/tmp/stellarkey-hardening8-root-final-private-ui-20260907.log` and `/tmp/stellarkey-hardening8-root-final-static-20260907.log`. Fixtures were isolated, synthetic and externally blocked, with captures disabled. No live wallet transaction, physical hardware, human VoiceOver/NVDA or physical pinch verification is claimed. Task 9 and final clean-worktree release verification remain pending.

Implementation baseline: source at `745d983` passed all 1,465 unit tests (74.70 s). An earlier documentation-only attempt failed the repository's prohibition on `docs/plans/`; moving the plan to `plans/` and staging the rename resolved it without weakening the test. Final aggregate verification remains pending all implementation tasks.
