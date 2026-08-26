import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { emptyStore } from "../src/lib/merchant/defaults.ts";
import { orderTotals } from "../src/lib/merchant/money.ts";

const JAN_5 = Date.UTC(2027, 0, 5, 12);
const JAN_12 = Date.UTC(2027, 0, 12, 12);
const FEB_1 = Date.UTC(2027, 1, 1);
const TILL = "GAVLAAAWTBEO5XJELA3TID4XVHELGTFYRMMFRU2MQ25C5VVCBI476ZVG";
const PAYER = "GCUXWZHL7FGVL3MVYH6N5G3RACCKAC7ZLTUBKKN4I5MCCTDPJXITNGFD";
const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const USDC = { code: "USDC", issuer: ISSUER };

async function reportingDomain() {
  try {
    return await import("../src/lib/merchant/reporting.ts");
  } catch (error) {
    assert.fail(`The reporting domain is missing: ${error instanceof Error ? error.message : error}`);
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

function line(id, name, amount, taxRateId = "standard", adjustmentMinor = 0) {
  return {
    id,
    itemId: id,
    name,
    quantity: 1,
    unitPriceMinor: amount,
    modifiers: [],
    taxRateId,
    note: null,
    adjustmentMinor,
  };
}

function paidOrder(store, { id, at, lines, discountMinor = 0, tipMinor = 0, tender }) {
  const totals = orderTotals({
    lines,
    taxRates: store.settings.taxRates,
    taxMode: store.settings.taxMode,
    discountMinor,
    tipMinor,
  });
  return {
    id,
    number: Number(id.replace(/\D/g, "")) || 1,
    reference: `SALE${id}`,
    network: "mainnet",
    status: "paid",
    lines,
    totals,
    currency: store.settings.currency,
    tender: tender(totals.totalMinor),
    staffId: "staff-owner",
    staffName: "Ari",
    terminalName: "Front till",
    createdAt: at - 100,
    paidAt: at,
    stockAppliedAt: at,
    payerAddress: PAYER,
    note: null,
  };
}

function fixtureStore(taxMode = "inclusive") {
  const member = actor();
  const base = emptyStore();
  const configured = {
    ...base,
    settings: { ...base.settings, taxMode },
    staff: [member],
    activeStaffId: member.id,
  };
  const cash = paidOrder(configured, {
    id: "order-1",
    at: JAN_5,
    lines: [line("coffee", "Coffee, \"large\"", 1230), line("cake", "Cake", 565, "intermediate")],
    discountMinor: 95,
    tipMinor: 100,
    tender: (total) => [{ kind: "cash", amountMinor: total, receivedMinor: total, changeMinor: 0 }],
  });
  const crypto = paidOrder(configured, {
    id: "order-2",
    at: JAN_12,
    lines: [line("beans", "Beans\n250g", 1200)],
    tender: (total) => [{ kind: "crypto", amountMinor: total, chargeId: "charge-2" }],
  });
  const charge = {
    id: "charge-2",
    orderId: crypto.id,
    reference: crypto.reference,
    network: "mainnet",
    destination: TILL,
    amountMinor: crypto.totals.totalMinor,
    currency: crypto.currency,
    quotes: [],
    status: "paid",
    createdAt: JAN_12 - 100,
    expiresAt: JAN_12 + 100,
    payment: {
      id: "payment-2",
      transactionHash: "a".repeat(64),
      ledger: 777,
      from: PAYER,
      amount: "12.0000000",
      asset: USDC,
      memo: crypto.reference,
      createdAt: new Date(JAN_12).toISOString(),
      lane: "memo",
    },
  };
  const refund = {
    id: "refund-1",
    orderId: cash.id,
    kind: "order",
    sourcePaymentId: null,
    network: "mainnet",
    amountMinor: 500,
    asset: { code: "XLM", issuer: null },
    amount: "2.0000000",
    destination: PAYER,
    reason: "customer_request",
    note: "Returned item",
    transactionHash: "b".repeat(64),
    submissionStatus: "confirmed",
    createdAt: JAN_12 + 100,
  };
  return { member, store: { ...configured, orders: [crypto, cash], charges: [charge], refunds: [refund] } };
}

test("report arithmetic derives sales, refunds, discounts, tender, asset, and tax facts", async () => {
  const { deriveReport } = await reportingDomain();
  const { store } = fixtureStore("inclusive");
  const report = deriveReport(store, { network: "mainnet", from: Date.UTC(2027, 0, 1), to: FEB_1 });

  const saleTax = store.orders.reduce((sum, order) => sum + order.totals.taxMinor, 0);
  assert.equal(report.orderCount, 2);
  assert.equal(report.refundCount, 1);
  assert.equal(report.refundsMinor, 500);
  assert.equal(report.discountsMinor, 95);
  assert.equal(report.taxMinor, Object.values(report.taxByRate).reduce((sum, minor) => sum + minor, 0));
  assert.ok(report.taxMinor < saleTax);
  assert.equal(report.grossMinor, report.netMinor + report.taxMinor);
  assert.equal(report.byTender.cash, store.orders[1].totals.totalMinor);
  assert.equal(report.byTender.crypto, store.orders[0].totals.totalMinor);
  assert.equal(report.byTender.card, 0);
  assert.deepEqual(report.byAsset, [{ asset: USDC, amountMinor: store.orders[0].totals.totalMinor }]);
});

test("inclusive and added-tax orders retain their stored exact line arithmetic", async () => {
  const { reportRows } = await reportingDomain();
  for (const mode of ["inclusive", "added"]) {
    const { store } = fixtureStore(mode);
    const rows = reportRows(store, { network: "mainnet", from: Date.UTC(2027, 0, 1), to: FEB_1 });
    const sales = rows.filter((row) => row.kind === "sale");
    assert.equal(
      sales.reduce((sum, row) => sum + row.taxMinor, 0),
      store.orders.reduce((sum, order) => sum + order.totals.taxMinor, 0),
    );
    assert.ok(sales.every((row) => row.grossMinor === row.netMinor + row.taxMinor));
  }
});

test("monthly periods include the current empty period and put refunds on their event date", async () => {
  const { deriveTaxPeriods } = await reportingDomain();
  const { store } = fixtureStore();
  const periods = deriveTaxPeriods(store, { network: "mainnet", now: Date.UTC(2027, 1, 15) });
  assert.equal(periods[0].id, "2027-02");
  assert.equal(periods[0].orderCount, 0);
  assert.equal(periods[0].grossMinor, 0);
  assert.equal(periods[1].id, "2027-01");
  assert.equal(periods[1].refundsMinor, 500);
});

test("CSV and JSON exports are stable, escaped, and retain ledger identity", async () => {
  const { buildReportFile } = await reportingDomain();
  const { store } = fixtureStore();
  const range = { network: "mainnet", from: Date.UTC(2027, 0, 1), to: FEB_1, basis: "transaction" };
  const csv = buildReportFile(store, { ...range, format: "csv" });
  assert.equal(csv.mimeType, "text/csv;charset=utf-8");
  assert.match(csv.contents, /"Coffee, ""large"""/);
  assert.match(csv.contents, /"Beans\n250g"/);
  assert.equal(csv.rowCount, 4);

  const json = buildReportFile(store, { ...range, format: "json" });
  const decoded = JSON.parse(json.contents);
  const crypto = decoded.rows.find((row) => row.orderId === "order-2");
  assert.equal(crypto.transactionHash, "a".repeat(64));
  assert.equal(crypto.ledger, 777);
  assert.equal(crypto.payerAddress, PAYER);
  assert.equal(crypto.asset.issuer, ISSUER);
});

test("export commits an actor audit only for truthful supported output", async () => {
  const { createReportExport } = await reportingDomain();
  const { member, store } = fixtureStore();
  const input = {
    id: "export-1",
    actor: member,
    network: "mainnet",
    from: Date.UTC(2027, 0, 1),
    to: FEB_1,
    basis: "transaction",
    format: "csv",
    now: FEB_1,
  };
  const created = createReportExport(store, input);
  assert.equal(created.store.exportRecords[0].runById, member.id);
  assert.equal(created.store.exportRecords[0].rowCount, created.file.rowCount);
  assert.equal(created.store.exportRecords[0].fileName, created.file.fileName);
  assert.throws(() => createReportExport(store, { ...input, id: "xero", format: "xero" }), /not available/i);
  assert.throws(() => createReportExport(store, { ...input, id: "settled", basis: "settlement" }), /settlement.*not available/i);
});

test("production reports contain no sample data and download only supported files", () => {
  const tax = source("src/components/merchant/TaxRecordsPage.tsx");
  const insights = source("src/components/merchant/InsightsPage.tsx");
  const hook = source("src/hooks/useMerchant.tsx");
  for (const screen of [tax, insights]) {
    assert.doesNotMatch(screen, /merchant\/mock|MOCK_TAX|MOCK_EXPORT|MOCK_INSIGHTS/);
  }
  assert.match(tax, /createReportExport|URL\.createObjectURL|download/);
  assert.match(tax, /disabled/);
  assert.doesNotMatch(tax, /Would build|Nothing is written to disk|Would show/);
  assert.match(hook, /deriveTaxPeriods|createReportExport/);
});
