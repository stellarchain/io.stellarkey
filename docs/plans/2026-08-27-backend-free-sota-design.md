# Backend-Free SOTA Design

## Product boundary

Wallet remains a self-custodial static web application. Production consists only of immutable HTML, CSS, JavaScript, images, a manifest, and a service worker served over HTTPS. The application owns no API, database, relay, indexer, session service, or notification service. It talks directly to user-selected or bundled public Stellar Horizon/RPC endpoints, issuer home domains, market-data services, and Trezor Connect. Those are external network dependencies, not an application backend. Every core wallet operation remains usable without an account with Wallet's operator, and all key material and merchant records remain on the device.

The static deployment replaces request-time CSP nonces with Next.js build-time SRI and a deployment-ready static header policy. Development keeps its LAN allowances, while production output is verifiably free of dynamic routes and server-only request APIs. The service worker caches only the static shell; wallet records and network responses are never cached there. Pinch zoom remains intentionally disabled, matching the existing mobile product requirement.

The scope is the audit's concrete improvements, not speculative integrations. Placeholder Wallet Standard and Soroban screens are removed until they have a complete client-only workflow. Direct RPC configuration is added as infrastructure for future Soroban support. A web page cannot inject a provider into another origin, and a persistent dApp relay would violate the backend-free boundary, so the application will not imply otherwise.

## Durable local data and recovery

Merchant operational data moves from one synchronous localStorage blob to encrypted IndexedDB. The current encrypted envelope remains the migration source and emergency export format. Migration is copy-verify-switch: decrypt and validate the existing envelope, write it to IndexedDB, read and authenticate it, and only then remove the old record. Writes are serialized, transactional, verified, and never alter the user's configured retention merely because quota is low. Quota or persistence failures visibly block the action instead of claiming success. Storage health uses `navigator.storage.estimate()`, `persisted()`, and `persist()` when available.

Wallet metadata remains small enough for localStorage in this release, but backup restore becomes failure-atomic: decode and validate the complete payload before mutation, snapshot every target key, apply checked writes, and restore the snapshot on any failure. This provides deterministic rollback for quota and policy errors without requiring a database. Backup metadata records the last successful export and last successful verification locally. The install flow detects iOS/browser-to-standalone storage separation, warns before installation, and requires a current encrypted backup when a wallet already exists. Empty standalone onboarding explains how to restore the pre-install wallet.

Merchant monitoring remains explicitly foreground-only. The terminal requests Screen Wake Lock while active, releases it on hide/unmount, reconnects and polls immediately when visible again, and communicates that closed or suspended browsers cannot provide background settlement guarantees without a server.

## Vault and passkey architecture

Vault schema v3 introduces a random 256-bit master key. The password-derived PBKDF2 key wraps only that master key; mnemonic, imported secrets, private notes, and merchant subkeys are encrypted or derived beneath it. Unlock retains the master key in zeroable byte storage, not the password, mnemonic, or every account secret. Software account secrets are decrypted or derived just in time for a reviewed signing operation and discarded immediately afterward. Existing v1/v2 vaults migrate after a successful password unlock and retain their account identifiers and public metadata.

Password backup export and security-sensitive account changes ask for the password at the point of use and verify it by unwrapping the master key. This removes the need for a session-long plaintext password. Hardware and watch-only vaults use the same wrapped random master key for private notes and merchant data even though they hold no Stellar secret.

Optional Face ID/Touch ID unlock uses the WebAuthn PRF extension. A platform credential derives a local wrapping key for the same vault master key; no assertion is sent anywhere. Capability is accepted only when registration and authentication return real PRF output. Password unlock and encrypted recovery remain mandatory fallbacks. Enabling or removing passkey unlock requires the current password, and failures never weaken or replace the password wrapper.

## Network, performance, and release quality

All Horizon traffic uses one bounded client with timeout, response-size, caller-abort, typed error, and limited retry behavior. Only idempotent reads retry, respecting `Retry-After` for rate limits and using bounded jittered backoff. Account balances settle independently instead of waiting for the slowest account. Network settings expose HTTPS-only custom Horizon and RPC endpoints, validate them against the expected network, measure health, and allow reset to defaults. No API key is bundled.

The initial bundle is reduced by removing request-time infrastructure, lazy-loading merchant and advanced signing domains after unlock/feature selection, and splitting broad wallet/merchant contexts into stable state and action subscriptions where this can be done without changing behavior. A build assertion protects the first-load budget.

Release gates cover Chromium desktop and WebKit iPhone/iPad profiles. Behavioral tests replace source-regex assertions for every changed path: static cold launch, storage migration and quota failure, backup rollback, passkey capability/fallback, visibility and wake-lock recovery, endpoint validation/retry, and major wallet/merchant journeys. CI pins its action revisions, installs Chromium and WebKit, runs accessibility scanning for critical screens, audits production dependencies, and verifies the static export. Physical Trezor and real installed-iOS checks remain a documented manual release requirement because emulation cannot prove those hardware/browser boundaries.
