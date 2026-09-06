import assert from "node:assert/strict";
import test from "node:test";
import * as prices from "../src/lib/prices.ts";
import { assetAmountFor, unitPriceE6 } from "../src/lib/merchant/money.ts";
import { fetchXlmSeries } from "../src/lib/api.ts";

const asset = { network: "mainnet", code: "USDC", issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" };
const key = prices.assetPriceKey(asset.network, asset.code, asset.issuer);
const fresh = (value, observedAt) => ({ value, observedAt, status: "fresh" });
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });

test("a cached asset retains its genuine observation time through a 60-minute outage and refuses a real-money quote", async (t) => {
  let now = 1_800_000_000_000;
  let calls = 0;
  let outage = false;
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return response({ "usd-coin": { usd: 0.999 } }, outage ? 503 : 200);
  });
  assert.equal(typeof prices.fetchAssetPriceSamples, "function");
  const first = await prices.fetchAssetPriceSamples([asset]);
  assert.deepEqual(first[key], fresh(0.999, now));
  now += 30_000;
  assert.deepEqual(await prices.fetchAssetPriceSamples([asset]), first);
  assert.equal(calls, 1);
  now += 60 * 60_000;
  outage = true;
  const retained = await prices.fetchAssetPriceSamples([asset]);
  assert.deepEqual(retained[key], { ...first[key], status: "stale" });
  assert.equal(prices.quoteCurrencyPerUnit(asset, "USD", retained, null, {}, now), null);
  assert.equal(prices.quoteCurrencyPerUnit(asset, "USD", first, null, {}, now), null, "time is checked at the action even without a new render");
  outage = false;
  const recovered = await prices.fetchAssetPriceSamples([asset]);
  assert.equal(recovered[key].observedAt, now);
  const rate = prices.quoteCurrencyPerUnit(asset, "USD", recovered, null, {}, now);
  assert.equal(rate, 0.999);
  assert.equal(assetAmountFor(100, unitPriceE6(rate)), "1.0010011");
  assert.deepEqual(await prices.fetchAssetPriceSamples([{ ...asset, network: "testnet" }]), {});
  assert.deepEqual(await prices.fetchAssetPriceSamples([{ ...asset, issuer: "lookalike" }]), {});
  assert.equal(prices.quoteCurrencyPerUnit({ ...asset, network: "testnet" }, "USD", recovered, null, {}, now), null);
});

test("native and each non-USD FX input must be valid, current, and successfully observed", async (t) => {
  let now = 1_900_000_000_000;
  let payload = { rates: { usd: { value: 2 }, eur: { value: 1.6 }, gbp: { value: 1.4 }, jpy: { value: 300 }, cad: { value: 3 }, aud: { value: 3 }, chf: { value: 2 } } };
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async () => response(payload));
  assert.equal(typeof prices.fetchFiatRateSamples, "function");
  const first = await prices.fetchFiatRateSamples();
  assert.deepEqual(first.EUR, fresh(0.8, now));
  assert.deepEqual(first.USD, { value: 1, observedAt: null, status: "fixed" });
  now += 30_000;
  assert.deepEqual(await prices.fetchFiatRateSamples(), first);
  now += 60 * 60_000;
  payload = { rates: { usd: { value: 2 }, gbp: { value: 1.5 } } };
  const partial = await prices.fetchFiatRateSamples();
  assert.deepEqual(partial.EUR, { ...first.EUR, status: "stale" });
  assert.deepEqual(partial.GBP, fresh(0.75, now));
  const native = { network: "mainnet", code: "XLM", issuer: null };
  assert.equal(prices.quoteCurrencyPerUnit(native, "EUR", {}, fresh(0.25, now), partial, now), null);
  assert.equal(prices.quoteCurrencyPerUnit(native, "GBP", {}, fresh(0.25, now - 3600_000), partial, now), null);
  assert.equal(prices.quoteCurrencyPerUnit(native, "GBP", {}, fresh(0.25, now), partial, now), 0.1875);
  assert.equal(prices.quoteCurrencyPerUnit(native, "USD", {}, { value: 0.25, observedAt: null, status: "fixed" }, partial, now), null);
  assert.equal(prices.quoteCurrencyPerUnit(asset, "GBP", { [key]: fresh(1, now) }, null, { GBP: fresh(Infinity, now) }, now), null);
  assert.equal(prices.quoteCurrencyPerUnit(asset, "USD", { [key]: fresh(1, now + 1) }, null, {}, now), null);
});

