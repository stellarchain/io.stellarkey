# StellarKey UX engineering audit

Status: remediation and full release verification complete
Audit date: 2026-08-31  
Baseline source: `17a8612` (the static export was produced before the evidence-only `17a8612` commit; application source is identical to `f70c5e7`)  
Remediated application source: `9cefb86`
Target: WCAG 2.2 AA, responsive desktop/iPhone/iPad, no backend requirement

## Executive finding

StellarKey has a strong visual system and unusually careful transaction and local-key handling. Its main UX regression is architectural rather than cosmetic: stable application chrome is frequently placed behind lazy component boundaries, while whole dialog subtrees change identity for local mode changes. A click can therefore update React state immediately but leave no useful rendered acknowledgement until a chunk, runtime, or data source becomes ready.

The Public/Private Send flow is the clearest example. The shared portal and backdrop remain mounted, but the full visible subtree—including heading and controls—is replaced by a dynamically imported Private component whose configured fallback is `null`. The selected control is also unmounted as part of that replacement, so pointer focus falls back to the document body. On a simulated mid-tier mobile profile, the Private control took a median 535 ms to expose its selected state and useful panel content took 2.34 s. This creates the perceptual close/reopen even though the portal node survives.

The correct layer to fix was the shared interaction architecture: keep overlay ownership and stable controls outside lazy or asynchronous panel boundaries, give content-switching controls actual tabs semantics, scope loading to the waiting panel, and clear sensitive private panel state deliberately rather than incidentally through broad remounts.

That remediation is now implemented for the critical Send, Receive, and Add Assets paths. The dialog root, portal, backdrop, heading, close control, tab list, focus ownership, inert background, and scroll lock retain identity while only the tab panel changes. Private runtime activation begins only after explicit Private selection, selected semantics update urgently, and the runtime request is scheduled as non-urgent React work. Focused continuity coverage passes on Chromium and iPhone WebKit, including keyboard and reduced-motion paths.

The same stable-shell rule now covers Merchant reloads. A validated non-sensitive bootstrap hint keeps Merchant navigation present only while the encrypted archive rehydrates; the authenticated encrypted setting becomes authoritative as soon as it is ready. The last explicitly selected Wallet or Merchant shell mode is restored from a validated local enum, and mobile Wallet settings exposes a direct Open till action without loading or exposing merchant records early.

## Exact Public/Private root cause

The dialog did not literally close. Its shared portal and backdrop stayed in the DOM, but the application replaced the complete visible dialog subtree when `sendMode`, `receiveMode`, or `addMode` changed. The replacement Private subtree came from a `next/dynamic` boundary whose fallback was `null`. That combination produced four linked symptoms:

1. the visible heading, close control, tab list, and panel disappeared while the private chunk/runtime became ready;
2. the focused Public/Private control was unmounted, so WebKit and Chromium could move focus to `body`;
3. the incoming subtree replayed its own mount/entrance behavior, creating a perceptual close/reopen even though the portal survived; and
4. selected state existed in React before any selected tab remained rendered, delaying visible acknowledgement.

The fix was not a longer animation. A static shell now owns `open`, focus, scroll lock, inertness, title, close control, and Tabs. Lazy boundaries exist only inside the panel region. Tab state updates synchronously; private activation runs after explicit intent in a transition; and leaving/closing calls the private panel's narrow cleanup lifecycle without destroying the dialog.

## Technical context

- Next.js 16.3.3, React/React DOM 19.2.8, App Router, static export.
- Client-side wallet runtime with React context/hooks; no Redux, Zustand, XState, SWR, or TanStack Query.
- Tailwind CSS 4 plus shared CSS tokens in `src/app/globals.css`.
- Shared hand-built primitives in `src/components/ui.tsx`; no Radix, Headless UI, or animation library.
- Stellar JS SDK 17.0.1, Horizon for classic account data and RPC for contract/private-payment work.
- Local encrypted vault and encrypted private-payment storage; no application backend or telemetry.
- Playwright 1.62.1, `@axe-core/playwright`, Node tests, TypeScript, ESLint, bundle budgets, and real-testnet Private Payments journeys.

## Critical flow map

