# Backend-free wallet release checklist

This wallet ships as static files and talks directly to user-selected Stellar services. It has no application backend, remote custody service, background worker, or server-side database.

## 1.1.1 audit curation

The maintainer requested review of both November 6 audits and useful fixes in
PR #40. Their original reports and uncommitted source work remain preserved in
the authoritative audit checkout; full internal audit evidence stays outside
the public release documentation set.

Included fixes bind refresh publication and all transaction-signing flows to
the reviewed wallet context, release failed status-poll ownership for retry,
report partial erasure with a provider-owned recovery screen, bound Friendbot
error-body and artifact waits, label trustline removals, narrow six transitions,
and update reviewed application dependencies. Cryptographic artifacts and
historical deployment bindings remain unchanged.

Focused red/green evidence includes 335 signing/adapter tests, 54 delayed
synthetic-hardware/queued-POST cases, 43 erasure/storage/changelog checks,
both Chromium/iPhone erasure-recovery accessibility cases, and 48 installed
dependency/hardware checks. Counts overlap and are not unique coverage totals.
The Friendbot audit patch was tightened to include error-body consumption;
CSV already used the neutral Trustline label, so no export change was needed.
The report's claim that no other lockfiles exist was incorrect: nested npm
and Cargo locks remain distinct verification inputs.

Claim discovery beyond the first 20 balances and the unprofiled provider
subscription refactor remain follow-ups. One abandoned-backup-read failure in
the audit has an unconfirmed cause; its unchanged full production check remains
required. No isolated repetition replaces that failed attempt.

The first curated clean-source attempt at 272e7d2 ran all 2,402 root tests:
2,400 passed and two policy assertions failed. One needed the new mandatory
erasure spec added to its explicit expected suite; the other correctly rejected
internal audit reports in the public documentation directory. The reports were
preserved outside that directory and their release disposition retained here.
Neither policy nor the privacy restrictions is relaxed.

The corrected attempt at 5348f32 passed 2,402 root tests, 64 browser-protocol
tests, lint/audits/privacy probes and all 16 required private UI checks. Its
734-case component matrix recorded 733 passes and one iPhone SVG-opener
precondition failure before focus-restoration assertions. Twenty-four isolated
instrumented repetitions passed; its original cause remains unconfirmed.
The synthetic SVG test now explicitly maintains body focus during a real
pointer activation. All 12 repeated positive cases passed. A targeted control
that deliberately ignores SVG pointer openers failed the actual focus-return
assertion in all four engine/motion cases, preserving regression sensitivity.
No application focus code or animation assertion changed in this test adjustment.

The same source's hosted run recorded successful Rust security, Linux circuit
analysis and CodeQL. Three queued ARM macOS jobs failed to acquire runners after
about fifteen minutes, so Gate A remained red. Browser jobs now use standard
macOS Intel runners; canonical reproduction retains its mandatory ARM64 host.

Earlier full application results below retain their original source identities.
The corrected candidate requires a new clean-tree release verification, required
CI and release-workflow gates; those earlier runs do not validate it.

## 1.1.1 replacement release preparation

