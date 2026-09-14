# Production deployment runbook

This runbook covers the static, backend-free StellarKey application. A production deployment serves one already verified artifact; it never installs dependencies or rebuilds source on the hosting platform.

## 1. Release authority and prerequisites

The GitHub Actions release workflow verifies a clean protected `v*` tag, publishes
and attests the exact release artifact, and deploys that archive through the
protected `production` environment. Ordinary branch pushes run CI, not deployment.
Tagging a future release requires explicit maintainer release and hosting authority.
Never rebuild during deployment: publish and deploy the exact release artifact
from the verified output.

The workflows install the following pinned toolchains. For local verification:

1. Install the locked dependencies with Node 22.22.2 and npm 11.19.0. Review
   dependency lifecycle execution; the repository disables install scripts.
2. Install Rust 1.97.1, its wasm32v1-none target, Circom 2.2.3, Circomspect 0.9.0,
   cargo-deny 0.20.2 and the checksum-verified Stellar CLI 27.0.0 through
   scripts/ci/install-stellar-cli.mjs. Linux needs libdbus-1-3 and libudev1.
3. Build CIVER from https://github.com/costa-group/circom_civer.git at exact commit
   af7d4ed0325e6f7743d8a1ac0e415d0c69b8aae8. Set CIVER_SOURCE_COMMIT to that
   verified checkout identity and CIVER_CIRCOM to its civer_circom executable.
4. Run the circuit check on Linux and canonical reproduction on macOS ARM64.
   Neither result replaces the other. Record commands, environments, source
   identities, exit codes and timestamps; unchanged prior evidence must be labelled
   with its original date and scope, never presented as a fresh run.

```sh
npm run verify:private-rust
npm run verify:private-circuits
npm run verify:private-artifacts
npm run verify:private-model
npm run release:verify
node scripts/create-release-artifact.mjs
```

Run the application gate from a clean committed checkout. It owns the production
build. Create artifacts only from that verified out/ directory. Verify SHA256SUMS
and every entry in release-files.json before publication. For a future release,
update the version and changelog, complete the release checklist, create the
corresponding protected tag, and push it to run `.github/workflows/release.yml`.
The workflow uploads the verified files and deploys them without rebuilding.

The existing `v1.0.0` release was published manually. It has GitHub's immutable-release
attestation but no GitHub Actions build-provenance attestation. Restoring workflows
does not rerun its tag, attest its build retroactively, or deploy it automatically.
Do not recreate that tag, overwrite its assets, or bypass the workflow's provenance
check to deploy it. Any separately authorised manual deployment of `1.0.0` must
verify its immutable-release attestation, asset checksums, file inventory and
embedded source commit, and explicitly retain this build-provenance limitation.

### Repository security settings

Before release, inspect and record the actual repository settings:

- GitHub Actions is enabled for CI, tagged releases and scheduled recovery-model
  checks. Workflow and composite-action dependencies are pinned by commit SHA.
- CodeQL default setup, the dependency graph, Dependabot alerts and security
  updates are enabled. Weekly version-update proposals remain review-only;
  never enable automatic merging as part of release-history cleanup.
- Secret scanning and push protection remain enabled. Review any bypass separately.
- The protected main branch uses the sole-maintainer policy: pull requests, resolved
  conversations, zero required external approvals, and no force pushes or deletion.
  Require the `verify`, `Private Balance Gate A` and `Private Balance Rust Security`
  checks after workflow restoration. A passing application command does not replace
  the independent circuit and Rust checks.
- Protected v* tags and immutable releases remain enabled. Commit-history recovery
  does not restore retired release tags or modify published `v1.0.0` assets.
- The existing protected production environment remains restricted to `v*` tags
  and holds the least-privilege `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`
  secrets. It has no external-reviewer requirement under the sole-maintainer policy.

These are required settings, not proof of their live state. Read back GitHub settings
and check the intended commit's successful runs before promotion. Delete old workflow
runs separately from workflow definitions; historical logs are not the deployment setup.

The v1.0.0, v1.0.1 and v1.0.2 release exceptions in the release checklist record the maintainer's
explicit, release-specific deferrals of human/device and Trezor redistribution/origin sign-off.
Those checks are not evidence of a pass and the exception grants no license rights.

## 2. Trezor production gate

The source retains optional Trezor support, but `@trezor/connect-web` is separately licensed. Before distributing a production bundle containing it, obtain and archive written permission or authorization for the intended public distribution, or replace it with a permissibly licensed integration. Confirm the registered Trezor production origin is exactly `https://stellarkey.io`, the popup flow works from that origin, and the current dependency license notice is shipped. This is a release blocker, not a documentation-only check.