| Flow | Major surfaces | Network/signing boundary | Baseline concern |
| --- | --- | --- | --- |
| Create/import/restore | landing, vault form, backup flow | local key derivation/encryption | good local-only boundary; shared loading/error contract is inconsistent |
| Unlock/lock | lock screen, passkey/password, wallet shell | local encrypted storage | lock behavior is explicit; raw global errors can expose internal messages |
| Home and assets | balances, public/private assets, activity | Horizon + local private cache | several lazy surfaces have no useful local fallback |
| Send | Public/Private tabs, form, review, signing, result | local signing + Horizon/RPC | stable dialog chrome is coupled to lazy panel identity |
| Receive | Public/Private tabs, QR, request options | local address derivation | outer shell is stable, but tab semantics and lazy selectors/setup fallback are incomplete |
| Add funds/assets | Public trustline / Private deposit | local signing + Horizon/RPC | whole visible subtree swaps; focus is lost |
| Swap | form, path quote, review, result | Horizon path + local signing | transaction presentation must retain submitted versus confirmed distinction |
| Activity/details | merged public/private history | Horizon + encrypted local journal | private labeling is strong; large list and detail overlays use mixed patterns |
| Settings/security | nested settings, backup, account/network controls | local storage and browser capabilities | many dynamic surfaces and overlay patterns; needs shared contract |
| Merchant | POS, shifts, charges, tax records, customer display | local encrypted merchant store + Stellar | bespoke portals duplicate overlay behavior |

## Baseline component and interaction inventory

- 58 `<Modal>` callsites across 47 source files.
- Four dialog/portal families outside or alongside the shared Modal: Command Palette, Customer Display, Counter Poster, and Invoice Detail.
- 38 `next/dynamic` callsites. Many use `ssr: false` and omit a loading component.
- 32 `SegmentedControl` callsites. The primitive implements `role="group"` and `aria-pressed`; some usages are filters, while others switch mutually exclusive content panels and should implement tabs.
- 49 `transition-all` usages, 23 Spinner callsites, and 22 skeleton references.
- No route `loading.tsx`; loading behavior is entirely client-side.
- Shared Modal supplies a portal, accessible dialog naming, Escape, a manual focus loop, focus restoration, visual-viewport sizing, and reference-counted scroll locking.
- Shared Modal does not currently make the background application inert. Nested modal ownership is not modelled as an explicit overlay stack.
- Many parents conditionally render modal components only while `open` is true. This defeats the shared Modal's intended exit lifecycle because the owner removes the component before its internal closing state can finish.
- Shared Button replaces all content with an unlabeled spinner while loading, so accessible purpose and width can change.

## State coverage inventory

| Interaction | Idle | Hover/pressed | Focus visible | Disabled | Pending | Success | Empty | Recoverable error | Terminal/unknown |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Shared Button | yes | yes | CSS global | yes | partial | caller-owned | n/a | caller-owned | caller-owned |
| Modal | yes | backdrop/close | partial | dismissability only | caller-owned | n/a | n/a | caller-owned | caller-owned |
| Public Send | yes | yes | yes | yes | preparing/sending | confirmed/done | n/a | inline | status unknown |
| Private Send | yes | yes | yes | yes | explicit proof/submission stages | broadcast/ambiguous | n/a | inline humanized | ambiguous preserved |
| Asset/activity lists | yes | yes | yes | n/a | mixed skeleton/spinner | n/a | yes | mixed | mixed |
| Copy controls | yes | yes | yes | n/a | n/a | visible copied state | n/a | inconsistent | n/a |

Contradictory or impossible states found:

- A content tab can be selected in React state while its selected control is not rendered yet.
- A dialog can declare `aria-modal="true"` without making background content inert for pointer or accessibility-tree interaction.
- An owner can remove a Modal immediately while the Modal itself believes it owns a closing animation.
- A button can remain semantically named only by a spinner while its action is pending.
- The global error boundary can display and log raw internal error messages despite the private runtime's stricter redaction policy.

## Baseline loading inventory

