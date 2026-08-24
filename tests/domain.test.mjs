import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  Account,
  Asset,
  Keypair,
  MuxedAccount,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";

import {
  changeTrust,
  changeTrustBatch,
  claimClaimableBalance,
  fetchAccountSignerInfo,
  fetchActivity,
  fetchBalances,
  mergeAccount,
  networkFeeXlm,
  selectRecommendedBaseFee,
  sendBatchPayments,
  sendPayment,
} from "../src/lib/api.ts";
import { swapStrictSend } from "../src/lib/swap.ts";
import { lookupKnownAsset, POPULAR_ASSETS } from "../src/lib/assets.ts";
import {
  fmtAmount,
  formatActivityAmount,
  generateActivityCsv,
  normalizeAmount,
} from "../src/lib/format.ts";
import { assetPriceKey, estimatePortfolioUsd, getUnitPrice } from "../src/lib/prices.ts";
import { parseFiatRates } from "../src/lib/prices.ts";
import {
  applyMultisigConfig,
  cosignTransaction,
  explainTransaction,
  requiredWeightForTx,
} from "../src/lib/multisig.ts";
import * as multisig from "../src/lib/multisig.ts";
import {
  assetMetadataCacheKey,
  extractCurrencyInfo,
  isAssetMetadataFresh,
  selectCurrentAssetMetadata,
} from "../src/lib/toml.ts";
import {
  addTrustlineSelection,
  activityAssetPresentation,
  activityAssetKey,
  assetDetailBalanceSummary,
  deriveSacContractId,
  spendableAssetBalance,
  toggleTrustlineSelection,
} from "../src/lib/transaction-intent.ts";
import {
  assertReviewCanBeSigned,
  reviewTransactionEnvelope,
} from "../src/lib/transaction-review.ts";
import * as transactionReview from "../src/lib/transaction-review.ts";

const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

function submittedTransaction(fetchCalls) {
  const submission = fetchCalls.find((call) => call.url.endsWith("/transactions"));
  assert.ok(submission, "expected a Horizon transaction submission");
  const xdr = new URLSearchParams(submission.init.body).get("tx");
  assert.ok(xdr);
  return TransactionBuilder.fromXdr(xdr, Networks.TESTNET);
}

function canonicalSubmissionHash(init) {
  const xdr = new URLSearchParams(init.body).get("tx");
  assert.ok(xdr, "expected submitted transaction XDR");
  const transaction = TransactionBuilder.fromXdr(xdr, Networks.TESTNET);
  return Buffer.from(transaction.hash()).toString("hex");
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
      return new Response(JSON.stringify({ hash: canonicalSubmissionHash(init) }), { status: 200 });
    }
    throw new Error(`Unexpected Horizon URL: ${stringUrl}`);
  });
  return calls;
}

function buildReviewTransaction(source, operations, options = {}) {
  const builder = new TransactionBuilder(new Account(source.publicKey(), "0"), {
    fee: String(100 * operations.length),
    networkPassphrase: Networks.TESTNET,
  });
  for (const operation of operations) builder.addOperation(operation);
  if (options.memo) builder.addMemo(options.memo);
  return options.timeout === 0
    ? builder.setTimeout(0).build()
    : builder.setTimebounds(0, options.timeout ?? Math.floor(Date.now() / 1000) + 300).build();
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

test("shared dynamic fee policy selects a bounded surge fee with a safe fallback", () => {
  assert.equal(typeof selectRecommendedBaseFee, "function");
  assert.equal(selectRecommendedBaseFee(null), 100);
  assert.equal(selectRecommendedBaseFee({ p90AcceptedFee: 777 }), 777);
  assert.equal(selectRecommendedBaseFee({ p90AcceptedFee: 1 }), 100);
  assert.equal(selectRecommendedBaseFee({ p90AcceptedFee: 9_999_999 }), 100_000);
  assert.equal(selectRecommendedBaseFee({ p90AcceptedFee: Number.NaN }), 100);
  assert.equal(networkFeeXlm(777, 1), "0.0000777");
  assert.equal(networkFeeXlm(777, 20), "0.001554");
});

test("every broadcast builder applies the shared surge fee per operation", async (t) => {
  const source = Keypair.random();
  const destination = Keypair.random().publicKey();
  const issuer = Keypair.random().publicKey();
  const cosigner = Keypair.random().publicKey();
  const posted = [];
  const events = [];
  const prepared = (identity) => events.push(`prepared:${identity.hash}`);

  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const stringUrl = String(url);
    if (stringUrl.endsWith("/fee_stats")) {
      return new Response(JSON.stringify({
        last_ledger_base_fee: "100",
        fee_charged: { min: "100", mode: "300", p90: "777", p99: "900" },
      }), { status: 200 });
    }
    if (stringUrl.includes("/accounts/")) {
      const accountPublicKey = decodeURIComponent(stringUrl.split("/accounts/")[1]);
      return new Response(JSON.stringify({
        sequence: "0",
        thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
        signers: [{
          key: accountPublicKey,
          weight: 1,
          type: "ed25519_public_key",
        }],
      }), { status: 200 });
    }
    if (stringUrl.endsWith("/transactions")) {
      const transaction = TransactionBuilder.fromXdr(
        new URLSearchParams(init.body).get("tx"),
        Networks.TESTNET,
      );
      const hash = Buffer.from(transaction.hash()).toString("hex");
      posted.push(transaction);
      events.push(`post:${hash}`);
      return new Response(JSON.stringify({ hash }), { status: 200 });
    }
    throw new Error(`Unexpected Horizon URL: ${stringUrl}`);
  });

  await claimClaimableBalance({
    network: "testnet",
    secretKey: source.secret(),
    balanceId: `00000000${"00".repeat(32)}`,
    onPrepared: prepared,
  });
  await mergeAccount({
    network: "testnet",
    secretKey: source.secret(),
    destination,
    onPrepared: prepared,
  });
  await sendPayment({
    network: "testnet",
    secretKey: source.secret(),
    destination,
    amount: "1",
    assetCode: "XLM",
    onPrepared: prepared,
  });
  await sendBatchPayments({
    network: "testnet",
    secretKey: source.secret(),
    payments: [
      { destination, amount: "1", assetCode: "XLM" },
      { destination, amount: "2", assetCode: "XLM" },
    ],
    onPrepared: prepared,
  });
  await changeTrust({
    network: "testnet",
    secretKey: source.secret(),
    code: "USD",
    issuer,
    add: true,
    onPrepared: prepared,
  });
  await changeTrustBatch({
    network: "testnet",
    secretKey: source.secret(),
    assets: [{ code: "USD", issuer }, { code: "EUR", issuer }],
    onPrepared: prepared,
  });
  await swapStrictSend({
    network: "testnet",
    secretKey: source.secret(),
    sendCode: "XLM",
    sendAmount: "1",
    destCode: "USD",
    destIssuer: issuer,
    destMin: "0.5",
    intermediates: [],
    onPrepared: prepared,
  });
  const multisigOutcome = await applyMultisigConfig({
    network: "testnet",
    accountPublicKey: source.publicKey(),
    secretKey: source.secret(),
    config: {
      signers: [
        { key: source.publicKey(), weight: 1 },
        { key: cosigner, weight: 1 },
      ],
      low: 1,
      medium: 1,
      high: 1,
    },
    onPrepared: prepared,
  });

  assert.equal(multisigOutcome.submission?.status, "accepted");
  assert.equal(posted.length, 8);
  for (const transaction of posted) {
    assert.equal(
      transaction.fee,
      String(777 * transaction.operations.length),
      `${transaction.operations[0]?.type} did not multiply the shared base fee by operation count`,
    );
    const hash = Buffer.from(transaction.hash()).toString("hex");
    assert.ok(
      events.indexOf(`prepared:${hash}`) < events.indexOf(`post:${hash}`),
      "the persisted recovery callback must run before each builder reaches Horizon",
    );
    assert.equal(
      transactionReview.reviewTransactionEnvelope(transaction.toXdr(), "testnet").feeXlm,
      networkFeeXlm(777, transaction.operations.length),
      "display/review helper diverged from the signed transaction fee",
    );
  }
});

