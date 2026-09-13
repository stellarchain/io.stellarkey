import assert from "node:assert/strict";
import test from "node:test";

import {
  assetAmountFor,
  compareToBand,
  distribute,
  fmtMinor,
  fromStroops,
  lineGrossMinor,
  minorForAssetAmount,
  minorToDecimal,
  orderTotals,
  taxOn,
  tipPresets,
  toleranceStroops,
  toMinor,
  toStroops,
  unitPriceE6,
} from "../src/lib/merchant/money.ts";

const RATES = [
  { id: "std", label: "Standard", percent: 23 },
  { id: "int", label: "Intermediate", percent: 13 },
  { id: "zero", label: "Exempt", percent: 0 },
];

function line(over = {}) {
  return {
    id: "l1",
    itemId: null,
    name: "Line",
    quantity: 1,
    unitPriceMinor: 0,
    modifiers: [],
    taxRateId: "std",
    note: null,
    ...over,
  };
}

test("parses and prints minor units without float drift", () => {
  assert.equal(toMinor("27.33"), 2733);
  assert.equal(toMinor("0.1"), 10);
  assert.equal(toMinor("1"), 100);
  assert.equal(toMinor(".5"), 50);
  assert.equal(toMinor("-3.07"), -307);
  assert.equal(toMinor(1.4), 140);
  assert.equal(minorToDecimal(2733), "27.33");
  assert.equal(minorToDecimal(5), "0.05");
  assert.equal(minorToDecimal(-307), "-3.07");
  assert.equal(fmtMinor(128460, "EUR"), "€ 1,284.60");
  assert.equal(fmtMinor(-1840, "EUR"), "-€ 18.40");
  assert.throws(() => toMinor("abc"));
  assert.throws(() => toMinor(""));
});

test("a line carries its modifiers into its quantity", () => {
  const l = line({
    quantity: 2,
    unitPriceMinor: 320,
    modifiers: [{ modifierId: "oat", name: "Oat milk", priceMinor: 40 }],
  });
  assert.equal(lineGrossMinor(l), 720);
});

test("inclusive tax is contained in the price, added tax is not", () => {
  assert.equal(taxOn(2733, 23, "inclusive"), 511);
  assert.equal(taxOn(2733, 23, "added"), 629);
  assert.equal(taxOn(8840, 13, "inclusive"), 1017);
  assert.equal(taxOn(1000, 0, "inclusive"), 0);
});

test("a mixed-rate ticket taxes per line, never off the total", () => {
  // The deck's own case: 17 toasties at 13 % beside everything else at 23 %.
  const lines = [
    line({ id: "a", quantity: 17, unitPriceMinor: 520, taxRateId: "int" }),
    line({ id: "b", quantity: 1, unitPriceMinor: 119620, taxRateId: "std" }),
  ];
  const t = orderTotals({ lines, taxRates: RATES, taxMode: "inclusive" });
  assert.equal(t.grossMinor, 128460);
  assert.equal(t.taxByRate.int, 1017);
  assert.equal(t.taxByRate.std, 22368);
  assert.equal(t.taxMinor, 23385);
  assert.equal(t.netMinor, 128460 - 23385);
  assert.equal(t.totalMinor, 128460);
  // The shortcut a shop must never use.
  assert.notEqual(t.taxMinor, taxOn(128460, 23, "inclusive"));
});

test("discount spreads pro-rata and never loses a cent", () => {
  const lines = [
    line({ id: "a", unitPriceMinor: 1000 }),
    line({ id: "b", unitPriceMinor: 333 }),
    line({ id: "c", unitPriceMinor: 667 }),
  ];
  const t = orderTotals({ lines, taxRates: RATES, taxMode: "inclusive", discountMinor: 101 });
  assert.equal(t.grossMinor, 2000);
  assert.equal(t.discountMinor, 101);
  assert.equal(t.totalMinor, 1899);
  assert.equal(t.taxMinor, taxOn(1899 - 0, 23, "inclusive") - 0 || t.taxMinor);
  // Distribution itself is exact for any weighting.
  assert.equal(distribute(101, [1000, 333, 667]).reduce((a, b) => a + b, 0), 101);
  assert.equal(distribute(7, [1, 1, 1]).reduce((a, b) => a + b, 0), 7);
  assert.deepEqual(distribute(0, [5, 5]), [0, 0]);
});

test("line adjustments reduce that line before ticket discount and tax", () => {
  const lines = [
    line({ id: "standard", unitPriceMinor: 1000, adjustmentMinor: 250 }),
    line({ id: "zero", unitPriceMinor: 1000, taxRateId: "zero", adjustmentMinor: 0 }),
  ];

  const totals = orderTotals({
    lines,
    taxRates: RATES,
    taxMode: "inclusive",
    discountMinor: 100,
  });

  assert.equal(totals.grossMinor, 2000);
  assert.equal(totals.discountMinor, 350);
  // The remaining ticket-wide 100 is distributed over 750:1000, so 43 lands
  // on the standard-rate line after its own 250 adjustment.
  assert.equal(totals.taxByRate.std, taxOn(707, 23, "inclusive"));
  assert.equal(totals.taxByRate.zero, undefined);
  assert.equal(totals.totalMinor, 1650);
});