| Scope | Current pattern | Finding |
| --- | --- | --- |
| Initial app | static shell plus client hydration | no hydration warning in verified Private Payments run |
| Dynamic modal | component often absent until its chunk loads | P1: input has no stable dialog-shell acknowledgement |
| Public/Private switch | whole visible subtree changes; some lazy fallbacks are `null` | P1: blank/identity discontinuity and lost focus |
| Receive QR | local skeleton preserving QR dimensions | appropriate scoped fallback |
| Private runtime | local status/stepper and cached ledger cursor | appropriate explicit work model after activation |
| Activity pagination | local spinner at sentinel | appropriate scope, but spinner needs an accessible label |
| Network refresh | card/row skeletons and spinners | inconsistent retained-content policy |

## Baseline modal and overlay inventory

The shared Modal is the correct consolidation target. Its good properties should be preserved: portal to `document.body`, accessible naming context, iOS visual viewport support, focus loop, Escape handling, and nested scroll-lock reference counting.

Required remediation:

1. Add an explicit overlay stack that makes non-overlay application content inert for the lifetime of the top-level modal while preserving nested overlays.
2. Keep owner components mounted while their `open` prop drives actual enter/exit lifetime where practical.
3. Keep dialog shell, heading, close control, and tabs outside panel lazy boundaries.
4. Add stable test hooks for shell/backdrop identity without exposing wallet data.
5. Use one centralized motion duration/easing set and respect reduced motion.
6. Keep private content unmounted until explicit intent; clear its rendered sensitive state on leaving or closing.

## Baseline motion inventory

- Global modal, menu, fade-up, spinner, and skeleton animations exist in `globals.css`.
- Reduced motion globally disables animation and reduces transition duration, which is a good baseline.
- `transition-all` is used 49 times, including selection controls and cards. It obscures which property is intended to move and can animate layout-affecting properties.
- Modal opening animation is tied to mount, but owner-level conditional rendering and lazy subtree replacement make unrelated internal changes resemble a second opening.
- No central duration/easing tokens exist; 180 ms is embedded in Modal logic and other durations are scattered.

## Baseline accessibility findings

- **P1:** Public/Private content switches use pressed-button groups rather than `tablist`/`tab`/`tabpanel`; Arrow, Home, and End behavior is absent.
- **P1:** Focus left the dialog in 10/10 measured Public→Private pointer switches because the focused control was unmounted.
- **P1:** `aria-modal="true"` is asserted while the background is not inert.
- **P1:** No regression currently proves dialog identity, backdrop continuity, scroll-lock continuity, stale-request handling, focus restoration, or private-state cleanup.
- **P2:** shared loading Button does not retain an accessible action label or stable width by contract.
- **P2:** several compact Spinner uses do not provide `role="status"` or a scoped label.
- **P2:** filters and true tabs share one component, encouraging incorrect semantics.
- Existing strengths: 44 px mobile controls are common, visible focus rules exist, modal close controls are labeled, axe covers many critical screens, iOS visual viewport behavior is tested, and global reduced-motion CSS exists.

Automated axe checks remain necessary but do not prove focus order, inertness, announcements, or meaningful keyboard workflows. Manual VoiceOver/NVDA verification remains a human release task.

## Baseline security findings relevant to UX

- Private Payments loads the proving/runtime path only after explicit user intent and stores journals in the encrypted vault.
- Private balances use incremental ledger cursors; history is not rescanned from genesis on every load.
- Public and private transaction state already differentiates accepted/broadcast, confirmed, failed, and status unknown. This must not be flattened into an optimistic success state.
- **P1:** `src/app/error.tsx` logs the raw Error object and renders `error.message`. A wallet-wide safe error presenter must redact secret keys, mnemonic-like material, private receive addresses, proof inputs, XDR where unnecessary, and internal diagnostic payloads.
- **P2:** startup storage logging passes the raw error object to `console.error`.
- Performance instrumentation must use fixed labels only; never include addresses, assets, amounts, hashes, notes, XDR, private addresses, or key material.

## Synthetic baseline

Method: local static export on `127.0.0.1`, Playwright Chromium, deterministic Horizon/RPC/price fixtures, fresh browser context and imported test-only wallet per pass, service workers blocked. Four desktop runs, four simulated iPhone 13 runs with 4× CPU slowdown plus 150 ms RTT/1.6 Mbps down/0.75 Mbps up, and two reduced-motion desktop runs. Values are lab proxies, not field Core Web Vitals.

