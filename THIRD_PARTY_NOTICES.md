# Third-party notices

Copyright © 2026 StellarKey.

StellarKey's original source is available under `AGPL-3.0-or-later`. Dependencies and bundled third-party materials remain subject to their own licenses; the generated CycloneDX SBOM shipped with each release is the authoritative inventory for that artifact. Nothing in StellarKey's license grants rights that a third-party licensor has withheld.

## Trezor Connect

The optional hardware-wallet adapter uses `@trezor/connect-web` 10.0.1, published under the MIT license. Preserve its copyright and installed `LICENSE.md` notice when distributing the client. Trezor names and marks remain their owner's property; StellarKey does not claim affiliation or endorsement.

The browser client delegates device transport and approval screens to Trezor Suite Web. The separately hosted Suite service is outside the application lockfile. The matching `@trezor/connect-core` 10.0.1 package is a development-only reference for schema and device-protocol tests and is not imported by application source. The release SBOM inventories the production client graph; development tools retain their own notices.
