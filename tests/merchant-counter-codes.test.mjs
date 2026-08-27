import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { emptyStore } from "../src/lib/merchant/defaults.ts";
import { parseSep7PayUri } from "../src/lib/payuri.ts";
import { NETWORKS } from "../src/lib/stellar.ts";

const NOW = 1_800_000_000_000;
const TILL = "GAVLAAAWTBEO5XJELA3TID4XVHELGTFYRMMFRU2MQ25C5VVCBI476ZVG";
const PAYER = "GCUXWZHL7FGVL3MVYH6N5G3RACCKAC7ZLTUBKKN4I5MCCTDPJXITNGFD";
const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const USDC = { code: "USDC", issuer: ISSUER };
const XLM = { code: "XLM", issuer: null };

async function counterDomain() {
  try {
    return await import("../src/lib/merchant/counter-codes.ts");
  } catch (error) {
    assert.fail(`The persisted counter-code domain is missing: ${error instanceof Error ? error.message : error}`);
  }
}

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function actor(overrides = {}) {
  return {
    id: "staff-owner",
    name: "Ari",
    role: "owner",
    permissions: {
      takePayment: true,
      applyDiscount: true,
      comp: true,
      void: true,
      refundCeilingMinor: null,
      openDrawer: true,
      seeReports: true,
      exportRecords: true,
    },
    pinDigest: null,
    pinSetAt: null,
    active: true,
    ...overrides,
  };
}

function merchantStore() {
  const member = actor();
  const base = emptyStore();
  return {
    member,
    store: {
      ...base,
      staff: [member],
      activeStaffId: member.id,
      settings: {
        ...base.settings,
        profile: { ...base.settings.profile, name: "North Star" },
        receivingPublicKey: TILL,
        acceptedAssets: [USDC, XLM],
      },
    },
  };
}

function fixedInput(member, overrides = {}) {
  return {
    id: "counter-fixed",
    actor: member,
    title: "Coffee bag",
    kind: "fixed",
    amountMinor: 1000,
    suggestedMinor: [],
    acceptedAssets: [USDC],
    memoPrefix: "NSBAG",
    staffId: null,
    expiresAt: null,
    network: "mainnet",
    destination: TILL,
    quotes: [{ asset: USDC, currencyPerUnit: 1 }],
    now: NOW,
    ...overrides,
  };
}

function payment(id, amount, asset, memo) {
  return {
    id,
    transactionHash: "a".repeat(64),
    ledger: 12345,
    from: PAYER,
    destination: TILL,
    amount,
    asset,
    memo,
    createdAt: new Date(NOW + 1000).toISOString(),
  };
}

test("fixed codes persist an immutable publication quote and exact SEP-7 request", async () => {
  const { counterCodePayUri, createCounterCode } = await counterDomain();
  const { member, store } = merchantStore();
  const created = createCounterCode(store, fixedInput(member));

  assert.equal(created.code.memoPrefix, "NSBAG");
  assert.equal(created.code.destination, TILL);
  assert.equal(created.code.network, "mainnet");
  assert.deepEqual(created.code.quotes, [
    {
      asset: USDC,
      unitPriceMinorE6: 100_000_000,
      amount: "10.0000000",
      quotedAt: NOW,
    },
  ]);
  assert.equal(created.code.createdById, member.id);
  assert.deepEqual(JSON.parse(JSON.stringify(created.store)).counterCodes[0], created.code);

  const parsed = parseSep7PayUri(counterCodePayUri(created.code, USDC, "North Star"));
  assert.deepEqual(parsed, {
    destination: TILL,
    amount: "10.0000000",
    assetCode: "USDC",
    assetIssuer: ISSUER,
    memo: "NSBAG",
    memoType: "text",
    msg: "North Star · Coffee bag",
    networkPassphrase: NETWORKS.mainnet.networkPassphrase,
  });
});