| Interaction | Desktop median / slowest | Throttled mobile median / slowest | Reduced-motion median / slowest |
| --- | ---: | ---: | ---: |
| DOMContentLoaded | 47 / 111 ms | 3,422 / 3,647 ms | 51 / 56 ms |
| Activity local navigation | 36 / 43 ms | 60 / 71 ms | 26 / 27 ms |
| Send trigger → visible dialog | 816 / 1,003 ms | 1,651 / 1,659 ms | 804 / 804 ms |
| Private click → selected semantics | 84 / 109 ms | 535 / 969 ms | 18 / 19 ms |
| Private click → useful panel | 869 / 895 ms | 2,344 / 2,773 ms | 800 / 802 ms |

Continuity observations:

- Dialog shell DOM identity: preserved in 10/10 tab switches.
- Body scroll lock: preserved in 10/10.
- Focus inside dialog after switch: **0/10**.
- Initial modal shell misses the project's 100 ms acknowledgement target because the complete Send modal is lazy loaded.
- The mobile initial-load result is deliberately a constrained synthetic profile and must not be reported as field LCP.

## Post-remediation synthetic evidence

Method: `npm run measure:ux` against the verified local HTTPS development origin, Chromium, deterministic test-only Horizon/RPC/price fixtures, a fresh context and imported test wallet per run, and service workers blocked. Four desktop runs, four simulated iPhone 13 interaction runs with 4× CPU slowdown plus 150 ms RTT/1.6 Mbps down/0.75 Mbps up, and two reduced-motion desktop runs. Interaction throttling begins only after the wallet fixture is ready so setup noise does not pollute interaction tasks. CLS and long-task observers reset at that boundary. These remain synthetic lab proxies, not field Core Web Vitals.

| Interaction | Desktop median / slowest | Throttled mobile median / slowest | Reduced-motion median / slowest |
| --- | ---: | ---: | ---: |
| DOMContentLoaded | 38.5 / 63.1 ms | 34.8 / 36.2 ms* | 84.4 / 98.9 ms |
| Activity local navigation | 24.6 / 24.8 ms | 104.3 / 106.9 ms | 24.6 / 25.6 ms |
| Send trigger → visible dialog | 47.4 / 48.7 ms | 353.0 / 355.3 ms | 51.3 / 51.4 ms |
| Private click → selected semantics | 5.4 / 6.1 ms | 19.9 / 21.0 ms | 5.1 / 5.4 ms |
| Private click → useful panel | 99.6 / 100.9 ms | 976.5 / 985.1 ms | 92.7 / 94.7 ms |
| Interaction CLS | 0 / 0 | 0.0822 / 0.0822 | 0 / 0 |
| Longest interaction task | 0 / 0 ms | 194 / 195 ms** | 0 / 0 ms |

\* The throttled-mobile network/CPU profile starts after wallet readiness, so this local-bootstrap DCL is not comparable with the baseline's fully throttled DCL.
\** At the configured 4× CPU slowdown, 195 ms represents roughly 48.8 ms of unthrottled work. The remaining first-use task is private-module parsing/runtime initialization; it is intentionally deferred until explicit user intent rather than prefetched with sensitive functionality.

The post-remediation harness timestamps the captured browser click event. The baseline used test-driver timing around some assertions, so exact before/after deltas are directional rather than perfectly apples-to-apples. The behavioral evidence is stronger and directly comparable: 14/14 focused desktop/iPhone tests preserve the same shell/backdrop, uninterrupted scroll lock/inertness, contained focus, selected-tab semantics, sensitive-panel cleanup, and intentional focus restoration across repeated switches.

Observed outcomes:

- selected state is below 100 ms in every measured profile and does not wait for runtime work;
- desktop and reduced-motion modal-shell presentation is below 100 ms;
- throttled mobile keeps immediate trigger feedback and stable chrome while first-use private content initializes locally;
- layout shift remains below the 0.1 lab budget on all profiles;
- no address, amount, note, key, proof input, XDR, or transaction hash is included in measurement labels or output;
- no field-data claim is made because StellarKey deliberately has no telemetry or backend.

## Prioritized issues

### P0

