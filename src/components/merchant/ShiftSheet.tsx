"use client";

/**
 * MOCK — the shift lifecycle: running totals, X- and Z-reports, a blind cash
 * count and the unsettled-tab blocker that stands between a shift and its close.
 *
 * What is mocked: every figure is read from `MOCK_SHIFT`, `MOCK_STAFF`,
 * `MOCK_ADJUSTMENTS` and `MOCK_TERMINAL`. Three things the fixtures only imply
 * are derived here, each behind a comment: the per-staff split, the tender split
 * and the identity of the open tabs. Committing a count, issuing a Z-report and
 * Print / Email / Export all stop at local state and a toast.
 *
 * What a real implementation replaces: the derivations become sums over the
 * shift's own orders (`order.staffName`, `order.tender`, `status === "open"`);
 * the committed count is written as the shift's `CashCount` and the close writes
 * a sequential `Shift` record through the merchant store; Print / Email / Export
 * hand off to a real transport. Nothing here writes, signs, or reaches Horizon.
 */

import { useMemo, useState } from "react";
import { useMerchant } from "@/hooks/useMerchant";
import { FIAT_SYMBOLS, type FiatCurrency } from "@/lib/format";
import { triggerHaptic } from "@/lib/haptics";
import {
  MOCK_ADJUSTMENTS,
  MOCK_NOW,
  MOCK_SHIFT,
  MOCK_STAFF,
  MOCK_TERMINAL,
} from "@/lib/merchant/mock";
import { distribute, fmtMinor, toMinor } from "@/lib/merchant/money";
import type {
  Adjustment,
  AdjustmentKind,
  Minor,
  Shift,
  StaffMember,
  TaxRate,
} from "@/lib/merchant/types";
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
  IconClock,
  IconPercent,
  IconPrinter,
  IconQr,
  IconReceipt,
  IconRefund,
  IconTerminal,
} from "./icons";

/* ------------------------------------------------------------------ */
/* Derivations                                                         */
/* ------------------------------------------------------------------ */

/**
 * Stand-in for grouping the shift's orders by `order.staffName`. Integer weights
 * only: `distribute` splits the fixture totals across them by largest remainder,
 * so the per-staff rows always add back up to the shift exactly — no cent is
 * lost or invented on the way. The accountant takes no payments and so has no
 * weight at all.
 */
const TAKINGS_WEIGHTS: Record<string, number> = {
  st_ana: 34,
  st_tomas: 41,
  st_ceu: 25,
};

/** Stand-in for summing `order.tender`: most of the shift arrived on-chain. */
const TENDER_WEIGHTS = { crypto: 78, cash: 22 } as const;

export interface ShiftStaffLine {
  id: string;
  name: string;
  orderCount: number;
  takingsMinor: Minor;
  tipsMinor: Minor;
}

/** The Z-report's per-staff breakdown, and the staff page's "today" column. */
export function shiftStaffLines(
  shift: Shift = MOCK_SHIFT,
  staff: StaffMember[] = MOCK_STAFF,
): ShiftStaffLine[] {
  const weights = staff.map((member) => TAKINGS_WEIGHTS[member.id] ?? 0);
  const takings = distribute(shift.grossMinor, weights);
  const tips = distribute(shift.tipsMinor, weights);
  const orders = distribute(shift.orderCount, weights);
  return staff.map((member, i) => ({
    id: member.id,
    name: member.name,
    orderCount: orders[i],
    takingsMinor: takings[i],
    tipsMinor: tips[i],
  }));
}

function tenderSplit(shift: Shift): { cryptoMinor: Minor; cashMinor: Minor } {
  const [cryptoMinor, cashMinor] = distribute(shift.grossMinor, [
    TENDER_WEIGHTS.crypto,
    TENDER_WEIGHTS.cash,
  ]);
  return { cryptoMinor, cashMinor };
}

interface OpenTab {
  id: string;
  number: number;
  terminalName: string;
  staffName: string;
}

/**
 * `MOCK_SHIFT.openTabs` is a count, so the rows are built from the fixtures that
 * do carry identity: a tab is held by a server on this till. There is only one
 * till — nothing syncs between devices — so tabs simply continue this device's
 * own run of order numbers. A real shift lists its own `status === "open"`
 * orders instead, and shows their totals, which a tab not yet rung up lacks.
 */
