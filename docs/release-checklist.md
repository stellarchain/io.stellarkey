# Backend-free wallet release checklist

This wallet ships as static files and talks directly to user-selected Stellar services. It has no application backend, remote custody service, background worker, or server-side database.

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

As checked on 2026-09-07, `@trezor/connect-web@9.7.3` remains the latest stable
release. It is a regular production dependency loaded lazily for the optional
Trezor UI. The production audit reports ten low-severity vulnerable packages
associated with one `elliptic` advisory and no high/critical findings after the
scoped TOML override. Review [the compatibility evidence and remaining embedded
parser/remote-core limits](dependency-security.md); this is not an advisory waiver
or proof that upstream popup code is patched. High/critical production findings,
the Trezor redistribution authorization, registered origin, and physical-device
checks remain release gates.
