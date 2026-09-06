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
| 4 — Operation ownership and accessible feedback (F05/F07–F09) | IN PROGRESS — proceeding in logical parts: modal ownership and accurate account wording; shared accessibility composition; persistent merchant feedback. |
| 5–9 | Pending; see the approved plan for exact scopes. |

Task 1 disables traces, screenshots and video, uses structural-only failure reporting and makes the synthetic suites mandatory in shared CI/release verification. Playwright 1.62 still creates matcher ARIA snapshots without a supported suppression option: usable Testnet runner/import paths now refuse before build, funding or navigation. Ordinary cleanup is verified, but cannot guarantee cleanup after an uncatchable process kill; only non-usable synthetic fixtures are allowed. This is not live-wallet verification or final release certification.

Task 2 retains genuine asset/native/FX observation times and checks required inputs again at each new Mainnet quote action. Expired charts retain their labelled series during revalidation. Shared-cache concurrency, action-time expiry and retries inside invoice, fixed-code and split-payment dialogs were corrected during review; retries preserve drafts. Browser traffic used entirely synthetic fixtures with external requests intercepted and captures disabled. No live quote, payment or Mainnet transaction was made. Final aggregate verification and bundle measurement remain pending all tasks.

Task 3 revokes repository cache publication, queued edits, PIN actions and asynchronous merchant results with their originating vault and merchant lifetime. Completed encrypted commits remain durable, but cannot republish private state after revocation. Review exposed additional refund handoff failures: recovery identities now survive lock, failed journal writes and a second reload until an authenticated terminal journal commit acknowledges them. The persisted retention hint never establishes a transaction outcome; reload checks the canonical ledger again. An unmatched hint is conservatively retained because another tab may still be committing its journal: it reserves no merchant funds, may cause a bounded recheck after restart, and is cleaned up by authenticated terminal acknowledgement or explicit reset. Successful merchant erasure preserves unresolved transaction tracking, and optional cleanup failure does not turn a confirmed refund into a failed action.

The final Task 3 review also reproduced a queued writer-lock request stranded by same-session reset. Current reset settlement now restarts only pending acquisition, including after failed erasure; held ownership and newer sessions remain untouched. Five focused controls and real Web Locks browser contention tests cover the boundary. All browser data was synthetic, external traffic blocked and captures disabled. Cryptography, encrypted formats and deployment artifacts are unchanged; final aggregate release verification remains pending the other tasks.

Implementation baseline: source at `745d983` passed all 1,465 unit tests (74.70 s). An earlier documentation-only attempt failed the repository's prohibition on `docs/plans/`; moving the plan to `plans/` and staging the rename resolved it without weakening the test. Final aggregate verification remains pending all implementation tasks.
