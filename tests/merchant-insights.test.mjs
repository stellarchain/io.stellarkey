import assert from "node:assert/strict";
import test from "node:test";
import { deriveInsightsHistory } from "../src/lib/merchant/insights.ts";

for (const { zone, day } of [
  { zone: "Europe/London", day: [2026, 2, 29] },
  { zone: "Europe/London", day: [2026, 3, 5] },
  { zone: "Europe/London", day: [2026, 9, 25] },
  { zone: "Europe/London", day: [2026, 10, 1] },
  { zone: "Australia/Lord_Howe", day: [2026, 3, 5] },
  { zone: "Australia/Lord_Howe", day: [2026, 9, 4] },
  { zone: "UTC", day: [2026, 2, 29] },
]) {
  test(`insights compares local clock times across clock changes: ${zone} ${day[0]}-${day[1] + 1}-${day[2]}`, () => {
    const originalZone = process.env.TZ;
    process.env.TZ = zone;
    try {
      const [year, month, date] = day;
      const now = new Date(year, month, date, 15, 30).getTime();
      const lastWeek = new Date(year, month, date - 7, 15, 30).getTime();
      if (zone !== "UTC") {
        assert.notEqual(now - new Date(now).setHours(0, 0, 0, 0),
          lastWeek - new Date(lastWeek).setHours(0, 0, 0, 0),
          "one comparison day contains a real offset transition");
      }
      const sale = (id, at, totalMinor) => ({
        id, network: "mainnet", paidAt: at, totals: { totalMinor },
      });
      const orders = [
        sale("before", new Date(year, month, date - 7, 15, 15).getTime(), 200),
        sale("boundary", lastWeek, 300),
        sale("after", new Date(year, month, date - 7, 15, 45).getTime(), 400),
        sale("today", new Date(year, month, date, 15, 15).getTime(), 100),
      ];
      const result = deriveInsightsHistory(orders, { network: "mainnet", now });
      assert.deepEqual(result.sameDayLastWeekToDate, { takingsMinor: 200, orderCount: 1 });
      assert.deepEqual(result.sameDayLastWeek, { takingsMinor: 900, orderCount: 3 });
      assert.equal(result.last14Days[6].toDateMinor, 200);
      assert.equal(result.last14Days[13].toDateMinor, 100);
      assert.equal(result.hoursElapsed, 15.5, "the live-hour chart uses the local clock, not elapsed duration");
    } finally {
      if (originalZone === undefined) delete process.env.TZ;
      else process.env.TZ = originalZone;
    }
  });
}
