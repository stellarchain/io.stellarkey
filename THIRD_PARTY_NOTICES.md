# Third-party notices

Copyright © 2026 StellarKey.

StellarKey's original source is available under `AGPL-3.0-or-later`. Dependencies and bundled third-party materials remain subject to their own licenses; the generated CycloneDX SBOM shipped with each release is the authoritative inventory for that artifact. Nothing in StellarKey's license grants rights that a third-party licensor has withheld.

## Trezor Connect

The optional hardware-wallet adapter depends on `@trezor/connect-web` 9.7.3. That package identifies its license as the **Trezor Reference Source License (T-RSL)**. It is not covered by StellarKey's AGPL license, and the published T-RSL text limits distribution outside a company. Retaining source-level support does not itself grant public redistribution rights.

Before publicly distributing a build containing Trezor Connect, obtain written permission or authorization from Trezor or replace the dependency with an implementation whose license permits the intended distribution. Preserve the package's license notice and verify the current package terms at <https://github.com/trezor/trezor-suite/blob/develop/LICENSE.md>. Trezor names and marks belong to their respective owner; StellarKey does not claim affiliation or endorsement.

## ua-parser-js

Trezor Connect currently brings in `ua-parser-js` 2.x transitively. That package declares `AGPL-3.0-or-later`. Its source and license are available from <https://github.com/faisalman/ua-parser-js>. Re-run the production SBOM and license review whenever the dependency graph changes.
