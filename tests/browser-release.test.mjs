import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { PUBLIC_DOCUMENT_PATHS } from "../scripts/generate-service-worker.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("production is deployable as immutable static files without an application server", () => {
  assert.equal(existsSync(new URL("../scripts/generate-static-headers.mjs", import.meta.url)), true);
  assert.equal(existsSync(new URL("../scripts/generate-service-worker.mjs", import.meta.url)), true);
  assert.equal(existsSync(new URL("../scripts/static-server.mjs", import.meta.url)), true);
  assert.equal(existsSync(new URL("../public/_headers", import.meta.url)), true);

  const headers = read("public/_headers");
  assert.match(headers, /Content-Security-Policy:/);
  assert.match(headers, /Referrer-Policy: strict-origin-when-cross-origin/);
  assert.match(headers, /Cross-Origin-Opener-Policy: same-origin-allow-popups/);
  assert.match(headers, /\/sw\.js[\s\S]*Cache-Control: no-cache, no-store, must-revalidate/);
  assert.doesNotMatch(headers, /nonce-|unsafe-eval/);
  assert.doesNotMatch(headers, /upgrade-insecure-requests/);
});

/** The directives under one path in a _headers file. */
function headerBlock(headers, path) {
  const lines = headers.split("\n");
  const start = lines.indexOf(path);
  if (start === -1) return null;
  const directives = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("  ")) break;
    directives.push(line.trim());
  }
  return directives;
}

test("installed clients revalidate every document and every home-screen icon", () => {
  const headers = read("public/_headers");
  const revalidated = (path) => {
    const block = headerBlock(headers, path);
    assert.notEqual(block, null, `${path} has no rule in _headers`);
    return block.includes("Cache-Control: no-cache, must-revalidate");
  };

  // Every public document, including the wallet at /app, which is the PWA's
  // start_url: a pinned copy keeps an installed app on stale metadata, and on
  // the icon URLs that metadata names.
  for (const path of PUBLIC_DOCUMENT_PATHS) {
    assert.ok(revalidated(path), `${path} must be revalidated so installed clients see a new release`);
  }

  // The home-screen icons sit at stable paths and their artwork has changed
  // before, so a new logo only reaches an installed app if the phone re-checks.
  for (const icon of [
    "/apple-touch-icon.png",
    "/apple-icon1.png",
    "/apple-icon2.png",
    "/icon.svg",
    "/icon-192.png",
    "/icon-512.png",
    "/icon-maskable-192.png",
    "/icon-maskable-512.png",
    "/icon-maskable-1024.png",
  ]) {
    assert.ok(revalidated(icon), `${icon} must be revalidated or a new logo never reaches an installed app`);
  }
});
