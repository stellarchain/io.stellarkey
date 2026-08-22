import type { ActivityItem } from "./types";

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

export const FIAT_RATES: Record<FiatCurrency, number> = {
  USD: 1.0,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 154.5,
  CAD: 1.38,
  AUD: 1.52,
  CHF: 0.89,
};

export function fmtAmount(value: string | number, maxDecimals = 7): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", { maximumFractionDigits: maxDecimals });
}

export function fmtFiat(usdAmount: number, currency: FiatCurrency = "USD"): string {
  if (!Number.isFinite(usdAmount)) return "$0.00";
  const rate = FIAT_RATES[currency] ?? 1.0;
  const val = usdAmount * rate;
  const digits = currency === "JPY" ? 0 : 2;
  return val.toLocaleString("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
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

export function normalizeAmount(raw: string): string {
  return parseFloat(raw).toString();
}

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
    const dir = item.direction;
    const amt = item.amount ?? "";
    const asset = item.assetCode ?? "XLM";
    const cp = item.counterparty ?? "";
    const status = item.successful ? "SUCCESS" : "FAILED";
    const hash = item.hash;
    const link = network === "mainnet" ? `https://stellarchain.io/tx/${hash}` : `https://testnet.stellarchain.io/tx/${hash}`;
    return [d, type, dir, amt, asset, cp, status, hash, link].map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",");
  });
  return [headers.join(","), ...rows].join("\n");
}
