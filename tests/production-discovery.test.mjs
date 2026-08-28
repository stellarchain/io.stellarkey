import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const expectedRoutes = ["/", "/about", "/privacy", "/terms", "/security"];

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
  for (const route of ["about", "privacy", "terms", "security"]) {
    assert.match(read(`src/app/${route}/page.tsx`), /images: \[PUBLIC_OPEN_GRAPH_IMAGE\]/);
  }
});

test("CSP hashes authorize inline scripts from every exported HTML document", async () => {
  const source = read("scripts/generate-static-headers.mjs");
  assert.match(source, /export function collectInlineScriptHashes/);
  assert.match(source, /export function renderStaticHeaders/);
  assert.match(source, /if \(invokedPath === import\.meta\.url\)/);

  const { collectInlineScriptHashes, renderStaticHeaders } = await import(
    "../scripts/generate-static-headers.mjs"
  );
  const home = "<script>shared()</script><script>home()</script>";
  const privacy = "<script>shared()</script><script>privacy()</script>";
  const hashes = collectInlineScriptHashes([home, privacy]);
  const digest = (sourceText) => `sha256-${createHash("sha256").update(sourceText).digest("base64")}`;
  assert.deepEqual(hashes, [digest("home()"), digest("privacy()"), digest("shared()")].sort());

  const headers = renderStaticHeaders({
    template: "Content-Security-Policy: script-src 'self' __SCRIPT_HASHES__",
    htmlDocuments: [home, privacy],
  });
  for (const hash of hashes) assert.match(headers, new RegExp(hash.replace(/[+/]/g, "\\$&")));
  assert.doesNotMatch(headers, /__SCRIPT_HASHES__/);
});

test("the offline shell resolves and precaches every public disclosure route", async () => {
  const source = read("scripts/generate-service-worker.mjs");
  assert.match(source, /"\/about"/);
  assert.match(source, /"\/privacy"/);
  assert.match(source, /"\/terms"/);
  assert.match(source, /"\/security"/);
  assert.match(source, /export async function resolveOutputFile/);
  const worker = read("public/sw.js");
  assert.match(worker, /normalizedNavigationPath/);
  assert.match(worker, /cache\.match\(normalizedNavigationPath/);

  const { discoverShellPaths } = await import("../scripts/generate-service-worker.mjs");
  const paths = discoverShellPaths([
    '<script src="/_next/static/chunks/home.js"></script>',
    '<script src="/_next/static/chunks/legal.js"></script>',
  ]);
  for (const route of ["/about", "/privacy", "/terms", "/security"]) assert.ok(paths.includes(route));
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
  assert.match(server, /\["\.txt", "text\/plain; charset=utf-8"\]/);
  assert.match(server, /pattern\.endsWith\("\*"\)/);
});