test("active transaction UIs use the selected fee for display and native reserve", () => {
  const wallet = readFileSync(new URL("../src/hooks/useWallet.tsx", import.meta.url), "utf8");
  const send = readFileSync(new URL("../src/components/SendModal.tsx", import.meta.url), "utf8");
  const batch = readFileSync(new URL("../src/components/BatchSendModal.tsx", import.meta.url), "utf8");
  const swap = readFileSync(new URL("../src/components/SwapPage.tsx", import.meta.url), "utf8");
  const assets = readFileSync(new URL("../src/components/AddAssetModal.tsx", import.meta.url), "utf8");
  const settings = readFileSync(new URL("../src/components/SettingsPage.tsx", import.meta.url), "utf8");

  assert.match(wallet, /recommendedBaseFeeStroops/);
  assert.ok(
    (wallet.match(/feeStroops: recommendedBaseFeeStroops/g) ?? []).length >= 8,
    "all provider-owned transaction builders must receive the selected base fee",
  );
  assert.doesNotMatch(send, /normalStroops\s*=\s*liveFeeStats\?\.modeAcceptedFee/);
  assert.match(send, /normalStroops\s*=\s*recommendedBaseFeeStroops/);
  assert.match(batch, /networkFeeXlm\(recommendedBaseFeeStroops, validRows\.length\)/);
  assert.match(swap, /networkFeeXlm\(recommendedBaseFeeStroops, 1\)/);
  assert.match(
    assets,
    /networkFeeXlm\([\s\S]*Math\.min\(selected\.length, MAX_TRUSTLINE_SELECTIONS\)/,
  );
  assert.match(settings, /networkFeeXlm\(recommendedBaseFeeStroops, 1\)/);
});

test("trustline selection rejects the 101st unique operation without breaking fee display", () => {
  assert.equal(typeof addTrustlineSelection, "function");
  assert.equal(typeof toggleTrustlineSelection, "function");
  const issuer = Keypair.random().publicKey();
  const full = Array.from({ length: 100 }, (_, index) => ({
    code: `A${index}`,
    issuer,
  }));
  const overflow = addTrustlineSelection(full, { code: "OVER", issuer });
  assert.equal(overflow.error, "A Stellar transaction can contain at most 100 trustlines.");
  assert.equal(overflow.selected.length, 100);
  assert.deepEqual(overflow.selected, full);

  const duplicate = addTrustlineSelection(full, full[0]);
  assert.match(duplicate.error, /already queued/i);
  assert.equal(duplicate.selected.length, 100);

  const removed = toggleTrustlineSelection(full, full[0]);
  assert.equal(removed.error, null);
  assert.equal(removed.selected.length, 99);

  const source = readFileSync(new URL("../src/components/AddAssetModal.tsx", import.meta.url), "utf8");
  assert.match(source, /addTrustlineSelection/);
  assert.match(source, /toggleTrustlineSelection/);
  assert.match(source, /Math\.min\(selected\.length, MAX_TRUSTLINE_SELECTIONS\)/);
  assert.match(source, /setError\(update\.error\)/);
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
      return new Response(JSON.stringify({ hash: canonicalSubmissionHash(init) }), { status: 200 });
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

test("account merge requires the source account high threshold", () => {
  const source = Keypair.random();
  const destination = Keypair.random().publicKey();
  const tx = buildReviewTransaction(source, [
    Operation.accountMerge({ destination }),
  ]);

  assert.equal(
    requiredWeightForTx(tx, {
      low_threshold: 1,
      med_threshold: 2,
      high_threshold: 3,
    }),
    3,
  );
});

test("transaction review is fail-closed and preserves operation source and asset identity", async (t) => {
  const transactionSource = Keypair.random();
  const operationSource = Keypair.random();
  const destination = Keypair.random().publicKey();
  const issuedAsset = new Asset("USDC", USDC_ISSUER);
  const tx = buildReviewTransaction(transactionSource, [
    Operation.payment({
      source: operationSource.publicKey(),
      destination,
      amount: "4.25",
      asset: issuedAsset,
    }),
    Operation.beginSponsoringFutureReserves({
      sponsoredId: destination,
    }),
  ]);

  t.mock.method(globalThis, "fetch", async (url) => {
    const publicKey = String(url).split("/accounts/")[1];
    if (![transactionSource.publicKey(), operationSource.publicKey()].includes(publicKey)) {
      throw new Error(`Unexpected Horizon URL: ${url}`);
    }
    return new Response(JSON.stringify({
      thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 3 },
      signers: [{ key: publicKey, weight: 3, type: "ed25519_public_key" }],
    }), { status: 200 });
  });

  const review = await explainTransaction(tx.toXdr(), "testnet");
  assert.equal(review.network, "testnet");
  assert.equal(review.signable, false);
  assert.match(review.blockingReasons.join(" "), /unsupported.*beginSponsoringFutureReserves/i);
  assert.deepEqual(review.authorizations.map((entry) => entry.source).sort(), [
    operationSource.publicKey(),
    transactionSource.publicKey(),
  ].sort());
  for (const expectedLine of [
    { label: "Operation source", value: operationSource.publicKey(), kind: "address" },
    { label: "Asset", value: `USDC:${USDC_ISSUER}`, kind: "mono" },
    { label: "Amount", value: "4.2500000", kind: "mono" },
    { label: "Destination", value: destination, kind: "address" },
  ]) {
    assert.ok(review.operations[0].lines.some((line) =>
      line.label === expectedLine.label &&
      line.value === expectedLine.value &&
      line.kind === expectedLine.kind
    ));
  }
});

test("transaction explanation exposes exact minimum and maximum time bounds", async (t) => {
  const source = Keypair.random();
  const now = Math.floor(Date.now() / 1000);
  const minTime = String(now + 30);
  const maxTime = String(now + 300);
  const tx = new TransactionBuilder(new Account(source.publicKey(), "0"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({
      destination: Keypair.random().publicKey(),
      amount: "1",
      asset: Asset.native(),
    }))
    .setTimebounds(Number(minTime), Number(maxTime))
    .build();
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
    signers: [{ key: source.publicKey(), weight: 1, type: "ed25519_public_key" }],
  }), { status: 200 }));

  const explanation = await explainTransaction(tx.toXdr(), "testnet");

  assert.deepEqual(explanation.timeBounds, { minTime, maxTime });
});

