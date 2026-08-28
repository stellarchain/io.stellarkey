"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  useMerchantConfiguration,
  useMerchantRecords,
  useMerchantReporting,
  useMerchantStatus,
} from "@/hooks/useMerchant";
import { LIVE_MINUTE_MS, useLiveNow } from "@/hooks/useLiveNow";
import { useWalletIdentity } from "@/hooks/useWallet";
import { formatTrezorAddress } from "@/lib/address-display";
import type { FiatCurrency } from "@/lib/format";
import { assetKey, isNative } from "@/lib/merchant/charge";
import { fmtMinor } from "@/lib/merchant/money";
import { deriveInsightsHistory, startOfDay } from "@/lib/merchant/insights";
import type { AcceptedAsset, Minor } from "@/lib/merchant/types";
import { Sparkline } from "../Sparkline";
import { IOSBackButton } from "../ui";
import { MerchantDisclosure } from "./Disclosure";
import { Stat, StatStrip } from "./Stat";

/**
 * Hue is spent in exactly one place on this screen: the asset mix, where each
 * hue sits beside the code it stands for and nothing else tells one asset from
 * another. The ranked lists spend none — a bar's length already carries its
 * value, and colouring the rows on top of that only made blue mean an asset in
 * one panel and two different items in the panel beside it.
 *
 * Green is money-in and stays out of the categorical set, so a chart of shares
 * never reads as a chart of profit. The mix leads on cyan rather than on the
 * subject blue, so the largest slice is not the same blue as today's takings.
 */
const MIX = ["#64D2FF", "#BF5AF2", "#5E5CE6", "#0A84FF"];
/** Today: the subject of every chart here, and the screen's only accent. */
const TODAY = "#0A84FF";
/** A typical day of this weekday, behind today. Indigo, because it is not money. */
const TYPICAL = "#5E5CE6";
const POSITIVE = "#30D158";
/** Down, not wrong. A quiet day is not an error, so it is never red. */
const QUIET = "#FF9F0A";
/** Money going back over the counter. */
const NEGATIVE = "#FF453A";
/** No verdict: nothing to compare against, so nothing is claimed. */
const UNTINTED = "rgba(235,235,245,0.66)";

const AXIS = "rgba(235,235,245,0.38)";
const AXIS_FAINT = "rgba(235,235,245,0.2)";

