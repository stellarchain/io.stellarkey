"use client";

import type { ActivityItem } from "@/lib/types";
import type { Contact } from "@/lib/contacts";
import { activityAmountLines, fmtFiat, timeAgo, type FiatCurrency } from "@/lib/format";
import { formatTrezorAddress } from "@/lib/address-display";
import { IconArrowDownLeft, IconArrowUpRight, IconShield, IconSwap } from "../icons";
import { PrivateShieldNotch } from "../PrivateShieldNotch";

function activityIdentifierLabel(
  item: ActivityItem,
  matchedContact?: Contact,
  compact = false,
) {
  const counterparty = item.counterparty?.trim() || null;
  const issuer = item.assetIssuer?.trim() || null;
  const compactLabels: string[] = [];
  const fullLabels: string[] = [];
  const compactAddressOptions = compact ? { head: 4, tail: 4 } : undefined;

  if (counterparty) {
    compactLabels.push(
      matchedContact?.name ?? formatTrezorAddress(counterparty, compactAddressOptions),
    );
    fullLabels.push(
      matchedContact
        ? `${matchedContact.name} · ${formatTrezorAddress(counterparty, { full: true })}`
        : formatTrezorAddress(counterparty, { full: true }),
    );
  }

  if (issuer && issuer !== counterparty) {
    compactLabels.push(`Issuer ${formatTrezorAddress(issuer, compactAddressOptions)}`);
    fullLabels.push(`Issuer ${formatTrezorAddress(issuer, { full: true })}`);
  }

  return {
    compactLabel: compactLabels.join(" · "),
    fullLabel: fullLabels.join(" · "),
  };
}

export function ActivityLedgerRow({
  item,
  separated,
  matchedContact,
  privacyMode,
  fiatValue,
  fiatCurrency,
  fiatRates,
  compact = false,
  onOpen,
}: {
  item: ActivityItem;
  separated: boolean;
  matchedContact?: Contact;
  privacyMode: boolean;
  fiatValue: number | null;
  fiatCurrency: FiatCurrency;
  fiatRates: Partial<Record<FiatCurrency, number>>;
  compact?: boolean;
  onOpen: () => void;
}) {
  const incoming = item.direction === "in";
  const neutral = item.direction === "neutral";
  const identifier = activityIdentifierLabel(item, matchedContact, compact);

  return (
    <button
      type="button"
      className={`row-hover flex min-w-0 w-full overflow-hidden items-center gap-3.5 px-4 py-3.5 text-left ${
        separated ? "ios-sep" : ""
      }`}
      onClick={onOpen}
    >
      <span className="relative shrink-0">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-full"
          style={{
            color: neutral ? "var(--color-accent-2)" : incoming ? "var(--color-pos)" : "var(--color-neg)",
            background: neutral
              ? "rgba(100,210,255,0.12)"
              : incoming
                ? "rgba(48,209,88,0.14)"
                : "rgba(255,69,58,0.14)",
          }}
        >
          {item.type === "change_trust" ? (
            <IconShield size={16} />
          ) : neutral ? (
            <IconSwap size={16} />
          ) : incoming ? (
            <IconArrowDownLeft size={16} />
          ) : (
            <IconArrowUpRight size={16} />
          )}
        </span>
        {item.private && <PrivateShieldNotch ground={19} shield={15} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold leading-tight text-white">
          {item.title}
        </span>
        <span
          className="block truncate text-[12px] leading-tight text-neutral-400"
          title={identifier.fullLabel || undefined}
        >
          {timeAgo(item.createdAt)}
          {item.pending ? " · Confirming…" : ""}
          {identifier.compactLabel ? ` · ${identifier.compactLabel}` : ""}
        </span>
      </span>
      <ActivityAmountDisplay
        item={item}
        privacyMode={privacyMode}
        fiatValue={fiatValue}
        fiatCurrency={fiatCurrency}
        fiatRates={fiatRates}
        compact={compact}
      />
    </button>
  );
}

function ActivityAmountDisplay({
  item,
  privacyMode,
  fiatValue,
  fiatCurrency,
  fiatRates,
  compact = false,
}: {
  item: ActivityItem;
  privacyMode: boolean;
  fiatValue: number | null;
  fiatCurrency: FiatCurrency;
  fiatRates: Partial<Record<FiatCurrency, number>>;
  compact?: boolean;
}) {
  const lines = activityAmountLines(item);
  if (lines.length === 0) return null;

  if (item.swap || item.internalTransfer) {
    return (
      <span
        className="min-w-0 max-w-[42%] shrink-0 overflow-hidden text-right"
        title={compact && !privacyMode ? lines.map((line) => line.display).join(" · ") : undefined}
        aria-label={
          privacyMode
            ? `${item.internalTransfer ? "Internal transfer" : "Swap"} amounts hidden`
            : lines.map((line) => line.display).join(", ")
        }
      >
        {lines.map((line) => (
          <span
            key={`${line.balance ?? "asset"}:${line.direction}`}
            className={`mono block truncate font-semibold leading-tight ${
              compact ? "text-[12px]" : "text-[14px]"
            } ${
              privacyMode
                ? "text-neutral-500"
                : line.direction === "out"
                  ? "text-[#FF453A]"
                  : "text-[#30D158]"
            }`}
          >
            {privacyMode ? "••••••" : line.display}
          </span>
        ))}
      </span>
    );
  }

  const [line] = lines;
  return (
    <span
      className="min-w-0 max-w-[42%] shrink-0 overflow-hidden text-right"
      title={compact && !privacyMode ? line.display : undefined}
      aria-label={privacyMode ? "Amount hidden" : line.display}
    >
      <span
        className={`mono block truncate font-medium leading-tight ${compact ? "text-[13px]" : "text-[15px]"} ${
          privacyMode
            ? "text-neutral-500"
            : line.direction === "in"
              ? "text-[#30D158]"
              : line.direction === "out"
                ? "text-[#FF453A]"
                : "text-white"
        }`}
      >
        {privacyMode ? "••••••" : line.display}
      </span>
      {fiatValue !== null && (
        <span className={`block truncate leading-tight text-neutral-500 ${compact ? "text-[10.5px]" : "text-[11.5px]"}`}>
          ≈ {fmtFiat(fiatValue, fiatCurrency, fiatRates)}
        </span>
      )}
    </span>
  );
}

export function Chevron() {
  return (
    <svg
      className="chevron"
      width="8"
      height="14"
      viewBox="0 0 8 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m1.5 1.5 5 5.5-5 5.5" />
    </svg>
  );
}