test("fee review formats arbitrarily large stroop strings without Number conversion", () => {
  assert.equal(typeof transactionReview.formatStroopFeeXlm, "function");
  assert.equal(
    transactionReview.formatStroopFeeXlm("9007199254740993"),
    "900719925.4740993",
  );
});

test("exact signing-review values use a non-truncating breakable presentation", () => {
  assert.equal(typeof transactionReview.EXACT_REVIEW_VALUE_CLASS, "string");
  assert.match(transactionReview.EXACT_REVIEW_VALUE_CLASS, /\bbreak-all\b/);
  assert.match(transactionReview.EXACT_REVIEW_VALUE_CLASS, /\bwhitespace-pre-wrap\b/);
  assert.doesNotMatch(transactionReview.EXACT_REVIEW_VALUE_CLASS, /\btruncate\b|\bline-clamp/);
});

test("approval signing stays bound to the exact reviewed XDR and network", () => {
  assert.equal(typeof transactionReview.reviewedEnvelopeForSigning, "function");
  const binding = { xdr: "XDR-A", network: "testnet" };

  assert.equal(
    transactionReview.reviewedEnvelopeForSigning(binding, "  XDR-A  ", "testnet"),
    "XDR-A",
  );
  assert.equal(
    transactionReview.reviewedEnvelopeForSigning(binding, "XDR-B", "testnet"),
    null,
  );
  assert.equal(
    transactionReview.reviewedEnvelopeForSigning(binding, "XDR-A", "mainnet"),
    null,
  );
});

test("approval review renders every security-sensitive address in full", () => {
  const source = readFileSync(
    new URL("../src/components/MultiSigStudioModal.tsx", import.meta.url),
    "utf8",
  );
  const approvalReview = source
    .split("Transaction explanation review (before signing)")[1]
    ?.split("{outcome && !outcome.submission")[0];

  assert.ok(approvalReview, "expected the Approvals review section");
  assert.doesNotMatch(approvalReview, /<HashValue\b/);
  assert.match(approvalReview, /l\.kind === "address"[\s\S]*EXACT_REVIEW_VALUE_CLASS/);
});

test("local signer revalidates live authorization around password access", () => {
  const source = readFileSync(
    new URL("../src/components/SettingsPage.tsx", import.meta.url),
    "utf8",
  );
  const handler = source
    .split("async function handleAirSign()")[1]
    ?.split("function toggleSound")[0];
  assert.ok(handler, "expected the local signer handler");

  const firstAuthorization = handler.indexOf("await assertCanAddTransactionSignature");
  const passwordAccess = handler.indexOf("await revealSecret");
  const secondAuthorization = handler.indexOf(
    "await assertCanAddTransactionSignature",
    firstAuthorization + 1,
  );
  const signing = handler.indexOf("tx.sign(kp)");
  assert.ok(firstAuthorization >= 0 && firstAuthorization < passwordAccess);
  assert.ok(passwordAccess < secondAuthorization && secondAuthorization < signing);
});

test("local signer preserves decoded effects and offers authorization retry", () => {
  const source = readFileSync(
    new URL("../src/components/SettingsPage.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /function handleAirAuthorizationRetry\(\)/);
  assert.match(source, />\s*Retry Authorization\s*</);
});

test("multisig signer-info loading discards stale account or network responses", () => {
  const source = readFileSync(
    new URL("../src/components/MultiSigStudioModal.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /signerInfoRequestGeneration\s*=\s*useRef/);
  assert.match(source, /requestGeneration\s*!==\s*signerInfoRequestGeneration\.current/);
  assert.match(source, /interface SignerInfoBinding/);
  assert.match(source, /signerInfoIdentityRef/);
  assert.match(source, /requestedIdentity\s*!==\s*signerInfoIdentityRef\.current/);
  assert.match(source, /infoBinding\.accountPublicKey\s*===\s*activeAccount\.publicKey/);
  assert.match(source, /infoBinding\.network\s*===\s*network/);
});

test("multisig UI never presents unavailable signer state as single-signature", () => {
  const source = readFileSync(
    new URL("../src/components/MultiSigStudioModal.tsx", import.meta.url),
    "utf8",
  );
  const uiSource = readFileSync(
    new URL("../src/components/ui.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /const signerInfoUnavailable\s*=\s*!infoLoading\s*&&\s*!info/);
  assert.match(source, /Signer configuration unavailable/);
  assert.match(source, /value:\s*"configure",\s*label:\s*"Configure",\s*disabled:\s*!info/);
  assert.match(source, /tab === "configure" && info &&/);
  assert.match(uiSource, /disabled\?: boolean/);
  assert.match(uiSource, /disabled=\{opt\.disabled\}/);
});

test("multisig configuration enforces Stellar's 20 additional-signer limit before Horizon", async (t) => {
  assert.equal(typeof multisig.hasAdditionalSignerCapacity, "function");
  assert.equal(multisig.hasAdditionalSignerCapacity(19), true);
  assert.equal(multisig.hasAdditionalSignerCapacity(20), false);

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
          ...Array.from({ length: 21 }, () => ({ key: Keypair.random().publicKey(), weight: 1 })),
        ],
        low: 1,
        medium: 1,
        high: 1,
      },
    }),
    /at most 20 additional signers/i,
  );
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("account signer info rejects an incomplete Horizon account response", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({}), { status: 200 }));

  assert.equal(
    await fetchAccountSignerInfo(Keypair.random().publicKey(), "testnet"),
    null,
  );
});

test("account signer info rejects malformed thresholds and signer entries", async (t) => {
  const account = Keypair.random();
  let responseIndex = 0;
  const responses = [
    {
      thresholds: { low_threshold: -1, med_threshold: 1.5, high_threshold: 256 },
      signers: [{ key: account.publicKey(), weight: 1, type: "ed25519_public_key" }],
    },
    {
      thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
      signers: [{ key: "not-a-stellar-signer", weight: -1, type: "unknown" }],
    },
  ];
  t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify(responses[responseIndex++]), { status: 200 }));

  assert.equal(await fetchAccountSignerInfo(account.publicKey(), "testnet"), null);
  assert.equal(await fetchAccountSignerInfo(account.publicKey(), "testnet"), null);
});

