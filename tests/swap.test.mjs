import assert from "node:assert/strict";
import test from "node:test";

import { findStrictReceiveRoute, findStrictSendRoute } from "../src/lib/swap.ts";
import {
  bindSwapQuote,
  guardCurrentSwapQuote,
  isCurrentSwapQuote,
  swapRequestKey,
} from "../src/lib/transaction-intent.ts";

const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

test("uses destination_assets for an XLM to USDC strict-send query", async (t) => {
  let requestedUrl;
  t.mock.method(globalThis, "fetch", async (url) => {
    requestedUrl = new URL(String(url));
    return new Response(JSON.stringify({ _embedded: { records: [] } }), { status: 200 });
  });

  await findStrictSendRoute({
    network: "mainnet",
    sendCode: "XLM",
    sendAmount: "10",
    destCode: "USDC",
    destIssuer: USDC_ISSUER,
  });

  assert.equal(requestedUrl.searchParams.get("source_asset_type"), "native");
  assert.equal(requestedUrl.searchParams.get("source_amount"), "10");
  assert.equal(requestedUrl.searchParams.get("destination_assets"), `USDC:${USDC_ISSUER}`);
  assert.equal(requestedUrl.searchParams.has("destination_asset_type"), false);
});

test("unwraps Horizon HAL records and selects the best USDC to XLM route", async (t) => {
  let requestedUrl;
  t.mock.method(globalThis, "fetch", async (url) => {
    requestedUrl = new URL(String(url));
    return new Response(
      JSON.stringify({
        _embedded: {
          records: [
            { destination_amount: "4.9800000", path: [] },
            {
              destination_amount: "4.9900000",
              path: [
                {
                  asset_type: "credit_alphanum4",
                  asset_code: "AQUA",
                  asset_issuer: USDC_ISSUER,
                },
              ],
            },
          ],
        },
      }),
      { status: 200 },
    );
  });

  const route = await findStrictSendRoute({
    network: "mainnet",
    sendCode: "USDC",
    sendIssuer: USDC_ISSUER,
    sendAmount: "1",
    destCode: "XLM",
  });

  assert.equal(requestedUrl.searchParams.get("destination_assets"), "native");
  assert.equal(route?.destinationAmount, "4.9900000");
  assert.equal(route?.intermediates.length, 1);
  assert.equal(route?.intermediates[0].getCode(), "AQUA");
});

test("uses an exact destination and bounded source for a strict-receive query", async (t) => {
  let requestedUrl;
  t.mock.method(globalThis, "fetch", async (url) => {
    requestedUrl = new URL(String(url));
    return new Response(JSON.stringify({ _embedded: { records: [] } }), { status: 200 });
  });

  await findStrictReceiveRoute({
    network: "mainnet",
    sendCode: "XLM",
    destinationAmount: "10",
    destCode: "USDC",
    destIssuer: USDC_ISSUER,
  });

  assert.equal(requestedUrl.pathname, "/paths/strict-receive");
  assert.equal(requestedUrl.searchParams.get("source_assets"), "native");
  assert.equal(requestedUrl.searchParams.get("destination_asset_type"), "credit_alphanum4");
  assert.equal(requestedUrl.searchParams.get("destination_asset_code"), "USDC");
  assert.equal(requestedUrl.searchParams.get("destination_asset_issuer"), USDC_ISSUER);
  assert.equal(requestedUrl.searchParams.get("destination_amount"), "10");
});

test("selects the lowest strict-receive source amount at full Stellar precision", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    new Response(
      JSON.stringify({
        _embedded: {
          records: [
            { source_amount: "1.0000001", path: [] },
            {
              source_amount: "1",
              path: [{ asset_type: "native" }],
            },
          ],
        },
      }),
      { status: 200 },
    ),
  );

  const route = await findStrictReceiveRoute({
    network: "mainnet",
    sendCode: "USDC",
    sendIssuer: USDC_ISSUER,
    destinationAmount: "5",
    destCode: "XLM",
  });

  assert.equal(route?.sourceAmount, "1");
  assert.equal(route?.intermediates.length, 1);
  assert.equal(route?.intermediates[0].isNative(), true);
});

