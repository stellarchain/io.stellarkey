# SOTA Audit — Simple. Correct. Fast.

Audit and remediation report for StellarKey, ordered **simple → correct → fast**:
remove or clarify first, fix correctness defects second, and only then spend
complexity on measured performance.

| Field | Value |
| --- | --- |
| Date | 2026-11-06 |
| Branch | `audit/sota-simple-correct-fast` (from `main`) |
| Base commit | `a66a4771` (Merge pull request #35) |
| Application version | `1.1.0` (`package.json`, `APPLICATION_VERSION` in `src/lib/brand.ts`) |
| Runtime observed | Node.js `v26.7.0`, npm `11.19.0` |
| Status at report time | Implemented and verified locally; **uncommitted** (repo rules require separate permission to commit) |

## 1. Executive summary

The baseline was already strong: typecheck, lint, 2,081 unit tests, and the
production audit were green before any change. The defects found were therefore
**latent**, not gate failures:

1. Two network paths had **no physical deadline** and could hang the UI forever
   (`fundWithFriendbot`, `fetchAndVerifyArtifact`).
2. Six controls used `transition-all`, animating every animatable property
   instead of the ones that actually change.
3. Patch/minor dependencies lagged latest (Next.js, Stellar SDK, Tailwind CSS).

All three classes are fixed on this branch with regression tests that were
observed failing before the fix and passing after. Performance was **measured,
not assumed**: every JavaScript journey budget passes, so no speculative
refactoring was performed. Two budget headrooms are tight and recorded below
as watch items.

Method note (first principles): StellarKey is self-custodial financial
software with a static, backend-free export. Correctness of key handling,
signing, and downloads outranks speed; therefore "fast" work was restricted to
measurement and rejected where it would have added risk (see §7).

## 2. Baseline snapshot (before changes)

Commands run on clean `main` at `a66a4771`, 2026-11-06:

| Check | Command | Result |
| --- | --- | --- |
| Types | `npm run typecheck` (`tsc --noEmit`) | Pass |
| Lint | `npm run lint` (`eslint --max-warnings=0`) | Pass |
| Unit tests | `npm test` | **2,081 pass / 0 fail**, ~86 s |
| Prod audit | `npm run audit:prod` (`--omit=dev --audit-level=high`) | **0 vulnerabilities** |
| Full audit | `npm run audit:all` (`--audit-level=high`) | Exit 0; 8 **moderate**, dev-only (see §6.3) |
| Outdated | `npm outdated` | See §6 |

Codebase shape at audit time:

- `src/`: 345 files, ~83,110 lines (`src/app`, `src/components`, `src/features`,
  `src/hooks`, `src/lib`, `src/types`).
- `tests/`: 230 files; `e2e/` Playwright suites; `protocol/private-balance/`
  Rust/circuit workspace.
- Largest files (context, not findings by themselves):
  `src/hooks/useMerchant.tsx` (4,051 lines), `src/hooks/useWallet.tsx` (3,448),
  `src/components/ui.tsx` (2,800), `src/components/Dashboard.tsx` (2,796),
  `src/components/SettingsPage.tsx` (2,648), `src/lib/vault.ts` (2,011).
- Static export (`output: "export"` in `next.config.ts`), Turbopack, SRI
  experiment enabled, CSP/header and service-worker generation via
  `scripts/generate-static-headers.mjs` and `scripts/generate-service-worker.mjs`.

Clean sweeps at baseline (no action needed):

- No `TODO` / `FIXME` / `HACK` / `ts-ignore` in `src/`. The only
  `eslint-disable` occurrences are `@next/next/no-img-element` (see §7.4).
- Only 3 `console.*` call sites, all deliberate:
  `src/app/error.tsx` (sanitized diagnostic via safe-error presenter),
  `src/hooks/useWallet.tsx` (fixed storage-access message),
  `src/lib/paperwallet.ts` (popup-blocked message). No secret-bearing logging
  was found.
- `dangerouslySetInnerHTML` only in `src/app/layout.tsx`: the pre-paint theme
  script (`THEME_INIT_SCRIPT` from `src/lib/theme.ts`) and JSON-LD with `<`
  escaped to `\u003c`. No `eval` / `new Function` in `src/`.
- Viewport in `src/app/layout.tsx` permits user zoom (no `maximumScale` /
  `userScalable`); `src/app/globals.css` uses `touch-action: pan-x pan-y pinch-zoom`.
- Heavy dependencies are already lazy: `@zxcvbn-ts/*` is dynamically imported
  in `src/lib/password-strength.ts`; Trezor, merchant, and Private Payments
  code sit behind `next/dynamic` boundaries (95 `dynamic()`/`import()` call
  sites under `src/`).

## 3. Simple — remove ambiguity, animate only what changes

### 3.1 `transition-all` replaced with exact properties (fixed)

`transition: all` forces the browser to watch every animatable property and,
per `AGENTS.md` interaction rules, touched shared components must not use it.
Each site was inspected to list the properties its state classes actually
change:

| Site | State changes | Replacement |
| --- | --- | --- |
| `src/components/Onboarding.tsx:700` (saved-words checkbox) | `border-[#0A84FF] bg-[#0A84FF] text-[var(--color-oncolor)]` vs `border-white/20 bg-white/[0.05]` | `transition-colors` |
| `src/components/Onboarding.tsx:791` (mnemonic word chip) | `bg-white/5 opacity-30`, `hover:bg-white/[0.12] active:scale-95`, plus `.chip:hover` color in `src/app/globals.css` | `transition-[background-color,color,opacity,transform]` |
| `src/components/Onboarding.tsx:977` (progress dots) | `w-5` / `w-1.5`, `bg-[#30D158]` / `bg-[#0A84FF]` / `bg-white/15` | `transition-[width,background-color]` (kept `duration-300`) |
| `src/components/AddressBookPage.tsx:131` (Add Contact button) | `hover:bg-[#2492ff]`, `active:scale-90` (the `w-9`→`sm:w-auto` change is a breakpoint, not a state, and must not animate) | `transition-[background-color,transform]` |
| `src/components/AddressBookPage.tsx:300` (Send chip) | `hover:bg-[#0A84FF]/20`, `active:scale-95`, `md:opacity-0 md:group-hover:opacity-100` | `transition-[background-color,opacity,transform]` |
| `src/components/AddressBookPage.tsx:313` (favorite star) | `text-[#FFD60A]` vs `text-neutral-600 hover:text-[#FFD60A]`, opacity reveal, `active:scale-90` | `transition-[color,opacity,transform]` |

A follow-up `rg "transition-all|transition:\s*all" src/` returns no matches.
Shared primitives in `src/components/ui.tsx` already used explicit
transitions (`transition-opacity`, `transition-colors`,
`transition-[background-color,color,box-shadow]`, …) and were not modified.

### 3.2 Investigated and kept (not defects)

- **Apple touch icons.** `src/app/apple-icon.png` is byte-identical to
  `public/apple-touch-icon.png` (MD5 `02b399b4722d3f6297ec2f90be74f972`), and
  `src/app/apple-icon1.png` (152×152) / `src/app/apple-icon2.png` (167×167)
  also exist. This is deliberate: `src/app/layout.tsx` declares plain-path
  icons in `metadata.icons` because Next file-convention icons get fingerprinted
  query strings that iOS fetches unreliably; `scripts/render-app-icons.mjs`
  generates all three, `scripts/generate-service-worker.mjs` precaches
  `/apple-icon.png`, `/apple-icon1.png`, `/apple-icon2.png`, and
  `tests/app-icon.test.mjs` / `tests/browser-release.test.mjs` assert the set.
  Deleting any one file would break a tested contract for ~7 KB.
- **`.DS_Store` files** under `src/` and `public/protocol/` are untracked and
  covered by `.gitignore` (`.DS_Store`). No tracked junk found
  (`git ls-files | grep -i DS_Store` is empty).

## 4. Correct — unbounded network waits (fixed)

`AGENTS.md` requires physical deadlines on ingress. The codebase mostly
complies — `AbortSignal.timeout(8000)` in `src/lib/toml.ts`,
`MARKET_REQUEST_TIMEOUT_MS = 8_000` with `withAbortDeadline` in
`src/lib/api.ts` / `src/lib/prices.ts`, and a 15 s default in
`requestHorizonJson` (`src/lib/horizon.ts`, `timeoutMs ?? 15_000`). Two call
sites did not.

### 4.1 Friendbot funding had no abort signal and echoed unbounded errors

- **Location:** `fundWithFriendbot(publicKey, network)` in `src/lib/api.ts`
  (was line 697: `fetch(\`${cfg.friendbotUrl}?addr=…\`)` with no `init`).
- **Caller chain:** `fundFromFriendbot` callback in `src/hooks/useWallet.tsx`
  → dynamically loaded wallet API (`loadWalletApi()`) → settings "Claim 10,000
  Testnet XLM (Friendbot)" action (`handleClaimFriendbot`).
- **Failure mode:** a TCP-stalled or slow-drip friendbot
  (`NETWORKS.testnet.friendbotUrl` in `src/lib/stellar.ts`) never settles the
  promise; the pending button state never clears. On HTTP error, the entire
  response body (`res.text()`) was interpolated into the thrown `Error`
  message, which flows to user-visible error presentation.
- **Fix:** reuse the existing `withAbortDeadline(task, { timeoutMs, label })`
  helper from `src/lib/wallet-refresh.ts` — already imported by
  `src/lib/api.ts` — with `timeoutMs: 30_000` and
  `label: "Friendbot funding"`. 30 s (vs the 8 s market-read norm) because
  friendbot submits a create-account transaction and waits for a ledger close.
  The helper races the work against the deadline, so it settles even if the
  peer ignores abort ("wallet resource deadlines reject even when work ignores
  abort" is pre-existing test coverage for the helper). Error bodies are now
  `trim().slice(0, 300)` before interpolation; the success path, the testnet
  guard (`"Friendbot is only available on testnet."`), and the
  `text || res.statusText` fallback are unchanged.
- **Tests (new file `tests/friendbot.test.mjs`, 4 cases):**
  `resolves after a successful funding response`;
  `rejects on mainnet without calling fetch` (asserts `fetch` call count 0);
  `bounds the request with an abort signal` (asserts `init.signal` is an
  `AbortSignal` — **failed before the fix**: `AssertionError: fetch must
  receive an AbortSignal`);
  `truncates an oversized error body in the thrown message` (5,000-char body —
  **failed before the fix**: message was 5,026 chars).
  The function signature is unchanged, so no caller edits were needed.

### 4.2 Private Payments artifact downloads bounded bytes but not time

- **Location:** `fetchAndVerifyArtifact(url, expectedSha256, expectedByteLength?, maximumByteLength)`
  and `readArtifactResponse(res, url, maximumByteLength)` in
  `src/lib/private-balance-artifacts.ts` (was line 193:
  `fetch(url, { cache: 'reload' })` with no signal; the `reader.read()` loop
  had no deadline).
- **Caller chain:** `loadCircuitArtifacts` → `loadCachedOrFetchArtifact` /
  `loadCachedOrFetchPointCompressedArtifact` → `fetchAndVerifyArtifact`; the
  same `readArtifactResponse` also serves the content-addressed Cache Storage
  read path (`source.match(url)`, line 61).
- **Existing bounds (kept):** declared `content-length` rejected up front;
  streamed totals cancelled past `maximumByteLength`
  (`"Artifact size exceeds the …-byte limit"`); exact-length and SHA-256
  verification after download (`computeSha256`). Hash/size guarantees are
  untouched.
- **Failure mode:** a server that accepts the connection and then goes silent
  hangs artifact loading forever — including the 17 MB
  `public/protocol/private-balance/v1/circuit.zkey.pc` proving-key transport
  (25 MB expanded `circuit.zkey`).
- **Design decision — stall deadline, not total deadline:** a fixed total cap
  sized for fast networks breaks slow ones (17 MB at 1 Mbps ≈ 136 s). The fix
  bounds *no-progress* intervals instead:
  - `ARTIFACT_STALL_TIMEOUT_MS = 30_000`.
  - New internal `stallDeadline(work, stallTimeoutMs, url, onStall?)` races a
    promise against a timer, invokes `onStall` (abort/cancel) on expiry,
    rejects with `` `Artifact download timed out for ${url}` ``, swallows late
    settlement of the losing promise, and always clears its timer.
  - Fetch phase: `AbortController` signal passed to `fetch`, aborted on stall;
    the race also settles if a `fetch` implementation ignores the signal.
  - Stream phase: each `reader.read()` is raced individually; on stall the
    reader is cancelled (`reader.cancel().catch(() => {})`).
  - No-body fallback: `res.arrayBuffer()` is raced the same way.
  - `fetchAndVerifyArtifact` gains a trailing optional parameter
    `stallTimeoutMs = ARTIFACT_STALL_TIMEOUT_MS` (consistent with the existing
    optional-parameter style) solely so tests can exercise a 20 ms stall
    instead of waiting 30 s. All production callers use the default.
  - A second internal caller of `readArtifactResponse` (Cache Storage read,
    line 61) was caught by the production build's typecheck
    (`error TS2554: Expected 4 arguments, but got 3` on the first build
    attempt) and now passes `ARTIFACT_STALL_TIMEOUT_MS`. Local cache reads
    effectively never stall; the uniform bound is harmless.
- **Tests (appended to `tests/private-balance-artifacts.test.mjs`):**
  `rejects a stalled response body instead of waiting forever` (reader whose
  `read()` never resolves; `stallTimeoutMs: 20`; node:test `timeout: 5000` as
  the pre-fix bound — **before the fix both new cases failed with
  `test timed out after 5000ms`; after, they reject in ~21–23 ms with
  `/timed out/i`**);
  `rejects a stalled fetch instead of waiting forever` (`fetch` that never
  resolves).
  Pre-existing cases still pass unchanged, including
  `rejects oversized remote bodies before consuming them` and the
  content-addressed cache/dedupe case.

### 4.3 Regression-test discipline

Both fixes followed failing-test-first: the four new assertions were run
against unmodified code and observed failing (2 assertion errors, 2 test
timeouts), then re-run green after the fix
(`tests/friendbot.test.mjs` + `tests/private-balance-artifacts.test.mjs`:
11/11 pass). No existing test expectations were weakened; the only existing
test file edited for content is the changelog mirror (§6.2).

## 5. Fast — measured budgets, no speculative work

### 5.1 Fresh production measurements

`npm run build` on Next.js 16.4.5 (Turbopack), then
`node scripts/check-bundle-budget.mjs` and `npm run test:bundle` (5/5 pass).
Budgets are defined in `scripts/check-bundle-budget.mjs`
(`INITIAL_JS_*`, `LANDING_JS_*`, `JOURNEY_BUDGETS`, `PRIVATE_*`):

| Journey | Raw bytes | Raw budget | Gzip bytes | Gzip budget | Headroom |
| --- | ---: | ---: | ---: | ---: | --- |
| Landing (`index.html`, 11 chunks) | 672,002 | 700,000 | 207,354 | 215,000 | ~4% |
| Initial wallet (`app.html`, 22 chunks) | 1,189,167 | 1,350,000 | 352,850 | 360,000 | **~2% gzip** |
| Unlocked increment (8 chunks) | 706,749 | 785,000 | 164,938 | 175,000 | ~6% |
| Merchant increment (4 chunks) | 528,264 | 555,000 | 147,474 | 153,000 | ~4% |
| Hardware increment (5 chunks) | 624,875 | 1,100,000 | 127,949 | 225,000 | ~43% |
| Private feature (2 chunks) | 259,607 | 500,000 | 71,709 | 140,000 | ~49% |
| Private worker (8 chunks) | 647,314 | 1,300,000 | — | — | ~50% |
| Private artifacts | 18,014,333 raw | — | 10,914,961 | 13,000,000 | ~16% |

Largest initial chunks by gzip (hashed Turbopack names under
`out/_next/static/chunks/`): 71,519 B (229,052 raw), 45,426 B (165,451 raw),
39,520 B (112,594 raw), 21,523 B, 21,349 B. Chunk composition is already
guarded by `tests/bundle-budget.build.mjs` ("release scripts and lazy
boundaries keep optional domains out of startup"), so no eager
merchant/private/hardware code was found in the initial graph.

**Watch item F-1:** initial gzip headroom is 7,150 bytes (2%). The next
feature that lands in the wallet shell will breach
`INITIAL_JS_GZIP_BUDGET = 360_000` and force either a budget re-baseline
(with justification, as done 2026-09-07 for the shared dialog shell) or a
lazy-boundary move. Landing gzip headroom is 7,646 bytes. No change made in
this audit: shaving bytes by moving shell code behind lazy boundaries would
violate the `AGENTS.md` rule that route chrome, dialog shells, and focus
ownership stay outside lazy/Suspense boundaries.

Note: the first attempt to measure used the pre-existing `out/` directory and
failed with `ENOENT … out/_next/static/chunks/1qfec0gn15_dm.js` — a stale
export from an older build, not a code defect. All numbers above come from
fresh builds on this branch.

## 6. Dependency upgrades (the original "upgrade" request)

### 6.1 Applied

`npm outdated` at baseline, disposition per `AGENTS.md` dependency rules
(trace exact parents, test adapter conversions, never force a major to lower
audit counts):

| Package | Before | After | Notes |
| --- | --- | --- | --- |
| `next` | `16.4.2` (exact pin) | `16.4.5` | Patch; `eslint-config-next` moved in lockstep `16.4.2` → `16.4.5` |
| `@stellar/stellar-sdk` | `^17.3.0` (17.3.0 installed) | `^17.4.0` (17.4.0 installed) | Minor. The `overrides` entry pinning `@trezor/network-stellar@10.0.1` → `@stellar/stellar-sdk: 17.3.0` was moved to `17.4.0` in the same change; `npm ls @stellar/stellar-sdk` confirms one deduped 17.4.0 for both the app and `@trezor/connect-core@10.0.1` → `@trezor/network-stellar@10.0.1`. Adapter behavior is covered by `tests/hardware.test.mjs` inside `npm test` (green) |
| `tailwindcss`, `@tailwindcss/postcss` | 4.3.3 | 4.3.4 | Lockfile-only (`^4` range via `npm update`) |
| `react`, `react-dom` | 19.3.1 | 19.3.1 | Already latest; not listed by `npm outdated` |

Install evidence: `npm install` reported "added 1, removed 43, changed 6"
packages; `git status` confirmed collateral limited to `package.json` +
`package-lock.json` (213 insertions / 213 deletions — version/integrity churn
plus deduplication). Correction during release review: nested npm lockfiles and the Rust Cargo lockfile also exist; this dependency update changes only the root npm lockfile.

### 6.2 Cascades handled in the same change

- **Private Balance provenance.** `toolchainLockSha256` in
  `protocol/private-balance/scripts/generate-manifest.mjs` hashes the root
  `package-lock.json` (first input), so the dependency bump legitimately
  changed it: `12d9d97f…` → `e9937612…`. The cascade —
  `protocol/private-balance/manifests/development.json`,
  `public/protocol/private-balance/v1/manifest.json`,
  `public/protocol/private-balance/v1/catalogue.json` (`manifestSha256`
  `4b43ea4b…` → `238297e0…`),
  `src/lib/private-balance-expected-manifest.ts`
  (`EXPECTED_PRIVATE_BALANCE_MANIFEST_SHA256`), and
  `src/lib/private-balance-expected-catalogue.ts`
  (`EXPECTED_PRIVATE_BALANCE_CATALOGUE_SHA256` `ea09e723…` → `b5713df1…`) —
  was written by the sanctioned generator during
  `npm run private:check-generated` and kept as-is (never hand-edited).
  Diff inspection confirmed **only** the toolchain/manifest/catalogue hash
  chain changed; `circuit.wasm`, `circuit.zkey`, `circuit.zkey.pc`,
  `pool.wasm`, and `verification-key.json` hashes are identical, so the
  deployed Testnet pool binding is unaffected. This matches the 1.1.0
  precedent recorded in `CHANGELOG.md` ("Refresh Private Balance build
  provenance while preserving the historical deployment lock…").
  Root-cause trail: first `verify:application:core` run failed at
  `private:check-generated` with "Generated Private Balance files are stale"
  listing exactly those 5 files; after retaining the regenerated outputs,
  `npm run private:check-generated` passes ("✓ Generated Private Balance
  files are current"), including "✓ 4 proof vectors verify against the
  current Groth16 key" and "✓ All development artifacts match manifest
  development.json".
- **Changelog + exact-match mirror.** `CHANGELOG.md` `[Unreleased]` gained
  `Fixed` (friendbot deadline; artifact stall deadline) and `Changed`
  (dependency versions; transition properties) entries per release-history
  rules. `tests/changelog.test.mjs` ("the changelog starts at the approved
  1.0.0 baseline") deep-equals the entire parsed changelog, so its
  `document.releases[0]` expectation was updated to mirror the new entries
  verbatim — the repo's established pattern for every release, not a
  weakening (the test still fails on any unmirrored edit, as it did here
  first: 2,086/2,087 with exactly this one failure).

### 6.3 Deliberately not upgraded

| Package | Installed | Latest | Reason |
| --- | --- | --- | --- |
| `typescript` | 6.0.3 (`^6.0.3`) | 7.0.2 | Major; repo rule — never force a major to chase audit counts. Needs its own type-migration pass |
| `eslint` | 9.39.5 (`^9`) | 10.14.0 | Major; also the only route to clearing the 8 moderates below |
| `@types/node` | 22.20.5 (`^22.20.5`) | 26.6.6 | Major; `engines.node` is `>=22.22.2 <27` and CI pins Node 22.22.2 — types should track the CI runtime |
| `snarkjs` | 0.7.5 (exact pin) | 0.7.6 | Circuit-toolchain pin; bumping risks artifact reproducibility (`private:check-reproducible`, Gate A). Provenance hashes above assume the pinned toolchain |

**Remaining audit findings (unchanged, dev-only):** 8 moderate findings /
1 advisory — `minimatch 7.0.0–11.0.0` globparts-amplification DoS
(`GHSA-g3hv-75wg-m249`) reached via `eslint-config-next` →
`typescript-eslint` → `@typescript-eslint/typescript-estree`. Package count
(8) vs distinct advisories (1) are reported separately here per repo rules.
`npm audit fix --force` would install `eslint-config-next@15.5.29` — a
**downgrade** major — and was correctly not run. Production dependencies
(`npm run audit:prod`) remain at 0 vulnerabilities; the vulnerable code is
lint-time only and ships no browser code.

## 7. Assessed and rejected / deferred

### 7.1 React Compiler — defer to a dedicated change

Next.js 16 stabilizes `reactCompiler` (top-level option since v16.0.0;
`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/reactCompiler.md`).
It requires adding `babel-plugin-react-compiler` and re-verifying every
memoization-sensitive surface. This wallet's correctness depends on subtle
render/focus semantics (`AGENTS.md`: overlay visibility, tab selection,
request state, and animation presence modeled independently; shell/backdrop
identity; inertness/scroll-lock). Enabling a whole-program memoization
transform without a full Chromium + iPhone WebKit overlay sweep trades
correctness risk for unmeasured speed — the inverse of the requested order.
Recommendation: separate branch, `compilationMode: 'annotation'` opt-in on
hot leaf components first (e.g. dashboard rows), measured against
`scripts/measure-ux.ts` (`npm run measure:ux`) and the
`test:e2e:private-components` matrix.

### 7.2 Stricter TypeScript flags — defer

`tsconfig.json` is `strict: true` but omits `noUncheckedIndexedAccess` /
`exactOptionalPropertyTypes`. Enabling either across ~83k lines is a
migration, not an audit fix; the `as unknown as` casts found
(`src/lib/crypto.ts`, `src/lib/hd.ts`, `src/lib/backup-schema.ts`,
`src/lib/merchant/repository.ts`, …) are `ArrayBuffer`/`Uint8Array` realm
bridges and validated-payload narrowing, each adjacent to runtime checks.
No `any`-typed public surface was found in `src/`.

### 7.3 Giant-file refactors — reject for this change

`src/hooks/useMerchant.tsx` (4,051 lines), `src/hooks/useWallet.tsx` (3,448),
and `src/components/ui.tsx` (2,800) are large but heavily tested (the suite
exercises session observers, lock-during-unlock races, signing revocation,
modal identity, etc.). Splitting them is high-churn, zero-behavior-change
work with real regression risk to signing and overlay invariants. SOTA here
means keeping the proven structure and its test net intact.

### 7.4 `<img>` elements — correct as-is

12 `@next/next/no-img-element` suppressions (`src/components/AssetAvatar.tsx`,
`ReceiveModal.tsx`, `PaperWalletModal.tsx`, `AddAssetModal.tsx`,
`src/features/private-balance/components/ReceivePrivate.tsx`,
`src/components/merchant/ChargeSheet.tsx`, `InvoiceDetailModal.tsx`,
`ReceiptSheet.tsx`, `CounterPosterModal.tsx`) render QR codes and remote
asset logos as data/remote URLs. With `output: "export"` there is no image
optimizer, and generated QR data URLs gain nothing from `next/image`;
marketing imagery already uses `next/image`
(`src/components/marketing/LandingBody.tsx`, `LandingPanels.tsx`).

## 8. Verification evidence (final snapshot)

All results below are from this branch's final working tree on 2026-11-06
(Node `v26.7.0`). `verify:application:core` steps were run individually after
the provenance refresh (the composite command's first run is what surfaced
§6.2); each gate was run once per code state.

| Gate | Command | Result |
| --- | --- | --- |
| Generated files current | `npm run private:check-generated` | Pass — "✓ Generated Private Balance files are current" |
| Types | `npm run typecheck` | Pass (0 errors) |
| Unit/integration | `npm test` | **2,087 pass / 0 fail / 0 skipped** (2,081 baseline + 6 new) |
| Private protocol (browser pkg) | `npm run test:private-protocol` | 64/64 pass |
| Lint | `npm run lint` | Pass (`--max-warnings=0`) |
| Prod audit | `npm run audit:prod` | 0 vulnerabilities |
| Full audit gate | `npm run audit:all` | Exit 0 (8 moderate dev-only, §6.3) |
| E2E reporter safety | `npm run test:e2e:reporter` | 2/2 pass |
| Fixture hygiene | `npm run check:fixture-clean` (before **and** after build) | Pass both times |
| Production build | `npm run build` | Pass — 22 static routes, "Authorized 328 document-scoped inline script hashes", SW revision `0f4f9bc08b3beb9364aa` |
| Bundle budgets | `node scripts/check-bundle-budget.mjs` + `npm run test:bundle` | Pass (table in §5.1); 5/5 bundle tests |
| Focused regressions | `node --test tests/friendbot.test.mjs tests/private-balance-artifacts.test.mjs` | 11/11 pass (observed 4 failing pre-fix) |
| Changelog mirror | `node --test tests/changelog.test.mjs` | 5/5 pass after mirroring |

**Not run (explicit gaps):**

- Full Playwright matrix (`npm run verify:application:private`,
  `verify:application:production` / `playwright test`) — multi-project
  desktop + iPhone WebKit run; the touched surfaces (`Onboarding`,
  `AddressBookPage`, artifact loader, friendbot) are covered by unit tests
  and the production build, but browser-level overlay/a11y evidence for the
  transition edits was not collected in this audit.
- Rust and circuit gates (`npm run verify:private-rust`,
  `verify:private-circuits`, `verify:private-artifacts`,
  `verify:private-model`) — no Rust/circuit inputs changed; artifact hashes
  are identical (§6.2), but these remain separately required before release
  per `AGENTS.md`.
- `npm run release:verify` — requires a clean worktree by design
  (`scripts/assert-clean-release.mjs`); this branch is intentionally
  uncommitted pending review.
- Physical-device, VoiceOver/NVDA, passkey, and real Trezor checks — already
  recorded as maintainer-deferred in `CHANGELOG.md` for 1.1.0; unchanged here.

**Concurrency note:** during verification, an unrelated Playwright
private-components run on the same machine created
`src/app/private-component-fixture/page.tsx` (13:24, byte-identical to
`e2e/fixtures/private-components.tsx`, owned by
`scripts/test-private-components.mjs`). It was left untouched — no processes
killed, no files deleted — and its owner removed it on completion; the final
build and fixture-clean checks above ran after its removal. Its test outcome
belongs to that run and is not claimed here.

## 9. Change inventory

`git diff --stat` on `audit/sota-simple-correct-fast` (14 tracked files,
+342 / −233, plus 1 new test file and this report):

| File | Change |
| --- | --- |
| `src/lib/api.ts` | `fundWithFriendbot`: 30 s `withAbortDeadline` + 300-char error truncation |
| `src/lib/private-balance-artifacts.ts` | `stallDeadline` helper, `ARTIFACT_STALL_TIMEOUT_MS`, wired into fetch/stream/arrayBuffer + cache-read caller |
| `src/components/Onboarding.tsx` | 3 × `transition-all` → exact properties |
| `src/components/AddressBookPage.tsx` | 3 × `transition-all` → exact properties |
| `tests/friendbot.test.mjs` | **New** — 4 cases (success, mainnet guard, abort signal, truncation) |
| `tests/private-balance-artifacts.test.mjs` | +2 stall cases |
| `tests/changelog.test.mjs` | Mirror new `[Unreleased]` entries |
| `CHANGELOG.md` | `[Unreleased]` Fixed/Changed entries |
| `package.json` | `next`/`eslint-config-next` 16.4.5; `@stellar/stellar-sdk` ^17.4.0 + Trezor override 17.4.0 |
| `package-lock.json` | Resolved graph for the above (+ Tailwind 4.3.4) |
| `protocol/private-balance/manifests/development.json` | Regenerated `toolchainLockSha256` (sanctioned writer) |
| `public/protocol/private-balance/v1/manifest.json` | Regenerated (hash chain only) |
| `public/protocol/private-balance/v1/catalogue.json` | Regenerated `manifestSha256` |
| `src/lib/private-balance-expected-manifest.ts` | Regenerated expected hash |
| `src/lib/private-balance-expected-catalogue.ts` | Regenerated expected hash |
| `docs/audit-sota-simple-correct-fast.md` | This report |

## 10. Recommended next steps (in order)

1. **Review and commit** this branch as logical commits (deadline fixes +
   tests; transitions; dependency bump + provenance + changelog), per
   release-history rules.
2. **Run the browser gates** before merge: `npm run verify:application`
   (core + private UI/components + production Playwright), then
   `npm run release:verify` from the resulting clean tree.
3. **Watch F-1:** plan the next shell feature against the 7,150-byte initial
   gzip headroom instead of discovering the breach in `check:bundle`.
4. **Schedule separately:** React Compiler annotation-mode pilot (§7.1);
   TypeScript 7 / ESLint 10 majors (§6.3) — the latter also clears advisory
   `GHSA-g3hv-75wg-m249` from the dev chain.


