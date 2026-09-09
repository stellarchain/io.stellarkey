"use client";

import { useMemo, useState } from "react";
import { triggerHaptic } from "@/lib/haptics";
import {
  useMerchantConfiguration,
  useMerchantRecords,
  useMerchantStaff,
  useMerchantTill,
} from "@/hooks/useMerchant";
import {
  fmtMinor,
  lineAdjustmentMinor,
  lineGrossMinor,
  orderTotals,
  roundMinor,
  toMinor,
} from "@/lib/merchant/money";
import type {
  AdjustmentKind,
  Minor,
  Order,
  StaffMember,
} from "@/lib/merchant/types";
import { useToast } from "../Toast";
import {
  Button,
  ConfirmModal,
  ErrorText,
  Field,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Notice,
  SegmentedControl,
} from "../ui";
import { IconAlert, IconCheck, IconLock } from "../icons";
import { IconPercent, IconTag, IconXCircle } from "./icons";

type DiscountBasis = "percent" | "amount";

const KIND_OPTIONS: { label: string; value: AdjustmentKind }[] = [
  { label: "Discount", value: "discount" },
  { label: "Comp", value: "comp" },
  { label: "Void", value: "void" },
];

const REASONS: Record<AdjustmentKind, string[]> = {
  discount: ["Loyalty reward", "Staff friend", "Manager approval", "Price match"],
  comp: ["Remake — spilled", "Long wait", "Quality complaint", "Goodwill"],
  void: ["Rung twice", "Wrong item", "Customer changed mind", "Training"],
};

const PERCENT_PRESETS = [5, 10, 15, 20];

const KIND_BLURB: Record<AdjustmentKind, string> = {
  discount: "Takes money off what is owed. The line stays on the ticket and stays taxable.",
  comp: "Gives it away. The goods left the shop, so the cost stays and the takings do not.",
  void: "Un-rings it. Nothing was sold, nothing is owed, and its stock is not consumed.",
};

const ROLE_LABEL: Record<StaffMember["role"], string> = {
  owner: "owner",
  manager: "manager",
  server: "server",
  accountant: "accountant",
};

function permitted(member: StaffMember, kind: AdjustmentKind): boolean {
  switch (kind) {
    case "discount":
      return member.permissions.applyDiscount;
    case "comp":
      return member.permissions.comp;
    default:
      return member.permissions.void;
  }
}

function KindGlyph({ kind, size = 15 }: { kind: AdjustmentKind; size?: number }) {
  if (kind === "discount") return <IconPercent size={size} />;
  if (kind === "comp") return <IconTag size={size} />;
  return <IconXCircle size={size} />;
}

/** #FF9F0A for a comp, #FF453A for a void, blue for a plain discount. */
const KIND_TONE: Record<AdjustmentKind, string> = {
  discount: "#0A84FF",
  comp: "#FF9F0A",
  void: "#FF453A",
};

function stamp(at: number): string {
  return new Date(at).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AdjustmentSheet({
  open,
  onClose,
  lineId,
  onOrderFinalized,
}: {
  open: boolean;
  onClose: () => void;
  /** null adjusts the whole ticket. */
  lineId: string | null;
  onOrderFinalized?: (order: Order) => void;
}) {
  const [pending, setPending] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      busy={pending}
      busyReason="Wait for the adjustment to be saved before closing."
    >
      <AdjustmentSheetInner
        onClose={onClose}
        lineId={lineId}
        onOrderFinalized={onOrderFinalized}
        pending={pending}
        onPendingChange={setPending}
      />
    </Modal>
  );
}

