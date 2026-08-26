"use client";

import { useState } from "react";
import { useMerchant } from "@/hooks/useMerchant";
import { triggerHaptic } from "@/lib/haptics";
import { fmtMinor } from "@/lib/merchant/money";
import type { MatchedPayment, Minor } from "@/lib/merchant/types";
import type { FiatCurrency } from "@/lib/format";
import { useToast } from "../Toast";
import { Button, ErrorText, HashValue, Modal, ModalHeader, Notice } from "../ui";
import { IconAlert, IconCheck } from "../icons";
import { IconInfo, IconRefund, IconXCircle } from "./icons";

interface DuplicateArrival {
  payment: Omit<MatchedPayment, "lane">;
  amountMinor: Minor;
}

type Choice = "none" | "refund" | "dismiss";

function clockTime(iso: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "Unknown time";
  return new Date(at).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function actionError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message.trim() : "";
  if (/vault|locked|not available in the current session/i.test(message)) {
    return "Unlock the till wallet to sign this refund, then try again.";
  }
  if (/watch-only/i.test(message)) {
    return "The receiving account is watch-only. Switch to the signing account that received this payment.";
  }
  if (/underfunded|insufficient/i.test(message)) {
    return "The till account does not currently hold enough of this asset to return the payment.";
  }
  return message || "This payment could not be resolved.";
}

