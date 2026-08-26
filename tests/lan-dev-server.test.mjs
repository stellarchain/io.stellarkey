import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { isCsrfOriginAllowed } from "../node_modules/next/dist/server/app-render/csrf-protection.js";
import nextConfig from "../next.config.ts";

test("the dev origin allowlist survives LAN DHCP address changes", () => {
  const allowedOrigins = nextConfig.allowedDevOrigins ?? [];

  assert.equal(isCsrfOriginAllowed("192.168.0.100", allowedOrigins), true);
  assert.equal(isCsrfOriginAllowed("192.168.0.137", allowedOrigins), true);
  assert.equal(isCsrfOriginAllowed("192.168.1.137", allowedOrigins), false);
});

test("Turbopack stays rooted in this repository when a parent lockfile exists", () => {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

  assert.equal(nextConfig.turbopack?.root, repositoryRoot);
});
