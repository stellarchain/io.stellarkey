"use client";

import { useMemo, useState } from "react";
import { useMerchant } from "@/hooks/useMerchant";
import { fmtAmount } from "@/lib/format";
import { triggerHaptic } from "@/lib/haptics";
import { fmtMinor, lineGrossMinor, minorToDecimal, toMinor } from "@/lib/merchant/money";
import { refundReservesFunds } from "@/lib/merchant/refunds";
import type {
  Charge,
  MatchLane,
  Minor,
  Order,
  OrderLine,
  RefundReason,
  RefundSubmissionStatus,
} from "@/lib/merchant/types";
import { NETWORKS } from "@/lib/stellar";
import { VaultLockedError } from "@/lib/vault";
import { useToast } from "../Toast";
import {
  Button,
  ErrorText,
  Field,
  HashValue,
  Modal,
  ModalHeader,
  Notice,
  Select,
  Spinner,
} from "../ui";
import { IconAlert, IconCheck, IconClose, IconExternal } from "../icons";
import { IconClock, IconQr, IconReceipt, IconRefund, IconXCircle } from "./icons";

/* ------------------------------------------------------------------ */
/* Status, shared with the ledger.                                     */
/* ------------------------------------------------------------------ */

/**
 * What the ledger should say an order is. It is not `Order["status"]`: an order
 * stays `awaiting` while its charge times out or lands short, and a row that
 * still reads "Awaiting" in those cases is lying to whoever is counting up.
 */
export type OrderView =
  | "open"
  | "awaiting"
  | "expired"
  | "underpaid"
  | "overpaid"
  | "paid"
  | "refunded"
  | "partially_refunded"
  | "voided";

export function orderView(order: Order, charges: Charge[]): OrderView {
  if (order.status !== "awaiting") return order.status;
  const own = charges.filter((c) => c.orderId === order.id);
  if (own.some((c) => c.status === "underpaid")) return "underpaid";
  if (own.some((c) => c.status === "overpaid")) return "overpaid";
  const stillOpen = own.some((c) => c.status === "awaiting");
  if (!stillOpen && own.some((c) => c.status === "expired")) return "expired";
  return "awaiting";
}

type Tone = "pos" | "accent" | "neg" | "warn" | "neutral";

export const VIEW_LABEL: Record<OrderView, string> = {
  open: "Open",
  awaiting: "Awaiting",
  expired: "Expired",
  underpaid: "Underpaid",
  overpaid: "Overpaid",
  paid: "Paid",
  refunded: "Refunded",
  partially_refunded: "Part refunded",
  voided: "Voided",
};

const VIEW_TONE: Record<OrderView, Tone> = {
  open: "neutral",
  awaiting: "accent",
  expired: "neutral",
  underpaid: "warn",
  overpaid: "warn",
  paid: "pos",
  refunded: "neg",
  partially_refunded: "neg",
  voided: "neutral",
};

/** A pill is never colour alone — every one of these carries a glyph and a word. */
const VIEW_GLYPH: Record<OrderView, (props: { size?: number }) => React.ReactElement> = {
  open: IconReceipt,
  awaiting: IconClock,
  expired: IconXCircle,
  underpaid: IconAlert,
  overpaid: IconAlert,
  paid: IconCheck,
  refunded: IconRefund,
  partially_refunded: IconRefund,
  voided: IconClose,
};

const TONE_CLASS: Record<Tone, string> = {
  pos: "text-[#30D158] bg-[#30D158]/15",
  accent: "text-[#0A84FF] bg-[#0A84FF]/15",
  neg: "text-[#FF453A] bg-[#FF453A]/15",
  warn: "text-[#FF9F0A] bg-[#FF9F0A]/15",
  neutral: "text-neutral-400 bg-white/[0.08]",
};

