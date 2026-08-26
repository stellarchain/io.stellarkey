import assert from "node:assert/strict";
import test from "node:test";

import { createCharge, chargePayUri, orderReference, referencePrefix, quoteFor } from "../src/lib/merchant/charge.ts";
import { matchPayment, chargeStatusFor } from "../src/lib/merchant/match.ts";
import { fetchIncomingPayments, ledgerFromPagingToken } from "../src/lib/merchant/watch.ts";
import { defaultSettings } from "../src/lib/merchant/defaults.ts";
import { parseSep7PayUri } from "../src/lib/payuri.ts";

const TILL = "GAVLAAAWTBEO5XJELA3TID4XVHELGTFYRMMFRU2MQ25C5VVCBI476ZVG";
const PAYER = "GCUXWZHL7FGVL3MVYH6N5G3RACCKAC7ZLTUBKKN4I5MCCTDPJXITNGFD";
const USDC = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const NATIVE = { code: "XLM", issuer: null };
const USDC_ASSET = { code: "USDC", issuer: USDC };
const NOW = 1_760_000_000_000;

function settings(over = {}) {
  return { ...defaultSettings(), acceptedAssets: [NATIVE, USDC_ASSET], ...over };
}

function order(number, totalMinor, reference) {
  return {
    id: `ord_${number}`,
    number,
    reference,
    network: "mainnet",
    status: "open",
    lines: [],
    totals: {
      grossMinor: totalMinor,
      discountMinor: 0,
      tipMinor: 0,
      netMinor: totalMinor,
      taxByRate: {},
      taxMinor: 0,
      totalMinor,
    },
    currency: "EUR",
    tender: [],
    staffName: "Ana",
    terminalName: "Counter",
    createdAt: NOW,
    paidAt: null,
    payerAddress: null,
    note: null,
  };
}

function charge(number, totalMinor, over = {}, quoteInputs) {
  const reference = orderReference("Meridian Coffee", number);
  const c = createCharge({
    order: order(number, totalMinor, reference),
    settings: settings(),
    network: "mainnet",
    destination: TILL,
    quotes: quoteInputs ?? [
      { asset: USDC_ASSET, currencyPerUnit: 1 },
      { asset: NATIVE, currencyPerUnit: 0.2532 },
    ],
    now: NOW,
    id: `chg_${number}`,
  });
  return { ...c, ...over };
}

function payment(over = {}) {
  return {
    id: "p1",
    transactionHash: "7b3e0d5c".padEnd(64, "0"),
    ledger: 56_420_130,
    from: PAYER,
    amount: "27.3300000",
    asset: USDC_ASSET,
    memo: null,
    createdAt: "2026-08-24T18:14:31Z",
    ...over,
  };
}

test("a reference fits a text memo and reads like the shop", () => {
  assert.equal(referencePrefix("Meridian Coffee"), "MC");
  assert.equal(referencePrefix("Kaffe"), "KAFF");
  assert.equal(referencePrefix(""), "TILL");
  assert.equal(orderReference("Meridian Coffee", 1042), "MC1042");
  assert.ok(orderReference("A".repeat(60), 999).length <= 28);
});

test("the SEP-7 request carries the memo, the issuer and the network", () => {
  const c = charge(1042, 2733);
  const quote = quoteFor(c, USDC_ASSET);
  const parsed = parseSep7PayUri(chargePayUri(c, quote, "Meridian Coffee"));
  assert.equal(parsed.destination, TILL);
  assert.equal(parsed.amount, "27.3300000");
  assert.equal(parsed.assetCode, "USDC");
  assert.equal(parsed.assetIssuer, USDC);
  assert.equal(parsed.memo, "MC1042");
  assert.equal(parsed.memoType, "text");
  assert.equal(parsed.networkPassphrase, "Public Global Stellar Network ; September 2015");
  // Never the three parameters this wallet refuses.
  assert.equal(parsed.callback, undefined);
  assert.equal(parsed.originDomain, undefined);
  assert.equal(parsed.signature, undefined);
});