The 1.1.0 tag was created after clean local verification, PR CI and post-merge
CI passed. Its release run [42221483313](https://github.com/stellarchain/io.stellarkey/actions/runs/42221483313)
then failed Chromium Select focus checks. Publication and deployment remained
blocked; the remaining jobs were cancelled after reproducing the underlying
race in both Chromium and iPhone WebKit. The immutable tag is retained.

A paused-initializer regression failed on the original code: newer focus in a
Select portal was overwritten because the initializer checked only the dialog
panel. The owning backdrop also contains its Select/menu portals. Checking that
owner preserves newer focus. The first fix run passed 30 focused cases; expanded
Select/Dropdown coverage under normal and reduced motion passed 48 cases without
retries, and 17 modal-focus unit tests passed. The initial expanded Dropdown
setup waited for its deferred focus while the clock was paused; the corrected
fixture places explicit newer focus and verifies zero transient focus losses.
One additional fixture setup attempt failed before its test assertions in that
initial expanded run; its cause remains unconfirmed. The corrected final
48-case run completed without failed attempts or retries.

The replacement application version is 1.1.1; Private Payments remains V2.1.
Full clean-source application verification and required CI remain mandatory.
The maintainer’s manual-check deferral and exact Rust advisory exception apply
to this same ongoing release task; no completed release exception is inherited.
The separately approved production deployment still targets Cloudflare Pages
project `stellarkey` and https://stellarkey.io. No network contract deployment or
real-value use is authorized. Historical evidence below retains its original
source, version and observation time.

## 1.1.0 release preparation

Application version 1.1.0 uses Private Payments Protocol V2.1; the numbers identify
different compatibility boundaries. The dated changelog entry is preparation,
not evidence of publication. Earlier release exceptions do not carry over.
The maintainer separately deferred the 1.1.0 manual checks on 2026-11-06, as
recorded below; they remain unperformed or unconfirmed, not passed.
Before upgrading a wallet with Protocol V2 private records, follow the
[backup preservation and recovery guidance](private-balance-recovery.md#upgrading-from-104-protocol-v2).

### Local candidate evidence — 2026-11-05–06

`npm run verify:application` passed on 2026-11-06, from 01:16 to 01:39 UTC,
on macOS ARM64 with Node 26.7.0 and npm 11.19.0. This covered the authoritative
modified checkout, including the pre-existing V2.1 work and untracked source,
based on HEAD `3098ed84293d5da04320311e6696279ff633666b`.
The 1,010-path source snapshot and staged changes were unchanged throughout the
run. Its SHA-256 fingerprint was
`40640a0c16b1320c02260b3c8912d6eecf4e3fda3f7a70220824551edff6e365`:
canonical JSON of HEAD, staged name/status, and sorted paths with content hashes
and file modes, including tracked deletions and non-ignored untracked files.
This evidence section and the dependency-evidence PR map were added afterward
and receive separate documentation checks. The local export identifies version
1.1.0 and `sourceTree: modified`; it is not a clean-source release attestation.

| Check | Observed result |
| --- | --- |
| Application core | Passed: generated-artifact consistency, TypeScript, 2,079 root tests, 64 nested browser-protocol tests, zero-warning lint, both audit thresholds and two reporter probes. |
| Required private browser suites | Passed: 16 overlay/manifest checks and 724 component checks across Chromium and iPhone WebKit; zero skips and zero failed attempts. |
| Production verification | Passed: fixture cleanup before/after build, static export, five bundle tests, unchanged bundle budgets and 175 active browser checks. The normal matrix also recorded 387 project/fixture/live-test skips; these are not additional passes. |
| Trezor Suite bootstrap | Passed in Chromium, iPhone WebKit and iPad WebKit using the installed client, production CSP and an intercepted synthetic approval page. No device approval or remote-core provenance is established by this test. |
| `verify:private-rust` — Nov 5 | Failed its advisory gate. Formatting and all 57 default functional tests passed, with two opt-in tests ignored by that default invocation. Bans, licenses and sources passed; RUSTSEC-2026-0387 remains in crypto-bigint 0.5.5 through Soroban host dependencies. |
| `verify:private-model` — Nov 5 | Passed the separately invoked 100,000-action recovery/corruption model in 407.21 seconds. |
| `verify:private-circuits` — Nov 5 | Passed Circomspect, CIVER, both analyzer negative controls, proving-key validation, 14 circuit tests and all eight security-constraint mutation checks. |
| `verify:private-artifacts` — Nov 5 | Passed two independent canonical rebuilds with byte-identical R1CS, witness Wasm and pool Wasm. |
| `release:verify` | The Nov 5 attempt failed the clean-tree preflight. The checkout remains modified, so this release gate has not passed. |

The unchanged Rust/circuit/model/artifact inputs retain their Nov 5 evidence.
Those checks used Rust 1.97.1, Stellar CLI 27.0.0 and Circom 2.2.3.
Circomspect 0.9.0 passed with its negative control. CIVER analyzed the pinned
source `af7d4ed0325e6f7743d8a1ac0e415d0c69b8aae8` in an owned offline Linux
container: 21 verified components, 190,043 verified constraints, zero failures
and zero timeouts. The native macOS/Clang legacy-Z3 build failed; the Linux
result is not evidence that this native build works. Canonical artifact builds
reported a duplicate `ShieldedAction` specification-entry warning.

Canonical SHA-256 artifact identities were:

- R1CS: `b929074da90879626a0e2a1e01e2bb7624e50dfae4e894d2866a09e80e0c1a6e`.
- Witness Wasm: `2f40e251d8266ba47d66d18c9f56674f29f939628f53767a49deae1104a2929a`.
- Pool Wasm: `6273f471d0f95df23c0ace8354189f3e6a3ad8262d3c5c0162b049fa13a7040a`.

The other ignored test, the research prototype
`prototype::proof_verified_rollover_exit_and_host_costs`, was also invoked in an
isolated workspace. It failed with both the original ctutils 0.4.2 and patched
0.4.4 dependency. The cause remains unresolved; it is
not counted as a pass. Rust test execution also regenerated the already-modified
initialization/deposit snapshot. The original staged fixture deletion was
preserved without restaging it.

All wallet browser checks used isolated, non-usable synthetic fixtures with
screenshots, traces and video disabled. Physical devices, human VoiceOver/NVDA,
passkeys, manufacturer-origin sign-off and the other manual release items remain
unperformed or unconfirmed. The fresh 1.1.0 deferral below records the maintainer’s
subsequent decision; no prior release exception is applied automatically.
At 01:39 UTC, the Rust advisory and clean-source requirement blocked publication.

### Maintainer-approved advisory exception — 2026-11-06

The maintainer subsequently authorized skipping RUSTSEC-2026-0387 for 1.1.0.
The exception is restricted to that advisory ID in `deny.toml`; crypto-bigint
0.5.5 remains installed through Soroban host dependencies. At 09:24 UTC,
`npm run verify:private-rust` passed: formatting, 57 functional tests (two
default opt-in skips), advisories with the approved exception, bans, licenses
and sources. A control run with the previous configuration failed only on
that advisory. No test snapshot, dependency lockfile or compiled protocol
artifact changed during this rerun.

This supersedes the advisory blocker in the earlier evidence. It does not
establish a vulnerability fix, clean-source release verification, or manual
device/accessibility approval. The clean-source requirement, other manual
release items and unresolved research-prototype result remain as recorded
above. See the [dependency security evidence](dependency-security.md#maintainer-approved-rust-advisory-exception--2026-11-06).

The exception configuration SHA-256 is
`23ffa67e25f0f28f01def8597ea1a69d4d3ee4f626409508d58108570d6074c7`;
the Rust lockfile remains
`c5ee622f47109654603aa119e47f2c6953b7bc1c6dc9dffafa9f97359e564b0b`.
The updated release notes passed 42 focused documentation/policy tests, a new
production build with fixture cleanup, and all three production changelog
checks on Chromium, iPhone WebKit and iPad WebKit. Node 26.7.0, npm 11.19.0,
Next.js 16.4.2 and macOS ARM64 match the earlier application verification
environment. Application behavior, dependency locks, circuit sources and Rust
implementation inputs remain unchanged, so their earlier results retain their
original dates. The maintainer subsequently authorized committing the prepared
candidate, including the existing V2.1 working changes, and creating release 1.1.0.
Clean-tree release verification remains required before tagging.

## Automated release gate

- Use Node 22.22.2+ and npm 11.19.0+ from the supported ranges in `package.json`.
- Install exactly from `package-lock.json` with `npm ci`. The checked-in `.npmrc` sets `ignore-scripts=true`; no `allowScripts` allowlist is configured. Review any proposed change to that policy or manual dependency-script execution explicitly.
- Run `npm run release:verify` from a clean checkout.
- Require the separate Rust security and circuit Gate A workflow jobs as well as application verification. The equivalent local commands are `npm run verify:private-rust`, `npm run verify:private-circuits`, and `npm run verify:private-artifacts`. The 100,000-action recovery model runs weekly and on manual dispatch; `npm run verify:private-model` is its local counterpart. Use the pinned toolchains described in the deployment runbook. The application gate includes nested browser-protocol tests, mandatory synthetic private UI/component and overlay/manifest tests, fixture cleanup before and after the production build, and the normal browser matrix.
- Create release files only from that verified `out/` directory with `node scripts/create-release-artifact.mjs`. Never rebuild during deployment.
- The packager verifies the point-compressed proving key against the canonical raw key and manifest, then omits only the redundant raw key and `.DS_Store` files from the archive. It rejects any remaining asset above Cloudflare Pages' 25 MiB limit. Source artifacts and `out/` remain unchanged; deploy the archive, not the unfiltered build directory.
- Verify `SHA256SUMS`, then compare every static file with `release-files.json`. The archive, inventory, CycloneDX SBOM, and checksums must come from the same immutable GitHub release. For workflow-built releases, verify the Actions build-provenance attestation against the release workflow and exact source commit before deployment. The manually published `1.0.0` release has only GitHub's immutable-release attestation, not Actions build provenance; do not claim otherwise or replace its immutable assets.
- Confirm [CHANGELOG.md](../CHANGELOG.md) has a dated entry for the package version and a fresh `[Unreleased]` section before tagging; leave that section empty rather than publishing a placeholder note.
- Confirm `out/index.html`, `out/_headers`, `out/sw.js`, `out/manifest.webmanifest`, and the icon files exist.
- Deploy the contents of the exact `stellarkey-<version>.tar.gz` release archive to an HTTPS static host that applies `_headers`. Do not rebuild it and do not add an application-server requirement.
- Treat a bundle-budget, production-audit, Chromium, iPhone WebKit, or iPad WebKit failure as release-blocking.
- Re-check every public fee-comparison rate against its linked first-party source, update the checked date, and verify the page still distinguishes StellarKey processing fees, sender-paid network fees, and optional conversion/off-ramp costs.
- Review and record the [repository security settings](./production-deployment.md#repository-security-settings); local source files cannot prove that GitHub dashboard protections remain enabled.

### v1.0.0 release exception

On 2026-09-13 the maintainer explicitly deferred the physical iPhone/iPad,
VoiceOver/NVDA, passkey and Trezor checks, including Trezor redistribution and
registered-origin sign-off, for this release. These checks are unperformed or
unconfirmed, not passed. This exception does not grant third-party license rights,
remove the requirements below for later releases, or promote Private Payments
beyond the unaudited Testnet-only development deployment.

## Manual device boundaries

### v1.0.1 release exception

On 2026-09-13 the maintainer explicitly continued the same deferral for the
packaging and public-copy patch release 1.0.1: physical iPhone/iPad,
VoiceOver/NVDA, passkey and Trezor checks, including Trezor redistribution and
registered-origin sign-off. They remain unperformed or unconfirmed, not passed.
This exception grants no third-party license rights, does not waive automated
gates, and does not promote Private Payments beyond unaudited Testnet use.

### v1.0.2 release exception

On 2026-09-14 the maintainer explicitly continued the same deferral for UI patch
release 1.0.2: physical iPhone/iPad, VoiceOver/NVDA, passkey and Trezor checks,
including Trezor redistribution and registered-origin sign-off. They remain
unperformed or unconfirmed, not passed. This exception grants no third-party
license rights, does not waive automated gates, and does not promote Private
Payments beyond unaudited Testnet use.

### v1.0.3 release exception

On 2026-09-14 the maintainer explicitly continued the same deferral for release
1.0.3: physical iPhone/iPad, VoiceOver/NVDA, passkey and Trezor checks, including
Trezor redistribution and registered-origin sign-off. They remain unperformed or
unconfirmed, not passed. This exception grants no third-party license rights,
does not waive automated gates, and does not promote Private Payments beyond
unaudited Testnet use.

### v1.0.4 release exception

On 2026-09-16 the maintainer explicitly continued the same deferral for release
1.0.4: physical iPhone/iPad, VoiceOver/NVDA, passkey and Trezor checks, including
Trezor redistribution and registered-origin sign-off. They remain unperformed or
unconfirmed, not passed. This exception grants no third-party license rights,
does not waive automated gates, and does not promote Private Payments beyond
unaudited Testnet use.

### v1.1.0 release exception

On 2026-11-06 the maintainer explicitly deferred the physical iPhone/iPad,
VoiceOver/NVDA, passkey and Trezor checks for 1.1.0, including Trezor redistribution
and registered-origin sign-off. These checks remain unperformed or unconfirmed,
not passed. This release-specific exception grants no third-party license rights,
does not waive automated gates, and does not approve real-value Private Payments.

### v1.1.1 release exception — replacement candidate

The maintainer’s 2026-11-06 instruction to defer physical iPhone/iPad,
VoiceOver/NVDA, passkey and Trezor checks continues for the replacement candidate
in this same release task, including redistribution and registered-origin
sign-off. These checks remain unperformed or unconfirmed, not passed. No new
physical or human evidence is claimed. This grants no third-party license
rights, waives no automated gate and does not approve real-value Private Payments.
The exact RUSTSEC-2026-0387 exception continues; no other advisory ID was added.

### Required checks

- On a real iPhone, test Safari onboarding, encrypted-backup restore, lock/unlock, form entry, safe areas, and Add to Home Screen cold launch. Verify pinch zoom and 200% reflow, VoiceOver, and system text without clipping controls or obscuring focus.
- On a real iPad, repeat the installed-app, rotation, modal, keyboard, and account-menu lock flows.
- Create a passkey on a real compatible Apple device, lock and unlock with Face ID or Touch ID, verify password fallback, and confirm removal rejects a wrong current password.
- Connect a real supported Trezor, verify the address on-device, review a small testnet transaction on-device, and confirm cancellation and disconnect errors fail closed.
- Test a small-value mainnet payment only after independently checking the destination, asset issuer, memo, fee, network, and signing-device display.

## Local-first and recovery checks

- Export and verify an encrypted backup before installing or replacing the app. Restore it into a fresh browser profile and compare every account address.
- Confirm wallet backups use the current encrypted version 2 envelope and current-format records. Unsupported formats must be rejected without migration or data deletion.
- Treat the Tax Records merchant archive as a portable encrypted record set, not an independent wallet backup. Full encrypted wallet backups include the matching vault and merchant key required for recovery.
- Confirm endpoint overrides reject HTTP, credentials, fragments, and the wrong Stellar network. Verify both Horizon and RPC reset to the built-in defaults.
- Confirm offline cold launch exposes only the cached application shell; wallet, merchant, price, and Horizon responses must not enter the service-worker cache.
- Confirm merchant encrypted records survive reload and that a second tab cannot overwrite a newer revision.
- Confirm merchant documentation describes payment monitoring as foreground-only. An open checkout may keep the screen awake; closing or suspending the browser pauses checks, and reopening and unlocking must reconcile missed payments. Do not describe this as background monitoring without adding a backend.

## Private Balance beta gate

- The exact pinned Testnet `development` fixture is explicitly enabled in production-hosted builds. Keep Mainnet and beta/production promotion closed while ceremony, audit, deployment, or immutable release evidence is absent; the development exception grants no promotion approval.
- Verify the same manifest and artifact hashes across reproducible builds, ceremony records, contract deployment, independent review, browser tests, and release evidence.
- Exercise encrypted-backup and seed-only recovery, paid archive restoration, expired archive/nullifier entries, pending-spend recovery, lock during scan/proof/submission, leader failover, exact semantic transaction review, CSP/network sentinels, and real-device accessibility.
- Confirm every surface states the public fee payer, timing, pool activity, and deposit/withdrawal amount and endpoint boundaries. Never describe the feature as anonymous, untraceable, or guaranteed private.

## Remaining dependency boundary

Trezor Connect 10.0.1 now uses the MIT-licensed Suite Web client. Preserve its license notice, verify the production-origin bootstrap and popup, and complete real-device address, signing, cancellation and disconnect checks. The hosted Suite core remains separate from the locally installed reference used by automated tests. Current dependency and protocol security results are recorded in [dependency security evidence](dependency-security.md); a passing npm audit does not satisfy the separate Rust, circuit, physical-device or human accessibility gates.
