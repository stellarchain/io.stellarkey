# StellarKey UX engineering audit

## Follow-up audit — 2026-09-05

Scope: app-wide repository audit, synthetic workflow testing, and focused implementation. Baseline: `fe4e08a`; work branch: `feat/ux-continuity`. The dated 2026-08-31 report below is historical evidence, **not a statement of the current pass's verification status**. Implementation plan: [ux-implementation-2026-09-05.md](ux-implementation-2026-09-05.md).

### Current baseline and root cause

The reported Public/Private perceptual close/reopen was already repaired at this baseline. Send, Receive and Add retain the same Modal, heading, close control and Tabs outside lazy panel boundaries. The baseline continuity/overlay/catalog suite passed **15/15** on Chromium and iPhone WebKit. Historical source `17a8612` replaced complete visible descendants with a lazy Private subtree and a null fallback while the outer portal survived. This audit does not claim a new fix for a currently reproducible portal remount.

New regressions concern the next architectural layer: asynchronous results outliving their request/account, keyboard focus being confused with private activation, popup focus ownership, and inconsistent clipboard/error feedback. No new P0 loss-of-funds or secret disclosure was established by this UX pass; this is not a cryptographic or custody certification.

Environment: macOS local runner, Node 26.7.0, npm 11.19.0, Next 16.3.3, React/DOM 19.2.8, Stellar SDK 17.0.1, Tailwind 4.3.3, Playwright 1.62.1, axe 4.13.0, qrcode 1.5.4. App Router/static export, React contexts/manual fetching, custom UI and CSS motion; no additional data or animation library introduced. Relevant installed Next guides were read before edits. No Storybook-based verification is claimed.

Before application changes: `npm test` **1,382 pass / 0 fail**; lint **0 errors / 3 existing marketing-image warnings**; production build **22 exported routes / 319 CSP hashes**; bundle budgets pass. Baseline gzip bytes: landing 193,907; initial 340,019; unlocked 167,017; merchant 145,488; hardware 210,130; private runtime 70,849. Worker/artifact budgets remain separate.

### Baseline flow, component and loading inventory

Repository inventory: 329 source files, 63 Modal occurrences, 37 dynamic imports, 4 Tabs and 32 SegmentedControl occurrences, 22 Spinner occurrences, 44 `transition-all` occurrences, one Suspense boundary and no route `loading.tsx`. Counts are source occurrences, not unique screens. Shared UI supplies buttons/icon buttons, inputs, Select, Tabs, Modal, Dropdown, Tooltip, status/error and copy controls. Toast remains a separate primitive. Existing CSS centralizes modal/menu motion and reduced motion; scattered consumer transitions remain follow-up work.

| Real flow | States and loading scope | Baseline audit finding |
| --- | --- | --- |
| Create/import/unlock/recover | local form, password/signing consent, busy and inline failure; lock screen | restore-file read lacks bounded request ownership/error feedback; restore trigger is not keyboard operable |
| Home, accounts and network | retained wallet shell, account refresh and per-resource errors | ordinary resource requests already have latest-request lanes; pagination does not share their safety |
| Balances and asset details | empty/list/skeleton, local metadata requests, lazy details | whole details chunk can delay first shell; changing detail keys defeats exit continuity |
| Send / Receive / Add | stable shell, immediate local selection, private intent gate, local fallback | baseline continuity good; automatic arrow activation loads Private merely by moving focus |
| Receive request edits | reserved QR area and download action | previous request QR remains displayed until the new async encoder completes |
| Review/sign/submit | explicit approval, submission and tracked outcome | preserve existing confirmed/pending/unknown distinction and durable duplicate-submission guard |
| Activity/history | retained rows, filters, pagination sentinel, empty state | obsolete page can append after account/network changes; failed visible sentinel can retry continuously |
| Swap/batch/trustlines | quote/review/action-local pending, recoverable input, tracked result | no canonical-finality logic regression established; some accepted-state visuals still look like success |
| Settings/security/merchant | nested panels, session timeout, backup, local encrypted stores | shared Select/menu/copy defects affect multiple surfaces; bespoke overlays remain incremental work |

