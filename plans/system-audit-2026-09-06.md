# System audit: simple, correct, fast

Date: 2026-09-06. Audited commit: `8397a3584f0aba37032f2146f130ba9484a494d8` (`advisor/001-revoke-stealth-discovery`).

Audit target: `/Users/admin/Documents/codegen/0x/.worktrees/revoke-stealth-discovery`, containing the latest completed privacy work. This is not the main checkout at `3e8dca7`. Findings describe the audited system; they are not all attributed to the recent privacy commits.

Read-only audit: no application, protocol, dependency, deployment or configuration changes. Only this report and the plans index were written. No live wallet was opened, no transaction was signed/submitted, and no personal data was captured. This is a vetted findings report, not an implementation-completion claim or cryptographic certification.

## Executive assessment

The system has substantial foundations worth keeping: static deployment, lazy feature boundaries, exact-money arithmetic, authenticated storage, canonical transaction reconciliation, scoped private discovery, and stable Public/Private dialog shells. A broad rewrite would add risk without addressing the main problems.

The recurring weakness is a contract that exists in one layer but is lost in another: dismissal policy stops at the backdrop; price freshness stops at the cache; revocation stops before an asynchronous repository publication; bounded replay stops before the transport library. Simplifying these ownership boundaries is the highest-value work.

In the requested order:

1. **Simple:** one authoritative policy per operation or resource, reused by its consumers. Do not remove essential validation, journal states or uncertain-outcome handling to reduce code size.
2. **Correct:** preserve genuine price age, reject stale-session publications, contain recipient-metadata failures, and make every control follow the same accessible interaction contract.
3. **Fast:** bound long-lived transport work and make cache append work proportional to the new data. Keep existing feature splitting and size budgets; do not add another data/animation framework.

No P0 defect was confirmed in this pass. There are six P1 findings below, plus the previously known dependency release blocker. Passing tests do not establish that all system behavior is correct.

## Scope and technical context

Environment: Darwin arm64, Node 26.7.0, npm 11.19.0; locked Next.js 16.3.3, React 19.2.8, TypeScript 6.0.3, Stellar SDK 17.0.1, nostr-tools 2.25.1, Playwright 1.62.1.

The app uses the App Router with a static export, client-side wallet/runtime providers, Tailwind 4, custom shared UI primitives and CSS motion. There is no application server, competing query library, or third-party modal/animation framework to replace. The private pool is Testnet-only research functionality; public wallet/merchant correctness still matters on Mainnet.

The inventory includes 325 tracked application TS/TSX/CSS files and 233 root/e2e test files. Review was boundary- and risk-weighted across the following areas, not a claim that every line or runtime state was independently verified:

| Area | Paths / flows inspected | Assessment |
| --- | --- | --- |
| Boot, routing, deployment | App Router layout, static export, lazy feature/runtime boundaries, service-worker and release tooling | Preserve existing deployment and chunk boundaries; measurement limits below |
| Wallet lifecycle | Create/import/unlock, accounts, archive/restore, session revocation, backup and hardware signer boundaries | Strong existing guards; misleading derivation preview and context-switch follow-up noted |
| Public money movement | Payment review/signing/submission, multisig, batch/claim/trustline, pending journals and reconciliation | No new acceptance-as-confirmation defect established; busy-dismissal gap confirmed |
| Wallet home / market data | Account snapshots, balances, activity pagination, chart ranges, spot/asset/fiat prices | Keep retained UI and pagination; freshness contract is incomplete |
| Merchant | Setup, settings, quotes, charges, matching, refunds, customers, loyalty, encrypted repository, concurrent writes | Quote-age and decrypted-cache lifecycle defects confirmed |
| Private protocol | Viewing authority, scanner, worker/prover boundaries, journals, public caches, relay approvals/transport, pool/root/nullifier/TTL and circuit bindings | Recipient-local failure containment and scaling gaps; no new contract-accounting defect confirmed |
| UI and accessibility | Shared Modal/Header, Tabs, Select/Field, Toggle, Tooltip, Toast, busy and error paths | Stable modal shells already implemented; remaining shared-contract gaps below |
| Quality and operations | Root/nested tests, CI, release commands, dependency audit, bundle budgets, documentation | Required isolated tests omitted from ordinary gates; sensitive capture policy inconsistent |

