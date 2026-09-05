# UX continuity and feedback implementation plan

**Goal:** Verify the current Public/Private continuity contract and correct evidenced shared-control, stale-result, QR freshness, feedback, and zoom regressions without changing wallet custody or branding.

**Architecture:** Preserve the existing controlled Modal and panel-only lazy boundaries. Repair narrowly owned async results and shared interaction primitives. Keep selected state urgent; use explicit keyboard activation for intent-gated panels. Capture only fixed-name synthetic timings and structural assertions.

**Tech stack:** React 19.2.8, Next 16.3.3 App Router/static export, Tailwind 4, custom UI/motion, React context, Stellar SDK 17.0.1, Node tests, Playwright and axe. Baseline: `fe4e08a`.

## Workflow and constraints

- Work in `.worktrees/ux-continuity`, branch `feat/ux-continuity`; preserve main's unrelated untracked documents/plans.
- User explicitly requests implementation after audit; the advisory-only default of the improve skill does not restrict this implementation. Use its evidence/prioritization format for the read-only audit.
- Repository forbids `docs/plans`; use this maintained documentation path and update existing `docs/ux-audit.md`/`docs/ux-standards.md` without erasing dated historical evidence.
- No library upgrades, new animation/data library, telemetry, real keys, live payments, private prefetching, or broad remount/reset.
- Disable screenshots, traces, video and raw error capture during synthetic wallet tests. Playwright 1.62.1 locator failures can still capture ARIA snapshots despite the teardown opt-out; restrict the runner to isolated non-usable synthetic fixtures and never a real wallet session. Unknown external requests must be blocked in new lab fixtures.
- Alternative rejected: replacing every overlay or adding a headless library would create broad risk without evidence. Alternative rejected: retaining private panels invisibly improves apparent latency by violating privacy. Chosen: incremental fixes to current owners and shared primitives, with test-first coverage.

## Phase 1 — baseline and research (before production edits)

1. Read manifest/lockfile, existing audit/standards, primitives, wallet lifecycle, recent history and bundled Next guides.
2. Run baseline Node tests, lint and production build. Baseline result: 1,382 tests pass, build passes, lint has zero errors and three existing marketing image warnings.
3. Run current Public/Private and overlay tests with capture disabled on Chromium/iPhone WebKit. Record already-fixed historical subtree/null-fallback cause separately from current regressions.
4. Consult React, bundled/current Next, WAI APG, WCAG 2.2, browser performance, Tailwind and Stellar primary sources. Record access date/application decisions in audit.
5. Correct the lab harness before comparing application versions: fixed labels, first-render acknowledgement measured in-page, cold/warm repeats, throttling before navigation, unsupported metrics marked unavailable, external fixture isolation. Preserve the same harness for before and after.

## Phase 2 — shared interaction contracts

Files: `src/components/ui.tsx`, `src/lib/tabs.ts`, Send/Receive/Add shell callsites, shared synthetic fixture/tests, `e2e/public-private-continuity.spec.ts`.

1. Add failing behavioral tests for manual intent-gated tab activation, disabled options, Select option focus/relationship, Dropdown focus surviving viewport/scroll repositioning, nested Escape and unchanged dialog ownership.
2. Add opt-in manual Tabs activation and use it for lazy Public/Private panels. Arrow/Home/End move focus only; Enter/Space/pointer activates immediately. Do not mount Private from focus alone.
3. Correct Select focus/ARIA and menu initial-focus lifecycle at the shared layer, not each caller. Keep stable IDs and explicit close behavior.
4. Cover copy success/error without focus movement, bounded duplicate requests, and persistent explicit sensitive clipboard-clear action; unify CopyButton and HashValue state only if both justify the abstraction.
5. Run focused Node and synthetic Chromium/WebKit tests; update Unreleased in each logical feature commit.

## Phase 3 — async workflow ownership

Files: `src/hooks/useWallet.tsx`, `src/components/Dashboard.tsx`, `src/components/Onboarding.tsx`, Receive panels and focused tests.

1. Add a deferred-response regression proving old activity pages cannot append after account/network/lock/refresh changes. Add duplicate-request and failure-loop tests.
2. Tie pagination to the existing generation/session owner; give pagination a local recoverable error and explicit retry instead of automatically repeating a failed sentinel request.
3. Add restore-file read failure/stale completion tests, keyboard-operable restore trigger, immediate pending and safe inline errors while preserving input.
4. Add deferred QR generation tests for payload changes and out-of-order completion. Render/download a QR only when its generated payload matches the current request; otherwise reserve image space. Never log/measure the payload. Clear private QR state on panel unmount.
5. Run focused tests, typecheck and review before committing.

## Phase 4 — zoom and evidence

Files: `src/app/layout.tsx`, viewport contract tests, `e2e/accessibility.spec.ts`, measurement script/config, audit/standards/AGENTS.