| Interaction | Idle / hover / pressed / focus | Disabled | Pending | Success / empty | Recoverable / terminal error | Offline |
| --- | --- | --- | --- | --- | --- | --- |
| Shared Button | supported | native disabled | stable label, busy, native pending-disable; synchronous duplicate guards are caller/domain-owned | caller-owned | caller-owned inline error | caller-owned |
| Modal/Tabs | supported; manual intent gap | option/dismiss policy | panel-local | panel-owned | panel-local | panel-owned |
| Select/Dropdown | option focus and reposition gaps | options supported | not asynchronous | selected/empty options | caller-owned | n/a |
| CopyButton/HashValue | supported | pending guard needed | missing consistent feedback | transient copied | rejected clipboard inconsistent | local permission failure |
| Activity | rows/filter supported | pagination guard | sentinel-local | rows/empty | stale/global error and automatic retry gap | resource error |
| Backup file restore | inaccessible trigger | no read guard | missing | decrypt step | unhandled read/oversize | local file only |
| Transactions | supported | domain guard | preparing → approval → submitting → pending | canonically confirmed | rejected/failed/unknown | explicit uncertainty |

Impossible combinations identified: a QR for the previous request beside the current request text; an old account page appended to a new account; an obsolete request clearing a newer loading state; clipboard permission failure with no usable feedback; focus navigation activating a private panel without activation intent. These are ownership defects, not animation-duration problems.

### Baseline priorities and implementation decisions

| Priority / effort | Root cause and frequency | User impact / remediation |
| --- | --- | --- |
| P1 / small | QR image unbound to current payload; every edit/rotation during encoding | prevent scanning/downloading stale payment instructions; bind image and download to exact current request, ignore obsolete completion |
| P1 / medium | pagination callback lacks account/network/session ownership; context switch during page read | reject stale success/error/finally, prevent duplicate calls, retain rows and require explicit retry after failure |
| P1 / small | restore file await has no local error/stale lane; rejected/oversize or abandoned read | semantic trigger, immediate local pending, fixed safe errors, cancel ownership when workflow changes |
| P1 / small | viewport and body touch CSS prohibit zoom; every affected touch session | allow user zoom and verify narrow/200% equivalent reflow; preserve 16px input floor |
| P1 / small | Settings changes subpage but inherits the previous document/main scroll offset; repeated navigation from a scrolled settings list | destination heading can be completely offscreen and a 256px-wide button has only 23.9px unobscured height beneath sticky chrome; explicit destination-owned scroll/focus initialization, no reset on data updates |
| P1 / medium | Select lacks a coherent real-focus/active-descendant model; popup outside inert owner | focus real options within owning modal portal, scoped keyboard handling and deterministic Escape/Tab |
| P2 / small | automatic tab activation for lazy/private panels | opt-in manual Arrow/Home/End focus; Enter/Space/pointer explicitly activates Private immediately |
| P2 / small | menu position updates replay initial focus | initialize focus once per opening, preserve deliberate focus during scroll/viewport changes |
| P2 / medium | duplicated copy booleans/timeouts, rejected writes and stale completion | shared narrow request-scoped feedback, generic announcements and persistent explicit sensitive clipboard Clear |
| P2 / medium | lazy complete asset/details overlays and key resets | measure first-use cost; migrate shell ownership only with per-flow coverage |
| P2 / medium | tooltip dismissal/hover and toast semantics inconsistent | follow up with shared hoverable/Escape tooltip and live inline/toast contract |
| P2 / small | abandoned import secret field and accepted-state success visuals | narrow sensitive form cleanup and neutral pending visuals; do not change canonical submission logic |
| P3 / medium | consumer motion duplication and unmeasured list scaling | remove touched `transition-all`, profile before adding virtualization or animation dependencies |

### Research ledger (accessed 2026-09-05)

