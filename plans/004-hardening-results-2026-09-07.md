# System hardening — final results, 2026-09-07

The scoped implementation of [plan 004](004-system-hardening.md) is complete. F01–F12 and K02 are addressed; the signing-context investigation produced a regression-proven fix; K01's safely resolvable installed high-severity dependency paths are fixed, with upstream and release limits retained below. The [original audit](system-audit-2026-09-06.md) and [task checkpoints](README.md#historical-task-checkpoints) remain historical evidence.

Work remains on `advisor/001-revoke-stealth-discovery` in `/Users/admin/Documents/codegen/0x/.worktrees/revoke-stealth-discovery`. The main checkout and user-owned work were preserved. Application version remains 1.4.1; published changelog entries were not rewritten. No main-branch merge, push, tag, deployment, live transaction or user-server restart was performed.

The final full application command ran against clean committed source **`d4edc1d95036d7f5f81ae5f3bbe6b25fde03cea4`**, before this documentation-only handoff. It finished with exit 0. These results identify the tested source commit, not a later documentation commit or a published release artifact.

## Finding-to-result map

| Audit item | Result / principal implementation |
| --- | --- |
| F01 — Complete verification | Required isolated component, overlay/manifest and nested protocol suites share CI/release verification; fixture cleanup surrounds the production build. `42d5f52`, with the normal-runner guard addendum `ec7f2f6`. |
| F02 — Private-safe diagnostics | Screenshots, traces and video are off, reporting is structural-only, and usable-wallet paths refuse before funding, import or navigation because Playwright cannot suppress all failure ARIA snapshots. `42d5f52`, with validated source-step diagnostics in `97ada17`. |
| F03 — Genuine price freshness | Asset, XLM and FX observation times survive cache reads; every new Mainnet merchant quote requires fresh inputs, with local retry and retained drafts. `dea70d9`. |
| F04 — Revocable merchant publication | Repository and provider generations reject stale plaintext/UI publication across lock, reset and replacement; consented encrypted commits and unresolved refund recovery remain durable. `8aa1a35`. |
| F05 — Consistent close ownership | Account/claim actions share the shell's exit policy and originating-opening checks; an old completion cannot close a reopened dialog. `781568d`. |
| F06 — Recipient-local metadata | Recovery uses the commitment-authenticated registry asset despite a bad redundant recipient index; canonical corruption still fails closed. `5f2ec45`. |
| F07 — Local error recovery | Merchant errors remain beside the action with drafts and explicit retry; supplementary toasts announce politely. Contact writes retain their original vault authority. `51d0c7e`, `27c44cd`; context composition in `58ceae4` restores the unchanged merchant budget. |
| F08 — Shared accessibility | Named switches, actual Select field relationships, persistent/dismissible tooltip help, inert-source cleanup and SVG-opener focus restoration use existing shared primitives. `aa91527`, `161a40f`, `bdfebdf`, `1c886b2`. |
| F09 — Accurate account wording | Mode descriptions no longer infer derivation metadata from an active-account count. `e3314cb`. |
| F10 — Bounded Nostr work | A verified 512-ID FIFO and bounded canonical ingress replace unbounded upstream pre-verification retention; reconnect uses original filters and appropriate backoff. `93f24d2`. |
| F11 — Incremental cache append | Atomic checkpoints and overlap/new-record validation make warm append reads linear; cold validation, migration, conflicts and fail-closed recovery remain covered. `662bdd6`. |
| F12 — Chart expiry | Expired chart series retain their correct labels while revalidating, without granting an obsolete request fresh publication authority. `dea70d9`. |
| Signing-context lead | Real account-menu controls reproduced stale Send authority. Public Send and co-signed preparation now bind review, approval, signing and the final pre-POST continuation to the originating account/network/session revision. Already-broadcast tracking continues. `8cb9ced`; modal focus-ownership correction `bd15ee9`. |
| K01 — Dependencies | Scoped nested SDK 14.2.0 → TOML 4.2.0 override, actual installed resolver/Trezor compatibility tests, and regenerated lockfile provenance. `bf407e2`, `6c50995`. Installed audit passes; embedded/remote code and elliptic remain qualified limits. |
| K02 — Factual documentation | Dependency counts, permitted zoom, the pinned Testnet development catalogue and safe automated-verification scope match observed behavior. `b4f1802`. |