No currently reproducible P0 loss-of-funds, secret-exposure, or transaction-finality defect was found in this audit pass. The Private Payments cryptographic lifecycle was separately repaired and passed all 11 real-testnet journeys before this audit.

### P1

| Issue | Root cause | Impact/frequency | Remediation |
| --- | --- | --- | --- |
| Critical modal shell waits on dynamic chunk | Dashboard lazy-loads whole Send/Receive/Add component | every first use, worse on mobile | static lightweight shell; lazy only panel internals; immediate pending acknowledgement |
| Public/Private discontinuity | whole heading/control/body subtree changes identity; `null` lazy fallbacks | every first Private switch | stable shared header/tabs; bounded panel fallback; retained public panel where safe |
| Focus exits modal on mode switch | focused pressed button is unmounted with the subtree | every measured switch | stable Tabs primitive and stable tab list |
| Modal background not inert | scroll lock is implemented, inert ownership is not | every modal | stack-aware inert manager with nested-overlay tests |
| Raw wallet errors can leak internals | global error boundary logs/renders raw Error | rare, high sensitivity | centralized safe error redaction and user-safe fallback |
| Missing continuity regression | existing axe/operability tests do not observe identity/scroll/focus/stale requests | every future refactor | dedicated desktop/mobile/reduced-motion/throttled test |

### P2

| Issue | Impact | Remediation |
| --- | --- | --- |
| Button loading content disappears | label/width/accessibility instability | retain hidden label or stable content, add status text/`aria-busy` |
| Filters and tabs share one semantic primitive | keyboard and SR inconsistency | add Tabs; keep SegmentedControl only for filters/modes without panels |
| Scattered motion and `transition-all` | accidental animation/layout work | semantic motion tokens and property-specific transitions |
| Owner conditional mounts bypass exit lifecycle | inconsistent closing/focus restoration | normalize high-value callsites to controlled open state |
| Spinner/skeleton conventions vary | noisy or ambiguous loading | scoped LoadingRegion/Spinner contract and accessible labels |
| Bespoke merchant portals | inconsistent focus/inert/stack behavior | migrate to overlay contract incrementally |

### P3

- Consolidate low-risk spacing/radius one-offs only when a touched shared component demonstrates a second use case.
- Add field Core Web Vitals only if a privacy-preserving, consented, backend-free collection strategy is adopted; do not add telemetry merely to satisfy a metric.
- Consider virtualization only after an observed activity-list long task; current evidence does not justify the dependency or complexity.

## Remediation status

| Baseline issue | Implemented decision | Evidence |
| --- | --- | --- |
| Whole critical dialog lazy-loaded | Send, Receive, and Add use static initial shells; private internals remain intent-gated | `e2e/public-private-continuity.spec.ts`; bundle gates |
| Public/Private visible subtree replacement | Stable shell and accessible Tabs own selection; only panel content changes | same shell/backdrop assertions across rapid switching |
| Focus exits dialog | stable tab list plus top-overlay focus ownership and WebKit pointer handling | Chromium + iPhone WebKit continuity tests |
| Background not inert | reference-counted overlay stack applies inertness and nested-overlay ownership | `e2e/overlay-contract.spec.ts` |
| Broad/raw global error | centralized safe error presenter redacts known wallet-sensitive material | `tests/safe-error.test.mjs` |
| Loading button loses purpose/width | stable content, `aria-busy`, duplicate-action suppression, scoped status | `tests/ui-loading-contract.test.mjs`; `e2e/button-loading.spec.ts` |
| Pressed groups used as content tabs | dedicated APG Tabs primitive with Arrow/Home/End behavior | `tests/ux-tabs.test.mjs` plus E2E keyboard path |
| Scattered overlay motion | central duration/easing/property tokens; reduced-motion contract | `tests/motion-contract.test.mjs` |
| Missing mobile continuity gate | focused CI runs include iPhone WebKit | `.github/workflows/ci.yml`; Playwright projects |
| Unmeasured interaction regressions | repeatable local-only multi-run harness | `scripts/measure-ux.ts` |

## Changed files and shared primitives