Large files alone are not findings. `Dashboard`, `useWallet`, `useMerchant`, the private provider and `ui.tsx` are maintenance hotspots, but splitting them by arbitrary line counts would not fix the demonstrated defects. Extract only a proven ownership boundary with characterization tests.

## Vetted findings

P1 = high-impact correctness/security or release-verification gap; P2 = important reliability, accessibility or scale issue. Effort: S = localized change and focused tests; M = coordinated boundary change and behavioral tests; L = migration/redesign. Risk describes the proposed fix, not just the existing defect. All twelve findings have high confidence in the stated source-level behavior; runtime and exploit limits are stated individually.

| ID | Finding | Priority / category | Impact | Effort / fix risk | Primary evidence |
| --- | --- | --- | --- | --- | --- |
| F01 | Normal gates omit isolated browser and nested protocol suites | P1 / verification, simplicity | Future regressions can escape a nominally complete gate | M / low–medium | `package.json:36`, `.github/workflows/ci.yml:84`, `scripts/test-private-components.mjs:18` |
| F02 | Default browser diagnostics can retain sensitive wallet state | P1 / test privacy | Failed private/live-fixture tests can leave secret-bearing artifacts | S / low | `playwright.config.ts:23`, `protocol/private-balance/scripts/run-testnet-e2e.mjs:176` |
| F03 | Cached market values are promoted to fresh merchant quotes | P1 / money correctness | Stale exchange rates can change the amount requested at checkout | M / medium | `src/lib/prices.ts:64`, `src/hooks/useMerchant.tsx:1627` |
| F04 | A late merchant load can resurrect a cleared plaintext snapshot | P1 / lifecycle, privacy | Decrypted merchant records can outlive lock/disposal intent | M / medium | `src/lib/merchant/repository.ts:355`, `src/lib/merchant/repository.ts:493` |
| F05 | Header/alternate navigation bypass modal busy-dismissal rules | P1 / interaction correctness | Progress disappears while work continues; old completion can close a new dialog | M / medium | `src/components/ClaimableBalancesModal.tsx:200`, `src/components/AddAccountModal.tsx:134` |
| F06 | Recipient-local asset metadata mismatch stops the whole private scan | P1 / private availability | A malformed recipient envelope can repeatedly block canonical recovery | M / medium | `src/features/private-balance/runtime/scanner.ts:305` |
| F07 | Recoverable merchant errors rely on transient, unannounced toasts | P2 / accessible error recovery | Error text is truncated, disappears and lacks live announcement | S–M / low | `src/components/Toast.tsx:42`, `src/components/merchant/CustomerDetailModal.tsx:159` |
| F08 | Shared input/help accessibility contracts break at composition boundaries | P2 / accessibility, simplicity | Generic switch names, disconnected Select hints/errors, inaccessible tooltip behavior | S–M / low | `src/components/ui.tsx:649`, `src/components/ui.tsx:1555`, `src/components/ui.tsx:1637` |
| F09 | Add Account guesses an incorrect derivation path | P2 / content correctness | Import and mixed/archived accounts show misleading recovery metadata | S / low | `src/components/AddAccountModal.tsx:126`, `src/lib/vault.ts:1045` |
| F10 | Nostr keeps unbounded upstream event-ID state | P2 / availability, performance | Long-lived helpers accumulate memory before application replay filtering | M / medium | `src/features/private-balance/relay/nostr.ts:261`, installed `nostr-tools/lib/esm/abstract-pool.js:798` |
| F11 | Verified commitment appends repeatedly reload all history | P2 / performance | Recovery cache I/O and decoding grow quadratically with batch count | M / medium | `src/features/private-balance/runtime/public-cache.ts:133`, `:164` |
| F12 | Successful chart series remain cached indefinitely | P2 / data correctness | A long-running wallet can show an old chart next to an updated spot price | S–M / low–medium | `src/hooks/useWallet.tsx:1069`, `src/hooks/useWallet.tsx:2737` |

### F01 — One complete verification entry point

The root unit command does not run the nested browser-protocol package's 58-test suite. Its build during generated-artifact checks is not equivalent to running those tests. The isolated component suite requires `PRIVATE_COMPONENT_FIXTURE_SHA256`, which is supplied by `scripts/test-private-components.mjs:18`. Ordinary CI and `release:verify` do not invoke that runner. The separate `test:e2e:private-ui` command selects three overlay/manifest files, not the five isolated fixture suites.

