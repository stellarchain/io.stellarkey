"use client";

import { useMemo, useState } from "react";
import { useMerchant } from "@/hooks/useMerchant";
import { fmtAmount } from "@/lib/format";
import { triggerHaptic } from "@/lib/haptics";
import { fmtMinor } from "@/lib/merchant/money";
import type { Charge, Order, UnmatchedPayment } from "@/lib/merchant/types";
import { useToast } from "../Toast";
import { Button, HashValue, SegmentedControl, Select } from "../ui";
import { IconAlert, IconSearch } from "../icons";
import { IconQr, IconReceipt } from "./icons";
import { Stat, StatStrip } from "./Stat";
import {
  OrderDetailModal,
  OrderStatusIcon,
  VIEW_LABEL,
  orderView,
} from "./OrderDetailModal";

type StatusFilter = "all" | "awaiting" | "paid" | "refunded";

const FILTERS: { label: string; value: StatusFilter }[] = [
  { label: "All", value: "all" },
  { label: "Awaiting", value: "awaiting" },
  { label: "Paid", value: "paid" },
  { label: "Refunded", value: "refunded" },
];

/**
 * Charge states a stray payment can plausibly belong to. A tray payment is often
 * related to a charge that is no longer awaiting — one the customer topped up,
 * one they overpaid, or one that timed out while they were paying — so the
 * picker has to reach past `awaiting` or the tray cannot be cleared at all.
 */
const FILABLE_LABEL = {
  awaiting: "Awaiting",
  underpaid: "Underpaid",
  overpaid: "Overpaid",
  expired: "Expired",
} as const;

type FilableStatus = keyof typeof FILABLE_LABEL;

function isFilable(charge: Charge): charge is Charge & { status: FilableStatus } {
  return (
    charge.status === "awaiting" ||
    charge.status === "underpaid" ||
    charge.status === "overpaid" ||
    charge.status === "expired"
  );
}

/** The charge a customer could still pay right now, if this order has one. */
function liveChargeFor(order: Order, charges: Charge[]): Charge | null {
  return charges.find((c) => c.orderId === order.id && c.status === "awaiting") ?? null;
}

function matchesFilter(order: Order, filter: StatusFilter): boolean {
  switch (filter) {
    case "awaiting":
      return order.status === "awaiting" || order.status === "open";
    case "paid":
      return order.status === "paid";
    case "refunded":
      return order.status === "refunded" || order.status === "partially_refunded";
    default:
      return true;
  }
}

