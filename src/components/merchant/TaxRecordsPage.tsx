"use client";

/**
 * DESIGN MOCK — the tax and records sub-page of Merchant settings.
 *
 * What is mocked: the period figures come from `MOCK_TAX_PERIODS` and the audit
 * trail from `MOCK_EXPORTS`. The rate table and the category mapping are read
 * from the live store (`settings.taxRates`, `catalogue`) because both are already
 * real. Nothing here writes: the range, the basis, the format and the retention
 * choice are local state, and every export button raises a toast instead of
 * building a file. No download is produced and no setting is saved.
 *
 * What a real implementation replaces: periods derived from stored orders rather
 * than a fixture; `updateSettings` behind the retention control; a generator per
 * format that streams rows out of the store and, for the auditor shapes, joins
 * each order to the `MatchedPayment` that settled it; and an `ExportRecord`
 * appended per run, attributed to the staff member who ran it.
 */

import { useMemo, useState, type ReactNode } from "react";
import { useMerchant } from "@/hooks/useMerchant";
import { triggerHaptic } from "@/lib/haptics";
import { MOCK_EXPORTS, MOCK_NOW, MOCK_TAX_PERIODS } from "@/lib/merchant/mock";
import { fmtMinor, taxOn } from "@/lib/merchant/money";
import type { ExportRecord, Minor } from "@/lib/merchant/types";
import { useToast } from "../Toast";
import { Button, IOSBackButton, Notice, SegmentedControl, Select } from "../ui";
import { IconDownload } from "../icons";
import { IconInfo, IconPercent } from "./icons";
import { MerchantDisclosure } from "./Disclosure";

type ExportFormat = ExportRecord["format"];
type Basis = "transaction" | "settlement";

/** Said once, then reused by the chip and the disclosure beside it. */

const FORMATS: { value: ExportFormat; name: string; body: string }[] = [
  {
    value: "csv",
    name: "CSV",
    body: "One row per order line: date, order, item, quantity, net, rate id, tax, gross, staff, terminal.",
  },
  {
    value: "json",
    name: "JSON — with transaction hashes",
    body: "The same rows plus the transaction hash, ledger sequence and payer address, so an auditor can walk from a line on the return to the public ledger and back.",
  },
  {
    value: "xero",
    name: "Xero",
    body: "A sales-invoice import — contact, invoice number, line, account code, tax type, amount. One invoice per order.",
  },
  {
    value: "saft",
    name: "SAF-T (PT)",
    body: "The XML schedule the Portuguese tax authority asks for. Producing the file is not the same as being certified to issue those invoices.",
  },
];

const BASIS_OPTIONS: { label: string; value: Basis }[] = [
  { label: "Transaction date", value: "transaction" },
  { label: "Settlement rate", value: "settlement" },
];

const RETENTION_OPTIONS = [
  { value: "12", label: "12 months" },
  { value: "48", label: "4 years" },
  { value: "120", label: "10 years" },
  { value: "0", label: "Keep everything" },
];

const FORMAT_BADGE: Record<ExportFormat, string> = {
  csv: "CSV",
  json: "JSON",
  xero: "XERO",
  saft: "SAF-T",
};

function isoDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function fmtWhen(ts: number): string {
  return new Date(ts).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function TaxRecordsPage({ onBack }: { onBack: () => void }) {
  const { settings, catalogue } = useMerchant();
  const { toast } = useToast();
  const currency = settings.currency;

  /* Local, in-screen state only. Nothing below is written or persisted. */
  const [periodId, setPeriodId] = useState(MOCK_TAX_PERIODS[0]?.id ?? "");
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [basis, setBasis] = useState<Basis>("transaction");
  const [retention, setRetention] = useState("120");
  const [from, setFrom] = useState(isoDay(MOCK_TAX_PERIODS[0]?.from ?? MOCK_NOW));
  const [to, setTo] = useState(isoDay(MOCK_TAX_PERIODS[0]?.to ?? MOCK_NOW));

  const period = useMemo(
    () => MOCK_TAX_PERIODS.find((p) => p.id === periodId) ?? MOCK_TAX_PERIODS[0],
    [periodId],
  );

  /** Which catalogue categories sit behind each rate — read from the real store. */
  const mapped = useMemo(() => {
    const byRate = new Map<string, { categories: string[]; items: number }>();
    for (const item of catalogue) {
      const entry = byRate.get(item.taxRateId) ?? { categories: [], items: 0 };
      if (!entry.categories.includes(item.category)) entry.categories.push(item.category);
      entry.items += 1;
      byRate.set(item.taxRateId, entry);
    }
    return byRate;
  }, [catalogue]);

  const taxRows = useMemo(() => {
    if (!period) return [];
    return Object.entries(period.taxByRate)
      .map(([id, minor]) => {
        const rate = settings.taxRates.find((r) => r.id === id);
        return { id, label: rate?.label ?? id, percent: rate?.percent ?? null, minor };
      })
      .sort((a, b) => b.minor - a.minor);
  }, [period, settings.taxRates]);

  const taxTotalMinor = taxRows.reduce((sum, row) => sum + row.minor, 0);

  /**
   * The point, made once: tax is the sum of per-line figures. Taking the
   * headline percentage off the grand total is a different number, and on a
   * mixed-rate day it is the wrong one.
   */
  const headline = taxRows.reduce<(typeof taxRows)[number] | null>(
    (best, row) => ((row.percent ?? -1) > (best?.percent ?? -1) ? row : best),
    null,
  );
  const shortcutMinor: Minor | null =
    period && headline?.percent
      ? taxOn(period.grossMinor, headline.percent, settings.taxMode)
      : null;
  const gapMinor = shortcutMinor === null ? null : shortcutMinor - taxTotalMinor;

  const periodOptions = MOCK_TAX_PERIODS.map((p) => ({
    value: p.id,
    label: p.label,
    sublabel: `${p.orderCount} orders`,
  }));

  const chosenFormat = FORMATS.find((f) => f.value === format);

  return (
    <div className="fade-up w-full min-w-0 pb-[132px] md:pb-12">
      <div className="flex items-center justify-between pb-1 pt-2">
        <IOSBackButton label="Back to Merchant settings" onClick={onBack} />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
          Merchant
        </span>
        <span className="w-11" aria-hidden />
      </div>
      <h1 className="display-h text-[28px] font-bold text-white">Tax records</h1>

      <div className="mb-5 mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <MerchantDisclosure label="How these figures are built">
          <p>
            A period is the orders this till rang up between two dates. Tax is summed per line, at
            each line&rsquo;s own rate, and a refund is subtracted from the period it was paid in.
            Every payment behind a row closed in a public ledger, so an export can carry the hash
            that proves it.
          </p>
        </MerchantDisclosure>
      </div>

      <div className="space-y-5">
        {/* ---------------- rates ---------------- */}
        <Section title="Rates">
          <div className="list-group">
            {settings.taxRates.map((rate, i) => {
              const entry = mapped.get(rate.id);
              const isDefault = rate.id === settings.defaultTaxRateId;
              return (
                <div
                  key={rate.id}
                  className={`flex w-full items-center gap-3.5 px-4 py-3.5 ${i > 0 ? "ios-sep" : ""}`}
                >
                  <span
                    aria-hidden="true"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#BF5AF2] text-white shadow-sm"
                  >
                    <IconPercent size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[15.5px] font-normal leading-tight text-white">
                        {rate.label}
                      </span>
                      {isDefault && (
                        <span className="shrink-0 rounded-full bg-[#0A84FF]/15 px-2 py-0.5 text-[10.5px] font-semibold text-[#0A84FF]">
                          Keypad default
                        </span>
                      )}
                    </span>
                    <span className="mono block truncate text-[12px] leading-tight text-neutral-400">
                      {rate.id}
                      {entry && entry.categories.length > 0
                        ? ` · ${entry.categories.join(" · ")} — ${entry.items} ${
                            entry.items === 1 ? "item" : "items"
                          }`
                        : " · no catalogue category maps here yet"}
                    </span>
                  </span>
                  <span className="mono shrink-0 text-[14.5px] font-medium text-neutral-400">
                    {rate.percent} %
                  </span>
                </div>
              );
            })}
          </div>
          <p className="px-1 pt-2 text-[12px] leading-relaxed text-neutral-400">
            Prices are{" "}
            <span className="font-semibold text-neutral-300">
              {settings.taxMode === "inclusive" ? "tax inclusive" : "tax added at the till"}
            </span>
            . Keypad amounts take the keypad default. Edit rates in Merchant settings.
          </p>
        </Section>

        {/* ---------------- period summary ---------------- */}
        <Section title="Period summary">
          {/* One surface, hairlines instead of cards inside cards. */}
          <div className="panel">
            <div className="p-4 sm:max-w-[320px]">
              <Select
                ariaLabel="Tax period"
                value={periodId}
                options={periodOptions}
                onChange={setPeriodId}
              />
            </div>

            {period && (
              <>
                <div className="grid grid-cols-2 gap-px bg-white/[0.08] lg:grid-cols-4">
                  <Figure label="Gross" value={fmtMinor(period.grossMinor, currency)} tone="pos" />
                  <Figure label="Net of tax" value={fmtMinor(period.netMinor, currency)} />
                  <Figure
                    label="Refunds"
                    value={fmtMinor(period.refundsMinor, currency)}
                    tone={period.refundsMinor > 0 ? "neg" : "plain"}
                  />
                  <Figure label="Orders" value={String(period.orderCount)} />
                </div>

                <p className="px-4 pb-1.5 pt-3.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                  Tax by rate
                </p>
                {taxRows.map((row, i) => {
                  const share = taxTotalMinor > 0 ? (row.minor / taxTotalMinor) * 100 : 0;
                  return (
                    <div
                      key={row.id}
                      className={`px-4 py-3 ${i > 0 ? "border-t border-white/[0.08]" : ""}`}
                    >
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="flex min-w-0 items-baseline gap-2">
                          <span className="truncate text-[15.5px] font-normal leading-tight text-white">
                            {row.label}
                          </span>
                          <span className="mono shrink-0 text-[12px] text-neutral-400">
                            {row.percent === null ? row.id : `${row.percent} %`}
                          </span>
                        </span>
                        <span className="mono shrink-0 text-[14.5px] font-medium text-white">
                          {fmtMinor(row.minor, currency)}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]">
                        <div
                          className="h-full rounded-full bg-[#5E5CE6]"
                          style={{ width: `${share}%` }}
                        />
                      </div>
                    </div>
                  );
                })}

                <div className="flex items-baseline justify-between gap-3 border-t border-white/[0.14] px-4 py-3">
                  <span className="text-[15.5px] font-semibold text-white">Tax due</span>
                  <span className="mono text-[15.5px] font-semibold text-white">
                    {fmtMinor(taxTotalMinor, currency)}
                  </span>
                </div>

                {/* The per-line-versus-shortcut point: a figure first, the
                    arithmetic behind it only for whoever asks. */}
                {shortcutMinor !== null && gapMinor !== null && headline && (
                  <div className="border-t border-white/[0.08] px-4 py-1">
                    <MerchantDisclosure
                      label={`Why this is not ${headline.percent} % of the total`}
                    >
                      <p>
                        Tax due is the sum of the tax on each line, at that line&rsquo;s own rate.
                        Taking {headline.percent} % off the grand total gives{" "}
                        <span className="mono font-semibold text-white">
                          {fmtMinor(shortcutMinor, currency)}
                        </span>{" "}
                        instead — {fmtMinor(Math.abs(gapMinor), currency)}{" "}
                        {gapMinor >= 0 ? "too much" : "too little"}, and wrong on any day that sold
                        at more than one rate. The difference is the{" "}
                        {taxRows
                          .filter((r) => r.id !== headline.id)
                          .map((r) => r.label.toLowerCase())
                          .join(" and ")}{" "}
                        lines.
                      </p>
                    </MerchantDisclosure>
                  </div>
                )}
              </>
            )}
          </div>
        </Section>

        {/* ---------------- exports ---------------- */}
        <Section title="Exports">
          <div className="panel space-y-4 p-4">
            {/* Four formats, four long descriptions — one chooser and the one
                description that applies. Nothing is lost; three are just quiet. */}
            <div>
              <p className="field-label">Format</p>
              <Select
                ariaLabel="Export format"
                value={format}
                options={FORMATS.map((f) => ({ value: f.value, label: f.name }))}
                onChange={(next) => setFormat(next as ExportFormat)}
              />
              <p className="mt-2 text-[12.5px] leading-relaxed text-neutral-400">
                {chosenFormat?.body}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="export-from" className="field-label">
                  From
                </label>
                <input
                  id="export-from"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="input input-mono text-base sm:text-[13.5px]"
                />
              </div>
              <div>
                <label htmlFor="export-to" className="field-label">
                  To
                </label>
                <input
                  id="export-to"
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="input input-mono text-base sm:text-[13.5px]"
                />
              </div>
            </div>

            <div>
              <p className="field-label">Basis</p>
              <SegmentedControl<Basis>
                value={basis}
                options={BASIS_OPTIONS}
                onChange={(next) => {
                  setBasis(next);
                  toast(
                    next === "transaction"
                      ? "Rows would be valued at the rate quoted when the order was rung up"
                      : "Rows would be valued at the rate the settlement batch actually converted at",
                  );
                }}
              />
              <p className="mt-2 text-[12.5px] leading-relaxed text-neutral-400">
                Pick one, state it on the export, and do not change it mid-year.
              </p>
              <MerchantDisclosure label="Why the basis changes the numbers">
                <p>
                  <span className="font-semibold text-neutral-200">Transaction date</span> values
                  every order at the rate it was quoted at, the moment the customer paid.{" "}
                  <span className="font-semibold text-neutral-200">Settlement rate</span> values it
                  at the rate the batch converted at, hours later. On a day the market moved four
                  per cent, the two returns differ by real money.
                </p>
              </MerchantDisclosure>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => {
                  triggerHaptic("medium");
                  toast(
                    `Would build a ${chosenFormat?.name ?? format} export for ${from} → ${to} on the ${
                      basis === "transaction" ? "transaction-date" : "settlement"
                    } basis`,
                    "success",
                  );
                }}
              >
                <IconDownload size={15} />
                Export
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  triggerHaptic("selection");
                  toast("Would show the first 50 rows exactly as they would be written");
                }}
              >
                Preview rows
              </Button>
            </div>
            <p className="text-[12px] leading-relaxed text-neutral-400">
              Nothing is written to disk — these buttons describe the file.
            </p>
          </div>
        </Section>

        {/* ---------------- retention ---------------- */}
        <Section title="Retention">
          <div className="panel p-4">
            <div className="sm:max-w-[280px]">
              <Select
                ariaLabel="How long records are kept on this device"
                value={retention}
                options={RETENTION_OPTIONS}
                onChange={(next) => {
                  setRetention(next);
                  const label = RETENTION_OPTIONS.find((o) => o.value === next)?.label ?? next;
                  toast(`Records older than ${label.toLowerCase()} would be dropped after an export`);
                }}
              />
            </div>
            <p className="mt-3 text-[12.5px] leading-relaxed text-neutral-400">
              Export before the window closes.
            </p>
            <MerchantDisclosure label="What ages out, and what never does">
              <p>
                Keep the file somewhere this device is not the only copy.{" "}
                What ages out is the shop&rsquo;s own copy — the receipt lines, the staff name, the
                customer note. The payments themselves are on a public ledger and are permanent; a
                dropped record only means the shop can no longer say which coffee that payment was
                for.
              </p>
            </MerchantDisclosure>
          </div>
        </Section>

        {/* ---------------- audit trail ---------------- */}
        <Section title="Audit trail">
          <div className="list-group">
            {MOCK_EXPORTS.map((record, i) => (
              <div
                key={record.id}
                className={`flex w-full items-center gap-3.5 px-4 py-3.5 ${i > 0 ? "ios-sep" : ""}`}
              >
                <span className="mono flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#64D2FF] text-[8px] font-semibold text-white shadow-sm">
                  {FORMAT_BADGE[record.format]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15.5px] font-normal leading-tight text-white">
                    {record.rangeLabel}
                  </span>
                  <span className="mono block truncate text-[12px] leading-tight text-neutral-400">
                    {record.rowCount.toLocaleString("en-US")} rows · {record.runBy}
                  </span>
                </span>
                <span className="mono shrink-0 text-right text-[12px] text-neutral-400">
                  {fmtWhen(record.runAt)}
                </span>
              </div>
            ))}
          </div>
        </Section>

        {/* ---------------- what this is not ---------------- */}
        <Section title="What this is not">
          {/* The one full-width notice on this screen, and the only one it needs. */}
          <div className="space-y-1">
            <Notice>
              <span className="flex items-start gap-2.5">
                <IconInfo size={15} className="mt-[1px] shrink-0 text-neutral-400" />
                <span>
                  <span className="font-semibold text-white">
                    Bookkeeping support, not tax advice,{" "}
                  </span>
                  and not certified invoicing software.
                </span>
              </span>
            </Notice>

            <MerchantDisclosure label="What that means">
              <p>
                These figures are arithmetic over what this till rang up. What is due, what is
                deductible, when it is filed and under which scheme is a question for an accountant
                in the shop&rsquo;s own jurisdiction.
              </p>
              <p>
                <span className="font-semibold text-white">Portuguese fiscal certification.</span>{" "}
                Not implemented in this build. Issuing invoices in Portugal requires software
                certified by the Autoridade Tributária, an ATCUD and QR code on every document,
                sequential document series registered in advance, and periodic SAF-T submission.
                This app has none of it.
              </p>
              <p>
                The SAF-T shape offered above is a convenience for a bookkeeper who will re-key the
                numbers into certified software. It is not a filing, and nothing here should be read
                as a claim of certification.
              </p>
            </MerchantDisclosure>
          </div>
        </Section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

/**
 * A titled region. The subtitle is optional on purpose: most of these headings
 * used to be followed by a sentence that only restated them, and the facts that
 * were hiding in those sentences now sit in the body they belong to.
 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <h2 className="px-1 pb-2 text-[12px] font-semibold uppercase tracking-wider text-neutral-400">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Figure({
  label,
  value,
  tone = "plain",
}: {
  label: string;
  value: string;
  tone?: "plain" | "pos" | "neg";
}) {
  return (
    <div className="min-w-0 bg-[#1c1c1e] px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{label}</p>
      <p
        className={`mono mt-0.5 truncate text-[17px] font-semibold ${
          tone === "pos" ? "text-[#30D158]" : tone === "neg" ? "text-[#FF453A]" : "text-white"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
