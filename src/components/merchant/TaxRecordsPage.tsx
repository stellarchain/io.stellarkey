"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useMerchant } from "@/hooks/useMerchant";
import { triggerHaptic } from "@/lib/haptics";
import { fmtMinor } from "@/lib/merchant/money";
import { exportEncryptedMerchantArchive } from "@/lib/merchant/storage";
import type { ExportRecord } from "@/lib/merchant/types";
import { useToast } from "../Toast";
import { Button, IOSBackButton, Notice, Select } from "../ui";
import { IconDownload } from "../icons";
import { IconInfo, IconPercent } from "./icons";
import { MerchantDisclosure } from "./Disclosure";

type ExportFormat = ExportRecord["format"];
type Basis = ExportRecord["basis"];

/** Said once, then reused by the chip and the disclosure beside it. */

const FORMATS: { value: ExportFormat; name: string; body: string; disabled?: boolean }[] = [
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
    name: "Xero — unavailable",
    body: "Xero needs an explicit, tested account and tax-code mapping. This build does not claim that schema.",
    disabled: true,
  },
  {
    value: "saft",
    name: "SAF-T (PT) — unavailable",
    body: "SAF-T is disabled because this app is not certified Portuguese invoicing software.",
    disabled: true,
  },
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

function dayStart(value: string): number {
  return Date.parse(`${value}T00:00:00.000Z`);
}

function nextDay(value: string): number {
  return dayStart(value) + 24 * 60 * 60 * 1000;
}

function fmtWhen(ts: number): string {
  return new Date(ts).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function TaxRecordsPage({ onBack }: { onBack: () => void }) {
  const {
    settings,
    catalogue,
    taxPeriods,
    exportRecords,
    updateSettings,
    previewReportExport,
    createReportExport,
  } = useMerchant();
  const { toast } = useToast();
  const currency = settings.currency;

  const currentMonth = useMemo(() => {
    const now = new Date();
    const from = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const to = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
    return { from, to };
  }, []);
  const [periodId, setPeriodId] = useState("");
  const [format, setFormat] = useState<ExportFormat>("csv");
  const basis: Basis = "transaction";
  const [from, setFrom] = useState(() => isoDay(currentMonth.from));
  const [to, setTo] = useState(() => isoDay(currentMonth.to - 1));
  const [preview, setPreview] = useState<string | null>(null);

  const period = useMemo(
    () => taxPeriods.find((p) => p.id === periodId) ?? taxPeriods[0],
    [periodId, taxPeriods],
  );
  const selectedPeriodId = periodId || period?.id || "";

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
  const periodOptions = taxPeriods.map((p) => ({
    value: p.id,
    label: p.label,
    sublabel: `${p.orderCount} orders`,
  }));

  const chosenFormat = FORMATS.find((f) => f.value === format);

  function reportInput() {
    const fromAt = dayStart(from);
    const toAt = nextDay(to);
    if (!Number.isFinite(fromAt) || !Number.isFinite(toAt) || fromAt >= toAt) {
      throw new Error("Choose a valid reporting date range.");
    }
    return { from: fromAt, to: toAt, basis, format };
  }

  function handleExport() {
    try {
      triggerHaptic("medium");
      const { file } = createReportExport(reportInput());
      const blob = new Blob([file.contents], { type: file.mimeType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.fileName;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      toast(`${file.rowCount.toLocaleString("en-US")} rows exported`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "The export could not be created.");
    }
  }

  function handleEncryptedArchive() {
    const archive = exportEncryptedMerchantArchive();
    if (!archive) {
      toast("No encrypted merchant archive is available yet.", "error");
      return;
    }
    const url = URL.createObjectURL(new Blob([archive], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `merchant-archive-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    toast("Encrypted merchant archive downloaded", "success");
  }

  function handlePreview() {
    try {
      triggerHaptic("selection");
      const file = previewReportExport(reportInput());
      setPreview(file.contents.replace(/^\uFEFF/, "").slice(0, 5000));
      toast(`${file.rowCount.toLocaleString("en-US")} rows ready to preview`, "success");
    } catch (error) {
      toast(error instanceof Error ? error.message : "The preview could not be created.");
    }
  }

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
                value={selectedPeriodId}
                options={periodOptions}
                onChange={(next) => {
                  setPeriodId(next);
                  const selected = taxPeriods.find((candidate) => candidate.id === next);
                  if (selected) {
                    setFrom(isoDay(selected.from));
                    setTo(isoDay(selected.to - 1));
                  }
                }}
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
                options={FORMATS.map((f) => ({
                  value: f.value,
                  label: f.name,
                  disabled: f.disabled,
                }))}
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
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="Export basis">
                <button
                  type="button"
                  aria-pressed="true"
                  className="min-h-11 rounded-xl border border-[#0A84FF]/50 bg-[#0A84FF]/15 px-3 text-[13px] font-semibold text-[#64D2FF]"
                >
                  Transaction date
                </button>
                <button
                  type="button"
                  disabled
                  className="min-h-11 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-[13px] font-semibold text-neutral-500 disabled:cursor-not-allowed"
                >
                  Settlement unavailable
                </button>
              </div>
              <p className="mt-2 text-[12.5px] leading-relaxed text-neutral-400">
                Orders use the immutable shop-currency value quoted when the sale was rung up.
              </p>
              <MerchantDisclosure label="Why the basis changes the numbers">
                <p>
                  Settlement-rate reporting stays unavailable until conversion batches and their
                  execution rates are recorded. Offering it now would invent an accounting fact.
                </p>
              </MerchantDisclosure>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={handleExport}
              >
                <IconDownload size={15} />
                Export
              </Button>
              <Button
                variant="secondary"
                onClick={handlePreview}
              >
                Preview rows
              </Button>
              <Button variant="secondary" onClick={handleEncryptedArchive}>
                <IconDownload size={15} />
                Encrypted archive
              </Button>
            </div>
            <p className="text-[12px] leading-relaxed text-neutral-500">
              The archive contains the complete retained merchant record encrypted with this
              wallet&rsquo;s password-derived key. Keep it with your wallet backup.
            </p>
            {preview && (
              <div>
                <p className="field-label">File preview</p>
                <pre className="scrollbar-none max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-white/[0.08] bg-black/30 p-3 text-[11px] leading-relaxed text-neutral-300">
                  {preview}
                </pre>
              </div>
            )}
          </div>
        </Section>

        {/* ---------------- retention ---------------- */}
        <Section title="Retention">
          <div className="panel p-4">
            <div className="sm:max-w-[280px]">
              <Select
                ariaLabel="How long records are kept on this device"
                value={String(settings.recordRetentionMonths ?? 0)}
                options={RETENTION_OPTIONS}
                onChange={(next) => {
                  updateSettings({ recordRetentionMonths: next === "0" ? null : Number(next) });
                  const label = RETENTION_OPTIONS.find((o) => o.value === next)?.label ?? next;
                  toast(`Record retention set to ${label.toLowerCase()}`, "success");
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
            {exportRecords.map((record, i) => (
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
            {exportRecords.length === 0 && (
              <p className="px-4 py-6 text-center text-[13px] text-neutral-400">
                No exports have been run on this device.
              </p>
            )}
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
                SAF-T remains disabled. CSV and JSON are local evidence files for a bookkeeper; they
                are not filings and make no certification claim.
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
