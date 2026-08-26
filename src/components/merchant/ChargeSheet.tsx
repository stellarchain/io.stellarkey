"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { triggerHaptic } from "@/lib/haptics";
import { useMerchant } from "@/hooks/useMerchant";
import { LIVE_SECOND_MS, useLiveNow } from "@/hooks/useLiveNow";
import { assetKey, quoteFor, secondsRemaining } from "@/lib/merchant/charge";
import { fmtMinor, fromStroops, minorForAssetAmount, toStroops } from "@/lib/merchant/money";
import type { Charge, ChargeQuote, MatchedPayment } from "@/lib/merchant/types";
import { useToast } from "../Toast";
import { CopyButton, HashValue, Modal, ModalHeader, Notice, SegmentedControl, Spinner } from "../ui";
import { IconAlert, IconCheck, IconRefresh } from "../icons";

/** Seconds below which the countdown turns amber. */
const URGENT_SECONDS = 60;

/** How often the open sheet nudges the wallet's idle timer. Well inside the
 *  shortest auto-lock the wallet offers, which is one minute. */
const HOLD_LOCK_PING_MS = 20_000;

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
  if (!charge) return null;
  return <ChargeSheetInner charge={charge} onClose={onClose} />;
}

function ChargeSheetInner({ charge, onClose }: { charge: Charge; onClose: () => void }) {
  const {
    settings,
    payUriFor,
    voidCharge,
    watchedLedger,
    watchError,
    pollNow,
    orderFor,
  } = useMerchant();
  const { toast } = useToast();

  const [selectedKey, setSelectedKey] = useState(() => assetKey(charge.quotes[0].asset));
  const [qr, setQr] = useState<{ uri: string; dataUrl: string } | null>(null);
  const now = useLiveNow(LIVE_SECOND_MS);

  const quote =
    charge.quotes.find((q) => assetKey(q.asset) === selectedKey) ?? charge.quotes[0];
  const payment = charge.payment;
  const paidQuote = payment ? quoteFor(charge, payment.asset) : null;
  const payUri = payUriFor(charge, quote.asset);
  const order = orderFor(charge.id);
  const awaiting = charge.status === "awaiting";
  const seconds = secondsRemaining(charge, now);
  const urgent = seconds < URGENT_SECONDS;
  const gap = payment && paidQuote ? difference(payment, paidQuote) : null;
  /** A closed charge shows the asset it was actually settled in, not a pick list. */
  const shownQuote = !awaiting && paidQuote ? paidQuote : quote;
  /** The window this charge actually held, not whatever the setting says today. */
  const heldMinutes = Math.max(1, Math.round((charge.expiresAt - charge.createdAt) / 60_000));

  /* Hold the wallet open while the customer pays.

     useWallet's idle timer only resets on a real `pointerdown` or `keydown` on the
     window, and a customer-facing charge screen is handed over untouched: nobody
     taps the till for the whole expiry, so the vault locks mid-payment and takes
     the payment watcher down with it. A synthetic `pointerdown` is exactly the
     event that timer bumps on, so one every twenty seconds keeps the session alive
     for as long as — and no longer than — a charge is actually in flight, and only
     when the shop has asked for it in Merchant settings. */
  const holdLock = settings.holdAutoLockDuringCharge;
  useEffect(() => {
    if (!awaiting || !holdLock) return;
    const timer = window.setInterval(() => {
      window.dispatchEvent(new Event("pointerdown"));
    }, HOLD_LOCK_PING_MS);
    return () => window.clearInterval(timer);
  }, [awaiting, holdLock]);

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
      toast("Payment received", "success");
    } else if (charge.status === "expired") {
      triggerHaptic("warning");
      toast("Charge expired", "error");
    } else if (charge.status === "underpaid" || charge.status === "overpaid") {
      triggerHaptic("warning");
      toast(charge.status === "underpaid" ? "Payment came up short" : "Payment came in over", "error");
    }
  }, [charge.status, toast]);

  const headline = useMemo(() => {
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
        return "Waiting for payment";
    }
  }, [charge.status]);

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
      : charge.status === "underpaid" || charge.status === "overpaid" || charge.status === "expired"
        ? "#FF9F0A"
        : "#0A84FF";

  return (
    /* A request in flight is never dismissed by accident: Escape, the backdrop and
       the header cross all go, because clearTicket() has already emptied the till
       and the QR would be the only way back to a customer who is mid-payment. Both
       ways out of an open charge are spelled out at the foot of the sheet. */
    <Modal open onClose={onClose} wide dismissable={!awaiting}>
      <ModalHeader
        title={title}
        subtitle={order ? `Order ${order.number} · ${charge.reference}` : charge.reference}
        onClose={awaiting ? undefined : onClose}
      />

      <div className="space-y-4 p-4 sm:p-6">
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
        {awaiting && charge.quotes.length > 1 && (
          <div className="mx-auto w-full max-w-[320px]">
            <SegmentedControl
              value={selectedKey}
              onChange={setSelectedKey}
              options={charge.quotes.map((q) => ({
                label: quoteLabel(q, charge.quotes),
                value: assetKey(q.asset),
              }))}
            />
          </div>
        )}

        {/* ---------- the live status ---------- */}
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.04] px-4 py-3">
          <div role="status" aria-live="polite" className="flex min-w-0 items-center gap-2.5">
            {awaiting ? (
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
          {awaiting && (
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

        {awaiting && watchError && (
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
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic("selection");
                    void pollNow();
                  }}
                  className="btn btn-secondary btn-sm mt-2.5"
                >
                  <IconRefresh size={13} /> Check again
                </button>
              </div>
            </div>
          </Notice>
        )}

        {/* ---------- the request ---------- */}
        {awaiting && (
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
                Memo — must not be removed
              </p>
              <div className="mt-1.5 flex items-center justify-between gap-3">
                <span className="mono text-[20px] font-semibold text-white">
                  {charge.reference}
                </span>
                <CopyButton value={charge.reference} label="Copy" />
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-neutral-400">
                The QR already carries it. A payment that arrives without this memo has to be
                matched to the order by hand.
              </p>
            </div>

            <div className="list-group">
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="shrink-0 text-[13px] text-neutral-400">To</span>
                <HashValue
                  value={charge.destination}
                  className="text-[12.5px] text-neutral-200"
                />
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
                looking at, so each says what it does to the charge. */}
            <div className="space-y-3 border-t border-white/[0.08] pt-4">
              <div>
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic("light");
                    onClose();
                  }}
                  className="btn btn-ghost w-full"
                >
                  Leave it running
                </button>
                <p className="mt-1.5 text-center text-[12px] leading-relaxed text-neutral-400">
                  Still watching · find it in Orders. The till is free for the next customer, and
                  the payment files itself against this order when it lands.
                </p>
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic("warning");
                    voidCharge(charge.id);
                    onClose();
                  }}
                  className="btn btn-danger w-full"
                >
                  Cancel charge
                </button>
                <p className="mt-1.5 text-center text-[12px] leading-relaxed text-neutral-500">
                  Ends the request. Anything paid against {charge.reference} afterwards arrives in
                  the unmatched tray instead.
                </p>
              </div>
            </div>
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
          <button type="button" onClick={onClose} className="btn btn-primary w-full">
            {charge.status === "paid" || charge.status === "expired"
              ? "New charge"
              : "Back to the till"}
          </button>
        )}
      </div>
    </Modal>
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
          {payment.lane === "memo"
            ? `by the memo ${payment.memo ?? ""}`.trim()
            : payment.lane === "amount"
              ? "by amount"
              : "by hand"}
        </span>
      </div>
    </div>
  );
}
