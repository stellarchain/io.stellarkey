import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { emptyStore } from "../src/lib/merchant/defaults.ts";

const ACCOUNT = "GAVLAAAWTBEO5XJELA3TID4XVHELGTFYRMMFRU2MQ25C5VVCBI476ZVG";
const TREASURY = "GCUXWZHL7FGVL3MVYH6N5G3RACCKAC7ZLTUBKKN4I5MCCTDPJXITNGFD";
const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const OTHER_ISSUER = "GDQOE23G6I3K6BIJFHUQFOW42CHSC6QJ3BKWH6SHDNR3OX35OZPAUU4S";
const XLM = { code: "XLM", issuer: null };
const USDC = { code: "USDC", issuer: ISSUER };

async function domain() {
  try {
    return await import("../src/lib/merchant/settlement.ts");
  } catch (error) {
    assert.fail(`The settlement domain is missing: ${error instanceof Error ? error.message : error}`);
  }
}

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function configuredStore() {
  const base = emptyStore();
  return {
    ...base,
    settings: {
      ...base.settings,
      receivingPublicKey: ACCOUNT,
      settlementAsset: USDC,
      acceptedAssets: [XLM, USDC],
    },
    settlementRule: {
      autoConvert: true,
      maxSlippageBps: 50,
      sweepAboveMinor: 50_000,
      sweepDestination: TREASURY,
      retainedFloatMinor: 20_000,
      sweepPromptHour: 21,
    },
  };
}

test("settlement rule updates persist only validated preferences", async () => {
  const { updateSettlementRule } = await domain();
  const store = configuredStore();
  const updated = updateSettlementRule(store, {
    maxSlippageBps: 25,
    sweepAboveMinor: 75_000,
    retainedFloatMinor: 30_000,
    sweepPromptHour: 18,
  });
  assert.equal(updated.settlementRule.maxSlippageBps, 25);
  assert.equal(updated.settlementRule.sweepAboveMinor, 75_000);
  assert.equal(updated.settlementRule.sweepPromptHour, 18);
  assert.notEqual(updated, store);
  assert.throws(() => updateSettlementRule(store, { maxSlippageBps: 0 }), /slippage/i);
  assert.throws(() => updateSettlementRule(store, { sweepAboveMinor: -1 }), /threshold/i);
  assert.throws(() => updateSettlementRule(store, { sweepDestination: "not-an-address" }), /treasury/i);
  assert.throws(() => updateSettlementRule(store, { sweepPromptHour: 24 }), /hour/i);
});

test("conversion handoffs retain exact source, asset, amount, network, and rule context", async () => {
  const { deriveSettlementHandoffs } = await domain();
  const store = configuredStore();
  const result = deriveSettlementHandoffs(store, {
    network: "mainnet",
    sourceAccount: ACCOUNT,
    localHour: 12,
    holdings: [
      { asset: XLM, available: "321.7654321", unitPriceMinorE6: 25_000_000 },
      { asset: USDC, available: "700.0000000", unitPriceMinorE6: 100_000_000 },
      {
        asset: { code: "FAKE", issuer: OTHER_ISSUER },
        available: "99.0000000",
        unitPriceMinorE6: 100_000_000,
      },
    ],
  });
  assert.equal(result.swaps.length, 1);
  assert.deepEqual(result.swaps[0].sourceAsset, XLM);
  assert.deepEqual(result.swaps[0].destinationAsset, USDC);
  assert.equal(result.swaps[0].amount, "321.7654321");
  assert.equal(result.swaps[0].sourceAccount, ACCOUNT);
  assert.equal(result.swaps[0].network, "mainnet");
  assert.equal(result.swaps[0].maxSlippageBps, 50);
  assert.match(result.swaps[0].contextId, /auto-convert/);
  assert.equal(result.sweep, null, "the scheduled sweep is not due before its local hour");
});

test("disabled, unpriced, and wrong-account rules never create a signing handoff", async () => {
  const { deriveSettlementHandoffs } = await domain();
  const store = configuredStore();
  const base = {
    network: "mainnet",
    sourceAccount: ACCOUNT,
    localHour: 22,
    holdings: [{ asset: XLM, available: "10.0000000", unitPriceMinorE6: null }],
  };
  const unpriced = deriveSettlementHandoffs(store, base);
  assert.equal(unpriced.swaps.length, 0);
  assert.match(unpriced.blocked.join(" "), /price/i);

  const disabled = deriveSettlementHandoffs(
    { ...store, settlementRule: { ...store.settlementRule, autoConvert: false } },
    base,
  );
  assert.equal(disabled.swaps.length, 0);

  const wrong = deriveSettlementHandoffs(store, { ...base, sourceAccount: TREASURY });
  assert.equal(wrong.swaps.length, 0);
  assert.equal(wrong.sweep, null);
  assert.match(wrong.blocked.join(" "), /receiving account/i);
});

test("sweep due arithmetic keeps the larger threshold or retained float", async () => {
  const { deriveSettlementHandoffs } = await domain();
  const store = configuredStore();
  const input = {
    network: "mainnet",
    sourceAccount: ACCOUNT,
    localHour: 21,
    holdings: [{ asset: USDC, available: "700.0000000", unitPriceMinorE6: 100_000_000 }],
  };
  const due = deriveSettlementHandoffs(store, input);
  assert.ok(due.sweep);
  assert.equal(due.sweep.amount, "200.0000000");
  assert.equal(due.sweep.amountMinor, 20_000);
  assert.equal(due.sweep.destination, TREASURY);
  assert.deepEqual(due.sweep.asset, USDC);
  assert.match(due.sweep.contextId, /treasury-sweep/);

  const highFloat = deriveSettlementHandoffs(
    { ...store, settlementRule: { ...store.settlementRule, retainedFloatMinor: 60_000 } },
    input,
  );
  assert.equal(highFloat.sweep.amount, "100.0000000");

  const insufficient = deriveSettlementHandoffs(store, {
    ...input,
    holdings: [{ asset: USDC, available: "499.9999999", unitPriceMinorE6: 100_000_000 }],
  });
  assert.equal(insufficient.sweep, null);
  assert.match(insufficient.blocked.join(" "), /threshold/i);
});

test("merchant settlement UI persists rules and hands immutable intents to reviewed wallet flows", () => {
  const settings = source("src/components/merchant/MerchantSettings.tsx");
  const hook = source("src/hooks/useMerchant.tsx");
  const swap = source("src/components/SwapPage.tsx");
  const send = source("src/components/SendModal.tsx");
  assert.doesNotMatch(settings, /MOCK_SETTLEMENT|MOCK_TREASURY/);
  assert.match(settings, /updateSettlementRule|settlementHandoffs/);
  assert.match(hook, /deriveSettlementHandoffs|updateSettlementRule/);
  assert.match(swap, /SettlementSwapIntent|Merchant settlement handoff/);
  assert.match(send, /SettlementSweepIntent|Merchant settlement handoff/);
  assert.doesNotMatch(settings, /setAutoConvert|setSweepAboveMinor|setRetainedFloatMinor/);
});
