"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { triggerHaptic } from "@/lib/haptics";
import {
  useMerchantConfiguration,
  useMerchantRecords,
  useMerchantStatus,
} from "@/hooks/useMerchant";
import { LIVE_SECOND_MS, useLiveNow } from "@/hooks/useLiveNow";
import { useWakeLock } from "@/hooks/useWakeLock";
import { assetKey, quoteFor, secondsRemaining } from "@/lib/merchant/charge";
import { fmtMinor, fromStroops, minorForAssetAmount, toStroops } from "@/lib/merchant/money";
import {
  merchantPaymentTransport,
  type MerchantPaymentTransport,
} from "@/lib/merchant/routing";
import type { Charge, ChargeQuote, MatchedPayment } from "@/lib/merchant/types";
import { useToast } from "../Toast";
import {
  Button,
  ConfirmModal,
  CopyButton,
  HashValue,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Notice,
  SegmentedControl,
  Spinner,
  useRetainedForExit,
} from "../ui";
import { IconAlert, IconCheck, IconRefresh } from "../icons";

/** Seconds below which the countdown turns amber. */
const URGENT_SECONDS = 60;

function formatCountdown(total: number): string {
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function clockTime(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Distinct labels for the asset switcher, so two issuers of one code stay apart. */
function quoteLabel(quote: ChargeQuote, quotes: ChargeQuote[]): string {
  const clash = quotes.filter((q) => q.asset.code === quote.asset.code).length > 1;
  if (!clash || !quote.asset.issuer) return quote.asset.code;
  return `${quote.asset.code} ${quote.asset.issuer.slice(0, 4)}`;
}

/** The gap between what was asked for and what arrived, in the asset and in the shop's money. */
function difference(
  payment: MatchedPayment,
  quote: ChargeQuote,
): { amount: string; minor: number } {
  const delta = toStroops(payment.amount) - toStroops(quote.amount);
  const magnitude = delta < BigInt(0) ? -delta : delta;
  const amount = fromStroops(magnitude);
  return { amount, minor: minorForAssetAmount(amount, quote.unitPriceMinorE6) };
}

export function ChargeSheet({ charge, onClose }: { charge: Charge | null; onClose: () => void }) {
  // The charge stays rendered through the exit; a live request keeps the shell
  // busy so it is never dismissed by accident (see the note in the body).
  const shown = useRetainedForExit(charge);
  const [busyReason, setBusyReason] = useState<string | null>(null);
  return (
    <Modal
      open={charge !== null}
      onClose={onClose}
      wide
      busy={busyReason !== null}
      busyReason={busyReason ?? undefined}
    >
      {shown && (
        <ChargeSheetInner
          key={shown.id}
          charge={shown}
          onClose={onClose}
          onBusyChange={setBusyReason}
        />
      )}
    </Modal>
  );
}

const LIVE_REQUEST_BUSY = "A live payment request is showing. Cancel it or wait for it to settle.";
const VOIDING_BUSY = "Wait for the charge to be cancelled before closing.";

function ChargeSheetInner({
  charge,
  onClose,
  onBusyChange,
}: {
  charge: Charge;
  onClose: () => void;
  onBusyChange: (reason: string | null) => void;
}) {
  const { payUriFor, voidCharge, orderFor } = useMerchantRecords();
  const { settings } = useMerchantConfiguration();
  const { watchedLedger, watchError, pollNow } = useMerchantStatus();
  const { toast } = useToast();

  const [selectedKey, setSelectedKey] = useState(() => assetKey(charge.quotes[0].asset));
  const [requestTransport, setRequestTransport] =
    useState<MerchantPaymentTransport>("muxed");
  const [qr, setQr] = useState<{ uri: string; dataUrl: string } | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const now = useLiveNow(LIVE_SECOND_MS);

  const quote =
    charge.quotes.find((q) => assetKey(q.asset) === selectedKey) ?? charge.quotes[0];
  const payment = charge.payment;
  const paidQuote = payment ? quoteFor(charge, payment.asset) : null;
  const payUri = payUriFor(charge, quote.asset, requestTransport);
  const receivingAccountChanged = settings.receivingPublicKey !== charge.destination;
  const requestTarget = merchantPaymentTransport(
    charge.destination,
    charge.routingId,
    requestTransport,
  );
  const order = orderFor(charge.id);
  const awaiting = charge.status === "awaiting";
  const requestAvailable = awaiting && !receivingAccountChanged && payUri !== null;
  const wakeLock = useWakeLock(requestAvailable);

  /* A request in flight is never dismissed by accident: Escape, the backdrop and
     the header cross are all held, because clearTicket() has already emptied the
     till and the QR would be the only way back to a customer who is mid-payment.
     Both ways out of an open charge are spelled out at the foot of the sheet. */
  const busyReason = voiding ? VOIDING_BUSY : requestAvailable ? LIVE_REQUEST_BUSY : null;
  useEffect(() => {
    onBusyChange(busyReason);
    return () => onBusyChange(null);
  }, [busyReason, onBusyChange]);

  async function cancelCharge() {
    if (voiding) return;
    setVoiding(true);
    try {
      await voidCharge(charge.id);
      setConfirmingCancel(false);
      triggerHaptic("success");
      onClose();
    } catch (error) {
      setConfirmingCancel(false);
      triggerHaptic("error");
      toast(error instanceof Error ? error.message : "The charge could not be cancelled.", "error", {
        silent: true,
      });
    } finally {
      setVoiding(false);
    }
  }
  const seconds = secondsRemaining(charge, now);
  const urgent = seconds < URGENT_SECONDS;
  const gap = payment && paidQuote ? difference(payment, paidQuote) : null;
  /** A closed charge shows the asset it was actually settled in, not a pick list. */
  const shownQuote = !awaiting && paidQuote ? paidQuote : quote;
  /** The window this charge actually held, not whatever the setting says today. */
  const heldMinutes = Math.max(1, Math.round((charge.expiresAt - charge.createdAt) / 60_000));

  /* The QR is a real encoding of the SEP-7 request, regenerated per asset. */
  useEffect(() => {
    if (!payUri) return;
    let alive = true;
    void (async () => {
      try {
        const dataUrl = await QRCode.toDataURL(payUri, {
          width: 440,
          margin: 1.5,
          color: { dark: "#000000", light: "#ffffff" },
        });
        if (alive) setQr({ uri: payUri, dataUrl });
      } catch {
        if (alive) setQr(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [payUri]);

  /* Never show one asset's QR while another asset's is still encoding. */
  const qrDataUrl = qr !== null && qr.uri === payUri ? qr.dataUrl : null;

  /* Announce the moment the charge settles, expires or comes up short. */
  const previousStatus = useRef(charge.status);
  useEffect(() => {
    if (previousStatus.current === charge.status) return;
    previousStatus.current = charge.status;
    if (charge.status === "paid") {
      triggerHaptic("success");
      toast("Payment received", "success", { silent: true });
    } else if (charge.status === "expired") {
      triggerHaptic("warning");
      toast("Charge expired", "error", { silent: true });
    } else if (charge.status === "underpaid" || charge.status === "overpaid") {
      triggerHaptic("warning");
      toast(charge.status === "underpaid" ? "Payment came up short" : "Payment came in over", "error", {
        silent: true,
      });
    }
  }, [charge.status, toast]);

  const headline = useMemo(() => {
    if (receivingAccountChanged && charge.status === "awaiting") {
      return "Receiving account changed";
    }
    switch (charge.status) {
      case "paid":
        return "Paid in full";
      case "underpaid":
        return "Short payment received";
      case "overpaid":
        return "Overpayment received";
      case "expired":
        return "Charge expired";
      case "voided":
        return "Charge cancelled";
      default:
        return "Watching for payment";
    }
  }, [charge.status, receivingAccountChanged]);

  const title = useMemo(() => {
    switch (charge.status) {
      case "paid":
        return "Paid";
      case "underpaid":
        return "Underpaid";
      case "overpaid":
        return "Overpaid";
      case "expired":
        return "Expired";
      case "voided":
        return "Cancelled";
      default:
        return "Charge";
    }
  }, [charge.status]);

  const settled = charge.status === "paid";
  const tone =
    settled
      ? "#30D158"
      : receivingAccountChanged ||
          charge.status === "underpaid" ||
          charge.status === "overpaid" ||
          charge.status === "expired"
        ? "#FF9F0A"
        : "#0A84FF";

  return (
    <>
      <ModalHeader
        title={title}
        subtitle={order ? `Order ${order.number} · ${charge.reference}` : charge.reference}
        onClose={onClose}
      />

      <ModalBody>
        {/* ---------- what is owed ---------- */}
        <div className="text-center">
          <p className="mono text-[34px] font-semibold leading-none text-white">
            {fmtMinor(charge.amountMinor, charge.currency)}
          </p>
          {/* On a settled charge the green card already carries the asset figure. */}
          {!settled && (
            <p className="mono mt-2 text-[13.5px] text-neutral-400">
              {shownQuote.amount} {shownQuote.asset.code}
            </p>
          )}
        </div>

        {/* Switching asset is only a choice while the request is still open. */}
        {requestAvailable && charge.quotes.length > 1 && (
          <div className="mx-auto w-full max-w-[320px]">
            <SegmentedControl
              ariaLabel="Payment asset"
              value={selectedKey}
              onChange={setSelectedKey}
              options={charge.quotes.map((q) => ({
                label: quoteLabel(q, charge.quotes),
                value: assetKey(q.asset),
              }))}
            />
          </div>
        )}

        {requestAvailable && (
          <div className="mx-auto w-full max-w-[320px]">
            <SegmentedControl
              ariaLabel="Payment request compatibility"
              value={requestTransport}
              onChange={setRequestTransport}
              options={[
                { label: "Standard", value: "muxed" },
                { label: "Legacy", value: "memo-id" },
              ]}
            />
          </div>
        )}

        {/* ---------- the live status ---------- */}
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.04] px-4 py-3">
          <div role="status" aria-live="polite" className="flex min-w-0 items-center gap-2.5">
            {requestAvailable ? (
              <span className="text-[#0A84FF]">
                <Spinner size={14} />
              </span>
            ) : (
              <span
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: `${tone}26`, color: tone }}
              >
                {settled ? <IconCheck size={13} /> : <IconAlert size={13} />}
              </span>
            )}
            <span className="truncate text-[13.5px] font-medium text-white">{headline}</span>
          </div>
          {requestAvailable && (
            <div className="shrink-0 text-right">
              <span
                aria-hidden="true"
                className="mono text-[15.5px] font-semibold"
                style={{ color: urgent ? "#FF9F0A" : "#ffffff" }}
              >
                {formatCountdown(seconds)}
              </span>
              <span className="sr-only">Expires at {clockTime(charge.expiresAt)}</span>
              {watchedLedger !== null && (
                <p className="mono text-[10.5px] text-neutral-500">Ledger {watchedLedger}</p>
              )}
            </div>
          )}
        </div>

        {requestAvailable && (wakeLock.state === "error" || wakeLock.state === "released") && (
          <div className="flex justify-center">
            <Button variant="ghost" className="btn-sm" onClick={wakeLock.retry}>
              Screen may sleep · Retry
            </Button>
          </div>
        )}

        {requestAvailable && watchError && (
          <Notice tone="warn">
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 shrink-0 text-[#FF9F0A]">
                <IconAlert size={15} />
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-white">Horizon is not answering</p>
                <p className="mt-1 text-neutral-300">{watchError}</p>
                <p className="mt-1 text-neutral-400">
                  The charge is still valid. The customer can pay now, and the payment will be
                  picked up as soon as the connection comes back.
                </p>
                <Button variant="secondary" className="mt-2.5" onClick={() => void pollNow()}>
                  <IconRefresh size={13} /> Check again
                </Button>
              </div>
            </div>
          </Notice>
        )}

        {/* ---------- the request ---------- */}
        {requestAvailable && (
          <div className="space-y-4">
            <div className="flex justify-center">
              <div className="rounded-3xl bg-white p-3.5 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.9)]">
                {qrDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={qrDataUrl}
                    alt={`Payment request for ${quote.amount} ${quote.asset.code}`}
                    width={210}
                    height={210}
                    className="rounded-2xl"
                  />
                ) : (
                  <div className="skeleton h-[210px] w-[210px] rounded-2xl" />
                )}
              </div>
            </div>

            <div className="panel-inset px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                Payment route
              </p>
              <div className="mt-1.5 flex items-center justify-between gap-3">
                <span className="text-[15px] font-semibold text-white">
                  {requestTransport === "muxed" ? "Included in the address" : "Legacy MEMO_ID"}
                </span>
                {requestTransport === "memo-id" && (
                  <CopyButton value={charge.routingId} label="Copy ID" />
                )}
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-neutral-400">
                {requestTransport === "muxed"
                  ? "The muxed Stellar address files the payment automatically. No memo is required."
                  : `Use the shop account and MEMO_ID ${charge.routingId}. The QR carries both fields for legacy and hardware-wallet flows, including Trezor.`}
              </p>
            </div>

            <div className="list-group">
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="shrink-0 text-[13px] text-neutral-400">To</span>
                <HashValue
                  value={requestTarget.destination}
                  className="text-[12.5px] text-neutral-200"
                />
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] px-4 py-3">
                <span className="shrink-0 text-[13px] text-neutral-400">Order reference</span>
                <span className="mono truncate text-[12.5px] text-neutral-200">
                  {charge.reference}
                </span>
              </div>
              {payUri && (
                <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] px-4 py-3">
                  <span className="shrink-0 text-[13px] text-neutral-400">Payment link</span>
                  <CopyButton value={payUri} label="Copy link" />
                </div>
              )}
            </div>

            {/* Leaving and cancelling must not read alike. One frees the till for
                the next customer, the other kills the request the customer is
                looking at, so the copy says what each does to the charge. */}
            <div className="border-t border-white/[0.08]">
              <ModalFooter
                stack
                primary={
                  <Button variant="danger" onClick={() => setConfirmingCancel(true)}>
                    Cancel charge
                  </Button>
                }
                secondary={
                  <Button variant="ghost" onClick={onClose}>
                    Leave it running
                  </Button>
                }
              />
              <p className="mt-3 text-center text-[12px] leading-relaxed text-neutral-400">
                Leaving keeps it watching · find it in Orders. The till is free for the next
                customer, and the payment files itself against this order when it lands.
                Cancelling ends the request.
              </p>
            </div>
          </div>
        )}

        {awaiting && !requestAvailable && (
          <div className="space-y-3">
            <Notice tone="warn">
              <p className="font-semibold text-white">
                {receivingAccountChanged
                  ? "Receiving account changed"
                  : "This payment request is unavailable"}
              </p>
              <p className="mt-1 text-neutral-300">
                {receivingAccountChanged
                  ? "This charge points to the previous receiving account, so its QR, address, and automatic settlement are paused. Restore that account or cancel this charge and ring up a replacement."
                  : "The saved charge cannot produce a complete payment request. Cancel it and ring up a replacement before asking the customer to pay."}
              </p>
            </Notice>
            <ModalFooter
              primary={
                <Button variant="danger" onClick={() => setConfirmingCancel(true)}>
                  Cancel charge
                </Button>
              }
            />
          </div>
        )}

        {/* ---------- settled ---------- */}
        {settled && payment && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-[#30D158]/30 bg-[#30D158]/10 p-4 text-center">
              <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[#30D158]/20 text-[#30D158]">
                <IconCheck size={22} />
              </span>
              <p className="mono mt-2.5 text-[17px] font-semibold text-[#30D158]">
                {payment.amount} {payment.asset.code}
              </p>
              <p className="mt-1 text-[13px] text-neutral-300">
                received in full, {fmtMinor(charge.amountMinor, charge.currency)} on the books.
              </p>
            </div>
            <PaymentFacts payment={payment} />
          </div>
        )}

        {/* ---------- short ---------- */}
        {charge.status === "underpaid" && payment && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-[#FF9F0A]/30 bg-[#FF9F0A]/10 p-4">
              <p className="text-[13.5px] font-semibold text-white">
                {gap
                  ? `Short by ${gap.amount} ${payment.asset.code}`
                  : `Short of ${fmtMinor(charge.amountMinor, charge.currency)}`}
              </p>
              {gap && (
                <p className="mono mt-1 text-[13px] text-[#FF9F0A]">
                  {fmtMinor(gap.minor, charge.currency)} still owed
                </p>
              )}
              <p className="mt-2.5 text-[13px] leading-relaxed text-neutral-300">
                {payment.amount} {payment.asset.code} arrived against a request for{" "}
                {paidQuote
                  ? `${paidQuote.amount} ${payment.asset.code}`
                  : fmtMinor(charge.amountMinor, charge.currency)}
                . Two ways out: ask the customer for the difference — a second
                payment lands in the unmatched tray, where you can attach it to this order — or take
                the rest in cash. The order stays open until you do one of them.
              </p>
            </div>
            <PaymentFacts payment={payment} />
          </div>
        )}

        {/* ---------- over ---------- */}
        {charge.status === "overpaid" && payment && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-[#FF9F0A]/30 bg-[#FF9F0A]/10 p-4">
              <p className="text-[13.5px] font-semibold text-white">
                {gap
                  ? `Over by ${gap.amount} ${payment.asset.code}`
                  : `More than ${fmtMinor(charge.amountMinor, charge.currency)} arrived`}
              </p>
              {gap && (
                <p className="mono mt-1 text-[13px] text-[#FF9F0A]">
                  {fmtMinor(gap.minor, charge.currency)} above the charge
                </p>
              )}
              <p className="mt-2.5 text-[13px] leading-relaxed text-neutral-300">
                {payment.amount} {payment.asset.code} arrived against a request for{" "}
                {paidQuote
                  ? `${paidQuote.amount} ${payment.asset.code}`
                  : fmtMinor(charge.amountMinor, charge.currency)}
                . Nothing more is owed to you: hand the difference back in cash,
                or refund it to the payer from this order. Refunding sends an ordinary payment from
                the till account.
              </p>
            </div>
            <PaymentFacts payment={payment} />
          </div>
        )}

        {/* ---------- expired ---------- */}
        {charge.status === "expired" && (
          <div className="space-y-4">
            <Notice tone="warn">
              <p className="font-semibold text-white">The quote is no longer held</p>
              <p className="mt-1 text-neutral-300">
                This request was good for {heldMinutes} {heldMinutes === 1 ? "minute" : "minutes"}{" "}
                and that window has closed, so the asset amount on it is stale. Ring the sale up
                again to quote a fresh one.
              </p>
              <p className="mt-1 text-neutral-400">
                If the customer pays against the old QR anyway, the payment arrives in the unmatched
                tray and can be attached to the order by hand.
              </p>
            </Notice>
          </div>
        )}

        {/* ---------- cancelled ---------- */}
        {charge.status === "voided" && (
          <Notice>
            This charge was cancelled, so nothing is expected against {charge.reference}.
          </Notice>
        )}

        {/* One way out of every closed state, so the sheet never dead-ends. */}
        {!awaiting && (
          <ModalFooter
            primary={
              <Button onClick={onClose}>
                {charge.status === "paid" || charge.status === "expired"
                  ? "New charge"
                  : "Back to the till"}
              </Button>
            }
          />
        )}
      </ModalBody>

      <ConfirmModal
        open={confirmingCancel}
        title="Cancel this charge?"
        message="Ends the request the customer is looking at. Anything paid against this payment route afterwards arrives in the unmatched tray instead."
        confirmLabel="Cancel charge"
        cancelLabel="Keep it"
        destructive
        busy={voiding}
        onClose={() => setConfirmingCancel(false)}
        onConfirm={() => void cancelCharge()}
      />
    </>
  );
}

function PaymentFacts({ payment }: { payment: MatchedPayment }) {
  return (
    <div className="list-group">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <span className="shrink-0 text-[13px] text-neutral-400">From</span>
        <HashValue value={payment.from} className="text-[12.5px] text-neutral-200" />
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] px-4 py-3">
        <span className="shrink-0 text-[13px] text-neutral-400">Transaction</span>
        <HashValue value={payment.transactionHash} className="text-[12.5px] text-neutral-200" />
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] px-4 py-3">
        <span className="shrink-0 text-[13px] text-neutral-400">Ledger</span>
        <span className="mono text-[12.5px] text-neutral-200">{payment.ledger}</span>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] px-4 py-3">
        <span className="shrink-0 text-[13px] text-neutral-400">Matched</span>
        <span className="text-[12.5px] text-neutral-200">
          {payment.lane === "routing"
            ? `by payment route ${payment.routingId ?? ""}`.trim()
            : payment.lane === "amount"
              ? "by amount"
              : "by hand"}
        </span>
      </div>
    </div>
  );
}