function AdjustmentSheetInner({
  onClose,
  lineId,
  onOrderFinalized,
  pending,
  onPendingChange,
}: {
  onClose: () => void;
  lineId: string | null;
  onOrderFinalized?: (order: Order) => void;
  pending: boolean;
  onPendingChange: (pending: boolean) => void;
}) {
  const { settings } = useMerchantConfiguration();
  const { activeStaff, staff } = useMerchantStaff();
  const { adjustments } = useMerchantRecords();
  const { ticket, nextOrderNumber, applyAdjustment, compLine, voidLine } = useMerchantTill();
  const { toast } = useToast();
  const { lines, discountMinor, tipMinor } = ticket;
  const { currency, taxRates, taxMode } = settings;
  const orderNumber = nextOrderNumber;
  const [kind, setKind] = useState<AdjustmentKind>("discount");
  const [basis, setBasis] = useState<DiscountBasis>("percent");
  const [percentRaw, setPercentRaw] = useState("10");
  const [amountRaw, setAmountRaw] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [confirmingVoid, setConfirmingVoid] = useState(false);
  const [openedAt] = useState(Date.now);

  const actor = activeStaff;
  const line = lineId ? (lines.find((l) => l.id === lineId) ?? null) : null;
  const scopeLabel = line ? line.name : "the whole ticket";

  const before = useMemo(
    () => orderTotals({ lines, taxRates, taxMode, discountMinor, tipMinor }),
    [lines, taxRates, taxMode, discountMinor, tipMinor],
  );

  /** What this adjustment is measured against. */
  const baseMinor = line
    ? Math.max(0, lineGrossMinor(line) - lineAdjustmentMinor(line))
    : Math.max(0, before.grossMinor - before.discountMinor);

  const percent = Number(percentRaw.replace(",", "."));
  const percentValid = Number.isFinite(percent) && percent > 0 && percent <= 100;

  const typedAmount = useMemo<Minor | null>(() => {
    const raw = amountRaw.trim();
    if (raw === "") return null;
    try {
      const minor = toMinor(raw);
      return minor > 0 ? minor : null;
    } catch {
      return null;
    }
  }, [amountRaw]);

  /** The money this adjustment takes off, before the ticket clamps it. */
  const amountMinor = useMemo<Minor>(() => {
    if (kind !== "discount") return baseMinor;
    if (basis === "percent") {
      return percentValid ? Math.min(roundMinor((baseMinor * percent) / 100), baseMinor) : 0;
    }
    return typedAmount === null ? 0 : Math.min(typedAmount, baseMinor);
  }, [basis, baseMinor, kind, percent, percentValid, typedAmount]);

  const after = useMemo(() => {
    if (kind === "void") {
      return orderTotals({
        lines: line ? lines.filter((l) => l.id !== line.id) : [],
        taxRates,
        taxMode,
        discountMinor: line ? discountMinor : 0,
        tipMinor: line ? tipMinor : 0,
      });
    }
    const adjustedLines = line
      ? lines.map((entry) =>
          entry.id === line.id
            ? {
                ...entry,
                adjustmentMinor:
                  kind === "comp"
                    ? lineGrossMinor(entry)
                    : lineAdjustmentMinor(entry) + amountMinor,
              }
            : entry,
        )
      : kind === "comp"
        ? lines.map((entry) => ({ ...entry, adjustmentMinor: lineGrossMinor(entry) }))
        : lines;
    return orderTotals({
      lines: adjustedLines,
      taxRates,
      taxMode,
      discountMinor: line || kind === "comp" ? discountMinor : discountMinor + amountMinor,
      tipMinor: !line && kind === "comp" ? 0 : tipMinor,
    });
  }, [amountMinor, discountMinor, kind, line, lines, taxRates, taxMode, tipMinor]);

  const takenMinor = before.totalMinor - after.totalMinor;
  const allowed = actor !== null && permitted(actor, kind);
  const authorisers = staff.filter((member) => member.active && permitted(member, kind)).map((member) => member.name);
  const figureReady = kind !== "discount" || amountMinor > 0;
  const ready = allowed && figureReady && reason !== "" && lines.length > 0;

  const afterTaxLines = taxRates
    .filter((rate) => (after.taxByRate[rate.id] ?? 0) !== 0)
    .map((rate) => ({
      id: rate.id,
      label: `${rate.label} ${rate.percent} %`,
      minor: after.taxByRate[rate.id],
    }));

  async function apply() {
    if (pending) return;
    setError("");
    onPendingChange(true);
    try {
      const finalized = kind === "discount"
        ? await applyAdjustment({ lineId, amountMinor, reasonCode: reason })
        : kind === "comp"
          ? await compLine(lineId, reason)
          : await voidLine(lineId, reason);
      triggerHaptic("success");
      toast(
        `${kind === "discount" ? "Discount" : kind === "comp" ? "Comp" : "Void"} saved · ${reason}.`,
        "success",
        { silent: true },
      );
      if (finalized) onOrderFinalized?.(finalized);
      onClose();
    } catch (failure) {
      triggerHaptic("error");
      setError(failure instanceof Error ? failure.message : "The adjustment could not be saved.");
    } finally {
      onPendingChange(false);
    }
  }

  const primaryLabel =
    kind === "discount"
      ? `Discount ${fmtMinor(amountMinor, currency)}`
      : kind === "comp"
        ? `Comp ${fmtMinor(baseMinor, currency)}`
        : `Void ${line ? line.name : "the ticket"}`;

  const todayStart = new Date(openedAt);
  todayStart.setHours(0, 0, 0, 0);
  const todayAdjustments = adjustments
    .filter((entry) => entry.at >= todayStart.getTime())
    .sort((a, b) => b.at - a.at);

  return (
    <>
      <ModalHeader
        title="Adjust"
        subtitle={line ? line.name : `Order ${orderNumber} · whole ticket`}
        onClose={onClose}
      />

      <ModalBody>
        <SegmentedControl<AdjustmentKind>
          ariaLabel="Adjustment type"
          value={kind}
          onChange={(next) => {
            setKind(next);
            setReason("");
          }}
          options={KIND_OPTIONS}
        />

        <div className="flex items-start gap-2.5 rounded-2xl bg-white/[0.04] px-4 py-3">
          <span
            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: `${KIND_TONE[kind]}26`, color: KIND_TONE[kind] }}
          >
            <KindGlyph kind={kind} />
          </span>
          <p className="text-[13px] leading-relaxed text-neutral-300">{KIND_BLURB[kind]}</p>
        </div>

        {/* ---------------- who is doing it ---------------- */}
        <div className="panel-inset flex items-center justify-between px-4 py-3">
          <span className="text-[13px] text-neutral-400">Acting as</span>
          <span className="text-right text-[13.5px] font-semibold text-white">
            {actor ? `${actor.name} · ${ROLE_LABEL[actor.role]}` : "No staff session"}
          </span>
        </div>

        {/* ---------------- the permission gate ---------------- */}
        {!allowed && (
          <Notice tone="warn">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 shrink-0 text-[#FF9F0A]">
                <IconLock size={15} />
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-white">
                  {actor?.name ?? "No active staff member"} lacks permission to {kind}
                </p>
                <p className="mt-1 text-neutral-300">
                  {ROLE_LABEL[actor?.role ?? "server"] === "server"
                    ? "A server"
                    : `An ${ROLE_LABEL[actor?.role ?? "server"]}`}{" "}
                  on this shop&rsquo;s rules has no{" "}
                  <span className="mono text-neutral-200">
                    {kind === "discount" ? "applyDiscount" : kind}
                  </span>{" "}
                  permission, so the action below is closed to them.
                </p>
                <p className="mt-1 text-neutral-400">
                  {authorisers.length > 0
                    ? `${authorisers.join(" or ")} can authorise it with a PIN.`
                    : "Nobody on the rota holds this permission — it has to be granted in Staff first."}
                </p>
              </div>
            </div>
          </Notice>
        )}

        {/* ---------------- the figure ---------------- */}
        {kind === "discount" ? (
          <section className="space-y-3">
            <div className="flex items-baseline justify-between px-1">
              <h3 className="text-[13.5px] font-semibold text-white">How much off {scopeLabel}</h3>
              <span className="mono text-[12px] text-neutral-500">
                of {fmtMinor(baseMinor, currency)}
              </span>
            </div>
            <div className="sm:max-w-[260px]">
              <SegmentedControl<DiscountBasis>
                ariaLabel="Discount basis"
                value={basis}
                onChange={setBasis}
                options={[
                  { label: "Percentage", value: "percent" },
                  { label: "Amount", value: "amount" },
                ]}
              />
            </div>

            {basis === "percent" ? (
              <div className="space-y-2">
                <div className="flex gap-1.5">
                  {PERCENT_PRESETS.map((preset) => {
                    const on = percentValid && percent === preset;
                    return (
                      <button
                        key={preset}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setPercentRaw(String(preset))}
                        className={`mono min-h-[44px] min-w-0 flex-1 rounded-xl text-[14px] font-semibold transition-colors ${
                          on
                            ? "bg-[#0A84FF]/20 text-[#0A84FF]"
                            : "bg-white/[0.08] text-neutral-300 hover:bg-white/[0.13]"
                        }`}
                      >
                        {preset} %
                      </button>
                    );
                  })}
                </div>
                <Field
                  label="Discount Percentage"
                  hint="0 – 100 %"
                  error={
                    percentValid
                      ? undefined
                      : "A discount is somewhere between nothing and all of it — 0 to 100 %."
                  }
                >
                  <input
                    type="text"
                    inputMode="decimal"
                    enterKeyHint="done"
                    value={percentRaw}
                    onChange={(e) => setPercentRaw(e.target.value)}
                    className="input mono text-base sm:text-[15px]"
                  />
                </Field>
              </div>
            ) : (
              <Field
                label="Discount Amount"
                error={
                  amountRaw.trim() !== "" && typedAmount === null
                    ? "Enter an amount such as 2.50."
                    : typedAmount !== null && typedAmount > baseMinor
                      ? `Capped at ${fmtMinor(baseMinor, currency)} — a discount cannot take off more than is owed.`
                      : undefined
                }
              >
                <input
                  type="text"
                  inputMode="decimal"
                  enterKeyHint="done"
                  value={amountRaw}
                  onChange={(e) => setAmountRaw(e.target.value)}
                  placeholder="0.00"
                  className="input mono text-base sm:text-[15px]"
                />
              </Field>
            )}
          </section>
        ) : (
          <div className="panel-inset flex items-baseline justify-between px-4 py-3">
            <span className="text-[13.5px] text-neutral-400">
              {kind === "comp" ? "Given away" : "Un-rung"}
            </span>
            <span className="mono text-[20px] font-semibold text-white">
              {fmtMinor(baseMinor, currency)}
            </span>
          </div>
        )}

        {/* ---------------- why ---------------- */}
        <section>
          <h3 className="px-1 pb-2 text-[13.5px] font-semibold text-white">Reason</h3>
          <div className="list-group">
            {REASONS[kind].map((code, index) => {
              const on = reason === code;
              return (
                <button
                  key={code}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setReason(code)}
                  className={`row-hover flex min-h-[44px] w-full items-center gap-3 px-4 py-3 text-left ${
                    index > 0 ? "border-t border-white/[0.08]" : ""
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                      on ? "bg-[#0A84FF] text-white" : "bg-white/[0.1] text-transparent"
                    }`}
                  >
                    <IconCheck size={12} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[14.5px] text-white">{code}</span>
                </button>
              );
            })}
          </div>
          {reason === "" && (
            <p className="px-1 pt-2 text-[12px] text-neutral-500">
              Every adjustment carries a reason — it is the only thing that makes the Z-report
              readable a month later.
            </p>
          )}
        </section>

        {/* ---------------- what the ticket becomes ---------------- */}
        <section className="list-group">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-[13px] text-neutral-400">Ticket now</span>
            <span className="mono text-[13.5px] text-neutral-300">
              {fmtMinor(before.totalMinor, currency)}
            </span>
          </div>
          <div className="flex items-center justify-between border-t border-white/[0.08] px-4 py-3">
            <span className="text-[13px] text-neutral-400">
              {kind === "void" ? "Taken off the ticket" : "Comes off"}
            </span>
            <span className="mono text-[13.5px]" style={{ color: KIND_TONE[kind] }}>
              −{fmtMinor(takenMinor, currency)}
            </span>
          </div>
          {afterTaxLines.map((tax) => (
            <div
              key={tax.id}
              className="flex items-center justify-between border-t border-white/[0.08] px-4 py-2"
            >
              <span className="text-[13px] text-neutral-400">
                {tax.label}
                <span className="text-neutral-600">
                  {taxMode === "inclusive" ? " · included" : " · added"}
                </span>
              </span>
              <span className="mono text-[13px] text-neutral-300">
                {fmtMinor(tax.minor, currency)}
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between border-t border-white/[0.08] px-4 py-3">
            <span className="text-[14.5px] font-semibold text-white">Ticket after</span>
            <span className="mono text-[20px] font-semibold text-white">
              {fmtMinor(after.totalMinor, currency)}
            </span>
          </div>
        </section>

        {line && kind !== "void" && (
          <p className="px-1 text-[12px] leading-relaxed text-neutral-500">
            Kept on {line.name} itself, then the remaining ticket discount is spread pro-rata so
            each VAT rate reconciles to what was actually paid.
          </p>
        )}

        <ErrorText message={error} />

        <ModalFooter
          primary={
            <Button
              type="button"
              variant={kind === "void" ? "danger" : "primary"}
              disabled={!ready}
              loading={pending}
              onClick={() => {
                if (kind === "void") setConfirmingVoid(true);
                else void apply();
              }}
            >
              {primaryLabel}
            </Button>
          }
        />

        <p className="text-center text-[11.5px] leading-relaxed text-neutral-500">
          {actor
            ? `Recorded as ${actor.name} (${ROLE_LABEL[actor.role]}) · ${stamp(openedAt)}`
            : "A verified staff session is required."}
        </p>

        {/* ---------------- what the day already carries ---------------- */}
        <section className="border-t border-white/[0.08] pt-4">
          <h3 className="px-1 pb-2 text-[13.5px] font-semibold text-white">Earlier today</h3>
          <div className="list-group">
            {todayAdjustments.map((entry, index) => (
              <div
                key={entry.id}
                className={`flex items-center gap-3 px-4 py-3 ${index > 0 ? "ios-sep" : ""}`}
              >
                <span
                  className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full"
                  style={{
                    backgroundColor: `${KIND_TONE[entry.kind]}26`,
                    color: KIND_TONE[entry.kind],
                  }}
                >
                  <KindGlyph kind={entry.kind} size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] text-white">
                    {entry.kind === "discount" ? "Discount" : entry.kind === "comp" ? "Comp" : "Void"}
                    {entry.lineName ? ` · ${entry.lineName}` : " · whole ticket"}
                  </p>
                  <p className="truncate text-[12px] text-neutral-500">
                    #{entry.orderNumber} · {entry.reasonCode} · {entry.staffName}
                  </p>
                </div>
                <span className="mono shrink-0 text-[13px] text-neutral-300">
                  −{fmtMinor(entry.amountMinor, currency)}
                </span>
              </div>
            ))}
            {todayAdjustments.length === 0 && (
              <p className="px-4 py-5 text-center text-[12.5px] text-neutral-500">
                No adjustments have been recorded today.
              </p>
            )}
          </div>
        </section>

        {lines.length === 0 && (
          <p className="flex items-center justify-center gap-1.5 text-center text-[12px] text-[#FF9F0A]">
            <IconAlert size={12} /> Nothing is rung up, so there is nothing to adjust.
          </p>
        )}
      </ModalBody>

      <ConfirmModal
        open={confirmingVoid}
        title={line ? `Void ${line.name}?` : "Void the whole ticket?"}
        message={
          line
            ? `${fmtMinor(baseMinor, currency)} comes off the ticket and the line is un-rung · ${reason}.`
            : `Every line is un-rung and nothing is owed · ${reason}.`
        }
        confirmLabel={line ? "Void line" : "Void ticket"}
        destructive
        onClose={() => setConfirmingVoid(false)}
        onConfirm={() => {
          setConfirmingVoid(false);
          void apply();
        }}
      />
    </>
  );
}
