import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { ESLint } from "eslint";

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

test("development output stays outside the production build directory", () => {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const gitignore = readFileSync(path.join(repositoryRoot, ".gitignore"), "utf8");

  assert.equal(nextConfig.distDir, ".next-dev");
  assert.match(gitignore, /^\/\.next-dev\/$/m);
});

test("browser verification uses its own development lock without displacing the user's running server", () => {
  const directory = execFileSync(process.execPath, ['--no-warnings', '--experimental-strip-types', '--input-type=module', '-e',
    'import config from "./next.config.ts"; process.stdout.write(config.distDir);'], {
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
    env: { ...process.env, NODE_ENV: 'development', E2E_NEXT_DEV: '1' }, encoding: 'utf8',
  });
  assert.equal(directory, '.next-e2e');
});

test("synthetic fixture teardown checks the browser runner's generated types, not another development server", () => {
  const teardown = readFileSync(new URL('../e2e/fixtures/private-components-teardown.mjs', import.meta.url), 'utf8');
  assert.match(teardown, /\.next-e2e\/dev\/types\/validator\.ts/);
  assert.doesNotMatch(teardown, /\.next-dev\/dev\/types/);
});

test("lint ignores only generated application and browser-test build directories", async () => {
  const linter = new ESLint();
  for (const directory of ['.next', '.next-dev', '.next-e2e']) {
    assert.equal(await linter.isPathIgnored(`${directory}/dev/server/generated.js`), true, directory);
  }
  assert.equal(await linter.isPathIgnored('src/features/private-balance/components/PrivateFeeAccountSelector.tsx'), false);
});