A fresh collection-only check of the base Playwright configuration listed 219 cases. All 87 desktop cases in `private-components`, `ux-primitives`, `qr-freshness`, `relay-earn` and `relay-startup` were marked skipped; their 87 iPhone counterparts were excluded by the base project's file filter. Thus the separately verified 174-case suite is absent from ordinary CI/release execution. Another 15 live private cases deliberately require Testnet credentials; that opt-in behavior is correct and must remain.

Smallest remedy: make the safe isolated runner and nested protocol tests explicit in a shared verification command used by CI and release. Run fixture creation/cleanup before the final production build, verify the fixture route is absent afterwards, and assert the required suites execute rather than silently skip. Preserve separate Rust/circuit gates and explicitly opt-in live deployment tests. Dependency-audit failure currently blocks the ordinary pipeline before later browser steps; fixing that blocker alone will not fix this coverage gap.

Required regression: command-level test of suite inclusion, expected projects and cleanup, plus a real successful run with nonzero required test counts. Do not merely change skip flags or publish the fixture route.

### F02 — Make private-safe diagnostics the default

`playwright.config.ts:23` enables `retain-on-failure` traces and failure screenshots. The isolated component configuration correctly overrides trace/screenshot/video to off, but the Testnet fixture runner invokes the base configuration after supplying generated, funded Testnet signer secrets. `e2e/private-balance/helpers.ts:42` imports those secrets through the UI. Traces can contain action inputs, DOM snapshots and request bodies, not just pictures. Even disposable Testnet credentials and private transaction material are outside the repository's permitted capture policy.

Smallest remedy: sensitive wallet journeys must inherit trace/screenshot/video-off settings. Restrict richer diagnostics to explicitly non-sensitive public-page tests if still needed. Inspect reporter/locator failure output too: turning off video does not prevent textual ARIA snapshots. Keep structural counts/status-only assertions and fixed non-usable fixtures. No secret-capturing reproduction was run for this audit.

Required regression: configuration tests for every private/live entry point and a controlled failure using non-sensitive sentinel data to verify diagnostics do not retain it. Do not archive real wallet data to prove the risk.

### F03 — Preserve genuine market observation time

`fetchAssetPrices` and `fetchFiatRates` return cached values on HTTP/error paths without exposing their original observation time (`prices.ts:64`, `:71`, `:97`, `:108`). `useMerchant.tsx:1627` and `:1637` stamp any nonempty returned asset map with `Date.now()`. The five-minute gate at `:1670` therefore sees old cached prices as newly observed. It applies only to non-native asset prices; retained XLM and FX values also lack equivalent age enforcement. `useWallet.tsx:1083` retains the previous XLM price when a refresh returns null. These values flow into `rateFor`, quote inputs and charge construction, not just decorative portfolio estimates.

Reproduction: with process-local synthetic responses, fetch once, advance the clock 60 minutes, then return HTTP 503 for both price endpoints. Both functions returned the old values as ordinary successful results with no freshness metadata. No network request or checkout transaction was made.

Smallest remedy: one market-result contract carrying value, genuine fetched/observed time and fresh/stale/unavailable status, consumed consistently for asset, XLM and FX inputs. Retain safe display estimates with honest age/status, but reject a new Mainnet quote when any required input exceeds its permitted age. Never reset age because a cache value was read. Preserve the cart/form and offer retry. Keep deliberate Testnet quote semantics separate.

Required regression: expiry, cache-hit, outage, mixed fresh/stale inputs, missing FX, native XLM, issuer/network separation, quote rounding and recovery without lost cart contents.

### F04 — Merchant cache publication needs revocable ownership

`MerchantRepository.clearDecryptedSnapshot()` only sets the cache to null. `load()` awaits driver reads, then `decodeRecordSet()` installs a plaintext snapshot (`repository.ts:472`). A load started before clearing can therefore restore it afterwards. `loadCommitBasis()` then trusts matching metadata and returns the snapshot without an independent current-session check (`:529`). The repository is a module singleton (`:680`).

The hook clears on unmount/lock (`useMerchant.tsx:754`, `:839`), but the initial effect's `alive` check occurs after repository publication (`:873`). External reload and commit continuations also publish after awaits (`:815`, `:1021`) without a shared originating-generation boundary. Existing key-buffer cleanup does not revoke the pending work.