- Interaction primitives: `src/components/ui.tsx`, `src/lib/tabs.ts`, `src/lib/motion.ts`, `src/app/globals.css`.
- Stable critical shells: `src/components/SendModal.tsx`, `src/components/ReceiveModal.tsx`, `src/components/AddAssetModalShell.tsx`, `src/components/AddAssetModal.tsx`, `src/components/Dashboard.tsx`.
- Private panel lifecycle/accessibility: `src/features/private-balance/components/AddPrivateFunds.tsx`, `PrivateAmountField.tsx`, and `SendPrivate.tsx`.
- Safe failure presentation: `src/app/error.tsx`, `src/lib/safe-error.ts`, and startup handling in `src/hooks/useWallet.tsx`.
- Regression/performance evidence: `e2e/public-private-continuity.spec.ts`, `e2e/overlay-contract.spec.ts`, `e2e/button-loading.spec.ts`, focused unit contracts under `tests/`, `scripts/measure-ux.ts`, and Playwright/CI configuration.
- Durable standards: `docs/ux-standards.md` and the repository interaction rules in `AGENTS.md`.
- Merchant shell continuity: `src/components/MerchantRuntimeBoundary.tsx`, `src/hooks/useMerchant.tsx`, `src/lib/merchant/bootstrap.ts`, `src/lib/shell-mode.ts`, and the iPhone/multi-tab merchant regressions.

## Final verification evidence

Verification date: 2026-08-31. Release source: `9cefb86`. Environment: macOS local runner, Node/Next toolchain pinned by the repository, static production export served by Playwright, deterministic test-only wallet and network fixtures. Results are synthetic release evidence, not field telemetry.

- `npm run release:verify`: passed from a clean worktree.
- TypeScript: passed.
- Unit/domain suite: **925 passed, 0 failed**.
- ESLint: passed with no findings.
- Production dependency gate: passed at `--audit-level=high`; the separately documented Trezor dependency boundary still carries 10 low `elliptic` advisories with no upstream fix.
- Static production build: **21/21 routes** exported; **242** document-scoped CSP hashes authorized; offline shell generated.
- Bundle tests: **5/5 passed**. Gzip totals were 194,723 bytes landing, 333,485 bytes initial, 155,490 bytes unlocked, 122,999 bytes merchant, 207,586 bytes hardware, and 59,300 bytes for the Private Balance feature. Private proving artifacts remain separately intent-gated.
- Production browser matrix: **83 passed, 30 intentionally skipped, 0 failed** in 4.4 minutes across desktop Chromium, iPhone WebKit, and iPad WebKit. Skips are private-development scenarios excluded from the production manifest.
- `npm run test:e2e:private-ui`: **14/14 passed** across desktop Chromium and iPhone WebKit, including stable Send/Receive/Add shell identity, backdrop continuity, nested inertness, scroll lock, focus containment/restoration, keyboard tabs, reduced motion, and private-panel cleanup.
- Focused merchant evidence: iPhone reload/reconciliation passed in 9.4 seconds in the final matrix; the full persisted merchant journey passed in 27.1 seconds; Web Locks owner/takeover passed in 3.5 seconds.
- No hydration warning, duplicate submission, unintended dialog close, route-level loading transition, raw secret-bearing error, or bundle-budget regression was observed in the verified journeys.

Passing Playwright runs produce traces only on retry/failure, so no failing trace is retained as release evidence. The reproducible commands and named tests above are the canonical evidence references.

## Remaining work and deliberate non-changes

| Severity | Remaining item | Reason / next action |
| --- | --- | --- |
| P2 / human release check | VoiceOver on iOS/macOS and NVDA/JAWS announcement quality | automation verifies DOM semantics and focus, but must not claim human assistive-technology experience |
| P2 / incremental | lower-risk owner-conditional Modal callsites and bespoke merchant portals | critical flows are migrated; broad replacement without per-flow regression coverage would add avoidable release risk |
| P2 / performance | first-use private module/runtime task on 4× CPU profile | keep intent-gated for privacy/security; profile module parsing before considering a smaller boundary |
| P3 / measurement | field Core Web Vitals | deliberately absent because zero telemetry/no backend is a product constraint; synthetic evidence is clearly labeled |
| P3 / performance | activity-list virtualization | not implemented because current traces do not demonstrate a user-facing long-list problem |