| Primary source | Recommendation / requirement | Application decision |
| --- | --- | --- |
| [React identity](https://react.dev/learn/preserving-and-resetting-state) | type/key/position owns state | preserve shell identity; clear only narrowly owned sensitive panels |
| [React Transitions](https://react.dev/reference/react/useTransition), [Suspense](https://react.dev/reference/react/Suspense), [deferred values](https://react.dev/reference/react/useDeferredValue) | urgent input and deferred rendering are different; fallbacks belong near waiting content | keep selected state urgent; no deferred secret preloading or whole-modal fallback |
| [Next navigation](https://nextjs.org/docs/app/getting-started/linking-and-navigating) and installed lazy-loading/use-client/loading/viewport guides | route loading and prefetch concern navigation; client boundaries and viewport settings are explicit | keep local tabs local; no new route loader, framework upgrade or unstable API |
| [APG modal](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) | contained focus, inert background, intentional restoration | popup portal stays inside modal owner; regression observes full overlay lifetime |
| [APG tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) | automatic activation only when panels have no noticeable latency | manual keyboard activation for Private; pointer/Enter/Space still update selection immediately |
| [APG listbox](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/), [combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/) | choose one coherent focus model, selection and focus differ | retain button/listbox pattern with real option focus, stable relationships, disabled/typeahead behavior |
| [APG alert](https://www.w3.org/WAI/ARIA/apg/patterns/alert/), [WCAG 2.2](https://www.w3.org/TR/WCAG22/) | keyboard, reflow, names, status, non-obscured focus | restore user zoom; safe local failure/status announcements; human AT checks remain separate |
| [WCAG target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) and installed axe target-size implementation | target size concerns the usable, unobscured pointer area, not only CSS dimensions | investigate actual sticky-header overlap; repair Settings scroll ownership instead of enlarging an already adequately sized button |
| [web.dev vitals](https://web.dev/articles/vitals), [INP](https://web.dev/articles/optimize-inp), [animation performance](https://web.dev/articles/animations-guide) | field p75 thresholds, reduce long tasks, prefer transform/opacity | distinguish DOM-next-frame lab proxies from paint/INP/field data; no decorative animation addition |
| [Tailwind transitions](https://tailwindcss.com/docs/transition-property) | explicit transition properties and reduced-motion variants | use existing semantic motion tokens; no new animation library |
| [Clipboard writeText](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/writeText) | asynchronous write can reject | show generic local pending/error; prevent duplicate writes; never read clipboard to verify |
| [node-qrcode](https://github.com/soldair/node-qrcode#todataurltext-options-cberror-url) | QR data URL generation is asynchronous | bind completed image to its originating payload and test deferred/out-of-order completion |
| [Playwright network interception](https://playwright.dev/docs/network), [service workers](https://playwright.dev/docs/service-workers) | service-worker handling can bypass page-level request interception | controlled-delay continuity tests block service workers and hold the exact public setup-code dependency; separate PWA tests retain their service-worker coverage |
| [Stellar app design](https://developers.stellar.org/docs/build/apps/application-design-considerations), [RPC submission](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/sendTransaction) | protect key custody; PENDING is not ledger success | preserve signing/reconciliation model; no live payment, secret capture or optimistic confirmation |

### Evidence and security boundaries

The performance and new pagination fixtures run against loopback with mocked data and unknown external HTTP/WebSocket traffic blocked. Existing continuity and other legacy browser fixtures mock known endpoints; they are not a blanket external-network deny policy. Screenshots, video and traces are disabled in the UX runners. `PLAYWRIGHT_NO_COPY_PROMPT` disables teardown DOM capture, but inspection and an intentional failure proved that Playwright 1.62.1 locator matchers independently produce failure ARIA snapshots; it is **not** a complete snapshot opt-out. These tests must only run with isolated synthetic data, never a real wallet session. QR fixtures use cryptographically invalid synthetic receive strings and fixed non-payment images. No real secret, usable private address, live transaction broadcast, clipboard read or sensitive performance label is introduced. Browser-control integration was unavailable; the repository's isolated Playwright runner supplies automation. Existing matcher diagnostics are a test-tooling limitation, not permission to capture real wallet material.

QR test reference: `e2e/qr-freshness.spec.ts` witnessed stale-image failure before implementation, then passed Chromium and iPhone WebKit. Zoom policy tests first failed, then passed after removing both viewport and body CSS restrictions. The chart's pre-existing local `touch-none` remains a gesture exception; universal pinch behavior is not claimed. Human VoiceOver/NVDA and physical-device pinch checks remain release work.

The delayed-chunk Send test proves stable transport-wait and next-frame continuity, including selection changes before delivery and no late panel activation after returning to Public. It does not claim that every private-runtime asynchronous task has settled. Separate deferred QR, backup-read and pagination tests exercise stale-result ownership directly.

Measurement method and final verification results are recorded with the completion evidence for this dated pass. The historical tables below must not be reused as current before/after comparisons.

### Implemented outcomes and behavioral evidence

The audit-first, test-first workflow favored shared primitives and narrow async owners over a visual redesign. Existing 120/180/220 ms motion tokens remain authoritative; no new animation system, state library, dependency upgrade, artificial delay or private prefetch was added.

| Area | Before this pass | Verified outcome / test reference |
| --- | --- | --- |
| Public/Private continuity | current baseline already passed; keyboard focus automatically activated lazy Private; old observer missed transient remove/reinsert and unlock/relock | manual intent for Send/Receive/Add; same shell/backdrop, no entrance restart, continuous inertness/scroll lock, pointer/keyboard focus, explicit close/cleanup, repeated selection during held chunk delivery; `e2e/public-private-continuity.spec.ts`, `e2e/overlay-contract.spec.ts` |
| Shared Select/Dropdown | incoherent option focus, stale positional selection and reposition-driven focus reset | real option focus, identity-based choices, disabled/reordered/removed/empty cases, logical Tab/Escape, popup inside modal owner; `e2e/ux-primitives.spec.ts` |
| Shared clipboard controls | inconsistent rejected-write feedback and overlapping requests; sensitive Clear disappeared with transient announcement | synchronous write guard; fixed local pending/success/retryable error; no late focus movement or clipboard read; explicit Clear persists; same shared primitive tests |
| Receive QR | observed stale image beside new instructions in the deferred encoder regression | image and download match the current payload or remain unavailable in reserved space; out-of-order completion ignored; private leave/close removes rendered QR; `e2e/qr-freshness.spec.ts` |
| Backup restore | observed missing keyboard/pending/error behavior and stale workflow ownership | semantic file trigger, immediate local read state, bounded 64 MiB read, safe retry, stale success/error/finally ignored on navigation/unmount; `e2e/restore-feedback.spec.ts` |
| Older activity | owner-revocation regression failed without the new guard; failed sentinel could retry itself | account/network/endpoint/session cancellation, duplicate guard, retained rows, explicit retry, stable keyboard focus including empty filters; `tests/activity-pagination.test.mjs` (22), `e2e/activity-pagination.spec.ts` (6 browser cases) |
| Zoom/reflow | viewport/CSS blocked zoom; Send MAX contrast 4.36:1; narrow WebKit memo header overflow | user zoom permitted, existing accent contrast, wrapping captions; 640×450 equivalent reflow and 320×450 preserve shell/input/focus; `e2e/accessibility.spec.ts` and viewport contract tests |
| Settings navigation | new test reproduced destination heading entirely outside viewport; sticky header left only 23.9 px of a button usable | explicit destination-owned main/document scroll and heading focus; heading visible below sticky chrome, WCAG target-size gate passes; data edits preserve scroll/focus; `tests/settings-navigation.test.mjs` (5), Settings accessibility checks on Chromium/iPhone/iPad |
| Transaction finality | existing durable submission/reconciliation model already distinguishes accepted, pending, confirmed, failed and unknown | retained and reverified existing `tests/submission.test.mjs`, `tests/private-balance-submission.test.mjs` and mocked browser transaction flows; measurement stops at password approval and cancels before signing/broadcast |

The QR, restore, shared-control, zoom, pagination ownership and Settings changes each had a specific failing regression before the corresponding fix. Continuity was deliberately strengthened without misrepresenting its already-green baseline as a new remount repair. Independent spec/quality reviews found no remaining blocker in the changed implementation.

### Final automated verification

| Command / scope | Final result |
| --- | --- |
| `npm test` | **1,409/1,409 pass**, 31.265 s on the final repeat; baseline 1,382; +22 pagination and +5 Settings owner tests |
| `npx tsc --noEmit --incremental false` | pass |
| `npm run lint` | pass, zero errors; three unchanged marketing `<img>` warnings (`LandingBody:181`, `LandingPanels:152,359`) |
| `npm run build` | pass, 22 exported routes, 320 CSP hashes; production offline revision `36461a9393600c8d02e3` |
| `npm run test:bundle` / `npm run check:bundle` | 5/5 bundle tests and every existing budget pass; no budget raised |
| `node scripts/test-private-components.mjs` | **62/62 pass**, 53.2 s: 22 existing private-flow, 38 new shared-control, 2 new QR browser cases; isolated temporary fixture removed by runner |
| `npx playwright test --config=playwright.ux.config.ts` | **117 pass / 53 skip / 0 fail**, 4.5 min, final production matrix |
| `E2E_NEXT_DEV=1 E2E_PRIVATE_UI_REQUIRED=1 npx playwright test --config=playwright.ux.config.ts e2e/public-private-continuity.spec.ts e2e/overlay-contract.spec.ts e2e/private-manifest-security.spec.ts --project=desktop-chromium --project=iphone-webkit` | **15/15 pass**, 26.8 s; private UI mandatory, catalogue mutation fails closed |
| production Send held-chunk case, `--repeat-each=3`, Chromium/iPhone | **6/6 pass**, 16.1 s, after deterministic request interception fix |
| `git diff --check` | pass |

Browser commands explicitly unset `PRIVATE_BALANCE_E2E_SENDER_SECRET` and `PRIVATE_BALANCE_E2E_RECIPIENT_SECRET`. The 53 production skips are the existing device-only conditions, private testnet-fixture gates and synthetic-component-runner gates; component cases run separately above. No live Private Balance/testnet/cryptographic release journey was run. No screenshot-based visual-regression suite exists in this repository; behavioral geometry/focus/identity tests substitute for this pass, not for perceptual or assistive-technology certification.

Verification history matters: the first full production matrix was 116 pass / 1 fail / 53 skip and exposed the real Settings scroll/target-size defect. A later full matrix had the same counts from a nondeterministic chunk-delay test: desktop service-worker delivery bypassed interception. The test now blocks service workers only in continuity coverage and targets the fixed public setup-code dependency before navigation; PWA/offline coverage is unchanged. The final full matrix and repeated delay cases above passed. No existing failing test was removed to achieve green.

Accessibility verification includes programmatic names/relationships, manual-activation semantics, keyboard focus loops/restoration, nested inertness, uninterrupted scroll lock, live feedback and retry, normal/reduced motion, narrow reflow and non-obscured destination headings. axe includes WCAG 2.2 AA and no longer exempts restrictive viewport metadata. The automated gate rejects critical/serious findings; existing WebKit contrast exclusion remains, with Chromium supplying contrast checks. These are sampled workflow checks, not a statement that every WCAG criterion or every surface is certified. Human VoiceOver/NVDA and physical-device checks have **not** been performed.

### Changed files and durable contracts

- Production primitives/flows: `src/components/ui.tsx`, `SendModal.tsx`, `ReceiveModal.tsx`, `AddAssetModalShell.tsx`, `Dashboard.tsx`, `Onboarding.tsx`, `SettingsPage.tsx`; `src/hooks/useWallet.tsx`; `src/features/private-balance/components/ReceivePrivate.tsx`; `src/app/layout.tsx`, `src/app/globals.css`.
- New tests: `tests/activity-pagination.test.mjs`, `tests/settings-navigation.test.mjs`; `e2e/activity-pagination.spec.ts`, `restore-feedback.spec.ts`, `qr-freshness.spec.ts`, `ux-primitives.spec.ts`; `e2e/fixtures/qr-freshness.tsx`, `ux-primitives.tsx`.
- Updated test/evidence infrastructure: `e2e/public-private-continuity.spec.ts`, `accessibility.spec.ts`, `merchant.spec.ts`, `pwa.spec.ts`, `fixtures.ts`, `fixtures/private-components.tsx`; `playwright.ux.config.ts`, `playwright.private-components.config.ts`; `tests/mobile-ui.test.mjs`, `release-gate.test.mjs`, `security-policy.test.mjs`; `scripts/measure-ux.ts`.
- Documentation: this dated audit and numeric evidence, `docs/ux-implementation-2026-09-05.md`, `docs/ux-standards.md`, `docs/release-checklist.md`, `AGENTS.md`, and factual `[Unreleased]` entries in `CHANGELOG.md`. No published release entry or version changed.

The enforceable contracts in [ux-standards.md](ux-standards.md) cover overlay ownership, local loading, canonical transaction states, existing component variants, copy lifecycle, semantic tokens, information terminology, motion, accessibility and measurement. The concise additions already in `AGENTS.md` are:

1. Lazy/private Tabs use manual keyboard activation; focus alone is not private intent.
2. Bind async image/page/file results, failures and cleanup to current request/account/network/session; failed sentinels require explicit retry.
3. Keep popup portals inside the modal owner and preserve logical focus when options change.
4. Permit zoom; distinguish reflow automation from physical-device and human AT checks.
5. Destination navigation owns actual scroll/focus initialization; refreshes never replay it or focus behind a modal.
6. Disable sensitive test captures; where failure snapshots cannot be disabled, use isolated synthetic fixtures and structural diagnostics only.

### Paired production performance evidence

Method: macOS 26.5.2 (25F84), Apple M3 Max arm64, Node 26.7.0, Chromium 151.0.7922.34; production static exports of immutable baseline `fe4e08a` and the final feature application source. Desktop is 1440×900/local network; mobile is Chromium iPhone 13 emulation with 4× CPU throttling and 150 ms RTT, 1.6 Mbps down / 0.75 Mbps up applied **before navigation**; reduced motion is desktop/local with `reduce`. This is not a physical mid-tier phone or Safari performance measurement. Browser tests separately cover iPhone/iPad WebKit.

Each version has three fresh contexts per profile and cold/warm repeats in the same initialized wallet session; all samples, including the slowest, are retained. Measurements ran serially without competing browser/build work. Routing disables HTTP cache and service workers are blocked. “Cold” interaction means first use in an already initialized synthetic wallet, not cold compilation. Mocked data returns locally; endpoint RTT, remote account history, proving, ledger confirmation and an initialized private account are not measured. The public Private setup gate is measured without activating it. Activity is this app's local navigation, not a fabricated URL route.

The existing `npm start` static server streams uncompressed files over local HTTP. Consequently throttled cold-start numbers are not representative of an optimized compressed deployment. The original readiness assertion is a coarse polling upper bound; an additional three-run startup-only calibration uses a fixed public control's in-page next-frame DOM readiness (no wallet fixture). Failed setup attempts and earlier development-server timing experiments are not mixed into these paired production samples.

Interaction values are click-capture → next-rAF DOM/geometry predicates, **not presented-pixel latency or field INP**. They exclude input delay before the handler. Asset shell does not mean all metadata ready; review and preparation measure first feedback, not transaction completion. The 200-row stress profile intentionally returns an oversized first page and waits for all mounted rows, including offscreen rows; it is not a real pagination/network/scroll benchmark.

| Metric, ms: median (slowest) | Desktop before → after | Mobile 4× before → after | Reduced motion before → after |
| --- | --- | --- | --- |
| Initial document ready | 52.0 (107.8) → 47.4 (79.0) | 3626.0 (3632.1) → 3598.1 (3601.2) | 50.5 (51.1) → 47.0 (47.9) |
| Onboarding check (coarse upper bound) | 199.0 (246.9) → 187.1 (238.3) | 6533.7 (6546.0) → 7031.7 (7032.7) | 151.7 (156.5) → 150.7 (150.9) |
| Activity controls — first use | 18.2 (18.4) → 17.2 (17.8) | 13.4 (14.8) → 12.3 (14.1) | 6.8 (7.3) → 7.1 (7.7) |
| Activity controls — warm | 17.0 (17.1) → 15.9 (40.9) | 8.2 (8.7) → 6.8 (7.3) | 37.3 (40.4) → 34.9 (35.3) |
| Asset details shell — first use | 15.5 (15.6) → 14.3 (15.1) | 36.0 (39.6) → 32.2 (33.3) | 7.8 (8.1) → 8.3 (8.4) |
| Asset details shell — warm | 15.5 (15.8) → 13.8 (14.2) | 18.3 (23.7) → 20.7 (21.1) | 4.5 (6.7) → 4.0 (6.6) |
| Send shell — first use | 18.4 (18.4) → 16.9 (16.9) | 52.8 (57.7) → 48.2 (50.3) | 11.6 (12.3) → 11.5 (11.6) |
| Send shell — warm | 17.4 (45.1) → 16.1 (40.7) | 23.8 (25.2) → 22.4 (23.1) | 6.8 (10.9) → 7.3 (7.9) |
| Private selected — first use | 54.0 (54.0) → 43.0 (44.8) | 12.2 (12.7) → 12.5 (13.5) | 40.0 (40.2) → 36.8 (37.0) |
| Private selected — warm | 47.1 (52.6) → 41.8 (43.9) | 11.6 (23.1) → 11.8 (12.2) | 38.0 (38.9) → 7.3 (7.4) |
| Private setup gate — first use | 167.2 (167.9) → 130.3 (134.9) | 896.3 (902.2) → 900.0 (901.3) | 83.4 (310.2) → 78.1 (78.6) |
| Private setup gate — warm | 47.1 (52.6) → 41.8 (44.0) | 11.6 (23.1) → 11.8 (12.3) | 38.1 (38.9) → 7.3 (7.4) |
| Form review — first use | 45.6 (46.1) → 41.2 (42.2) | 21.4 (21.4) → 20.4 (21.5) | 39.7 (40.3) → 37.1 (37.5) |
| Form review — warm | 46.0 (46.2) → 41.3 (43.3) | 9.4 (22.3) → 8.3 (9.7) | 41.3 (77.7) → 37.4 (37.9) |
| Preparation feedback — first use | 44.9 (47.1) → 42.2 (42.5) | 22.7 (22.9) → 17.5 (17.7) | 7.3 (7.4) → 7.3 (7.5) |
| Preparation feedback — warm | 45.9 (46.3) → 41.9 (43.8) | 15.5 (22.4) → 15.9 (21.0) | 5.6 (38.1) → 4.1 (35.9) |

Startup calibration helps explain the apparent 6.53 → 7.03 s coarse-check difference: the same unchanged baseline itself moves to a 7.00 s polling upper bound on repeat. In-page onboarding readiness is **6,490.1 (6,537.5) → 6,518.7 (6,574.8) ms**, +28.6 ms median. Startup JavaScript is **21 resources / 1,046,375 → 1,052,546 encoded body bytes**; the server sends them uncompressed. Last JS response ends at 6,360.9 → 6,382.9 ms median. The small readiness change is consistent with the extra 6,171 bytes costing approximately 31 ms at the configured throughput; this is an inference, not a causal proof. The calibration adds its own observer and three samples, not causal attribution. No half-second application regression or cold-start improvement is claimed.

| Stress / diagnostic | Before median (slowest) | After median (slowest) |
| --- | --- | --- |
| Mobile 200 rows mounted — first use, ms | 69.3 (70.6) | 68.7 (71.2) |
| Mobile 200 rows mounted — warm, ms | 66.3 (67.7) | 69.5 (70.5) |
| Mobile 200-row session longest task, ms | 66 (67) | 67 (68) |
| Mobile 200-row session maximum Event Timing duration, ms | 104 (104) | 104 (104) |
| Desktop session maximum Event Timing duration, ms | 264 (264) | 240 (240) |
| Mobile ordinary session maximum Event Timing duration, ms | 80 (88) | 72 (80) |
| Reduced-motion session maximum Event Timing duration, ms | 176 (176) | 152 (160) |
| Mobile ordinary session longest task, ms | 64 (70) | 0 (61) |
| Non-input layout-shift sum — desktop / reduced motion | 0 / 0 | 0 / 0 |
| Non-input layout-shift sum — mobile ordinary | 0.02 (0.02) | 0.02 (0.02) |

All measured selection/shell/review/preparation DOM proxies remain below 100 ms in these samples. This **does not certify** every critical action's visible acknowledgement or field INP: desktop Event Timing still reaches 240 ms, startup remains transfer-bound in this server profile, and the 200-row stress path still includes 68 ms tasks. Aggregate Event Timing is not fully action-attributed. A value of zero means no observed entry at the configured threshold (16 ms Event Timing, 50 ms long tasks), not zero work. Unsupported observers return null. Layout-shift sums exclude recent-input shifts and use no CWV session-window calculation; they are neither canonical CLS nor proof of zero tab-induced movement. Behavioral shell identity/geometry checks provide separate continuity evidence. No field p75 LCP/INP/CLS, Lighthouse field data or universal motion smoothness is claimed.

#### Bundle accounting

| Budget / emitted code | Baseline gzip bytes | After gzip bytes | Change |
| --- | ---: | ---: | ---: |
| Landing | 193,907 | 195,180 | +1,273 |
| Initial wallet | 340,020 | 341,909 | +1,889 (+0.56%) |
| Unlocked wallet | 167,017 | 167,305 | +288 |
| Merchant | 145,488 | 145,488 | 0 |
| Hardware | 210,130 | 210,130 | 0 |
| Private feature | 70,849 | 71,138 | +289 |
| All emitted JavaScript, 119 chunks | 1,794,918 | 1,797,352 | +2,434 (+0.14%) |

The paired baseline initial gzip count differs by one byte from the first baseline build's 340,019; raw application source is identical. Total emitted raw JS is 6,124,725 → 6,132,396 bytes (+7,671). Increases cover shared focus/copy/request guards, bounded restore/pagination feedback and Settings destination ownership, including its separate lazy chunk; no dependency changed. Worker (726,087 raw bytes, 9 chunks), proving artifacts (9,424,602 raw / 6,278,239 gzip) and two-version artifact peak (18,849,204 bytes) are unchanged. The unlocked raw budget has 1,604 bytes of remaining headroom; future work must not casually expand that path. All existing budgets pass without adjustment.

#### Reproduction and numeric artifacts

Build each application version independently; copy the same evidence harness and optional fixture-ready timeout into the immutable baseline without changing its application source. Start their static exports on separate loopback ports. In each corresponding worktree run:

```sh
UX_BASE_URL=http://127.0.0.1:3192 UX_RUNS=3 npm run measure:ux
UX_BASE_URL=http://127.0.0.1:3192 UX_PROFILE=mobile-4x UX_LIST_SIZE=200 UX_RUNS=3 npm run measure:ux
UX_BASE_URL=http://127.0.0.1:3192 UX_PROFILE=mobile-4x UX_STARTUP_ONLY=1 UX_RUNS=3 npm run measure:ux
```

Repeat with port 3193 for the feature export, serially. The extra startup observer is opt-in and does not run during wallet interactions. Artifacts contain only fixed metric labels, numeric samples and public environment descriptors:

- [Baseline profiles](ux-evidence-2026-09-05-baseline.json) / [after profiles](ux-evidence-2026-09-05-after.json).
- [Baseline 200-row stress](ux-evidence-2026-09-05-baseline-list.json) / [after stress](ux-evidence-2026-09-05-after-list.json).
- [Baseline startup calibration](ux-evidence-2026-09-05-baseline-startup.json) / [after calibration](ux-evidence-2026-09-05-after-startup.json).

No screenshots, recordings or raw browser traces were retained; the test references and numeric artifacts are the reproducible evidence. This pass delivers the verified high-value changes, not complete release, accessibility or performance certification.

### Remaining issues and deliberate boundaries

| Priority / effort | Follow-up / reason not changed here |
| --- | --- |
| P2 / medium | Cold application/private-code loading and interaction long tasks need attribution and optimization under realistic devices; do not trade private-data intent for preloading. Numeric limits are detailed in the performance evidence. |
| P2 / medium | Entire lazy Asset/Transaction details shells, key resets and bespoke Merchant overlays need per-flow lifetime tests before migrating ownership; no blanket overlay rewrite. |
| P2 / medium | Tooltip hover/Escape behavior, toast live/persistence semantics and raw clipboard callers outside the two shared controls need incremental consolidation. |
| P2 / small | Narrow cleanup of abandoned Add Account import-secret fields and onboarding creation-password state remains follow-up; no new disclosure established in this pass. JS string cleanup is best-effort, not guaranteed memory zeroization. |
| P2 / small | Accepted Send/Batch checkmarks/haptics can imply confirmation despite accurate status text/model; adopt neutral pending visuals with focused receipt tests, not a submission-engine rewrite. |
| P2 / small | Human VoiceOver/NVDA, physical pinch, chart gesture exception and realistic-device motion verification remain release checks. |
| P2 / small | Playwright matcher failure ARIA snapshots cannot be fully disabled with the inspected public opt-out; never point these runners at a real wallet session. |
| P3 / medium | Remaining consumer `transition-all` and broader list scaling need profiling; no new animation dependency or virtualization was justified solely by style. |
| P3 / small | Private Receive's actual component has deferred QR browser coverage; Public Receive uses the same payload-binding rule but still needs its own direct deferred encoder browser case. |
| P3 / small | Settings Back deliberately starts at the destination top; per-subpage scroll restoration is a separate product refinement. |

No new telemetry, field-CWV claim, mainnet transaction, key-custody change, dependency upgrade or visual rebrand was introduced. Dependency advisories were not re-audited by this UX task. `release:verify`/`audit:prod` and a clean-worktree release gate were not run; no release/tag/deployment is implied. Integration remains separate: changes are in `feat/ux-continuity`, with the main checkout and its unrelated documents preserved.

---

## Archived audit — 2026-08-31

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
