import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { summarizeMerchantDay as summarizeDay } from "../src/lib/merchant/selectors.ts";

async function selectorsDomain() {
  try {
    return await import("../src/lib/merchant/selectors.ts");
  } catch (error) {
    assert.fail(
      `The merchant selectors domain is missing: ${error instanceof Error ? error.message : error}`,
    );
  }
}

async function insightsDomain() {
  try {
    return await import("../src/lib/merchant/insights.ts");
  } catch (error) {
    assert.fail(
      `The merchant insights domain is missing: ${error instanceof Error ? error.message : error}`,
    );
  }
}

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function charge({ id, orderId = `order-${id}`, status = "awaiting", expiresAt = 10_000, payment = null }) {
  return {
    id,
    orderId,
    reference: id.toUpperCase(),
    network: "mainnet",
    destination: "GAVLAAAWTBEO5XJELA3TID4XVHELGTFYRMMFRU2MQ25C5VVCBI476ZVG",
    amountMinor: 100,
    currency: "GBP",
    quotes: [],
    status,
    createdAt: 1,
    expiresAt,
    payment,
  };
}

function order({ id, paidAt, totalMinor = 100 }) {
  return {
    id,
    number: 1,
    reference: id.toUpperCase(),
    network: "mainnet",
    status: "paid",
    lines: [],
    totals: {
      subtotalMinor: totalMinor,
      discountMinor: 0,
      netMinor: totalMinor,
      taxMinor: 0,
      taxByRate: {},
      tipMinor: 0,
      totalMinor,
    },
    currency: "GBP",
    tender: [],
    staffId: null,
    staffName: "Owner",
    terminalName: "Till",
    createdAt: paidAt - 1,
    paidAt,
    stockAppliedAt: paidAt,
    payerAddress: null,
    note: null,
  };
}

test("merchant expiry selects the next awaiting deadline and updates once", async () => {
  const { expireAwaitingCharges, nextAwaitingChargeExpiry } = await selectorsDomain();
  const charges = [
    charge({ id: "later", expiresAt: 20_000 }),
    charge({ id: "paid", status: "paid", expiresAt: 2_000 }),
    charge({ id: "next", expiresAt: 8_000 }),
  ];

  assert.equal(nextAwaitingChargeExpiry(charges), 8_000);
  assert.equal(expireAwaitingCharges(charges, 7_999), charges);

  const expired = expireAwaitingCharges(charges, 8_000);
  assert.notEqual(expired, charges);
  assert.equal(expired[2].status, "expired");
  assert.equal(expired[0], charges[0]);
  assert.equal(expired[1], charges[1]);
  assert.equal(expireAwaitingCharges(expired, 8_000), expired);
  assert.equal(nextAwaitingChargeExpiry(expired), 20_000);
});

test("merchant record indexes preserve exact order, charge, and settled-payment joins", async () => {
  const { indexMerchantRecords } = await selectorsDomain();
  const firstOrder = order({ id: "order-first", paidAt: 100 });
  const secondOrder = order({ id: "order-second", paidAt: 200 });
  const unpaid = charge({ id: "unpaid", orderId: firstOrder.id });
  const settled = charge({
    id: "settled",
    orderId: firstOrder.id,
    status: "paid",
    payment: { id: "payment", asset: { code: "XLM", issuer: null } },
  });
  const index = indexMerchantRecords([firstOrder, secondOrder], [unpaid, settled]);

  assert.equal(index.ordersById.get(secondOrder.id), secondOrder);
  assert.equal(index.chargesById.get(unpaid.id), unpaid);
  assert.equal(index.paymentChargeByOrderId.get(firstOrder.id), settled);
  assert.equal(index.paymentChargeByOrderId.has(secondOrder.id), false);
});