Reproduction: delay an in-memory driver read, clear the snapshot, then release the read. A subsequent metadata-cache lookup can return the resurrected snapshot; clearing again makes an unrelated-key lookup fail authentication. The unrelated key is a synthetic observer of cache use, not a demonstrated signing/authentication exploit. The established defect is plaintext retention/lifetime, not loss of encrypted-store integrity.

Smallest remedy: a repository generation/session fence invalidated synchronously on clear/disposal, checked before every cache publication and after each asynchronous boundary; matching hook publication guards. Apply the rule to load, metadata reseal and commit results. Preserve already-consented durable writes and transaction journals; do not pretend a completed storage commit can be revoked.

Required regression: deferred load/reload/reseal/commit completing after lock, unmount, reset or replacement session; old errors must not contaminate the new session, and cross-tab conflict protections must remain intact.

### F05 — One close policy for every exit path

`Modal` uses `dismissable` for Escape/backdrop, while `ModalHeader` has an independent `closeDisabled` defaulting to false (`ui.tsx:379`, `:465`). Claimable Balances and Add Account pass `dismissable={!busy}` but leave the header close callback enabled. Claimable Balances additionally permits the Add trusted asset handoff (`:389`) and Done path (`:410`); its confirmed continuation calls the old `onClose` after awaits (`:181`). `Dashboard.tsx:3359` conditionally mounts that dialog, so old work and a replacement modal can coexist.

The code establishes the inconsistent dismissal paths. A deferred browser reproduction of close/reopen is still required; duplicate ledger execution was not demonstrated and is not claimed.

Smallest remedy: one guarded close/leave handler per operation, consistently supplied to the shell, header, footer and handoffs. Use the existing `closeDisabled` prop. Bind completion to the originating dialog session. Permit cancellation where the underlying preparation is cancellable; once submission cannot be cancelled, retain clear status without claiming that closing revoked the transaction.

Required regression: deferred mutation, all close controls, alternate navigation, immediate reopen, old completion, keyboard/focus restoration and mobile behavior. Retain the already-correct Public/Private shell identity.

### F06 — Separate envelope-local invalid data from canonical corruption

The scanner throws out of the whole bounded envelope map when an opened note's plaintext asset index differs from the authenticated registry candidate (`scanner.ts:305`). The recipient opener authenticates the commitment using the candidate's asset field, owner, value and rho, but returns the encoded index separately (`packages/browser/src/encryption.ts:308`). The note commitment circuit binds `assetField`, not that duplicate encoded index (`circuits/circom/note.circom:5`). A sender can create inconsistent recipient metadata even when the commitment itself matches the authenticated asset.

A synthetic existing scanner fixture passed normally, then failed the entire scan when only that envelope metadata index changed. No new proof was generated or accepted on-chain. The demonstrated client behavior, combined with the source binding, supports the availability finding; it is not a live-chain exploit test. A foreground failure clears current private state into safe-error (`runtime/provider.tsx:1141`); background retries keep the last state but do not progress past the offending record.

Smallest remedy: explicitly classify recipient-local metadata failures separately from archive/root/nullifier corruption. Decide whether to reject/quarantine that envelope or normalize a redundant field from the authenticated registry; preserve authenticated commitment and asset checks. Continue processing unaffected valid outputs only when doing so preserves canonical accounting. Never solve this by ignoring transcript failures or releasing shared-proof reservations.

Required regression: mixed valid/malformed outputs, later valid actions, canonical cursor progress, outgoing recovery and balance integrity, alongside existing fail-closed transcript/root/registry cases.

### F07 — Error recovery must stay in context

Toast messages expire after 4.2 seconds, render as one truncated line and have no live-region/status semantics (`Toast.tsx:42`, `:53`, `:85`). Customer note/contact/loyalty mutations and counter-code toggles report failures only through these messages (`CustomerDetailModal.tsx:159`, `PaymentLinksPage.tsx:123`). Some recoverable problems therefore disappear before the user can understand or act on them, and screen readers are not reliably notified.

Smallest remedy: accessible shared status announcements for supplementary messages, persistent inline errors for actionable failures, and retained input plus retry. Avoid announcing the same error twice. Do not pass raw sensitive payloads into toast/error reporters. Replace the touched toast's `transition-all` with only the properties it needs; no visual rebrand or extra animation.