test("a native quote omits the asset code, as SEP-7 requires", () => {
  const c = charge(1042, 2733);
  const parsed = parseSep7PayUri(chargePayUri(c, quoteFor(c, NATIVE)));
  assert.equal(parsed.assetCode, undefined);
  assert.equal(parsed.assetIssuer, undefined);
  assert.equal(parsed.amount, "107.9383887");
});

test("a split charge quotes only its exact outstanding remainder", () => {
  const total = order(1042, 1000, "MC1042");
  const c = createCharge({
    order: total,
    settings: settings(),
    network: "mainnet",
    destination: TILL,
    quotes: [{ asset: USDC_ASSET, currencyPerUnit: 1 }],
    amountMinor: 600,
    now: NOW,
    id: "split-charge",
  });

  assert.equal(c.amountMinor, 600);
  assert.equal(quoteFor(c, USDC_ASSET).amount, "6.0000000");
});

test("the memo lane names a charge outright", () => {
  const c = charge(1042, 2733);
  const out = matchPayment(payment({ memo: "MC1042" }), [c], settings(), NOW);
  assert.equal(out.lane, "memo");
  assert.equal(out.charge.id, "chg_1042");
  assert.equal(out.verdict, "exact");
  assert.equal(chargeStatusFor(out.verdict), "paid");
});

test("the memo lane still names short and over payments", () => {
  const c = charge(1042, 2733);
  const short = matchPayment(payment({ memo: "MC1042", amount: "22.8000000" }), [c], settings(), NOW);
  assert.equal(short.lane, "memo");
  assert.equal(short.verdict, "short");
  assert.equal(chargeStatusFor(short.verdict), "underpaid");

  const over = matchPayment(payment({ memo: "MC1042", amount: "30.0000000" }), [c], settings(), NOW);
  assert.equal(over.verdict, "over");
  assert.equal(chargeStatusFor(over.verdict), "overpaid");
});

test("a second payment on a settled reference is a duplicate, never a match", () => {
  const paid = charge(1042, 2733, { status: "paid" });
  const out = matchPayment(payment({ memo: "MC1042" }), [paid], settings(), NOW);
  assert.equal(out.lane, "duplicate");
  assert.equal(out.charge.id, "chg_1042");
});

test("exact stroops beat the band, so a one-stroop salt still resolves", () => {
  // Two live charges for the same money, salted apart by a single stroop.
  const a = charge(1042, 2733);
  const b = {
    ...charge(1043, 2733),
    quotes: charge(1043, 2733).quotes.map((q) =>
      q.asset.code === "USDC" ? { ...q, amount: "27.3300001" } : q,
    ),
  };
  const out = matchPayment(payment({ amount: "27.3300001" }), [a, b], settings(), NOW);
  assert.equal(out.lane, "amount");
  assert.equal(out.charge.id, "chg_1043");
  assert.equal(out.needsConfirmation, true);
  // Both sit deep inside each other's band, so a band-first matcher would fail here.
});

test("two identical live charges are an ambiguity, not a guess", () => {
  const a = charge(1042, 400);
  const b = charge(1043, 400);
  const out = matchPayment(payment({ amount: "4.0000000" }), [a, b], settings(), NOW);
  assert.equal(out.lane, "unmatched");
  assert.equal(out.reason, "ambiguous");
});

test("a memo-less payment inside the band asks a person before it is filed", () => {
  const c = charge(1042, 2733);
  const out = matchPayment(payment({ amount: "27.3400000" }), [c], settings(), NOW);
  assert.equal(out.lane, "amount");
  assert.equal(out.verdict, "inside");
  assert.equal(out.needsConfirmation, true);
});

test("a memo-less payment outside the band goes to the tray", () => {
  const c = charge(1042, 2733);
  const short = matchPayment(payment({ amount: "22.8000000" }), [c], settings(), NOW);
  assert.equal(short.lane, "unmatched");
  assert.equal(short.reason, "outside_band");
});

test("an expired charge stops being a candidate", () => {
  const c = charge(1042, 2733);
  const after = c.expiresAt + 1000;
  const out = matchPayment(payment({ amount: "27.3300000" }), [c], settings(), after);
  assert.equal(out.lane, "unmatched");
  assert.equal(out.reason, "expired");
  // The memo lane still resolves it, so a late payer is not stranded.
  const named = matchPayment(payment({ memo: "MC1042" }), [c], settings(), after);
  assert.equal(named.lane, "memo");
  assert.equal(named.late, true);
});

