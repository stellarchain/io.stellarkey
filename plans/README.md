# Private-protocol implementation

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

The user subsequently requested “fix everything”. [Implementation plan 004](004-system-hardening.md) covers F01–F12, K02, safe resolution of K01 and the qualified signing-context investigation. Status: **IN PROGRESS**. Execute scoped test-first tasks with independent spec and quality review, preserving the completed privacy plans and main checkout. Record genuine external/security blockers rather than weakening gates or broadening signing authority.

| Task | Status / evidence |
| --- | --- |
| 1 — Safe complete verification (F01/F02) | DONE — `42d5f528`, independent spec and quality approvals. 174 isolated Chromium/iPhone cases, 16 overlay/manifest cases, 58 nested protocol tests passed, zero skips. Root independently reran 33 focused gate/policy tests, two real synthetic browser safety probes and fixture cleanup; all passed. Typecheck passed; lint has only three existing marketing-image warnings. |
| 2 — Genuine market freshness and chart expiry (F03/F12) | DONE — `dea70d9a`, independent spec and quality approvals. 18 focused behavioral tests and five browser checks passed, including Mainnet expiry/refusal/retry/recovery on Chromium and iPhone WebKit. Typecheck and scoped lint passed. Root independently ran the complete Node suite: 1,492 passed, zero failures. |
| 3 — Revocable merchant publication (F04) | DONE — `8aa1a35a`, independent spec and quality approvals. 134 focused tests and 24 real-provider Chromium/iPhone WebKit cases passed, zero browser retries or skips. Root independently ran the complete final Node suite: 1,564 passed, zero failures or skips, 72.09 s. Typecheck, scoped lint, fixture cleanup and diff checks passed. |
| 4 — Operation ownership and accessible feedback (F05/F07–F09) | DONE — 4a/4b and merchant feedback (4c) have independent spec and quality approvals. Task 4c commits are `51d0c7e`, `27c44cd` and `58ceae4`. Final UI runs passed 58 merchant, 114 primitive, 94 modal and 16 continuity/overlay/manifest cases; the subsequent provider-composition addendum passed all 62 merchant cases. Root independently passed 1,606 Node tests, build, typecheck, lint and all unchanged bundle limits. Historical coverage corrections and intermediate failures are recorded below. |
| 5–9 | Pending; see the approved plan for exact scopes. |

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

Implementation baseline: source at `745d983` passed all 1,465 unit tests (74.70 s). An earlier documentation-only attempt failed the repository's prohibition on `docs/plans/`; moving the plan to `plans/` and staging the rename resolved it without weakening the test. Final aggregate verification remains pending all implementation tasks.