Required regression: failed save/toggle, long message, retry, input retention, screen-reader status semantics and focus remaining on the relevant action. Human screen-reader verification remains necessary.

### F08 — Finish existing shared accessibility contracts

- **Switch names:** Toggle's optional label falls back to “Toggle” (`ui.tsx:1637`, `:1654`). The Privacy and Sound switches omit it (`SettingsPage.tsx:1000`, `:1009`); their visible sibling captions are not a programmatic relationship. Require a meaningful name and update actual callers.
- **Field/Select composition:** Field clones `id`, `aria-describedby` and `aria-invalid` onto its child (`ui.tsx:1571`), but Select neither accepts nor forwards these props to its trigger (`:649`, `:793`). Category/tax/staff selects use this composition (`ItemEditorModal.tsx:248`, `:312`; `LinkEditorModal.tsx:418`). Their explicit `ariaLabel` remains, so these are not entirely unnamed controls; the visible label/hint/error relationships are broken. Forward the narrow supported native relationships and test the rendered composition.
- **Tooltips:** the shared tooltip is pointer-events-none, closes immediately on trigger pointer-leave, and has no Escape dismissal (`ui.tsx:102`, `:114`). Keep it hoverable across trigger/content and dismissible without moving focus, while preserving appropriate focus/blur behavior. Do not add artificial dwell time as a substitute for correct ownership.

Required regression: meaningful accessible switch names, label activation, Select description/error association, tooltip hover transfer and Escape dismissal while trigger focus remains. Axe alone will not catch every behavior above.

### F09 — Do not invent derivation metadata

Add Account displays `accounts.length` as the derivation index for both generate and import modes (`AddAccountModal.tsx:126`). The vault instead chooses one greater than the maximum derived index across active and archived accounts (`vault.ts:1045`); imports do not use that derivation path.

Smallest remedy: remove the guessed pre-creation path and use accurate mode-specific wording; display authoritative account metadata when available. Do not derive or expose keys merely to preview a subtitle. Test mixed imported/derived/watch accounts, archived derived accounts and import mode.

### F10 — Bound the transport layer, not only the application queue

`NostrPrivateRelayAdapter` uses `AbstractSimplePool.subscribeMany` (`nostr.ts:261`). The installed pool creates an uncapped `_knownIds` Set per subscription and adds every observed ID (`node_modules/nostr-tools/lib/esm/abstract-pool.js:798`, `:823`). The relay invokes that handler before JSON parsing and event filter/signature validation (`abstract-relay.js:456`). Application replay filtering happens later (`relay/session.ts:178`), so its 512-entry bound does not bound the upstream collection. The custom WebSocket wrapper bounds connection time, not incoming message size.

Socket-free reproduction: the actual pool retained all 1,200 injected synthetic IDs, exceeding the application's replay capacity. Absence of an upstream cap is established by source inspection; the finite test is not a heap benchmark. Oversized input also reaches parsing before an application envelope limit can help.

Smallest remedy: bounded deduplication and incoming frame/structure checks at the earliest controllable transport boundary, preserving signature validation, reconnect semantics and once-per-quote/submission guards. Merely pruning the application replay cache is insufficient. Choose a scoped adapter solution or justified upstream change, not a blind upgrade or replacement relay network.

Required regression: sustained unique/duplicate/invalid traffic, oversized inputs, cap/eviction behavior, reconnect, cancellation and duplicate approval/submission prevention. Measure long-session memory and main-thread work without recording payloads.

### F11 — Make cache append work proportional to the append

`recordVerifiedPrivateBalanceCommitments` loads/decodes the complete retained cache (`public-cache.ts:164`), then each `storePrivateBalanceCommitmentChunk` does so again (`:133`). `loadPrivateBalanceCommitments` reads the whole prefix and decodes each chunk's commitments during validation and again during reconstruction (`:102`). Recovery calls this per batch (`runtime/sync-machine.ts:475`).

An in-memory driver counting returned historical chunk records measured 90 / 380 / 1,560 reads for 10 / 20 / 40 one-chunk appends: `n × (n − 1)`. This is an algorithmic work-count proxy, not measured IndexedDB latency, proof time or user INP.

