import assert from "node:assert/strict";
import test from "node:test";

import {
  Asset,
  Keypair,
  Networks,
  StrKey,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

import { fetchActivity, fetchBalances, sendBatchPayments, sendPayment } from "../src/lib/api.ts";
import { lookupKnownAsset, POPULAR_ASSETS } from "../src/lib/assets.ts";
import {
  fmtAmount,
  formatActivityAmount,
  generateActivityCsv,
  normalizeAmount,
} from "../src/lib/format.ts";
import { assetPriceKey, estimatePortfolioUsd, getUnitPrice } from "../src/lib/prices.ts";
import { parseFiatRates } from "../src/lib/prices.ts";
import { applyMultisigConfig } from "../src/lib/multisig.ts";
import {
  assetMetadataCacheKey,
  extractCurrencyInfo,
  isAssetMetadataFresh,
  selectCurrentAssetMetadata,
} from "../src/lib/toml.ts";
import {
  activityAssetPresentation,
  activityAssetKey,
  assetDetailBalanceSummary,
  deriveSacContractId,
  spendableAssetBalance,
} from "../src/lib/transaction-intent.ts";

const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

function submittedTransaction(fetchCalls) {
  const submission = fetchCalls.find((call) => call.url.endsWith("/transactions"));
  assert.ok(submission, "expected a Horizon transaction submission");
  const xdr = new URLSearchParams(submission.init.body).get("tx");
  assert.ok(xdr);
  return TransactionBuilder.fromXdr(xdr, Networks.TESTNET);
}

function mockPaymentHorizon(t, sourcePublicKey, destinationPublicKey) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const stringUrl = String(url);
    calls.push({ url: stringUrl, init });
    if (stringUrl.endsWith(`/accounts/${sourcePublicKey}`)) {
      return new Response(JSON.stringify({ sequence: "0" }), { status: 200 });
    }
    if (stringUrl.endsWith(`/accounts/${destinationPublicKey}`)) {
      return new Response(JSON.stringify({ sequence: "0" }), { status: 200 });
    }
    if (stringUrl.endsWith("/transactions")) {
      return new Response(JSON.stringify({ hash: "submitted" }), { status: 200 });
    }
    throw new Error(`Unexpected Horizon URL: ${stringUrl}`);
  });
  return calls;
}

test("normalizes Stellar amounts without floating-point loss", () => {
  assert.equal(normalizeAmount("922337203685.4775807"), "922337203685.4775807");
  assert.equal(normalizeAmount("00012.3400000"), "12.34");
  assert.equal(normalizeAmount("0.0000001"), "0.0000001");
});

test("formats large Stellar decimal strings without losing stroops", () => {
  assert.equal(fmtAmount("922337203685.4775807"), "922,337,203,685.4775807");
  assert.equal(fmtAmount("9007199254740993.0000001"), "9,007,199,254,740,993.0000001");
  assert.equal(fmtAmount("00001234.1000000"), "1,234.1");
  assert.equal(fmtAmount("0.0000001"), "0.0000001");
});

test("all advertised asset issuers are valid for their configured network", async () => {
  const { StrKey } = await import("@stellar/stellar-sdk");
  for (const asset of POPULAR_ASSETS) {
    if (asset.mainnetIssuer) {
      assert.equal(
        StrKey.isValidEd25519PublicKey(asset.mainnetIssuer),
        true,
        `${asset.code} has an invalid mainnet issuer`,
      );
    }
    if (asset.testnetIssuer) {
      assert.equal(
        StrKey.isValidEd25519PublicKey(asset.testnetIssuer),
        true,
        `${asset.code} has an invalid testnet issuer`,
      );
    }
  }
});

test("known asset lookup requires the exact issuer and network", () => {
  assert.equal(lookupKnownAsset("USDC", USDC_ISSUER, "mainnet")?.name, "USD Coin");
  assert.equal(lookupKnownAsset("USDC", Keypair.random().publicKey(), "mainnet"), null);
  assert.equal(lookupKnownAsset("USDC", USDC_ISSUER, "testnet"), null);
});

