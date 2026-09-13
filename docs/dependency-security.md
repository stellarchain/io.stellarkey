# Dependency security evidence

## 2026-09-12 — development parser and complete application audit

The installed chain `eslint 9.39.5 → @eslint/eslintrc 3.3.6 → js-yaml`
now resolves 4.3.2, the compatible patch for
[GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh).
Only that package's version, registry URL and integrity changed in the dependency
update. Tests resolve the parser from ESLint's installed adapter, load and
normalize an ordinary YAML configuration through `@eslint/eslintrc`, and reject
malformed input through the same adapter. The parser/version and audit-gate
regressions failed before the fix; all 11 dependency-governance tests pass after it.

`verify:application` retains its production audit and now also runs
`npm audit --audit-level=high` including development dependencies. Fresh full
and production audits each report **10 low vulnerable packages, no moderate,
high or critical findings, and one distinct advisory** (elliptic). The full
graph previously had 11 vulnerable packages, including the high-severity YAML
finding, across two distinct advisories. Package counts include transitive
parents and are not counts of independent vulnerabilities.

No major dependency upgrade, cryptographic replacement, hardware removal or
gate waiver was made. The embedded-browser, remote Trezor core, unpatched
elliptic and distribution-authorization limits documented below still apply.
The 1.5.0 lockfile provenance pins were regenerated with the release metadata.
Field comparison found only `release.toolchainLockSha256` in the development
and public manifests, the public catalogue's manifest digest, and the two
generated TypeScript pins changed. A second complete `private:check-generated`
passed with stable bytes. The generator's publish-deployment option writes local
files from existing evidence; no contract was deployed or proving artifact changed.
Focused checks alone are not a clean-tree release verification.

## Historical evidence — 2026-09-07

The production npm audit passes its high/critical threshold after the scoped
TOML fix below. This is evidence about the installed dependency graph. Embedded
upstream browser code and Trezor's remote core remain separate review boundaries.
Application release version remains 1.4.1.

## Installed graph and upstream status

Fresh `npm view` queries reported `@trezor/connect-web` latest stable 9.7.3,
10.0.0-beta.1 under the beta tag, TOML latest 5.0.0, and elliptic latest 6.6.1.
The installed graph is:

```text
@trezor/connect-web 9.7.3 → @trezor/connect 9.7.3
  → @trezor/blockchain-link 2.6.2 → @stellar/stellar-sdk 14.2.0 → toml 4.2.0
  → @trezor/blockchain-link-utils 1.5.2 → @stellar/stellar-sdk 14.2.0 → toml 4.2.0
  → @trezor/utxo-lib 2.5.0 → tiny-secp256k1 1.1.7 → elliptic 6.6.1
  → @trezor/blockchain-link 2.6.2 → crypto-browserify 3.12.0
      → browserify-sign 4.2.6 / create-ecdh 4.0.4 → elliptic 6.6.1
```