Smallest remedy: an atomically checked append checkpoint/range operation, reading only the overlap that must be verified. Retain complete validation for rebuild and corruption recovery. Preserve contiguous ordering, authenticated overlap, concurrent-writer conflict detection and fail-closed behavior; do not introduce an unverified counter merely for speed.

Required regression: linear/bounded record-read counts, gaps, overlaps, duplicate ranges, cross-tab races, corruption and recovery producing unchanged roots. Benchmark real IndexedDB separately after correctness is established.

### F12 — Retained chart content still needs expiry

Once a range is cached, both periodic refresh and range selection reuse its series without expiry (`useWallet.tsx:1069`, `:2737`). Successful spot-price refresh does not refresh the already-cached chart. Retention is desirable; indefinite freshness is not.

Smallest remedy: timestamp chart entries, retain correctly labelled content while revalidating after an appropriate age, and preserve the existing request lane's stale-result protection. Reuse F03's freshness principles rather than inventing another timing system. Test repeated refresh, expired range revisit, out-of-order results and recoverable errors without chart blanking.

## Known blockers and documentation drift

These are not newly introduced by the audited privacy changes:

- **K01 — P1, medium / dependency-dependent:** fresh `npm run audit:prod` fails with 13 transitive findings (8 low, 5 high), including `toml` through Trezor's older nested Stellar SDK and `elliptic`. npm reports no available automatic fix for the affected paths. The root Stellar SDK is 17.0.1; do not conflate it with the older nested dependency. Reachability and exploitation in this wallet were not established. Review the actual adapter/dependency graph and upstream fixes before release; do not force-upgrade, waive the gate or silently remove hardware support.
- **K02 — P2, small / low risk:** `README.md:207` still describes ten low-only findings, and `:213` says pinch zoom is disabled although current `src/app/layout.tsx:76` permits it. `docs/testing.md:28` describes an empty deployment catalogue although the current release includes a published Testnet entry. Reconcile docs with checked configuration/evidence; do not modify deployment state to match stale prose.

## Investigate before proposing a fix

**Public signing context switches — medium confidence, potentially important.** Send validates the reviewed account/network before starting (`SendModal.tsx:635`) but does not supply the optional `authorizeBeforeSigning` callback (`:654`). `useWallet.tsx:740` awaits approval with a captured account; account/network switches update refresh state rather than revoking that captured signing context (`:1961`, `:2255`). The global command palette can offer those switches (`Dashboard.tsx:899`, `:1425`, `:1449`). A deferred approval/browser test must determine whether a user can actually switch context at that stage and whether the old reviewed operation then continues. This is not a confirmed unauthorized-spend finding. Existing vault lock revocation must not be confused with account-selection policy.

## Verification and quantitative evidence

All fresh diagnostics used synthetic/in-memory data or dependency/build metadata. No browser was launched during this audit. Root tests ran without a production build, dependency install or source edit.

| Fresh command / diagnostic | Result | Interpretation |
| --- | --- | --- |
| `npm test` | 1,465 passed, 0 failed, 0 skipped; 91.91 s | Existing root unit suite, not all nested/browser/contract tests |
| `npm run typecheck` | Exit 0 | No type errors |
| `npm run lint` | Exit 0; 0 errors, 3 existing marketing `no-img-element` warnings | Not a zero-warning claim; no formatter applied |
| `npm run audit:prod` | Exit 1; 13 findings, 8 low / 5 high | Release-blocking, not waived |
| `npm run check:bundle` | Exit 0, unchanged budgets | Checked existing same-source export, not a fresh build |
| Playwright `test --list --reporter=json`, counts only | 219 listed; 87 isolated desktop cases skipped; 87 isolated iPhone counterparts excluded | Collection diagnostic only; no browser/server execution |
| Deferred merchant repository load | Cleared snapshot restored after delayed read | Reproduced directly against repository with synthetic driver |
| Market outage with clock advanced 60 min | Old asset/FX values returned without age/status | Reproduced against actual fetch/cache functions with process-local mocks |
| Recipient metadata fixture | Valid baseline passed; inconsistent envelope stopped scan | In-memory scanner diagnostic; no proof/chain test |
| Socket-free actual Nostr pool | All 1,200 IDs still remembered | More than app replay bound; no heap/liveness measurement |
| Counted commitment appends | 10/20/40 batches → 90/380/1,560 historical records returned | Quadratic work count, not end-to-end timing |