test("portfolio pricing requires an exact verified issuer", () => {
  const key = assetPriceKey("mainnet", "USDC", USDC_ISSUER);
  const prices = { [key]: 1 };
  const verified = [{
    key: `USDC:${USDC_ISSUER}`,
    code: "USDC",
    issuer: USDC_ISSUER,
    balance: "25",
    limit: null,
    isNative: false,
  }];
  const counterfeit = [{ ...verified[0], issuer: Keypair.random().publicKey() }];

  assert.equal(estimatePortfolioUsd(verified, null, prices, "mainnet"), 25);
  assert.equal(estimatePortfolioUsd(counterfeit, null, prices, "mainnet"), 0);
  assert.equal(getUnitPrice("XLM", null, "testnet", true, 0.25, {}), null);
});

test("derives live fiat conversion rates from a common market base", () => {
  const rates = parseFiatRates({
    usd: { value: 0.00001 },
    eur: { value: 0.0000092 },
    gbp: { value: 0.0000079 },
  });
  assert.equal(rates.USD, 1);
  assert.ok(Math.abs(rates.EUR - 0.92) < 1e-12);
  assert.ok(Math.abs(rates.GBP - 0.79) < 1e-12);
});

test("batch transaction fee is linear in its operation count", async (t) => {
  const source = Keypair.random();
  const destination = Keypair.random().publicKey();
  const calls = mockPaymentHorizon(t, source.publicKey(), destination);

  await sendBatchPayments({
    network: "testnet",
    secretKey: source.secret(),
    payments: [
      { destination, amount: "1", assetCode: "XLM" },
      { destination, amount: "2", assetCode: "XLM" },
    ],
  });

  assert.equal(submittedTransaction(calls).fee, "200");
});

test("batch payments activate an unfunded native destination", async (t) => {
  const source = Keypair.random();
  const destination = Keypair.random().publicKey();
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const stringUrl = String(url);
    calls.push({ url: stringUrl, init });
    if (stringUrl.endsWith(`/accounts/${source.publicKey()}`)) {
      return new Response(JSON.stringify({ sequence: "0" }), { status: 200 });
    }
    if (stringUrl.endsWith(`/accounts/${destination}`)) {
      return new Response(JSON.stringify({ title: "Resource Missing" }), { status: 404 });
    }
    if (stringUrl.endsWith("/transactions")) {
      return new Response(JSON.stringify({ hash: "submitted" }), { status: 200 });
    }
    throw new Error(`Unexpected Horizon URL: ${stringUrl}`);
  });

  await sendBatchPayments({
    network: "testnet",
    secretKey: source.secret(),
    payments: [{ destination, amount: "2", assetCode: "XLM" }],
  });

  assert.equal(submittedTransaction(calls).operations[0].type, "createAccount");
});

