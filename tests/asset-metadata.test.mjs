import assert from "node:assert/strict";
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
