"use client";

/**
 * DESIGN MOCK — the interstitial for a second payment on a settled reference.
 *
 * What is mocked: the two payments and the outcome. Nothing is signed, nothing
 * is attached and nothing is dismissed — choosing only says what it would do.
 * The fixture pair is built from mock.ts (the payer is MOCK_CUSTOMERS[0], the
 * asset MOCK_USDC) against whichever reference the caller passes, and the asset
 * figure is derived through `fromStroops` rather than a float.
 *
 * What a real implementation replaces: `refund()` would call
 * `refundOrder({ orderId, amountMinor, reason: "duplicate" })` — which builds an
 * ordinary outbound payment and needs the vault unlocked — and `leave()` would
 * do nothing at all, which is the point: the payment stays in `unmatched` until
 * a person decides. The one rule this screen exists to enforce is that neither
 * happens on its own. A till that quietly attaches a second payment to a settled
 * order, or quietly sends money back, is a till that loses arguments.
 */

import { useState } from "react";
import { triggerHaptic } from "@/lib/haptics";
import { fmtMinor, fromStroops } from "@/lib/merchant/money";
import { MOCK_CUSTOMERS, MOCK_NOW, MOCK_USDC } from "@/lib/merchant/mock";
import type { MatchedPayment, Minor, RefundReason } from "@/lib/merchant/types";
import type { FiatCurrency } from "@/lib/format";
import { useToast } from "../Toast";
import { HashValue, Modal, ModalHeader, Notice } from "../ui";
import { IconAlert, IconCheck } from "../icons";
import { IconClock, IconInfo, IconRefund } from "./icons";

/** A payment, plus what it is worth in the shop's own money. */
export interface DuplicateArrival {
  payment: MatchedPayment;
  amountMinor: Minor;
}

/** The reason a refund of a double payment is filed under. */
const DUPLICATE_REASON: RefundReason = "duplicate";

/** USDC settles one-for-one with the shop's cent, so 1 minor unit is 10^5 stroops. */
function usdcAmount(minor: Minor): string {
  return fromStroops(BigInt(minor) * BigInt(100_000));
}

/**
 * The pair this screen is built to show: one payment that settled the order and
 * one that arrived on the same reference afterwards.
 */
export function duplicateFixture(
  reference: string,
  amountMinor: Minor,
): { settled: DuplicateArrival; duplicate: DuplicateArrival } {
  const payer = MOCK_CUSTOMERS[0].address;
  const amount = usdcAmount(amountMinor);
  return {
    settled: {
      amountMinor,
      payment: {
        id: "op_248130119377",
        transactionHash: "9c31be7f04a25d8613ff0a7c5e2b48d0916a3fc8e57b2049da16c3b8f7e50a24",
        ledger: 56_218_904,
        from: payer,
        amount,
        asset: MOCK_USDC,
        memo: reference,
        createdAt: new Date(MOCK_NOW - 6 * 60 * 1000).toISOString(),
        lane: "memo",
      },
    },
    duplicate: {
      amountMinor,
      payment: {
        id: "op_248130188402",
        transactionHash: "b7042ea9581c3f6d20be91a4c7d5308fe164b29a0c83df57e6a1d4b90c2f8735",
        ledger: 56_218_931,
        from: payer,
        amount,
        asset: MOCK_USDC,
        memo: reference,
        createdAt: new Date(MOCK_NOW - 40 * 1000).toISOString(),
        lane: "memo",
      },
    },
  };
}