test("batch payments reject Stellar's operation limit before querying Horizon", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("network should not be queried");
  });
  const destination = Keypair.random().publicKey();
  await assert.rejects(
    sendBatchPayments({
      network: "testnet",
      secretKey: Keypair.random().secret(),
      payments: Array.from({ length: 101 }, () => ({
        destination,
        amount: "1",
        assetCode: "XLM",
      })),
    }),
    /100 operations/i,
  );
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("multisig rejects malformed thresholds before querying Horizon", async (t) => {
  const account = Keypair.random();
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("network should not be queried");
  });

  for (const config of [
    { low: -1, medium: 1, high: 1 },
    { low: 0.5, medium: 1, high: 1 },
    { low: 1, medium: 1, high: 256 },
  ]) {
    await assert.rejects(
      applyMultisigConfig({
        network: "testnet",
        accountPublicKey: account.publicKey(),
        secretKey: account.secret(),
        config: {
          signers: [{ key: account.publicKey(), weight: 1 }],
          ...config,
        },
      }),
      /thresholds must be whole numbers between 0 and 255/i,
    );
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("multisig rejects duplicate signers before querying Horizon", async (t) => {
  const account = Keypair.random();
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("network should not be queried");
  });

  await assert.rejects(
    applyMultisigConfig({
      network: "testnet",
      accountPublicKey: account.publicKey(),
      secretKey: account.secret(),
      config: {
        signers: [
          { key: account.publicKey(), weight: 1 },
          { key: account.publicKey(), weight: 1 },
        ],
        low: 1,
        medium: 1,
        high: 1,
      },
    }),
    /signer addresses must be unique/i,
  );
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("payment preserves an ID memo in the signed XDR", async (t) => {
  const source = Keypair.random();
  const destination = Keypair.random().publicKey();
  const calls = mockPaymentHorizon(t, source.publicKey(), destination);

  await sendPayment({
    network: "testnet",
    secretKey: source.secret(),
    destination,
    amount: "1",
    assetCode: "XLM",
    memo: { type: "id", value: "18446744073709551615" },
  });

  const memo = submittedTransaction(calls).memo;
  assert.equal(memo.type, "id");
  assert.equal(memo.value.toString(), "18446744073709551615");
});

test("an issued asset named XLM stays a credit asset", async (t) => {
  const source = Keypair.random();
  const destination = Keypair.random().publicKey();
  const calls = mockPaymentHorizon(t, source.publicKey(), destination);

  await sendPayment({
    network: "testnet",
    secretKey: source.secret(),
    destination,
    amount: "1",
    assetCode: "XLM",
    issuer: USDC_ISSUER,
  });

  const payment = submittedTransaction(calls).operations[0];
  assert.equal(payment.type, "payment");
  assert.equal(payment.asset.isNative(), false);
  assert.equal(payment.asset.getIssuer(), USDC_ISSUER);
});

test("minimum balance includes sponsorship deltas and the transaction fee", async () => {
  const { calculateSpendableNative } = await import("../src/lib/stellar-domain.ts");
  assert.equal(
    calculateSpendableNative({
      balance: "10",
      baseReserveStroops: "5000000",
      subentryCount: 3,
      numSponsoring: 2,
      numSponsored: 1,
      feeStroops: "200",
    }),
    "6.99998",
  );
});

test("amount arithmetic stays exact at seven decimal places", async () => {
  const { applySlippage, fractionOfStellarAmount, splitStellarAmount, sumStellarAmounts } = await import(
    "../src/lib/stellar-domain.ts"
  );
  assert.equal(sumStellarAmounts(["0.1", "0.2", "0.0000001"]), "0.3000001");
  assert.equal(applySlippage("1.0000001", "0.5"), "0.995");
  assert.equal(fractionOfStellarAmount("1.0000001", 1, 4), "0.25");
  assert.deepEqual(splitStellarAmount("1", 3), ["0.3333334", "0.3333333", "0.3333333"]);
});

test("loads the live account reserve inputs from Horizon", async (t) => {
  const publicKey = Keypair.random().publicKey();
  t.mock.method(globalThis, "fetch", async (url) => {
    const value = String(url);
    if (value.endsWith(`/accounts/${publicKey}`)) {
      return new Response(JSON.stringify({
        subentry_count: 3,
        num_sponsoring: 2,
        num_sponsored: 1,
      }), { status: 200 });
    }
    if (value.includes("/ledgers?")) {
      return new Response(JSON.stringify({
        _embedded: { records: [{ base_reserve_in_stroops: "5000000" }] },
      }), { status: 200 });
    }
    throw new Error(`Unexpected URL: ${value}`);
  });

  const { fetchMinimumNativeBalance } = await import("../src/lib/api.ts");
  assert.equal(await fetchMinimumNativeBalance(publicKey, "testnet"), "3");
});

test("stellar.toml metadata requires an exact case-sensitive code and issuer", () => {
  const counterfeitIssuer = Keypair.random().publicKey();
  const toml = `
[[CURRENCIES]]
code="usdc"
issuer="${USDC_ISSUER}"
image="https://example.com/lowercase.png"

[[CURRENCIES]]
code="USDC"
issuer="${counterfeitIssuer}"
image="https://example.com/counterfeit.png"

[[CURRENCIES]]
code="USDC"
issuer="${USDC_ISSUER}"
image="https://example.com/exact.png"
`;

  assert.deepEqual(extractCurrencyInfo(toml, "USDC", USDC_ISSUER), {
    declared: true,
    logoUrl: "https://example.com/exact.png",
  });
  assert.deepEqual(extractCurrencyInfo(toml, "usdc", USDC_ISSUER), {
    declared: true,
    logoUrl: "https://example.com/lowercase.png",
  });
  assert.deepEqual(extractCurrencyInfo(toml, "USDC", Keypair.random().publicKey()), {
    declared: false,
  });
});

test("stellar.toml metadata ignores comments and fields from later tables", () => {
  const toml = `
[[CURRENCIES]]
code="USDC"
# issuer="${USDC_ISSUER}"

[DOCUMENTATION]
issuer="${USDC_ISSUER}"
image="https://example.com/not-currency-metadata.png"
`;

  assert.deepEqual(extractCurrencyInfo(toml, "USDC", USDC_ISSUER), {
    declared: false,
  });
});

test("stellar.toml metadata supports literal strings and rejects mixed invalid quoting", () => {
  const literalToml = `
[[ CURRENCIES ]]
code = 'USDC'
issuer = '${USDC_ISSUER}'
image = 'https://example.com/usdc.png#asset'
`;
  assert.deepEqual(extractCurrencyInfo(literalToml, "USDC", USDC_ISSUER), {
    declared: true,
    logoUrl: "https://example.com/usdc.png#asset",
  });
  assert.deepEqual(
    extractCurrencyInfo(`[[CURRENCIES]]\ncode='USDC"\nissuer='${USDC_ISSUER}'`, "USDC", USDC_ISSUER),
    { declared: false },
  );
});

test("asset metadata cache keys are isolated by Horizon context", () => {
  assert.notEqual(
    assetMetadataCacheKey("USDC", USDC_ISSUER, "https://horizon.stellar.org"),
    assetMetadataCacheKey("USDC", USDC_ISSUER, "https://horizon-testnet.stellar.org"),
  );
});

test("asset metadata cache entries expire and reject future timestamps", () => {
  const cachedAt = 1_000_000;
  assert.equal(isAssetMetadataFresh(cachedAt, cachedAt + 60_000), true);
  assert.equal(isAssetMetadataFresh(cachedAt, cachedAt + 24 * 60 * 60 * 1000), false);
  assert.equal(isAssetMetadataFresh(cachedAt + 1, cachedAt), false);
});

test("asset metadata presentation never exposes state from another asset or network", () => {
  const mainnetIdentity = assetMetadataCacheKey(
    "USDC",
    USDC_ISSUER,
    "https://horizon.stellar.org",
  );
  const testnetIdentity = assetMetadataCacheKey(
    "USDC",
    USDC_ISSUER,
    "https://horizon-testnet.stellar.org",
  );
  const priorState = {
    identity: mainnetIdentity,
    logoUrl: "https://example.com/mainnet.png",
    issuerInfo: { domain: "example.com", assetDeclared: true },
  };

  assert.equal(selectCurrentAssetMetadata(testnetIdentity, priorState), null);
  assert.equal(selectCurrentAssetMetadata(null, priorState), null);
  assert.equal(selectCurrentAssetMetadata(mainnetIdentity, priorState), priorState);
});

test("activity asset identity includes the issuer", () => {
  assert.equal(activityAssetKey({ assetCode: "XLM", assetIssuer: null }), "native");
  assert.equal(
    activityAssetKey({ assetCode: "USDC", assetIssuer: USDC_ISSUER }),
    `USDC:${USDC_ISSUER}`,
  );
  assert.notEqual(
    activityAssetKey({ assetCode: "USDC", assetIssuer: USDC_ISSUER }),
    activityAssetKey({ assetCode: "USDC", assetIssuer: Keypair.random().publicKey() }),
  );
});

test("assetless operations remain assetless and activity signs reflect direction", () => {
  assert.deepEqual(
    activityAssetPresentation({ assetCode: null, assetIssuer: null }),
    {
      code: null,
      issuer: null,
      issuerDisplay: null,
      identity: null,
      detailLabel: null,
      compactLabel: null,
      isNative: false,
    },
  );
  assert.equal(formatActivityAmount({ amount: "7.25", direction: "neutral" }), "7.25");
  assert.equal(formatActivityAmount({ amount: "7.25", direction: "in" }), "+7.25");
  assert.equal(formatActivityAmount({ amount: "7.25", direction: "out" }), "−7.25");
  assert.equal(formatActivityAmount({ amount: null, direction: "neutral" }), null);

  const csv = generateActivityCsv([{
    id: "assetless",
    type: "set_options",
    title: "Set Options",
    direction: "neutral",
    amount: null,
    assetCode: null,
    assetIssuer: null,
    counterparty: null,
    hash: "assetless-hash",
    createdAt: "2026-01-01T00:00:00Z",
    successful: true,
  }]);
  assert.match(csv, /"neutral","",""/);
  assert.doesNotMatch(csv, /XLM/);
});

test("issuer-aware activity presentation and CSV retain the full asset identity", () => {
  const presentation = activityAssetPresentation({
    assetCode: "USDC",
    assetIssuer: USDC_ISSUER,
  });
  assert.deepEqual(presentation, {
    code: "USDC",
    issuer: USDC_ISSUER,
    issuerDisplay: "GA5ZS…4KZVN",
    identity: `USDC:${USDC_ISSUER}`,
    detailLabel: `USDC:${USDC_ISSUER}`,
    compactLabel: "USDC · GA5ZS…4KZVN",
    isNative: false,
  });
  assert.deepEqual(
    activityAssetPresentation({ assetCode: "XLM", assetIssuer: null }),
    {
      code: "XLM",
      issuer: null,
      issuerDisplay: null,
      identity: "native",
      detailLabel: "XLM",
      compactLabel: "XLM",
      isNative: true,
    },
  );

  const csv = generateActivityCsv([{
    id: "1",
    type: "payment",
    title: "Received Payment",
    direction: "in",
    amount: "2",
    assetCode: "USDC",
    assetIssuer: USDC_ISSUER,
    counterparty: null,
    hash: "abc",
    createdAt: "2026-01-01T00:00:00Z",
    successful: true,
  }]);
  assert.match(csv, new RegExp(`"USDC:${USDC_ISSUER}"`));
});

test("derives and validates network-specific SAC contract IDs", () => {
  const native = {
    key: "native",
    code: "XLM",
    issuer: null,
    balance: "1",
    limit: null,
    sellingLiabilities: "0",
    isNative: true,
  };
  const issued = {
    ...native,
    key: `USDC:${USDC_ISSUER}`,
    code: "USDC",
    issuer: USDC_ISSUER,
    isNative: false,
  };

  const mainnetNative = deriveSacContractId(native, Networks.PUBLIC);
  const testnetNative = deriveSacContractId(native, Networks.TESTNET);
  assert.equal(StrKey.isValidContract(mainnetNative), true);
  assert.equal(StrKey.isValidContract(testnetNative), true);
  assert.notEqual(mainnetNative, testnetNative);
  assert.equal(
    deriveSacContractId(issued, Networks.PUBLIC),
    new Asset("USDC", USDC_ISSUER).contractId(Networks.PUBLIC),
  );
});

test("preserves selling liabilities and excludes them from spendable balance", async (t) => {
  const publicKey = Keypair.random().publicKey();
  t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({
      balances: [
        { asset_type: "native", balance: "10", selling_liabilities: "1.25" },
        {
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: USDC_ISSUER,
          balance: "20",
          limit: "100",
          selling_liabilities: "4.5",
        },
      ],
    }), { status: 200 }),
  );

  const balances = await fetchBalances(publicKey, "mainnet");
  assert.equal(balances[0].sellingLiabilities, "1.25");
  assert.equal(balances[1].sellingLiabilities, "4.5");
  assert.equal(spendableAssetBalance(balances[0], ["3", "0.00001"]), "5.74999");
  assert.equal(spendableAssetBalance(balances[1]), "15.5");
  assert.deepEqual(assetDetailBalanceSummary(balances[1], null), {
    balance: "20",
    sellingLiabilities: "4.5",
    minimumBalance: null,
    spendable: "15.5",
  });
});

