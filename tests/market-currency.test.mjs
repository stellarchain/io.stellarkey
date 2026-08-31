import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as format from "../src/lib/format.ts";

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
    /mode === "market"\s*\? fmtFiatMarketPrice\(displayedValue, fiatCurrency, fiatRates\)\s*:\s*fmtFiat\(displayedValue, fiatCurrency, fiatRates\)/,
  );
  assert.equal(
    priceCard.match(/<PriceChart[\s\S]*?currency=\{fiatCurrency\}[\s\S]*?rates=\{fiatRates\}/g)?.length,
    2,
  );
  assert.match(chart, /currency: FiatCurrency;/);
  assert.match(chart, /rates: Partial<Record<FiatCurrency, number>>;/);
  assert.match(chart, /marketPrecision\s*\? fmtFiatMarketPrice\(value, currency, rates\)\s*:\s*fmtFiat\(value, currency, rates\)/);
  assert.doesNotMatch(chart, /fmtUsd/);
});

test("public asset rows show representative fiat values beyond native XLM", () => {
  const dashboard = read("src/components/Dashboard.tsx");

  assert.match(dashboard, /getRepresentativeUnitPrice\(/);
  assert.doesNotMatch(dashboard, /asset\.isNative && !privacyMode && xlmPriceUsd !== null/);
});

test("market prices retain useful precision below one display-currency unit", () => {
  assert.equal(typeof format.fmtFiatMarketPrice, "function");
  assert.equal(format.fmtFiatMarketPrice(0.17123, "GBP", { GBP: 0.76 }), "£0.1301");
  assert.equal(format.fmtFiatMarketPrice(12.345, "GBP", { GBP: 0.8 }), "£9.88");
  assert.equal(format.fmtFiatMarketPrice(0.17123, "EUR", {}), "Rate unavailable");
});

test("market card pins its range controls to the dashboard footer line", () => {
  const dashboard = read("src/components/Dashboard.tsx");
  const priceCard = dashboard.slice(dashboard.indexOf("function PriceCard()"));

  assert.match(
    priceCard,
    /<section className="panel fade-up relative flex h-full flex-col p-5 sm:p-6">/,
  );
  assert.match(
    priceCard,
    /data-market-range-selector[\s\S]*?className="mt-auto pt-3"/,
  );
  assert.match(priceCard, /aria-label="Chart range"/);
  assert.match(priceCard, /aria-pressed=\{priceRange === r\}/);
  assert.doesNotMatch(priceCard, /Reserved footer slot/);
});

test("market chart explains the selected period without changing its plot", () => {
  const dashboard = read("src/components/Dashboard.tsx");
  const priceCard = dashboard.slice(dashboard.indexOf("function PriceCard()"));
  const chart = read("src/components/PriceChart.tsx");

  assert.match(priceCard, /Stellar Lumens · \$\{periodLabel\} range/);
  assert.match(priceCard, /fmtFiatMarketPrice\(displayedValue, fiatCurrency, fiatRates\)/);
  assert.match(
    chart,
    /aria-label=\{`\$\{range\} \$\{marketPrecision \? "market price" : "portfolio value"\} summary`\}/,
  );
  assert.match(chart, /\{ label: "Start", value: startPrice \}/);
  assert.match(chart, /\{ label: "Low", value: rawMin \}/);
  assert.match(chart, /\{ label: "High", value: rawMax \}/);
  assert.match(chart, /<dt[^>]*>\{metric\.label\}<\/dt>/);
  assert.match(chart, /fmtFiatMarketPrice/);
  assert.match(chart, /<polygon points=\{area\} fill="url\(#price-chart-grad\)" \/>/);
  assert.match(chart, /<polyline[\s\S]*?points=\{line\}/);
});

test("chart inspection replaces the single top-right market readout", () => {
  const dashboard = read("src/components/Dashboard.tsx");
  const priceCard = dashboard.slice(dashboard.indexOf("function PriceCard()"));
  const chart = read("src/components/PriceChart.tsx");

  assert.match(
    priceCard,
    /useState<PriceChartInspection \| null>\(null\)/,
  );
  assert.match(priceCard, /const displayedValue = chartInspection\?\.p \?\? currentValue/);
  assert.match(
    priceCard,
    /const displayedChangePct = chartInspection\?\.changePct \?\? changePct/,
  );
  assert.match(priceCard, /grid-cols-\[minmax\(0,1fr\)_auto\]/);
  assert.match(priceCard, /justify-end[\s\S]*?text-right/);
  assert.equal(priceCard.match(/onInspect=\{setChartInspection\}/g)?.length, 2);

  assert.match(chart, /export interface PriceChartInspection/);
  assert.match(
    chart,
    /onInspect\?: \(inspection: PriceChartInspection \| null\) => void;/,
  );
  assert.match(chart, /onInspect\?\.\(\{[\s\S]*?p: point\.p,[\s\S]*?changePct:/);
  assert.match(chart, /onInspect\?\.\(null\)/);
  assert.doesNotMatch(chart, /timeLabel\(|Interactive Price HUD|fmtFiatMarketPrice\(hoverPt\.p/);
  assert.doesNotMatch(chart, /hoverPt \? \(/);
});