test("code identity and payment facts stay stable while editable metadata persists", async () => {
  const { counterCodePayUri, createCounterCode, updateCounterCode } = await counterDomain();
  const { member, store } = merchantStore();
  const created = createCounterCode(store, fixedInput(member));
  const updated = updateCounterCode(created.store, {
    codeId: created.code.id,
    actor: member,
    title: "Coffee bag · shelf two",
    suggestedMinor: [],
    staffId: null,
    expiresAt: NOW + 30 * 86_400_000,
    now: NOW + 100,
  });

  assert.equal(updated.code.title, "Coffee bag · shelf two");
  assert.equal(updated.code.memoPrefix, created.code.memoPrefix);
  assert.equal(updated.code.destination, created.code.destination);
  assert.deepEqual(updated.code.acceptedAssets, created.code.acceptedAssets);
  assert.deepEqual(updated.code.quotes, created.code.quotes);
  assert.equal(counterCodePayUri(updated.code, USDC), counterCodePayUri(created.code, USDC));
  assert.equal(updated.code.updatedAt, NOW + 100);

  assert.throws(
    () => createCounterCode(updated.store, fixedInput(member, { id: "counter-2" })),
    /memo.*already/i,
  );
});

test("active fixed-code payments reconcile once at their publication quote", async () => {
  const { createCounterCode, reconcileCounterPayments } = await counterDomain();
  const { member, store } = merchantStore();
  const created = createCounterCode(store, fixedInput(member));
  const observed = payment("fixed-payment", "10.0000000", USDC, created.code.memoPrefix);
  const settled = reconcileCounterPayments(created.store, {
    network: "mainnet",
    payments: [observed],
    rates: [],
    now: NOW + 2000,
  });

  assert.equal(settled.unclaimed.length, 0);
  assert.equal(settled.store.counterCodes[0].payments, 1);
  assert.equal(settled.store.counterCodes[0].takingsMinor, 1000);
  assert.equal(settled.store.counterPayments[0].amountMinor, 1000);
  assert.deepEqual(settled.store.counterPayments[0].quote, created.code.quotes[0]);

  const replay = reconcileCounterPayments(settled.store, {
    network: "mainnet",
    payments: [observed],
    rates: [],
    now: NOW + 3000,
  });
  assert.equal(replay.unclaimed.length, 0);
  assert.equal(replay.store.counterCodes[0].payments, 1);
  assert.equal(replay.store.counterPayments.length, 1);
});

test("a counter-code payment created before expiry files after delayed observation", async () => {
  const { createCounterCode, reconcileCounterPayments } = await counterDomain();
  const { member, store } = merchantStore();
  const created = createCounterCode(store, fixedInput(member, { expiresAt: NOW + 1_500 }));
  const observed = payment("delayed-payment", "10.0000000", USDC, created.code.memoPrefix);
  const settled = reconcileCounterPayments(created.store, {
    network: "mainnet",
    payments: [observed],
    rates: [],
    now: NOW + 2_000,
  });

  assert.equal(settled.unclaimed.length, 0);
  assert.equal(settled.store.counterPayments[0].id, observed.id);
});

test("a counter-code payment with an invalid ledger timestamp stays unclaimed", async () => {
  const { createCounterCode, reconcileCounterPayments } = await counterDomain();
  const { member, store } = merchantStore();
  const created = createCounterCode(store, fixedInput(member));
  const observed = {
    ...payment("invalid-time", "10.0000000", USDC, created.code.memoPrefix),
    createdAt: "not-a-timestamp",
  };
  const reconciled = reconcileCounterPayments(created.store, {
    network: "mainnet",
    payments: [observed],
    rates: [],
    now: NOW + 2_000,
  });

  assert.deepEqual(reconciled.unclaimed, [observed]);
  assert.equal(reconciled.store.counterPayments.length, 0);
});