function clockTime(iso: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "unknown time";
  return new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

type Choice = "none" | "refund" | "leave";

export function DuplicateChargeSheet({
  open,
  onClose,
  reference,
  orderNumber,
  currency,
  settled,
  duplicate,
}: {
  open: boolean;
  onClose: () => void;
  reference: string;
  orderNumber: number;
  currency: FiatCurrency;
  settled: DuplicateArrival;
  duplicate: DuplicateArrival;
}) {
  if (!open) return null;
  return (
    <DuplicateChargeSheetInner
      onClose={onClose}
      reference={reference}
      orderNumber={orderNumber}
      currency={currency}
      settled={settled}
      duplicate={duplicate}
    />
  );
}

function DuplicateChargeSheetInner({
  onClose,
  reference,
  orderNumber,
  currency,
  settled,
  duplicate,
}: {
  onClose: () => void;
  reference: string;
  orderNumber: number;
  currency: FiatCurrency;
  settled: DuplicateArrival;
  duplicate: DuplicateArrival;
}) {
  const { toast } = useToast();
  const [choice, setChoice] = useState<Choice>("none");
  const [note, setNote] = useState("");

  function refund() {
    triggerHaptic("success");
    toast(
      `Would send ${duplicate.payment.amount} ${duplicate.payment.asset.code} back to the payer and file it against order ${orderNumber} as a duplicate. Nothing was signed.`,
      "success",
    );
    onClose();
  }

  function leave() {
    triggerHaptic("light");
    toast(
      `Left in the unmatched tray. It stays on the Orders screen against ${reference} until someone deals with it.`,
    );
    onClose();
  }

  return (
    <Modal open onClose={onClose} wide>
      <ModalHeader
        title="Paid twice"
        subtitle={`Order ${orderNumber} · ${reference}`}
        onClose={onClose}
      />

      <div className="space-y-4 p-4 sm:p-6">
        <Notice tone="warn">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 shrink-0 text-[#FF9F0A]">
              <IconAlert size={15} />
            </span>
            <div>
              <p className="font-semibold text-white">
                A second payment arrived on a reference that is already settled
              </p>
              <p className="mt-1 text-neutral-300">
                Both carry the memo {reference}. The till has attached neither of them to anything
                new and will not: matching a second payment to a paid order by itself is how a shop
                ends up unable to say what it was paid for.
              </p>
            </div>
          </div>
        </Notice>

        {/* ---------------- both payments, side by side ---------------- */}
        <div className="grid gap-3 sm:grid-cols-2">
          <PaymentCard
            arrival={settled}
            currency={currency}
            tone="#30D158"
            heading="Settled this order"
            glyph={<IconCheck size={13} />}
          />
          <PaymentCard
            arrival={duplicate}
            currency={currency}
            tone="#FF9F0A"
            heading="Arrived afterwards"
            glyph={<IconAlert size={13} />}
          />
        </div>

        {/* ---------------- two choices of equal weight ---------------- */}
        {choice === "none" && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <ChoiceCard
                title="Refund the duplicate"
                body={`Sends ${duplicate.payment.amount} ${duplicate.payment.asset.code} back to the address it came from, as an ordinary payment out of the till account. The network fee comes off the shop, not the customer.`}
                action="Refund it"
                icon={<IconRefund size={16} />}
                onPick={() => {
                  triggerHaptic("selection");
                  setChoice("refund");
                }}
              />
              <ChoiceCard
                title="Leave it in the tray"
                body="Nothing is sent. The payment sits in the unmatched tray on Orders, where it can be filed against another order, refunded later, or settled with the customer in person."
                action="Leave it"
                icon={<IconClock size={16} />}
                onPick={() => {
                  triggerHaptic("selection");
                  setChoice("leave");
                }}
              />
            </div>
            <p className="flex items-start gap-2 px-1 text-[12px] leading-relaxed text-neutral-500">
              <IconInfo size={13} className="mt-0.5 shrink-0" />
              Neither happens on its own, and this screen does not close until one of them is
              chosen by a person.
            </p>
          </>
        )}

        {/* ---------------- refund, spelled out ---------------- */}
        {choice === "refund" && (
          <div className="space-y-3">
            <div className="list-group">
              <Fact label="Sending back" value={`${duplicate.payment.amount} ${duplicate.payment.asset.code}`} mono />
              <Fact label="Worth" value={fmtMinor(duplicate.amountMinor, currency)} mono sep />
              <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] px-4 py-3">
                <span className="shrink-0 text-[13px] text-neutral-400">To</span>
                <HashValue value={duplicate.payment.from} className="text-[12.5px] text-neutral-200" />
              </div>
              <Fact label="Filed as" value={DUPLICATE_REASON} sep />
            </div>

            <div className="space-y-1.5">
              <label className="field-label !pb-0" htmlFor="duplicate-note">
                Note on the refund
              </label>
              <input
                id="duplicate-note"
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Paid twice at the counter"
                className="input text-base sm:text-[14px]"
              />
            </div>

            <Notice>
              A refund is an ordinary outbound payment, so the wallet has to be unlocked to sign it
              and the customer sees it arrive like any other. There is nothing to reverse and
              nothing to dispute.
            </Notice>

            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic("selection");
                  setChoice("none");
                }}
                className="btn btn-ghost w-full"
              >
                Back
              </button>
              <button type="button" onClick={refund} className="btn btn-primary w-full">
                Send the refund
              </button>
            </div>
          </div>
        )}

        {/* ---------------- leaving it, spelled out ---------------- */}
        {choice === "leave" && (
          <div className="space-y-3">
            <Notice>
              <p className="font-semibold text-white">It stays exactly where it is</p>
              <p className="mt-1 text-neutral-300">
                The payment keeps its place in the unmatched tray with its hash, its payer and the
                memo it carried. Orders shows it until somebody files it or refunds it — it will not
                quietly disappear, and it will not quietly attach itself to order {orderNumber}.
              </p>
            </Notice>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  triggerHaptic("selection");
                  setChoice("none");
                }}
                className="btn btn-ghost w-full"
              >
                Back
              </button>
              <button type="button" onClick={leave} className="btn btn-secondary w-full">
                Leave it in the tray
              </button>
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
        <CardRow label="Ledger">
          <span className="mono">{payment.ledger}</span>
        </CardRow>
        <CardRow label="Memo">
          <span className="mono">{payment.memo ?? "none"}</span>
        </CardRow>
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
      <button type="button" onClick={onPick} className="btn btn-secondary mt-3 w-full">
        {action}
      </button>
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
    <div
      className={`flex items-center justify-between gap-3 px-4 py-3 ${
        sep ? "border-t border-white/[0.08]" : ""
      }`}
    >
      <span className="shrink-0 text-[13px] text-neutral-400">{label}</span>
      <span className={`truncate text-[13px] text-neutral-200 ${mono ? "mono" : ""}`}>{value}</span>
    </div>
  );
}
