import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

import * as securityPolicy from "../src/lib/security-policy.ts";
import nextConfig from "../next.config.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

async function availablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  server.close();
  await once(server, "close");
  return port;
}

function waitForReady(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Static server did not start.")), 5_000);
    child.once("error", reject);
    child.stdout.on("data", (chunk) => {
      if (!String(chunk).includes("Static wallet available")) return;
      clearTimeout(timeout);
      resolve();
    });
  });
}

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
  assert.match(packageJson.scripts.build, /generate-service-worker/);
  assert.match(packageJson.scripts.start, /static-server/);
});

test("the static server reloads generated security headers after a hot build", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polaris-static-server-"));
  const scriptDirectory = path.join(root, "scripts");
  const outputDirectory = path.join(root, "out");
  const serverPath = path.join(scriptDirectory, "static-server.mjs");
  const headersPath = path.join(outputDirectory, "_headers");
  const headerFile = (hash) => `/*\n  Content-Security-Policy: script-src 'self' '${hash}'\n`;
  let child;

  try {
    await mkdir(scriptDirectory, { recursive: true });
    await mkdir(outputDirectory, { recursive: true });
    await copyFile(new URL("../scripts/static-server.mjs", import.meta.url), serverPath);
    await writeFile(path.join(outputDirectory, "index.html"), "<!doctype html><title>Wallet</title>");
    await writeFile(headersPath, headerFile("sha256-before"));

    const port = await availablePort();
    child = spawn(process.execPath, [serverPath, "--hostname", "127.0.0.1", "--port", String(port)], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForReady(child);

    const before = await fetch(`http://127.0.0.1:${port}/`, { cache: "no-store" });
    assert.match(before.headers.get("content-security-policy") ?? "", /sha256-before/);

    await writeFile(headersPath, headerFile("sha256-after"));
    const after = await fetch(`http://127.0.0.1:${port}/`, { cache: "no-store" });
    assert.match(after.headers.get("content-security-policy") ?? "", /sha256-after/);
    assert.doesNotMatch(after.headers.get("content-security-policy") ?? "", /sha256-before/);
  } finally {
    if (child?.exitCode === null) {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
    await rm(root, { recursive: true, force: true });
  }
});