test("a counter-code payment cannot file against another receiving account", async () => {
  const { createCounterCode, reconcileCounterPayments } = await counterDomain();
  const { member, store } = merchantStore();
  const created = createCounterCode(store, fixedInput(member));
  const observed = {
    ...payment("wrong-code-destination", "10.0000000", USDC, created.code.memoPrefix),
    destination: ISSUER,
  };
  const reconciled = reconcileCounterPayments(created.store, {
    network: "mainnet",
    payments: [observed],
    rates: [],
    now: NOW + 2_000,
  });

  assert.deepEqual(reconciled.unclaimed, [observed]);
  assert.equal(reconciled.store.counterPayments.length, 0);
});

test("open codes price live payments and retain unpriceable ones for review", async () => {
  const { createCounterCode, reconcileCounterPayments } = await counterDomain();
  const { member, store } = merchantStore();
  const created = createCounterCode(store, {
    ...fixedInput(member),
    id: "counter-open",
    title: "Community fund",
    kind: "open",
    amountMinor: null,
    suggestedMinor: [500, 1000],
    acceptedAssets: [USDC, XLM],
    memoPrefix: "NSFUND",
    quotes: [],
  });
  const reconciled = reconcileCounterPayments(created.store, {
    network: "mainnet",
    payments: [
      payment("priced-payment", "2.0000000", USDC, "NSFUND"),
      payment("review-payment", "5.0000000", XLM, "NSFUND"),
    ],
    rates: [{ asset: USDC, currencyPerUnit: 1 }],
    now: NOW + 2000,
  });

  assert.equal(reconciled.unclaimed.length, 0);
  assert.equal(reconciled.store.counterCodes[0].payments, 2);
  assert.equal(reconciled.store.counterCodes[0].takingsMinor, 200);
  assert.deepEqual(
    reconciled.store.counterPayments.map((entry) => entry.amountMinor),
    [200, null],
  );
  assert.ok(reconciled.store.counterPayments.every((entry) => entry.quote === null));
});

test("paused and expired codes stop auto-filing while their printed request remains reproducible", async () => {
  const {
    counterCodeAvailability,
    counterCodePayUri,
    createCounterCode,
    reconcileCounterPayments,
    setCounterCodeActive,
  } = await counterDomain();
  const { member, store } = merchantStore();
  const created = createCounterCode(
    store,
    fixedInput(member, { expiresAt: NOW + 1000 }),
  );
  const uri = counterCodePayUri(created.code, USDC, "North Star");
  assert.equal(counterCodeAvailability(created.code, NOW + 2000), "expired");

  const expired = reconcileCounterPayments(created.store, {
    network: "mainnet",
    payments: [payment("expired-payment", "10.0000000", USDC, "NSBAG")],
    rates: [],
    now: NOW + 2000,
  });
  assert.equal(expired.unclaimed.length, 1);

  const resumed = setCounterCodeActive(created.store, {
    codeId: created.code.id,
    actor: member,
    active: false,
    now: NOW + 100,
  });
  assert.equal(counterCodeAvailability(resumed.code, NOW + 200), "paused");
  assert.equal(counterCodePayUri(resumed.code, USDC, "North Star"), uri);
});

test("production counter-code surfaces use persisted state, live quotes, and real print handoffs", () => {
  const page = source("src/components/merchant/PaymentLinksPage.tsx");
  const editor = source("src/components/merchant/LinkEditorModal.tsx");
  const poster = source("src/components/merchant/CounterPosterModal.tsx");

  for (const screen of [page, editor, poster]) {
    assert.doesNotMatch(screen, /merchant\/mock|MOCK_COUNTER_CODES|MOCK_NOW|MOCK_TILL_ADDRESS|previewRateFor|PREVIEW_UNIT_PRICE/);
  }
  assert.match(page, /counterCodes|setCounterCodeActive/);
  assert.match(editor, /createCounterCode|updateCounterCode/);
  assert.match(poster, /counterCodePayUriFor|window\.print/);
  assert.doesNotMatch(page, /setCodes\(|on this screen/);
  assert.doesNotMatch(editor, /on this screen only|illustrative rate|example rate/);
});
