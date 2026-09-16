import assert from "node:assert/strict";
import test from "node:test";

import * as portfolio from "../src/lib/portfolio.ts";
const { aggregatePortfolio, portfolioSnapshotKey } = portfolio;
import { assetPriceKey } from "../src/lib/prices.ts";

const ACCOUNT_A = "GA".padEnd(56, "A");
const ACCOUNT_B = "GB".padEnd(56, "B");
const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const OTHER_ISSUER = "GB".padEnd(56, "C");

function balance(code, issuer, amount) {
  const isNative = issuer === null;
  return {
    key: isNative ? "native" : `${code}:${issuer}`,
    code,
    issuer,
    balance: amount,
    sellingLiabilities: "0.0000000",
    limit: null,
    isNative,
  };
}

function ready(publicKey, balances, network = "mainnet") {
  return {
    publicKey,
    network,
    status: "ready",
    balances,
    updatedAt: 1_800_000_000_000,
    error: null,
  };
}

test("all-account aggregation preserves exact asset identity and decimal sums", () => {
  const snapshots = {
    [portfolioSnapshotKey("mainnet", ACCOUNT_A)]: ready(ACCOUNT_A, [
      balance("XLM", null, "2.0000001"),
      balance("USDC", USDC_ISSUER, "5.5000000"),
    ]),
    [portfolioSnapshotKey("mainnet", ACCOUNT_B)]: ready(ACCOUNT_B, [
      balance("XLM", null, "3.0000002"),
      balance("USDC", USDC_ISSUER, "7.5000000"),
      balance("USDC", OTHER_ISSUER, "4.0000000"),
    ]),
  };
  const verifiedPrices = {
    [assetPriceKey("mainnet", "USDC", USDC_ISSUER)]: 1,
    [assetPriceKey("mainnet", "USDC", OTHER_ISSUER)]: 2,
  };

  const result = aggregatePortfolio({
    accounts: [ACCOUNT_A, ACCOUNT_B],
    snapshots,
    network: "mainnet",
    xlmPriceUsd: 0.1,
    assetPrices: verifiedPrices,
  });

  assert.equal(result.completeness, "complete");
  assert.equal(result.nativeBalance, "5.0000003");
  assert.deepEqual(
    result.assets.map((asset) => [asset.code, asset.issuer, asset.balance, asset.accountCount]),
    [
      ["XLM", null, "5.0000003", 2],
      ["USDC", USDC_ISSUER, "13.0000000", 2],
      ["USDC", OTHER_ISSUER, "4.0000000", 1],
    ],
  );
  assert.ok(Math.abs(result.totalUsd - 21.50000003) < 1e-10);
  assert.deepEqual(result.unpricedAssets, []);
});

test("a missing account or unverified asset makes the portfolio explicitly incomplete", () => {
  const snapshots = {
    [portfolioSnapshotKey("mainnet", ACCOUNT_A)]: ready(ACCOUNT_A, [
      balance("XLM", null, "2.0000000"),
      balance("USDC", OTHER_ISSUER, "4.0000000"),
    ]),
    [portfolioSnapshotKey("mainnet", ACCOUNT_B)]: {
      publicKey: ACCOUNT_B,
      network: "mainnet",
      status: "unavailable",
      balances: null,
      updatedAt: null,
      error: "Horizon timed out",
    },
  };

  const missing = aggregatePortfolio({
    accounts: [ACCOUNT_A, ACCOUNT_B],
    snapshots,
    network: "mainnet",
    xlmPriceUsd: 0.1,
    assetPrices: {},
  });
  assert.equal(missing.completeness, "partial");
  assert.equal(missing.nativeBalance, null);
  assert.equal(missing.totalUsd, null);
  assert.deepEqual(missing.unavailableAccounts, [ACCOUNT_B]);

  const completeSnapshots = {
    ...snapshots,
    [portfolioSnapshotKey("mainnet", ACCOUNT_B)]: ready(ACCOUNT_B, []),
  };
  const unpriced = aggregatePortfolio({
    accounts: [ACCOUNT_A, ACCOUNT_B],
    snapshots: completeSnapshots,
    network: "mainnet",
    xlmPriceUsd: 0.1,
    assetPrices: {},
  });
  assert.equal(unpriced.completeness, "complete");
  assert.equal(unpriced.totalUsd, null);
  assert.deepEqual(
    unpriced.unpricedAssets.map((asset) => [asset.code, asset.issuer]),
    [["USDC", OTHER_ISSUER]],
  );
});

test("snapshots from another network never enter the selected-network total", () => {
  const snapshots = {
    [portfolioSnapshotKey("testnet", ACCOUNT_A)]: ready(
      ACCOUNT_A,
      [balance("XLM", null, "99.0000000")],
      "testnet",
    ),
  };
  const result = aggregatePortfolio({
    accounts: [ACCOUNT_A],
    snapshots,
    network: "mainnet",
    xlmPriceUsd: 1,
    assetPrices: {},
  });

  assert.equal(result.completeness, "loading");
  assert.equal(result.nativeBalance, null);
  assert.equal(result.totalUsd, null);
  assert.deepEqual(result.loadingAccounts, [ACCOUNT_A]);
});

