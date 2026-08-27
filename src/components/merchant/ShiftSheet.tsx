"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useMerchant } from "@/hooks/useMerchant";
import { FIAT_SYMBOLS, type FiatCurrency } from "@/lib/format";
import { triggerHaptic } from "@/lib/haptics";
import { fmtMinor, toMinor } from "@/lib/merchant/money";
import type { Adjustment, AdjustmentKind, Minor, ShiftReport, TaxRate } from "@/lib/merchant/types";
import { useToast } from "../Toast";
import { Avatar, Button, Modal, ModalHeader, Notice } from "../ui";
import {
  IconAlert,
  IconArrowDownLeft,
  IconArrowUpRight,
  IconCheck,
  IconDownload,
  IconSend,
  IconUsers,
} from "../icons";
import {
  IconPercent,
  IconPrinter,
  IconQr,
  IconReceipt,
  IconRefund,
  IconTerminal,
} from "./icons";

type Step = "overview" | "count" | "report";

const ADJUSTMENT_LABEL: Record<AdjustmentKind, string> = {
  discount: "Discount",
  comp: "Comp",
  void: "Void",
};
const ADJUSTMENT_TONE: Record<AdjustmentKind, string> = {
  discount: "text-[#BF5AF2] bg-[#BF5AF2]/15",
  comp: "text-[#FF9F0A] bg-[#FF9F0A]/15",
  void: "text-neutral-400 bg-white/[0.08]",
};