function derivedOpenTabs(): OpenTab[] {
  const servers = MOCK_STAFF.filter((m) => m.permissions.takePayment && m.role !== "owner");
  const highest = Math.max(...MOCK_ADJUSTMENTS.map((a) => a.orderNumber));
  if (servers.length === 0) return [];

  return Array.from({ length: MOCK_SHIFT.openTabs }, (_, i) => {
    const server = servers[i % servers.length];
    const number = highest + 1 + i;
    return {
      id: `tab-${i}-${number}`,
      number,
      terminalName: MOCK_TERMINAL.name,
      staffName: server.name,
    };
  });
}

function taxRows(shift: Shift, rates: TaxRate[]): { id: string; label: string; minor: Minor }[] {
  return Object.entries(shift.taxByRate).map(([id, minor]) => {
    const rate = rates.find((r) => r.id === id);
    return { id, label: rate ? `${rate.label} · ${rate.percent} %` : id, minor };
  });
}

/** Fixtures are UTC instants: format them in UTC so the shop reads 07:30. */
function fmtClock(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
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

/* ------------------------------------------------------------------ */
/* Shell                                                               */
/* ------------------------------------------------------------------ */

export function ShiftSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} wide>
      {/* Unmounted on close, so a reopened sheet starts at the overview with
          nothing counted — the blind count cannot be peeked at by reopening. */}
      <ShiftBody onClose={onClose} />
    </Modal>
  );
}

type Step = "overview" | "count" | "report";