interface HourSlot {
  hour: number;
  takingsMinor: Minor;
  orders: number;
  /** The mean this hour takes on this weekday, or 0 when it has never traded. */
  typicalMinor: Minor;
  state: "done" | "current" | "future";
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function clock(hour: number): string {
  return `${pad(hour)}:00`;
}

/** Null when there is nothing to divide by: an invented percentage is a lie. */
function changePct(now: number, before: number): number | null {
  if (before <= 0) return null;
  return ((now - before) / before) * 100;
}

/** Up is not automatically good, so a quiet day is amber rather than red. */
function deltaTone(pct: number): "money" | "warn" | "ink" {
  if (pct > 0.05) return "money";
  if (pct < -0.05) return "warn";
  return "ink";
}

function fmtPct(value: number): string {
  const abs = Math.abs(value);
  if (abs < 0.05) return "level";
  return `${value > 0 ? "+" : "-"}${abs.toFixed(abs >= 10 ? 0 : 1)} %`;
}

function tintFor(value: number | null): string {
  if (value === null) return UNTINTED;
  if (value > 0.05) return POSITIVE;
  if (value < -0.05) return QUIET;
  return UNTINTED;
}

/**
 * A finding in pieces, so every figure inside one can be set in the mono face
 * the rest of the screen sets its figures in.
 */
type Part = string | { readonly figure: string };
const fig = (value: string): Part => ({ figure: value });

interface Finding {
  /**
   * One finding per subject. Two bullets about the same hour is one slot spent
   * twice, and the third slot is the only room this panel has for anything that
   * is not about the clock.
   */
  subject: "hour" | "item" | "asset" | "orders";
  parts: Part[];
}

function FindingLine({ parts }: { parts: Part[] }) {
  return (
    <>
      {parts.map((part, index) =>
        typeof part === "string" ? (
          <span key={`${index}-t`}>{part}</span>
        ) : (
          <span key={`${index}-f`} className="mono">
            {part.figure}
          </span>
        ),
      )}
    </>
  );
}

export function InsightsPage({ onBack }: { onBack?: () => void }) {
  const { ready } = useMerchantStatus();
  const { settings } = useMerchantConfiguration();
  const { orders, refunds } = useMerchantRecords();
  const { today } = useMerchantReporting();
  const { network } = useWalletIdentity();
  const reportingNow = useLiveNow(LIVE_MINUTE_MS);
  const currency = settings.currency;

  const summary = today;
  const past = useMemo(
    () => deriveInsightsHistory(orders, { network, now: reportingNow }),
    [network, orders, reportingNow],
  );
  const dayStart = startOfDay(reportingNow);

  // The same slice `today` is built from, so the tax breakdown always adds up
  // to the tax figure the summary reports.
  const paidToday = useMemo(
    () => orders.filter((o) => o.network === network && o.paidAt !== null && o.paidAt >= dayStart),
    [dayStart, network, orders],
  );

  const realTaxRows = useMemo(() => {
    const totals = new Map<string, Minor>();
    for (const order of paidToday) {
      for (const [rateId, minor] of Object.entries(order.totals.taxByRate)) {
        totals.set(rateId, (totals.get(rateId) ?? 0) + minor);
      }
    }
    return [...totals.entries()]
      .map(([id, minor]) => {
        const rate = settings.taxRates.find((r) => r.id === id);
        return { id, label: rate?.label ?? id, percent: rate?.percent ?? null, minor };
      })
      .sort((a, b) => b.minor - a.minor);
  }, [paidToday, settings.taxRates]);

  const taxRows = realTaxRows;

  const refundsToday = useMemo(
    () =>
      refunds.filter(
        (r) =>
          r.network === network &&
          r.createdAt >= dayStart &&
          r.submissionStatus === "confirmed",
      ),
    [dayStart, network, refunds],
  );

  const refundCount = refundsToday.length;

  /**
   * What today is held against. A day is over when the hours the shop normally
   * trades are over — the clock alone cannot know that. While it is still
   * running, the comparison is to the same hours of the comparison day, because
   * half a day set against a whole one is not a comparison at all.
   */
  const against = useMemo(() => {
    const typical = past.typicalByHour;
    const closeHour = typical.length ? typical[typical.length - 1].hour + 1 : 24;
    const running = past.hoursElapsed < closeHour;
    const at = past.last14Days.length >= 8 ? past.last14Days[past.last14Days.length - 8].at : null;
    const hours = Math.floor(past.hoursElapsed);
    return {
      running,
      base: running ? past.sameDayLastWeekToDate : past.sameDayLastWeek,
      weekday: at === null ? null : new Date(at).toLocaleDateString(undefined, { weekday: "long" }),
      // The exact cut this comparison was drawn at, not a rounded-off hour.
      through: `${pad(hours)}:${pad(Math.round((past.hoursElapsed - hours) * 60))}`,
    };
  }, [past]);

  const weekdayName = against.weekday ?? "day";

  /**
   * A contiguous run of hours reads as a trading day rather than a list of
   * spikes. The run covers what today has taken *and* what this weekday
   * normally takes, so the hours still to come are on the chart as empty slots
   * instead of being missing from it.
   */
  const slots = useMemo<HourSlot[]>(() => {
    const typicalAt = new Map(past.typicalByHour.map((h) => [h.hour, h.takingsMinor]));
    const todayAt = new Map(summary.byHour.map((h) => [h.hour, h]));
    const present = [...new Set([...todayAt.keys(), ...typicalAt.keys()])].sort((a, b) => a - b);
    if (present.length === 0) return [];
    const first = present[0];
    const span = present[present.length - 1] - first + 1;
    const hours = span > 16 ? present : Array.from({ length: span }, (_, i) => first + i);
    const current = Math.floor(past.hoursElapsed);
    return hours.map((hour) => ({
      hour,
      takingsMinor: todayAt.get(hour)?.takingsMinor ?? 0,
      orders: todayAt.get(hour)?.orders ?? 0,
      typicalMinor: typicalAt.get(hour) ?? 0,
      state: hour > current ? "future" : hour === current ? "current" : "done",
    }));
  }, [past, summary.byHour]);

  const peak = useMemo(
    () =>
      slots.reduce<HourSlot | null>(
        (best, slot) =>
          slot.takingsMinor > 0 && (!best || slot.takingsMinor > best.takingsMinor) ? slot : best,
        null,
      ),
    [slots],
  );

  /**
   * Findings, not advice. Each one is a fact the reader can check by looking
   * down this page, phrased once and never contradicting the figure it came
   * from. The hour still in progress is left out of the comparison with a
   * typical day: twelve minutes set against a full hour would read as a
   * collapse that never happened.
   *
   * One finding per subject, three at most. The clock gets a single slot — when
   * the busiest hour is also the hour that moved furthest from normal, the two
   * facts share one sentence rather than two bullets — so the panel always has
   * room for something that is not about time.
   */
  const findings = useMemo<Finding[]>(() => {
    const candidates: Finding[] = [];

    const settled = slots.filter((s) => s.state === "done" && s.typicalMinor > 0);
    const swing = settled.reduce<HourSlot | null>(
      (best, slot) =>
        !best ||
        Math.abs(slot.takingsMinor - slot.typicalMinor) >
          Math.abs(best.takingsMinor - best.typicalMinor)
          ? slot
          : best,
      null,
    );

    const versusTypical = (slot: HourSlot): Part[] => {
      const gap = slot.takingsMinor - slot.typicalMinor;
      return gap >= 0
        ? [` It beat a typical ${weekdayName} by `, fig(fmtMinor(gap, currency)), "."]
        : [" It came in ", fig(fmtMinor(-gap, currency)), ` under a typical ${weekdayName}.`];
    };

    if (peak && summary.takingsMinor > 0) {
      const share = (peak.takingsMinor / summary.takingsMinor) * 100;
      candidates.push({
        subject: "hour",
        parts: [
          fig(clock(peak.hour)),
          " was the busiest hour at ",
          fig(fmtMinor(peak.takingsMinor, currency)),
          ", ",
          fig(`${share.toFixed(0)} %`),
          " of the day.",
          ...(swing && swing.hour === peak.hour ? versusTypical(peak) : []),
        ],
      });
    }

    if (swing && (!peak || swing.hour !== peak.hour)) {
      const gap = swing.takingsMinor - swing.typicalMinor;
      candidates.push({
        subject: "hour",
        parts:
          gap >= 0
            ? [
                fig(clock(swing.hour)),
                ` beat a typical ${weekdayName} by `,
                fig(fmtMinor(gap, currency)),
                ".",
              ]
            : [
                fig(clock(swing.hour)),
                " came in ",
                fig(fmtMinor(-gap, currency)),
                ` under a typical ${weekdayName}.`,
              ],
      });
    }

    const [lead, next] = summary.topItems;
    if (lead && next) {
      candidates.push({
        subject: "item",
        parts: [
          `${lead.name} leads on revenue, `,
          fig(fmtMinor(lead.revenueMinor - next.revenueMinor, currency)),
          ` clear of ${next.name}.`,
        ],
      });
    } else if (lead) {
      candidates.push({
        subject: "item",
        parts: [
          `${lead.name} is the only item ranked, at `,
          fig(fmtMinor(lead.revenueMinor, currency)),
          ".",
        ],
      });
    }

    // How the money arrived, which is a fact about the day that owes nothing to
    // the clock — and the one the shop settles its books on.
    const [top] = summary.assetMix;
    if (top && summary.assetMix.length > 1) {
      candidates.push({
        subject: "asset",
        parts: [
          `${top.asset.code} carried `,
          fig(`${(top.share * 100).toFixed(0)} %`),
          " of what came in, ",
          fig(fmtMinor(top.takingsMinor, currency)),
          " of it.",
        ],
      });
    } else if (top) {
      candidates.push({
        subject: "asset",
        parts: [`Every settled payment arrived in ${top.asset.code}.`],
      });
    }

    if (against.base) {
      const more = summary.orderCount - against.base.orderCount;
      if (more !== 0) {
        candidates.push({
          subject: "orders",
          parts: [
            fig(String(Math.abs(more))),
            ` ${Math.abs(more) === 1 ? "order" : "orders"} ${more > 0 ? "more" : "fewer"} than last ${weekdayName}.`,
          ],
        });
      }
    }

    const taken = new Set<Finding["subject"]>();
    return candidates.filter((finding) => {
      if (taken.size === 3 || taken.has(finding.subject)) return false;
      taken.add(finding.subject);
      return true;
    });
  }, [against.base, currency, peak, slots, summary, weekdayName]);

  const takingsPct = against.base ? changePct(summary.takingsMinor, against.base.takingsMinor) : null;
  const ordersPct = against.base ? changePct(summary.orderCount, against.base.orderCount) : null;
  const baseAvg =
    against.base && against.base.orderCount > 0
      ? Math.round(against.base.takingsMinor / against.base.orderCount)
      : 0;
  const avgPct = changePct(summary.avgTicketMinor, baseAvg);

  const tipShare = summary.takingsMinor > 0 ? (summary.tipsMinor / summary.takingsMinor) * 100 : 0;
  const netMinor = summary.takingsMinor - summary.refundedMinor;

  return (
    <section className="fade-up w-full pb-[132px] md:pb-12">
      {/* Only the sub-page variant needs a header; in Merchant Mode the app header
          and the sidebar already name the page. */}
      {onBack && (
        <div className="flex items-center gap-2 pb-4">
          <IOSBackButton onClick={onBack} label="Back to Merchant Mode" />
          <h1 className="display-h min-w-0 flex-1 truncate text-[22px] text-white">Today</h1>
        </div>
      )}

      {!ready ? (
        <div className="space-y-4">
          <div className="skeleton h-[188px] rounded-[20px]" />
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="skeleton h-[264px] rounded-[20px] lg:col-span-2" />
            <div className="skeleton h-[264px] rounded-[20px]" />
          </div>
        </div>
      ) : (
        /*
          A considered grid rather than one long column: the lead across the top,
          the hour chart with its findings beside it, then the three ledgers that
          explain the mix in a row. One column on a phone, where scrolling is the
          only axis there is.
        */
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-6">
          {/*
            One figure leads — but a figure alone is trivia. The comparison sits
            with it, the fortnight runs underneath it, and the three supporting
            figures each carry their own read against the same day.
          */}
          {/*
            The same 61px strip every other merchant page opens with. The figure
            keeps its comparison, but as a delta beside it rather than a block of
            its own — the day it is measured against is stated in full under the
            findings, so the lead does not have to carry it twice.
          */}
          <StatStrip
            columns="minmax(0,1.5fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1.3fr)"
            className="md:col-span-2 lg:col-span-6"
          >
            <Stat
              label={`Takings ${against.running ? `to ${against.through}` : "today"}`}
              value={fmtMinor(summary.takingsMinor, currency)}
              tone="money"
              delta={
                takingsPct === null
                  ? undefined
                  : { label: fmtPct(takingsPct), tone: deltaTone(takingsPct) }
              }
            />
            <Stat
              label="Orders"
              value={String(summary.orderCount)}
              delta={
                ordersPct === null
                  ? undefined
                  : { label: fmtPct(ordersPct), tone: deltaTone(ordersPct) }
              }
              divider="left"
            />
            <Stat
              label="Average"
              value={fmtMinor(summary.avgTicketMinor, currency)}
              delta={
                avgPct === null ? undefined : { label: fmtPct(avgPct), tone: deltaTone(avgPct) }
              }
              divider="left"
            />
            {/*
              Tips carries a share, not a delta: the history the shop keeps is
              takings and orders, so a tip figure for last week is not in it and
              one derived from the two that are would be invented.
            */}
            <Stat
              label="Tips"
              value={fmtMinor(summary.tipsMinor, currency)}
              delta={{ label: `${tipShare.toFixed(1)} %`, tone: "ink" }}
              divider="left"
            />
            <Stat label={`Last 14 days${against.running ? ", to time" : ""}`} divider="left">
              <div className="mt-0.5">
                <TrendLine
                  days={past.last14Days}
                  currency={currency}
                  running={against.running}
                  deltaPct={takingsPct}
                  weekday={weekdayName}
                  through={against.through}
                  compact
                />
              </div>
            </Stat>
          </StatStrip>

          <HourChart
            slots={slots}
            currency={currency}
            weekday={weekdayName}
            hoursElapsed={past.hoursElapsed}
            className="md:col-span-2 lg:col-span-4"
          />

          <div className="panel p-4 md:col-span-2 lg:col-span-2">
            <h2 className="text-[15.5px] font-semibold text-white">What stands out</h2>
            {findings.length === 0 ? (
              <p className="mt-3 text-[13px] text-neutral-500">
                Nothing has settled today, so there is nothing to read yet.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {findings.map((finding) => (
                  <li key={finding.subject} className="flex gap-2.5">
                    <span
                      aria-hidden="true"
                      className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: TODAY }}
                    />
                    <span className="text-[13.5px] leading-relaxed text-neutral-300">
                      <FindingLine parts={finding.parts} />
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {/*
              Every percentage above is drawn against this day, and until now the
              day itself was never stated. A reader told they are 18 % up is owed
              the figure they are 18 % up on.
            */}
            {against.base && (
              <div className="mt-4 border-t border-white/[0.08] pt-3.5">
                <p className="text-[10.5px] font-semibold uppercase tracking-wider text-neutral-500">
                  Measured against
                </p>
                <p className="mt-1 text-[13px] text-neutral-300">
                  last {weekdayName}
                  {against.running && (
                    <>
                      {" to "}
                      <span className="mono">{against.through}</span>
                    </>
                  )}
                </p>
                <div className="mt-2 grid grid-cols-3 gap-1">
                  <BaseFigure
                    label="Takings"
                    value={fmtMinor(against.base.takingsMinor, currency)}
                  />
                  <BaseFigure label="Orders" value={String(against.base.orderCount)} />
                  <BaseFigure
                    label="Average"
                    value={baseAvg > 0 ? fmtMinor(baseAvg, currency) : "—"}
                  />
                </div>
              </div>
            )}
          </div>

          <TopItems
            items={summary.topItems}
            currency={currency}
            className="md:col-span-1 lg:col-span-2"
          />

          <AssetMix
            mix={summary.assetMix}
            currency={currency}
            className="md:col-span-1 lg:col-span-2"
          />

          {/* Tax and refunds are both what today owes back, so they read as one. */}
          <div className="panel p-4 md:col-span-2 lg:col-span-2">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-[15.5px] font-semibold text-white">Tax and refunds</h2>
              <span className="text-[11px] text-neutral-500">
                {settings.taxMode === "inclusive" ? "in prices" : "at the till"}
              </span>
            </div>

            <div className="mt-3">
              {taxRows.map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="min-w-0 truncate text-[13.5px] text-neutral-300">
                    {row.label}
                    {row.percent !== null && (
                      <span className="mono ml-1.5 text-[12px] text-neutral-500">
                        {row.percent} %
                      </span>
                    )}
                  </span>
                  <span className="mono shrink-0 text-[13.5px] text-white">
                    {fmtMinor(row.minor, currency)}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] py-2">
                <span className="text-[13px] text-neutral-400">Total tax</span>
                <span className="mono text-[13.5px] text-white">
                  {fmtMinor(summary.taxMinor, currency)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] py-2">
                <span className="text-[13px] text-neutral-400">
                  Refunded
                  <span className="mono ml-1.5 text-[12px] text-neutral-500">{refundCount}</span>
                </span>
                <span
                  className="mono text-[13.5px]"
                  style={{ color: summary.refundedMinor > 0 ? NEGATIVE : undefined }}
                >
                  {summary.refundedMinor > 0 ? "-" : ""}
                  {fmtMinor(summary.refundedMinor, currency)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-white/[0.16] pt-2.5">
                <span className="text-[13px] font-semibold text-neutral-400">Net</span>
                <span className="mono text-[15.5px] font-medium" style={{ color: POSITIVE }}>
                  {fmtMinor(netMinor, currency)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* The figures lead; the mechanism is one tap away at the foot. */}
      <div className="mt-6 border-t border-white/[0.08] pt-4">
        <MerchantDisclosure label="How today is counted">
          <p>
            The day runs from midnight on this device to now. An order joins it when its payment
            settles on the ledger, not when it is rung up, so the total only ever moves forwards.
          </p>
          <p>
            Last {weekdayName} is the same weekday a week back, off this device&rsquo;s own record.
            While today is still trading it is cut at the same time of day, so a part day is never
            set against a whole one. A typical {weekdayName} is the mean of the last four, hour by
            hour, over the ones the shop actually opened.
          </p>
          <p>
            Tax is summed line by line at each line&rsquo;s own rate. A mixed basket does not
            survive being taxed at one rate on the total, so it never is. The mix is what each
            settled payment actually arrived in, valued at the rate quoted when the charge was
            raised.
          </p>
          {summary.orderCount === 0 && (
            <p>No settled orders have been recorded today. Empty figures are shown as zero.</p>
          )}
        </MerchantDisclosure>
      </div>
    </section>
  );
}

/**
 * The fortnight under the lead, in the app's own sparkline idiom — the one the
 * XLM card on Home draws.
 *
 * Two things it must not do. It must not plot a part day against thirteen whole
 * ones: while today is still filling, every day in the series is cut at the
 * same time of day today has reached, so the line is like against like all the
 * way across. And it must not disagree with the chip above it: the tint is the
 * headline's own comparison — today against the same weekday last week, both
 * counted to the same hour — rather than a separate verdict read off the last
 * settled day, which on any shop that shuts one day a week is a closed day at
 * nought and would draw a falling line beside a rising headline for ever.
 *
 * Green is money in, amber is a quieter day. A quiet day is not an error, so it
 * is never red; with nothing to compare against, the line makes no claim.
 */
function TrendLine({
  days,
  currency,
  running,
  deltaPct,
  weekday,
  through,
  compact = false,
}: {
  days: { at: number; takingsMinor: Minor; orderCount: number; toDateMinor: Minor }[];
  currency: FiatCurrency;
  running: boolean;
  /** The headline's own read against the comparison day, or null when it has none. */
  deltaPct: number | null;
  weekday: string;
  through: string;
  /** Inside the summary strip: the line alone, no date rail under it. */
  compact?: boolean;
}) {
  if (days.length < 2) return null;
  const at = (day: (typeof days)[number]) => (running ? day.toDateMinor : day.takingsMinor);
  const values = days.map(at);
  const first = days[0];
  const last = days[days.length - 1];
  const best = days.reduce((top, day) => (at(day) > at(top) ? day : top), days[0]);
  const when = (moment: number) =>
    new Date(moment).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const cut = running ? ` to ${through}` : "";

  return (
    <div className="min-w-0">
      <div
        role="img"
        aria-label={`Takings for the last ${days.length} days${
          running ? `, each counted to ${through}` : ""
        }, ${when(first.at)} to today: ${fmtMinor(at(first), currency)} then, ${fmtMinor(
          at(last),
          currency,
        )} today${running ? " so far" : ""}, highest ${fmtMinor(at(best), currency)} on ${when(
          best.at,
        )}. ${
          deltaPct === null
            ? `Nothing to compare with last ${weekday}.`
            : `${fmtPct(deltaPct)} on last ${weekday}${cut}.`
        }`}
      >
        <Sparkline
          values={values}
          width={compact ? 132 : 252}
          height={compact ? 22 : 44}
          color={tintFor(deltaPct)}
        />
      </div>
      {!compact && (
        <p className="mono mt-1 flex items-baseline justify-between gap-3 text-[10.5px] text-neutral-500">
          <span>{when(first.at)}</span>
          <span>{running ? "today so far" : "today"}</span>
        </p>
      )}
    </div>
  );
}

/**
 * One absolute of the day today is measured against. Deliberately quiet: it is
 * the ground the deltas above stand on, not a figure competing with them.
 */
function BaseFigure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[10.5px] uppercase tracking-wider text-neutral-500">{label}</p>
      <p className="mono mt-0.5 truncate text-[13.5px] text-neutral-300">{value}</p>
    </div>
  );
}

/** A supporting figure under the lead, with its own read against the same day. */

/**
 * Today's hours, drawn against what this weekday normally does. The profile
 * behind the bars is the whole point of the chart: a bar is a number, and a bar
 * with normal drawn through it is a reading.
 */
/** Fades the cut edge so a clipped chart reads as continuing, not as ending. */
const FADE_MASK = "linear-gradient(to right, #000 0, #000 calc(100% - 28px), transparent 100%)";

function HourChart({
  slots,
  currency,
  weekday,
  hoursElapsed,
  className = "",
}: {
  slots: HourSlot[];
  currency: FiatCurrency;
  weekday: string;
  hoursElapsed: number;
  className?: string;
}) {
  const titleId = useId();
  const descId = useId();

  // Scrollbars are hidden app-wide, so a chart that runs past its box gives no
  // sign of it. Measure the overflow, fade the cut edge, and say so.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [clipped, setClipped] = useState(false);

  const measureOverflow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setClipped(el.scrollWidth - el.clientWidth - el.scrollLeft > 8);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    measureOverflow();
    const observer = new ResizeObserver(measureOverflow);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measureOverflow, slots.length]);

  if (slots.length === 0) {
    return (
      <div className={`panel p-4 ${className}`}>
        <h2 className="text-[15.5px] font-semibold text-white">Takings by hour</h2>
        <p className="mt-3 text-[13px] text-neutral-500">
          No payment has settled with a time on it yet.
        </p>
      </div>
    );
  }

  const n = slots.length;
  // The slot narrows as the day lengthens and stops at both ends: two bars do
  // not drift half a chart apart, and twelve still fall inside one scroll.
  const slotW = Math.max(36, Math.min(72, Math.floor(288 / n)));
  const padL = 30;
  const padR = 16;
  const padT = 26;
  const padB = 40;
  const plotH = 138;
  const width = padL + n * slotW + padR;
  const height = padT + plotH + padB;
  const baseY = padT + plotH;
  const barW = Math.min(slotW - 16, 44);

  // One scale for both series. Two would make the comparison a decoration.
  const ceiling = Math.max(1, ...slots.map((s) => Math.max(s.takingsMinor, s.typicalMinor)));
  const y = (minor: Minor) => baseY - (minor / ceiling) * plotH;
  const cx = (index: number) => padL + index * slotW + slotW / 2;

  const peak = slots.reduce<HourSlot | null>(
    (best, slot) =>
      slot.takingsMinor > 0 && (!best || slot.takingsMinor > best.takingsMinor) ? slot : best,
    null,
  );
  const todayTotal = slots.reduce((sum, s) => sum + s.takingsMinor, 0);
  const typicalTotal = slots.reduce((sum, s) => sum + s.typicalMinor, 0);
  const hasTypical = typicalTotal > 0;

  // The reference runs the full width of the plot rather than bar centre to bar
  // centre: stopping at the centres put its two end edges through the middle of
  // the first and last bars, cutting in half the very marks it is drawn behind.
  const inner = slots.map((s, i) => [cx(i), y(s.typicalMinor)] as const);
  const edged = [
    [padL, inner[0][1]] as const,
    ...inner,
    [width - padR, inner[n - 1][1]] as const,
  ];
  const line = edged.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
  const band = `${padL},${baseY} ${line} ${width - padR},${baseY}`;

  const currentIndex = slots.findIndex((s) => s.state === "current");
  const firstFuture = slots.findIndex((s) => s.state === "future");
  // Where the clock is inside the hour it is in — measured across the bar that
  // hour is drawn as, not across the whole slot. A slot is wider than its bar,
  // so measuring across the slot put "now" in the gutter at twenty past, beside
  // the bar rather than in it, denying the very hour it was describing.
  const nowX =
    currentIndex >= 0
      ? cx(currentIndex) -
        barW / 2 +
        Math.min(1, Math.max(0, hoursElapsed - slots[currentIndex].hour)) * barW
      : null;
  const restX = firstFuture >= 0 ? padL + firstFuture * slotW : null;

  const description = [
    `Takings by hour, ${clock(slots[0].hour)} to ${clock(slots[n - 1].hour)}.`,
    `Today ${fmtMinor(todayTotal, currency)}${currentIndex >= 0 ? " so far" : ""}.`,
    hasTypical ? `A typical ${weekday} takes ${fmtMinor(typicalTotal, currency)} across these hours.` : "",
    peak
      ? `Busiest hour ${clock(peak.hour)} at ${fmtMinor(peak.takingsMinor, currency)} from ${peak.orders} ${peak.orders === 1 ? "order" : "orders"}.`
      : "",
    firstFuture >= 0 ? `${clock(slots[firstFuture].hour)} onwards has not been reached.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <figure className={`panel p-4 ${className}`}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[15.5px] font-semibold text-white">Takings by hour</h2>
        <p className="flex items-center gap-3 text-[11.5px] text-neutral-500">
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-[2px]"
              style={{ background: TODAY }}
            />
            today
          </span>
          {hasTypical && (
            <span className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-0 w-3.5 border-t border-dashed"
                style={{ borderColor: TYPICAL }}
              />
              typical {weekday}
            </span>
          )}
        </p>
      </figcaption>

      <div className="relative mt-3">
        <div
          ref={scrollRef}
          onScroll={measureOverflow}
          className="overflow-x-auto"
          style={clipped ? { maskImage: FADE_MASK, WebkitMaskImage: FADE_MASK } : undefined}
        >
        <svg
          role="img"
          aria-labelledby={titleId}
          aria-describedby={descId}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
          className="mx-auto block"
          style={{
            width: "100%",
            height: "auto",
            minWidth: Math.min(width, 400),
            maxWidth: Math.round(width * 1.45),
          }}
        >
          <title id={titleId}>Takings by hour, today against a typical {weekday}</title>
          <desc id={descId}>{description}</desc>

          {/* Scale */}
          <text x={padL} y={12} fontSize="10" fill={AXIS} className="mono">
            {fmtMinor(ceiling, currency)}
          </text>
          {[0, 1, 2].map((step) => (
            <line
              key={step}
              x1={padL}
              x2={width - padR}
              y1={padT + (plotH / 3) * step}
              y2={padT + (plotH / 3) * step}
              stroke="rgba(255,255,255,0.07)"
              strokeDasharray="3 5"
            />
          ))}

          {/* Normal, behind today: ground for the bars to stand against. */}
          {hasTypical && <polygon points={band} fill={TYPICAL} fillOpacity="0.1" />}

          {/*
            The part of the day not yet reached. Absence has to read as absence:
            painting it a lighter rectangle made the emptiest region of the chart
            the brightest thing on it, so it is a shadow now, not a highlight.
          */}
          {restX !== null && (
            <>
              <rect
                x={restX}
                y={padT - 8}
                width={width - padR - restX}
                height={plotH + 8}
                fill="rgba(0,0,0,0.34)"
              />
              <line
                x1={restX}
                x2={restX}
                y1={padT - 8}
                y2={baseY}
                stroke="rgba(255,255,255,0.06)"
              />
            </>
          )}

          {slots.map((slot, index) => {
            const centre = cx(index);
            const isPeak = peak !== null && slot.hour === peak.hour;
            const h = slot.takingsMinor > 0 ? Math.max(3, baseY - y(slot.takingsMinor)) : 0;
            return (
              <g key={slot.hour}>
                <title>
                  {`${clock(slot.hour)} — ${
                    slot.state === "future"
                      ? "not reached yet"
                      : `${fmtMinor(slot.takingsMinor, currency)} from ${slot.orders} ${
                          slot.orders === 1 ? "order" : "orders"
                        }${slot.typicalMinor > 0 ? `, typically ${fmtMinor(slot.typicalMinor, currency)}` : ""}${
                          slot.state === "current" ? ", still filling" : ""
                        }`
                  }`}
                </title>

                {h > 0 ? (
                  <>
                    {/*
                      Today is the subject of this chart, so it is the most
                      present mark on it — every settled hour at full strength,
                      not one bar in twelve. The hour still filling is the single
                      exception, and it says why with an open cap.
                    */}
                    <rect
                      x={centre - barW / 2}
                      y={baseY - h}
                      width={barW}
                      height={h}
                      rx={4}
                      fill={TODAY}
                      fillOpacity={slot.state === "current" ? 0.72 : 1}
                    />
                    {/* An hour still filling is capped open, not closed off. */}
                    {slot.state === "current" && (
                      <line
                        x1={centre - barW / 2}
                        x2={centre + barW / 2}
                        y1={baseY - h}
                        y2={baseY - h}
                        stroke={TODAY}
                        strokeWidth="1.5"
                        strokeDasharray="3 3"
                      />
                    )}
                  </>
                ) : (
                  <rect
                    x={centre - barW / 2}
                    y={baseY - 2}
                    width={barW}
                    height={2}
                    rx={1}
                    fill={
                      slot.state === "future" ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.14)"
                    }
                  />
                )}

                {isPeak && (
                  <rect
                    x={centre - 13}
                    y={baseY + 6}
                    width={26}
                    height={15}
                    rx={7.5}
                    fill="rgba(10,132,255,0.18)"
                  />
                )}
                <text
                  x={centre}
                  y={baseY + 17}
                  fontSize="10"
                  textAnchor="middle"
                  fill={isPeak ? TODAY : slot.state === "future" ? AXIS_FAINT : AXIS}
                  className="mono"
                >
                  {pad(slot.hour)}
                </text>
              </g>
            );
          })}

          {/*
            Normal, drawn across today rather than behind it. A hairline is a
            fraction of a bar's mass however dark it is, so it can sit on top and
            still read as the annotation: the bars carry the chart, this says
            where they would usually be.
          */}
          {hasTypical && (
            <polyline
              points={line}
              fill="none"
              stroke={TYPICAL}
              strokeOpacity="0.72"
              strokeWidth="1.25"
              strokeDasharray="4 3"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}

          {/* Baseline last, so no bar sits on top of it. */}
          <line x1={padL} x2={width - padR} y1={baseY} y2={baseY} stroke="rgba(255,255,255,0.18)" />
          <text
            x={padL - 6}
            y={baseY + 3}
            fontSize="9.5"
            textAnchor="end"
            fill={AXIS}
            className="mono"
          >
            0
          </text>

          {nowX !== null && (
            <>
              <line
                x1={nowX}
                x2={nowX}
                y1={padT - 8}
                y2={baseY}
                stroke="rgba(255,255,255,0.34)"
                strokeDasharray="2 3"
              />
              {/*
                The ceiling figure is pinned to the same top rail. On a day whose
                trading all sits near the left of the window the two land on each
                other, so the marker keeps its line and drops its word — the line
                is the part that carries the meaning.
              */}
              {nowX - 26 > padL + fmtMinor(ceiling, currency).length * 6.2 + 6 && (
                <text x={nowX - 4} y={padT - 12} fontSize="9.5" textAnchor="end" fill={AXIS}>
                  now
                </text>
              )}
            </>
          )}

          <text x={width / 2} y={height - 6} fontSize="9.5" textAnchor="middle" fill={AXIS_FAINT}>
            hour of day
          </text>
        </svg>
        </div>
        {clipped && (
          <p className="mt-1.5 text-[11px] text-neutral-500">
            Swipe the chart for the rest of the day &mdash; or open the table below.
          </p>
        )}
      </div>

      {/* The same figures as a table, for anyone the chart cannot serve. */}
      <MerchantDisclosure label="Hour by hour" className="mt-1">
        <table className="mono w-full text-[12px]">
          <caption className="sr-only">{description}</caption>
          <thead className="text-neutral-500">
            <tr>
              <th scope="col" className="py-1 text-left font-medium">
                Hour
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Today
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Typical
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Orders
              </th>
            </tr>
          </thead>
          <tbody>
            {slots.map((slot) => (
              <tr key={slot.hour} className="border-t border-white/[0.06]">
                <th scope="row" className="py-1 text-left font-normal text-neutral-400">
                  {clock(slot.hour)}
                </th>
                <td className="py-1 text-right text-neutral-200">
                  {slot.state === "future" ? "—" : fmtMinor(slot.takingsMinor, currency)}
                </td>
                <td className="py-1 text-right text-neutral-500">
                  {slot.typicalMinor > 0 ? fmtMinor(slot.typicalMinor, currency) : "—"}
                </td>
                <td className="py-1 text-right text-neutral-500">
                  {slot.state === "future" ? "—" : slot.orders}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </MerchantDisclosure>
    </figure>
  );
}

function TopItems({
  items,
  currency,
  className = "",
}: {
  items: { name: string; units: number; revenueMinor: Minor }[];
  currency: FiatCurrency;
  className?: string;
}) {
  const shown = items.slice(0, 5);
  const max = shown.reduce((best, i) => Math.max(best, i.revenueMinor), 0);
  return (
    <div className={`panel p-4 ${className}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[15.5px] font-semibold text-white">Top sellers</h2>
        <span className="text-[11px] text-neutral-500">by revenue</span>
      </div>
      {shown.length === 0 ? (
        <p className="mt-3 text-[13px] text-neutral-500">
          Today was all keypad amounts, so there is nothing to rank.
        </p>
      ) : (
        <ul className="mt-3 space-y-2.5">
          {shown.map((item) => {
            const share = max > 0 ? item.revenueMinor / max : 0;
            return (
              <li key={item.name}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-[14px] text-white">{item.name}</span>
                  <span className="shrink-0 text-right">
                    <span className="mono text-[13.5px] text-white">
                      {fmtMinor(item.revenueMinor, currency)}
                    </span>
                    <span className="mono ml-2 text-[11.5px] text-neutral-500">
                      &times;{item.units}
                    </span>
                  </span>
                </div>
                {/*
                  One accent down the whole list. The length is the value; a hue
                  per row was a second encoding of a figure already encoded, and
                  it left the same blue standing for an asset next door.
                */}
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.max(share * 100, 1.5)}%`, background: TODAY }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function AssetMix({
  mix,
  currency,
  className = "",
}: {
  mix: { asset: AcceptedAsset; takingsMinor: Minor; share: number }[];
  currency: FiatCurrency;
  className?: string;
}) {
  return (
    <div className={`panel p-4 ${className}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[15.5px] font-semibold text-white">Asset mix</h2>
        <span className="text-[11px] text-neutral-500">
          <span className="mono">{mix.length}</span> {mix.length === 1 ? "asset" : "assets"}
        </span>
      </div>

      {mix.length === 0 ? (
        <p className="mt-3 text-[13px] text-neutral-500">
          No settled payment carried an asset today, so there is no mix to show.
        </p>
      ) : (
        <>
          <div
            role="img"
            aria-label={mix
              .map(
                (m) =>
                  `${m.asset.code} ${(m.share * 100).toFixed(1)} percent, ${fmtMinor(
                    m.takingsMinor,
                    currency,
                  )}`,
              )
              .join("; ")}
            className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-white/[0.06]"
          >
            {mix.map((m, index) => (
              <span
                key={assetKey(m.asset)}
                className="h-full"
                style={{
                  flex: `${Math.max(m.share, 0.001)} 1 0%`,
                  minWidth: 4,
                  background: MIX[index % MIX.length],
                }}
              />
            ))}
          </div>

          <ul className="mt-3">
            {mix.map((m, index) => (
              <li
                key={assetKey(m.asset)}
                className={`flex items-center gap-2.5 py-2 ${
                  index > 0 ? "border-t border-white/[0.08]" : ""
                }`}
              >
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: MIX[index % MIX.length] }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-white">{m.asset.code}</span>
                  <span className="mono block truncate text-[11px] text-neutral-500">
                    {isNative(m.asset)
                      ? "native"
                      : formatTrezorAddress(m.asset.issuer ?? "", { head: 4, tail: 4 })}
                  </span>
                </span>
                <span className="mono shrink-0 text-[12.5px] text-neutral-400">
                  {(m.share * 100).toFixed(1)} %
                </span>
                <span className="mono shrink-0 text-right text-[13.5px] text-white">
                  {fmtMinor(m.takingsMinor, currency)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
