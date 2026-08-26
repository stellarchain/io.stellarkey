"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { triggerHaptic } from "@/lib/haptics";
import { useMerchant } from "@/hooks/useMerchant";
import { orderReference } from "@/lib/merchant/charge";
import { fmtMinor, lineGrossMinor } from "@/lib/merchant/money";
import { findScannedCatalogueItem } from "@/lib/merchant/runtime";
import type {
  CatalogueItem,
  Minor,
  ModifierGroup,
  Order,
  OrderLine,
  OrderLineModifier,
} from "@/lib/merchant/types";
import type { FiatCurrency } from "@/lib/format";
import { useToast } from "../Toast";
import { Dropdown, Modal, ModalHeader, SegmentedControl } from "../ui";
import {
  IconCheck,
  IconChevronDown,
  IconClose,
  IconEye,
  IconList,
  IconPlus,
  IconTrash,
  IconWallet,
} from "../icons";
import { IconPercent, IconReceipt } from "./icons";
import { AdjustmentSheet } from "./AdjustmentSheet";
import { CashTenderSheet } from "./CashTenderSheet";
import { CustomerDisplay } from "./CustomerDisplay";
import { ReceiptSheet } from "./ReceiptSheet";

/** 999,999.99 — a till figure that no longer fits a shop is a mis-key. */
const MAX_KEYPAD_MINOR = 99_999_999;

const KEYPAD_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "backspace"] as const;

type TerminalMode = "keypad" | "items";

function BackspaceGlyph() {
  return (
    <svg
      width={26}
      height={26}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 5H9.6a2 2 0 0 0-1.5.7L3 12l5.1 6.3a2 2 0 0 0 1.5.7H20a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1Z" />
      <path d="M16 9.5 11.5 14.5" />
      <path d="M11.5 9.5 16 14.5" />
    </svg>
  );
}

function MinusGlyph({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
    </svg>
  );
}

/** The overflow affordance beside Charge — one blue button, one "more". */
function MoreGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

/** A tile tint at low opacity, falling back to plain glass for an odd colour. */
function tileStyle(colour: string): React.CSSProperties {
  const usable = /^#[0-9a-fA-F]{6}$/.test(colour);
  if (!usable) {
    return {
      backgroundColor: "rgba(255,255,255,0.06)",
      boxShadow: "inset 0 0 0 0.5px rgba(255,255,255,0.1)",
    };
  }
  return {
    backgroundColor: `${colour}22`,
    boxShadow: `inset 0 0 0 0.5px ${colour}59`,
  };
}

/* ------------------------------------------------------------------ */
/* Keypad                                                              */
/* ------------------------------------------------------------------ */

/**
 * Fills from the right in minor units: 2, 7, 3, 3 reads 27.33. Shared by the
 * till and the discount sheet so an amount is entered the same way everywhere.
 */