test("maps path payments to the destination asset code and issuer", async (t) => {
  const publicKey = Keypair.random().publicKey();
  t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({
      _embedded: {
        records: [
          {
            id: "1",
            type: "path_payment_strict_send",
            created_at: "2026-01-01T00:00:00Z",
            transaction_successful: true,
            transaction_hash: "abc",
            from: publicKey,
            to: publicKey,
            amount: "9.5",
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            asset_issuer: USDC_ISSUER,
            source_amount: "10",
            source_asset_type: "native",
          },
        ],
      },
    }), { status: 200 }),
  );

  const result = await fetchActivity(publicKey, "mainnet", 30);
  assert.equal(result.items[0].amount, "9.5");
  assert.equal(result.items[0].assetCode, "USDC");
  assert.equal(result.items[0].assetIssuer, USDC_ISSUER);
});

test("maps strict-receive path payments to destination amount, code, and issuer", async (t) => {
  const publicKey = Keypair.random().publicKey();
  const destinationIssuer = Keypair.random().publicKey();
  t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({
      _embedded: {
        records: [
          {
            id: "2",
            type: "path_payment_strict_receive",
            created_at: "2026-01-02T00:00:00Z",
            transaction_successful: true,
            transaction_hash: "def",
            from: publicKey,
            to: publicKey,
            amount: "7.25",
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            asset_issuer: destinationIssuer,
            source_amount: "8",
            source_asset_type: "credit_alphanum4",
            source_asset_code: "USDC",
            source_asset_issuer: USDC_ISSUER,
          },
        ],
      },
    }), { status: 200 }),
  );

  const result = await fetchActivity(publicKey, "mainnet", 30);
  assert.equal(result.items[0].amount, "7.25");
  assert.equal(result.items[0].assetCode, "USDC");
  assert.equal(result.items[0].assetIssuer, destinationIssuer);
});