Independent spec and quality reviews approved each task and its corrections. The final whole-implementation quality review covered `8397a358..ec7f2f6`; subsequent diagnostic and merchant-test addenda through `d4edc1d` received separate spec and quality approvals. Historical task evidence records narrower coverage and intermediate failures rather than treating every review as a new end-to-end run.

## Final clean-tree application verification

Environment: Darwin arm64, Node 26.7.0, npm 11.19.0, locked Next.js 16.3.3, React 19.2.8 and Playwright 1.62.1. Root owned the complete serial command and its servers on port 3225, with source frozen and no competing agent test/build jobs. Tests used isolated non-usable synthetic data, safe reporting and capture-off settings, not a developer-owned wallet session.

Command: `E2E_PORT=3225 npm run release:verify`, run on 2026-09-07, approximately 16:17–16:39 UTC.

| Gate | Observed result |
| --- | --- |
| Clean-release preflight | Passed at the full source SHA above; version 1.4.1. |
| Generated artifacts | Passed with stable generated provenance and verified proof vectors. |
| TypeScript | Passed. |
| Root Node suite | 1,716 passed; zero failures/skips; 59.902 s. |
| Nested browser protocol | 58 passed; zero failures/skips; 8.783 s. |
| ESLint | Zero errors; three existing marketing `next/no-img-element` warnings. |
| Production npm audit | Passed high/critical threshold: ten low package findings, no moderate/high/critical findings. |
| Actual safe-reporter probes | 2 passed; zero failures/skips; 4.271 s. |
| Required continuity/overlay/manifest suite | 16 passed, eight per engine; zero failed attempts, retries or skips. |
| Required isolated component suite | 512 passed, 256 per engine; zero failed attempts, retries or skips. |
| Fixture cleanup | Passed before and after production build and again after the aggregate. |
| Production build | Passed; 22 static pages generated. |
| Bundle tests and budgets | 5 tests passed; every existing budget passed without a threshold change. |
| Normal browser matrix | 114 passed, 278 intentionally skipped; zero failed attempts or retries; 392 entries completed. |
| Aggregate / post-run state | Exit 0; `git diff --check` passed, source worktree remained clean and port 3225 was released. |

Both required suites execute Chromium and iPhone WebKit. Normal active coverage is Chromium (55 passed), iPhone WebKit (36) and iPad WebKit (23). The Firefox and desktop WebKit projects each collected one opt-in browser-smoke case and skipped it; they provide no active coverage in this run.

The normal matrix's 278 skips are explicit: 256 fixture-only Chromium cases already required by the separate 512-case two-engine suite; 15 opt-in Private Balance live-fixture entries; and seven device-specific exclusions (six accessibility entries and one merchant WebKit entry). No required synthetic case was skipped. The live runner remains blocked by the safe-capture policy, so those skips are not usable-wallet verification.

The documentation-only handoff separately passed 51 focused changelog, production/security documentation, release, browser-configuration and wallet-test-safety checks with zero failures or skips. This focused check is not another execution of the full aggregate on the later documentation commit.

## Production size and measured work

All graph definitions and thresholds are unchanged. These are cumulative final build sizes, not isolated per-fix savings or field performance measurements; overlapping feature/worker graphs must not be summed.

| Boundary | Raw bytes | Gzip bytes |
| --- | ---: | ---: |
| Landing | 636,237 | 195,789 |
| Initial wallet | 1,173,842 | 344,672 |
| Unlocked | 764,760 | 167,845 |
| Merchant | 543,536 | 148,591 |
| Hardware | 1,047,527 | 210,139 |
| Private feature | 274,671 | 74,327 |
| Private worker | 762,199 | Not measured |
| Protocol artifacts | 9,424,602 | 6,278,239 |

Unlocked raw headroom is only 240 bytes; merchant raw headroom is 1,464 bytes. The two-version artifact cache peak is 18,849,204 bytes. Task 9 and final test-only follow-ups did not increase raw JavaScript relative to the Task 8 checkpoint; tiny gzip differences are recorded as measured, not attributed to a performance improvement.