function ShiftBody({ onClose }: { onClose: () => void }) {
  const { settings } = useMerchant();
  const { toast } = useToast();
  const currency = settings.currency;
  const shift = MOCK_SHIFT;

  const [step, setStep] = useState<Step>("overview");
  const [reportKind, setReportKind] = useState<"x" | "z">("x");
  const [clearedTabs, setClearedTabs] = useState<string[]>([]);
  const [counts, setCounts] = useState<Minor[]>([]);
  const [recounting, setRecounting] = useState(false);
  const [draft, setDraft] = useState("");
  const [zIssued, setZIssued] = useState(false);

  const tabs = useMemo(() => derivedOpenTabs(), []);
  const staffLines = useMemo(() => shiftStaffLines(), []);
  const remaining = tabs.filter((t) => !clearedTabs.includes(t.id));

  const tender = tenderSplit(shift);
  const counted = counts.length > 0 ? counts[counts.length - 1] : null;
  const expectedCash = shift.floatMinor + tender.cashMinor;
  const entering = counted === null || recounting;

  const rates = taxRows(shift, settings.taxRates);
  const taxTotal = rates.reduce((sum, r) => sum + r.minor, 0);
  const afterRefunds = shift.grossMinor - shift.refundsMinor;

  function clearTab(tab: OpenTab, how: "settle" | "void") {
    triggerHaptic(how === "settle" ? "success" : "warning");
    setClearedTabs((prev) => [...prev, tab.id]);
    toast(
      how === "settle"
        ? `Order #${tab.number} would open on ${tab.terminalName} to take payment.`
        : `Voiding #${tab.number} would need a reason and a manager PIN.`,
      how === "settle" ? "success" : "info",
    );
  }

  function commitCount() {
    const value = parseAmount(draft);
    if (value === null) return;
    triggerHaptic("success");
    setCounts((prev) => [...prev, value]);
    setRecounting(false);
    setDraft("");
  }

  const headerTitle =
    step === "count"
      ? "Blind cash count"
      : step === "report"
        ? reportKind === "x"
          ? "X-report"
          : `Z-report ${shift.number}`
        : `Shift ${shift.number}`;

  const headerSubtitle =
    step === "report" && reportKind === "z" && zIssued
      ? `Closed ${fmtClock(MOCK_NOW)} · ${shift.openedBy}`
      : `Open since ${fmtClock(shift.openedAt)} · ${shift.openedBy}`;

  return (
    <>
      <ModalHeader title={headerTitle} subtitle={headerSubtitle} onClose={onClose} />

      <div className="space-y-4 p-4 sm:p-5">
        {/* ---------------- overview ---------------- */}
        {step === "overview" && (
          <>
            <div className="panel-inset grid grid-cols-2 gap-px overflow-hidden">
              <Cell label="Opened" value={fmtClock(shift.openedAt)} sub={shift.openedBy} />
              <Cell label="Float" value={fmtMinor(shift.floatMinor, currency)} sub="In the drawer at open" />
              <Cell label="Orders" value={String(shift.orderCount)} sub="Rung up this shift" />
              <Cell
                label="Takings"
                value={fmtMinor(afterRefunds, currency)}
                sub="Gross less refunds"
                tone="pos"
              />
            </div>

            <Block title="Running totals" icon={<IconReceipt size={13} />}>
              <Line label="Gross takings" value={fmtMinor(shift.grossMinor, currency)} tone="pos" first />
              <Line label="Refunds" value={`-${fmtMinor(shift.refundsMinor, currency)}`} tone="neg" />
              <Line label="Tips" value={fmtMinor(shift.tipsMinor, currency)} />
              <Line label="Discounts" value={`-${fmtMinor(shift.discountsMinor, currency)}`} />
              <Line label="Comps" value={`-${fmtMinor(shift.compsMinor, currency)}`} />
              <Line label="Voids" value={`-${fmtMinor(shift.voidsMinor, currency)}`} />
              <Line label="Takings after refunds" value={fmtMinor(afterRefunds, currency)} strong />
            </Block>

            <Block title="Tax collected" icon={<IconPercent size={13} />}>
              {rates.map((rate, i) => (
                <Line key={rate.id} label={rate.label} value={fmtMinor(rate.minor, currency)} first={i === 0} />
              ))}
              <Line label="Total tax" value={fmtMinor(taxTotal, currency)} strong />
            </Block>

            {/* The tender split would give the drawer away, so it is held back
                until the count is committed. The blindness is structural here,
                not a label on a screen that shows the answer anyway. */}
            <Notice>
              <p className="font-semibold text-white">Cash is held back</p>
              <p className="mt-1">
                The tender split stays off this screen until the drawer is counted, so nobody can
                read the expected figure before they count. It is on both reports afterwards.
              </p>
            </Notice>

            {remaining.length > 0 ? (
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
                      <h3 id="shift-blocker-title" className="text-[15.5px] font-semibold text-white">
                        Close blocked
                      </h3>
                      <p aria-live="polite" className="mt-0.5 text-[12.5px] leading-relaxed text-neutral-400">
                        {remaining.length === 1
                          ? "One tab is still unsettled."
                          : `${remaining.length} tabs are still unsettled.`}{" "}
                        A shift cannot close over money that has not been rung up. Settle each one on
                        the till that holds it, or void it with a reason.
                      </p>
                    </div>
                  </div>

                  {remaining.map((tab) => (
                    <div
                      key={tab.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[#FF9F0A]/20 px-4 py-3"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className="mono text-[14.5px] font-semibold text-white">
                            #{tab.number}
                          </span>
                          <span className="truncate text-[11.5px] text-neutral-500">
                            {tab.staffName}
                          </span>
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-neutral-400">
                          <IconTerminal size={11} />
                          {tab.terminalName} · not rung up yet
                        </span>
                      </span>
                      <span className="flex shrink-0 gap-2">
                        <Button
                          variant="secondary"
                          className="min-h-11 px-3.5 py-2 text-[13px]"
                          onClick={() => clearTab(tab, "settle")}
                        >
                          Settle
                        </Button>
                        <Button
                          variant="danger"
                          className="min-h-11 px-3.5 py-2 text-[13px]"
                          onClick={() => clearTab(tab, "void")}
                        >
                          Void
                        </Button>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ) : (
              <p className="flex items-center gap-2 px-1 text-[12.5px] text-[#30D158]">
                <IconCheck size={12} />
                No tab is open — the shift is ready to close.
              </p>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => {
                  triggerHaptic("selection");
                  setReportKind("x");
                  setStep("report");
                }}
              >
                X-report
              </Button>
              <Button
                className="flex-1"
                disabled={remaining.length > 0}
                aria-describedby={remaining.length > 0 ? "shift-blocker-title" : undefined}
                onClick={() => {
                  triggerHaptic("medium");
                  setStep("count");
                }}
              >
                Count drawer & close
              </Button>
            </div>
            <p className="px-1 text-[12px] leading-relaxed text-neutral-500">
              An X-report is a reading: it can be taken any time and leaves the shift open. A
              Z-report is sequential, closes the shift and is never re-issued.
            </p>
          </>
        )}

        {/* ---------------- blind cash count ---------------- */}
        {step === "count" && entering && (
          <>
            <Notice tone="warn">
              <p className="font-semibold text-white">Count first, compare after</p>
              <p className="mt-1">
                The expected figure is not on this screen and is not in this page until you commit —
                a count you can already see the answer to is not a count.
                {counts.length > 0 &&
                  " You have seen it now, so this recount is recorded as a second count against the shift, not swapped for the first."}
              </p>
            </Notice>

            <div>
              <label htmlFor="shift-count" className="field-label">
                {counts.length > 0 ? `Recount ${counts.length + 1} of the drawer` : "What is in the drawer"}
              </label>
              <div className="flex items-center gap-2">
                <span className="mono shrink-0 text-[17px] font-semibold text-neutral-400">
                  {FIAT_SYMBOLS[currency]}
                </span>
                <input
                  id="shift-count"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={draft}
                  placeholder="0.00"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitCount();
                  }}
                  className="input mono text-base sm:text-[17px]"
                />
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-neutral-500">
                Notes and coin together, including the float. Nothing is compared until you commit.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => {
                  triggerHaptic("selection");
                  setDraft("");
                  setRecounting(false);
                  if (counted === null) setStep("overview");
                }}
              >
                {counted === null ? "Back to shift" : "Cancel recount"}
              </Button>
              <Button className="flex-1" disabled={parseAmount(draft) === null} onClick={commitCount}>
                Commit count
              </Button>
            </div>
          </>
        )}

        {step === "count" && !entering && counted !== null && (
          <>
            <div className="panel-inset grid grid-cols-2 gap-px overflow-hidden">
              <Cell label="Expected" value={fmtMinor(expectedCash, currency)} sub="Float plus cash tender" />
              <Cell label="Counted" value={fmtMinor(counted, currency)} sub={`Count ${counts.length} · ${fmtClock(MOCK_NOW)}`} />
            </div>

            <VarianceCard counted={counted} expected={expectedCash} currency={currency} />

            <Block title="How the expected figure is built" icon={<IconClock size={13} />}>
              <Line label="Opening float" value={fmtMinor(shift.floatMinor, currency)} first />
              <Line label="Cash tender" value={fmtMinor(tender.cashMinor, currency)} />
              <Line label="Expected in drawer" value={fmtMinor(expectedCash, currency)} strong />
            </Block>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => {
                  triggerHaptic("selection");
                  setRecounting(true);
                  setDraft("");
                }}
              >
                Recount
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  triggerHaptic("selection");
                  setReportKind("z");
                  setStep("report");
                }}
              >
                Continue to Z-report
              </Button>
            </div>
          </>
        )}

        {/* ---------------- X / Z report ---------------- */}
        {step === "report" && (
          <>
            {reportKind === "x" ? (
              <Notice>
                <p className="font-semibold text-white">Reading only</p>
                <p className="mt-1">
                  An X-report takes a reading at {fmtClock(MOCK_NOW)}. The shift stays open, the
                  totals keep running, and nothing is sequenced.
                </p>
              </Notice>
            ) : zIssued ? (
              <Notice tone="pos">
                <p className="font-semibold text-white">
                  Z-{shift.number} issued · shift closed {fmtClock(MOCK_NOW)}
                </p>
                <p className="mt-1">
                  Sequential and final. The next shift opens with its own float and its own number.
                </p>
              </Notice>
            ) : (
              <Notice tone="warn">
                <p className="font-semibold text-white">This closes the shift</p>
                <p className="mt-1">
                  Z-{shift.number} is the next number in an unbroken sequence. Once issued it is
                  never re-issued and the shift cannot be reopened.
                </p>
              </Notice>
            )}

            <Block title="Totals" icon={<IconReceipt size={13} />}>
              <Line label="Gross takings" value={fmtMinor(shift.grossMinor, currency)} tone="pos" first />
              <Line label="Refunds" value={`-${fmtMinor(shift.refundsMinor, currency)}`} tone="neg" />
              <Line label="Tips" value={fmtMinor(shift.tipsMinor, currency)} />
              <Line label="Discounts" value={`-${fmtMinor(shift.discountsMinor, currency)}`} />
              <Line label="Comps" value={`-${fmtMinor(shift.compsMinor, currency)}`} />
              <Line label="Voids" value={`-${fmtMinor(shift.voidsMinor, currency)}`} />
              <Line label="Orders" value={String(shift.orderCount)} />
              <Line label="Takings after refunds" value={fmtMinor(afterRefunds, currency)} strong />
            </Block>

            <Block title="Tax by rate" icon={<IconPercent size={13} />}>
              {rates.map((rate, i) => (
                <Line key={rate.id} label={rate.label} value={fmtMinor(rate.minor, currency)} first={i === 0} />
              ))}
              <Line label="Total tax" value={fmtMinor(taxTotal, currency)} strong />
            </Block>

            <Block title="Tender" icon={<IconQr size={13} />}>
              <Line label="On-chain" value={fmtMinor(tender.cryptoMinor, currency)} first />
              {counted === null ? (
                <Line label="Cash" value="Held until counted" muted />
              ) : (
                <>
                  <Line label="Cash" value={fmtMinor(tender.cashMinor, currency)} />
                  <Line label="Counted in drawer" value={fmtMinor(counted, currency)} />
                  <Line
                    label="Variance"
                    value={`${counted - expectedCash > 0 ? "+" : ""}${fmtMinor(counted - expectedCash, currency)}`}
                    tone={counted === expectedCash ? "pos" : counted > expectedCash ? "warn" : "neg"}
                    strong
                  />
                </>
              )}
            </Block>

            <Block title="By staff" icon={<IconUsers size={13} />}>
              {staffLines
                .filter((line) => line.orderCount > 0 || line.takingsMinor > 0)
                .map((line, i) => (
                  <div
                    key={line.id}
                    className={`flex items-center gap-3 px-3.5 py-2.5 ${i === 0 ? "" : "border-t border-white/[0.08]"}`}
                  >
                    <Avatar seed={line.name} size={28} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-white">
                        {line.name}
                      </span>
                      <span className="block text-[11.5px] text-neutral-500">
                        {line.orderCount} orders · {fmtMinor(line.tipsMinor, currency)} tips
                      </span>
                    </span>
                    <span className="mono shrink-0 text-[14px] font-semibold text-white">
                      {fmtMinor(line.takingsMinor, currency)}
                    </span>
                  </div>
                ))}
            </Block>

            <Block title="Adjustments" icon={<IconRefund size={13} />}>
              {MOCK_ADJUSTMENTS.map((adjustment, i) => (
                <AdjustmentRow
                  key={adjustment.id}
                  adjustment={adjustment}
                  currency={currency}
                  first={i === 0}
                />
              ))}
            </Block>

            {reportKind === "z" && !zIssued ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    triggerHaptic("selection");
                    setStep("count");
                  }}
                >
                  Back to the count
                </Button>
                <Button
                  className="flex-1"
                  onClick={() => {
                    triggerHaptic("success");
                    setZIssued(true);
                    toast(
                      `Shift ${shift.number} closed. Z-${shift.number} is sequential and is never re-issued.`,
                      "success",
                    );
                  }}
                >
                  Issue Z-{shift.number}
                </Button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <ReportAction
                    icon={<IconPrinter size={15} />}
                    label="Print"
                    onClick={() =>
                      toast(
                        `${reportKind === "x" ? "The X-report" : `Z-${shift.number}`} would print on the till's receipt printer.`,
                      )
                    }
                  />
                  <ReportAction
                    icon={<IconSend size={15} />}
                    label="Email"
                    onClick={() =>
                      toast(
                        `${reportKind === "x" ? "The X-report" : `Z-${shift.number}`} would be emailed to the bookkeeper on file.`,
                      )
                    }
                  />
                  <ReportAction
                    icon={<IconDownload size={15} />}
                    label="Export"
                    onClick={() =>
                      toast(
                        `${reportKind === "x" ? "The X-report" : `Z-${shift.number}`} would be exported as CSV with the shift's orders.`,
                      )
                    }
                  />
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  {reportKind === "x" && (
                    <Button
                      variant="secondary"
                      className="flex-1"
                      onClick={() => {
                        triggerHaptic("selection");
                        setStep("overview");
                      }}
                    >
                      Back to shift
                    </Button>
                  )}
                  <Button
                    variant={reportKind === "x" ? "ghost" : "primary"}
                    className="flex-1"
                    onClick={() => {
                      triggerHaptic("selection");
                      onClose();
                    }}
                  >
                    Done
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

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
  icon: React.ReactNode;
  children: React.ReactNode;
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
      <span className={`text-[13.5px] ${strong ? "font-semibold text-white" : "text-neutral-400"}`}>
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
  const Glyph = variance === 0 ? IconCheck : variance > 0 ? IconArrowUpRight : IconArrowDownLeft;

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
            ? "The drawer matches the expected figure to the cent."
            : variance > 0
              ? "More in the drawer than the till expects. A cash sale rung up short, or change not given."
              : "Less in the drawer than the till expects. Check the change given and the payouts taken."}
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
      className={`flex items-center gap-3 px-3.5 py-2.5 ${first ? "" : "border-t border-white/[0.08]"}`}
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
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        triggerHaptic("light");
        onClick();
      }}
      className="row-hover flex min-h-11 flex-col items-center justify-center gap-1 rounded-2xl border border-white/[0.08] bg-white/[0.02] px-2 py-3 text-[12.5px] font-semibold text-white focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#0A84FF]"
    >
      <span className="text-[#0A84FF]" aria-hidden="true">
        {icon}
      </span>
      {label}
    </button>
  );
}