export function OrderStatusPill({ view }: { view: OrderView }) {
  const Glyph = VIEW_GLYPH[view];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-[3px] text-[11px] font-semibold ${TONE_CLASS[VIEW_TONE[view]]}`}
    >
      <Glyph size={10} />
      {VIEW_LABEL[view]}
    </span>
  );
}

export function OrderStatusIcon({ view }: { view: OrderView }) {
  const Glyph = VIEW_GLYPH[view];
  return (
    <span
      aria-hidden="true"
      className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] ${TONE_CLASS[VIEW_TONE[view]]}`}
    >
      <Glyph size={16} />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Refunds                                                             */
/* ------------------------------------------------------------------ */

const REFUND_REASONS: { value: RefundReason; label: string }[] = [
  { value: "wrong_item", label: "Wrong item" },
  { value: "customer_request", label: "Customer request" },
  { value: "item_returned", label: "Item returned" },
  { value: "duplicate", label: "Duplicate payment" },
  { value: "other", label: "Other" },
];

const REASON_LABEL: Record<RefundReason, string> = {
  wrong_item: "Wrong item",
  customer_request: "Customer request",
  item_returned: "Item returned",
  duplicate: "Duplicate payment",
  overpayment: "Overpayment",
  other: "Other",
};

const LANE_LABEL: Record<MatchLane, string> = {
  memo: "Matched by memo",
  amount: "Matched by amount",
  // Materially different from a memo match: a person decided this, not a rule.
  manual: "Attached by staff",
};

/** A refund is an ordinary outbound payment, so it fails the way sending fails. */
function explainRefundFailure(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message.trim() : "";
  // The vault throws a type of its own; the message test is the fallback for a
  // lock reported further down the send path, where the class is lost.
  if (
    cause instanceof VaultLockedError ||
    (cause instanceof Error && cause.name === "VaultLockedError") ||
    /vault|locked|not available in the current session/i.test(raw)
  ) {
    return "Your wallet is locked, so nothing was sent. Unlock it to sign this refund, then try again.";
  }
  if (/watch-only/i.test(raw)) {
    return "This account is watch-only and cannot sign a refund. Switch to the signing account that took the payment.";
  }
  if (/underfunded|insufficient/i.test(raw)) {
    return "The till account does not hold enough of that asset to pay this refund right now.";
  }
  if (/no_destination|no destination/i.test(raw)) {
    return "The payer's account no longer exists on this network, so the refund cannot be delivered.";
  }
  if (/no_trust|trustline/i.test(raw)) {
    return "The payer no longer holds a trustline for that asset, so the refund cannot be delivered.";
  }
  return raw || "The refund could not be sent.";
}

