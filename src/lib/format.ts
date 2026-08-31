import type { ActivityItem } from "./types";
import { activityAssetPresentation } from "./transaction-intent";

export type FiatCurrency = "USD" | "EUR" | "GBP" | "JPY" | "CAD" | "AUD" | "CHF";

export const FIAT_SYMBOLS: Record<FiatCurrency, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  CAD: "CA$",
  AUD: "A$",
  CHF: "CHF ",
};

export function fmtAmount(value: string | number, maxDecimals = 7): string {
  const decimals = Math.max(0, Math.floor(maxDecimals));
  const raw = typeof value === "number"
    ? Number.isFinite(value)
      ? value.toLocaleString("en-US", {
          useGrouping: false,
          maximumFractionDigits: decimals,
        })
      : ""
    : value.trim();
  const match = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(raw);
  if (!match) return "0";

  const negative = match[1] === "-";
  let integer = match[2].replace(/^0+(?=\d)/, "");
  const fraction = match[3] ?? "";
  let keptFraction = fraction.slice(0, decimals);

  if (fraction.length > decimals && fraction[decimals] >= "5") {
    if (decimals === 0) {
      integer = (BigInt(integer) + BigInt(1)).toString();
    } else {
      const width = integer.length + decimals;
      const scaled = `${integer}${keptFraction.padEnd(decimals, "0")}`;
      const rounded = (BigInt(scaled) + BigInt(1)).toString().padStart(width, "0");
      integer = rounded.slice(0, -decimals);
      keptFraction = rounded.slice(-decimals);
    }
  }

  keptFraction = keptFraction.replace(/0+$/, "");
  const isZero = /^0+$/.test(integer) && keptFraction.length === 0;
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative && !isZero ? "-" : ""}${grouped}${keptFraction ? `.${keptFraction}` : ""}`;
}

export function formatActivityAmount(
  activity: Pick<ActivityItem, "amount" | "direction">,
): string | null {
  if (activity.amount === null) return null;
  const sign = activity.direction === "neutral" ? "" : activity.direction === "in" ? "+" : "−";
  return `${sign}${fmtAmount(activity.amount)}`;
}

export interface ActivityAmountLine {
  direction: "in" | "out" | "neutral";
  amount: string;
  assetCode: string | null;
  assetIssuer: string | null;
  balance?: "public" | "private";
  display: string;
}

/** Return bank-style signed amount lines, including both legs of a self-swap. */
export function activityAmountLines(item: ActivityItem): ActivityAmountLine[] {
  if (item.internalTransfer) {
    return [
      {
        ...item.internalTransfer.debit,
        direction: "out",
        display: `−${fmtAmount(item.internalTransfer.debit.amount)} ${item.internalTransfer.debit.assetCode}`,
      },
      {
        ...item.internalTransfer.credit,
        direction: "in",
        display: `+${fmtAmount(item.internalTransfer.credit.amount)} ${item.internalTransfer.credit.assetCode}`,
      },
    ];
  }
  if (item.swap) {
    return [
      {
        ...item.swap.debit,
        direction: "out",
        display: `−${fmtAmount(item.swap.debit.amount)} ${item.swap.debit.assetCode}`,
      },
      {
        ...item.swap.credit,
        direction: "in",
        display: `+${fmtAmount(item.swap.credit.amount)} ${item.swap.credit.assetCode}`,
      },
    ];
  }

  const display = formatActivityAmount(item);
  if (display === null) return [];
  return [{
    direction: item.direction,
    amount: item.amount ?? "0",
    assetCode: item.assetCode,
    assetIssuer: item.assetIssuer,
    display: `${display}${item.assetCode ? ` ${item.assetCode}` : ""}`,
  }];
}

export function fmtFiat(
  usdAmount: number,
  currency: FiatCurrency = "USD",
  rates: Partial<Record<FiatCurrency, number>> = { USD: 1 },
): string {
  if (!Number.isFinite(usdAmount)) return "$0.00";
  const rate = currency === "USD" ? 1 : rates[currency];
  if (rate === undefined) return "Rate unavailable";
  const val = usdAmount * rate;
  const digits = currency === "JPY" ? 0 : 2;
  return val.toLocaleString("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * Format a per-unit market price without rounding useful sub-unit movement away.
 * Portfolio totals should continue to use fmtFiat's conventional cash precision.
 */
export function fmtFiatMarketPrice(
  usdAmount: number,
  currency: FiatCurrency = "USD",
  rates: Partial<Record<FiatCurrency, number>> = { USD: 1 },
): string {
  if (!Number.isFinite(usdAmount)) return fmtFiat(0, currency, rates);
  const rate = currency === "USD" ? 1 : rates[currency];
  if (rate === undefined) return "Rate unavailable";
  const value = usdAmount * rate;
  const magnitude = Math.abs(value);
  const minimumFractionDigits = currency === "JPY" && magnitude >= 1 ? 0 : 2;
  const maximumFractionDigits = magnitude === 0 || magnitude >= 1
    ? Math.max(2, minimumFractionDigits)
    : magnitude >= 0.01
      ? 4
      : magnitude >= 0.0001
        ? 6
        : 8;

  return value.toLocaleString("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits,
    maximumFractionDigits,
  });
}

export function fmtUsd(n: number): string {
  return fmtFiat(n, "USD");
}

export function shortenAddr(addr: string, head = 6, tail = 6): string {
  if (addr.length <= head + tail + 3) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (Number.isNaN(diff) || diff < 0) return "just now";
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function isValidAmount(raw: string): boolean {
  return /^\d+(\.\d{1,7})?$/.test(raw.trim()) && parseFloat(raw) > 0;
}

export function memoByteLength(raw: string): number {
  return new TextEncoder().encode(raw).length;
}

export { normalizeStellarAmount as normalizeAmount } from "./stellar-domain";

export function opTypeLabel(type: string): string {
  switch (type) {
    case "create_account":
      return "Account Created";
    case "payment":
      return "Payment";
    case "path_payment_strict_receive":
    case "path_payment_strict_send":
      return "DEX Swap";
    case "manage_buy_offer":
    case "manage_sell_offer":
    case "create_passive_sell_offer":
      return "Trade Offer";
    case "change_trust":
      return "Trustline";
    case "allow_trust":
    case "set_trust_line_flags":
      return "Trustline Auth";
    case "account_merge":
      return "Account Merge";
    case "claim_claimable_balance":
      return "Claim Airdrop";
    default:
      return type.replace(/_/g, " ");
  }
}

export function generateActivityCsv(items: ActivityItem[], network = "mainnet"): string {
  const headers = ["Date", "Type", "Direction", "Amount", "Asset", "Counterparty", "Status", "TxHash", "ExplorerLink"];
  const rows = items.map((item) => {
    const d = new Date(item.createdAt).toISOString();
    const type = opTypeLabel(item.type);
    const amountLines = activityAmountLines(item);
    const dir = item.internalTransfer ? "internal" : item.swap ? "swap" : item.direction;
    const amt = item.internalTransfer
      ? amountLines
          .map((line) => `${line.balance === "public" ? "Public" : "Private"}: ${line.display}`)
          .join(" / ")
      : item.swap
      ? amountLines.map((line) => line.display).join(" / ")
      : item.amount ?? "";
    const asset = item.swap
      ? amountLines
          .map((line) => activityAssetPresentation(line).detailLabel ?? "Unknown")
          .join(" → ")
      : activityAssetPresentation(item).detailLabel ?? "";
    const cp = item.counterparty ?? "";
    const status = item.pending ? "PENDING" : item.successful ? "SUCCESS" : "FAILED";
    const hash = item.hash;
    const link = network === "mainnet" ? `https://stellarchain.io/tx/${hash}` : `https://testnet.stellarchain.io/tx/${hash}`;
    return [d, type, dir, amt, asset, cp, status, hash, link].map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",");
  });
  return [headers.join(","), ...rows].join("\n");
}
