import assert from "node:assert/strict";
import test from "node:test";

import { buildSep7PayUri, parseSep7PayUri, validateSep7PayRequest } from "../src/lib/payuri.ts";
import {
  clearFederationMemoForDestinationChange,
  memoReviewPresentation,
  normalizeFederationMemo,
  resolveRequestedAsset,
} from "../src/lib/transaction-intent.ts";

const DESTINATION = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

test("parses the SEP-7 destination and typed memo fields", () => {
  const parsed = parseSep7PayUri(
    `web+stellar:pay?destination=${DESTINATION}&amount=12.5&memo=42&memo_type=MEMO_ID`,
  );
  assert.deepEqual(parsed, {
    destination: DESTINATION,
    amount: "12.5",
    memo: "42",
    memoType: "id",
  });
});

test("builds the standard destination field instead of the nonstandard dest field", () => {
  const uri = buildSep7PayUri({ destination: DESTINATION, amount: "1" });
  const params = new URLSearchParams(uri.slice(uri.indexOf("?") + 1));
  assert.equal(params.get("destination"), DESTINATION);
  assert.equal(params.has("dest"), false);
});

test("retains network, callback, origin, and signature metadata for validation", () => {
  const parsed = parseSep7PayUri(
    `web+stellar:pay?destination=${DESTINATION}` +
      "&network_passphrase=Test%20SDF%20Network%20%3B%20September%202015" +
      "&callback=url%3Ahttps%3A%2F%2Fexample.com%2Fcallback" +
      "&origin_domain=example.com&signature=c2ln",
  );
  assert.equal(parsed?.networkPassphrase, "Test SDF Network ; September 2015");
  assert.equal(parsed?.callback, "url:https://example.com/callback");
  assert.equal(parsed?.originDomain, "example.com");
  assert.equal(parsed?.signature, "c2ln");
});

test("rejects SEP-7 requests the wallet cannot safely authenticate or execute", () => {
  assert.match(
    validateSep7PayRequest({ destination: DESTINATION, originDomain: "example.com", signature: "sig" }),
    /signed/i,
  );
  assert.match(
    validateSep7PayRequest({ destination: DESTINATION, callback: "url:https://example.com" }),
    /callback/i,
  );
  assert.match(
    validateSep7PayRequest(
      { destination: DESTINATION, networkPassphrase: "Public Global Stellar Network ; September 2015" },
      "Test SDF Network ; September 2015",
    ),
    /different Stellar network/i,
  );
  assert.equal(
    validateSep7PayRequest(
      { destination: DESTINATION, networkPassphrase: "Test SDF Network ; September 2015" },
      "Test SDF Network ; September 2015",
    ),
    null,
  );
});

test("blocks unsupported SEP-7 credit assets instead of falling back to native", () => {
  const balances = [{
    key: "native",
    code: "XLM",
    issuer: null,
    balance: "10",
    limit: null,
    sellingLiabilities: "0",
    isNative: true,
  }];
  const result = resolveRequestedAsset({
    assetCode: "USDC",
    assetIssuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  }, balances);

  assert.equal(result.assetKey, null);
  assert.match(result.error ?? "", /USDC.*trustline|trustline.*USDC/i);
});

test("rejects a SEP-7 issuer without an asset code", () => {
  const result = resolveRequestedAsset({
    assetIssuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  }, [{
    key: "native",
    code: "XLM",
    issuer: null,
    balance: "10",
    limit: null,
    sellingLiabilities: "0",
    isNative: true,
  }]);

  assert.equal(result.assetKey, null);
  assert.match(result.error ?? "", /asset code/i);
});

test("resolves SEP-7 assets only by exact code and issuer", () => {
  const exactIssuer = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
  const balances = [
    {
      key: "native",
      code: "XLM",
      issuer: null,
      balance: "10",
      limit: null,
      sellingLiabilities: "0",
      isNative: true,
    },
    {
      key: `USDC:${exactIssuer}`,
      code: "USDC",
      issuer: exactIssuer,
      balance: "5",
      limit: "100",
      sellingLiabilities: "0",
      isNative: false,
    },
  ];

  assert.deepEqual(
    resolveRequestedAsset({ assetCode: "USDC", assetIssuer: exactIssuer }, balances),
    { assetKey: `USDC:${exactIssuer}`, error: null },
  );
  assert.equal(
    resolveRequestedAsset({ assetCode: "usdc", assetIssuer: exactIssuer }, balances).assetKey,
    null,
  );
});

test("normalizes federation text memos and clears them for a new destination", () => {
  const federationMemo = normalizeFederationMemo("exchange deposit", "text");
  assert.deepEqual(federationMemo, {
    memo: "exchange deposit",
    memoType: "text",
    federationBound: true,
  });
  assert.deepEqual(
    clearFederationMemoForDestinationChange(federationMemo),
    { memo: "", memoType: "text", federationBound: false },
  );
  assert.deepEqual(
    clearFederationMemoForDestinationChange({
      memo: "my note",
      memoType: "text",
      federationBound: false,
    }),
    { memo: "my note", memoType: "text", federationBound: false },
  );
});

test("fails closed for unsupported SEP-7 and federation memo types", () => {
  const parsed = parseSep7PayUri(
    `web+stellar:pay?destination=${DESTINATION}&memo=abc&memo_type=MEMO_FUTURE`,
  );
  assert.equal(parsed?.unsupportedMemoType, "MEMO_FUTURE");
  assert.match(validateSep7PayRequest(parsed), /memo type.*not supported/i);
  assert.throws(
    () => normalizeFederationMemo("abc", "future"),
    /memo type.*not supported/i,
  );
});

test("memo review presentation includes the exact memo type", () => {
  assert.deepEqual(memoReviewPresentation("42", "id"), {
    label: "Memo (ID)",
    value: "42",
  });
  assert.equal(memoReviewPresentation("", "text"), null);
});