test("cosigning requires explicit network confirmation before any network or key access", async (t) => {
  const source = Keypair.random();
  const tx = buildReviewTransaction(source, [
    Operation.payment({
      destination: Keypair.random().publicKey(),
      amount: "1",
      asset: Asset.native(),
    }),
  ]);
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("network should not be queried");
  });

  await assert.rejects(
    cosignTransaction({
      network: "testnet",
      confirmedNetwork: null,
      xdr: tx.toXdr(),
      signerPublicKey: source.publicKey(),
      secretKey: source.secret(),
    }),
    /confirm.*testnet.*before signing/i,
  );
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("cosigning binds the confirmation to the exact selected network", async (t) => {
  const source = Keypair.random();
  const tx = buildReviewTransaction(source, [
    Operation.payment({
      destination: Keypair.random().publicKey(),
      amount: "1",
      asset: Asset.native(),
    }),
  ]);
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("network should not be queried");
  });

  await assert.rejects(
    cosignTransaction({
      network: "mainnet",
      confirmedNetwork: "testnet",
      xdr: tx.toXdr(),
      signerPublicKey: source.publicKey(),
      secretKey: source.secret(),
    }),
    /confirmed network.*selected mainnet/i,
  );
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("cosigning blocks expired envelopes before any network or key access", async (t) => {
  const source = Keypair.random();
  const tx = buildReviewTransaction(source, [
    Operation.payment({
      destination: Keypair.random().publicKey(),
      amount: "1",
      asset: Asset.native(),
    }),
  ], { timeout: Math.floor(Date.now() / 1000) - 10 });
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("network should not be queried");
  });

  await assert.rejects(
    cosignTransaction({
      network: "testnet",
      confirmedNetwork: "testnet",
      xdr: tx.toXdr(),
      signerPublicKey: source.publicKey(),
      secretKey: source.secret(),
    }),
    /expired/i,
  );
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("cosigning rechecks expiry after asynchronous authorization and before submit", async (t) => {
  const source = Keypair.random();
  const tx = buildReviewTransaction(source, [
    Operation.payment({
      destination: Keypair.random().publicKey(),
      amount: "1",
      asset: Asset.native(),
    }),
  ], { timeout: 200 });
  let nowMs = 100_000;
  let submitted = false;
  t.mock.method(Date, "now", () => nowMs);
  t.mock.method(globalThis, "fetch", async (url) => {
    const stringUrl = String(url);
    if (stringUrl.endsWith(`/accounts/${source.publicKey()}`)) {
      nowMs = 200_000;
      return new Response(JSON.stringify({
        thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
        signers: [{ key: source.publicKey(), weight: 1, type: "ed25519_public_key" }],
      }), { status: 200 });
    }
    if (stringUrl.endsWith("/transactions")) {
      submitted = true;
      return new Response(JSON.stringify({ hash: "must-not-submit" }), { status: 200 });
    }
    throw new Error(`Unexpected Horizon URL: ${stringUrl}`);
  });

  await assert.rejects(
    cosignTransaction({
      network: "testnet",
      confirmedNetwork: "testnet",
      xdr: tx.toXdr(),
      signerPublicKey: source.publicKey(),
      secretKey: source.secret(),
    }),
    /expired/i,
  );
  assert.equal(submitted, false);
});

test("multisig configuration returns a partial envelope when current high threshold is unmet", async (t) => {
  const account = Keypair.random();
  const cosigner = Keypair.random();
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const stringUrl = String(url);
    calls.push({ url: stringUrl, init });
    if (stringUrl.endsWith(`/accounts/${account.publicKey()}`)) {
      return new Response(JSON.stringify({
        sequence: "0",
        thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 2 },
        signers: [
          { key: account.publicKey(), weight: 1, type: "ed25519_public_key" },
          { key: cosigner.publicKey(), weight: 1, type: "ed25519_public_key" },
        ],
      }), { status: 200 });
    }
    if (stringUrl.endsWith("/transactions")) {
      return new Response(JSON.stringify({ hash: "must-not-submit" }), { status: 200 });
    }
    throw new Error(`Unexpected Horizon URL: ${stringUrl}`);
  });

  const outcome = await applyMultisigConfig({
    network: "testnet",
    accountPublicKey: account.publicKey(),
    secretKey: account.secret(),
    config: {
      signers: [
        { key: account.publicKey(), weight: 1 },
        { key: cosigner.publicKey(), weight: 1 },
      ],
      low: 1,
      medium: 2,
      high: 2,
    },
  });

  assert.equal(outcome.submission, null);
  assert.equal("submitted" in outcome, false);
  assert.ok(outcome.xdr);
  assert.equal(calls.some((call) => call.url.endsWith("/transactions")), false);
});

test("multisig replaces a signer at full capacity without exceeding 20 additional signers", async (t) => {
  const account = Keypair.random();
  const currentCosigners = Array.from({ length: 20 }, () => Keypair.random());
  const removed = currentCosigners.at(-1);
  const replacement = Keypair.random();
  let submittedXdr = null;
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const stringUrl = String(url);
    if (stringUrl.endsWith(`/accounts/${account.publicKey()}`)) {
      return new Response(JSON.stringify({
        sequence: "0",
        thresholds: { low_threshold: 2, med_threshold: 2, high_threshold: 2 },
        signers: [
          { key: account.publicKey(), weight: 1, type: "ed25519_public_key" },
          ...currentCosigners.map((signer) => ({
            key: signer.publicKey(),
            weight: 1,
            type: "ed25519_public_key",
          })),
        ],
      }), { status: 200 });
    }
    if (stringUrl.endsWith("/transactions")) {
      submittedXdr = new URLSearchParams(init.body).get("tx");
      return new Response(JSON.stringify({ hash: canonicalSubmissionHash(init) }), { status: 200 });
    }
    throw new Error(`Unexpected Horizon URL: ${stringUrl}`);
  });

  const desiredCosigners = [...currentCosigners.slice(0, 19), replacement];
  const partial = await applyMultisigConfig({
    network: "testnet",
    accountPublicKey: account.publicKey(),
    secretKey: account.secret(),
    config: {
      signers: [
        { key: account.publicKey(), weight: 1 },
        ...desiredCosigners.map((signer) => ({ key: signer.publicKey(), weight: 1 })),
      ],
      low: 2,
      medium: 2,
      high: 2,
    },
  });
  assert.equal(partial.submission, null);

  const tx = TransactionBuilder.fromXdr(partial.xdr, Networks.TESTNET);
  const lowerIndex = tx.operations.findIndex(
    (operation) => operation.type === "setOptions" && operation.highThreshold === 0,
  );
  const removeIndex = tx.operations.findIndex(
    (operation) =>
      operation.type === "setOptions" &&
      operation.signer?.ed25519PublicKey === removed.publicKey() &&
      operation.signer.weight === 0,
  );
  const addIndex = tx.operations.findIndex(
    (operation) =>
      operation.type === "setOptions" &&
      operation.signer?.ed25519PublicKey === replacement.publicKey() &&
      operation.signer.weight === 1,
  );
  assert.ok(lowerIndex >= 0 && lowerIndex < removeIndex && removeIndex < addIndex);

  const simulatedSigners = new Map(
    currentCosigners.map((signer) => [signer.publicKey(), 1]),
  );
  let finalMasterWeight = 1;
  let finalThresholds = { low: 2, medium: 2, high: 2 };
  for (const operation of tx.operations) {
    if (operation.type !== "setOptions") continue;
    if (operation.masterWeight !== undefined) finalMasterWeight = operation.masterWeight;
    if (operation.lowThreshold !== undefined) finalThresholds.low = operation.lowThreshold;
    if (operation.medThreshold !== undefined) finalThresholds.medium = operation.medThreshold;
    if (operation.highThreshold !== undefined) finalThresholds.high = operation.highThreshold;
    if (operation.signer && "ed25519PublicKey" in operation.signer) {
      if (operation.signer.weight === 0) simulatedSigners.delete(operation.signer.ed25519PublicKey);
      else simulatedSigners.set(operation.signer.ed25519PublicKey, operation.signer.weight);
    }
    assert.ok(simulatedSigners.size <= 20, "transition exceeded the protocol signer limit");
  }
  assert.equal(finalMasterWeight, 1);
  assert.deepEqual(finalThresholds, { low: 2, medium: 2, high: 2 });
  assert.deepEqual([...simulatedSigners.keys()].sort(), desiredCosigners.map((s) => s.publicKey()).sort());

  const submitted = await cosignTransaction({
    network: "testnet",
    confirmedNetwork: "testnet",
    xdr: partial.xdr,
    signerPublicKey: removed.publicKey(),
    secretKey: removed.secret(),
  });
  assert.equal(submitted.submission?.status, "accepted");
  assert.equal("submitted" in submitted, false);
  assert.ok(submittedXdr);
});