The installed high/critical dependency gate passes as of 2026-09-07 after a scoped
TOML parser override. Ten low-severity vulnerable packages remain under one
`elliptic` advisory. The override does not update the SDK's prebundled browser
parser or Trezor's remote popup core; review the [dependency evidence and runtime
limits](dependency-security.md) before release. The installed stable 9.7.3 license,
registered-origin approval, and physical-device checks still apply independently
of the audit result.

## 3. DNS, mail, and TLS

- Use registrar lock, registry lock where available, hardware-backed MFA, separated registrar/DNS roles, recovery contacts, and monitored expiry and nameserver changes.
- Choose one canonical host. Redirect the `www` host to the `https://stellarkey.io` apex with a permanent HTTPS redirect; do not serve two independent application origins.
- Issue and automatically renew a TLS certificate covering the apex and `www`. Require TLS 1.2 or newer, redirect HTTP before content, enable HSTS only after every subdomain is ready, and monitor certificate transparency.
- Configure the intended MX provider. Publish restrictive SPF, aligned DKIM signing, and DMARC beginning in report mode before progressing to quarantine or reject. Monitor aggregate reports and keep addresses obfuscated on static pages.
- Keep DNSSEC enabled if the registrar, DNS provider, and incident process support safe key rollover.

## 4. Static-host configuration

Upload only the extracted release contents. The archive contains the exported `out/` tree; configure the host so requests resolve from that directory without rewriting immutable assets to the document shell.

During `npm run build`, each exported HTML document receives a long, document-scoped CSP meta policy containing the exact hashes of that document's inline bootstrap scripts. The host must also apply `out/_headers` exactly: that response layer supplies `frame-ancestors 'none'` and the remaining response-only protections, including Cross-Origin-Opener-Policy, X-Content-Type-Options, Referrer-Policy, and Permissions-Policy. A CSP meta element cannot enforce `frame-ancestors`; do not copy the long document policy into one oversized `_headers` line. Verify MIME types for JavaScript, CSS, SVG, PNG, JSON, web manifest, and service-worker responses. Serve `sw.js`, `release.json`, `manifest.webmanifest`, and HTML with revalidation; serve content-hashed static assets as immutable.

Validate the apex-to-www or www-to-apex redirect, canonical metadata, `/.well-known/security.txt`, `/security`, `/support`, `/release.json`, icons, offline shell, and a real 404 response. Ensure route fallback does not return HTML with status 200 for missing assets.

### Cloudflare Pages setup

StellarKey uses a **Direct Upload** Pages project named `stellarkey`; do not connect Cloudflare's Git integration because deployment must use the already verified GitHub release archive without rebuilding it. The tagged release workflow deploys after publication and provenance verification; creating a release manually does not trigger deployment.

