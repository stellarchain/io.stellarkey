import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

class MemoryStorage {
  #items = new Map();

  getItem(key) {
    return this.#items.get(key) ?? null;
  }

  setItem(key, value) {
    this.#items.set(key, String(value));
  }

  removeItem(key) {
    this.#items.delete(key);
  }
}

const issuer = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const horizon = "https://horizon.example";

function installStorage() {
  globalThis.window = { localStorage: new MemoryStorage() };
}

test("concurrent asset metadata lookups share one issuer and TOML request", async (t) => {
  installStorage();
  let issuerRequests = 0;
  let tomlRequests = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).startsWith(`${horizon}/accounts/`)) {
      issuerRequests += 1;
      return new Response(JSON.stringify({ home_domain: "asset.example" }), { status: 200 });
    }
    tomlRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return new Response(
      `[[CURRENCIES]]\ncode="USDC"\nissuer="${issuer}"\nimage="https://asset.example/usdc.png"`,
      { status: 200 },
    );
  });
  const { fetchAssetLogo, fetchIssuerDetails } = await import("../src/lib/toml.ts");

  const results = await Promise.all([
    fetchAssetLogo("USDC", issuer, horizon),
    fetchAssetLogo("USDC", issuer, horizon),
    fetchIssuerDetails("USDC", issuer, horizon),
  ]);

  assert.equal(results[0], "https://asset.example/usdc.png");
  assert.equal(results[1], results[0]);
  assert.equal(results[2].logoUrl, results[0]);
  assert.equal(issuerRequests, 1);
  assert.equal(tomlRequests, 1);
});

test("stable negative metadata is cached only for its shorter TTL", async (t) => {
  installStorage();
  let issuerRequests = 0;
  t.mock.method(globalThis, "fetch", async () => {
    issuerRequests += 1;
    return new Response(JSON.stringify({}), { status: 200 });
  });
  const {
    ASSET_METADATA_NEGATIVE_TTL_MS,
    assetMetadataCacheKey,
    fetchAssetLogo,
  } = await import("../src/lib/toml.ts");

  assert.equal(await fetchAssetLogo("NONE", issuer, horizon), null);
  assert.equal(await fetchAssetLogo("NONE", issuer, horizon), null);
  assert.equal(issuerRequests, 1);

  const key = assetMetadataCacheKey("NONE", issuer, horizon);
  for (const storageKey of ["wallet.asset-logos.v1", "wallet.issuer-details.v1"]) {
    const cache = JSON.parse(window.localStorage.getItem(storageKey));
    cache[key].cachedAt = Date.now() - ASSET_METADATA_NEGATIVE_TTL_MS;
    window.localStorage.setItem(storageKey, JSON.stringify(cache));
  }
  assert.equal(await fetchAssetLogo("NONE", issuer, horizon), null);
  assert.equal(issuerRequests, 2);
});

test("transient TOML failures are retried instead of becoming negative cache hits", async (t) => {
  installStorage();
  let tomlRequests = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).startsWith(`${horizon}/accounts/`)) {
      return new Response(JSON.stringify({ home_domain: "retry.example" }), { status: 200 });
    }
    tomlRequests += 1;
    if (tomlRequests === 1) throw new TypeError("temporary offline failure");
    return new Response(
      `[[CURRENCIES]]\ncode="RETRY"\nissuer="${issuer}"\nimage="https://retry.example/retry.png"`,
      { status: 200 },
    );
  });
  const { fetchAssetLogo } = await import("../src/lib/toml.ts");

  assert.equal(await fetchAssetLogo("RETRY", issuer, horizon), null);
  assert.equal(await fetchAssetLogo("RETRY", issuer, horizon), "https://retry.example/retry.png");
  assert.equal(tomlRequests, 2);
});

test("deceptive issuer home domains are never fetched", async (t) => {
  installStorage();
  const deceptiveDomains = [
    "stellar.org@evil.com",
    "evil.com#",
    "evil.com/path",
    "evil.com:443",
    "evil com",
  ];
  let tomlRequests = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    const value = String(url);
    if (value.includes("/accounts/")) {
      const index = Number(new URL(value).hostname.split(".")[1]);
      return new Response(JSON.stringify({ home_domain: deceptiveDomains[index] }), { status: 200 });
    }
    tomlRequests += 1;
    return new Response("", { status: 200 });
  });
  const { fetchIssuerDetails } = await import("../src/lib/toml.ts");

  for (let index = 0; index < deceptiveDomains.length; index += 1) {
    assert.equal(
      await fetchIssuerDetails("BAD", issuer, `https://horizon.${index}.example`),
      null,
    );
  }
  assert.equal(tomlRequests, 0);
});

test("issuer domains are canonicalized before constructing the TOML URL", async (t) => {
  installStorage();
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    const value = String(url);
    requests.push(value);
    if (value.includes("/accounts/")) {
      return new Response(JSON.stringify({ home_domain: "ASSETS.Example.COM" }), { status: 200 });
    }
    return new Response(`[[CURRENCIES]]\ncode="CANON"\nissuer="${issuer}"`, { status: 200 });
  });
  const { fetchIssuerDetails } = await import("../src/lib/toml.ts");

  const details = await fetchIssuerDetails("CANON", issuer, "https://canonical-horizon.example");
  assert.equal(details?.domain, "assets.example.com");
  assert.equal(requests[1], "https://assets.example.com/.well-known/stellar.toml");
});

test("stellar.toml responses larger than the SEP-1 limit are cancelled", async (t) => {
  installStorage();
  let cancelled = false;
  const oversizedBody = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(64 * 1024));
      controller.enqueue(new Uint8Array(64 * 1024));
    },
    cancel() {
      cancelled = true;
    },
  });
  t.mock.method(globalThis, "fetch", async (url) => {
    if (String(url).includes("/accounts/")) {
      return new Response(JSON.stringify({ home_domain: "large.example" }), { status: 200 });
    }
    return new Response(oversizedBody, { status: 200 });
  });
  const { fetchIssuerDetails } = await import("../src/lib/toml.ts");

  assert.equal(
    await fetchIssuerDetails("LARGE", issuer, "https://large-horizon.example"),
    null,
  );
  assert.equal(cancelled, true);
});

test("asset details distinguish curated assets from issuer self-declarations", () => {
  const source = readFileSync(
    new URL("../src/components/AssetDetailModal.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /Known asset/);
  assert.match(source, /Issuer-declared/);
  assert.match(source, /not independent verification/);
  assert.doesNotMatch(source, />\s*Asset declared\s*</);
});
