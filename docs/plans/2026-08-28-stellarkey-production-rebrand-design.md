# StellarKey Production Rebrand Design

## Goal

Rebrand the backend-free wallet as **StellarKey**, make `https://stellarkey.io` its canonical production origin, and add the identity, legal, security, discovery, deployment, and verification surfaces required for a credible production release.

## Product identity

The user-facing product name is `StellarKey`; the production domain is `stellarkey.io`; the copyright owner is `StellarKey`; and dedicated support and security mailboxes live on the production domain. A small shared brand module will own these values in encoded form so application metadata, the PWA manifest, Trezor Connect, legal notices, documentation, and visible UI cannot drift apart or expose complete addresses to basic source scrapers.

The private npm package will be renamed from `0x` to `stellarkey`. Existing browser storage namespaces such as `polaris.*` and `wallet.*` will not be renamed because changing them would strand existing encrypted vaults, preferences, and merchant records.

Next.js metadata will use the production origin, a descriptive StellarKey title, canonical URLs, Open Graph and Twitter sharing data, application naming, and Apple web-app naming. The existing logo remains the application icon. The web app manifest will retain the root start URL and scope while adopting the StellarKey identity and production-quality install metadata. Trezor Connect will identify the application as StellarKey and use the production origin and support contact.

Public onboarding and lock surfaces will show a restrained copyright footer. Unlocked Settings will expose an About & Legal destination. The notices will include `© 2026 StellarKey. All rights reserved.`, legal and security links, a “Built on Stellar” statement, and the independent-project and trademark language required by the Stellar Development Foundation brand policy. The UI must never imply that StellarKey is affiliated with, sponsored by, or endorsed by SDF.

## Legal, privacy, and security surfaces

Four static, directly linkable pages will remain available without unlocking a wallet:

- **About** explains the product, supported networks, backend-free architecture, self-custody model, current version, and independent status.
- **Privacy** explains local encrypted storage, the absence of application accounts, analytics, advertising, and telemetry, and the direct third-party requests made to Horizon/RPC endpoints, market-data providers, issuer domains, and Trezor.
- **Terms** explains self-custody, irreversible transactions, backup and verification responsibilities, third-party dependencies, merchant-record limitations, prohibited misuse, and software/warranty boundaries.
- **Security** documents the trust model, responsible disclosure process, secure-origin requirement, supported release, and sensitive information that must never be included in a report.

These documents are accurate engineering disclosures, not a substitute for jurisdiction-specific legal advice. A qualified solicitor should review them before the operator accepts real customers.

Visible contact controls will construct the support and security addresses from separate fragments only when the user interacts with them. Complete email addresses will not appear in server-rendered HTML, metadata, or static policy prose. This prevents basic harvesting but does not claim protection against JavaScript-aware scrapers.

An RFC 9116 resource at `/.well-known/security.txt` will use the HTTPS Security page as its Contact and Policy destination instead of publishing the raw security mailbox. It will also provide a canonical URL, preferred language, and explicit expiry.

## Production discovery and offline behavior

The canonical origin will be consistent across Next.js metadata, the web app manifest, Open Graph/Twitter sharing data, `robots.txt`, `sitemap.xml`, `/.well-known/security.txt`, structured `SoftwareApplication` data, and Trezor application identity. Error, offline, onboarding, lock, settings, and hardware-facing copy will use StellarKey consistently.

The application remains a static export with no application API, database, relay, session service, or analytics backend. Existing CSP hashes, HTTPS requirements, local encryption, and popup-compatible Trezor policy remain authoritative. The About, Privacy, Terms, and Security routes will join the offline shell so installed users can review the disclosures without a network connection.

The deployment checklist will cover TLS, canonical apex handling, `www` redirection, MIME types, generated security headers, immutable hashed-asset caching, HTML and service-worker revalidation, Trezor origin verification, clean-device installation, encrypted backup recovery, and a small-value mainnet smoke test.

Passkeys and browser storage are origin-bound. Data and passkeys created on a LAN IP, localhost, or another domain do not automatically move to `stellarkey.io`. Users must retain their wallet password and encrypted backup, restore or reopen on the production origin as applicable, and enrol a new passkey there. Release documentation and UI guidance must not imply automatic origin migration.

## Verification

Implementation is test-driven. The first failing tests will require:

- one canonical brand and domain across metadata, manifest, UI, Trezor, and documentation;
- complete public legal routes and footer navigation;
- no complete public contact address in rendered HTML or static policy files;
- valid security.txt, robots, sitemap, icon, canonical, sharing, and structured-data surfaces;
- responsive legal pages on narrow iPhone WebKit;
- offline access to the public disclosure routes; and
- preservation of existing storage namespaces and security policy.

The final gate will run type checking, all unit tests, lint, the production dependency audit, static export, CSP and service-worker generation, bundle budgets, desktop Chromium journeys, and iPhone/iPad WebKit accessibility journeys. The built `out/` directory will also be inspected for canonical URLs, raw contact leakage, well-known resources, and correct content types.