test("insights history is derived on demand from one timestamp", async () => {
  const { deriveInsightsHistory } = await insightsDomain();
  const now = new Date(2027, 0, 12, 15, 30).getTime();
  const lastWeekStart = new Date(2027, 0, 5).setHours(0, 0, 0, 0);
  const orders = [
    order({ id: "morning", paidAt: lastWeekStart + 10 * 60 * 60 * 1000, totalMinor: 250 }),
    order({ id: "evening", paidAt: lastWeekStart + 18 * 60 * 60 * 1000, totalMinor: 750 }),
    { ...order({ id: "other-network", paidAt: lastWeekStart + 11 * 60 * 60 * 1000 }), network: "testnet" },
  ];

  const history = deriveInsightsHistory(orders, { network: "mainnet", now });
  assert.deepEqual(history.sameDayLastWeek, { takingsMinor: 1_000, orderCount: 2 });
  assert.deepEqual(history.sameDayLastWeekToDate, { takingsMinor: 250, orderCount: 1 });
  assert.equal(history.last14Days.length, 14);
  assert.equal(history.typicalByHour.find((entry) => entry.hour === 10)?.takingsMinor, 250);
  assert.equal(history.hoursElapsed, 15.5);
});

test("insights preserves empty days, the exclusive clock cut and active-week averages", async () => {
  const { deriveInsightsHistory } = await insightsDomain();
  const now = new Date(2027, 0, 26, 15, 30).getTime();
  const at = (day, hour = 0, minute = 0) => new Date(2027, 0, day, hour, minute).getTime();
  const relevant = [
    order({ id: "before-cut", paidAt: at(19, 15, 29), totalMinor: 200 }),
    order({ id: "at-cut", paidAt: at(19, 15, 30), totalMinor: 300 }),
    order({ id: "earliest-week", paidAt: at(-2, 15), totalMinor: 100 }),
    order({ id: "trend-start", paidAt: at(13), totalMinor: 50 }),
    order({ id: "today", paidAt: at(26, 9), totalMinor: 75 }),
  ];
  const before = structuredClone(relevant);
  const expected = deriveInsightsHistory(relevant, { network: "mainnet", now });
  assert.deepEqual(expected.sameDayLastWeek, { takingsMinor: 500, orderCount: 2 });
  assert.deepEqual(expected.sameDayLastWeekToDate, { takingsMinor: 200, orderCount: 1 });
  assert.deepEqual(expected.typicalByHour, [{ hour: 15, takingsMinor: 300 }]);
  assert.deepEqual(expected.last14Days[0], { at: at(13), takingsMinor: 50, orderCount: 1, toDateMinor: 50 });
  assert.deepEqual(expected.last14Days[1], { at: at(14), takingsMinor: 0, orderCount: 0, toDateMinor: 0 });
  const ignored = [
    order({ id: "older", paidAt: at(-3, 23), totalMinor: 999 }),
    order({ id: "tomorrow", paidAt: at(27), totalMinor: 999 }),
    { ...order({ id: "unpaid", paidAt: now }), paidAt: null },
    { ...order({ id: "other-network", paidAt: at(19, 10) }), network: "testnet" },
  ];
  assert.deepEqual(deriveInsightsHistory([...ignored, ...relevant], { network: "mainnet", now }), expected);
  assert.deepEqual(relevant, before, "insights must not mutate stored orders");
  const empty = deriveInsightsHistory([], { network: "mainnet", now });
  assert.equal(empty.sameDayLastWeek, null);
  assert.equal(empty.sameDayLastWeekToDate, null);
  assert.deepEqual(empty.typicalByHour, []);
  assert.equal(empty.last14Days.length, 14);
  assert.ok(empty.last14Days.every(day => day.takingsMinor === 0 && day.orderCount === 0 && day.toDateMinor === 0));
});