For 10/20/40 single-record cache appends, instrumented returned-record reads fell from 100/400/1,600 to 56/116/236; alternating two drivers used 75/155/315. The tradeoff is two record writes per append instead of one. These are structural storage-work counts, not native I/O or latency benchmarks. Cold loading/rebuild still validates retained history, and the cache digest is not canonical chain authentication.

Nostr's actual-library baseline retained 1,024 invalid IDs; the adapter now retains at most 512 validated delivery IDs and rejects ingress frames above 64 KiB before expensive processing. This does not establish traffic-rate DoS resistance or transport anonymity. Existing manager approval tests and actual-library eviction tests are separate evidence, not a claimed combined eviction-to-manager stress test.

## Earlier non-passing attempts and test-fidelity corrections

The final passing command was not the first attempt. Earlier logs were preserved; neither repeat passes nor a later controlled reproduction establish the exact cause of a failure whose original assertion was unavailable.

| Earlier attempt | Observed failure and disposition |
| --- | --- |
| Clean `b4f1802` aggregate | Stopped at generated provenance after the TOML lockfile change. `6c50995` refreshed five lockfile-derived manifest/catalogue pins using the existing generator. No contract, circuit, deployment identity, proving artifact or vector changed. |
| Clean `6c50995` aggregate | All preceding application/build/bundle gates passed. The normal matrix finished with 114 passes, 31 failures and 247 skips: all 31 merchant-feedback cases required the already-removed isolated fixture before any action. `ec7f2f6` added the same normal-runner guard as the other isolated specs, with a configuration-derived policy regression. The required isolated merchant suite continued to execute. |
| Clean `ec7f2f6` aggregate | 1,714 Node tests, 58 protocol tests, reporter probes and all 16 required UI cases passed; isolated components finished 510/512, with two failed attempts and no skips. Failures were the Chromium pending-row keyboard test and the iPhone no-preference modal-observer control. The original reporter retained declaration locations, not the precise failed assertions. Build and normal-browser stages were not reached. |
| Merchant follow-up after `f119a21` | Full merchant run finished 61/62. The contact save changed the dialog's accessible name, invalidating the old name-bound locator used to assert focus. Controlled checks proved the original shell/button remained connected and focused while that locator failed. `d4edc1d` follows the explicit new name and verifies original shell/button identity, focus, cleared error and exactly two contact writes. Twenty focused repetitions and all 62 merchant cases then passed. |
| Root modal follow-up at `d4edc1d` | Finished 93/94. The sole failure was the final axe violation-array assertion for imported-account wording in Chromium/no-preference motion. The rule and affected element were not observed. Ten unchanged exact-case diagnostic repeats and eight cross-engine/motion/vault controls passed with empty violation lists. Temporary rule-ID/count-only diagnostics were removed; no style wait, axe rule change or production patch was justified. |

The pending-row follow-up used a controlled rejection-continuation hold to prove that attempting retry before the asynchronous write had settled was blocked by the real pending control. `f119a21` waits for actual local rejection feedback and switch enablement before retry, while retaining checks that early pointer/keyboard activation cannot duplicate attempts. Both engines failed the deliberate old-sequence control and passed the corrected sequence, including twenty repeated checks. This establishes the corrected test boundary, not complete retrospective attribution of the original aggregate failure.

`97ada17` adds only validated same-file source-step locations to safe browser diagnostics; it never reads or reports private error payloads. Its synthetic sentinel, hostile metadata and actual-browser probes passed independent review. A failed-step notice may describe an internal polling attempt inside a passing test; final test statuses and the reporter summary determine failed-attempt counts.

The original modal-observer failure was not reproduced in forty unchanged repetitions, the later 94-case follow-up, or the final full aggregate. No observer comparator, replay negative control, animation timing, accessibility threshold or product code was changed to conceal it. Its cause and the separate historical axe failure remain unexplained. The final passing result is not a claim that intermittent failures cannot recur.

## Dependency and separate release boundaries