test("multisig recovery transitions lower the high threshold before removing signers", async (t) => {
  const account = Keypair.random();
  const cosigner = Keypair.random();
  t.mock.method(globalThis, "fetch", async (url) => {
    const stringUrl = String(url);
    if (stringUrl.endsWith(`/accounts/${account.publicKey()}`)) {
      return new Response(JSON.stringify({
        sequence: "0",
        thresholds: { low_threshold: 2, med_threshold: 2, high_threshold: 2 },
        signers: [
          { key: account.publicKey(), weight: 1, type: "ed25519_public_key" },
          { key: cosigner.publicKey(), weight: 1, type: "ed25519_public_key" },
        ],
      }), { status: 200 });
    }
    throw new Error(`Unexpected Horizon URL: ${stringUrl}`);
  });

  const outcome = await applyMultisigConfig({
    network: "testnet",
    accountPublicKey: account.publicKey(),
    secretKey: account.secret(),
    config: {
      signers: [{ key: account.publicKey(), weight: 1 }],
      low: 0,
      medium: 0,
      high: 0,
    },
  });
  const tx = TransactionBuilder.fromXdr(outcome.xdr, Networks.TESTNET);

  assert.equal(tx.operations[0].type, "setOptions");
  assert.equal(tx.operations[0].highThreshold, 0);
  assert.equal(tx.operations[1].type, "setOptions");
  assert.equal(tx.operations[1].signer.ed25519PublicKey, cosigner.publicKey());
  assert.equal(tx.operations[1].signer.weight, 0);
  assert.equal(tx.operations.at(-1).highThreshold, 0);
  assert.equal(outcome.submission, null);
});

test("recovery restores a zero-weight master before removing recovery signers", async (t) => {
  const account = Keypair.random();
  const recovery = Keypair.random();
  let submittedXdr = null;
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const stringUrl = String(url);
    if (stringUrl.endsWith(`/accounts/${account.publicKey()}`)) {
      return new Response(JSON.stringify({
        sequence: "0",
        thresholds: { low_threshold: 2, med_threshold: 2, high_threshold: 2 },
        signers: [
          { key: account.publicKey(), weight: 0, type: "ed25519_public_key" },
          { key: recovery.publicKey(), weight: 2, type: "ed25519_public_key" },
        ],
      }), { status: 200 });
    }
    if (stringUrl.endsWith("/transactions")) {
      submittedXdr = new URLSearchParams(init.body).get("tx");
      return new Response(JSON.stringify({ hash: canonicalSubmissionHash(init) }), { status: 200 });
    }
    throw new Error(`Unexpected Horizon URL: ${stringUrl}`);
  });

  const partial = await applyMultisigConfig({
    network: "testnet",
    accountPublicKey: account.publicKey(),
    secretKey: account.secret(),
    config: {
      signers: [{ key: account.publicKey(), weight: 1 }],
      low: 0,
      medium: 0,
      high: 0,
    },
  });
  const partialTx = TransactionBuilder.fromXdr(partial.xdr, Networks.TESTNET);

  assert.equal(partial.submission, null);
  assert.equal(partialTx.operations[0].type, "setOptions");
  assert.equal(partialTx.operations[0].masterWeight, 1);

  const recovered = await cosignTransaction({
    network: "testnet",
    confirmedNetwork: "testnet",
    xdr: partial.xdr,
    signerPublicKey: recovery.publicKey(),
    secretKey: recovery.secret(),
  });

  assert.equal(recovered.submission?.status, "accepted");
  assert.ok(submittedXdr);
  const submitted = TransactionBuilder.fromXdr(submittedXdr, Networks.TESTNET);
  assert.equal(recovered.submission?.hash, Buffer.from(submitted.hash()).toString("hex"));
  const final = submitted.operations.at(-1);
  assert.equal(final.type, "setOptions");
  assert.equal(final.masterWeight, 1);
  assert.equal(final.lowThreshold, 0);
  assert.equal(final.medThreshold, 0);
  assert.equal(final.highThreshold, 0);
});

test("threshold classification follows each operation's actual Stellar security level", () => {
  const source = Keypair.random();
  const thresholds = { low_threshold: 1, med_threshold: 2, high_threshold: 3 };
  const homeDomain = buildReviewTransaction(source, [
    Operation.setOptions({ homeDomain: "example.com" }),
  ]);
  const signerChange = buildReviewTransaction(source, [
    Operation.setOptions({
      signer: { ed25519PublicKey: Keypair.random().publicKey(), weight: 1 },
    }),
  ]);
  const claim = buildReviewTransaction(source, [
    Operation.claimClaimableBalance({ balanceId: `00000000${"00".repeat(32)}` }),
  ]);

  assert.equal(requiredWeightForTx(homeDomain, thresholds), 2);
  assert.equal(requiredWeightForTx(signerChange, thresholds), 3);
  assert.equal(requiredWeightForTx(claim, thresholds), 1);
});

test("cosigning requires every effective source account to meet its own threshold", async (t) => {
  const transactionSource = Keypair.random();
  const operationSource = Keypair.random();
  const secondOperationSigner = Keypair.random();
  const tx = buildReviewTransaction(transactionSource, [
    Operation.payment({
      source: operationSource.publicKey(),
      destination: Keypair.random().publicKey(),
      amount: "1",
      asset: Asset.native(),
    }),
  ]);
  tx.sign(transactionSource);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const stringUrl = String(url);
    calls.push({ url: stringUrl, init });
    if (stringUrl.endsWith(`/accounts/${transactionSource.publicKey()}`)) {
      return new Response(JSON.stringify({
        thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
        signers: [{ key: transactionSource.publicKey(), weight: 1, type: "ed25519_public_key" }],
      }), { status: 200 });
    }
    if (stringUrl.endsWith(`/accounts/${operationSource.publicKey()}`)) {
      return new Response(JSON.stringify({
        thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 2 },
        signers: [
          { key: operationSource.publicKey(), weight: 1, type: "ed25519_public_key" },
          { key: secondOperationSigner.publicKey(), weight: 1, type: "ed25519_public_key" },
        ],
      }), { status: 200 });
    }
    if (stringUrl.endsWith("/transactions")) {
      return new Response(JSON.stringify({ hash: "must-not-submit" }), { status: 200 });
    }
    throw new Error(`Unexpected Horizon URL: ${stringUrl}`);
  });

  const outcome = await cosignTransaction({
    network: "testnet",
    confirmedNetwork: "testnet",
    xdr: tx.toXdr(),
    signerPublicKey: operationSource.publicKey(),
    secretKey: operationSource.secret(),
  });

  assert.equal(outcome.submission, null);
  assert.equal(outcome.authorizations.length, 2);
  assert.equal(
    outcome.authorizations.find((entry) => entry.source === transactionSource.publicKey()).satisfied,
    true,
  );
  assert.equal(
    outcome.authorizations.find((entry) => entry.source === operationSource.publicKey()).satisfied,
    false,
  );
  assert.equal(calls.some((call) => call.url.endsWith("/transactions")), false);
});