The public-wallet/merchant reviewer additionally ran 137 selected money/security/refund/matching/commit/storage/submission tests successfully; these overlap the root suite and are not added to its total. Synthetic diagnostics were terminal-only probes, not newly committed regression tests. Their scenarios above are the requirements for durable tests when findings are selected for implementation.

An initial focused-test command referenced nonexistent test filenames and ran no tests; it was superseded by the actual full root command. No failing application test was hidden or weakened.

### Existing build sizes checked again

These are journey graph sizes; graphs can overlap and must not be summed. No before/after speedup exists because this turn made no application change.

| Boundary | Raw bytes | Gzip bytes |
| --- | ---: | ---: |
| Landing | 634,266 | 195,198 |
| Initial wallet | 1,166,222 | 342,308 |
| Unlocked wallet | 763,398 | 167,306 |
| Merchant | 534,646 | 145,488 |
| Hardware | 1,047,493 | 210,130 |
| Private feature | 270,471 | 72,885 |
| Private worker | 759,006 | Not separately recorded |
| Protocol artifacts | 9,424,602 | 6,278,239 |

The unlocked raw budget has only 1,602 bytes of headroom. This is a watchlist item, not proof that the current UI is slow. Two-version artifact cache peak remains 18,849,204 bytes. Do not relax budgets to hide future additions.

### Prior evidence, not rerun this audit