No React, Next.js, modal, data-fetching, or animation dependency was added or upgraded. No artificial delay, blanket loader, private-data prefetch, or visual rebrand was introduced.

## Research ledger

All sources accessed 2026-08-31.

| Source | Recommendation/requirement | Application decision |
| --- | --- | --- |
| [React: Preserving and Resetting State](https://react.dev/learn/preserving-and-resetting-state) | state follows type/key/position; removing or changing identity resets state | never key or replace dialog shell because a tab changes; reset only the sensitive panel intentionally |
| [React: Suspense](https://react.dev/reference/react/Suspense) | place fallbacks around the content that may suspend; transitions can retain already revealed content | keep overlay controls outside the waiting panel; do not use a whole-dialog fallback |
| [React: useTransition](https://react.dev/reference/react/useTransition) | transitions are interruptible and prevent unwanted revealed-content fallback | use only for non-urgent expensive updates; selected tab state remains urgent/immediate |
| [Next.js: Lazy Loading](https://nextjs.org/docs/app/guides/lazy-loading) | lazy load client components and provide a loading component where useful | lazy load sensitive Private panels only after intent, with a local reserved panel fallback |
| [Next.js: Fetching Data](https://nextjs.org/docs/app/getting-started/fetching-data) | place Suspense close to uncached/runtime work rather than replacing an entire route | no route-level loader for local modal/tab work |
| [WAI-ARIA APG: Modal Dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) | background is inert; focus enters and remains within dialog; Escape closes; dialog is named | implement stack-aware inertness, focus trap/restoration, and stable close control |
| [WAI-ARIA APG: Tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) | tablist/tab/tabpanel semantics and Arrow navigation; automatic activation only without latency | add a real Tabs primitive; selected state is immediate and panel latency stays local |
| [WCAG 2.2](https://www.w3.org/TR/WCAG22/) | keyboard access, visible/unobscured focus, reflow, status messages, minimum targets, reduced motion | target AA, retain 44 px mobile targets, test narrow/zoom/focus/status behavior |
| [web.dev: Optimize INP](https://web.dev/articles/optimize-inp) | good INP is ≤200 ms at p75; reduce input delay, event work, and long tasks | enforce immediate feedback (<100 ms lab) and record tasks ≥50 ms |
| [web.dev: CLS](https://web.dev/articles/cls) | reserve space and prefer transform animation to layout properties | stable dialog panel area and transform/opacity motion only |
| [web.dev: prefers-reduced-motion](https://web.dev/articles/prefers-reduced-motion) | remove non-essential motion for users requesting it | motion tokens degrade to no spatial animation and tests repeat in reduced mode |
| [Stellar: Application Design Considerations](https://developers.stellar.org/docs/build/apps/application-design-considerations) | secret-key custody is foundational; wallets require strong TLS, including local development | preserve client-only encrypted key handling and verified HTTPS preview |
| [Stellar RPC: sendTransaction](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/sendTransaction) | `PENDING` only means enqueued; poll `getTransaction` for success/failure | never label broadcast/accepted as confirmed |
| [Stellar Horizon: Error Handling](https://developers.stellar.org/docs/data/apis/horizon/api-reference/errors/error-handling) | pending may still fail; timeout is uncertain; unchanged retry/polling is required | retain submitted/pending/status-unknown states and prevent unsafe duplicate submission |

## Phased remediation plan

1. Establish shared motion/loading/status tokens and add focused unit tests.
2. Make Modal stack-aware and inert, preserve nested overlays, expose stable non-sensitive identity hooks, and test focus/scroll restoration.
3. Add an accessible Tabs primitive; retain SegmentedControl for filters.
4. Refactor Send, Receive, and Add so their modal shell, heading, close control, and tabs are stable while only the panel changes.
5. Give lazy panels a bounded local fallback, abort/ignore stale work, and explicitly clear sensitive rendered state on leave/close.
6. Add Public/Private continuity E2E coverage across pointer, keyboard, rapid switching, reduced motion, mobile, and throttled loading.
7. Harden shared Button/loading/error presentation and transaction status copy.
8. Migrate the highest-risk duplicate overlays and `transition-all` callsites; avoid an unnecessary app rewrite.
9. Re-run the same measurement harness, full tests/build/accessibility/bundle gates, and record before/after evidence.