test("cosigning evaluates signer and threshold mutations in operation order", async (t) => {
  const source = Keypair.random();
  const tx = buildReviewTransaction(source, [
    Operation.setOptions({ medThreshold: 2 }),
    Operation.payment({
      destination: Keypair.random().publicKey(),
      amount: "1",
      asset: Asset.native(),
    }),
  ]);
  tx.sign(source);
  let submitted = false;
  t.mock.method(globalThis, "fetch", async (url) => {
    const stringUrl = String(url);
    if (stringUrl.endsWith(`/accounts/${source.publicKey()}`)) {
      return new Response(JSON.stringify({
        thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
        signers: [{ key: source.publicKey(), weight: 1, type: "ed25519_public_key" }],
      }), { status: 200 });
    }
    if (stringUrl.endsWith("/transactions")) {
      submitted = true;
      return new Response(JSON.stringify({ hash: "must-not-submit" }), { status: 200 });
    }
    throw new Error(`Unexpected Horizon URL: ${stringUrl}`);
  });

  const outcome = await cosignTransaction({
    network: "testnet",
    confirmedNetwork: "testnet",
    xdr: tx.toXdr(),
    signerPublicKey: source.publicKey(),
    secretKey: source.secret(),
  });

  assert.equal(outcome.submission, null);
  assert.equal(outcome.authorizations[0].satisfied, false);
  assert.equal(submitted, false);
});

test("cosigning applies earlier signer-weight changes before later authorization checks", async (t) => {
  const source = Keypair.random();
  const tx = buildReviewTransaction(source, [
    Operation.setOptions({ masterWeight: 0 }),
    Operation.payment({
      destination: Keypair.random().publicKey(),
      amount: "1",
      asset: Asset.native(),
    }),
  ]);
  tx.sign(source);
  t.mock.method(globalThis, "fetch", async (url) => {
    const stringUrl = String(url);
    if (stringUrl.endsWith(`/accounts/${source.publicKey()}`)) {
      return new Response(JSON.stringify({
        thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
        signers: [{ key: source.publicKey(), weight: 1, type: "ed25519_public_key" }],
      }), { status: 200 });
    }
    throw new Error("transaction must not be submitted");
  });

  const outcome = await cosignTransaction({
    network: "testnet",
    confirmedNetwork: "testnet",
    xdr: tx.toXdr(),
    signerPublicKey: source.publicKey(),
    secretKey: source.secret(),
  });

  assert.equal(outcome.submission, null);
  assert.equal(outcome.authorizations[0].satisfied, false);
});

test("cosigning never adds a redundant signature after every source is authorized", async (t) => {
  const source = Keypair.random();
  const redundantSigner = Keypair.random();
  const tx = buildReviewTransaction(source, [
    Operation.payment({
      destination: Keypair.random().publicKey(),
      amount: "1",
      asset: Asset.native(),
    }),
  ]);
  tx.sign(source);
  let submittedSignatureCount = 0;
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const stringUrl = String(url);
    if (stringUrl.endsWith(`/accounts/${source.publicKey()}`)) {
      return new Response(JSON.stringify({
        thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
        signers: [
          { key: source.publicKey(), weight: 1, type: "ed25519_public_key" },
          { key: redundantSigner.publicKey(), weight: 1, type: "ed25519_public_key" },
        ],
      }), { status: 200 });
    }
    if (stringUrl.endsWith("/transactions")) {
      const submittedXdr = new URLSearchParams(init.body).get("tx");
      submittedSignatureCount = TransactionBuilder.fromXdr(submittedXdr, Networks.TESTNET).signatures.length;
      return new Response(JSON.stringify({ hash: canonicalSubmissionHash(init) }), { status: 200 });
    }
    throw new Error(`Unexpected Horizon URL: ${stringUrl}`);
  });

  const outcome = await cosignTransaction({
    network: "testnet",
    confirmedNetwork: "testnet",
    xdr: tx.toXdr(),
    signerPublicKey: redundantSigner.publicKey(),
    secretKey: redundantSigner.secret(),
  });

  assert.equal(outcome.submission?.status, "accepted");
  assert.equal("submitted" in outcome, false);
  assert.equal(outcome.addedSignature, false);
  assert.equal(submittedSignatureCount, 1);
});

test("cosigning rejects a signer that cannot help any unsatisfied source", async (t) => {
  const transactionSource = Keypair.random();
  const redundantSigner = Keypair.random();
  const operationSource = Keypair.random();
  const operationCosigner = Keypair.random();
  const tx = buildReviewTransaction(transactionSource, [
    Operation.payment({
      source: operationSource.publicKey(),
      destination: Keypair.random().publicKey(),
      amount: "1",
      asset: Asset.native(),
    }),
  ]);
  tx.sign(transactionSource);
  t.mock.method(globalThis, "fetch", async (url) => {
    const stringUrl = String(url);
    if (stringUrl.endsWith(`/accounts/${transactionSource.publicKey()}`)) {
      return new Response(JSON.stringify({
        thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
        signers: [
          { key: transactionSource.publicKey(), weight: 1, type: "ed25519_public_key" },
          { key: redundantSigner.publicKey(), weight: 1, type: "ed25519_public_key" },
        ],
      }), { status: 200 });
    }
    if (stringUrl.endsWith(`/accounts/${operationSource.publicKey()}`)) {
      return new Response(JSON.stringify({
        thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 2 },
        signers: [
          { key: operationSource.publicKey(), weight: 1, type: "ed25519_public_key" },
          { key: operationCosigner.publicKey(), weight: 1, type: "ed25519_public_key" },
        ],
      }), { status: 200 });
    }
    throw new Error("transaction must not be submitted");
  });

  await assert.rejects(
    cosignTransaction({
      network: "testnet",
      confirmedNetwork: "testnet",
      xdr: tx.toXdr(),
      signerPublicKey: redundantSigner.publicKey(),
      secretKey: redundantSigner.secret(),
    }),
    /does not contribute.*unsatisfied source/i,
  );
  assert.equal(tx.signatures.length, 1);
});