test("merchant provider schedules exact expiry and Insights owns historical analytics", () => {
  const hook = source("src/hooks/useMerchant.tsx");
  const insights = source("src/components/merchant/InsightsPage.tsx");

  assert.match(hook, /nextAwaitingChargeExpiry/);
  assert.match(hook, /expireAwaitingCharges/);
  assert.doesNotMatch(hook, /setInterval\(\(\) => \{[\s\S]{0,500}status: "expired"/);
  assert.doesNotMatch(hook, /const history = useMemo/);
  assert.doesNotMatch(hook, /history: InsightsHistory/);
  assert.match(insights, /deriveInsightsHistory/);
  assert.match(insights, /useLiveNow\(LIVE_MINUTE_MS\)/);
});

test("the live-hour marker hides its label before it overlaps the chart ceiling", () => {
  const insights = source("src/components/merchant/InsightsPage.tsx");
  assert.match(
    insights,
    /nowX - 26 > padL \+ fmtMinor\(ceiling, currency\)\.length \* 6\.2 \+ 6/,
  );
});

test("daily summary preserves local-day scope, settled refund policy and first-charge asset joins", async () => {
  const { indexMerchantRecords } = await selectorsDomain();
  const now = new Date(2027, 0, 12, 15, 30).getTime();
  const midnight = new Date(now).setHours(0, 0, 0, 0);
  const first = order({ id: "first", paidAt: midnight, totalMinor: 300 });
  first.totals.tipMinor = 20;
  first.totals.taxMinor = 40;
  first.lines = [{ id: "line", itemId: null, name: "Tea", quantity: 2, unitPriceMinor: 100,
    modifiers: [{ modifierId: "extra", name: "Extra", priceMinor: 25 }], taxRateId: "zero", note: null }];
  const last = order({ id: "last", paidAt: new Date(2027, 0, 12, 13).getTime(), totalMinor: 500 });
  const orders = [last, first,
    order({ id: "yesterday", paidAt: midnight - 1, totalMinor: 999 }),
    { ...order({ id: "unpaid", paidAt: midnight }), paidAt: null },
    { ...order({ id: "testnet", paidAt: midnight }), network: "testnet" },
  ];
  const xlm = { code: "XLM", issuer: null };
  const usd = { code: "USD", issuer: "synthetic-issuer" };
  const charges = [charge({ id: "first-payment", orderId: "first", payment: { asset: xlm } }),
    charge({ id: "later-payment", orderId: "first", payment: { asset: usd } })];
  const refund = { kind: "order", network: "mainnet", createdAt: midnight, submissionStatus: "confirmed", amountMinor: 75 };
  const refunds = [refund, { ...refund, submissionStatus: "pending" },
    { ...refund, kind: "payment_reversal" }, { ...refund, network: "testnet" },
    { ...refund, createdAt: midnight - 1 }];
  const before = structuredClone({ orders, charges, refunds });
  const index = indexMerchantRecords(orders, charges);
  assert.deepEqual(summarizeDay(orders, refunds, index.paymentChargeByOrderId, "mainnet", now), {
    takingsMinor: 800, orderCount: 2, avgTicketMinor: 400, tipsMinor: 20, taxMinor: 40, refundedMinor: 75,
    byHour: [{ hour: 0, orders: 1, takingsMinor: 300 }, { hour: 13, orders: 1, takingsMinor: 500 }],
    topItems: [{ name: "Tea", units: 2, revenueMinor: 250 }],
    assetMix: [{ asset: xlm, takingsMinor: 300, share: 0.375 }],
  });
  assert.deepEqual({ orders, charges, refunds }, before, "reporting must not mutate stored records");
});

test("daily summary has a complete empty state and keeps zero-value asset shares finite", () => {
  const now = new Date(2027, 0, 12, 12).getTime();
  const empty = { takingsMinor: 0, orderCount: 0, avgTicketMinor: 0, tipsMinor: 0, taxMinor: 0, refundedMinor: 0,
    byHour: [], topItems: [], assetMix: [] };
  assert.deepEqual(summarizeDay([], [], new Map(), "mainnet", now), empty);
  const zero = order({ id: "zero", paidAt: now, totalMinor: 0 });
  const asset = { code: "XLM", issuer: null };
  const summary = summarizeDay([zero], [], new Map([[zero.id, { payment: { asset } }]]), "mainnet", now);
  assert.equal(summary.avgTicketMinor, 0);
  assert.deepEqual(summary.assetMix, [{ asset, takingsMinor: 0, share: 0 }]);
});

test("daily summary aggregates item names and preserves stable ties when limiting top items", () => {
  const now = new Date(2027, 0, 12, 12).getTime();
  const sale = order({ id: "sale", paidAt: now });
  sale.lines = Array.from({ length: 10 }, (_, i) => ({
    id: `line-${i}`, itemId: null, name: `Item ${i}`, quantity: 1, unitPriceMinor: 100,
    modifiers: [], taxRateId: "zero", note: null,
  }));
  sale.lines.push({ ...sale.lines[9], id: "another-line", quantity: 2 });
  const result = summarizeDay([sale], [], new Map(), "mainnet", now);
  assert.deepEqual(result.topItems.map(({ name, units, revenueMinor }) => [name, units, revenueMinor]), [
    ["Item 9", 3, 300], ...Array.from({ length: 7 }, (_, i) => [`Item ${i}`, 1, 100]),
  ]);
});
