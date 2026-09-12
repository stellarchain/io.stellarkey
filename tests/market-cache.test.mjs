import assert from "node:assert/strict";
import test from "node:test";
import { fetchNativePrice, fetchFiatRateSamples, fetchAssetPriceSamples, MARKET_MAX_AGE_MS } from "../src/lib/prices.ts";
import { fetchXlmSeries } from "../src/lib/api.ts";

const asset = { network: "mainnet", code: "USDC", issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" };
const tick = () => new Promise(resolve => setImmediate(resolve));
const response = body => new Response(JSON.stringify(body));
const sources = [
  { name: "XLM spot price", fetch: fetchNativePrice, body: { stellar: { usd: 0.25 } } },
  { name: "fiat rates", fetch: fetchFiatRateSamples, body: { rates: Object.fromEntries(["usd", "eur", "gbp", "jpy", "cad", "aud", "chf"].map(code => [code, { value: 1 }])) } },
  { name: "asset prices", fetch: signal => fetchAssetPriceSamples([asset], signal), body: { "usd-coin": { usd: 1 } } },
  { name: "XLM chart", fetch: signal => fetchXlmSeries("7D", signal), body: { prices: [[1000, 0.2], [2000, 0.25]] } },
];

for (const source of sources) {
  test(`${source.name}: concurrent consumers share one request and reuse it for five minutes without renewing its observation`, async t => {
    let now = 2_500_000_000_000;
    const pending = [];
    t.mock.method(Date, "now", () => now);
    t.mock.method(globalThis, "fetch", () => new Promise(resolve => pending.push(resolve)));
    const first = source.fetch();
    const second = source.fetch();
    await tick();
    const initialRequests = pending.length;
    pending.forEach(resolve => resolve(response(source.body)));
    const [one, two] = await Promise.all([first, second]);
    assert.deepEqual(one, two);
    assert.equal(initialRequests, 1, "concurrent price consumers must share the transport");
    now += MARKET_MAX_AGE_MS - 1;
    const cached = source.fetch();
    await tick();
    pending.forEach(resolve => resolve(response(source.body)));
    assert.deepEqual(await cached, one, "a cached read must keep the original observation time");
    assert.equal(pending.length, 1);
    now += 1;
    const expired = source.fetch();
    await tick();
    assert.equal(pending.length, 2, "the cache expires at five minutes, not five minutes after its last read");
    pending[1](response(source.body));
    assert.notDeepEqual(await expired, one);
  });

  test(`${source.name}: cancelling one consumer preserves another; cancelling all revokes cache publication`, async t => {
    let now = 2_600_000_000_000;
    const pending = [];
    t.mock.method(Date, "now", () => now);
    t.mock.method(globalThis, "fetch", (_url, { signal }) => new Promise(resolve => pending.push({ resolve, signal })));
    const firstController = new AbortController();
    const first = source.fetch(firstController.signal);
    const second = source.fetch();
    await tick();
    firstController.abort();
    await first;
    const liveTransport = pending.some(request => !request.signal.aborted);
    pending.forEach(request => request.resolve(response(source.body)));
    const current = await second;
    assert.ok(liveTransport);
    assert.equal(pending.length, 1);
    assert.deepEqual(await source.fetch(), current);

    now += MARKET_MAX_AGE_MS;
    const abandonedController = new AbortController();
    const abandoned = source.fetch(abandonedController.signal);
    await tick();
    abandonedController.abort();
    await abandoned;
    assert.equal(pending[1].signal.aborted, true);
    // A transport that ignores abort cannot publish after its last subscriber leaves.
    pending[1].resolve(response(source.body));
    await tick();
    const replacement = source.fetch();
    await tick();
    assert.equal(pending.length, 3);
    pending[2].resolve(response(source.body));
    await replacement;
  });
}

test("chart cache separates ranges and failed refreshes neither renew nor poison the cached observation", async t => {
  let now = 2_700_000_000_000;
  let failing = false;
  const calls = [];
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async url => {
    calls.push(new URL(url).searchParams.get("days"));
    return failing ? new Response("{}", { status: 503 }) : response({ prices: [[1000, 0.2], [2000, 0.25]] });
  });
  const day = await fetchXlmSeries("1D");
  const month = await fetchXlmSeries("1M");
  assert.equal(day.range, "1D");
  assert.equal(month.range, "1M");
  now += 120_000;
  assert.deepEqual(await fetchXlmSeries("1D"), day);
  assert.deepEqual(calls, ["1", "30"]);
  now += MARKET_MAX_AGE_MS;
  failing = true;
  assert.equal(await fetchXlmSeries("1D"), null);
  failing = false;
  const recovered = await fetchXlmSeries("1D");
  assert.equal(recovered.observedAt, now);
  assert.deepEqual(calls, ["1", "30", "1", "1"]);
});