1. Add failing tests requiring user zoom; remove restrictive viewport settings and the corresponding axe exclusion. Existing tests deliberately enforcing no-zoom must be replaced with the new explicit user requirement, not silently weakened.
2. Test narrow viewport/200% equivalent reflow, keyboard/focus and reduced motion; keep brand/layout tokens unchanged unless a reproducible failure requires a narrow correction.
3. Repeat cold/warm desktop, 4x CPU/mobile and reduced-motion measurements; report median/max with samples and honest lab limitations. Include app loading/navigation, modal/tab, details, form first feedback, preparation and list rendering.
4. Run full Node/typecheck/lint/build/bundle tests, targeted and full safe browser matrix. No live testnet/full cryptographic gate is implied by these UX tests.
5. Independent spec and code review; document unresolved P2/P3 issues and human screen-reader/device checks. Commit logical changes with changelog. Do not merge/push/deploy without the next integration choice.

## Verification commands

```sh
npm test
npx tsc --noEmit --incremental false
npm run lint
npm run build
npm run test:bundle
npm run check:bundle
E2E_NEXT_DEV=1 E2E_PRIVATE_UI_REQUIRED=1 npx playwright test --config=playwright.ux.config.ts e2e/public-private-continuity.spec.ts e2e/overlay-contract.spec.ts e2e/private-manifest-security.spec.ts
node scripts/test-private-components.mjs
npx playwright test --config=playwright.ux.config.ts
```

Tests must show the specific regression before implementation and pass afterward. Update this record with actual scope, commands/results and deviations; do not claim all-app accessibility certification or field Core Web Vitals.

## Verification-driven addendum — Settings navigation

The first production matrix executed 117 tests: 116 passed and the iPad Network settings WCAG 2.2 target-size check failed (53 environment-specific/live-fixture cases skipped). Structural diagnostics showed 23.9px of usable button height under the sticky header. A new destination-heading assertion then reproduced an entirely offscreen Hardware Wallets heading before editing.

The scope was extended at the existing Settings owner: explicit entry/navigation initializes main/document scroll and heading/wrapper focus after commit; data-only renders and raw async merge/disable completions do not. Navigation intent is consumed even when superseded, tested against the actual effect body. Back deliberately starts at the destination top; per-subpage scroll restoration is deferred. No new key, route, loading layer, delay or library is introduced. Final result references belong to the dated audit evidence.

## Completion record — 2026-09-05

The prioritized implementation and automated verification are complete within the documented scope. This is not full release, field-performance or WCAG certification. See the current dated section of [ux-audit.md](ux-audit.md) for exact commands/results, six numeric evidence files, research decisions, changed-file inventory and ranked remaining work.

| Phase | Delivered |
| --- | --- |
| 1: baseline/research | repository and history inventory; immutable `fe4e08a` comparison; baseline 1,382 Node tests and 15 continuity checks; current primary-source ledger |
| 2: primitives | manual private-tab intent; real-focus/identity-safe Select; modal-owned popups and stable menu focus; shared clipboard feedback; transient overlay lifetime tests |
| 3: async ownership | payload-bound QR; bounded/cancellable backup-read ownership; session/account/network/endpoint-owned activity pagination with explicit retry and retained focus |
| 4: access/evidence | restored zoom, Send contrast/wrapping, verified Settings destination ownership; normal/reduced motion, Chromium/iPhone/iPad accessibility; production and development verification; paired cold/warm/200-row/startup calibration |

Final automated evidence: 1,409 Node tests, typecheck/lint/build/bundle checks, 62 isolated component browser cases, 117 production browser passes (53 gated skips), and 15 mandatory development continuity/catalogue checks. Tests intentionally reproduced the relevant defect before each fix; the pre-existing modal continuity repair was already green and is not credited to this pass.

Plan refinements/deviations:

- `src/lib/tabs.ts` did not need modification: the existing navigation helper could be reused by the shared Tabs activation contract.
- The unavailable in-app browser integration was replaced by the repository's isolated Playwright runners. No real wallet session, screenshots, video or trace was used. Locator-failure ARIA snapshots remain a documented tool limitation, so runners require synthetic data.
- The Settings fix was added from a newly failing WCAG 2.2 target-size/heading-visibility test. The test's later transport flake was corrected with service-worker isolation and deterministic static-chunk delivery, without changing PWA coverage.
- Production performance was rerun against the immutable baseline after correcting the evidence harness; no development compile timing or old archived measurement was reused. Startup-only calibration separates in-page readiness from coarse webdriver polling, and documents the uncompressed local preview server.
- The existing viewport tests deliberately enforced the old no-zoom policy. Their assertions were changed to the user's explicit zoom/reflow requirement, not removed to conceal a failure.
- No broad overlay rewrite, secret preloading, animation/data dependency, framework upgrade, transaction-engine rewrite, stored-data migration or brand change was justified.
- At the initial audit handoff, logical commits and integration were deferred to the integration choice. The user subsequently requested local integration: seven logical commits through `9cb6d6d` were fast-forwarded into the existing primary branch, `main`. Each behavior change includes its Unreleased notes. After fresh post-merge verification, the merged feature branch and two temporary worktrees were removed; unrelated untracked user documents remain preserved. No push, tag or deployment occurred. See the audit's local integration follow-up for exact checks and cleanup evidence.

Remaining release work includes human VoiceOver/NVDA/physical-device checks and the clean-worktree `release:verify` gate. Cold deployment loading, aggregate Event Timing/large-list long tasks, bespoke overlays and remaining P2/P3 component consistency issues are explicitly not certified by this pass.