function fmtClock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDateTime(at: number): string {
  return new Date(at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function parseAmount(text: string): Minor | null {
  const cleaned = text.trim().replace(/,/g, "");
  if (!cleaned) return null;
  try {
    const minor = toMinor(cleaned);
    return minor >= 0 ? minor : null;
  } catch {
    return null;
  }
}

function taxRows(report: ShiftReport, rates: TaxRate[]) {
  return Object.entries(report.taxByRate).map(([id, minor]) => {
    const rate = rates.find((entry) => entry.id === id);
    return { id, label: rate ? `${rate.label} · ${rate.percent} %` : id, minor };
  });
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function reportCsv(report: ShiftReport): string {
  const rows: Array<Array<string | number>> = [
    ["Report", report.kind.toUpperCase()],
    ["Z sequence", report.sequence],
    ["Shift ID", report.shiftId],
    ["Terminal", report.terminalName],
    ["Network", report.network],
    ["Opened", new Date(report.openedAt).toISOString()],
    ["Generated", new Date(report.generatedAt).toISOString()],
    ["Opened by", report.openedBy],
    ["Closed by", report.closedBy ?? ""],
    ["Opening float minor", report.floatMinor],
    ["Gross minor", report.grossMinor],
    ["Refunds minor", report.refundsMinor],
    ["Tips minor", report.tipsMinor],
    ["Discounts minor", report.discountsMinor],
    ["Comps minor", report.compsMinor],
    ["Voids minor", report.voidsMinor],
    ["Orders", report.orderCount],
    ["Cash tender minor", report.tenderByKind.cash],
    ["Card tender minor", report.tenderByKind.card],
    ["Crypto tender minor", report.tenderByKind.crypto],
    ["Expected cash minor", report.expectedCashMinor],
    ["Counted cash minor", report.cash?.countedMinor ?? ""],
    ["Cash variance minor", report.cash?.varianceMinor ?? ""],
    [],
    ["Tax rate", "Minor"],
    ...Object.entries(report.taxByRate),
    [],
    ["Staff ID", "Staff", "Orders", "Takings minor", "Tips minor"],
    ...report.staffTotals.map((line) => [
      line.staffId ?? "",
      line.staffName,
      line.orderCount,
      line.takingsMinor,
      line.tipsMinor,
    ]),
    [],
    ["Adjustment ID", "Kind", "Order", "Reason", "Staff", "Minor", "At"],
    ...report.adjustments.map((adjustment) => [
      adjustment.id,
      adjustment.kind,
      adjustment.orderNumber,
      adjustment.reasonCode,
      adjustment.staffName,
      adjustment.amountMinor,
      new Date(adjustment.at).toISOString(),
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function downloadReport(report: ShiftReport): void {
  const url = URL.createObjectURL(new Blob([reportCsv(report)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${report.kind}-report-${report.sequence}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function emailReport(report: ShiftReport, currency: FiatCurrency): void {
  const subject = `${report.kind.toUpperCase()} report ${report.sequence} · ${report.terminalName}`;
  const body = [
    subject,
    `Opened: ${fmtDateTime(report.openedAt)} by ${report.openedBy}`,
    `Generated: ${fmtDateTime(report.generatedAt)}`,
    `Orders: ${report.orderCount}`,
    `Gross: ${fmtMinor(report.grossMinor, currency)}`,
    `Refunds: ${fmtMinor(report.refundsMinor, currency)}`,
    `Takings after refunds: ${fmtMinor(report.grossMinor - report.refundsMinor, currency)}`,
    report.cash
      ? `Cash variance: ${fmtMinor(report.cash.varianceMinor, currency)}`
      : "Cash remains hidden until the closing count.",
  ].join("\n");
  window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function ShiftSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <Modal open onClose={onClose} wide>
      <ShiftBody onClose={onClose} />
    </Modal>
  );
}

function ShiftBody({ onClose }: { onClose: () => void }) {
  const {
    settings,
    activeStaff,
    activeShift,
    shiftReport,
    shiftBlockers,
    openShift,
    closeShift,
  } = useMerchant();
  const { toast } = useToast();
  const currency = settings.currency;
  const [step, setStep] = useState<Step>(activeShift ? "overview" : "count");
  const [opening, setOpening] = useState(!activeShift);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [zReport, setZReport] = useState<ShiftReport | null>(null);
  const report = zReport ?? shiftReport;
  const rates = useMemo(() => (report ? taxRows(report, settings.taxRates) : []), [report, settings.taxRates]);
  const taxTotal = rates.reduce((sum, rate) => sum + rate.minor, 0);
  const canSeeReports = Boolean(activeStaff?.permissions.seeReports);
  const canExport = Boolean(activeStaff?.permissions.exportRecords);
  const canOperateShift = Boolean(activeStaff?.permissions.openDrawer);

  async function submitOpen() {
    const floatMinor = parseAmount(draft);
    if (floatMinor === null) return;
    try {
      const shift = await openShift(floatMinor);
      triggerHaptic("success");
      toast(`Shift ${shift.number} opened on ${shift.terminalName}.`, "success");
      setOpening(false);
      setStep("overview");
      setDraft("");
      setError(null);
    } catch (caught) {
      triggerHaptic("error");
      setError(caught instanceof Error ? caught.message : "The shift could not be opened.");
    }
  }

  async function submitClose() {
    const countedMinor = parseAmount(draft);
    if (countedMinor === null) return;
    try {
      const closed = await closeShift(countedMinor);
      triggerHaptic("success");
      setZReport(closed);
      setStep("report");
      setDraft("");
      setError(null);
      toast(`Shift ${closed.sequence} closed. Z-${closed.sequence} is now immutable.`, "success");
    } catch (caught) {
      triggerHaptic("error");
      setError(caught instanceof Error ? caught.message : "The shift could not be closed.");
    }
  }

  if (opening && !activeShift && !zReport) {
    const amount = parseAmount(draft);
    return (
      <>
        <ModalHeader title="Open shift" subtitle={`${settings.terminalName} · next Z-report starts here`} onClose={onClose} />
        <div className="space-y-4 p-4 sm:p-5">
          <Notice>
            <p className="font-semibold text-white">A clean operating boundary</p>
            <p className="mt-1">
              Sales, refunds, tender totals, and adjustments are derived from records created while
              this shift is open. The float is counted separately from takings.
            </p>
          </Notice>
          <div className="panel-inset flex items-center gap-3 px-4 py-3.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#0A84FF]/15 text-[#0A84FF]">
              <IconTerminal size={19} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-semibold text-white">{settings.terminalName}</span>
              <span className="block truncate text-[12px] text-neutral-500">
                {activeStaff ? `Opening operator · ${activeStaff.name}` : "Choose an operator first"}
              </span>
            </span>
          </div>
          <AmountInput
            id="opening-float"
            label="Opening float"
            value={draft}
            currency={currency}
            hint="Notes and coin placed in the drawer before the first sale. Enter zero for a cashless till."
            onChange={(value) => {
              setDraft(value);
              setError(null);
            }}
            onEnter={submitOpen}
          />
          {error && <Notice tone="warn">{error}</Notice>}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="secondary" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={amount === null || !canOperateShift}
              onClick={submitOpen}
            >
              Open shift
            </Button>
          </div>
        </div>
      </>
    );
  }

  if (!report) {
    return (
      <>
        <ModalHeader title="Shift" subtitle={settings.terminalName} onClose={onClose} />
        <div className="p-5">
          <Notice tone="warn">
            The shift record could not be read. Close this sheet and try again.
          </Notice>
        </div>
      </>
    );
  }

  const afterRefunds = report.grossMinor - report.refundsMinor;
  const title =
    step === "count"
      ? "Blind cash count"
      : step === "report"
        ? `${report.kind.toUpperCase()}-report ${report.sequence}`
        : `Shift ${report.sequence}`;
  const subtitle =
    report.kind === "z"
      ? `Closed ${fmtClock(report.generatedAt)} · ${report.closedBy}`
      : `Open since ${fmtClock(report.openedAt)} · ${report.openedBy}`;

  return (
    <>
      <ModalHeader title={title} subtitle={subtitle} onClose={onClose} />
      <div className="space-y-4 p-4 sm:p-5">
        {step === "overview" && (
          <>
            <div className="panel-inset grid grid-cols-2 gap-px overflow-hidden">
              <Cell label="Opened" value={fmtClock(report.openedAt)} sub={report.openedBy} />
              <Cell label="Float" value={fmtMinor(report.floatMinor, currency)} sub="Declared at open" />
              <Cell label="Orders" value={String(report.orderCount)} sub="Settled this shift" />
              <Cell
                label="Takings"
                value={canSeeReports ? fmtMinor(afterRefunds, currency) : "Restricted"}
                sub={canSeeReports ? "Gross less refunds" : "Report permission required"}
                tone={canSeeReports ? "pos" : "plain"}
              />
            </div>
            {canSeeReports ? (
              <>
                <TotalsBlock report={report} currency={currency} />
                <TaxBlock rows={rates} total={taxTotal} currency={currency} />
              </>
            ) : (
              <Notice>
                <p className="font-semibold text-white">Running totals are restricted</p>
                <p className="mt-1">
                  A manager can take an X-reading without closing this shift.
                </p>
              </Notice>
            )}
            <Notice>
              <p className="font-semibold text-white">Cash stays blind</p>
              <p className="mt-1">
                The expected drawer figure remains hidden until the closing count is committed.
              </p>
            </Notice>
            {shiftBlockers.length > 0 ? (
              <section
                aria-labelledby="shift-blocker-title"
                className="overflow-hidden rounded-[20px] ring-1 ring-inset ring-[#FF9F0A]/30"
              >
                <div className="bg-[#FF9F0A]/[0.07]">
                  <div className="flex items-start gap-3 px-4 pb-3 pt-4">
                    <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-[#FF9F0A]/15 text-[#FF9F0A]">
                      <IconAlert size={17} />
                    </span>
                    <div className="min-w-0">
                      <h3
                        id="shift-blocker-title"
                        className="text-[15.5px] font-semibold text-white"
                      >
                        Close blocked
                      </h3>
                      <p className="mt-0.5 text-[12.5px] leading-relaxed text-neutral-400">
                        Resolve every pending payment, refund, and approval before counting the
                        drawer.
                      </p>
                    </div>
                  </div>
                  {shiftBlockers.map((flow) => (
                    <div
                      key={`${flow.kind}:${flow.id}`}
                      className="border-t border-[#FF9F0A]/20 px-4 py-3 text-[13px] text-neutral-300"
                    >
                      {flow.label}
                    </div>
                  ))}
                </div>
              </section>
            ) : (
              <p className="flex items-center gap-2 px-1 text-[12.5px] text-[#30D158]">
                <IconCheck size={12} /> No unresolved tender flow — ready for a blind close.
              </p>
            )}
            {error && <Notice tone="warn">{error}</Notice>}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="secondary"
                className="flex-1"
                disabled={!canSeeReports}
                onClick={() => {
                  triggerHaptic("selection");
                  setStep("report");
                }}
              >
                X-report
              </Button>
              <Button
                className="flex-1"
                disabled={shiftBlockers.length > 0 || !canOperateShift}
                aria-describedby={shiftBlockers.length > 0 ? "shift-blocker-title" : undefined}
                onClick={() => {
                  triggerHaptic("medium");
                  setDraft("");
                  setError(null);
                  setStep("count");
                }}
              >
                Count drawer & close
              </Button>
            </div>
          </>
        )}

        {step === "count" && (
          <>
            <Notice tone="warn">
              <p className="font-semibold text-white">Count first, compare after</p>
              <p className="mt-1">
                The expected figure is deliberately absent. Committing this count closes the shift
                and writes the final Z-report in one durable operation.
              </p>
            </Notice>
            <AmountInput
              id="shift-count"
              label="What is in the drawer"
              value={draft}
              currency={currency}
              hint="Notes and coin together, including the opening float."
              onChange={(value) => {
                setDraft(value);
                setError(null);
              }}
              onEnter={submitClose}
            />
            {error && <Notice tone="warn">{error}</Notice>}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => {
                  setDraft("");
                  setError(null);
                  setStep("overview");
                }}
              >
                Back to shift
              </Button>
              <Button
                className="flex-1"
                disabled={parseAmount(draft) === null}
                onClick={submitClose}
              >
                Commit count & issue Z
              </Button>
            </div>
          </>
        )}

        {step === "report" && (
          <>
            {report.kind === "x" ? (
              <Notice>
                <p className="font-semibold text-white">Live reading only</p>
                <p className="mt-1">
                  This X-report reflects persisted records through {fmtClock(report.generatedAt)}.
                  The shift stays open and its totals keep running.
                </p>
              </Notice>
            ) : (
              <Notice tone="pos">
                <p className="font-semibold text-white">
                  Z-{report.sequence} issued · shift closed {fmtClock(report.generatedAt)}
                </p>
                <p className="mt-1">Sequential, persisted, and immutable.</p>
              </Notice>
            )}
            {report.kind === "z" && report.cash && (
              <>
                <div className="panel-inset grid grid-cols-2 gap-px overflow-hidden">
                  <Cell
                    label="Expected"
                    value={fmtMinor(report.cash.expectedMinor, currency)}
                    sub="Float plus cash tender"
                  />
                  <Cell
                    label="Counted"
                    value={fmtMinor(report.cash.countedMinor, currency)}
                    sub={fmtDateTime(report.generatedAt)}
                  />
                </div>
                <VarianceCard
                  counted={report.cash.countedMinor}
                  expected={report.cash.expectedMinor}
                  currency={currency}
                />
              </>
            )}
            {canSeeReports ? (
              <>
                <TotalsBlock report={report} currency={currency} />
                <TaxBlock rows={rates} total={taxTotal} currency={currency} />
                <Block title="Tender" icon={<IconQr size={13} />}>
                  <Line
                    label="On-chain"
                    value={fmtMinor(report.tenderByKind.crypto, currency)}
                    first
                  />
                  <Line
                    label="External card"
                    value={fmtMinor(report.tenderByKind.card, currency)}
                  />
                  {report.kind === "x" ? (
                    <Line label="Cash" value="Held until closing count" muted />
                  ) : (
                    <Line
                      label="Cash"
                      value={fmtMinor(report.tenderByKind.cash, currency)}
                    />
                  )}
                </Block>
                <StaffBlock report={report} currency={currency} />
                <AdjustmentBlock report={report} currency={currency} />
              </>
            ) : (
              <Notice>
                Detailed totals require report permission. The closing count is still recorded.
              </Notice>
            )}
            {canSeeReports && (
              <div className="grid grid-cols-3 gap-2">
                <ReportAction
                  icon={<IconPrinter size={15} />}
                  label="Print"
                  onClick={() => window.print()}
                />
                <ReportAction
                  icon={<IconSend size={15} />}
                  label="Email"
                  onClick={() => emailReport(report, currency)}
                />
                <ReportAction
                  icon={<IconDownload size={15} />}
                  label="Export"
                  disabled={!canExport}
                  onClick={() => downloadReport(report)}
                />
              </div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              {report.kind === "x" && (
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => setStep("overview")}
                >
                  Back to shift
                </Button>
              )}
              <Button className="flex-1" onClick={onClose}>
                Done
              </Button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function AmountInput({
  id,
  label,
  value,
  currency,
  hint,
  onChange,
  onEnter,
}: {
  id: string;
  label: string;
  value: string;
  currency: FiatCurrency;
  hint: string;
  onChange: (value: string) => void;
  onEnter: () => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <span className="mono shrink-0 text-[17px] font-semibold text-neutral-400">
          {FIAT_SYMBOLS[currency]}
        </span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          placeholder="0.00"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onEnter();
          }}
          className="input mono text-base sm:text-[17px]"
          autoFocus
        />
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-neutral-500">{hint}</p>
    </div>
  );
}

function TotalsBlock({ report, currency }: { report: ShiftReport; currency: FiatCurrency }) {
  return (
    <Block title="Totals" icon={<IconReceipt size={13} />}>
      <Line
        label="Gross takings"
        value={fmtMinor(report.grossMinor, currency)}
        tone="pos"
        first
      />
      <Line
        label="Refunds"
        value={`-${fmtMinor(report.refundsMinor, currency)}`}
        tone="neg"
      />
      <Line label="Tips" value={fmtMinor(report.tipsMinor, currency)} />
      <Line label="Discounts" value={`-${fmtMinor(report.discountsMinor, currency)}`} />
      <Line label="Comps" value={`-${fmtMinor(report.compsMinor, currency)}`} />
      <Line label="Voids" value={`-${fmtMinor(report.voidsMinor, currency)}`} />
      <Line label="Orders" value={String(report.orderCount)} />
      <Line
        label="Takings after refunds"
        value={fmtMinor(report.grossMinor - report.refundsMinor, currency)}
        strong
      />
    </Block>
  );
}

function TaxBlock({
  rows,
  total,
  currency,
}: {
  rows: ReturnType<typeof taxRows>;
  total: Minor;
  currency: FiatCurrency;
}) {
  return (
    <Block title="Tax by rate" icon={<IconPercent size={13} />}>
      {rows.length === 0 ? (
        <EmptyLine>No tax collected in this shift.</EmptyLine>
      ) : (
        rows.map((rate, index) => (
          <Line
            key={rate.id}
            label={rate.label}
            value={fmtMinor(rate.minor, currency)}
            first={index === 0}
          />
        ))
      )}
      {rows.length > 0 && (
        <Line label="Total tax" value={fmtMinor(total, currency)} strong />
      )}
    </Block>
  );
}

function StaffBlock({ report, currency }: { report: ShiftReport; currency: FiatCurrency }) {
  return (
    <Block title="By staff" icon={<IconUsers size={13} />}>
      {report.staffTotals.length === 0 ? (
        <EmptyLine>No settled orders in this shift.</EmptyLine>
      ) : (
        report.staffTotals.map((line, index) => (
          <div
            key={line.staffId ?? `${line.staffName}:${index}`}
            className={`flex items-center gap-3 px-3.5 py-2.5 ${
              index === 0 ? "" : "border-t border-white/[0.08]"
            }`}
          >
            <Avatar seed={line.staffName} size={28} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium text-white">
                {line.staffName}
              </span>
              <span className="block text-[11.5px] text-neutral-500">
                {line.orderCount} orders · {fmtMinor(line.tipsMinor, currency)} tips
              </span>
            </span>
            <span className="mono shrink-0 text-[14px] font-semibold text-white">
              {fmtMinor(line.takingsMinor, currency)}
            </span>
          </div>
        ))
      )}
    </Block>
  );
}

function AdjustmentBlock({
  report,
  currency,
}: {
  report: ShiftReport;
  currency: FiatCurrency;
}) {
  return (
    <Block title="Adjustments" icon={<IconRefund size={13} />}>
      {report.adjustments.length === 0 ? (
        <EmptyLine>No discount, comp, or void adjustments.</EmptyLine>
      ) : (
        report.adjustments.map((adjustment, index) => (
          <AdjustmentRow
            key={adjustment.id}
            adjustment={adjustment}
            currency={currency}
            first={index === 0}
          />
        ))
      )}
    </Block>
  );
}

function Cell({
  label,
  value,
  sub,
  tone = "plain",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "plain" | "pos";
}) {
  return (
    <div className="bg-white/[0.02] px-3.5 py-3">
      <p className="text-[10.5px] font-semibold uppercase tracking-wider text-neutral-500">
        {label}
      </p>
      <p
        className={`mono mt-0.5 truncate text-[17px] font-semibold ${
          tone === "pos" ? "text-[#30D158]" : "text-white"
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 truncate text-[11px] text-neutral-500">{sub}</p>}
    </div>
  );
}

function Block({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <h3 className="flex items-center gap-1.5 px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
        <span aria-hidden="true">{icon}</span>
        {title}
      </h3>
      <div className="list-group">{children}</div>
    </section>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="px-3.5 py-3 text-[13px] text-neutral-500">{children}</p>;
}

function Line({
  label,
  value,
  tone = "plain",
  strong = false,
  muted = false,
  first = false,
}: {
  label: string;
  value: string;
  tone?: "plain" | "pos" | "neg" | "warn";
  strong?: boolean;
  muted?: boolean;
  first?: boolean;
}) {
  const toneClass =
    tone === "pos"
      ? "text-[#30D158]"
      : tone === "neg"
        ? "text-[#FF453A]"
        : tone === "warn"
          ? "text-[#FF9F0A]"
          : muted
            ? "text-neutral-500"
            : "text-white";
  return (
    <div
      className={`flex items-center justify-between gap-3 px-3.5 py-2.5 ${
        first ? "" : "border-t border-white/[0.08]"
      } ${strong ? "bg-white/[0.03]" : ""}`}
    >
      <span
        className={`text-[13.5px] ${
          strong ? "font-semibold text-white" : "text-neutral-400"
        }`}
      >
        {label}
      </span>
      <span
        className={`shrink-0 text-right text-[14px] ${muted ? "" : "mono"} ${
          strong ? "font-semibold" : "font-medium"
        } ${toneClass}`}
      >
        {value}
      </span>
    </div>
  );
}

function VarianceCard({
  counted,
  expected,
  currency,
}: {
  counted: Minor;
  expected: Minor;
  currency: FiatCurrency;
}) {
  const variance = counted - expected;
  const word = variance === 0 ? "Balanced" : variance > 0 ? "Over" : "Short";
  const tint =
    variance === 0
      ? { text: "text-[#30D158]", bg: "bg-[#30D158]/10", ring: "ring-[#30D158]/30" }
      : variance > 0
        ? { text: "text-[#FF9F0A]", bg: "bg-[#FF9F0A]/10", ring: "ring-[#FF9F0A]/30" }
        : { text: "text-[#FF453A]", bg: "bg-[#FF453A]/10", ring: "ring-[#FF453A]/30" };
  const Glyph =
    variance === 0 ? IconCheck : variance > 0 ? IconArrowUpRight : IconArrowDownLeft;
  return (
    <div
      aria-live="polite"
      className={`flex items-center gap-3 rounded-[20px] px-4 py-3.5 ring-1 ring-inset ${tint.bg} ${tint.ring}`}
    >
      <span
        className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] ${tint.bg} ${tint.text}`}
      >
        <Glyph size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`text-[15.5px] font-semibold ${tint.text}`}>
          {word}
          {variance !== 0 && ` by ${fmtMinor(Math.abs(variance), currency)}`}
        </p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-neutral-400">
          {variance === 0
            ? "The drawer matches the expected figure exactly."
            : "The variance is retained with this immutable Z-report for review."}
        </p>
      </div>
    </div>
  );
}

function AdjustmentRow({
  adjustment,
  currency,
  first,
}: {
  adjustment: Adjustment;
  currency: FiatCurrency;
  first: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 px-3.5 py-2.5 ${
        first ? "" : "border-t border-white/[0.08]"
      }`}
    >
      <span
        className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-[3px] text-[11px] font-semibold ${ADJUSTMENT_TONE[adjustment.kind]}`}
      >
        {ADJUSTMENT_LABEL[adjustment.kind]}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-white">
          <span className="mono">#{adjustment.orderNumber}</span>
          {adjustment.lineName ? ` · ${adjustment.lineName}` : ""}
        </span>
        <span className="block truncate text-[11.5px] text-neutral-500">
          {adjustment.reasonCode} · {adjustment.staffName} · {fmtClock(adjustment.at)}
        </span>
      </span>
      <span className="mono shrink-0 text-[13.5px] font-semibold text-white">
        -{fmtMinor(adjustment.amountMinor, currency)}
      </span>
    </div>
  );
}

function ReportAction({
  icon,
  label,
  onClick,
  disabled = false,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        triggerHaptic("light");
        onClick();
      }}
      className="row-hover flex min-h-11 flex-col items-center justify-center gap-1 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-2 py-3 text-[12.5px] font-semibold text-white focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#0A84FF] disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className="text-[#0A84FF]" aria-hidden="true">
        {icon}
      </span>
      {label}
    </button>
  );
}
