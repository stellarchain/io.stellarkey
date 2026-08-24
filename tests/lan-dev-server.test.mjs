import assert from "node:assert/strict";
import test from "node:test";

import { isCsrfOriginAllowed } from "../node_modules/next/dist/server/app-render/csrf-protection.js";
import nextConfig from "../next.config.ts";

test("the dev origin allowlist survives LAN DHCP address changes", () => {
  const allowedOrigins = nextConfig.allowedDevOrigins ?? [];

  assert.equal(isCsrfOriginAllowed("192.168.0.100", allowedOrigins), true);
  assert.equal(isCsrfOriginAllowed("192.168.0.137", allowedOrigins), true);
  assert.equal(isCsrfOriginAllowed("192.168.1.137", allowedOrigins), false);
});
