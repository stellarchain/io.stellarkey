import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (relativePath) => readFileSync(new URL(relativePath, root), "utf8");

const governanceFiles = [
  "LICENSE",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "SUPPORT.md",
  "CODE_OF_CONDUCT.md",
  "THIRD_PARTY_NOTICES.md",
  ".github/CODEOWNERS",
  "docs/production-deployment.md",
];

test("the public repository has complete open-source governance", () => {
  for (const relativePath of governanceFiles) {
    assert.equal(existsSync(new URL(relativePath, root)), true, `${relativePath} must exist`);
  }

  const packageJson = JSON.parse(read("package.json"));
  const packageLock = JSON.parse(read("package-lock.json"));
  const license = read("LICENSE");
  const contributing = read("CONTRIBUTING.md");
  const conduct = read("CODE_OF_CONDUCT.md");
  const codeowners = read(".github/CODEOWNERS");
  const readme = read("README.md");

  assert.equal(packageJson.license, "AGPL-3.0-or-later");
  assert.equal(packageLock.packages[""].license, "AGPL-3.0-or-later");
  assert.match(license, /GNU AFFERO GENERAL PUBLIC LICENSE/);
  assert.match(license, /Version 3, 19 November 2007/);
  assert.match(license, /13\. Remote Network Interaction/);
  assert.match(contributing, /Developer Certificate of Origin/i);
  assert.match(contributing, /git commit -s/);
  assert.match(contributing, /npm run release:verify/);
  assert.match(conduct, /Contributor Covenant/i);
  assert.match(codeowners, /^\*\s+@florincm$/m);
  assert.match(readme, /AGPL-3\.0-or-later/);
  assert.match(readme, /THIRD_PARTY_NOTICES\.md/);
});

test("security and support routes are actionable without publishing mailboxes", () => {
  const security = read("SECURITY.md");
  const support = read("SUPPORT.md");
  const securityTxt = read("public/.well-known/security.txt");
  const publicGovernance = governanceFiles
    .filter((path) => path.endsWith(".md"))
    .map(read)
    .concat(read("README.md"), securityTxt)
    .join("\n");

  assert.match(security, /Supported versions/i);
  assert.match(security, /https:\/\/stellarkey\.io\/security/);
  assert.match(security, /do not (?:open|file).*public issue/i);
  assert.match(support, /https:\/\/stellarkey\.io\/support/);
  assert.match(support, /cannot recover/i);
  assert.doesNotMatch(publicGovernance, /[\w.+-]+@stellarkey\.io/i);

  const expires = securityTxt.match(/^Expires:\s*(.+)$/m)?.[1];
  assert.ok(expires, "security.txt must include Expires");
  const expiryTime = Date.parse(expires);
  const minimumMargin = Date.now() + 90 * 24 * 60 * 60 * 1_000;
  const maximumMargin = Date.now() + 366 * 24 * 60 * 60 * 1_000;
  assert.equal(Number.isFinite(expiryTime), true, "security.txt expiry must be an ISO date");
  assert.ok(expiryTime >= minimumMargin, "security.txt must retain at least a 90-day expiry margin");
  assert.ok(expiryTime <= maximumMargin, "security.txt must expire within one year");
  assert.match(securityTxt, /^Canonical: https:\/\/stellarkey\.io\/\.well-known\/security\.txt$/m);
  assert.match(securityTxt, /^Policy: https:\/\/stellarkey\.io\/security$/m);
});

test("production operations cover immutable deploys, recovery, and infrastructure", () => {
  const deployment = read("docs/production-deployment.md");

  for (const requirement of [
    /exact release artifact/i,
    /SHA256SUMS/,
    /out\/_headers/,
    /apex.*www|www.*apex/i,
    /TLS/i,
    /MX/i,
    /SPF/i,
    /DKIM/i,
    /DMARC/i,
    /rollback/i,
    /service worker/i,
    /domain loss/i,
    /external probe/i,
  ]) {
    assert.match(deployment, requirement);
  }
});

test("Trezor remains an explicit separately licensed production boundary", () => {
  const notices = read("THIRD_PARTY_NOTICES.md");
  const deployment = read("docs/production-deployment.md");

  assert.match(notices, /@trezor\/connect-web/);
  assert.match(notices, /Trezor Reference Source License/i);
  assert.match(notices, /not covered by StellarKey(?:'s)? AGPL/i);
  assert.match(notices, /written (?:permission|authorization)/i);
  assert.match(deployment, /Trezor.*written (?:permission|authorization)/is);
  assert.match(deployment, /production origin/i);
});

test("landing effects leave calculator rendering to React and dispose replay listeners", () => {
  const landingClient = read("src/components/marketing/LandingClient.tsx");

  assert.doesNotMatch(landingClient, /\.innerHTML\b/);
  assert.doesNotMatch(landingClient, /["'](?:i-sales|i-ticket|o-rows|o-verdict)["']/);
  assert.match(landingClient, /removeEventListener\("click", play\)/);
});
