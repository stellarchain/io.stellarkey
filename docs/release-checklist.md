# Backend-free wallet release checklist

This wallet ships as static files and talks directly to user-selected Stellar services. It has no application backend, remote custody service, background worker, or server-side database.

## Automated release gate

- Use Node 22.22.2+ and npm 11.19.0+ from the supported ranges in `package.json`.
- Install exactly from `package-lock.json` with `npm ci`. Review any new dependency install-script request; approved scripts are pinned by package and version in `allowScripts`.
- Run `npm run release:verify` from a clean checkout.
- Confirm `out/index.html`, `out/_headers`, `out/sw.js`, `out/manifest.webmanifest`, and the icon files exist.
- Deploy the contents of `out/` to an HTTPS static host that applies `out/_headers`. Do not add an application-server requirement.
- Treat a bundle-budget, production-audit, Chromium, iPhone WebKit, or iPad WebKit failure as release-blocking.

## Manual device boundaries

- On a real iPhone, test Safari onboarding, encrypted-backup restore, lock/unlock, form entry, safe areas, and Add to Home Screen cold launch. Pinch zoom remains disabled by product requirement; VoiceOver and system text remain usable.
- On a real iPad, repeat the installed-app, rotation, modal, keyboard, and account-menu lock flows.
- Create a passkey on a real compatible Apple device, lock and unlock with Face ID or Touch ID, verify password fallback, and confirm removal rejects a wrong current password.
- Connect a real supported Trezor, verify the address on-device, review a small testnet transaction on-device, and confirm cancellation and disconnect errors fail closed.
- Test a small-value mainnet payment only after independently checking the destination, asset issuer, memo, fee, network, and signing-device display.

## Local-first and recovery checks

- Export and verify an encrypted backup before installing or replacing the app. Restore it into a fresh browser profile and compare every account address.
- Confirm endpoint overrides reject HTTP, credentials, fragments, and the wrong Stellar network. Verify both Horizon and RPC reset to the built-in defaults.
- Confirm offline cold launch exposes only the cached application shell; wallet, merchant, price, and Horizon responses must not enter the service-worker cache.
- Confirm merchant encrypted records survive reload and that a second tab cannot overwrite a newer revision.
- Confirm merchant payment monitoring says foreground-only. Closing or suspending the browser pauses checks; reopening and unlocking must reconcile missed payments. Do not describe this as background monitoring without adding a backend.

## Accepted dependency boundary

`@trezor/connect-web@9.7.3` is the current published package and brings ten low-severity `elliptic` findings through its Bitcoin-support dependency tree. npm reports no fixed Trezor release. High and critical production advisories remain release-blocking; re-evaluate this exception whenever Trezor publishes an update.