function fmtWhen(ts: number): string {
  return new Date(ts).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

const REFUND_SUBMISSION_LABEL: Record<RefundSubmissionStatus, string> = {
  confirmed: "Confirmed",
  accepted: "Confirming",
  status_unknown: "Status unknown — do not retry",
  failed: "Failed — safe to retry",
};

/* ------------------------------------------------------------------ */
/* Receipt rows                                                        */
/* ------------------------------------------------------------------ */

function TotalRow({
  label,
  value,
  tone = "plain",
  strong = false,
}: {
  label: string;
  value: string;
  tone?: "plain" | "muted" | "neg";
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-1.5">
      <span
        className={`text-[13px] ${strong ? "font-semibold text-white" : "text-neutral-400"}`}
      >
        {label}
      </span>
      <span
        className={`mono shrink-0 tabular-nums ${
          strong ? "text-[17px] font-semibold text-white" : "text-[13px]"
        } ${tone === "neg" ? "text-[#FF453A]" : tone === "muted" ? "text-neutral-400" : "text-white"}`}
      >
        {value}
      </span>
    </div>
  );
}

function FactRow({
  label,
  children,
  sep = true,
}: {
  label: string;
  children: React.ReactNode;
  sep?: boolean;
}) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 ${
        sep ? "border-t border-white/[0.08]" : ""
      }`}
    >
      <span className="text-[13px] text-neutral-400">{label}</span>
      <div className="min-w-0 max-w-full text-right text-[13px] text-white">{children}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="px-1 pb-1.5 pt-5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
      {children}
    </h3>
  );
}

function LineRow({ line, currency }: { line: OrderLine; currency: Order["currency"] }) {
  const eachMinor = lineGrossMinor({ ...line, quantity: 1 });
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-2.5">
      <div className="min-w-0">
        <p className="text-[13.5px] leading-snug text-white">
          <span className="mono text-neutral-400">{line.quantity} ×</span> {line.name}
        </p>
        {line.modifiers.length > 0 && (
          <p className="mt-0.5 text-[11.5px] leading-snug text-neutral-500">
            {line.modifiers.map((m) => m.name).join(", ")}
          </p>
        )}
        {line.note && (
          <p className="mt-0.5 text-[11.5px] leading-snug text-neutral-500">{line.note}</p>
        )}
        {line.quantity > 1 && (
          <p className="mono mt-0.5 text-[11px] text-neutral-500">
            {fmtMinor(eachMinor, currency)} each
          </p>
        )}
      </div>
      <span className="mono shrink-0 text-[13.5px] text-white">
        {fmtMinor(lineGrossMinor(line), currency)}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The modal                                                           */
/* ------------------------------------------------------------------ */

export function OrderDetailModal({
  order,
  onClose,
}: {
  order: Order | null;
  onClose: () => void;
}) {
  const {
    charges,
    refunds,
    settings,
    submitRefund: submitMerchantRefund,
    openCharge,
  } = useMerchant();
  const { toast } = useToast();

  const orderId = order?.id ?? null;
  const [formOrderId, setFormOrderId] = useState<string | null>(orderId);
  const [confirming, setConfirming] = useState(false);
  const [amountText, setAmountText] = useState("");
  const [reason, setReason] = useState<RefundReason>("customer_request");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const orderCharges = useMemo(
    () => charges.filter((c) => c.orderId === orderId),
    [charges, orderId],
  );
  const settled = useMemo(
    () => orderCharges.find((c) => c.payment !== null) ?? null,
    [orderCharges],
  );
  /** The charge a customer could still pay right now, if this order has one. */
  const liveCharge = useMemo(
    () => orderCharges.find((c) => c.status === "awaiting") ?? null,
    [orderCharges],
  );
  const orderRefunds = useMemo(
    () =>
      refunds
        .filter((r) => r.orderId === orderId)
        .sort((a, b) => b.createdAt - a.createdAt),
    [orderId, refunds],
  );

  // A different order in the same mounted dialog starts from a clean form.
  if (orderId !== formOrderId) {
    setFormOrderId(orderId);
    setConfirming(false);
    setAmountText("");
    setReason("customer_request");
    setNote("");
    setError(null);
    setBusy(false);
  }

  if (!order) return null;

  const currency = order.currency;
  const totals = order.totals;
  const view = orderView(order, charges);
  const explorer = NETWORKS[order.network];
  const payment = settled?.payment ?? null;

  // Derived from the order's own figures rather than today's settings, so an
  // old receipt keeps describing the tax rules it was actually rung up under.
  const taxIncluded =
    totals.taxMinor > 0 &&
    totals.netMinor + totals.taxMinor === totals.grossMinor - totals.discountMinor;

  const refundedMinor: Minor = orderRefunds
    .filter((refund) => refund.submissionStatus === "confirmed")
    .reduce((sum, refund) => sum + refund.amountMinor, 0);
  const reservedRefundMinor: Minor = orderRefunds
    .filter(refundReservesFunds)
    .reduce((sum, refund) => sum + refund.amountMinor, 0);
  const pendingRefundMinor = reservedRefundMinor - refundedMinor;
  const remainingMinor: Minor = Math.max(0, totals.totalMinor - reservedRefundMinor);
  const canRefund = payment !== null && remainingMinor > 0;

  let requestedMinor = 0;
  let amountError: string | null = null;
  if (confirming) {
    try {
      requestedMinor = toMinor(amountText);
    } catch {
      requestedMinor = 0;
      amountError = "Enter an amount such as 4.50.";
    }
    if (!amountError && requestedMinor <= 0) {
      amountError = "Enter an amount greater than zero.";
    } else if (!amountError && requestedMinor > remainingMinor) {
      amountError = `Only ${fmtMinor(remainingMinor, currency)} is still refundable on this order.`;
    }
  }

  function showPaymentRequest(chargeId: string) {
    triggerHaptic("light");
    // The charge sheet is a dialog of its own; leaving this one open stacks two.
    onClose();
    openCharge(chargeId);
  }

  function openConfirm() {
    triggerHaptic("selection");
    setAmountText(minorToDecimal(remainingMinor));
    setReason("customer_request");
    setNote("");
    setError(null);
    setConfirming(true);
  }

  function closeConfirm() {
    triggerHaptic("selection");
    setConfirming(false);
    setError(null);
  }

  async function submitRefund() {
    if (!order || amountError || busy) return;
    triggerHaptic("light");
    setBusy(true);
    setError(null);
    try {
      const outcome = await submitMerchantRefund({
        orderId: order.id,
        amountMinor: requestedMinor,
        reason,
        note: note.trim() ? note.trim() : undefined,
      });
      if (outcome.kind === "requested") {
        triggerHaptic("warning");
        toast(`Sent ${fmtMinor(requestedMinor, currency)} for approval`, "info");
      } else if (outcome.refund.submissionStatus === "confirmed") {
        triggerHaptic("success");
        toast(`Refund confirmed for ${fmtMinor(requestedMinor, currency)}`, "success");
      } else if (outcome.refund.submissionStatus === "status_unknown") {
        triggerHaptic("warning");
        toast("Refund status unknown. Do not retry while its hash is being tracked.", "info");
      } else {
        triggerHaptic("medium");
        toast(`Refund submitted for ${fmtMinor(requestedMinor, currency)} and confirming`, "info");
      }
      setConfirming(false);
    } catch (cause) {
      triggerHaptic("error");
      setError(explainRefundFailure(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} wide dismissable={!busy}>
      <ModalHeader
        title={`Order #${order.number}`}
        subtitle={`${fmtWhen(order.createdAt)} · ${order.staffName} · ${order.terminalName}`}
        onClose={busy ? undefined : onClose}
      />

      <div className="p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <OrderStatusPill view={view} />
            <span className="mono text-[12px] text-neutral-500">{order.reference}</span>
          </div>
          <span className="mono text-[22px] font-semibold text-white">
            {fmtMinor(totals.totalMinor, currency)}
          </span>
        </div>

        {/* ---------------- receipt ---------------- */}

        <SectionTitle>Receipt</SectionTitle>
        <div className="panel py-1.5">
          {order.lines.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-neutral-500">
              This order was rung up without any lines.
            </p>
          ) : (
            order.lines.map((line) => (
              <LineRow key={line.id} line={line} currency={currency} />
            ))
          )}

          <div className="mt-1.5 border-t border-white/[0.08] pb-1 pt-2">
            <TotalRow label="Subtotal" value={fmtMinor(totals.grossMinor, currency)} />
            {totals.discountMinor > 0 && (
              <TotalRow
                label="Discount"
                value={`−${fmtMinor(totals.discountMinor, currency)}`}
                tone="neg"
              />
            )}
            {taxIncluded && (
              <TotalRow
                label="Net of tax"
                value={fmtMinor(totals.netMinor, currency)}
                tone="muted"
              />
            )}
            {Object.entries(totals.taxByRate).map(([rateId, minor]) => {
              const rate = settings.taxRates.find((r) => r.id === rateId);
              const name = rate ? `${rate.label} ${rate.percent} %` : `Tax (${rateId})`;
              return (
                <TotalRow
                  key={rateId}
                  label={taxIncluded ? `${name} · included` : name}
                  value={fmtMinor(minor, currency)}
                />
              );
            })}
            {totals.tipMinor > 0 && (
              <TotalRow label="Tip" value={fmtMinor(totals.tipMinor, currency)} />
            )}
          </div>

          <div className="mt-1 border-t border-white/[0.08] pb-2 pt-2.5">
            <TotalRow label="Total" value={fmtMinor(totals.totalMinor, currency)} strong />
            {refundedMinor > 0 && (
              <TotalRow
                label="Refunded"
                value={`−${fmtMinor(refundedMinor, currency)}`}
                tone="neg"
              />
            )}
            {pendingRefundMinor > 0 && (
              <TotalRow
                label="Refund pending"
                value={`−${fmtMinor(pendingRefundMinor, currency)}`}
                tone="muted"
              />
            )}
          </div>
        </div>

        {/* ---------------- payment ---------------- */}

        <SectionTitle>Payment</SectionTitle>
        {payment && (view === "underpaid" || view === "overpaid") && (
          <div className="pb-2.5">
            <Notice tone="warn">
              {view === "underpaid"
                ? "Less arrived than this charge asked for, so the order is still open. Take the difference, or refund what came in."
                : "More arrived than this charge asked for. The surplus can be sent back from here."}
            </Notice>
          </div>
        )}
        {payment ? (
          <div className="panel">
            <FactRow label="Received" sep={false}>
              <span className="mono text-[15.5px] font-semibold text-[#30D158]">
                {fmtAmount(payment.amount)} {payment.asset.code}
              </span>
            </FactRow>
            <FactRow label="Payer">
              <HashValue value={payment.from} className="text-[12.5px] text-neutral-300" />
            </FactRow>
            <FactRow label="Transaction">
              <span className="flex flex-wrap items-center justify-end gap-2">
                <HashValue
                  value={payment.transactionHash}
                  className="text-[12.5px] text-neutral-300"
                />
                <a
                  href={explorer.explorerTxUrl(payment.transactionHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link inline-flex items-center gap-1 text-[12px] font-semibold"
                >
                  Explorer
                  <IconExternal size={11} />
                </a>
              </span>
            </FactRow>
            <FactRow label="Memo">
              {payment.memo ? (
                <span className="mono text-[12.5px] text-neutral-300">{payment.memo}</span>
              ) : (
                <span className="text-[12.5px] text-neutral-500">No memo</span>
              )}
            </FactRow>
            <FactRow label="Filed by">
              <span className="text-[12.5px] text-neutral-300">{LANE_LABEL[payment.lane]}</span>
            </FactRow>
            <FactRow label="Ledger">
              <span className="mono text-[12.5px] text-neutral-300">
                {payment.ledger.toLocaleString("en-US")}
              </span>
            </FactRow>
          </div>
        ) : (
          <Notice tone={view === "expired" || view === "voided" ? "info" : "warn"}>
            {view === "voided"
              ? "This order was voided before anything was paid."
              : view === "expired"
                ? "The charge for this order expired before a payment arrived. Nothing was taken."
                : "No payment has been matched to this order yet. Anything that arrives with the reference above will be filed here automatically."}
          </Notice>
        )}

        {liveCharge && (
          <div className="pt-3">
            <Button className="w-full" onClick={() => showPaymentRequest(liveCharge.id)}>
              <IconQr size={15} />
              Show the payment request
            </Button>
          </div>
        )}

        {/* ---------------- refunds already issued ---------------- */}

        {orderRefunds.length > 0 && (
          <>
            <SectionTitle>Refunds issued</SectionTitle>
            <div className="panel">
              {orderRefunds.map((refund, i) => (
                <div
                  key={refund.id}
                  className={`px-4 py-3 ${i > 0 ? "border-t border-white/[0.08]" : ""}`}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="mono text-[14.5px] font-semibold text-[#FF453A]">
                      −{fmtMinor(refund.amountMinor, currency)}
                    </span>
                    <span className="mono text-[12px] text-neutral-400">
                      {fmtAmount(refund.amount)} {refund.asset.code}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[12px] text-neutral-400">
                    {REASON_LABEL[refund.reason]} · {fmtWhen(refund.createdAt)}
                  </p>
                  <p
                    className={`mt-0.5 text-[11.5px] font-semibold ${
                      refund.submissionStatus === "confirmed"
                        ? "text-[#30D158]"
                        : refund.submissionStatus === "failed"
                          ? "text-[#FF6961]"
                          : "text-[#FF9F0A]"
                    }`}
                  >
                    {REFUND_SUBMISSION_LABEL[refund.submissionStatus]}
                  </p>
                  {refund.note && (
                    <p className="mt-0.5 text-[12px] text-neutral-500">{refund.note}</p>
                  )}
                  {refund.transactionHash ? (
                    <span className="mt-1.5 flex flex-wrap items-center gap-2">
                      <HashValue
                        value={refund.transactionHash}
                        className="text-[12px] text-neutral-500"
                      />
                      <a
                        href={NETWORKS[refund.network].explorerTxUrl(refund.transactionHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="link inline-flex items-center gap-1 text-[11.5px] font-semibold"
                      >
                        Explorer
                        <IconExternal size={10} />
                      </a>
                    </span>
                  ) : (
                    <p className="mt-1 text-[12px] text-neutral-500">
                      This refund has no transaction hash on record.
                    </p>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {/* ---------------- refund action ---------------- */}

        {payment && (
          <div className="pt-5">
            {!canRefund ? (
              <p className="text-center text-[12.5px] text-neutral-500">
                This order has been refunded in full.
              </p>
            ) : !confirming ? (
              <Button variant="secondary" className="w-full" onClick={openConfirm}>
                Issue a refund
              </Button>
            ) : (
              <div className="panel-inset space-y-3 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[13.5px] font-semibold text-white">Refund this order</p>
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic("selection");
                      setAmountText(minorToDecimal(remainingMinor));
                    }}
                    className="chip focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A84FF]"
                  >
                    Full · {fmtMinor(remainingMinor, currency)}
                  </button>
                </div>

                <Field
                  label="Amount"
                  hint={`${fmtMinor(remainingMinor, currency)} refundable`}
                  error={amountError ?? undefined}
                >
                  <input
                    className="input input-mono"
                    inputMode="decimal"
                    autoComplete="off"
                    value={amountText}
                    onChange={(e) => setAmountText(e.target.value)}
                    disabled={busy}
                  />
                </Field>

                <div>
                  <span className="field-label">Reason</span>
                  <Select
                    ariaLabel="Refund reason"
                    value={reason}
                    onChange={(next) => setReason(next as RefundReason)}
                    options={REFUND_REASONS.map((r) => ({ value: r.value, label: r.label }))}
                    disabled={busy}
                  />
                </div>

                <Field label="Note" hint="Optional">
                  <input
                    className="input"
                    autoComplete="off"
                    placeholder="What happened?"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    disabled={busy}
                  />
                </Field>

                <p className="text-[12px] leading-relaxed text-neutral-400">
                  The refund goes back to the payer in {payment.asset.code} as an ordinary outbound
                  payment, signed by this wallet at the rate this charge was quoted at.
                </p>

                {error && <ErrorText message={error} />}

                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    className="flex-1"
                    onClick={closeConfirm}
                    disabled={busy}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    className="flex-1"
                    onClick={() => void submitRefund()}
                    disabled={Boolean(amountError) || busy}
                    aria-busy={busy}
                  >
                    {busy && <Spinner size={14} />}
                    {busy ? "Sending the refund" : `Refund ${fmtMinor(requestedMinor, currency)}`}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