The application's SDK remains 17.0.1 and uses `smol-toml`; the override applies
only to SDK 14.2.0. The lockfile changes only the TOML package record. Existing
protobufjs and underscore overrides are preserved. The registry package metadata
is available for [Trezor 9.7.3](https://www.npmjs.com/package/@trezor/connect-web/v/9.7.3)
and [Stellar SDK 14.2.0](https://www.npmjs.com/package/@stellar/stellar-sdk/v/14.2.0).

`npm audit --omit=dev --audit-level=high --json` reported:

| Installed graph | Vulnerable packages | Direct distinct advisories | Exit |
| --- | --- | --- | --- |
| Before | 13: 8 low, 5 high | 3: two TOML, one elliptic | 1 |
| After | 10 low; no moderate, high, or critical | 1: elliptic | 0 |

These are npm's package-level counts, including transitive parent findings, not
thirteen or ten separate vulnerabilities. Some parent packages move from high
to low after the TOML paths are fixed.

## Parser compatibility

TOML 4.2.0 is the minimum upstream release covering both
[prototype pollution](https://github.com/BinaryMuse/toml-node/security/advisories/GHSA-v5mp-jgw5-2x6j)
and [unbounded recursion](https://github.com/BinaryMuse/toml-node/security/advisories/GHSA-82x6-q7mm-w9cf).
Both 3.0.0 and 4.2.0 export CommonJS `parse(input)` and convert the input to a
string; 4.2.0 adds optional parser options. Its Node >=20 requirement fits the
project's >=22.22.2 range. Choosing 4.2.0 avoids unrelated TOML 5 integer-return
and range changes. See the [4.2.0 entry point](https://github.com/BinaryMuse/toml-node/blob/v4.2.0/index.js)
and [upstream changelog](https://github.com/BinaryMuse/toml-node/blob/master/CHANGELOG.md).

The actual nested `lib/stellartoml` resolvers call `httpClient.get` and then
`parse(response.data)`, with a 100 KiB response limit and zero redirects by
default. Tests replace that HTTP boundary, resolve ordinary metadata with strings,
integer decimals and booleans, reject malformed and deeply nested input, and
exercise two prototype traversal variants in disposable processes. Four safety
assertions failed before the override and passed afterward.

Error rejection is preserved, but diagnostic coordinates are not identical:
TOML 4 syntax errors use `location.start` while SDK 14's wrapper reads `line` and
`column`. Its malformed-input message therefore contains undefined coordinates.
The SDK wrapper was not patched, and no application authorization or signing
decision relies on those coordinates.

Hardware tests also run the application's payloads through installed Trezor
`AssertWeak`, path validation and `stellarSignTx` conversion. Synthetic device
responses cover both network passphrases, operation sources, exact amounts,
offers, asset issuers, trustline limits, text/return memos and signature validation.
Real nested-SDK Trezor utility builders and transaction transformation are tested
across the application's SDK boundary. `getTokenMetadata` in those utilities
fetches Trezor definition JSON; it is not a TOML resolver call. No hardware adapter
source or cryptographic implementation changed.

## Runtime boundaries and remaining risk

| Boundary | Observed result and limit |
| --- | --- |
| Installed Node SDK resolvers | Both use overridden TOML 4.2.0; regression and compatibility tests pass. |
| SDK 14 browser exports | Both point to prebuilt `dist/stellar-sdk.min.js`. Isolated execution of each actual bundle with synthetic HTTP responses still reproduces prototype pollution and lacks the new nesting bound. npm overrides do not rewrite embedded code. |
| Local application browser client | `hardware.ts` imports connect-web and explicitly selects popup core mode. A literal CommonJS import trace from connect-web visited 436 files without a Stellar SDK import. Fresh production chunks contain popup client code and none of the searched old-parser diagnostic markers. This source/marker inspection is not a complete browser reachability or absence proof. Generic `StellarToml` text also exists in the application's SDK 17 code and does not identify the old parser. |
| Remote Trezor popup core | connect-web forwards calls over the popup channel. The local lockfile override cannot patch that separately hosted code. Its deployed parser version and complete reachable dependency graph were not established by these checks. |

The remaining [elliptic advisory](https://github.com/advisories/GHSA-848j-6mx2-7j84)
affects <=6.6.1 and lists no patched version. It concerns particular ECDSA signing
conditions; this does not establish exposure of Stellar Ed25519 keys. The installed
paths through UTXO support and browser crypto remain documented, without replacing
cryptography or claiming they are unreachable in every upstream runtime.

An upstream stable fix for embedded SDK code and verified remote-core provenance
remain external limits. Changing signing architecture or removing hardware
functionality requires a separate security decision. Do not interpret the passing
installed audit as proof that all upstream browser or remote code is fixed. Keep
the [T-RSL distribution authorization](../THIRD_PARTY_NOTICES.md), registered-origin
and [physical-device release gates](release-checklist.md) in force. The development
branch's MIT-licensed Trezor 10 beta is not a reviewed stable migration or a change
to the installed 9.7.3 license.

## Verification scope

Before the provenance follow-up below, task-specific checks passed: 32 hardware tests, all 1,713 root Node tests,
TypeScript, ESLint (zero errors, three existing marketing-image warnings),
production build, five bundle tests, every unchanged bundle
budget, and fixture cleanup before/after build. Hardware incremental JavaScript
measured 1,047,527 raw / 210,139 gzip bytes. The tests use synthetic in-memory
transactions, isolated prototype witnesses and mocked HTTP/device boundaries;
they do not open a live wallet, contact a device, fund an account or broadcast a
transaction. Full application verification and human/physical release evidence
remain separate requirements. These checks used a local working-tree build;
they are not clean-tree release verification or a published release artifact.

The first independent clean-tree `release:verify` passed its clean preflight but
stopped at `private:check-generated`: the TOML lockfile update made five generated
provenance files stale. The existing generator includes the root lockfile in
`release.toolchainLockSha256`. Refreshing that digest in the development and
public manifests changes the public manifest digest, its catalogue entry, and
the two generated TypeScript pins.

The existing local `private:check-generated` command regenerated these outputs
and then passed with stable bytes. Its `--publish-deployment` step writes local
files from existing deployment evidence; this follow-up did not deploy a
contract, change a deployment identity or development flag, alter protocol or
cryptographic source, modify proving artifacts or vectors, or create ceremony
evidence. An independent field comparison confirmed only the lockfile digest
and cascading pins changed.

The subsequent clean-tree `release:verify` passed at
`d4edc1d95036d7f5f81ae5f3bbe6b25fde03cea4`: 1,716 root Node tests, 58 nested
protocol tests, both reporter probes, all 528 required browser checks, the
production build and unchanged bundle budgets, and 114 active normal browser
checks. The normal matrix also recorded 278 intentional skips; required suites
had none. These are historical application results; separate Rust/circuit and
human/physical-device evidence remain required by the
[release checklist](release-checklist.md). This passing application command does not
resolve the embedded-parser, remote-core, elliptic or distribution-authorization
limits above and is not a tagged release certification.
