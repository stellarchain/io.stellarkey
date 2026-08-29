# Production deployment runbook

This runbook covers the static, backend-free StellarKey application. A production deployment serves one already verified artifact; it never installs dependencies or rebuilds source on the hosting platform.

## 1. Release authority and prerequisites

- Protect the default branch and `v*` tags. Require review, a passing release gate, signed or otherwise verified release authority, and least-privilege GitHub and hosting access with phishing-resistant MFA.
- Confirm the release workflow ran from the intended clean commit. Download the exact release artifact, `SHA256SUMS`, `release-files.json`, SBOM, and provenance attestation from that GitHub release.
- Run `sha256sum --check SHA256SUMS` in a clean directory, inspect the attestation subject, and confirm every extracted file matches `release-files.json` before upload.
- Treat the artifact as immutable. Never patch generated JavaScript, service-worker files, headers, or metadata in place.

## 2. Trezor production gate

The source retains optional Trezor support, but `@trezor/connect-web` is separately licensed. Before distributing a production bundle containing it, obtain and archive written permission or authorization for the intended public distribution, or replace it with a permissibly licensed integration. Confirm the registered Trezor production origin is exactly `https://stellarkey.io`, the popup flow works from that origin, and the current dependency license notice is shipped. This is a release blocker, not a documentation-only check.

## 3. DNS, mail, and TLS

- Use registrar lock, registry lock where available, hardware-backed MFA, separated registrar/DNS roles, recovery contacts, and monitored expiry and nameserver changes.
- Choose one canonical host. Redirect the `www` host to the `https://stellarkey.io` apex with a permanent HTTPS redirect; do not serve two independent application origins.
- Issue and automatically renew a TLS certificate covering the apex and `www`. Require TLS 1.2 or newer, redirect HTTP before content, enable HSTS only after every subdomain is ready, and monitor certificate transparency.
- Configure the intended MX provider. Publish restrictive SPF, aligned DKIM signing, and DMARC beginning in report mode before progressing to quarantine or reject. Monitor aggregate reports and keep addresses obfuscated on static pages.
- Keep DNSSEC enabled if the registrar, DNS provider, and incident process support safe key rollover.

## 4. Static-host configuration

Upload only the extracted release contents. The archive contains the exported `out/` tree; configure the host so requests resolve from that directory without rewriting immutable assets to the document shell.

The host must apply `out/_headers` exactly, including the Content-Security-Policy, Cross-Origin-Opener-Policy, X-Content-Type-Options, frame restrictions, Referrer-Policy, and Permissions-Policy. Verify MIME types for JavaScript, CSS, SVG, PNG, JSON, web manifest, and service-worker responses. Serve `sw.js`, `release.json`, `manifest.webmanifest`, and HTML with revalidation; serve content-hashed static assets as immutable.

Validate the apex-to-www or www-to-apex redirect, canonical metadata, `/.well-known/security.txt`, `/security`, `/support`, `/release.json`, icons, offline shell, and a real 404 response. Ensure route fallback does not return HTML with status 200 for missing assets.

### Cloudflare Pages setup

StellarKey uses a **Direct Upload** Pages project named `stellarkey`; do not connect Cloudflare's Git integration because the release workflow must deploy the already verified GitHub release archive without rebuilding it.

1. In Cloudflare, open **Workers & Pages → Create application → Pages → Direct Upload**. Set the project name to `stellarkey`, upload any current verified `out/` directory for the one-time project creation, and leave the generated `*.pages.dev` address available as a preview origin.
2. Open **My Profile → API Tokens → Create Token → Custom token**. Grant only **Account → Cloudflare Pages → Edit** for the account that owns the project. Copy the token once and record its rotation owner and expiry.
3. Copy the account ID from the Cloudflare account overview.
4. In the GitHub repository, create an environment named `production`. Protect it with required reviewers when more than one trusted maintainer is available, and restrict deployment branches/tags to protected release tags.
5. Add environment secrets named `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Do not add them to source, workflow files, Pages variables, or local `.env` files.
6. In the Pages project, add `stellarkey.io` as the production custom domain. Add `www.stellarkey.io` only to redirect it permanently to the apex; do not publish a second wallet origin because passkeys and browser storage are origin-bound.

Pushing a signed, protected `v*` tag runs the complete release gate, publishes and attests the immutable archive on GitHub, downloads that same archive in the protected `production` job, verifies `SHA256SUMS` and the embedded commit, and deploys it with a pinned Wrangler action and CLI version. The deployment must never run from an ordinary branch push.

## 5. Promotion and smoke test

Deploy the exact artifact to an isolated preview origin first. Compare its release commit and file hashes, then test unlock, backup export/restore, send review, testnet submission and reconciliation, swap quoting, merchant charge settlement, staged service-worker update, offline reopen, and reset. Use non-production secrets and small testnet amounts.

Promote the same bytes to production. On physical iPhone/iPad and a desktop browser, verify install, safe areas, no form zoom, passkey capability handling, cross-origin popup behavior, and the optional hardware path. A Trezor test must use the registered production origin and a physical device.

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