function matchesQuery(order: Order, query: string): boolean {
  if (!query) return true;
  const needle = query.replace(/^#/, "");
  return (
    String(order.number).includes(needle) ||
    order.reference.toLowerCase().includes(needle) ||
    (order.payerAddress?.toLowerCase().includes(needle) ?? false)
  );
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function dayLabel(ts: number): string {
  const day = new Date(ts);
  day.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return new Date(ts).toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function itemSummary(order: Order): string {
  if (order.lines.length === 0) return "No items";
  return order.lines
    .map((line) => (line.quantity > 1 ? `${line.quantity} × ${line.name}` : line.name))
    .join(" · ");
}

/** Horizon gives a close time; the tray keeps its own arrival time as a fallback. */
function paymentTime(payment: UnmatchedPayment): number {
  const closed = Date.parse(payment.createdAt);
  return Number.isNaN(closed) ? payment.seenAt : closed;
}

export function OrdersPage() {
  const {
    ready,
    orders,
    charges,
    unmatched,
    settings,
    today,
    attachPayment,
    dismissUnmatched,
    openCharge,
  } = useMerchant();
  const { toast } = useToast();

  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);

  const needle = query.trim().toLowerCase();

  const filtered = useMemo(
    () =>
      orders
        .filter((o) => matchesFilter(o, filter) && matchesQuery(o, needle))
        .sort((a, b) => b.createdAt - a.createdAt),
    [filter, needle, orders],
  );

  const days = useMemo(() => {
    const buckets = new Map<string, Order[]>();
    for (const order of filtered) {
      const key = new Date(order.createdAt).toDateString();
      const bucket = buckets.get(key);
      if (bucket) bucket.push(order);
      else buckets.set(key, [order]);
    }
    return [...buckets.values()];
  }, [filtered]);

  // Kept in this component rather than derived per row: the modal has to survive
  // the store updating underneath it when a refund lands.
  const openOrder = useMemo(
    () => orders.find((o) => o.id === openOrderId) ?? null,
    [openOrderId, orders],
  );

  const filableCharges = useMemo(
    () => charges.filter(isFilable).sort((a, b) => b.createdAt - a.createdAt),
    [charges],
  );

  // Nothing to filter and no day to summarise until a ticket exists, so the
  // empty screen is the empty state alone rather than three empty shells.
  const hasOrders = ready && orders.length > 0;

  /*
    One surface per idea, stacked in the order the counter needs them: what has
    to be dealt with, then today's figures, then the list those figures came
    from. The list is read-only — every row opens its receipt — so the screen
    has no primary action and does not pretend to.
  */
  return (
    <section className="fade-up w-full min-w-0 space-y-3 pb-[132px] md:pb-12">
      {unmatched.length > 0 && (
        <UnmatchedTray
          payments={unmatched}
          filable={filableCharges}
          onAttach={(paymentId, chargeId, orderNumber) => {
            attachPayment(paymentId, chargeId);
            triggerHaptic("success");
            toast(`Payment filed against order #${orderNumber}`, "success");
          }}
          onDismiss={(paymentId) => {
            dismissUnmatched(paymentId);
            triggerHaptic("warning");
            toast("Payment dismissed from the tray");
          }}
        />
      )}

      {/*
        Today, as one slim strip: the figures lead, the ledger explains them.
        The day is named on the first cell rather than on an eyebrow above the
        strip, because the list below already opens with a Today heading and
        two of them 40px apart read as two different sections.
      */}
      {hasOrders && (
        <div>
          <StatStrip className="grid-cols-2 sm:grid-cols-4">
            <Stat
              label="Takings today"
              value={fmtMinor(today.takingsMinor, settings.currency)}
              tone="money"
            />
            <Stat label="Orders" value={String(today.orderCount)} divider="left" />
            <Stat
              label="Tips"
              value={fmtMinor(today.tipsMinor, settings.currency)}
              divider="top"
            />
            <Stat
              label="Refunds"
              value={fmtMinor(today.refundedMinor, settings.currency)}
              tone={today.refundedMinor > 0 ? "bad" : "ink"}
              divider="left-top"
            />
          </StatStrip>
        </div>
      )}

      {/* A phone needs a search field and a status. It does not need a sixth chip. */}
      {hasOrders && (
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
          <div className="search-field flex-1">
            <IconSearch size={14} className="shrink-0 text-neutral-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Order number, reference or payer…"
              aria-label="Search orders"
              className="w-full bg-transparent text-base text-white outline-none placeholder:text-neutral-500 sm:text-[13.5px]"
            />
          </div>
          <div className="sm:w-[288px]">
            <SegmentedControl<StatusFilter>
              value={filter}
              options={FILTERS}
              onChange={setFilter}
            />
          </div>
        </div>
      )}

      {/* ---------------- the ledger ---------------- */}
      <div className="min-w-0">
        {!ready ? (
          <div className="list-group">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className={`flex items-center gap-3.5 px-4 py-3.5 ${i > 0 ? "ios-sep" : ""}`}
              >
                <span className="skeleton h-[34px] w-[34px] rounded-[10px]" />
                <span className="flex-1 space-y-1.5">
                  <span className="skeleton block h-3 w-24" />
                  <span className="skeleton block h-3 w-40" />
                </span>
                <span className="skeleton h-4 w-16" />
              </div>
            ))}
          </div>
        ) : orders.length === 0 ? (
          <EmptyState
            title="No orders yet"
            body="Every ticket you charge lands here with its receipt, the payment that settled it and any refund issued against it."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="Nothing matches"
            body={
              needle
                ? `No order matches “${query.trim()}” under the ${
                    FILTERS.find((f) => f.value === filter)?.label.toLowerCase() ?? "current"
                  } filter.`
                : `No order is ${FILTERS.find((f) => f.value === filter)?.label.toLowerCase() ?? "listed"} right now.`
            }
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  triggerHaptic("selection");
                  setQuery("");
                  setFilter("all");
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <div className="space-y-5">
            {days.map((group) => (
              <div key={group[0].id}>
                <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                  {dayLabel(group[0].createdAt)}
                </p>
                <div className="list-group">
                  {group.map((order, i) => (
                    <OrderRow
                      key={order.id}
                      order={order}
                      charges={charges}
                      sep={i > 0}
                      onOpen={() => {
                        triggerHaptic("selection");
                        setOpenOrderId(order.id);
                      }}
                      onShowRequest={(chargeId) => {
                        triggerHaptic("light");
                        openCharge(chargeId);
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <OrderDetailModal order={openOrder} onClose={() => setOpenOrderId(null)} />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

/**
 * Hairlines rather than boxes: four figures share one surface instead of four
 * panels nesting inside a fifth. Two columns on a phone, one row from `sm` up.
 */


function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-[20px] border border-white/[0.08] bg-white/[0.02] px-6 py-14 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#30D158]/12 text-[#30D158]">
        <IconReceipt size={24} />
      </span>
      <p className="mt-4 text-[17px] font-semibold text-white">{title}</p>
      <p className="mt-1 max-w-[340px] text-[13px] leading-relaxed text-neutral-400">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

function OrderRow({
  order,
  charges,
  sep,
  onOpen,
  onShowRequest,
}: {
  order: Order;
  charges: Charge[];
  sep: boolean;
  onOpen: () => void;
  onShowRequest: (chargeId: string) => void;
}) {
  const view = orderView(order, charges);
  const live = liveChargeFor(order, charges);
  /* A shop reads this list the way it reads Activity, so it is that row: the
     tinted status glyph leads, the ticket and what was on it take the title,
     one mono line carries state · when · who, and the total sits on the right.
     The state leads that line so it is the last thing to truncate on a phone:
     the status is a word as well as a tone, and colour is never on its own.

     The receipt target is laid underneath the content rather than wrapped
     around it, because a live charge keeps a second target of its own and a
     button cannot nest inside a button. The QR button pulls its 44px back into
     the row's own padding so a live ticket is no taller than a settled one. */
  return (
    <div
      className={`row-hover relative flex w-full items-center gap-3.5 px-4 py-3.5 text-left ${
        sep ? "ios-sep" : ""
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open the receipt for order #${order.number}`}
        className="absolute inset-0 z-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#0A84FF]"
      />

      <span className="pointer-events-none relative z-10 flex items-center">
        <OrderStatusIcon view={view} />
      </span>

      <span className="pointer-events-none relative z-10 min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="mono shrink-0 text-[15px] font-semibold leading-tight text-white">
            #{order.number}
          </span>
          <span className="truncate text-[15px] font-normal leading-tight text-white">
            {itemSummary(order)}
          </span>
        </span>
        <span className="mono block truncate text-[12px] leading-tight text-neutral-400">
          {VIEW_LABEL[view]} · {fmtTime(order.createdAt)} · {order.staffName}
        </span>
      </span>

      <span className="mono pointer-events-none relative z-10 shrink-0 text-[15px] font-medium leading-tight text-white">
        {fmtMinor(order.totals.totalMinor, order.currency)}
      </span>

      {live && (
        <button
          type="button"
          onClick={() => onShowRequest(live.id)}
          aria-label={`Show the payment request for order #${order.number}`}
          className="relative z-10 -my-[5px] flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[#0A84FF] transition-colors hover:bg-[#0A84FF]/15 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#0A84FF]"
        >
          <IconQr size={17} />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The tray                                                            */
/* ------------------------------------------------------------------ */

/**
 * Amber, because this is a thing that needs doing. The shell has already said
 * why it is here, so the tray says only what to do about it and then gets on
 * with letting you do it.
 */
function UnmatchedTray({
  payments,
  filable,
  onAttach,
  onDismiss,
}: {
  payments: UnmatchedPayment[];
  filable: (Charge & { status: FilableStatus })[];
  onAttach: (paymentId: string, chargeId: string, orderNumber: string) => void;
  onDismiss: (paymentId: string) => void;
}) {
  const { orderFor } = useMerchant();
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [confirmingDismiss, setConfirmingDismiss] = useState<string | null>(null);

  // Newest first, each one carrying the state it is in: two charges for the same
  // money are told apart by whether one expired and the other came up short.
  const options = useMemo(
    () =>
      filable.map((charge) => {
        const order = orderFor(charge.id);
        const name = order ? `#${order.number}` : charge.reference;
        return {
          value: charge.id,
          label: `${name} · ${FILABLE_LABEL[charge.status]}`,
          sublabel: fmtMinor(charge.amountMinor, charge.currency),
        };
      }),
    [filable, orderFor],
  );

  return (
    <section
      aria-labelledby="unmatched-tray-title"
      className="panel ring-1 ring-inset ring-[#FF9F0A]/30"
    >
      <div className="bg-[#FF9F0A]/[0.07]">
        <div className="flex items-center gap-3 px-4 pb-3 pt-3.5">
          <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-[#FF9F0A]/15 text-[#FF9F0A]">
            <IconAlert size={17} />
          </span>
          <div className="min-w-0">
            <h2 id="unmatched-tray-title" className="text-[14.5px] font-semibold text-white">
              Unmatched payments
              <span aria-live="polite" className="mono ml-2 text-[12.5px] text-[#FF9F0A]">
                {payments.length}
              </span>
            </h2>
            <p className="mt-0.5 text-[12px] text-neutral-400">
              File each against the charge it belongs to, or dismiss it.
            </p>
          </div>
        </div>

        {payments.map((payment) => {
          const orderNumberFor = (chargeId: string) => {
            const order = orderFor(chargeId);
            return order ? String(order.number) : "—";
          };
          const chosen = picked[payment.id] ?? (options.length === 1 ? options[0].value : "");
          const dismissing = confirmingDismiss === payment.id;

          return (
            <div key={payment.id} className="border-t border-[#FF9F0A]/20 px-4 py-3.5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 lg:flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                    <span className="mono text-[15.5px] font-semibold text-white">
                      {fmtAmount(payment.amount)} {payment.asset.code}
                    </span>
                    <span className="mono text-[11.5px] text-neutral-500">
                      {new Date(paymentTime(payment)).toLocaleString("en-US", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                    <span className="text-neutral-500">From</span>
                    <HashValue value={payment.from} className="text-[12px] text-neutral-300" />
                    {payment.memo ? (
                      <span className="mono rounded-md bg-white/[0.08] px-1.5 py-0.5 text-[11.5px] text-neutral-300">
                        {payment.memo}
                      </span>
                    ) : (
                      <span className="text-neutral-500">No memo</span>
                    )}
                  </div>
                </div>

                <div className="flex flex-col gap-2 lg:w-[340px] lg:shrink-0">
                  {options.length === 0 ? (
                    <p className="text-[12.5px] leading-relaxed text-neutral-400">
                      No open or unsettled charge to file this against. Raise the charge first, or
                      leave the payment here until you do.
                    </p>
                  ) : (
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <Select
                          ariaLabel={`Charge to file this ${payment.asset.code} payment against`}
                          value={chosen}
                          onChange={(value) =>
                            setPicked((prev) => ({ ...prev, [payment.id]: value }))
                          }
                          options={options}
                          placeholder="Match to a charge…"
                        />
                      </div>
                      {/*
                        A tray can hold several payments, so Match is the action
                        on a row rather than the screen's one primary button —
                        and it is sized by the button class, not by this file.
                      */}
                      <Button
                        variant="ghost"
                        className="shrink-0"
                        disabled={!chosen}
                        onClick={() => onAttach(payment.id, chosen, orderNumberFor(chosen))}
                      >
                        Match
                      </Button>
                    </div>
                  )}

                  {dismissing ? (
                    <div className="flex flex-col gap-2">
                      <span className="text-[12px] text-neutral-400">
                        Drop this from the tray?
                      </span>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => {
                            triggerHaptic("selection");
                            setConfirmingDismiss(null);
                          }}
                        >
                          Leave in tray
                        </Button>
                        <Button
                          variant="danger"
                          onClick={() => {
                            setConfirmingDismiss(null);
                            onDismiss(payment.id);
                          }}
                        >
                          Dismiss
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic("selection");
                        setConfirmingDismiss(payment.id);
                      }}
                      className="self-start text-[12px] font-semibold text-neutral-400 transition-colors hover:text-[#FF453A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FF453A]"
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
