"use client";

import React, { useState } from "react";
import { useMerchant } from "@/hooks/useMerchant";
import { useLiveNow } from "@/hooks/useLiveNow";
import { useWalletContacts } from "@/hooks/useWallet";
import { triggerHaptic } from "@/lib/haptics";
import { fmtMinor } from "@/lib/merchant/money";
import type { CustomerRecord, LoyaltyCard } from "@/lib/merchant/types";
import { useToast } from "../Toast";
import { Avatar, Button, HashValue, Modal, ModalHeader } from "../ui";
import { IconCheck, IconChevronDown, IconGift, IconUserPlus } from "../icons";
import { IconCheckCircle, IconReceipt, IconTag } from "./icons";

/** Loyalty is drawn in purple; green stays money-in and merchant identity. */
export const LOYALTY_HUE = "#BF5AF2";

/**
 * A quiet, collapsed explanation. The screen states the fact in one line and
 * keeps the mechanism one tap away — nothing is softened, only folded up.
 * Default closed, a real button, a real region: `aria-expanded` and
 * `aria-controls` point at each other so a screen reader gets the same deal.
 */
export function Disclosure({
  summary,
  label = "How this works",
  children,
}: {
  summary: React.ReactNode;
  label?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const regionId = `${React.useId()}-disclosure`;

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          triggerHaptic("selection");
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        aria-controls={regionId}
        className="flex min-h-[44px] w-full items-center gap-3 rounded-xl px-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A84FF]"
      >
        <span className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-neutral-400">
          {summary}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[12px] font-semibold text-[#0A84FF]">
          {label}
          <IconChevronDown
            size={13}
            className={`transition-transform ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>
      <div
        id={regionId}
        hidden={!open}
        className="px-1 pb-1 text-[12.5px] leading-relaxed text-neutral-400"
      >
        {children}
      </div>
    </div>
  );
}

export function relativeTime(ts: number, now: number): string {
  const minutes = Math.round((now - ts) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days} ${days === 1 ? "day" : "days"} ago`;
  const months = Math.round(days / 30);
  return `${months} ${months === 1 ? "month" : "months"} ago`;
}

export function fmtDay(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** What to call someone the shop may only know by their address. */
export function customerTitle(customer: CustomerRecord): string {
  return customer.name ?? "Unnamed customer";
}

/** The compact loyalty read-out used in a list row. Never colour alone. */
export function LoyaltyBadge({ loyalty }: { loyalty: LoyaltyCard | null }) {
  if (!loyalty) {
    return <span className="shrink-0 text-[11px] text-neutral-600">No card</span>;
  }
  const full = loyalty.stamps >= loyalty.target;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
        full ? "bg-[#30D158]/15 text-[#30D158]" : "bg-[#BF5AF2]/15 text-[#BF5AF2]"
      }`}
    >
      {full ? <IconCheckCircle size={11} /> : <IconGift size={11} />}
      {full ? "Reward ready" : `${loyalty.stamps}/${loyalty.target}`}
    </span>
  );
}

export function CustomerDetailModal({
  customer,
  onClose,
}: {
  customer: CustomerRecord | null;
  onClose: () => void;
}) {
  if (!customer) return null;
  return (
    <CustomerDetail
      key={customer.address}
      customer={customer}
      onClose={onClose}
    />
  );
}

function CustomerDetail({
  customer,
  onClose,
}: {
  customer: CustomerRecord;
  onClose: () => void;
}) {
  const {
    customerHistory,
    forgetCustomer,
    redeemLoyaltyReward,
    settings,
    startLoyaltyCard,
    updateCustomerNote,
  } = useMerchant();
  const { addContact } = useWalletContacts();
  const { toast } = useToast();

  const [note, setNote] = useState(customer.note ?? "");
  const [contactName, setContactName] = useState(customer.name ?? "");
  const [confirmingForget, setConfirmingForget] = useState(false);
  const now = useLiveNow();

  const history = customerHistory(customer.address);

  const loyalty = customer.loyalty;
  const full = loyalty !== null && loyalty.stamps >= loyalty.target;
  const noteDirty = note.trim() !== (customer.note ?? "").trim();

  async function redeem() {
    try {
      await redeemLoyaltyReward(customer.address);
      triggerHaptic("success");
      toast("Reward redeemed and added to the loyalty audit.", "success");
    } catch (error) {
      triggerHaptic("error");
      toast(error instanceof Error ? error.message : "The reward could not be redeemed.", "error");
    }
  }

  async function startCard() {
    try {
      await startLoyaltyCard(customer.address, 10);
      triggerHaptic("success");
      toast("Loyalty card opened. New eligible payments earn one stamp.", "success");
    } catch (error) {
      triggerHaptic("error");
      toast(error instanceof Error ? error.message : "The loyalty card could not be opened.", "error");
    }
  }

  async function saveNote() {
    try {
      await updateCustomerNote(customer.address, note);
      triggerHaptic("success");
      toast("Customer note saved on this device.", "success");
    } catch (error) {
      triggerHaptic("error");
      toast(error instanceof Error ? error.message : "The note could not be saved.", "error");
    }
  }

  function saveToContacts() {
    const name = contactName.trim();
    if (!name) {
      triggerHaptic("error");
      toast("Enter a name before saving this address to Contacts.", "error");
      return;
    }
    try {
      addContact({ name, address: customer.address });
      triggerHaptic("success");
      toast(`${name} saved to Contacts.`, "success");
    } catch (error) {
      triggerHaptic("error");
      toast(error instanceof Error ? error.message : "The contact could not be saved.", "error");
    }
  }

  async function forget() {
    triggerHaptic("warning");
    try {
      await forgetCustomer(customer.address);
      toast("Local customer record forgotten. Ledger payments are unchanged.", "info");
      onClose();
    } catch (error) {
      triggerHaptic("error");
      toast(error instanceof Error ? error.message : "The customer could not be forgotten.", "error");
    }
  }

  /*
    The row already said who this is, when they were last in and what they have
    spent, so the card does not say it again: the header carries the name, the
    figures carry the money, and the punch card — the one thing that exists
    nowhere else — gets the only coloured surface on the screen.
  */
  return (
    <Modal open onClose={onClose} wide>
      <ModalHeader
        title={customerTitle(customer)}
        subtitle={`Customer since ${fmtDay(customer.firstSeenAt)}`}
        onClose={onClose}
      />

      <div className="space-y-5 p-4 sm:p-6">
        {/* Who they are on the ledger */}
        <div className="flex items-center gap-3 border-b border-white/[0.08] pb-4">
          <Avatar
            seed={customer.address}
            size={40}
            label={(customer.name ?? customer.address).slice(0, 1).toUpperCase()}
          />
          <div className="min-w-0 flex-1">
            <HashValue value={customer.address} className="text-[12px] text-neutral-300" />
            <p className="mt-1 text-[11.5px] leading-relaxed text-neutral-500">
              Public ledger data. Everything else here is local and optional.
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <input
            className="input min-w-0 flex-1"
            value={contactName}
            onChange={(event) => setContactName(event.target.value.slice(0, 24))}
            placeholder="Name this address"
            aria-label="Contact name"
          />
          <Button variant="secondary" className="shrink-0" onClick={saveToContacts}>
            <IconUserPlus size={13} />
            {customer.name ? "Update" : "Save contact"}
          </Button>
        </div>

        {/* The money first; the rest of the record is one quiet line under it. */}
        <div>
          <div className="grid grid-cols-3">
            <Figure label="Lifetime" value={fmtMinor(customer.lifetimeMinor, settings.currency)} tone="money" />
            <Figure label="Average" value={fmtMinor(customer.averageMinor, settings.currency)} divider />
            <Figure label="Visits" value={String(customer.orderCount)} divider />
          </div>
          <p className="mt-2.5 px-1 text-[11.5px] text-neutral-500">
            Pays in <span className="mono text-neutral-300">{customer.preferredAsset.code}</span> ·
            last seen {relativeTime(customer.lastSeenAt, now)}
          </p>
        </div>

        {/* The punch card: the distinctive thing here, so it gets the room */}
        {loyalty === null ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-neutral-400">
              No loyalty card. Open one and the till stamps it as this address pays.
            </p>
            <Button variant="secondary" onClick={startCard}>
              Start a card
            </Button>
          </div>
        ) : (
          <section
            aria-labelledby="loyalty-heading"
            className="rounded-2xl border border-[#BF5AF2]/25 bg-[#BF5AF2]/[0.07] p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3
                id="loyalty-heading"
                className="flex items-center gap-2 text-[13.5px] font-semibold text-white"
              >
                <span style={{ color: LOYALTY_HUE }}>
                  <IconGift size={15} />
                </span>
                Loyalty card
              </h3>
              <LoyaltyBadge loyalty={loyalty} />
            </div>

            <div
              className="mt-4 grid grid-cols-5 gap-2.5 sm:grid-cols-10"
              role="img"
              aria-label={`${loyalty.stamps} of ${loyalty.target} stamps collected`}
            >
              {Array.from({ length: loyalty.target }, (_, i) => {
                const stamped = i < loyalty.stamps;
                return (
                  <span
                    key={i}
                    aria-hidden="true"
                    className="flex aspect-square items-center justify-center rounded-full text-white"
                    style={
                      stamped
                        ? { background: LOYALTY_HUE }
                        : {
                            border: "1px dashed rgba(235,235,245,0.25)",
                            color: "rgba(235,235,245,0.3)",
                          }
                    }
                  >
                    {stamped ? (
                      <IconCheck size={14} />
                    ) : (
                      <span className="mono text-[11px]">{i + 1}</span>
                    )}
                  </span>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-neutral-400">
                {full
                  ? "The card is full — the next drink is on the shop."
                  : `${loyalty.target - loyalty.stamps} more ${
                      loyalty.target - loyalty.stamps === 1 ? "visit" : "visits"
                    } to the reward.`}
                {loyalty.redeemedCount > 0 &&
                  ` Redeemed ${loyalty.redeemedCount} ${
                    loyalty.redeemedCount === 1 ? "time" : "times"
                  } before.`}
              </p>
              <Button disabled={!full} onClick={redeem}>
                Redeem
              </Button>
            </div>
            {loyalty.events.length > 0 && (
              <p className="mono mt-3 border-t border-[#BF5AF2]/15 pt-3 text-[10.5px] text-neutral-500">
                {loyalty.events.length} audited {loyalty.events.length === 1 ? "event" : "events"}
                {loyalty.events.at(-1)?.actorName
                  ? ` · last action by ${loyalty.events.at(-1)?.actorName}`
                  : " · latest stamp earned automatically"}
              </p>
            )}
          </section>
        )}

        {/* History */}
        <section aria-labelledby="history-heading" className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <h3 id="history-heading" className="text-[13.5px] font-semibold text-white">
              On this device
            </h3>
            <span className="mono text-[11px] text-neutral-500">{history.length} records</span>
          </div>

          {history.length === 0 ? (
            <p className="px-1 text-[12.5px] leading-relaxed text-neutral-400">
              No ticket here yet. The figures above are this device&apos;s running summary; the
              tickets belong to whichever terminal rang them up.
            </p>
          ) : (
            <div className="list-group">
              {history.map((entry, index) => (
                <div
                  key={entry.id}
                  className={`flex items-center gap-3.5 px-4 py-3.5 ${
                    index > 0 ? "ios-sep" : ""
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="row-icon"
                    style={{
                      background:
                        entry.kind === "order"
                          ? "rgba(10,132,255,0.16)"
                          : "rgba(94,92,230,0.16)",
                      color: entry.kind === "order" ? "#0A84FF" : "#5E5CE6",
                    }}
                  >
                    {entry.kind === "order" ? <IconReceipt size={16} /> : <IconTag size={16} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15.5px] font-normal leading-tight text-white">
                      {entry.label}
                    </span>
                    <span className="mono block truncate text-[12px] leading-tight text-neutral-400">
                      {entry.sub} · {relativeTime(entry.at, now)}
                    </span>
                  </span>
                  <span className="mono shrink-0 text-[14.5px] font-medium text-white">
                    {fmtMinor(entry.amountMinor, entry.currency)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Note */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="customer-note" className="field-label !pb-0">
              Note
            </label>
            <span className="text-[11px] text-neutral-400">{note.trim().length}/140</span>
          </div>
          <textarea
            id="customer-note"
            className="input min-h-[76px] resize-y text-base sm:text-[13.5px]"
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 140))}
            placeholder="Oat flat white, no sugar."
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11.5px] text-neutral-500">Kept on this device.</p>
            <Button variant="secondary" disabled={!noteDirty} onClick={saveNote}>
              Save note
            </Button>
          </div>
        </div>

        {/* The honesty about Forget, folded up rather than shouted */}
        <div className="border-t border-white/[0.08] pt-2">
          <Disclosure summary="Forget erases only what this device holds.">
            It erases the name, note, counters and card this device holds. It cannot erase the
            payments — those are on a public ledger and were never ours to withdraw.
          </Disclosure>
        </div>

        {confirmingForget ? (
          <div className="rounded-2xl border border-[#FF453A]/30 bg-[#FF453A]/10 p-3.5">
            <p className="text-[13px] leading-relaxed text-neutral-200">
              Forget {customerTitle(customer)}? The name, note, counters and card go. The payments
              stay on the ledger — they were never ours to withdraw.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <Button variant="secondary" onClick={() => setConfirmingForget(false)}>
                Keep Record
              </Button>
              <Button variant="danger" onClick={forget}>
                Forget
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-danger w-full"
            onClick={() => {
              triggerHaptic("warning");
              setConfirmingForget(true);
            }}
          >
            Forget This Customer
          </button>
        )}
      </div>
    </Modal>
  );
}

/** A figure on its own, separated by a hairline rather than boxed in a panel. */
function Figure({
  label,
  value,
  tone = "ink",
  divider = false,
}: {
  label: string;
  value: string;
  tone?: "ink" | "money";
  divider?: boolean;
}) {
  return (
    <div className={`min-w-0 px-3 py-0.5 ${divider ? "border-l border-white/[0.08]" : ""}`}>
      <p className="truncate text-[10.5px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
        {label}
      </p>
      <p
        className={`mono mt-0.5 truncate text-[16px] font-semibold ${
          tone === "money" ? "text-[#30D158]" : "text-white"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