The same-source implementation record in [README.md](README.md#final-verification--2026-09-06) includes 58 protocol tests, 174 isolated browser cases and 16 overlay/manifest cases, fresh build/generated-artifact checks, and five bundle tests. It documents Chromium/iPhone WebKit, overlay identity, focus/inertness, reduced motion and automated axe checks. Those completed results are retained evidence, not new audit runs or coverage for the newly identified cases.

Prior warm local lab proxies: five samples per interaction, DOM acknowledgement plus two animation frames; Chromium at 4× CPU and iPhone WebKit emulation, unthrottled local networking. Modal median/slowest: Chromium 44/51 ms, WebKit 41/50 ms; start feedback: 62/74 ms and 20/24 ms respectively. The earlier record also discloses a concurrent-run 103 ms failure and a server-startup failure before serial verification passed. These are not cold-load measurements, real-device testing, field Core Web Vitals or evidence of a new optimization.

## Research ledger

All sources accessed 2026-09-06. Guidance informs the audit; application conclusions depend on the cited code and diagnostics.

| Authoritative source | Recommendation / application decision |
| --- | --- |
| [React: Choosing the state structure](https://react.dev/learn/choosing-the-state-structure) | Avoid contradictory/duplicated state; use one authoritative dismissal, freshness and lifecycle policy rather than more booleans |
| [React: useContext](https://react.dev/reference/react/useContext) | Context consumers update when provider values change; preserve existing context partitioning and measure before broad provider rewrites |
| Installed Next.js `node_modules/next/dist/docs/01-app/02-guides/static-exports.md` | Match this installed version's static-export constraints; do not suggest server-only caching as a drop-in wallet solution |
| [WAI-ARIA APG: Modal dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) | Consistent focus/close behavior; keep stable modal ownership and test every exit path |
| [WAI-ARIA APG: Switch](https://www.w3.org/WAI/ARIA/apg/patterns/switch/) | Switches require meaningful accessible labels, not a generic fallback |
| [WCAG 2.2: Status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) | Programmatically expose status without moving focus; persistent actionable errors remain local |
| [WCAG 2.2: Content on hover or focus](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html) | Additional content must satisfy applicable dismissible, hoverable and persistent behavior; repair shared Tooltip |
| [web.dev: Web Vitals](https://web.dev/articles/vitals) | Field p75 targets: LCP ≤2.5 s, INP ≤200 ms, CLS ≤0.1; do not present unit duration, bundle size or local paint proxies as those measurements |
| [Stellar RPC: sendTransaction](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/sendTransaction) | Submission response is not ledger finality; retain canonical reconciliation and status-unknown behavior |
| [Playwright: Trace viewer](https://playwright.dev/docs/trace-viewer) | Traces contain action/DOM/network information; failure retention is not a safe privacy default |
| Installed nostr-tools 2.25.1 `abstract-pool.js` / `abstract-relay.js` | Verify the actual pre-validation bookkeeping rather than assuming the app's replay limit bounds the library |

## Considered and rejected

- **Public/Private tab remount as a current defect:** stable shells, local/manual tabs, focus/inertness and sensitive-panel lifecycle already exist with prior browser evidence. Do not redesign or reopen this fixed issue without a new reproduction.
- **Release inputs after shared-proof timeout/cancel:** rejected. Shared proof authority cannot be revoked by local cancellation or envelope expiry; unresolved reservations are intentional safety behavior.
- **RPC/Horizon acceptance automatically shown as confirmation everywhere:** not supported by the reviewed submission/reconciliation paths. Retain explicit canonical outcomes.
- **Missing pre-broadcast journals, issuer-blind merchant matching, optimistic refund settlement, unauthenticated backups or basic stale-writer overwrite:** not established in the reviewed paths; existing guards/tests contradict these broad claims.
- **Contract root/nullifier TTL handling necessarily broken:** not established. Explicit checks/retention exist; no new contract-accounting defect was confirmed. This is not a formal proof or live TTL drill.
- **Replace contexts/query stack, rewrite large files, add animation tooling or rebrand the home screen:** no measured justification. Fix demonstrated ownership contracts first.
- **Price charts must be blanked while refreshing:** rejected. Correctly labelled retained content is useful; add honest expiry/revalidation instead.

## Recommended sequence and optional direction

Start with five bounded workstreams, after selecting findings for implementation:

1. **Safe, complete verification** — F02 before F01. Protect diagnostics first, then wire the existing suites into the gate. Preserve opt-in live tests.
2. **Market freshness** — F03, with F12 as a closely related follow-up. Characterize money/rounding behavior before changing quote eligibility.
3. **Merchant session ownership** — F04. Deferred-operation tests must precede the repository/provider change.
4. **Modal operation ownership** — F05. Apply the same close contract to the two confirmed use cases; then finish F07–F09 through existing primitives.
5. **Private scanner failure boundaries** — F06, with both malformed-envelope and canonical-corruption tests. Preserve proof reservations and authenticated accounting.

Then address F10/F11 with count/memory diagnostics and correctness checks before latency tuning. K01 remains release-blocking throughout; upstream availability may constrain its resolution. K02 can be handled alongside verification documentation. These are recommendations, not approved numbered implementation plans yet; the previous plans 001–003 remain complete.

Optional directions, not defects or commitments:

- **Executable component contracts:** extend the existing synthetic fixture into the source of truth for supported busy/error/keyboard states. It already serves multiple real primitives; avoid introducing Storybook or another framework unless maintainers need its separate workflow.
- **Long-session quality gate:** add bounded cache/transport work-count tests and an occasional synthetic soak run before optimizing initial paint further. This targets demonstrated growth, at the cost of additional CI/runtime time; do not collect wallet payloads for profiling.

## Limits and human verification still required

Not performed this turn: fresh production build, generated proof artifacts, nested protocol prebuild/tests, Rust/circuit/formal verification, live Testnet or Mainnet operations, deployment/ceremony verification, physical Trezor/passkey/iOS testing, browser screenshots/traces, manual VoiceOver/NVDA, visual/contrast/zoom review, cold/warm navigation benchmark matrix, real-device memory/proving measurements or field telemetry. The main checkout and active user servers were not changed or restarted.

The audit cannot establish resistance to a compromised unlocked browser, transport anonymity against a global observer, guaranteed erasure of JavaScript strings/bigints/library memory, or absence of all cryptographic vulnerabilities. Do not broaden the existing privacy claims on the basis of this report.

## Proposed durable engineering rules

For a later approved `AGENTS.md` update; not applied by this read-only audit:

- Keep one authoritative close/leave policy per overlay operation; shell, header, footer, handoff and stale completion must all obey it.
- A cache hit never refreshes observation time. Display staleness honestly and enforce genuine freshness for all money-quote inputs.
- Clearing sensitive state revokes pending publishers, not only the current value. Every repository/provider continuation must belong to its originating session.
- Separate sender-controlled envelope metadata errors from canonical integrity failures; never weaken root/nullifier/journal checks for convenience.
- Bound untrusted input and bookkeeping before expensive parsing/validation. Cache append work should scale with the append, with atomic integrity checks preserved.
- Required tests must actually execute in the shared CI/release gate. Private wallet tests must not retain secret-bearing diagnostics; human accessibility and physical-device checks remain explicit release evidence.
