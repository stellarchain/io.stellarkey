import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const expectedRoutes = ["/", "/about", "/privacy", "/terms", "/security", "/support", "/changelog"];

test("public release journeys run in every supported browser profile", () => {
  const journey = "e2e/public-release.spec.ts";
  assert.equal(existsSync(new URL(`../${journey}`, import.meta.url)), true);
  const source = read(journey);
  const config = read("playwright.config.ts");

  for (const route of expectedRoutes) {
    assert.equal(source.includes(`path: "${route}"`), true, `${route} is not covered`);
  }
  assert.match(source, /width:\s*320/);
  assert.match(source, /icon-maskable-512\.png/);
  assert.match(source, /icon-maskable-1024\.png/);
  assert.match(source, /apple-touch-icon/);
  assert.match(source, /definitely-not-a-stellarkey-route/);
  assert.match(config, /iphone-webkit[\s\S]*public-release/);
  assert.match(config, /ipad-webkit[\s\S]*public-release/);
});

test("robots and sitemap publish the canonical StellarKey routes", () => {
  for (const file of ["src/app/robots.ts", "src/app/sitemap.ts"]) {
    assert.equal(existsSync(new URL(`../${file}`, import.meta.url)), true, `${file} is missing`);
    assert.match(read(file), /export const dynamic = "force-static"/);
  }

  const robots = read("src/app/robots.ts");
  const sitemap = read("src/app/sitemap.ts");
  const brand = read("src/lib/brand.ts");
  assert.match(robots, /rules:\s*\{ userAgent: "\*", allow: "\/" \}/);
  assert.match(robots, /`\$\{BRAND_ORIGIN\}\/sitemap\.xml`/);
  assert.match(robots, /host: BRAND_ORIGIN/);
  assert.match(sitemap, /new URL\(path, BRAND_ORIGIN\)\.href/);
  assert.match(brand, /BRAND_ORIGIN = "https:\/\/stellarkey\.io"/);
  for (const route of expectedRoutes) {
    assert.match(brand, new RegExp(`"${route}"`));
  }
});

test("security.txt uses an RFC 9116 HTTPS policy contact without exposing a mailbox", () => {
  const path = "public/.well-known/security.txt";
  assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), true, "security.txt is missing");
  const source = read(path);
  assert.match(source, /^Contact: https:\/\/stellarkey\.io\/security$/m);
  assert.match(source, /^Canonical: https:\/\/stellarkey\.io\/\.well-known\/security\.txt$/m);
  assert.match(source, /^Policy: https:\/\/stellarkey\.io\/security$/m);
  assert.match(source, /^Preferred-Languages: en$/m);
  assert.match(source, /^Expires: 2027-08-28T23:59:59Z$/m);
  assert.doesNotMatch(source, /mailto:|@stellarkey\.io/i);
});

test("the static release publishes a commit-verifiable release manifest", () => {
  const route = "src/app/release.json/route.ts";
  assert.equal(existsSync(new URL(`../${route}`, import.meta.url)), true, "release manifest route is missing");
  const source = read(route);
  assert.match(source, /export const dynamic = "force-static"/);
  assert.match(source, /Response\.json/);
  assert.match(source, /APPLICATION_VERSION/);
  assert.match(source, /BUILD_COMMIT/);
  assert.match(read("src/app/about/page.tsx"), /BUILD_COMMIT/);
  assert.match(read("public/_headers"), /\/release\.json[\s\S]*Cache-Control: no-cache/);
  assert.match(source, /release-files\.json/);
  assert.match(source, /SHA-256/i);
  assert.match(source, /sourceRepository:\s*SOURCE_REPOSITORY_URL/);
  assert.match(source, /sourceCommit:\s*SOURCE_COMMIT_URL/);
  assert.match(source, /releasePage:\s*SOURCE_RELEASE_URL/);
  assert.match(source, /license:\s*"AGPL-3\.0-or-later"/);
});