1. In Cloudflare, open **Workers & Pages → Create application → Pages → Direct Upload**. Set the project name to `stellarkey`, upload any current verified `out/` directory for the one-time project creation, and leave the generated `*.pages.dev` address available as a preview origin.
2. Open **My Profile → API Tokens → Create Token → Custom token**. Grant only **Account → Cloudflare Pages → Edit** for the account that owns the project. Copy the token once and record its rotation owner and expiry.
3. Copy the account ID from the Cloudflare account overview.
4. In the GitHub repository, create an environment named `production`. Protect it with required reviewers when more than one trusted maintainer is available, and restrict deployment branches/tags to protected release tags.
5. Add environment secrets named `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Do not add them to source, workflow files, Pages variables, or local `.env` files.
6. In the Pages project, add `stellarkey.io` as the production custom domain. Add `www.stellarkey.io` only to redirect it permanently to the apex; do not publish a second wallet origin because passkeys and browser storage are origin-bound.

### Private proving-file compression

The checked-in `circuit.zkey.pc` is a point-compressed, hash-pinned transport that expands locally
to the exact ceremony zkey. Keep it byte-for-byte unchanged. In **Rules → Compression Rules**, add
one rule matching a URI path ending in
`/protocol/private-balance/v1/circuit.zkey.pc`, select Brotli first with gzip as fallback, and keep
the rule scoped to that path. This is required because `application/octet-stream` is not one of
Cloudflare's default compressible media types.

After the preview deploy, request the file from a browser-compatible client with
`Accept-Encoding: br` and confirm `Content-Encoding: br`. Compare the decoded response length and
SHA-256 with `artifacts.zkeyTransport.byteLength` and `artifacts.zkeyTransport.sha256` in the
manifest. The manifest's `wireByteLength` is the reproducible Brotli-11 measurement used by the
wallet's setup copy; the edge response may differ slightly if Cloudflare changes compression
settings. Never set `Content-Encoding: br` on the uncompressed static file itself.

Pushing a signed, protected `v*` tag runs the complete release gate, publishes and attests the immutable archive on GitHub, downloads that same archive in the protected `production` job, verifies `SHA256SUMS` and the embedded commit, and deploys it with a pinned Wrangler action and CLI version. The deployment must never run from an ordinary branch push.

## 5. Promotion and smoke test

Deploy the exact artifact to an isolated preview origin first. Compare its release commit and file hashes, then test unlock, backup export/restore, send review, testnet submission and reconciliation, swap quoting, merchant charge settlement, staged service-worker update, offline reopen, and reset. Use non-production secrets and small testnet amounts.

Promote the same bytes to production. On physical iPhone/iPad and a desktop browser, verify install, safe areas, no form zoom, passkey capability handling, cross-origin popup behavior, and the optional hardware path. A Trezor test must use the registered production origin and a physical device.

Private Payments must remain `development`, Testnet-only, and explicitly disclosed while production-hosted builds permit the exact pinned development fixture. `snarkjs zkey verify` confirms circuit/Powers-of-Tau compatibility; it does not make the single-party setup ceremony-secure. Mainnet and any real-value promotion remain blocked until the same immutable archive contains a reviewed public ceremony, audit, deployment, recovery, semantic-review, CSP, and physical-device evidence. Never create evidence records from a production build or substitute development hashes.

Direct mode self-submits a shielded transfer or withdrawal from the user's public Stellar account,
which is visible on chain and can deanonymise the spend. Fee-bump sponsorship does not remove the
inner source. The wallet supports direct submission only, without peer relaying or helper earnings.
StellarKey 1.0.0 is the starting application baseline. Unsupported encrypted state and
backups fail validation without rewriting data or attempting network recovery.
Current exposed inputs stay held until canonical reconciliation establishes their outcome.

Do not add `Cross-Origin-Embedder-Policy` based on desktop estimates. Cross-origin isolation may
enable multithreaded proving, but it can also break wallet and hardware integrations whose resources
do not opt into CORP. Adoption requires a complete subresource audit and before/after p50, p95, peak-
memory, cancellation, popup, and hardware checks on the supported physical browser/device matrix.

## 6. External probes and monitoring

Run external probes from more than one network for TLS validity, DNS resolution, redirect correctness, HTML availability, `release.json`, `manifest.webmanifest`, `sw.js`, static chunk availability, required response headers, and `security.txt` expiry. Alert on release-commit drift, certificate or domain expiry, changed nameservers, CSP report spikes where reporting is configured, and persistent Horizon/RPC reachability failures.

This app has no backend health endpoint. A successful document response alone is insufficient: probes must fetch at least one content-hashed JavaScript asset and compare the public release commit with the approved release.

## 7. Rollback and service-worker recovery

Keep the last known-good release artifact and checksums. Rollback means atomically repointing hosting to that complete artifact; never mix files from two releases. Verify the public commit, headers, and static chunks after the switch.

The service worker stages an update until the user accepts it and retains the immediately previous cache for live clients. If a release breaks startup, roll back the origin first. Publish a new fixed release with a new cache revision rather than editing `sw.js` in place. Support may ask an affected user to close every tab, reopen, accept the offered update, and only then clear site data as a last resort after confirming a recoverable wallet backup.

## 8. Incident and domain-loss response

For a suspected source, release, hosting, or DNS compromise: freeze releases, preserve audit logs, revoke affected credentials and tokens, remove malicious hosting content, identify the last trusted commit and artifact, and communicate through a separately controlled channel. Do not ask users for wallet secrets. Assume users who signed unreviewed transactions may need asset-issuer or ecosystem guidance, but do not promise reversals.

For domain loss or hijack, do not direct users to a replacement origin until control and provenance can be independently established. Notify the registrar and DNS provider, revoke hosting credentials and certificates where applicable, publish the last trusted commit through the repository release channel, and treat passkeys as origin-bound and unavailable on a different domain. Complete a written post-incident review before resuming releases.

## 9. Routine operations

Monthly, review dependency advisories, third-party licenses, domain/certificate expiries, mail authentication reports, external probes, access lists, and backup/rollback access. Before `security.txt` has fewer than 90 days remaining, update its expiry to no more than one year ahead and release that change. Quarterly, perform a clean restore drill and a complete artifact rollback drill.