function Keypad({
  minor,
  currency,
  label,
  onChange,
  /** The till gives the keypad its whole column; the discount sheet caps it. */
  fill = false,
}: {
  minor: Minor;
  currency: FiatCurrency;
  label: string;
  onChange: (next: Minor) => void;
  fill?: boolean;
}) {
  function press(key: (typeof KEYPAD_KEYS)[number]) {
    if (key === "backspace") {
      triggerHaptic("selection");
      onChange(Math.floor(minor / 10));
      return;
    }
    const next = key === "00" ? minor * 100 : minor * 10 + Number(key);
    if (next > MAX_KEYPAD_MINOR) {
      triggerHaptic("warning");
      return;
    }
    triggerHaptic("selection");
    onChange(next);
  }

  return (
    <div>
      <div className="flex flex-col items-center py-4">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          {label}
        </span>
        <span className="mono mt-1.5 text-[34px] font-semibold leading-none text-white">
          {fmtMinor(minor, currency)}
        </span>
      </div>
      <div className={`grid w-full grid-cols-3 gap-2 ${fill ? "" : "mx-auto max-w-[420px]"}`}>
        {KEYPAD_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => press(key)}
            aria-label={key === "backspace" ? "Backspace" : key}
            className="flex min-h-[64px] items-center justify-center rounded-2xl bg-white/[0.08] text-[28px] font-medium leading-none text-white transition-[transform,background-color] duration-150 hover:bg-white/[0.13] active:scale-95"
          >
            {key === "backspace" ? <BackspaceGlyph /> : key}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modifier sheet                                                      */
/* ------------------------------------------------------------------ */

function groupHint(group: ModifierGroup): string {
  if (group.min > 0 && group.min === group.max) return `Choose ${group.min}`;
  if (group.min > 0) return `Choose ${group.min} to ${group.max}`;
  return group.max === 1 ? "Choose one, or none" : `Up to ${group.max}`;
}

function ModifierSheet({
  item,
  groups,
  currency,
  onConfirm,
  onClose,
}: {
  item: CatalogueItem;
  groups: ModifierGroup[];
  currency: FiatCurrency;
  onConfirm: (modifiers: OrderLineModifier[]) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});

  const chosen = useMemo<OrderLineModifier[]>(
    () =>
      groups.flatMap((group) =>
        (picked[group.id] ?? []).flatMap((id) => {
          const modifier = group.modifiers.find((m) => m.id === id);
          return modifier
            ? [{ modifierId: modifier.id, name: modifier.name, priceMinor: modifier.priceMinor }]
            : [];
        }),
      ),
    [groups, picked],
  );

  const totalMinor = chosen.reduce((sum, m) => sum + m.priceMinor, item.priceMinor);
  const unmet = groups.find((group) => (picked[group.id] ?? []).length < group.min);

  function toggle(group: ModifierGroup, modifierId: string) {
    setPicked((prev) => {
      const current = prev[group.id] ?? [];
      if (current.includes(modifierId)) {
        triggerHaptic("selection");
        return { ...prev, [group.id]: current.filter((id) => id !== modifierId) };
      }
      if (group.max <= 1) {
        triggerHaptic("selection");
        return { ...prev, [group.id]: [modifierId] };
      }
      if (current.length >= group.max) {
        triggerHaptic("warning");
        return prev;
      }
      triggerHaptic("selection");
      return { ...prev, [group.id]: [...current, modifierId] };
    });
  }

  return (
    <Modal open onClose={onClose}>
      <ModalHeader
        title={item.name}
        subtitle={fmtMinor(item.priceMinor, currency)}
        onClose={onClose}
      />
      <div className="space-y-4 p-4 sm:p-6">
        {groups.map((group) => {
          const current = picked[group.id] ?? [];
          return (
            <section key={group.id}>
              <div className="flex items-baseline justify-between px-1 pb-2">
                <h3 className="text-[13.5px] font-semibold text-white">{group.name}</h3>
                <span className="text-[11.5px] text-neutral-500">{groupHint(group)}</span>
              </div>
              <div className="list-group">
                {group.modifiers.map((modifier, index) => {
                  const on = current.includes(modifier.id);
                  return (
                    <button
                      key={modifier.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(group, modifier.id)}
                      className={`row-hover flex w-full items-center gap-3 px-4 py-3 text-left ${
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
                      <span className="min-w-0 flex-1 truncate text-[14.5px] text-white">
                        {modifier.name}
                      </span>
                      <span className="mono shrink-0 text-[13px] text-neutral-400">
                        {modifier.priceMinor === 0
                          ? "Free"
                          : `+ ${fmtMinor(modifier.priceMinor, currency)}`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}

        {unmet && (
          <p className="px-1 text-[12.5px] text-[#FF9F0A]">
            {groupHint(unmet)} from {unmet.name} before adding this to the ticket.
          </p>
        )}

        <button
          type="button"
          disabled={Boolean(unmet)}
          className="btn btn-primary w-full"
          onClick={() => {
            triggerHaptic("light");
            onConfirm(chosen);
          }}
        >
          Add {fmtMinor(totalMinor, currency)}
        </button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Catalogue tiles                                                     */
/* ------------------------------------------------------------------ */

function ItemTile({
  item,
  currency,
  hasOptions,
  onPick,
}: {
  item: CatalogueItem;
  currency: FiatCurrency;
  hasOptions: boolean;
  onPick: () => void;
}) {
  const stock = item.trackStock ? item.stockOnHand : null;
  const soldOut = item.trackStock && stock !== null && stock <= 0;
  const low =
    !soldOut &&
    item.trackStock &&
    stock !== null &&
    item.lowStockAt !== null &&
    stock <= item.lowStockAt;

  return (
    <button
      type="button"
      disabled={soldOut}
      onClick={onPick}
      style={tileStyle(item.colour)}
      className={`flex min-h-[96px] flex-col justify-between rounded-2xl p-3 text-left transition-transform duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 ${
        soldOut ? "" : "hover:brightness-125"
      }`}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 text-[14.5px] font-semibold leading-snug text-white">
          {item.name}
        </span>
        {hasOptions && !soldOut && (
          <span className="shrink-0 text-white/45" aria-hidden="true">
            <IconPlus size={13} />
          </span>
        )}
      </span>
      <span className="mt-2 flex items-end justify-between gap-2">
        <span className="mono text-[13px] text-white/85">
          {fmtMinor(item.priceMinor, currency)}
        </span>
        {soldOut ? (
          <span className="rounded-full bg-black/40 px-2 py-0.5 text-[10.5px] font-semibold text-neutral-300">
            Sold out
          </span>
        ) : low ? (
          <span className="mono text-[10.5px] font-semibold text-[#FF9F0A]">{stock} left</span>
        ) : null}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Ticket overflow                                                     */
/* ------------------------------------------------------------------ */

/**
 * Everything a counter can reach beside Charge, under one control. Charge is
 * the till's single primary action; these sit next to it rather than competing
 * with it, and nothing that used to be a button of its own has been dropped.
 */
function TicketMenu({
  onTender,
  onCustomerView,
  onAdjust,
}: {
  onTender: () => void;
  onCustomerView: () => void;
  onAdjust: () => void;
}) {
  return (
    <Dropdown
      align="right"
      trigger={(_, triggerProps) => (
        <button
          {...triggerProps}
          aria-label="More ticket actions"
          className="btn btn-secondary w-11 shrink-0 !px-0"
        >
          <MoreGlyph />
        </button>
      )}
    >
      {(close) => (
        <div className="p-1">
          <button
            type="button"
            role="menuitem"
            className="menu-item !rounded-xl"
            onClick={() => {
              close();
              onTender();
            }}
          >
            <IconWallet size={15} /> <span>Other tender</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item !rounded-xl"
            onClick={() => {
              close();
              onCustomerView();
            }}
          >
            <IconEye size={15} /> <span>Customer view</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item !rounded-xl"
            onClick={() => {
              close();
              onAdjust();
            }}
          >
            <IconPercent size={15} /> <span>Discount, comp or void</span>
          </button>
        </div>
      )}
    </Dropdown>
  );
}

/* ------------------------------------------------------------------ */
/* Ticket                                                              */
/* ------------------------------------------------------------------ */

function TicketRow({
  line,
  currency,
  first,
  onQuantity,
  onAdjust,
  onRemove,
}: {
  line: OrderLine;
  currency: FiatCurrency;
  first: boolean;
  onQuantity: (quantity: number) => void;
  onAdjust: () => void;
  onRemove: () => void;
}) {
  return (
    <li className={`flex items-start gap-3 px-4 py-3 ${first ? "" : "border-t border-white/[0.08]"}`}>
      <div className="min-w-0 flex-1">
        <p className="till-line text-[14.5px] font-medium leading-snug text-white">{line.name}</p>
        {line.modifiers.length > 0 && (
          <p className="mt-0.5 text-[12px] leading-relaxed text-neutral-500">
            {line.modifiers.map((m) => m.name).join(" · ")}
          </p>
        )}
        <div className="mt-2 flex items-center gap-1.5">
          <button
            type="button"
            aria-label={`One fewer ${line.name}`}
            onClick={() => {
              triggerHaptic("selection");
              onQuantity(line.quantity - 1);
            }}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.08] text-white transition-transform duration-150 hover:bg-white/[0.14] active:scale-90"
          >
            <MinusGlyph />
          </button>
          <span className="mono w-7 text-center text-[14.5px] font-semibold text-white">
            {line.quantity}
          </span>
          <button
            type="button"
            aria-label={`One more ${line.name}`}
            onClick={() => {
              triggerHaptic("selection");
              onQuantity(line.quantity + 1);
            }}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.08] text-white transition-transform duration-150 hover:bg-white/[0.14] active:scale-90"
          >
            <IconPlus size={15} />
          </button>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <span className="till-line mono text-[14.5px] text-white">
          {fmtMinor(lineGrossMinor(line), currency)}
        </span>
        <div className="flex items-center gap-1">
          {/* Discount, comp or void this one line, with a reason and a name on it. */}
          <button
            type="button"
            aria-label={`Discount, comp or void ${line.name}`}
            onClick={() => {
              triggerHaptic("selection");
              onAdjust();
            }}
            className="relative flex h-9 w-9 items-center justify-center rounded-full text-neutral-500 transition-colors before:absolute before:-inset-1 before:content-[''] hover:bg-white/[0.06] hover:text-[#0A84FF]"
          >
            <IconPercent size={15} />
          </button>
          <button
            type="button"
            aria-label={`Remove ${line.name}`}
            onClick={() => {
              triggerHaptic("light");
              onRemove();
            }}
            className="flex h-9 w-9 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-white/[0.06] hover:text-[#FF453A]"
          >
            <IconTrash size={15} />
          </button>
        </div>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* The till                                                            */
/* ------------------------------------------------------------------ */

export function PosTerminal() {
  const {
    settings,
    tillTextSize,
    catalogue,
    modifierGroups,
    ticket,
    ticketTotals,
    tipOptions,
    addItemToTicket,
    addCustomAmount,
    setLineQuantity,
    removeLine,
    clearTicket,
    activeShift,
    paymentBlockedReason,
    chargeBlockedReason,
    createChargeFromTicket,
    orders,
    charges,
    nextOrderNumber,
  } = useMerchant();
  const { toast } = useToast();

  const [mode, setMode] = useState<TerminalMode>("keypad");
  const [keypadMinor, setKeypadMinor] = useState<Minor>(0);
  const [tipPromptOpen, setTipPromptOpen] = useState(false);
  const [category, setCategory] = useState<string>("");
  const [optionsFor, setOptionsFor] = useState<CatalogueItem | null>(null);
  const [tenderOpen, setTenderOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustLineId, setAdjustLineId] = useState<string | null>(null);
  const [receiptOrder, setReceiptOrder] = useState<Order | null>(null);
  const [customerViewOpen, setCustomerViewOpen] = useState(false);
  const [lastSettledOrderId, setLastSettledOrderId] = useState<string | null>(null);
  const scannerBuffer = useRef("");
  const scannerResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currency = settings.currency;

  const active = useMemo(
    () => catalogue.filter((item) => item.active).sort((a, b) => a.sortIndex - b.sortIndex),
    [catalogue],
  );

  const categories = useMemo(() => {
    const seen: string[] = [];
    for (const item of active) {
      if (item.category && !seen.includes(item.category)) seen.push(item.category);
    }
    return seen;
  }, [active]);

  const visible = useMemo(
    () => (category ? active.filter((item) => item.category === category) : active),
    [active, category],
  );

  const groupsFor = useCallback(
    (item: CatalogueItem): ModifierGroup[] =>
      item.modifierGroupIds.flatMap((id) => {
        const group = modifierGroups.find((g) => g.id === id);
        return group ? [group] : [];
      }),
    [modifierGroups],
  );

  const taxLines = useMemo(() => {
    const known = settings.taxRates
      .filter((rate) => (ticketTotals.taxByRate[rate.id] ?? 0) !== 0)
      .map((rate) => ({
        id: rate.id,
        label: `${rate.label} ${rate.percent} %`,
        minor: ticketTotals.taxByRate[rate.id],
      }));
    const orphans = Object.entries(ticketTotals.taxByRate)
      .filter(([id]) => !settings.taxRates.some((rate) => rate.id === id))
      .map(([id, minor]) => ({ id, label: id, minor }));
    return [...known, ...orphans];
  }, [settings.taxRates, ticketTotals.taxByRate]);

  const itemCount = ticket.lines.reduce((sum, line) => sum + line.quantity, 0);
  const empty = ticket.lines.length === 0;
  const chargeDisabled = empty || chargeBlockedReason !== null;

  const reference = orderReference(settings.profile.name || "Till", nextOrderNumber);
  const settled = useMemo(
    () =>
      lastSettledOrderId
        ? orders.find((order) => order.id === lastSettledOrderId && order.status === "paid") ?? null
        : null,
    [lastSettledOrderId, orders],
  );
  const receiptHash = receiptOrder
    ? charges.find((charge) => charge.orderId === receiptOrder.id)?.payment?.transactionHash ?? null
    : null;

  const pickItem = useCallback((item: CatalogueItem): "added" | "options" => {
    const groups = groupsFor(item);
    if (groups.length > 0) {
      triggerHaptic("selection");
      setOptionsFor(item);
      return "options";
    }
    triggerHaptic("light");
    addItemToTicket(item);
    return "added";
  }, [addItemToTicket, groupsFor]);

  useEffect(() => {
    function clearScannerBuffer() {
      scannerBuffer.current = "";
      if (scannerResetTimer.current) clearTimeout(scannerResetTimer.current);
      scannerResetTimer.current = null;
    }

    function onScannerKey(event: KeyboardEvent) {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (
        target?.closest('[role="dialog"]') ||
        target?.matches("input, textarea, select, [contenteditable=true]")
      ) {
        return;
      }
      if (event.key === "Enter") {
        const code = scannerBuffer.current.trim();
        clearScannerBuffer();
        if (!code) return;
        event.preventDefault();
        const item = findScannedCatalogueItem(active, code);
        if (!item) {
          triggerHaptic("warning");
          toast(`No active catalogue item has SKU ${code}.`, "error");
          return;
        }
        const outcome = pickItem(item);
        toast(
          outcome === "added"
            ? `${item.name} added from scanner`
            : `${item.name} scanned — choose its options`,
          "success",
        );
        return;
      }
      if (
        event.key.length !== 1 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }
      scannerBuffer.current += event.key;
      if (scannerResetTimer.current) clearTimeout(scannerResetTimer.current);
      scannerResetTimer.current = setTimeout(clearScannerBuffer, 120);
    }

    window.addEventListener("keydown", onScannerKey);
    return () => {
      window.removeEventListener("keydown", onScannerKey);
      clearScannerBuffer();
    };
  }, [active, pickItem, toast]);

  function openReceipt(order: Order) {
    triggerHaptic("selection");
    setReceiptOrder(order);
  }

  function openAdjust(lineId: string | null) {
    triggerHaptic("selection");
    setAdjustLineId(lineId);
    setAdjustOpen(true);
  }

  function openTender() {
    if (paymentBlockedReason) {
      triggerHaptic("warning");
      toast(paymentBlockedReason, "error");
      return;
    }
    triggerHaptic("selection");
    setTenderOpen(true);
  }

  /**
   * Charge does not raise the charge: it turns the screen to the customer to ask
   * about a tip. Only their answer raises it, which is why the tip is passed
   * straight into `createChargeFromTicket` rather than set first — a `setTip`
   * here would not have landed before the charge read the total.
   */
  function charge() {
    if (chargeBlockedReason || ticket.lines.length === 0) return;
    triggerHaptic("light");
    if (tipOptions.length === 0) {
      raiseCharge(0);
      return;
    }
    setTipPromptOpen(true);
  }

  function raiseCharge(tipMinor: Minor) {
    try {
      setTipPromptOpen(false);
      createChargeFromTicket(tipMinor);
    } catch (error) {
      triggerHaptic("error");
      toast(error instanceof Error ? error.message : "The charge could not be raised.", "error");
    }
  }

  // The till carries its own mobile clearance now — MerchantPage leaves the bottom
  // padding to the sticky charge bar below, which parks exactly one gap above the
  // floating tab bar.
  return (
    <section className={`fade-up till-size-${tillTextSize} w-full`}>
      <style>{`
        .till-size-large .till-line { font-size: 16.5px; }
        .till-size-large .till-total { font-size: 24px; }
        .till-size-xlarge .till-line { font-size: 19px; }
        .till-size-xlarge .till-total { font-size: 30px; }
      `}</style>
      <div
        role="status"
        className={`mb-3 flex items-center gap-3 rounded-[18px] border px-3.5 py-3 ${
          activeShift
            ? "border-[#30D158]/20 bg-[#30D158]/[0.06]"
            : "border-[#FF9F0A]/25 bg-[#FF9F0A]/[0.07]"
        }`}
      >
        <span
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${
            activeShift ? "bg-[#30D158] shadow-[0_0_14px_rgba(48,209,88,0.7)]" : "bg-[#FF9F0A]"
          }`}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold text-white">
            {activeShift ? `Shift ${activeShift.number} · ${activeShift.terminalName}` : "Till locked · no open shift"}
          </span>
          <span className="block truncate text-[11.5px] text-neutral-400">
            {activeShift
              ? `Opened ${new Date(activeShift.openedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} by ${activeShift.openedBy} · ${activeShift.network}`
              : "Open a shift from the Shift button before accepting any tender."}
          </span>
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(320px,380px)] md:items-start md:gap-5">
        {/* ---------- catalogue and keypad ---------- */}
        <div className="min-w-0 space-y-3">
          <div className="w-full">
            <SegmentedControl<TerminalMode>
              value={mode}
              onChange={setMode}
              options={[
                { label: "Keypad", value: "keypad" },
                { label: "Items", value: "items" },
              ]}
            />
          </div>

          {mode === "keypad" ? (
            <div className="panel p-4">
              <Keypad
                minor={keypadMinor}
                currency={currency}
                label="Amount"
                onChange={setKeypadMinor}
                fill
              />
              {/* Full width under the keypad it belongs to. Charge stays the only
                  btn-primary, so the hierarchy holds without shrinking this. */}
              <button
                type="button"
                disabled={keypadMinor <= 0}
                onClick={() => {
                  triggerHaptic("light");
                  addCustomAmount(keypadMinor);
                  setKeypadMinor(0);
                }}
                className="btn btn-secondary mt-3 w-full"
              >
                Add to ticket
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {categories.length > 0 && (
                <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5">
                  <button
                    type="button"
                    aria-pressed={category === ""}
                    onClick={() => {
                      triggerHaptic("selection");
                      setCategory("");
                    }}
                    className={`chip ${category === "" ? "!bg-[#0A84FF]/20 !text-[#0A84FF]" : ""}`}
                  >
                    All
                  </button>
                  {categories.map((name) => (
                    <button
                      key={name}
                      type="button"
                      aria-pressed={category === name}
                      onClick={() => {
                        triggerHaptic("selection");
                        setCategory(name);
                      }}
                      className={`chip ${category === name ? "!bg-[#0A84FF]/20 !text-[#0A84FF]" : ""}`}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              )}

              {visible.length === 0 ? (
                <div className="panel flex flex-col items-center px-6 py-14 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.06] text-neutral-500">
                    <IconList size={22} />
                  </span>
                  <p className="mt-3 text-[14.5px] font-semibold text-white">Nothing to sell yet</p>
                  <p className="mt-1 max-w-[260px] text-[13px] leading-relaxed text-neutral-400">
                    Add products in the catalogue, or ring the sale up on the keypad.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                  {visible.map((item) => (
                    <ItemTile
                      key={item.id}
                      item={item}
                      currency={currency}
                      hasOptions={groupsFor(item).length > 0}
                      onPick={() => pickItem(item)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ---------- the ticket ---------- */}
        <div className="min-w-0 md:sticky md:top-4">
          {settled && (
            <div className="panel mb-3">
              <div className="flex items-center gap-3 px-4 py-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#30D158]/15 text-[#30D158]">
                  <IconCheck size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-white">
                    Order {settled.number} settled
                  </p>
                  <p className="truncate text-[12px] text-neutral-500">
                    {settled.tender
                      .map((part) =>
                        part.kind === "cash" ? "Cash" : part.kind === "card" ? "Card" : "Stellar",
                      )
                      .join(" + ")} · {fmtMinor(settled.totals.totalMinor, settled.currency)}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Dismiss the settled order"
                  onClick={() => {
                    triggerHaptic("selection");
                    setLastSettledOrderId(null);
                  }}
                  className="-mr-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-white/[0.06] hover:text-white"
                >
                  <IconClose size={15} />
                </button>
              </div>

              <div className="px-4 pb-3">
                <button
                  type="button"
                  onClick={() => openReceipt(settled)}
                  className="btn btn-secondary"
                >
                  <IconReceipt size={15} /> Receipt
                </button>
              </div>

            </div>
          )}

          <div className="panel">
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-baseline gap-2">
                <h2 className="text-[15.5px] font-semibold text-white">Ticket</h2>
                {itemCount > 0 && (
                  <span className="mono text-[12px] text-neutral-500">
                    {itemCount} {itemCount === 1 ? "item" : "items"}
                  </span>
                )}
              </div>
              {!empty && (
                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic("warning");
                    clearTicket();
                  }}
                  className="-mr-2 rounded-lg px-2 py-1 text-[13px] font-semibold text-[#FF453A] transition-colors hover:bg-[#FF453A]/10"
                >
                  Clear
                </button>
              )}
            </div>

            {empty ? (
              <div className="flex flex-col items-center px-6 pb-12 pt-6 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/[0.06] text-neutral-500">
                  <IconList size={22} />
                </span>
                <p className="mt-3 text-[14.5px] font-semibold text-white">Nothing rung up</p>
                <p className="mt-1 max-w-[240px] text-[13px] leading-relaxed text-neutral-400">
                  Key in an amount or tap a product, and it lands here.
                </p>
              </div>
            ) : (
              <>
                <ul className="border-t border-white/[0.08] md:max-h-[38vh] md:overflow-y-auto">
                  {ticket.lines.map((line, index) => (
                    <TicketRow
                      key={line.id}
                      line={line}
                      currency={currency}
                      first={index === 0}
                      onQuantity={(quantity) => setLineQuantity(line.id, quantity)}
                      onAdjust={() => openAdjust(line.id)}
                      onRemove={() => removeLine(line.id)}
                    />
                  ))}
                </ul>

                <div className="border-t border-white/[0.08]">
                  <div className="flex items-center justify-between px-4 pt-3 text-[13.5px]">
                    <span className="text-neutral-400">Subtotal</span>
                    <span className="mono text-white">
                      {fmtMinor(ticketTotals.grossMinor, currency)}
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic("selection");
                      openAdjust(null);
                    }}
                    className="row-hover mt-1 flex w-full items-center justify-between rounded-xl px-4 py-2 text-left text-[13.5px]"
                  >
                    <span className="text-neutral-400">Discount</span>
                    <span className="flex items-center gap-1.5">
                      {ticketTotals.discountMinor > 0 ? (
                        <span className="mono text-white">
                          −{fmtMinor(ticketTotals.discountMinor, currency)}
                        </span>
                      ) : (
                        <span className="text-[13px] font-semibold text-[#0A84FF]">Add</span>
                      )}
                      <IconChevronDown size={14} className="chevron -rotate-90" />
                    </span>
                  </button>

                  {taxLines.map((tax) => (
                    <div
                      key={tax.id}
                      className="flex items-center justify-between px-4 py-1 text-[13.5px]"
                    >
                      <span className="text-neutral-400">
                        {tax.label}
                        <span className="text-neutral-600">
                          {settings.taxMode === "inclusive" ? " · included" : " · added"}
                        </span>
                      </span>
                      <span className="mono text-white">{fmtMinor(tax.minor, currency)}</span>
                    </div>
                  ))}

                  <div className="mt-2 flex items-center justify-between border-t border-white/[0.08] px-4 py-3">
                    <span className="text-[15.5px] font-semibold text-white">Total</span>
                    <span className="till-total mono text-[20px] font-semibold text-white">
                      {fmtMinor(ticketTotals.totalMinor, currency)}
                    </span>
                  </div>
                </div>
              </>
            )}

            {/* On a phone this sits below the fold under the keypad, so the
                sticky bar at the foot of the till carries it instead. */}
            <div className="hidden space-y-2 px-4 pb-4 md:block">
              {chargeBlockedReason && (
                <p className="text-center text-[12px] leading-relaxed text-[#FF9F0A]">
                  {chargeBlockedReason}
                </p>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={chargeDisabled}
                  onClick={charge}
                  className="btn btn-primary min-w-0 flex-1"
                >
                  Charge {fmtMinor(ticketTotals.totalMinor, currency)}
                </button>
                {/* Beside Charge, never instead of it. Nothing behind this
                    control needs a price or a receiving account, so
                    `chargeBlockedReason` does not gate it — a shop with no
                    quote can still take cash. */}
                {!empty && (
                  <TicketMenu
                    onTender={openTender}
                    onCustomerView={() => {
                      triggerHaptic("light");
                      setCustomerViewOpen(true);
                    }}
                    onAdjust={() => openAdjust(null)}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* The ticket column stacks under the keypad on a phone, which puts the
          Charge button below the fold on every sale. This bar keeps the primary
          action under the thumb. It is a real element at the end of the till, so
          the last ticket line always scrolls clear of it, and it settles one gap
          above the floating tab bar rather than behind it. */}
      {!empty && (
        <div className="sticky bottom-[calc(90px+env(safe-area-inset-bottom))] z-30 mt-3 md:hidden">
          <div className="panel shadow-[0_18px_50px_-12px_rgba(0,0,0,0.95)]">
            {chargeBlockedReason && (
              <p className="border-b border-white/[0.08] px-4 py-2 text-center text-[11.5px] leading-relaxed text-[#FF9F0A]">
                {chargeBlockedReason}
              </p>
            )}
            <div className="flex items-center gap-3 py-2.5 pl-4 pr-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[10.5px] font-semibold uppercase tracking-[0.04em] text-neutral-500">
                  Total · {itemCount} {itemCount === 1 ? "item" : "items"}
                </p>
                <p className="till-total mono truncate text-[17px] font-semibold leading-tight text-white">
                  {fmtMinor(ticketTotals.totalMinor, currency)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  disabled={chargeDisabled}
                  onClick={charge}
                  className="btn btn-primary shrink-0"
                >
                  Charge
                </button>
                <TicketMenu
                  onTender={openTender}
                  onCustomerView={() => {
                    triggerHaptic("light");
                    setCustomerViewOpen(true);
                  }}
                  onAdjust={() => openAdjust(null)}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {optionsFor && (
        <ModifierSheet
          item={optionsFor}
          groups={groupsFor(optionsFor)}
          currency={currency}
          onClose={() => setOptionsFor(null)}
          onConfirm={(modifiers) => {
            addItemToTicket(optionsFor, modifiers);
            setOptionsFor(null);
          }}
        />
      )}

      {/* The screen is turned to the customer here, so it carries one question,
          large, with no wallet chrome and no way to wander off. */}
      <Modal open={tipPromptOpen} onClose={() => setTipPromptOpen(false)} dismissable={false}>
        <ModalHeader
          title="Add a tip?"
          subtitle={`${fmtMinor(ticketTotals.totalMinor, currency)} before any tip`}
          onClose={() => setTipPromptOpen(false)}
        />
        <div className="p-5">
          <p className="text-center text-[13px] text-neutral-400">
            Turn the screen to your customer.
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {tipOptions.map((option) => (
              <button
                key={option.label}
                type="button"
                onClick={() => {
                  triggerHaptic("selection");
                  raiseCharge(option.amountMinor);
                }}
                className="flex min-h-[76px] flex-col items-center justify-center gap-1 rounded-2xl bg-white/[0.08] text-white transition-colors hover:bg-white/[0.13]"
              >
                <span className="text-[19px] font-semibold">{option.label}</span>
                <span className="mono text-[12px] text-neutral-400">
                  {fmtMinor(option.amountMinor, currency)}
                </span>
              </button>
            ))}
          </div>
          {/* Equal weight: a customer must never feel steered into tipping. */}
          <button
            type="button"
            onClick={() => {
              triggerHaptic("selection");
              raiseCharge(0);
            }}
            className="btn btn-secondary mt-2 w-full"
          >
            No tip
          </button>
        </div>
      </Modal>

      <CashTenderSheet
        open={tenderOpen}
        onClose={() => setTenderOpen(false)}
        totalMinor={ticketTotals.totalMinor}
        currency={currency}
        onSettled={({ order }) => {
          setLastSettledOrderId(order.id);
        }}
      />

      <AdjustmentSheet
        open={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        lineId={adjustLineId}
        onOrderFinalized={(order) => setLastSettledOrderId(order.id)}
      />

      {receiptOrder && (
        <ReceiptSheet
          open
          onClose={() => setReceiptOrder(null)}
          order={receiptOrder}
          transactionHash={receiptHash}
        />
      )}

      <CustomerDisplay
        open={customerViewOpen}
        onClose={() => setCustomerViewOpen(false)}
        amountMinor={ticketTotals.totalMinor}
        currency={currency}
        reference={reference}
      />

    </section>
  );
}
