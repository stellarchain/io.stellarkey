import type { ActivityItem } from "./types";

export function fmtAmount(value: string | number, maxDecimals = 7): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-US", { maximumFractionDigits: maxDecimals });
}

export function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: n >= 1000 ? 0 : 2,
  });
}

export function shortenAddr(addr: string, head = 6, tail = 6): string {
  if (addr.length <= head + tail + 3) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
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
  const labels: Record<string, string> = {
    create_account: "Account created",
    payment: "Payment",
    path_payment_strict_receive: "Swap received",
    path_payment_strict_send: "Swap sent",
    change_trust: "Trustline",
    allow_trust: "Trustline auth",
    account_merge: "Account merged",
    manage_data: "Data entry",
    bump_sequence: "Sequence bumped",
    set_options: "Account settings",
    invoke_host_function: "Contract call",
    clawback: "Clawback",
    liquidity_pool_deposit: "Pool deposit",
    liquidity_pool_withdraw: "Pool withdraw",
  };
  return (
    labels[type] ??
    type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

export function generateActivityCsv(items: ActivityItem[], network = "mainnet"): string {
  const headers = [
    "Date (ISO)",
    "Title",
    "Type",
    "Direction",
    "Amount",
    "Asset",
    "Counterparty",
    "Transaction Hash",
    "Explorer URL",
  ];
  const rows = items.map((i) => [
    JSON.stringify(i.createdAt),
    JSON.stringify(i.title),
    JSON.stringify(i.type),
    JSON.stringify(i.direction),
    JSON.stringify(i.amount ?? ""),
    JSON.stringify(i.assetCode ?? ""),
    JSON.stringify(i.counterparty ?? ""),
    JSON.stringify(i.hash),
    JSON.stringify(
      network === "testnet"
        ? `https://testnet.stellarchain.io/tx/${i.hash}`
        : `https://stellarchain.io/tx/${i.hash}`,
    ),
  ]);

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}