test("zero thresholds still require a recognized transaction signature", async (t) => {
  const source = Keypair.random();
  const tx = buildReviewTransaction(source, [
    Operation.payment({
      destination: Keypair.random().publicKey(),
      amount: "1",
      asset: Asset.native(),
    }),
  ]);
  let submittedSignatureCount = 0;
  t.mock.method(globalThis, "fetch", async (url, init = {}) => {
    const stringUrl = String(url);
    if (stringUrl.endsWith(`/accounts/${source.publicKey()}`)) {
      return new Response(JSON.stringify({
        thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
        signers: [{ key: source.publicKey(), weight: 1, type: "ed25519_public_key" }],
      }), { status: 200 });
    }
    if (stringUrl.endsWith("/transactions")) {
      const submittedXdr = new URLSearchParams(init.body).get("tx");
      submittedSignatureCount = TransactionBuilder.fromXdr(submittedXdr, Networks.TESTNET).signatures.length;
      return new Response(JSON.stringify({ hash: canonicalSubmissionHash(init) }), { status: 200 });
    }
    throw new Error(`Unexpected Horizon URL: ${stringUrl}`);
  });

  const outcome = await cosignTransaction({
    network: "testnet",
    confirmedNetwork: "testnet",
    xdr: tx.toXdr(),
    signerPublicKey: source.publicKey(),
    secretKey: source.secret(),
  });

  assert.equal(outcome.submission?.status, "accepted");
  assert.equal(outcome.addedSignature, true);
  assert.equal(submittedSignatureCount, 1);
});

test("cosigning fails closed when a required source has unsupported signer types", async (t) => {
  const source = Keypair.random();
  const tx = buildReviewTransaction(source, [
    Operation.payment({
      destination: Keypair.random().publicKey(),
      amount: "1",
      asset: Asset.native(),
    }),
  ]);
  const submitMock = t.mock.method(globalThis, "fetch", async (url) => {
    const stringUrl = String(url);
    if (stringUrl.endsWith(`/accounts/${source.publicKey()}`)) {
      return new Response(JSON.stringify({
        thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 2 },
        signers: [
          { key: source.publicKey(), weight: 1, type: "ed25519_public_key" },
          { key: StrKey.encodeSha256Hash(new Uint8Array(32)), weight: 1, type: "sha256_hash" },
        ],
      }), { status: 200 });
    }
    throw new Error("transaction must not be submitted");
  });

  await assert.rejects(
    cosignTransaction({
      network: "testnet",
      confirmedNetwork: "testnet",
      xdr: tx.toXdr(),
      signerPublicKey: source.publicKey(),
      secretKey: source.secret(),
    }),
    /unsupported signer types/i,
  );
  assert.equal(submitMock.mock.callCount(), 1);
});

test("transaction review blocks unsupported v2 preconditions", () => {
  const source = Keypair.random();
  const builder = new TransactionBuilder(new Account(source.publicKey(), "0"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  });
  builder
    .addOperation(Operation.payment({
      destination: Keypair.random().publicKey(),
      amount: "1",
      asset: Asset.native(),
    }))
    .setTimebounds(0, Math.floor(Date.now() / 1000) + 300)
    .setLedgerbounds(100, 200)
    .setMinAccountSequence("1")
    .setMinAccountSequenceAge(30n)
    .setMinAccountSequenceLedgerGap(2);
  const review = reviewTransactionEnvelope(builder.build().toXdr(), "testnet");

  assert.equal(review.signable, false);
  assert.match(review.blockingReasons.join(" "), /ledger bounds/i);
  assert.match(review.blockingReasons.join(" "), /minimum account sequence/i);
  assert.match(review.blockingReasons.join(" "), /sequence age/i);
  assert.match(review.blockingReasons.join(" "), /sequence ledger gap/i);
});

test("offline authorization rechecks expiry at the moment of signing", () => {
  const source = Keypair.random();
  const tx = buildReviewTransaction(source, [
    Operation.payment({
      destination: Keypair.random().publicKey(),
      amount: "1",
      asset: Asset.native(),
    }),
  ], { timeout: 200 });
  const review = reviewTransactionEnvelope(tx.toXdr(), "testnet", 100);

  assert.equal(review.signable, true);
  assert.throws(
    () => assertReviewCanBeSigned(review, true, 200),
    /expired/i,
  );
});

test("trustline flag review distinguishes unchanged flags from cleared flags", () => {
  const source = Keypair.random();
  const tx = buildReviewTransaction(source, [
    Operation.setTrustLineFlags({
      trustor: Keypair.random().publicKey(),
      asset: new Asset("USDC", source.publicKey()),
      flags: { authorized: true },
    }),
  ]);
  const review = reviewTransactionEnvelope(tx.toXdr(), "testnet");
  const lines = new Map(review.operations[0].lines.map((line) => [line.label, line.value]));

  assert.equal(lines.get("Authorized"), "true");
  assert.equal(lines.get("Maintain liabilities"), "Unchanged");
  assert.equal(lines.get("Clawback enabled"), "Unchanged");
});

test("review never advertises classic operations unsupported by Trezor as signable", () => {
  const source = Keypair.random();
  const asset = new Asset("USDC", source.publicKey());
  const tx = buildReviewTransaction(source, [
    Operation.setTrustLineFlags({
      trustor: Keypair.random().publicKey(),
      asset,
      flags: { authorized: true },
    }),
    Operation.clawback({
      asset,
      from: Keypair.random().publicKey(),
      amount: "1",
    }),
    Operation.clawbackClaimableBalance({ balanceId: `00000000${"00".repeat(32)}` }),
  ]);
  const review = reviewTransactionEnvelope(tx.toXdr(), "testnet");

  assert.equal(review.signable, false);
  assert.deepEqual(review.operations.map((operation) => operation.signable), [false, false, false]);
  assert.match(review.blockingReasons.join(" "), /setTrustLineFlags/i);
  assert.match(review.blockingReasons.join(" "), /clawback/i);
});

test("review blocks signed-payload signer mutations unsupported by Trezor", () => {
  const source = Keypair.random();
  const signedPayload = StrKey.encodeSignedPayload(
    new xdr.SignerKeyEd25519SignedPayload({
      ed25519: Keypair.random().rawPublicKey(),
      payload: new Uint8Array([1, 2, 3]),
    }).toXdr(),
  );
  const tx = buildReviewTransaction(source, [
    Operation.setOptions({
      signer: { ed25519SignedPayload: signedPayload, weight: 1 },
    }),
  ]);
  const review = reviewTransactionEnvelope(tx.toXdr(), "testnet");

  assert.equal(review.signable, false);
  assert.equal(review.operations[0].signable, false);
  assert.match(review.blockingReasons.join(" "), /signed.payload.*Trezor/i);
});

test("review blocks allowTrust maintain-liabilities authorization unsupported by Trezor", () => {
  const source = Keypair.random();
  const tx = buildReviewTransaction(source, [
    Operation.allowTrust({
      trustor: Keypair.random().publicKey(),
      assetCode: "USDC",
      authorize: 2,
    }),
  ]);
  const review = reviewTransactionEnvelope(tx.toXdr(), "testnet");

  assert.equal(review.signable, false);
  assert.equal(review.operations[0].signable, false);
  assert.match(review.blockingReasons.join(" "), /maintain.liabilities.*Trezor/i);
});