test("native failures retain an honestly labelled last price and a retry can recover", async (t) => {
  let now = 2_000_000_000_000;
  let payload = { stellar: { usd: 0.25 } };
  let status = 200;
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async () => response(payload, status));
  assert.equal(typeof prices.fetchNativePrice, "function");
  const first = await prices.fetchNativePrice();
  assert.deepEqual(first, fresh(0.25, now));
  now += 3600_000;
  status = 503;
  assert.deepEqual(await prices.fetchNativePrice(), { ...first, status: "stale" });
  status = 200;
  for (const value of [0, -1, "0.25", null]) {
    payload = { stellar: { usd: value } };
    assert.deepEqual(await prices.fetchNativePrice(), { ...first, status: "stale" });
  }
  payload = { stellar: { usd: 0.3 } };
  assert.deepEqual(await prices.fetchNativePrice(), fresh(0.3, now));
});

test("late price requests cannot replace a newer observation", async (t) => {
  let now = 2_100_000_000_000;
  const pending = [];
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", () => new Promise((resolve) => pending.push(resolve)));
  assert.equal(typeof prices.fetchAssetPriceSamples, "function");
  const old = prices.fetchAssetPriceSamples([asset]);
  const latest = prices.fetchAssetPriceSamples([asset]);
  // The deadline boundary schedules the transport in a microtask.
  await new Promise((resolve) => setImmediate(resolve));
  now += 1_000;
  pending[1](response({ "usd-coin": { usd: 1.1 } }));
  const current = await latest;
  now += 1_000;
  pending[0](response({ "usd-coin": { usd: 0.9 } }));
  assert.deepEqual(await old, current);
  assert.deepEqual(await prices.fetchAssetPriceSamples([asset]), current);
});

test("charts record successful observation time and reject invalid points", async (t) => {
  const now = 2_200_000_000_000;
  let points = [[now - 60_000, 0.2], [now, 0.25]];
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async () => response({ prices: points }));
  const series = await fetchXlmSeries("7D");
  assert.equal(series.observedAt, now);
  assert.equal(prices.isMarketObservationFresh(series.observedAt, now + 30_000), true);
  assert.equal(prices.isMarketObservationFresh(series.observedAt, now + 3600_000), false);
  points = [[now, -1], [now + 1, 0.25]];
  assert.equal(await fetchXlmSeries("7D"), null);
});

test("independent cold-cache consumers each receive a valid observation while a later request is pending", async (t) => {
  const concurrent = await import("../src/lib/prices.ts?independent-consumers");
  let now = 2_300_000_000_000;
  const pending = [];
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", () => new Promise((resolve) => pending.push(resolve)));
  const first = concurrent.fetchAssetPriceSamples([asset]);
  const second = concurrent.fetchAssetPriceSamples([asset]);
  await new Promise((resolve) => setImmediate(resolve));
  pending[0](response({ "usd-coin": { usd: 1.02 } }));
  const firstResult = await first;
  const firstObservedAt = now;
  now += 1_000;
  pending[1](response({ "usd-coin": { usd: 1.01 } }));
  const secondResult = await second;
  assert.deepEqual(firstResult[key], fresh(1.02, firstObservedAt));
  assert.deepEqual(secondResult[key], fresh(1.01, now));
  assert.deepEqual((await concurrent.fetchAssetPriceSamples([asset]))[key], fresh(1.01, now));
});

for (const finish of ["abort", "failure"]) {
  test(`a later consumer's ${finish} does not erase an earlier successful observation`, async (t) => {
    const concurrent = await import(`../src/lib/prices.ts?independent-${finish}`);
    const now = 2_400_000_000_000;
    const pending = [];
    t.mock.method(Date, "now", () => now);
    t.mock.method(globalThis, "fetch", () => new Promise((resolve) => pending.push(resolve)));
    const controller = new AbortController();
    const first = concurrent.fetchAssetPriceSamples([asset]);
    const second = concurrent.fetchAssetPriceSamples([asset], controller.signal);
    await new Promise((resolve) => setImmediate(resolve));
    pending[0](response({ "usd-coin": { usd: 1 } }));
    const firstResult = await first;
    if (finish === "abort") controller.abort();
    pending[1](response({}, 503));
    const secondResult = await second;
    assert.deepEqual(firstResult[key], fresh(1, now));
    assert.deepEqual(secondResult[key], { value: 1, observedAt: now, status: finish === "abort" ? "fresh" : "stale" });
  });
}
