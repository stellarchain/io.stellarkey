import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import * as securityPolicy from "../src/lib/security-policy.ts";
import nextConfig from "../next.config.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("production CSP uses build-time hashes and supports direct decentralized services", () => {
  assert.equal(typeof securityPolicy.buildStaticSecurityPolicy, "function");
  const policy = securityPolicy.buildStaticSecurityPolicy(["sha256-test-hash"]);
  const script = policy.split("; ").find((directive) => directive.startsWith("script-src"));
  const connect = policy.split("; ").find((directive) => directive.startsWith("connect-src"));

  assert.match(script ?? "", /'sha256-test-hash'/);
  assert.doesNotMatch(script ?? "", /'unsafe-inline'|'unsafe-eval'/);
  assert.doesNotMatch(script ?? "", /'nonce-/);
  assert.match(connect ?? "", /https:\/\/horizon\.stellar\.org/);
  assert.match(connect ?? "", /https:\/\/horizon-testnet\.stellar\.org/);
  assert.match(connect ?? "", /https:\/\/api\.coingecko\.com/);
  assert.match(connect ?? "", /https:\/\/connect\.trezor\.io/);
  assert.match(connect ?? "", /\shttps:(?:\s|$)/);
  // Safari upgrades same-origin HTTP assets too, which breaks LAN testing before
  // hydration. Production HTTPS/HSTS belongs at the static host boundary.
  assert.doesNotMatch(policy, /upgrade-insecure-requests/);
});

test("static export and service worker enforce a hash-bound shell-only boundary", () => {
  assert.equal(nextConfig.output, "export");
  assert.equal(nextConfig.experimental?.sri?.algorithm, "sha256");
  assert.equal(existsSync(new URL("../src/proxy.ts", import.meta.url)), false);
  assert.equal(existsSync(new URL("../public/sw.js", import.meta.url)), true);
  const worker = read("public/sw.js");
  const layout = read("src/app/layout.tsx");
  const page = read("src/app/page.tsx");
  const packageJson = JSON.parse(read("package.json"));

  assert.match(worker, /\/\_next\/static\//);
  assert.match(worker, /request\.mode === "navigate"/);
  assert.doesNotMatch(worker, /horizon|coingecko|localStorage|indexedDB/i);
  assert.doesNotMatch(worker, /DOMParser/);
  assert.match(layout, /ServiceWorkerRegistration/);
  assert.doesNotMatch(page, /next\/server|connection\(\)/);
  assert.match(layout, /maximumScale:\s*1,/);
  assert.match(layout, /userScalable:\s*false,/);
  assert.match(packageJson.scripts.build, /generate-static-headers/);
  assert.match(packageJson.scripts.start, /static-server/);
});
