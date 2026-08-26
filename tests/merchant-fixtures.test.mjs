import assert from "node:assert/strict";
import test from "node:test";

import { MOCK_INSIGHTS, MOCK_INSIGHTS_HISTORY, MOCK_SHIFT } from "../src/lib/merchant/mock.ts";

/**
 * The shift and the insights fixtures describe the same demo day from two
 * angles. They drifted apart once (47 orders against 122, € 1,284.60 against
 * € 502.00), which made the till and the charts disagree on screen.
 */
test("the shift and the insights fixtures describe the same day", () => {
  assert.equal(MOCK_SHIFT.orderCount, MOCK_INSIGHTS.orderCount);
  assert.equal(MOCK_SHIFT.grossMinor, MOCK_INSIGHTS.takingsMinor);
  assert.equal(MOCK_SHIFT.tipsMinor, MOCK_INSIGHTS.tipsMinor);
  assert.equal(MOCK_SHIFT.refundsMinor, MOCK_INSIGHTS.refundedMinor);
});

test("the sample day's own arithmetic reconciles", () => {
  const hours = MOCK_INSIGHTS.byHour;
  assert.equal(
    hours.reduce((sum, h) => sum + h.orders, 0),
    MOCK_INSIGHTS.orderCount,
  );
  assert.equal(
    hours.reduce((sum, h) => sum + h.takingsMinor, 0),
    MOCK_INSIGHTS.takingsMinor,
  );
  assert.equal(
    Math.round(MOCK_INSIGHTS.takingsMinor / MOCK_INSIGHTS.orderCount),
    MOCK_INSIGHTS.avgTicketMinor,
  );

  const mix = MOCK_INSIGHTS.assetMix;
  assert.equal(
    mix.reduce((sum, m) => sum + m.takingsMinor, 0),
    MOCK_INSIGHTS.takingsMinor,
  );
  assert.ok(Math.abs(mix.reduce((sum, m) => sum + m.share, 0) - 1) < 0.0001);

  // Item revenue is what was rung up; takings are what was taken, after a
  // discount and a tip. The first must never exceed the second's gross.
  assert.ok(
    MOCK_INSIGHTS.topItems.reduce((sum, i) => sum + i.revenueMinor, 0) <=
      MOCK_INSIGHTS.takingsMinor,
  );

  // A mixed-rate basket cannot be 23 % of the total.
  const shortcut = Math.round((MOCK_INSIGHTS.takingsMinor * 23) / 123);
  assert.notEqual(MOCK_INSIGHTS.taxMinor, shortcut);
  assert.ok(MOCK_INSIGHTS.taxMinor < shortcut);
});

/**
 * The comparison is the product: Insights answers "compared to what?" before it
 * answers anything else. A history fixture that drifted from the day it is the
 * history of would print a percentage nobody could verify by reading down the
 * page, which is worse than printing no percentage at all.
 */
test("the sample day is the last day of its own history", () => {
  const series = MOCK_INSIGHTS_HISTORY.last14Days;
  assert.equal(series.length, 14);

  const latest = series[series.length - 1];
  assert.equal(latest.takingsMinor, MOCK_INSIGHTS.takingsMinor);
  assert.equal(latest.orderCount, MOCK_INSIGHTS.orderCount);

  // Oldest first, one entry per calendar day, no day skipped and none repeated.
  for (let i = 1; i < series.length; i += 1) {
    assert.ok(series[i].at > series[i - 1].at);
    const days = Math.round((series[i].at - series[i - 1].at) / 86400000);
    assert.equal(days, 1);
  }

  // Seven days back is the same weekday, so it is the day the lead compares to.
  const weekAgo = series[series.length - 8];
  assert.equal(weekAgo.takingsMinor, MOCK_INSIGHTS_HISTORY.sameDayLastWeek.takingsMinor);
  assert.equal(weekAgo.orderCount, MOCK_INSIGHTS_HISTORY.sameDayLastWeek.orderCount);

  // The fortnight is plotted from the to-date figures while today is filling, so
  // every day in it has to be cut at the same clock time the lead is cut at.
  // A part day drawn against thirteen whole ones is the lie this screen exists
  // to remove; it must not come back inside the chart.
  assert.equal(weekAgo.toDateMinor, MOCK_INSIGHTS_HISTORY.sameDayLastWeekToDate.takingsMinor);
  assert.equal(latest.toDateMinor, MOCK_INSIGHTS.takingsMinor);
  for (const day of series) {
    assert.ok(day.toDateMinor <= day.takingsMinor);
    assert.equal(day.takingsMinor === 0, day.toDateMinor === 0);
  }
});

test("a typical day covers the hours the sample day trades", () => {
  const typical = MOCK_INSIGHTS_HISTORY.typicalByHour;
  assert.deepEqual(
    typical.map((h) => h.hour),
    MOCK_INSIGHTS.byHour.map((h) => h.hour),
  );
  assert.ok(typical.every((h) => h.takingsMinor > 0));

  // The sample day has to read as a good day, and beat a normal one at lunch.
  const normal = typical.reduce((sum, h) => sum + h.takingsMinor, 0);
  assert.ok(normal < MOCK_INSIGHTS.takingsMinor);

  const typicalAt = new Map(typical.map((h) => [h.hour, h.takingsMinor]));
  const best = MOCK_INSIGHTS.byHour.reduce((a, b) =>
    b.takingsMinor - typicalAt.get(b.hour) > a.takingsMinor - typicalAt.get(a.hour) ? b : a,
  );
  assert.equal(best.hour, 13);
});

test("the part day is compared with a part day", () => {
  const full = MOCK_INSIGHTS_HISTORY.sameDayLastWeek;
  const toDate = MOCK_INSIGHTS_HISTORY.sameDayLastWeekToDate;

  // A day cannot have taken more by lunchtime than it took in total.
  assert.ok(toDate.takingsMinor <= full.takingsMinor);
  assert.ok(toDate.orderCount <= full.orderCount);

  // 18:12 on a shop that trades to 18:00: the sample day is still running, so
  // the lead has to hold today beside the part of last week that matches it.
  const lastHour = MOCK_INSIGHTS.byHour[MOCK_INSIGHTS.byHour.length - 1].hour;
  assert.ok(MOCK_INSIGHTS_HISTORY.hoursElapsed > lastHour);
  assert.ok(MOCK_INSIGHTS_HISTORY.hoursElapsed < lastHour + 1);

  // The improvement the design has to show: visible, and not absurd.
  const change = (MOCK_INSIGHTS.takingsMinor / toDate.takingsMinor - 1) * 100;
  assert.ok(change > 5 && change < 40);

  // The fortnight decides its own colour the way the headline does — like for
  // like against the comparison day — so the two can never disagree. Read off
  // the last settled day instead, the sample fortnight would end on a shut
  // Sunday and draw a falling line beside a rising headline.
  const series = MOCK_INSIGHTS_HISTORY.last14Days;
  assert.equal(series[series.length - 2].takingsMinor, 0);
  assert.ok(series[series.length - 1].toDateMinor > series[series.length - 8].toDateMinor);
});