test("maps offer assets from their Horizon fields and leaves claims without asset data assetless", async (t) => {
  const publicKey = Keypair.random().publicKey();
  t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({
      _embedded: {
        records: [
          {
            id: "offer",
            type: "manage_sell_offer",
            created_at: "2026-01-03T00:00:00Z",
            transaction_successful: true,
            transaction_hash: "offer-hash",
            amount: "12.5",
            selling_asset_type: "credit_alphanum4",
            selling_asset_code: "USDC",
            selling_asset_issuer: USDC_ISSUER,
          },
          {
            id: "claim",
            type: "claim_claimable_balance",
            created_at: "2026-01-03T00:00:00Z",
            transaction_successful: true,
            transaction_hash: "claim-hash",
            balance_id: "0000",
          },
          {
            id: "create-claim",
            type: "create_claimable_balance",
            created_at: "2026-01-03T00:00:00Z",
            transaction_successful: true,
            transaction_hash: "create-claim-hash",
            amount: "3.5",
            asset: `USDC:${USDC_ISSUER}`,
          },
          {
            id: "buy-offer",
            type: "manage_buy_offer",
            created_at: "2026-01-03T00:00:00Z",
            transaction_successful: true,
            transaction_hash: "buy-offer-hash",
            buy_amount: "4.25",
            buying_asset_type: "native",
          },
          {
            id: "options",
            type: "set_options",
            created_at: "2026-01-03T00:00:00Z",
            transaction_successful: true,
            transaction_hash: "options-hash",
          },
        ],
      },
    }), { status: 200 }),
  );

  const result = await fetchActivity(publicKey, "mainnet", 30);
  assert.deepEqual(
    result.items.map(({ amount, assetCode, assetIssuer }) => ({ amount, assetCode, assetIssuer })),
    [
      { amount: "12.5", assetCode: "USDC", assetIssuer: USDC_ISSUER },
      { amount: null, assetCode: null, assetIssuer: null },
      { amount: "3.5", assetCode: "USDC", assetIssuer: USDC_ISSUER },
      { amount: "4.25", assetCode: "XLM", assetIssuer: null },
      { amount: null, assetCode: null, assetIssuer: null },
    ],
  );
});
