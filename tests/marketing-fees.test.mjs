import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PUBLISHED_PROCESSOR_RATES,
  annualProcessorFeeMinor,
  annualSales,
  annualTurnoverMinor,
} from "../src/lib/marketing-fees.ts";

const rate = (id) => {
  const published = PUBLISHED_PROCESSOR_RATES.find((entry) => entry.id === id);
  assert.ok(published, `${id} must have a published rate`);
  return published;
};

test("annual sales use a 365-day comparison year", () => {
  assert.equal(annualSales(40), 14_600);
  const calculator = readFileSync(
    new URL("../src/components/marketing/FeeCalculator.tsx", import.meta.url),
    "utf8",
  );
  assert.match(calculator, /365 trading days/i);
});

test("annual turnover stays in integer minor units", () => {
  assert.equal(annualTurnoverMinor(40, 480), 7_008_000);
});

test("processor fees combine basis points and per-sale pence", () => {
  assert.equal(annualProcessorFeeMinor(40, 480, rate("square")), 122_640);
  assert.equal(annualProcessorFeeMinor(40, 480, rate("sumup")), 118_435);
  assert.equal(annualProcessorFeeMinor(40, 480, rate("stripe-terminal")), 244_112);
});

test("calculator inputs reject non-positive and unsafe integers", () => {
  for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => annualSales(invalid), /positive safe integer/i);
  }
  assert.throws(() => annualTurnoverMinor(40, 0), /positive safe integer/i);
  assert.throws(() => annualTurnoverMinor(40, 4.8), /positive safe integer/i);
});

test("every comparison rate retains dated first-party provenance", () => {
  assert.deepEqual(
    PUBLISHED_PROCESSOR_RATES.map(({ id }) => id),
    ["square", "paypal-pos", "sumup", "stripe-terminal"],
  );

  for (const published of PUBLISHED_PROCESSOR_RATES) {
    const source = new URL(published.source);
    assert.equal(source.protocol, "https:");
    assert.ok(source.hostname.length > 0);
    assert.equal(published.checkedAt, "2026-08-29");
    assert.ok(published.appliesTo.trim().length > 0);
  }
});