test("keeps issued XLM distinct from the native asset", async (t) => {
  const requestedUrls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    requestedUrls.push(new URL(String(url)));
    return new Response(JSON.stringify({ _embedded: { records: [] } }), { status: 200 });
  });

  await findStrictSendRoute({
    network: "mainnet",
    sendCode: "XLM",
    sendIssuer: USDC_ISSUER,
    sendAmount: "1",
    destCode: "XLM",
  });
  await findStrictSendRoute({
    network: "mainnet",
    sendCode: "XLM",
    sendAmount: "1",
    destCode: "XLM",
    destIssuer: USDC_ISSUER,
  });

  assert.equal(requestedUrls[0].searchParams.get("source_asset_type"), "credit_alphanum4");
  assert.equal(requestedUrls[0].searchParams.get("source_asset_code"), "XLM");
  assert.equal(requestedUrls[0].searchParams.get("source_asset_issuer"), USDC_ISSUER);
  assert.equal(requestedUrls[1].searchParams.get("destination_assets"), `XLM:${USDC_ISSUER}`);
});

test("rejects a credit asset without an issuer before querying Horizon", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("Horizon must not be queried");
  });

  await assert.rejects(
    findStrictSendRoute({
      network: "mainnet",
      sendCode: "XLM",
      sendAmount: "1",
      destCode: "USDC",
    }),
    /issuer is required for USDC/i,
  );
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("selects the larger destination amount at full Stellar precision", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    new Response(
      JSON.stringify({
        _embedded: {
          records: [
            { destination_amount: "922337203685.4775806", path: [] },
            { destination_amount: "922337203685.4775807", path: [] },
          ],
        },
      }),
      { status: 200 },
    ),
  );

  const route = await findStrictSendRoute({
    network: "mainnet",
    sendCode: "XLM",
    sendAmount: "1",
    destCode: "USDC",
    destIssuer: USDC_ISSUER,
  });

  assert.equal(route?.destinationAmount, "922337203685.4775807");
});

test("does not report a Horizon outage as missing liquidity", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ title: "Service Unavailable" }), { status: 503 }),
  );

  await assert.rejects(
    findStrictSendRoute({
      network: "mainnet",
      sendCode: "XLM",
      sendAmount: "1",
      destCode: "USDC",
      destIssuer: USDC_ISSUER,
    }),
    /horizon.*503|service unavailable/i,
  );
});

test("binds a quote to the exact immutable swap request", () => {
  const originalKey = swapRequestKey({
    network: "mainnet",
    sendAssetKey: "native",
    destinationAssetKey: `USDC:${USDC_ISSUER}`,
    mode: "strict-send",
    exactAmount: "10",
    slippage: "0.5",
  });
  const quote = bindSwapQuote({
    mode: "strict-send",
    requestKey: originalKey,
    sendAssetKey: "native",
    destinationAssetKey: `USDC:${USDC_ISSUER}`,
    sendAmount: "10",
    slippage: "0.5",
    destinationAmount: "9.9",
    destinationMinimum: "9.8505",
    intermediates: [],
  });
  const changedAmountKey = swapRequestKey({
    network: "mainnet",
    sendAssetKey: "native",
    destinationAssetKey: `USDC:${USDC_ISSUER}`,
    mode: "strict-send",
    exactAmount: "11",
    slippage: "0.5",
  });

  assert.equal(isCurrentSwapQuote(quote, originalKey), true);
  assert.equal(isCurrentSwapQuote(quote, changedAmountKey), false);
  assert.equal(guardCurrentSwapQuote(quote, originalKey), quote);
  assert.equal(guardCurrentSwapQuote(quote, changedAmountKey), null);
  assert.equal(guardCurrentSwapQuote(null, originalKey), null);
  assert.equal(quote.sendAmount, "10");
  assert.equal(Object.isFrozen(quote), true);
});

test("binds strict-send and strict-receive quotes to different exact intents", () => {
  const common = {
    network: "mainnet",
    sendAssetKey: "native",
    destinationAssetKey: `USDC:${USDC_ISSUER}`,
    exactAmount: "10",
    slippage: "0.5",
  };
  const strictSendKey = swapRequestKey({ ...common, mode: "strict-send" });
  const strictReceiveKey = swapRequestKey({ ...common, mode: "strict-receive" });

  assert.notEqual(strictSendKey, strictReceiveKey);

  const strictReceiveQuote = bindSwapQuote({
    mode: "strict-receive",
    requestKey: strictReceiveKey,
    sendAssetKey: "native",
    destinationAssetKey: `USDC:${USDC_ISSUER}`,
    sendAmount: "10.1",
    sendMaximum: "10.1505",
    slippage: "0.5",
    destinationAmount: "10",
    intermediates: [],
  });

  assert.equal(strictReceiveQuote.mode, "strict-receive");
  assert.equal(strictReceiveQuote.sendMaximum, "10.1505");
  assert.equal(guardCurrentSwapQuote(strictReceiveQuote, strictReceiveKey), strictReceiveQuote);
  assert.equal(guardCurrentSwapQuote(strictReceiveQuote, strictSendKey), null);
});
