import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  buildSecurityPolicy,
  createCspNonce,
  getExternalRequestUrl,
  isPotentiallyTrustworthyUrl,
} from "../src/lib/security-policy.ts";
import nextConfig from "../next.config.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("production CSP uses unique nonces and supports trusted plus decentralized services", () => {
  const nonces = new Set(Array.from({ length: 20 }, () => createCspNonce()));
  assert.equal(nonces.size, 20);
  const nonce = [...nonces][0];
  const policy = buildSecurityPolicy({ nonce, development: false, secureRequest: true });
  const script = policy.split("; ").find((directive) => directive.startsWith("script-src"));
  const connect = policy.split("; ").find((directive) => directive.startsWith("connect-src"));

  assert.match(script ?? "", new RegExp(`'nonce-${nonce}'`));
  assert.match(script ?? "", /'strict-dynamic'/);
  assert.doesNotMatch(script ?? "", /'unsafe-inline'|'unsafe-eval'/);
  assert.match(connect ?? "", /https:\/\/horizon\.stellar\.org/);
  assert.match(connect ?? "", /https:\/\/horizon-testnet\.stellar\.org/);
  assert.match(connect ?? "", /https:\/\/api\.coingecko\.com/);
  assert.match(connect ?? "", /https:\/\/connect\.trezor\.io/);
  assert.match(connect ?? "", /\shttps:(?:\s|$)/);
  assert.match(policy, /upgrade-insecure-requests/);
});

test("LAN HTTP avoids forced HTTPS and untrusted COOP while development supports HMR", () => {
  assert.equal(isPotentiallyTrustworthyUrl(new URL("http://192.168.0.100:3000")), false);
  assert.equal(isPotentiallyTrustworthyUrl(new URL("http://localhost:3000")), true);
  assert.equal(isPotentiallyTrustworthyUrl(new URL("http://127.0.0.1:3000")), true);
  assert.equal(isPotentiallyTrustworthyUrl(new URL("https://wallet.example")), true);
  assert.equal(
    getExternalRequestUrl(
      new URL("http://localhost:3000"),
      "192.168.0.180:3000",
      null,
    ).hostname,
    "192.168.0.180",
  );
  assert.equal(
    getExternalRequestUrl(
      new URL("http://localhost:3000"),
      "wallet.example",
      "https",
    ).protocol,
    "https:",
  );

  const lan = buildSecurityPolicy({ nonce: "lan", development: false, secureRequest: false });
  const development = buildSecurityPolicy({ nonce: "dev", development: true, secureRequest: false });
  assert.doesNotMatch(lan, /upgrade-insecure-requests/);
  assert.match(development, /'unsafe-eval'/);
  assert.match(development, /connect-src[^;]*\sws:/);
  assert.match(development, /connect-src[^;]*\shttp:/);
});

test("proxy and service worker enforce a nonce-bound shell-only boundary", async () => {
  assert.equal(existsSync(new URL("../src/proxy.ts", import.meta.url)), true);
  assert.equal(existsSync(new URL("../public/sw.js", import.meta.url)), true);
  const proxy = read("src/proxy.ts");
  const worker = read("public/sw.js");
  const layout = read("src/app/layout.tsx");
  const page = read("src/app/page.tsx");

  assert.match(proxy, /requestHeaders\.set\("x-nonce", nonce\)/);
  assert.match(proxy, /Content-Security-Policy/);
  assert.match(proxy, /isPotentiallyTrustworthyUrl/);
  assert.match(worker, /\/\_next\/static\//);
  assert.match(worker, /request\.mode === "navigate"/);
  assert.doesNotMatch(worker, /horizon|coingecko|localStorage|indexedDB/i);
  assert.doesNotMatch(worker, /DOMParser/);
  assert.match(layout, /ServiceWorkerRegistration/);
  assert.match(page, /await connection\(\)/);
  assert.match(layout, /maximumScale:\s*1,/);
  assert.match(layout, /userScalable:\s*false,/);

  const rules = await nextConfig.headers?.();
  const serviceWorker = rules?.find((rule) => rule.source === "/sw.js");
  assert.equal(serviceWorker?.headers.some(
    (header) => header.key === "Cache-Control" && /no-store/.test(header.value),
  ), true);
  assert.equal(serviceWorker?.headers.some(
    (header) => header.key === "Service-Worker-Allowed" && header.value === "/",
  ), true);
});
