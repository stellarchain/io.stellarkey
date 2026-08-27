import type { NetworkKey } from "../stellar";
import type { Minor, Order } from "./types";

const TREND_DAYS = 14;
const TYPICAL_WEEKS = 4;
const HOUR_MS = 60 * 60 * 1000;

/**
 * What today is measured against. Every field comes from the same settled
 * orders and timestamp, so comparisons cannot drift from one another.
 */
export interface InsightsHistory {
  sameDayLastWeek: { takingsMinor: Minor; orderCount: number } | null;
  sameDayLastWeekToDate: { takingsMinor: Minor; orderCount: number } | null;
  last14Days: { at: number; takingsMinor: Minor; orderCount: number; toDateMinor: Minor }[];
  typicalByHour: { hour: number; takingsMinor: Minor }[];
  hoursElapsed: number;
}

/** Local midnight of the calendar day `at` falls in. */
export function startOfDay(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Calendar arithmetic stays on the same weekday through clock changes. */
function shiftDays(dayStart: number, days: number): number {
  const date = new Date(dayStart);
  date.setDate(date.getDate() + days);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function deriveInsightsHistory(
  orders: readonly Order[],
  { network, now }: { network: NetworkKey; now: number },
): InsightsHistory {
  const todayStart = startOfDay(now);
  const elapsedMs = now - todayStart;
  const paid = orders.filter((order) => order.network === network && order.paidAt !== null);

  const days = new Map<number, { takingsMinor: Minor; orderCount: number }>();
  const toClock = new Map<number, { takingsMinor: Minor; orderCount: number }>();
  const hours = new Map<number, Map<number, Minor>>();

  for (const order of paid) {
    const at = order.paidAt as number;
    const dayStart = startOfDay(at);
    const total = order.totals.totalMinor;

    const day = days.get(dayStart) ?? { takingsMinor: 0, orderCount: 0 };
    day.takingsMinor += total;
    day.orderCount += 1;
    days.set(dayStart, day);

    if (at - dayStart < elapsedMs) {
      const soFar = toClock.get(dayStart) ?? { takingsMinor: 0, orderCount: 0 };
      soFar.takingsMinor += total;
      soFar.orderCount += 1;
      toClock.set(dayStart, soFar);
    }

    const perHour = hours.get(dayStart) ?? new Map<number, Minor>();
    const hour = new Date(at).getHours();
    perHour.set(hour, (perHour.get(hour) ?? 0) + total);
    hours.set(dayStart, perHour);
  }

  const lastWeekStart = shiftDays(todayStart, -7);
  const lastWeek = days.get(lastWeekStart) ?? null;
  const last14Days = Array.from({ length: TREND_DAYS }, (_, index) => {
    const dayStart = shiftDays(todayStart, index - (TREND_DAYS - 1));
    const day = days.get(dayStart);
    return {
      at: dayStart,
      takingsMinor: day?.takingsMinor ?? 0,
      orderCount: day?.orderCount ?? 0,
      toDateMinor: toClock.get(dayStart)?.takingsMinor ?? 0,
    };
  });

  const weekdays = Array.from({ length: TYPICAL_WEEKS }, (_, index) =>
    shiftDays(todayStart, -7 * (index + 1)),
  ).filter((dayStart) => days.has(dayStart));
  const typicalTotals = new Map<number, Minor>();
  for (const dayStart of weekdays) {
    for (const [hour, minor] of hours.get(dayStart) ?? []) {
      typicalTotals.set(hour, (typicalTotals.get(hour) ?? 0) + minor);
    }
  }

  return {
    sameDayLastWeek: lastWeek ? { ...lastWeek } : null,
    sameDayLastWeekToDate: lastWeek
      ? { ...(toClock.get(lastWeekStart) ?? { takingsMinor: 0, orderCount: 0 }) }
      : null,
    last14Days,
    typicalByHour: [...typicalTotals.entries()]
      .map(([hour, minor]) => ({ hour, takingsMinor: Math.round(minor / weekdays.length) }))
      .sort((a, b) => a.hour - b.hour),
    hoursElapsed: elapsedMs / HOUR_MS,
  };
}
