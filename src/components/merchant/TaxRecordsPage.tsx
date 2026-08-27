"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useMerchant } from "@/hooks/useMerchant";
import { triggerHaptic } from "@/lib/haptics";
import { fmtMinor } from "@/lib/merchant/money";
import type { ExportRecord } from "@/lib/merchant/types";
import { IconCheck, IconDownload, IconLock } from "../icons";
import { useToast } from "../Toast";
import { Button, IOSBackButton, Modal, ModalHeader, Notice, Select } from "../ui";
import { MerchantDisclosure } from "./Disclosure";
import { IconBars, IconClock, IconInfo, IconPercent, IconReceipt } from "./icons";
import {
  SettingsCaption,
  SettingsRow,
  SettingsSection,
  SheetBody,
} from "./MerchantSettingsControls";

type ExportFormat = ExportRecord["format"];
type Basis = ExportRecord["basis"];
type TaxRecordsSheet =
  | "period"
  | "rates"
  | "export"
  | "archive"
  | "retention"
  | "history"
  | "compliance";

const FORMATS: { value: ExportFormat; name: string; body: string; disabled?: boolean }[] = [
  {
    value: "csv",
    name: "CSV",
    body: "One row per order line with the sale, net amount, tax rate, tax, staff, and terminal.",
  },
  {
    value: "json",
    name: "JSON — with ledger identity",
    body: "Adds transaction hashes, ledger sequences, and payer addresses for ledger verification.",
  },
  {
    value: "xero",
    name: "Xero — unavailable",
    body: "Xero needs an explicit, tested account and tax-code mapping.",
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

function retentionLabel(months: number | null | undefined): string {
  return (
    RETENTION_OPTIONS.find((option) => option.value === String(months ?? 0))?.label ??
    "Keep everything"
  );
}

export function TaxRecordsPage({ onBack }: { onBack: () => void }) {
  const {
    settings,
    catalogue,
    taxPeriods,
    exportRecords,
    updateSettings,
    previewReportExport,
    createReportExport,
    exportEncryptedArchive,
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
  const [from, setFrom] = useState(() => isoDay(currentMonth.from));
  const [to, setTo] = useState(() => isoDay(currentMonth.to - 1));
  const [preview, setPreview] = useState<string | null>(null);
  const [activeSheet, setActiveSheet] = useState<TaxRecordsSheet | null>(null);
  const basis: Basis = "transaction";

  const period = useMemo(
    () => taxPeriods.find((candidate) => candidate.id === periodId) ?? taxPeriods[0],
    [periodId, taxPeriods],
  );
  const selectedPeriodId = periodId || period?.id || "";

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
        const rate = settings.taxRates.find((candidate) => candidate.id === id);
        return { id, label: rate?.label ?? id, percent: rate?.percent ?? null, minor };
      })
      .sort((a, b) => b.minor - a.minor);
  }, [period, settings.taxRates]);

  const taxTotalMinor = taxRows.reduce((sum, row) => sum + row.minor, 0);
  const chosenFormat = FORMATS.find((candidate) => candidate.value === format);
  const retainedFor = retentionLabel(settings.recordRetentionMonths);

  function openSheet(sheet: TaxRecordsSheet) {
    triggerHaptic("selection");
    setActiveSheet(sheet);
  }

  function selectPeriod(next: string) {
    const selected = taxPeriods.find((candidate) => candidate.id === next);
    setPeriodId(next);
    setPreview(null);
    if (selected) {
      setFrom(isoDay(selected.from));
      setTo(isoDay(selected.to - 1));
    }
    setActiveSheet(null);
  }

  function reportInput() {
    const fromAt = dayStart(from);
    const toAt = nextDay(to);
    if (!Number.isFinite(fromAt) || !Number.isFinite(toAt) || fromAt >= toAt) {
      throw new Error("Choose a valid reporting date range.");
    }
    return { from: fromAt, to: toAt, basis, format };
  }

  async function handleExport() {
    try {
      triggerHaptic("medium");
      const { file } = await createReportExport(reportInput());
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

  async function handleEncryptedArchive() {
    const archive = await exportEncryptedArchive();
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
      <h1 className="display-h text-[32px] font-bold tracking-tight text-white">Tax records</h1>
      <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-neutral-400">
        Review the current period, prepare evidence files, and manage the records kept on this
        device.
      </p>

      <div data-tax-records-hub="true" className="mt-5">
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            <SettingsSection title="Current period">
              <div className="panel overflow-hidden">
                <SettingsRow
                  first
                  icon={<IconReceipt size={16} />}
                  tint="#0A84FF"
                  label="Reporting period"
                  sub={
                    period
                      ? `${period.orderCount} ${period.orderCount === 1 ? "order" : "orders"}`
                      : "No recorded periods"
                  }
                  value={period?.label ?? "Choose"}
                  chevron
                  opensDialog
                  onClick={() => openSheet("period")}
                />

                <div className="border-t border-white/[0.08] px-5 pb-5 pt-4">
                  <p className="text-[12px] font-medium text-neutral-400">Tax due</p>
                  <p className="mono mt-0.5 text-[34px] font-semibold tracking-tight text-white">
                    {fmtMinor(taxTotalMinor, currency)}
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-neutral-500">
                    Sum of stored line-level tax for this period.
                  </p>
                </div>

                {period ? (
                  <div className="grid grid-cols-2 gap-px bg-white/[0.08] sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
                    <Figure label="Gross" value={fmtMinor(period.grossMinor, currency)} />
                    <Figure label="Net" value={fmtMinor(period.netMinor, currency)} />
                    <Figure
                      label="Refunds"
                      value={fmtMinor(period.refundsMinor, currency)}
                      tone={period.refundsMinor > 0 ? "neg" : "plain"}
                    />
                    <Figure label="Orders" value={String(period.orderCount)} />
                  </div>
                ) : (
                  <EmptyState>No tax period exists on this device yet.</EmptyState>
                )}

                <div className="border-t border-white/[0.08]">
                  <p className="px-4 pb-1.5 pt-3.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                    Tax by rate
                  </p>
                  {taxRows.map((row, index) => {
                    const share = taxTotalMinor > 0 ? (row.minor / taxTotalMinor) * 100 : 0;
                    return (
                      <div
                        key={row.id}
                        className={`px-4 py-3 ${index > 0 ? "border-t border-white/[0.08]" : ""}`}
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="flex min-w-0 items-baseline gap-2">
                            <span className="truncate text-[15.5px] text-white">{row.label}</span>
                            <span className="mono shrink-0 text-[12px] text-neutral-400">
                              {row.percent === null ? row.id : `${row.percent} %`}
                            </span>
                          </span>
                          <span className="mono shrink-0 text-[14.5px] font-medium text-white">
                            {fmtMinor(row.minor, currency)}
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
                          <div
                            className="h-full rounded-full bg-[#5E5CE6]"
                            style={{ width: `${share}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                  {taxRows.length === 0 && (
                    <EmptyState>No taxable sales are recorded for this period.</EmptyState>
                  )}
                </div>
              </div>
            </SettingsSection>
          </div>

          <div className="space-y-6">
            <SettingsSection title="Records">
              <div className="list-group">
                <SettingsRow
                  first
                  icon={<IconPercent size={16} />}
                  tint="#BF5AF2"
                  label="Tax rates"
                  sub="Rates and catalogue mappings"
                  value={`${settings.taxRates.length}`}
                  chevron
                  opensDialog
                  onClick={() => openSheet("rates")}
                />
                <SettingsRow
                  icon={<IconDownload size={16} />}
                  tint="#30D158"
                  label="Export report"
                  sub={period?.label ?? "Choose a date range"}
                  value={format.toUpperCase()}
                  chevron
                  opensDialog
                  onClick={() => openSheet("export")}
                />
                <SettingsRow
                  icon={<IconLock size={16} />}
                  tint="#5E5CE6"
                  label="Encrypted archive"
                  sub="Complete retained merchant record"
                  chevron
                  opensDialog
                  onClick={() => openSheet("archive")}
                />
                <SettingsRow
                  icon={<IconClock size={16} />}
                  tint="#FF9F0A"
                  label="Retention"
                  sub="Records stored on this device"
                  value={retainedFor}
                  chevron
                  opensDialog
                  onClick={() => openSheet("retention")}
                />
                <SettingsRow
                  icon={<IconBars size={16} />}
                  tint="#64D2FF"
                  label="Export history"
                  sub="Files prepared on this device"
                  value={`${exportRecords.length}`}
                  chevron
                  opensDialog
                  onClick={() => openSheet("history")}
                />
              </div>
              <SettingsCaption>
                Report files are created locally. Nothing is uploaded to an accounting service.
              </SettingsCaption>
            </SettingsSection>

            <SettingsSection title="Information">
              <div className="list-group">
                <SettingsRow
                  first
                  icon={<IconInfo size={16} />}
                  tint="#8E8E93"
                  label="About tax records"
                  sub="Calculations, ledger evidence, and limitations"
                  chevron
                  opensDialog
                  onClick={() => openSheet("compliance")}
                />
              </div>
            </SettingsSection>
          </div>
        </div>
      </div>

      <div data-tax-records-sheets="true">
        <Modal
          open={activeSheet !== null}
          onClose={() => setActiveSheet(null)}
          wide={activeSheet === "export" || activeSheet === "history"}
        >
          {activeSheet === "period" && (
            <>
              <ModalHeader
                title="Reporting period"
                subtitle="Choose the period shown in Tax records"
                onClose={() => setActiveSheet(null)}
              />
              <SheetBody sheet="period">
                <SettingsSection title="Periods">
                  <div className="list-group">
                    {taxPeriods.map((candidate, index) => (
                      <SettingsRow
                        key={candidate.id}
                        first={index === 0}
                        icon={<IconReceipt size={16} />}
                        tint="#0A84FF"
                        label={candidate.label}
                        sub={`${candidate.orderCount} ${
                          candidate.orderCount === 1 ? "order" : "orders"
                        }`}
                        value={fmtMinor(
                          Object.values(candidate.taxByRate).reduce(
                            (sum, amount) => sum + amount,
                            0,
                          ),
                          currency,
                        )}
                        onClick={() => selectPeriod(candidate.id)}
                      >
                        {candidate.id === selectedPeriodId && (
                          <IconCheck size={17} className="shrink-0 text-[#0A84FF]" />
                        )}
                      </SettingsRow>
                    ))}
                    {taxPeriods.length === 0 && (
                      <EmptyState>No reporting periods are available yet.</EmptyState>
                    )}
                  </div>
                </SettingsSection>
              </SheetBody>
            </>
          )}

          {activeSheet === "rates" && (
            <>
              <ModalHeader
                title="Tax rates"
                subtitle="Read-only rates and catalogue mappings"
                onClose={() => setActiveSheet(null)}
              />
              <SheetBody sheet="rates">
                <SettingsSection title="Configured rates">
                  <div className="list-group">
                    {settings.taxRates.map((rate, index) => {
                      const entry = mapped.get(rate.id);
                      const mapping = entry?.categories.length
                        ? `${entry.categories.join(" · ")} · ${entry.items} ${
                            entry.items === 1 ? "item" : "items"
                          }`
                        : "No catalogue items use this rate";
                      return (
                        <SettingsRow
                          key={rate.id}
                          first={index === 0}
                          icon={<IconPercent size={16} />}
                          tint="#BF5AF2"
                          label={rate.label}
                          sub={mapping}
                          value={`${rate.percent} %`}
                        >
                          {rate.id === settings.defaultTaxRateId && (
                            <span className="shrink-0 rounded-md bg-[#0A84FF]/15 px-2 py-1 text-[10px] font-semibold text-[#64D2FF]">
                              Default
                            </span>
                          )}
                        </SettingsRow>
                      );
                    })}
                  </div>
                  <SettingsCaption>
                    Prices are {settings.taxMode === "inclusive" ? "tax inclusive" : "tax added"}.
                    Edit rates from Merchant Settings.
                  </SettingsCaption>
                </SettingsSection>
              </SheetBody>
            </>
          )}

          {activeSheet === "export" && (
            <>
              <ModalHeader
                title="Export report"
                subtitle="Prepare a local evidence file"
                onClose={() => setActiveSheet(null)}
              />
              <SheetBody sheet="export">
                <SettingsSection title="File">
                  <div className="panel space-y-4 p-4">
                    <div>
                      <p className="field-label">Format</p>
                      <Select
                        ariaLabel="Export format"
                        value={format}
                        options={FORMATS.map((candidate) => ({
                          value: candidate.value,
                          label: candidate.name,
                          disabled: candidate.disabled,
                        }))}
                        onChange={(next) => {
                          setFormat(next as ExportFormat);
                          setPreview(null);
                        }}
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
                          onChange={(event) => {
                            setFrom(event.target.value);
                            setPreview(null);
                          }}
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
                          onChange={(event) => {
                            setTo(event.target.value);
                            setPreview(null);
                          }}
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
                      <MerchantDisclosure label="Why settlement is unavailable">
                        <p>
                          Settlement reporting needs recorded conversion batches and execution
                          rates. Offering it without those records would invent an accounting fact.
                        </p>
                      </MerchantDisclosure>
                    </div>
                  </div>
                </SettingsSection>

                <div className="grid gap-2 sm:grid-cols-2">
                  <Button onClick={handleExport} className="w-full">
                    <IconDownload size={15} />
                    Export file
                  </Button>
                  <Button variant="secondary" onClick={handlePreview} className="w-full">
                    Preview rows
                  </Button>
                </div>

                {preview && (
                  <div>
                    <p className="field-label">File preview</p>
                    <pre className="scrollbar-none max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-white/[0.08] bg-black/30 p-3 text-[11px] leading-relaxed text-neutral-300">
                      {preview}
                    </pre>
                  </div>
                )}
              </SheetBody>
            </>
          )}

          {activeSheet === "archive" && (
            <>
              <ModalHeader
                title="Encrypted archive"
                subtitle="A portable encrypted merchant record set"
                onClose={() => setActiveSheet(null)}
              />
              <SheetBody sheet="archive">
                <Notice>
                  <span className="flex items-start gap-2.5">
                    <IconLock size={15} className="mt-[1px] shrink-0 text-[#5E5CE6]" />
                    <span>
                      The archive contains retained merchant records encrypted with this
                      vault&rsquo;s vault-specific merchant key.
                    </span>
                  </span>
                </Notice>
                <SettingsSection title="Keep it safe">
                  <div className="list-group">
                    <SettingsRow
                      first
                      icon={<IconReceipt size={16} />}
                      tint="#0A84FF"
                      label="Operational records"
                      sub="Orders, receipts, staff audit, customers, and settings"
                    />
                    <SettingsRow
                      icon={<IconLock size={16} />}
                      tint="#5E5CE6"
                      label="Encrypted locally"
                      sub="Restorable only alongside the matching encrypted wallet backup"
                    />
                  </div>
                  <SettingsCaption>
                    This file does not restore a wallet on its own. Keep a full encrypted wallet
                    backup as the recovery copy; it already includes these merchant records.
                  </SettingsCaption>
                </SettingsSection>
                <Button className="w-full" onClick={() => void handleEncryptedArchive()}>
                  <IconDownload size={15} />
                  Download encrypted archive
                </Button>
              </SheetBody>
            </>
          )}

          {activeSheet === "retention" && (
            <>
              <ModalHeader
                title="Retention"
                subtitle="How long merchant records stay on this device"
                onClose={() => setActiveSheet(null)}
              />
              <SheetBody sheet="retention">
                <SettingsSection title="Keep records for">
                  <div className="panel p-4">
                    <Select
                      ariaLabel="How long records are kept on this device"
                      value={String(settings.recordRetentionMonths ?? 0)}
                      options={RETENTION_OPTIONS}
                      onChange={(next) => {
                        updateSettings({
                          recordRetentionMonths: next === "0" ? null : Number(next),
                        });
                        const label =
                          RETENTION_OPTIONS.find((option) => option.value === next)?.label ?? next;
                        toast(`Record retention set to ${label.toLowerCase()}`, "success");
                      }}
                    />
                  </div>
                  <SettingsCaption>
                    Export before the window closes. Payments remain on the public ledger, but an
                    aged-out local record can no longer explain what a payment purchased.
                  </SettingsCaption>
                </SettingsSection>
                <Notice>
                  Retention can remove receipt lines, staff names, and customer notes. It never
                  removes a payment from the Stellar ledger.
                </Notice>
              </SheetBody>
            </>
          )}

          {activeSheet === "history" && (
            <>
              <ModalHeader
                title="Export history"
                subtitle="Reports prepared on this device"
                onClose={() => setActiveSheet(null)}
              />
              <SheetBody sheet="history">
                <SettingsSection title="Recent exports">
                  <div className="list-group">
                    {exportRecords.map((record, index) => (
                      <SettingsRow
                        key={record.id}
                        first={index === 0}
                        icon={
                          <span className="mono text-[8px] font-semibold">
                            {FORMAT_BADGE[record.format]}
                          </span>
                        }
                        tint="#64D2FF"
                        label={record.rangeLabel}
                        sub={`${record.rowCount.toLocaleString("en-US")} rows · ${record.runBy}`}
                        value={fmtWhen(record.runAt)}
                      />
                    ))}
                    {exportRecords.length === 0 && (
                      <EmptyState>No exports have been prepared on this device.</EmptyState>
                    )}
                  </div>
                </SettingsSection>
              </SheetBody>
            </>
          )}

          {activeSheet === "compliance" && (
            <>
              <ModalHeader
                title="About tax records"
                subtitle="What these figures can and cannot prove"
                onClose={() => setActiveSheet(null)}
              />
              <SheetBody sheet="compliance">
                <Notice>
                  <span className="font-semibold text-white">Bookkeeping support, not tax advice</span>
                  , and not certified invoicing software.
                </Notice>
                <div className="space-y-4 text-[13px] leading-relaxed text-neutral-300">
                  <p>
                    A period contains orders rung up between two dates. Tax is summed per line at
                    that line&rsquo;s rate, and a refund is subtracted from the period when paid.
                  </p>
                  <p>
                    JSON exports can include the transaction hash and ledger sequence behind a
                    payment. CSV and JSON are local evidence files for a bookkeeper; they are not
                    filings and make no certification claim.
                  </p>
                  <p>
                    What is due, deductible, or reportable depends on the merchant&rsquo;s
                    jurisdiction and should be confirmed with an accountant.
                  </p>
                  <p>
                    Portuguese fiscal certification is not implemented. SAF-T remains disabled
                    because this app does not issue certified fiscal documents.
                  </p>
                </div>
              </SheetBody>
            </>
          )}
        </Modal>
      </div>
    </div>
  );
}

function Figure({
  label,
  value,
  tone = "plain",
}: {
  label: string;
  value: string;
  tone?: "plain" | "neg";
}) {
  return (
    <div className="min-w-0 bg-[#1c1c1e] px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{label}</p>
      <p
        className={`mono mt-0.5 truncate text-[16px] font-semibold ${
          tone === "neg" ? "text-[#FF453A]" : "text-white"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-center text-[13px] text-neutral-400">{children}</p>;
}
