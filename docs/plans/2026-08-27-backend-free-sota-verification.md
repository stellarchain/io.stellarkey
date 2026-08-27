# Backend-Free SOTA Verification

Verified on 27 August 2026 against branch `codex/backend-free-sota`.

## Delivered boundaries

| Area | Verified behavior |
| --- | --- |
| Deployment | Next.js produces only static output in `out/`; the generated CSP hashes inline bootstrap scripts and the service worker caches only the application shell. |
| Recovery | Backup payloads are fully decoded before mutation; checked writes roll back on failure; export and verification health are tracked locally. |
| Local persistence | Merchant records migrate copy-verify-switch into encrypted IndexedDB and use serialized, revision-checked transactions. |
| iOS handoff | Existing wallets require a current verified backup before the install flow; an empty installed app explains browser-storage separation and recovery. |
| Key handling | Vault v3 wraps a random master key; session state does not retain the password or mnemonic; software secrets are decrypted or derived only inside scoped operations. |
| Device unlock | WebAuthn PRF can wrap the existing master key locally; password unlock remains available; adding and removing the wrapper require the current password. |
| Stellar connectivity | HTTPS Horizon/RPC endpoints are network-checked; reads have bounded time, size, abort, retry, and typed-error behavior; multi-account loading can partially settle. |
| Merchant monitoring | The till communicates foreground-only monitoring, uses Screen Wake Lock when available, and catches up immediately after visibility returns. |
| Performance | Locked/onboarding paths avoid eager merchant initialization, wallet refreshes are coalesced, lazy feature boundaries are in place, and the static JS bundle has an enforced budget. |
| Browser quality | Desktop Chromium plus iPhone and iPad WebKit profiles exercise onboarding, dashboard, lock/unlock, send review, settings, merchant setup/till, responsive overflow, and blocking accessibility rules. |
| Supply chain | GitHub Actions use commit SHAs, Node/npm versions are explicit, dependency lifecycle scripts are approved by exact package version, and high/critical production advisories fail the release. |

## Automated evidence

The canonical command is:

```bash
npm run release:verify
```

It must pass type checking, the complete Node test suite, lint, the production audit, static export, bundle-budget verification, and every configured Playwright project. CI additionally checks that `out/index.html` exists after the run.

Observed result for this verification:

- TypeScript and ESLint completed without errors.
- 442 of 442 Node tests passed.
- The static export generated all five routes and authorized five inline bootstrap hashes.
- Initial JavaScript measured 1,100,780 raw bytes and 318,629 gzip bytes across 13 chunks, within the enforced budget.
- 12 of 12 Playwright tests passed: the desktop Chromium suite plus the critical wallet/merchant journey on iPhone and iPad WebKit profiles.
- The production audit passed its high-severity threshold with the accepted ten low-severity Trezor-transitive findings described below.

The browser suite covers deterministic network fixtures; it does not present emulated results as public-network or hardware proof. The production audit currently reports ten low-severity `elliptic` findings inherited through `@trezor/connect-web@9.7.3`; npm exposes no fixed Trezor package, and the gate continues to reject high or critical findings.

## Manual evidence still required for each release

- A real iPhone and iPad: Safari and Add to Home Screen, safe areas, keyboard/form behavior, rotation, lock/unlock, encrypted-backup recovery, and a cold installed launch.
- A compatible Apple device: WebAuthn PRF registration, Face ID / Touch ID unlock, cancellation, password fallback, and password-authorized removal.
- A physical Trezor: address verification, a small testnet signature, cancellation, and disconnect behavior on the device and in the app.
- A static HTTPS host: application of `out/_headers`, cold service-worker launch, and correct asset delivery.
- A deliberately small mainnet transfer: independent review of destination, complete asset identity, issuer, memo, network, fee, and the signing-device display.

These checks are release requirements, not backend requirements. Pinch zoom remains intentionally disabled by product requirement.
