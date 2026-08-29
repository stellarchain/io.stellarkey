import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

test("XLM market values follow the selected display currency", () => {
  const dashboard = read("src/components/Dashboard.tsx");
  const priceCard = dashboard.slice(
    dashboard.indexOf("function PriceCard()"),
  );
  const chart = read("src/components/PriceChart.tsx");

  assert.match(
    priceCard,
    /currentValue !== null\s*\? fmtFiat\(currentValue, fiatCurrency, fiatRates\)/,
  );
  assert.equal(
    priceCard.match(/<PriceChart[\s\S]*?currency=\{fiatCurrency\}[\s\S]*?rates=\{fiatRates\}/g)?.length,
    2,
  );
  assert.match(chart, /currency: FiatCurrency;/);
  assert.match(chart, /rates: Partial<Record<FiatCurrency, number>>;/);
  assert.equal(chart.match(/fmtFiat\([^,]+, currency, rates\)/g)?.length, 3);
  assert.doesNotMatch(chart, /fmtUsd/);
});