test("allowTrust review normalizes a muxed operation source to the issuer G-address", () => {
  const issuer = Keypair.random();
  const muxedIssuer = new MuxedAccount(new Account(issuer.publicKey(), "0"), "42");
  const tx = new TransactionBuilder(new Account(Keypair.random().publicKey(), "0"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.allowTrust({
      source: muxedIssuer.accountId(),
      trustor: Keypair.random().publicKey(),
      assetCode: "USD",
      authorize: true,
    }))
    .setTimeout(300)
    .build();

  const review = reviewTransactionEnvelope(tx.toXdr(), "testnet");
  const assetLine = review.operations[0].lines.find((line) => line.label === "Asset");

  assert.equal(assetLine?.value, `USD:${issuer.publicKey()}`);
});

test("review blocks time bounds Trezor cannot represent exactly", () => {
  const source = Keypair.random();
  const tx = new TransactionBuilder(new Account(source.publicKey(), "0"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
    timebounds: { minTime: "0", maxTime: "9007199254740992" },
  })
    .addOperation(Operation.payment({
      destination: Keypair.random().publicKey(),
      amount: "1",
      asset: Asset.native(),
    }))
    .build();
  const review = reviewTransactionEnvelope(tx.toXdr(), "testnet");

  assert.equal(review.signable, false);
  assert.match(review.blockingReasons.join(" "), /time bounds.*Trezor.*exact/i);
});

test("review blocks imported envelopes without time bounds", () => {
  const source = Keypair.random();
  const tx = new TransactionBuilder(new Account(source.publicKey(), "0"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({
      destination: Keypair.random().publicKey(),
      amount: "1",
      asset: Asset.native(),
    }))
    .setTimeout(300)
    .build();
  const envelope = tx.toEnvelope();
  envelope.v1.tx.cond = xdr.Preconditions.precondNone();
  const review = reviewTransactionEnvelope(envelope.toXdr("base64"), "testnet");

  assert.equal(review.signable, false);
  assert.match(review.blockingReasons.join(" "), /time bounds.*required.*Trezor/i);
});

test("review blocks invalid UTF-8 text memo bytes and preserves their hex identity", () => {
  const source = Keypair.random();
  const tx = buildReviewTransaction(source, [
    Operation.payment({
      destination: Keypair.random().publicKey(),
      amount: "1",
      asset: Asset.native(),
    }),
  ]);
  const envelope = tx.toEnvelope();
  envelope.v1.tx.memo = xdr.Memo.memoText(new Uint8Array([0xff, 0xfe]));
  const review = reviewTransactionEnvelope(envelope.toXdr("base64"), "testnet");

  assert.equal(review.signable, false);
  assert.deepEqual(review.memo, { type: "text", value: "fffe" });
  assert.match(review.memoText, /text.*fffe/i);
  assert.match(review.blockingReasons.join(" "), /text memo.*UTF-8.*Trezor/i);
});

test("review blocks zero-operation envelopes", () => {
  const source = Keypair.random();
  const tx = new TransactionBuilder(new Account(source.publicKey(), "0"), {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  }).setTimeout(300).build();
  const review = reviewTransactionEnvelope(tx.toXdr(), "testnet");

  assert.equal(review.signable, false);
  assert.match(review.blockingReasons.join(" "), /at least one operation/i);
});

test("offline source authorization normalizes a muxed source to its base account", () => {
  const source = Keypair.random();
  const muxed = new MuxedAccount(new Account(source.publicKey(), "0"), "42");
  const tx = new TransactionBuilder(muxed, {
    fee: "100",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({
      destination: Keypair.random().publicKey(),
      amount: "1",
      asset: Asset.native(),
    }))
    .setTimeout(300)
    .build();
  const review = reviewTransactionEnvelope(tx.toXdr(), "testnet");

  assert.deepEqual(review.effectiveSources, [source.publicKey()]);
  assert.doesNotThrow(() => assertReviewCanBeSigned(review, true));
});

test("offline authorization accepts a delegated positive-weight cosigner", async (t) => {
  assert.equal(typeof multisig.assertCanAddTransactionSignature, "function");
  const source = Keypair.random();
  const delegated = Keypair.random();
  const tx = buildReviewTransaction(source, [
    Operation.payment({
      destination: Keypair.random().publicKey(),
      amount: "1",
      asset: Asset.native(),
    }),
  ]);
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
    signers: [
      { key: source.publicKey(), weight: 0, type: "ed25519_public_key" },
      { key: delegated.publicKey(), weight: 1, type: "ed25519_public_key" },
    ],
  }), { status: 200 }));

  await assert.doesNotReject(multisig.assertCanAddTransactionSignature({
    transaction: tx,
    network: "testnet",
    signerPublicKey: delegated.publicKey(),
  }));
});

test("offline authorization rejects a zero-weight master before key access", async (t) => {
  assert.equal(typeof multisig.assertCanAddTransactionSignature, "function");
  const source = Keypair.random();
  const tx = buildReviewTransaction(source, [
    Operation.payment({
      destination: Keypair.random().publicKey(),
      amount: "1",
      asset: Asset.native(),
    }),
  ]);
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 1 },
    signers: [{ key: source.publicKey(), weight: 0, type: "ed25519_public_key" }],
  }), { status: 200 }));

  await assert.rejects(
    multisig.assertCanAddTransactionSignature({
      transaction: tx,
      network: "testnet",
      signerPublicKey: source.publicKey(),
    }),
    /not a positive-weight signer/i,
  );
});

test("offline authorization rejects an already-present signature without querying Horizon", async (t) => {
  assert.equal(typeof multisig.assertCanAddTransactionSignature, "function");
  const source = Keypair.random();
  const delegated = Keypair.random();
  const tx = buildReviewTransaction(source, [
    Operation.payment({
      destination: Keypair.random().publicKey(),
      amount: "1",
      asset: Asset.native(),
    }),
  ]);
  tx.sign(delegated);
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("duplicate detection must happen before Horizon");
  });

  await assert.rejects(
    multisig.assertCanAddTransactionSignature({
      transaction: tx,
      network: "testnet",
      signerPublicKey: delegated.publicKey(),
    }),
    /already contains.*signature/i,
  );
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("offline review blocks unsupported effects and requires network confirmation", () => {
  const source = Keypair.random();
  const outsider = Keypair.random();
  const tx = buildReviewTransaction(source, [
    Operation.beginSponsoringFutureReserves({ sponsoredId: outsider.publicKey() }),
  ]);
  const blockedReview = reviewTransactionEnvelope(tx.toXdr(), "testnet");
  assert.equal(blockedReview.signable, false);
  assert.throws(
    () => assertReviewCanBeSigned(blockedReview, true),
    /unsupported operation/i,
  );

  const safeTx = buildReviewTransaction(source, [
    Operation.payment({
      destination: outsider.publicKey(),
      amount: "1",
      asset: Asset.native(),
    }),
  ]);
  const safeReview = reviewTransactionEnvelope(safeTx.toXdr(), "testnet");
  assert.doesNotThrow(() => assertReviewCanBeSigned(safeReview, true));
  assert.throws(
    () => assertReviewCanBeSigned(safeReview, false),
    /confirm testnet before signing/i,
  );
});

test("transaction review does not claim the deprecated inflation operation is signable", () => {
  const source = Keypair.random();
  const tx = buildReviewTransaction(source, [Operation.inflation()]);
  const review = reviewTransactionEnvelope(tx.toXdr(), "testnet");

  assert.equal(review.signable, false);
  assert.match(review.blockingReasons.join(" "), /unsupported operation: inflation/i);
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