test("one shared visible build identity covers every route shell", () => {
  const identity = read("src/components/BuildIdentity.tsx");
  const marketing = read("src/components/marketing/MarketingChrome.tsx");
  const publicFooter = read("src/components/PublicFooter.tsx");
  const lockScreen = read("src/components/LockScreen.tsx");
  const onboarding = read("src/components/Onboarding.tsx");
  const marketingHeader = marketing.slice(
    marketing.indexOf("export function MarketingHeader"),
    marketing.indexOf("export function MarketingFooter"),
  );
  const marketingFooter = marketing.slice(marketing.indexOf("export function MarketingFooter"));

  assert.match(identity, /APPLICATION_VERSION/);
  assert.match(identity, /BUILD_COMMIT/);
  assert.match(identity, /BUILD_COMMIT\.slice\(0, 7\)/);
  assert.match(identity, /data-build-identity/);

  for (const shell of [
    "src/components/PublicFooter.tsx",
    "src/components/marketing/MarketingChrome.tsx",
    "src/components/Dashboard.tsx",
    "src/components/Onboarding.tsx",
    "src/components/StorageRecoveryScreen.tsx",
  ]) {
    assert.match(read(shell), /<BuildIdentity/, `${shell} must expose the release identity`);
  }

  assert.doesNotMatch(
    marketingHeader,
    /<BuildIdentity/,
    "the marketing header must keep the product mark free of release metadata",
  );
  assert.match(
    marketingFooter,
    /<div className="legal">[\s\S]*?<BuildIdentity/,
    "marketing pages must expose the release identity in the footer legal bar",
  );
  assert.equal(
    marketing.match(/<BuildIdentity/g)?.length,
    1,
    "marketing pages must expose exactly one release identity",
  );
  assert.match(publicFooter, /showBuildIdentity\s*=\s*true/);
  assert.match(publicFooter, /\{showBuildIdentity\s*&&[\s\S]*?<BuildIdentity/);
  assert.match(lockScreen, /<BuildIdentity[\s\S]*?<PublicFooter compact showBuildIdentity=\{false\}/);
  assert.match(
    onboarding,
    /\{BRAND_NAME\} · Self-custodial Stellar wallet[\s\S]*?<BuildIdentity[\s\S]*?<h1/,
    "the first onboarding viewport must show the identity beside the product introduction",
  );
  assert.match(onboarding, /<PublicFooter compact showBuildIdentity=\{false\}/);
});

test("release preflight rejects dirty trees and mismatched supplied commits", async () => {
  const { validateReleaseState } = await import("../scripts/assert-clean-release.mjs");
  const head = "a".repeat(40);

  assert.doesNotThrow(() => validateReleaseState({ head, status: "", expectedCommit: head }));
  assert.throws(
    () => validateReleaseState({ head, status: " M src/app/page.tsx", expectedCommit: head }),
    /clean Git worktree/i,
  );
  assert.throws(
    () => validateReleaseState({ head, status: "?? release-notes.txt", expectedCommit: head }),
    /clean Git worktree/i,
  );
  assert.throws(
    () => validateReleaseState({ head, status: "", expectedCommit: "b".repeat(40) }),
    /does not match HEAD/i,
  );

  const pkg = JSON.parse(read("package.json"));
  assert.match(pkg.scripts["release:verify"], /^node scripts\/assert-clean-release\.mjs &&/);
});

test("release artifacts inventory every static file and remain byte deterministic", async (t) => {
  const { createReleaseBundle } = await import("../scripts/create-release-artifact.mjs");
  const root = mkdtempSync(join(tmpdir(), "stellarkey-release-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, "out");
  const artifacts = join(root, "artifacts");
  mkdirSync(join(output, "_next", "static"), { recursive: true });
  writeFileSync(join(output, "index.html"), "<!doctype html><title>StellarKey</title>\n");
  writeFileSync(join(output, "_next", "static", "app.js"), "console.log('release');\n");
  const commit = "c".repeat(40);
  const options = {
    outDir: output,
    artifactsDir: artifacts,
    version: "1.0.0",
    commit,
    sbom: { bomFormat: "CycloneDX", specVersion: "1.6", version: 1 },
  };

  const first = await createReleaseBundle(options);
  const archiveOne = readFileSync(first.archivePath);
  const manifestOne = readFileSync(first.inventoryPath);
  const second = await createReleaseBundle(options);
  assert.deepEqual(readFileSync(second.archivePath), archiveOne);
  assert.deepEqual(readFileSync(second.inventoryPath), manifestOne);

  const inventory = JSON.parse(manifestOne);
  assert.equal(inventory.commit, commit);
  assert.deepEqual(
    inventory.files.map((entry) => entry.path),
    ["_next/static/app.js", "index.html"],
  );
  for (const entry of inventory.files) {
    assert.match(entry.sha256, /^[0-9a-f]{64}$/);
    assert.ok(Number.isSafeInteger(entry.size) && entry.size > 0);
  }
  assert.equal(
    inventory.archive.sha256,
    createHash("sha256").update(archiveOne).digest("hex"),
  );
  const sums = readFileSync(first.checksumsPath, "utf8");
  assert.match(sums, new RegExp(`${inventory.archive.sha256}  stellarkey-1\\.0\\.0\\.tar\\.gz`));
  assert.match(sums, /  release-files\.json$/m);
  assert.match(sums, /  stellarkey-1\.0\.0\.cdx\.json$/m);
});

test("tag releases build once, attest, and publish the exact artifacts", () => {
  const workflow = read(".github/workflows/release.yml");
  assert.match(workflow, /tags:\s*\n\s*- ['"]v\*['"]/);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40}/);
  assert.match(workflow, /actions\/attest-build-provenance@[0-9a-f]{40}/);
  assert.match(workflow, /npm run release:verify/);
  assert.equal((workflow.match(/npm run build/g) ?? []).length, 0);
  assert.match(workflow, /node scripts\/create-release-artifact\.mjs/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /release-artifacts\/\*/);
});

test("production deploys the exact published release archive to Cloudflare Pages", () => {
  const workflow = read(".github/workflows/release.yml");
  assert.match(workflow, /deploy:\s*\n\s*needs: release/);
  assert.match(workflow, /environment:\s*\n\s*name: production\s*\n\s*url: https:\/\/stellarkey\.io/);
  assert.match(workflow, /gh release download "\$GITHUB_REF_NAME"/);
  assert.match(workflow, /sha256sum --check SHA256SUMS/);
  assert.match(workflow, /tar -xzf .* --strip-components=1 -C deploy/);
  assert.match(workflow, /cloudflare\/wrangler-action@[0-9a-f]{40}/);
  assert.match(workflow, /wranglerVersion: "4\.[0-9.]+"/);
  assert.match(workflow, /CLOUDFLARE_ACCOUNT_ID/);
  assert.match(workflow, /CLOUDFLARE_API_TOKEN/);
  assert.match(workflow, /pages deploy deploy --project-name=stellarkey --branch=main/);
});

test("sharing metadata and structured data describe one independent finance app", () => {
  const openGraph = read("src/app/opengraph-image.tsx");
  const twitter = read("src/app/twitter-image.tsx");
  const layout = read("src/app/layout.tsx");
  const brand = read("src/lib/brand.ts");
  assert.match(openGraph, /new ImageResponse/);
  assert.match(openGraph, /export const dynamic = "force-static"/);
  assert.match(openGraph, /width:\s*1200/);
  assert.match(openGraph, /height:\s*630/);
  assert.match(openGraph, /BRAND_NAME/);
  assert.match(openGraph, /public.*icon-512\.png/);
  assert.match(openGraph, /data:image\/png;base64/);
  assert.match(twitter, /opengraph-image/);
  assert.match(twitter, /export const dynamic = "force-static"/);
  assert.match(layout, /"@type":\s*"SoftwareApplication"/);
  assert.match(layout, /"applicationCategory":\s*"FinanceApplication"/);
  assert.match(layout, /applicationJsonLd/);
  assert.match(layout, /replace\(\/<\//);
  assert.match(brand, /PUBLIC_OPEN_GRAPH_IMAGE/);
  assert.match(brand, /url: "\/opengraph-image"/);
  for (const route of ["about", "privacy", "terms", "security", "support", "changelog"]) {
    assert.match(read(`src/app/${route}/page.tsx`), /images: \[PUBLIC_OPEN_GRAPH_IMAGE\]/);
  }
});

test("each exported document carries its own hash CSP within Cloudflare header limits", async () => {
  const source = read("scripts/generate-static-headers.mjs");
  assert.match(source, /export function collectInlineScriptHashes/);
  assert.match(source, /export function renderDocumentWithCsp/);
  assert.match(source, /export function renderStaticHeaders/);
  assert.match(source, /if \(invokedPath === import\.meta\.url\)/);

  const {
    CLOUDFLARE_HEADER_LINE_LIMIT,
    collectInlineScriptHashes,
    renderDocumentWithCsp,
    renderStaticHeaders,
  } = await import(
    "../scripts/generate-static-headers.mjs"
  );
  const home = "<script>shared()</script><script>home()</script>";
  const privacy = "<script>shared()</script><script>privacy()</script>";
  const hashes = collectInlineScriptHashes([home, privacy]);
  const digest = (sourceText) => `sha256-${createHash("sha256").update(sourceText).digest("base64")}`;
  assert.deepEqual(hashes, [digest("home()"), digest("privacy()"), digest("shared()")].sort());

  const document = renderDocumentWithCsp({
    html: `<!doctype html><html><head><title>Home</title></head><body>${home}</body></html>`,
    policyTemplate: "default-src 'self'; script-src 'self' __SCRIPT_HASHES__",
  });
  for (const hash of collectInlineScriptHashes(home)) {
    assert.match(document, new RegExp(hash.replace(/[+/]/g, "\\$&")));
  }
  assert.match(document, /<head><meta http-equiv="Content-Security-Policy"/);
  assert.doesNotMatch(document, /__SCRIPT_HASHES__/);

  const headers = renderStaticHeaders({
    template: "/*\n  Content-Security-Policy: frame-ancestors 'none'\n",
  });
  assert.ok(headers.split("\n").every((line) => line.length <= CLOUDFLARE_HEADER_LINE_LIMIT));
  assert.throws(
    () => renderStaticHeaders({ template: `/*\n  X-Test: ${"x".repeat(2_001)}` }),
    /Cloudflare Pages.*2,000/i,
  );
});

test("the offline shell resolves and precaches every public disclosure route", async () => {
  const source = read("scripts/generate-service-worker.mjs");
  assert.match(source, /"\/about"/);
  assert.match(source, /"\/privacy"/);
  assert.match(source, /"\/terms"/);
  assert.match(source, /"\/security"/);
  assert.match(source, /"\/changelog"/);
  assert.match(source, /export async function resolveOutputFile/);
  const worker = read("public/sw.js");
  assert.match(worker, /normalizedNavigationPath/);
  assert.match(worker, /cache\.match\(normalizedNavigationPath/);

  const { discoverShellPaths } = await import("../scripts/generate-service-worker.mjs");
  const paths = discoverShellPaths([
    '<script src="/_next/static/chunks/home.js"></script>',
    '<script src="/_next/static/chunks/legal.js"></script>',
  ]);
  for (const route of ["/about", "/privacy", "/terms", "/security", "/changelog"]) assert.ok(paths.includes(route));
  assert.ok(paths.includes("/_next/static/chunks/home.js"));
  assert.ok(paths.includes("/_next/static/chunks/legal.js"));
});

test("static host policy distinguishes mutable documents from immutable assets", () => {
  const headers = read("public/_headers");
  const server = read("scripts/static-server.mjs");
  assert.match(headers, /Strict-Transport-Security: max-age=31536000; includeSubDomains/);
  assert.match(headers, /\/_next\/static\/\*/);
  assert.match(headers, /Cache-Control: public, max-age=31536000, immutable/);
  assert.match(headers, /\/\.well-known\/security\.txt[\s\S]*Cache-Control: no-cache/);
  assert.match(headers, /\/changelog[\s\S]*Cache-Control: no-cache/);
  assert.match(server, /\["\.txt", "text\/plain; charset=utf-8"\]/);
  assert.match(server, /pattern\.endsWith\("\*"\)/);
});