test("valuation lists every unpriced positive asset once, even after an oversized balance", () => {
  for (const nativeAmount of ["2", "1" + "0".repeat(310)]) {
    const result = aggregatePortfolio({
      accounts: [ACCOUNT_A],
      snapshots: {
        [portfolioSnapshotKey("mainnet", ACCOUNT_A)]: ready(ACCOUNT_A, [
          balance("XLM", null, nativeAmount),
          balance("USDC", USDC_ISSUER, "5"),
          balance("USDC", OTHER_ISSUER, "7"),
          balance("ZERO", OTHER_ISSUER, "0"),
        ]),
      },
      network: "mainnet",
      xlmPriceUsd: null,
      assetPrices: {
        [assetPriceKey("mainnet", "USDC", USDC_ISSUER)]: NaN,
        [assetPriceKey("mainnet", "USDC", OTHER_ISSUER)]: -1,
      },
    });
    assert.equal(result.totalUsd, null);
    assert.deepEqual(result.unpricedAssets.map(asset => asset.key), [
      "native", `USDC:${USDC_ISSUER}`, `USDC:${OTHER_ISSUER}`,
    ]);
  }
});

test("one malformed balance excludes the entire account before aggregation", () => {
  const result = aggregatePortfolio({
    accounts: [ACCOUNT_A, ACCOUNT_B],
    snapshots: {
      [portfolioSnapshotKey("mainnet", ACCOUNT_A)]: ready(ACCOUNT_A, [
        balance("XLM", null, "100"), balance("USDC", USDC_ISSUER, "invalid"),
      ]),
      [portfolioSnapshotKey("mainnet", ACCOUNT_B)]: ready(ACCOUNT_B, [balance("XLM", null, "2")]),
    },
    network: "mainnet",
    xlmPriceUsd: 1,
    assetPrices: {},
  });
  assert.equal(result.completeness, "partial");
  assert.deepEqual(result.unavailableAccounts, [ACCOUNT_A]);
  assert.deepEqual(result.assets.map(asset => [asset.key, asset.balance, asset.accountCount]), [
    ["native", "2.0000000", 1],
  ]);
  assert.equal(result.nativeBalance, null);
  assert.equal(result.totalUsd, null);
});

test("zero holdings do not require a market price", () => {
  const result = aggregatePortfolio({
    accounts: [ACCOUNT_A],
    snapshots: {
      [portfolioSnapshotKey("mainnet", ACCOUNT_A)]: ready(ACCOUNT_A, [
        balance("XLM", null, "0"), balance("USDC", USDC_ISSUER, "0"),
      ]),
    },
    network: "mainnet",
    xlmPriceUsd: null,
    assetPrices: {},
  });
  assert.equal(result.totalUsd, 0);
  assert.deepEqual(result.unpricedAssets, []);
});

test("every account can show its own complete Testnet reference value", () => {
  assert.equal(typeof portfolio.representativePortfolioUsd, "function");
  const snapshots = {
    [portfolioSnapshotKey("testnet", ACCOUNT_A)]: ready(ACCOUNT_A, [balance("XLM", null, "20")], "testnet"),
    [portfolioSnapshotKey("testnet", ACCOUNT_B)]: ready(ACCOUNT_B, [balance("XLM", null, "40")], "testnet"),
  };
  const value = account => portfolio.representativePortfolioUsd({
    portfolio: aggregatePortfolio({ accounts: [account], snapshots, network: "testnet", xlmPriceUsd: 0.25, assetPrices: {} }),
    network: "testnet", xlmPriceUsd: 0.25, assetPrices: {},
  });
  assert.equal(value(ACCOUNT_A), 5);
  assert.equal(value(ACCOUNT_B), 10);
});

test("account values include issued assets instead of falling back to native XLM alone", () => {
  assert.equal(typeof portfolio.representativePortfolioUsd, "function");
  const snapshots = {
    [portfolioSnapshotKey("mainnet", ACCOUNT_B)]: ready(ACCOUNT_B, [
      balance("XLM", null, "40"), balance("USDC", USDC_ISSUER, "7"),
    ]),
  };
  const assetPrices = { [assetPriceKey("mainnet", "USDC", USDC_ISSUER)]: 1 };
  const total = aggregatePortfolio({ accounts: [ACCOUNT_B], snapshots, network: "mainnet", xlmPriceUsd: 0.25, assetPrices });
  assert.equal(portfolio.representativePortfolioUsd({ portfolio: total, network: "mainnet", xlmPriceUsd: 0.25, assetPrices }), 17);
});

test("account reference values distinguish missing data, unpriced holdings, and genuine zero", () => {
  assert.equal(typeof portfolio.representativePortfolioUsd, "function");
  const input = { accounts: [ACCOUNT_B], network: "testnet", xlmPriceUsd: 0.25, assetPrices: {} };
  const value = snapshots => portfolio.representativePortfolioUsd({
    portfolio: aggregatePortfolio({ ...input, snapshots }), ...input,
  });
  const key = portfolioSnapshotKey("testnet", ACCOUNT_B);
  assert.equal(value({}), null);
  assert.equal(value({ [key]: { ...ready(ACCOUNT_B, [], "testnet"), status: "unavailable" } }), null);
  assert.equal(value({ [key]: ready(ACCOUNT_B, [balance("XLM", null, "40"), balance("USDC", OTHER_ISSUER, "7")], "testnet") }), null);
  assert.equal(value({ [key]: ready(ACCOUNT_B, [], "testnet") }), 0);
});