test("a discount cannot exceed the ticket and a tip is never taxed", () => {
  const lines = [line({ unitPriceMinor: 1000 })];
  const over = orderTotals({ lines, taxRates: RATES, taxMode: "inclusive", discountMinor: 9999 });
  assert.equal(over.discountMinor, 1000);
  assert.equal(over.totalMinor, 0);

  const tipped = orderTotals({ lines, taxRates: RATES, taxMode: "inclusive", tipMinor: 222 });
  assert.equal(tipped.totalMinor, 1222);
  assert.equal(tipped.taxMinor, taxOn(1000, 23, "inclusive"));
});

test("added-tax mode puts tax on top of the total", () => {
  const lines = [line({ unitPriceMinor: 1000 })];
  const t = orderTotals({ lines, taxRates: RATES, taxMode: "added" });
  assert.equal(t.netMinor, 1000);
  assert.equal(t.taxMinor, 230);
  assert.equal(t.totalMinor, 1230);
});

test("tip presets switch from percentages to fixed amounts under the threshold", () => {
  const tips = {
    mode: "percent",
    percents: [10, 15, 20],
    fixedMinor: [20, 50, 100],
    thresholdMinor: 1000,
    onNet: true,
  };
  assert.deepEqual(
    tipPresets(2222, tips).map((p) => p.amountMinor),
    [222, 333, 444],
  );
  assert.deepEqual(
    tipPresets(140, tips).map((p) => p.amountMinor),
    [20, 50, 100],
  );
  assert.deepEqual(tipPresets(2222, { ...tips, mode: "off" }), []);
});

test("stroop conversion is exact in both directions", () => {
  assert.equal(toStroops("27.3300000"), 273300000n);
  assert.equal(toStroops("27.33"), 273300000n);
  assert.equal(toStroops("0.0000001"), 1n);
  assert.equal(fromStroops(273300000n), "27.3300000");
  assert.equal(fromStroops(1n), "0.0000001");
  assert.equal(fromStroops(-273300000n), "-27.3300000");
  assert.throws(() => toStroops("27.33000001"));
  assert.throws(() => toStroops("nope"));
});

test("an asset quote rounds up so the shop is never short a stroop", () => {
  // A cheap asset's price is not a whole cent, which is why quotes are scaled.
  const xlm = unitPriceE6(0.2532);
  assert.equal(xlm, 25_320_000);
  // 27.33 / 0.2532 = 107.93838862…, and the quote rounds up rather than truncating.
  assert.equal(assetAmountFor(2733, xlm), "107.9383887");
  assert.ok(minorForAssetAmount("107.9383887", xlm) >= 2733);
  // USDC at parity.
  assert.equal(assetAmountFor(2733, unitPriceE6(1)), "27.3300000");
  // Rounding is always up, never toward the customer.
  const awkward = assetAmountFor(1000, unitPriceE6(0.03));
  assert.ok(minorForAssetAmount(awkward, unitPriceE6(0.03)) >= 1000);
  assert.throws(() => assetAmountFor(100, 0));
  assert.throws(() => unitPriceE6(0));
  assert.throws(() => unitPriceE6(Number.NaN));
});

test("the tolerance band never lets an exact salt be swallowed", () => {
  // EUR 27.33 of USDC at parity: 1 unit = 100 minor.
  const parity = unitPriceE6(1);
  const expected = assetAmountFor(2733, parity);
  const band = toleranceStroops(expected, 150, 2, parity);
  // One stroop of salt sits far inside the band, so only exact comparison reads it.
  assert.equal(compareToBand("27.3300001", expected, band), "inside");
  assert.equal(compareToBand(expected, expected, band), "exact");
  assert.equal(compareToBand("27.7400000", expected, band), "over");
  assert.equal(compareToBand("26.9200000", expected, band), "short");
  assert.ok(band > 1n);
});

test("the tolerance floor keeps tiny tickets matchable", () => {
  // 1.5 % of EUR 0.20 is well under a cent, so the floor has to carry it.
  const parity = unitPriceE6(1);
  const expected = assetAmountFor(20, parity);
  const proportionalOnly = toleranceStroops(expected, 150, 0, parity);
  const withFloor = toleranceStroops(expected, 150, 2, parity);
  assert.ok(withFloor > proportionalOnly);
  assert.equal(compareToBand("0.2100000", expected, withFloor), "inside");
});
