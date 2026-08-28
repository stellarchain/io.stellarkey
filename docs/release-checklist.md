# Backend-free wallet release checklist

This wallet ships as static files and talks directly to user-selected Stellar services. It has no application backend, remote custody service, background worker, or server-side database.

## Automated release gate

- Use Node 22.22.2+ and npm 11.19.0+ from the supported ranges in `package.json`.
- Install exactly from `package-lock.json` with `npm ci`. Review any new dependency install-script request; approved scripts are pinned by package and version in `allowScripts`.
- Run `npm run release:verify` from a clean checkout.
- Create release files only from that verified `out/` directory with `node scripts/create-release-artifact.mjs`. Never rebuild during deployment.
- Verify `SHA256SUMS`, then compare every static file with `release-files.json`. The archive, inventory, CycloneDX SBOM, and checksums must come from the same GitHub release and artifact attestation.
- Confirm `out/index.html`, `out/_headers`, `out/sw.js`, `out/manifest.webmanifest`, and the icon files exist.
- Deploy the contents of the exact `stellarkey-<version>.tar.gz` release archive to an HTTPS static host that applies `_headers`. Do not rebuild it and do not add an application-server requirement.
- Treat a bundle-budget, production-audit, Chromium, iPhone WebKit, or iPad WebKit failure as release-blocking.

## Manual device boundaries

- On a real iPhone, test Safari onboarding, encrypted-backup restore, lock/unlock, form entry, safe areas, and Add to Home Screen cold launch. Pinch zoom remains disabled by product requirement; VoiceOver and system text remain usable.
- On a real iPad, repeat the installed-app, rotation, modal, keyboard, and account-menu lock flows.
- Create a passkey on a real compatible Apple device, lock and unlock with Face ID or Touch ID, verify password fallback, and confirm removal rejects a wrong current password.
- Connect a real supported Trezor, verify the address on-device, review a small testnet transaction on-device, and confirm cancellation and disconnect errors fail closed.
- Test a small-value mainnet payment only after independently checking the destination, asset issuer, memo, fee, network, and signing-device display.

## Local-first and recovery checks

- Export and verify an encrypted backup before installing or replacing the app. Restore it into a fresh browser profile and compare every account address.
- Confirm new files use wallet backup envelope version 2. Legacy plaintext version 1 backups are not supported; create a fresh encrypted backup on the source device.
- Treat the Tax Records merchant archive as a portable encrypted record set, not an independent wallet backup. Full encrypted wallet backups include the matching vault and merchant key required for recovery.
- Confirm endpoint overrides reject HTTP, credentials, fragments, and the wrong Stellar network. Verify both Horizon and RPC reset to the built-in defaults.
- Confirm offline cold launch exposes only the cached application shell; wallet, merchant, price, and Horizon responses must not enter the service-worker cache.
- Confirm merchant encrypted records survive reload and that a second tab cannot overwrite a newer revision.
- Confirm merchant documentation describes payment monitoring as foreground-only. An open checkout may keep the screen awake; closing or suspending the browser pauses checks, and reopening and unlocking must reconcile missed payments. Do not describe this as background monitoring without adding a backend.

## Accepted dependency boundary

`@trezor/connect-web@9.7.3` is the current published package and brings ten low-severity `elliptic` findings through its Bitcoin-support dependency tree. npm reports no fixed Trezor release. High and critical production advisories remain release-blocking; re-evaluate this exception whenever Trezor publishes an update.