The actual installed graph moved from thirteen vulnerable packages (eight low, five high; three distinct advisories) to ten low packages (one distinct elliptic advisory). The scoped SDK 14.2.0 override uses TOML 4.2.0, the minimum version covering both parser advisories; the root SDK remains 17.0.1 and Trezor remains stable 9.7.3. Thirty-two task-specific hardware tests covered actual nested resolvers, installed Trezor validation/conversion, synthetic device responses and cross-SDK transaction utilities. The malformed-input rejection remains, but the old SDK wrapper reports undefined diagnostic coordinates with TOML 4; this limitation is documented, not patched away.

[Dependency security evidence](../docs/dependency-security.md) records the important residuals: both SDK 14 prebuilt browser bundles still reproduce the old parser issues, an npm override cannot rewrite embedded or remotely hosted code, and remote popup-core provenance was not established. Local import/marker inspection is not a proof of universal unreachability. Elliptic 6.6.1 has no reported upstream patched version for its remaining advisory; this does not by itself establish exposure of Stellar Ed25519 keys. Removing hardware functionality or changing signing architecture requires a separate security decision. Trezor T-RSL distribution authorization, registered-origin and physical-device checks remain required.

Separate local Rust verification on 2026-09-07 used the unchanged Rust/contract sources in this branch:

- `cargo +1.97.1 test --workspace --locked`: 52 passed, zero failed, one ignored. The ignored 100,000-action deterministic recovery model is the separately scheduled/manual release-mode Gate B, not a passing result from this run.
- `cargo +1.97.1 deny --config deny.toml check`: advisories, bans, licenses and sources passed, with thirty duplicate-crate warnings and two unused-license-allowance warnings.
- The Rust tests rewrote three proof-coordinate fields in a generated test snapshot; the output matched the existing checked-in static proof vector. Those run-only snapshot edits were restored. No Rust source, circuit, vector or cryptographic artifact change is part of this hardening work.

Full circuit Gate A was not run: the pinned `civer_circom` analyzer was not available and `CIVER_CIRCOM` was unset. Generated-artifact verification is not a substitute. Gate B's ignored long model was not separately run. No toolchain installation, ceremony rerun or deployment was attempted to manufacture missing release evidence.

Human VoiceOver/NVDA, physical pinch zoom, physical hardware signing, passkeys, installed iOS behavior, real-device proof memory/background behavior and usable Testnet recovery/expiry drills remain unverified by this work. Automated axe, keyboard, reduced-motion, responsive and 200% equivalent reflow checks do not certify those boundaries or full WCAG conformance; existing engine-specific axe limits remain. Private viewing material remains sensitive, memory overwrites remain best effort, and bounded transport/cache work is not anonymity or guaranteed erasure.

## Evidence locations and handoff

The durable record is this report and the linked task/dependency evidence. Raw text logs below are temporary local files, not durable CI artifacts or usable-wallet captures:

- Final aggregate: `/tmp/stellarkey-hardening-final-release-verify-reviewed-20260907.log`.
- Documentation follow-up: `/tmp/stellarkey-hardening-final-docs-check-20260907.log`.
- Earlier aggregates: `/tmp/stellarkey-hardening-final-release-verify-20260907.log`, `/tmp/stellarkey-hardening-final-release-verify-provenance-20260907.log`, `/tmp/stellarkey-hardening-final-release-verify-guard-20260907.log`.
- Modal 93/94 follow-up: `/tmp/stellarkey-hardening-root-modal-followup-20260907.log`.
- Bounded controls and merchant failures/fixes: `/tmp/stellarkey-interaction-probes.pHgXtT/`, including the original `merchant-full-green.log` filename despite its actual 61/62 result, controlled RED patches/logs, and `modal-account-axe-first10` / `modal-account-axe-controls` safe logs and rule/count summaries.
- Reporter probes: `/tmp/stellarkey-reporter-step-locations.8o0IUA/`, `/tmp/stellarkey-hardening-reporter-root-focused-20260907.log`, `/tmp/stellarkey-hardening-reporter-root-browser-20260907.log`.
- Separate Rust checks: `/tmp/stellarkey-hardening-final-rust-20260907.log`, `/tmp/stellarkey-hardening-final-rust-deny-20260907.log`.

Keep the branch and worktree for the user's later integration. The source verification is complete within this scope; upstream security decisions and independent human/device/circuit release gates are not waived by the passing application command.