export function DuplicateChargeSheet({
  open,
  onClose,
  paymentId,
}: {
  open: boolean;
  onClose: () => void;
  paymentId: string | null;
}) {
  const {
    charges,
    orders,
    paymentReconciliations,
    settings,
    submitPaymentRefund,
    dismissUnmatched,
  } = useMerchant();
  const { toast } = useToast();
  const [choice, setChoice] = useState<Choice>("none");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!open || !paymentId) return null;
  const resolvedPaymentId = paymentId;

  const reconciliation = paymentReconciliations.find(
    (entry) => entry.id === resolvedPaymentId && entry.outcome === "duplicate",
  );
  const charge = reconciliation?.chargeId
    ? charges.find((entry) => entry.id === reconciliation.chargeId) ?? null
    : null;
  const order = reconciliation?.orderId
    ? orders.find((entry) => entry.id === reconciliation.orderId) ?? null
    : null;
  const duplicate = reconciliation?.amountMinor === null || !reconciliation
    ? null
    : {
        payment: reconciliation.payment,
        amountMinor: reconciliation.amountMinor,
      };
  const settled = charge?.payment
    ? { payment: charge.payment, amountMinor: charge.amountMinor }
    : null;

  function close(): void {
    if (busy) return;
    resetAndClose();
  }

  function resetAndClose(): void {
    setChoice("none");
    setNote("");
    setError("");
    onClose();
  }

  async function refund(): Promise<void> {
    if (!duplicate || busy) return;
    setBusy(true);
    setError("");
    try {
      const outcome = await submitPaymentRefund(resolvedPaymentId, note);
      if (outcome.kind === "requested") {
        toast(`Refund approval requested for ${fmtMinor(duplicate.amountMinor, settings.currency)}`);
        triggerHaptic("light");
        resetAndClose();
        return;
      }
      if (outcome.refund.submissionStatus === "failed") {
        setError("The network rejected this refund. The payment remains in review and is safe to retry.");
        triggerHaptic("error");
        return;
      }
      const confirmed = outcome.refund.submissionStatus === "confirmed";
      toast(
        confirmed
          ? `Duplicate refund confirmed for ${duplicate.payment.amount} ${duplicate.payment.asset.code}`
          : outcome.refund.submissionStatus === "status_unknown"
            ? "Refund status is unknown. Its transaction is tracked; do not retry."
            : "Refund submitted and confirming on Stellar.",
        confirmed ? "success" : "info",
      );
      triggerHaptic(confirmed ? "success" : "light");
      resetAndClose();
    } catch (cause) {
      setError(actionError(cause));
      triggerHaptic("error");
    } finally {
      setBusy(false);
    }
  }

  function dismiss(): void {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      dismissUnmatched(resolvedPaymentId);
      toast("Duplicate payment dismissed with a staff audit record");
      triggerHaptic("warning");
      resetAndClose();
    } catch (cause) {
      setError(actionError(cause));
      triggerHaptic("error");
    } finally {
      setBusy(false);
    }
  }

  if (!reconciliation || !charge || !order || !duplicate || !settled) {
    return (
      <Modal open onClose={close}>
        <ModalHeader title="Duplicate payment" onClose={close} />
        <div className="space-y-4 p-4 sm:p-6">
          <Notice tone="warn">
            The original payment record is no longer complete enough to resolve safely. Keep this
            item in review and check the Stellar transaction before taking action.
          </Notice>
          <Button variant="secondary" className="w-full" onClick={close}>
            Close
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={close} wide>
      <ModalHeader
        title="Paid twice"
        subtitle={`Order #${order.number} · ${charge.reference}`}
        onClose={close}
      />

      <div className="space-y-4 p-4 sm:p-6">
        <Notice tone="warn">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 shrink-0 text-[#FF9F0A]">
              <IconAlert size={15} />
            </span>
            <div>
              <p className="font-semibold text-white">A second payment used a settled reference</p>
              <p className="mt-1 text-neutral-300">
                The first payment remains attached to order #{order.number}. This arrival is held
                separately until a staff member refunds or dismisses it.
              </p>
            </div>
          </div>
        </Notice>

        <div className="grid gap-3 sm:grid-cols-2">
          <PaymentCard
            arrival={settled}
            currency={settings.currency}
            tone="#30D158"
            heading="Settled the order"
            glyph={<IconCheck size={13} />}
          />
          <PaymentCard
            arrival={duplicate}
            currency={settings.currency}
            tone="#FF9F0A"
            heading="Duplicate arrival"
            glyph={<IconAlert size={13} />}
          />
        </div>

        <ErrorText message={error} />

        {choice === "none" && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <ChoiceCard
                title="Refund the duplicate"
                body={`Return exactly ${duplicate.payment.amount} ${duplicate.payment.asset.code} to the address it came from. The till wallet must review and sign the payment.`}
                action="Review refund"
                icon={<IconRefund size={16} />}
                onPick={() => {
                  triggerHaptic("selection");
                  setError("");
                  setChoice("refund");
                }}
              />
              <ChoiceCard
                title="Dismiss from review"
                body="Remove this arrival from the action tray without attaching it to a sale or moving funds. The staff decision remains in the reconciliation audit."
                action="Review dismissal"
                icon={<IconXCircle size={16} />}
                onPick={() => {
                  triggerHaptic("selection");
                  setError("");
                  setChoice("dismiss");
                }}
              />
            </div>
            <p className="flex items-start gap-2 px-1 text-[12px] leading-relaxed text-neutral-500">
              <IconInfo size={13} className="mt-0.5 shrink-0" />
              Closing this sheet leaves the duplicate in the tray. The till never attaches or
              returns a second payment automatically.
            </p>
          </>
        )}

        {choice === "refund" && (
          <div className="space-y-3">
            <div className="list-group">
              <Fact
                label="Sending back"
                value={`${duplicate.payment.amount} ${duplicate.payment.asset.code}`}
                mono
              />
              <Fact label="Recorded value" value={fmtMinor(duplicate.amountMinor, settings.currency)} mono sep />
              <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] px-4 py-3">
                <span className="shrink-0 text-[13px] text-neutral-400">To</span>
                <HashValue value={duplicate.payment.from} className="text-[12.5px] text-neutral-200" />
              </div>
              <Fact label="Reason" value="Duplicate payment" sep />
            </div>

            <div className="space-y-1.5">
              <label className="field-label !pb-0" htmlFor="duplicate-refund-note">
                Audit note <span className="font-normal text-neutral-500">Optional</span>
              </label>
              <input
                id="duplicate-refund-note"
                type="text"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Customer paid twice at the counter"
                className="input text-base sm:text-[14px]"
                autoComplete="off"
              />
            </div>

            <Notice>
              The exact incoming asset amount will be returned as a new Stellar payment. If this
              exceeds the active staff member&rsquo;s ceiling, it goes to Refund requests first.
            </Notice>

            <div className="grid gap-2 sm:grid-cols-2">
              <Button variant="ghost" disabled={busy} onClick={() => setChoice("none")}>
                Back
              </Button>
              <Button loading={busy} onClick={() => void refund()}>
                Sign or request approval
              </Button>
            </div>
          </div>
        )}

        {choice === "dismiss" && (
          <div className="space-y-3">
            <Notice tone="warn">
              Dismissal does not return money and does not attach this payment to order #{order.number}.
              It removes the tray alert and records who made the decision.
            </Notice>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button variant="ghost" disabled={busy} onClick={() => setChoice("none")}>
                Keep in tray
              </Button>
              <Button variant="danger" loading={busy} onClick={dismiss}>
                Dismiss with audit
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function PaymentCard({
  arrival,
  currency,
  tone,
  heading,
  glyph,
}: {
  arrival: DuplicateArrival;
  currency: FiatCurrency;
  tone: string;
  heading: string;
  glyph: React.ReactNode;
}) {
  const { payment } = arrival;
  return (
    <div
      className="rounded-2xl border p-4"
      style={{ borderColor: `${tone}4d`, backgroundColor: `${tone}14` }}
    >
      <p className="flex items-center gap-2 text-[12.5px] font-semibold" style={{ color: tone }}>
        <span
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: `${tone}26` }}
        >
          {glyph}
        </span>
        {heading}
      </p>
      <p className="mono mt-2.5 text-[17px] font-semibold text-white">
        {payment.amount} {payment.asset.code}
      </p>
      <p className="mono text-[12.5px] text-neutral-400">
        {fmtMinor(arrival.amountMinor, currency)}
      </p>

      <div className="mt-3 space-y-1.5 border-t border-white/[0.08] pt-2.5">
        <CardRow label="At">{clockTime(payment.createdAt)}</CardRow>
        <CardRow label="Ledger"><span className="mono">{payment.ledger}</span></CardRow>
        <CardRow label="Memo"><span className="mono">{payment.memo ?? "None"}</span></CardRow>
        <CardRow label="From">
          <HashValue value={payment.from} head={4} tail={4} className="text-[12px] text-neutral-200" />
        </CardRow>
        <CardRow label="Transaction">
          <HashValue
            value={payment.transactionHash}
            head={4}
            tail={4}
            className="text-[12px] text-neutral-200"
          />
        </CardRow>
      </div>
    </div>
  );
}

function CardRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[12px]">
      <span className="shrink-0 text-neutral-500">{label}</span>
      <span className="min-w-0 truncate text-right text-neutral-300">{children}</span>
    </div>
  );
}

function ChoiceCard({
  title,
  body,
  action,
  icon,
  onPick,
}: {
  title: string;
  body: string;
  action: string;
  icon: React.ReactNode;
  onPick: () => void;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <p className="flex items-center gap-2 text-[14px] font-semibold text-white">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-neutral-300">
          {icon}
        </span>
        {title}
      </p>
      <p className="mt-2 flex-1 text-[12.5px] leading-relaxed text-neutral-400">{body}</p>
      <Button variant="secondary" className="mt-3 w-full" onClick={onPick}>
        {action}
      </Button>
    </div>
  );
}

function Fact({
  label,
  value,
  mono = false,
  sep = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  sep?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 px-4 py-3 ${sep ? "border-t border-white/[0.08]" : ""}`}>
      <span className="shrink-0 text-[13px] text-neutral-400">{label}</span>
      <span className={`${mono ? "mono" : ""} text-right text-[13px] font-medium text-white`}>
        {value}
      </span>
    </div>
  );
}