test("an asset the charge does not quote cannot match", () => {
  const usdcOnly = charge(1042, 2733, {}, [{ asset: USDC_ASSET, currencyPerUnit: 1 }]);
  const out = matchPayment(payment({ asset: NATIVE, amount: "107.9383887" }), [usdcOnly], settings(), NOW);
  assert.equal(out.lane, "unmatched");
  assert.equal(out.reason, "wrong_asset");
});

test("asset matching requires the exact issuer even when the code is the same", () => {
  const usdcOnly = charge(1042, 2733, {}, [{ asset: USDC_ASSET, currencyPerUnit: 1 }]);
  const otherIssuer = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  const out = matchPayment(
    payment({ asset: { code: "USDC", issuer: otherIssuer } }),
    [usdcOnly],
    settings(),
    NOW,
  );
  assert.equal(out.lane, "unmatched");
  assert.equal(out.reason, "wrong_asset");
});

test("a ledger sequence is derived from the paging token", () => {
  const token = (BigInt(56_420_130) << BigInt(32)).toString();
  assert.equal(ledgerFromPagingToken(token), 56_420_130);
  assert.equal(ledgerFromPagingToken("not-a-token"), null);
});

test("the watcher reads /payments with the transaction joined for its memo", async (t) => {
  let requested;
  t.mock.method(globalThis, "fetch", async (url) => {
    requested = new URL(String(url));
    return new Response(
      JSON.stringify({
        _embedded: {
          records: [
            {
              id: "op1",
              type: "payment",
              transaction_hash: "a".repeat(64),
              created_at: "2026-08-24T18:14:31Z",
              paging_token: (BigInt(56_420_130) << BigInt(32)).toString(),
              to: TILL,
              from: PAYER,
              asset_type: "credit_alphanum4",
              asset_code: "USDC",
              asset_issuer: USDC,
              amount: "27.3300000",
              transaction: { memo: "MC1042", memo_type: "text", successful: true },
            },
          ],
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });

  const result = await fetchIncomingPayments({ publicKey: TILL, network: "mainnet", cursor: "12" });
  assert.equal(requested.pathname, `/accounts/${TILL}/payments`);
  assert.equal(requested.searchParams.get("join"), "transactions");
  assert.equal(requested.searchParams.get("order"), "asc");
  assert.equal(requested.searchParams.get("cursor"), "12");
  assert.equal(result.payments.length, 1);
  assert.equal(result.payments[0].memo, "MC1042");
  assert.equal(result.payments[0].asset.code, "USDC");
  assert.equal(result.payments[0].ledger, 56_420_130);
  assert.equal(result.latestLedger, 56_420_130);
});

test("the watcher ignores failures, outbound legs and unreadable memos", async (t) => {
  const base = {
    type: "payment",
    transaction_hash: "b".repeat(64),
    created_at: "2026-08-24T18:00:00Z",
    paging_token: (BigInt(56_420_000) << BigInt(32)).toString(),
    asset_type: "native",
    amount: "10.0000000",
  };
  t.mock.method(globalThis, "fetch", async () =>
    new Response(
      JSON.stringify({
        _embedded: {
          records: [
            { ...base, id: "fail", to: TILL, from: PAYER, transaction_successful: false },
            { ...base, id: "outbound", to: PAYER, from: TILL },
            { ...base, id: "self", to: TILL, from: TILL },
            { ...base, id: "trust", type: "change_trust", to: TILL, from: PAYER },
            {
              ...base,
              id: "idmemo",
              to: TILL,
              from: PAYER,
              transaction: { memo: "12345", memo_type: "id", successful: true },
            },
          ],
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  );

  const result = await fetchIncomingPayments({ publicKey: TILL, network: "mainnet", cursor: "1" });
  assert.equal(result.payments.length, 1);
  assert.equal(result.payments[0].id, "idmemo");
  // An id memo cannot carry a reference, so it falls through to the amount lane.
  assert.equal(result.payments[0].memo, null);
});
