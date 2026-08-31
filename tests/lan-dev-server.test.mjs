import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { isCsrfOriginAllowed } from "../node_modules/next/dist/server/app-render/csrf-protection.js";
import nextConfig from "../next.config.ts";

test("the dev origin allowlist supports LAN DHCP and the local HTTPS hostname", () => {
  const allowedOrigins = nextConfig.allowedDevOrigins ?? [];

  assert.equal(isCsrfOriginAllowed("192.168.0.100", allowedOrigins), true);
  assert.equal(isCsrfOriginAllowed("192.168.0.137", allowedOrigins), true);
  assert.equal(isCsrfOriginAllowed("192.168.1.137", allowedOrigins), false);
  assert.equal(isCsrfOriginAllowed("stellarkey.local", allowedOrigins), true);
  assert.equal(isCsrfOriginAllowed("attacker-stellarkey.local", allowedOrigins), false);
});

test("Turbopack stays rooted in this repository when a parent lockfile exists", () => {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

  assert.equal(nextConfig.turbopack?.root, repositoryRoot);
});

test("development assets keep a stable namespace outside the production shell worker", () => {
  assert.equal(nextConfig.assetPrefix, "/__stellarkey-dev-v2");
  assert.equal(`${nextConfig.assetPrefix}/_next/static/app.js`.startsWith("/_next/static/"), false);
});
