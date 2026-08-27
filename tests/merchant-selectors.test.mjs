import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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
