"use client";

import {
  Account,
  Asset,
  Keypair,
  Memo,
  Operation,
  TransactionBuilder,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { NETWORKS, type NetworkKey } from "./stellar";
import type { ActivityItem, AssetBalance } from "./types";
import { isValidPublicAddress } from "./vault";
import { normalizeAmount } from "./format";

const MAX_TRUST_LIMIT = "922337203685.4775807";

export async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Horizon request failed (${res.status})`);
  return (await res.json()) as T;
}

interface RawBalance {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
  limit?: string;
}

export async function fetchBalances(
  publicKey: string,
  network: NetworkKey,
): Promise<AssetBalance[]> {
  const cfg = NETWORKS[network];
  const account = await getJson<{ balances: RawBalance[] }>(
    `${cfg.horizonUrl}/accounts/${publicKey}`,
  );
  if (!account?.balances) return [];
  const rows: AssetBalance[] = [];
  for (const b of account.balances) {
    if (b.asset_type === "liquidity_pool_shares") continue;
    const isNative = b.asset_type === "native";
    rows.push({
      key: isNative ? "native" : `${b.asset_code}:${b.asset_issuer}`,
      code: isNative ? "XLM" : b.asset_code!,
      issuer: isNative ? null : b.asset_issuer!,
      balance: b.balance,
      limit: b.limit ?? null,
      isNative,
    });
  }
  rows.sort((a, b) => {
    if (a.isNative) return -1;
    if (b.isNative) return 1;
    return parseFloat(b.balance) - parseFloat(a.balance);
  });
  return rows;
}

interface RawOperation {
  id: string;
  paging_token?: string;
  type: string;
  created_at: string;
  transaction_hash: string;
  transaction_successful?: boolean;
  from?: string;
  to?: string;
  funder?: string;
  account?: string;
  into?: string;
  trustor?: string;
  amount?: string;
  starting_balance?: string;
  limit?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
}

function assetCodeOf(op: RawOperation): string | null {
  if (op.asset_type === "native") return "XLM";
  if (typeof op.asset_type === "string") return op.asset_code ?? null;
  return null;
}

function mapOperation(op: RawOperation, publicKey: string): ActivityItem {
  let title = "";
  let direction: ActivityItem["direction"] = "neutral";
  let amount: string | null = null;
  let assetCode: string | null = null;
  let counterparty: string | null = null;

  switch (op.type) {
    case "payment":
      assetCode = assetCodeOf(op);
      amount = op.amount ?? null;
      counterparty = op.from === publicKey ? op.to ?? null : op.from ?? null;
      direction = op.from === publicKey ? "out" : "in";
      title = direction === "out" ? "Sent" : "Received";
      break;
    case "create_account": {
      const outgoing = op.funder === publicKey;
      direction = outgoing ? "out" : "in";
      amount = op.starting_balance ?? null;
      assetCode = "XLM";
      counterparty = outgoing ? op.account ?? null : op.funder ?? null;
      title = outgoing ? "Account funded" : "Account activated";
      break;
    }
    case "account_merge":
      direction = op.into === publicKey ? "in" : "out";
      counterparty = op.into ?? null;
      title = "Account merged";
      break;
    case "change_trust":
      title = parseFloat(op.limit ?? "0") === 0 ? "Trustline removed" : "Trustline added";
      assetCode = assetCodeOf(op);
      counterparty = op.asset_issuer ?? null;
      break;
    case "path_payment_strict_send":
    case "path_payment_strict_receive":
      assetCode = assetCodeOf(op);
      amount = op.amount ?? null;
      counterparty = op.from === publicKey ? op.to ?? null : op.from ?? null;
      direction = op.from === publicKey ? "out" : "in";
      title = direction === "out" ? "Swap sent" : "Swap received";
      break;
    default:
      title = op.type.replace(/_/g, " ").replace(/\b\w/, (c) => c.toUpperCase());
      break;
  }

  return {
    id: op.id,
    type: op.type,
    title,
    direction,
    amount,
    assetCode,
    counterparty,
    hash: op.transaction_hash,
    createdAt: op.created_at,
    successful: op.transaction_successful !== false,
  };
}

export async function fetchActivity(
  publicKey: string,
  network: NetworkKey,
  limit = 30,
  cursor?: string,
): Promise<{ items: ActivityItem[]; nextCursor: string | null }> {
  const cfg = NETWORKS[network];
  const params = new URLSearchParams({ limit: String(limit), order: "desc" });
  if (cursor) params.set("cursor", cursor);
  const page = await getJson<{
    _embedded: { records: (RawOperation & { paging_token: string })[] };
  } | null>(`${cfg.horizonUrl}/accounts/${publicKey}/operations?${params.toString()}`);
  const records = page?._embedded?.records ?? [];
  const items = records.map((op) => mapOperation(op, publicKey));
  const nextCursor =
    records.length === limit ? records[records.length - 1]?.paging_token ?? null : null;
  return { items, nextCursor };
}

export async function fundWithFriendbot(
  publicKey: string,
  network: NetworkKey,
): Promise<void> {
  const cfg = NETWORKS[network];
  if (!cfg.friendbotUrl) throw new Error("Friendbot is only available on testnet");
  const res = await fetch(`${cfg.friendbotUrl}?addr=${encodeURIComponent(publicKey)}`);
  if (!res.ok) {
    let detail = `Friendbot responded ${res.status}`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      void 0;
    }
    throw new Error(detail);
  }
}

function minimalAccount(publicKey: string, sequence: string) {
  return new Account(publicKey, sequence);
}

export class SendError extends Error {}

interface SubmitFailureBody {
  title?: string;
  detail?: string;
  extras?: { result_codes?: { transaction?: string; operations?: string[] } };
}

export function explainSubmitError(err: unknown): string {
  const e = err as { status?: number; body?: SubmitFailureBody; message?: string };
  const codes = e.body?.extras?.result_codes;
  if (codes) {
    const tx = codes.transaction;
    const op = codes.operations?.find((c) => c !== "op_success");
    if (tx === "tx_insufficient_fee")
      return "Fee too low for current network load. Try again.";
    if (tx === "tx_bad_seq") return "Account state changed. Refresh and retry.";
    if (tx === "tx_no_source_account")
      return "Source account does not exist on this network.";
    if (tx === "tx_insufficient_balance")
      return "Insufficient balance after reserves and liabilities.";
    if (op === "op_underfunded")
      return "Insufficient balance after accounting for minimum reserves.";
    if (op === "op_low_reserve")
      return "Amount is below the minimum balance required to activate an account.";
    if (op === "op_no_trust") return "Destination has no trustline for that asset.";
    if (op === "op_no_issuer") return "Asset issuer account does not exist.";
    if (op === "op_line_full") return "Destination would exceed its trustline limit.";
    const all = [tx, ...(codes.operations ?? [])].filter(Boolean).join(", ");
    return `Network rejected the transaction (${all}).`;
  }
  if (e.message && !e.message.startsWith("Failed to fetch")) return e.message;
  return "Network request failed. Check your connection and try again.";
}

export async function submitSignedTx(
  tx: ReturnType<TransactionBuilder["build"]>,
  network: NetworkKey,
): Promise<{ hash: string }> {
  const cfg = NETWORKS[network];
  const res = await fetch(`${cfg.horizonUrl}/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ tx: tx.toXdr() }).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as SubmitFailureBody & { hash?: string };
  if (!res.ok || !body.hash) {
    const error = new Error(body.title ?? body.detail ?? "Submission failed");
    Object.assign(error, { status: res.status, body });
    throw error;
  }
  return { hash: body.hash };
}

export interface SendPaymentParams {
  network: NetworkKey;
  secretKey: string;
  destination: string;
  amount: string;
  assetCode: string;
  issuer?: string | null;
  memoText?: string;
}

export async function sendPayment(params: SendPaymentParams): Promise<{ hash: string }> {
  const { network, secretKey, destination, amount, assetCode, issuer, memoText } = params;

  if (!isValidPublicAddress(destination)) {
    throw new SendError("Destination is not a valid Stellar address.");
  }
  if (memoText && new TextEncoder().encode(memoText).length > 28) {
    throw new SendError("Memo must be 28 bytes or fewer.");
  }

  const cfg = NETWORKS[network];
  const kp = Keypair.fromSecret(secretKey);
  const source = await getJson<{ sequence: string }>(
    `${cfg.horizonUrl}/accounts/${kp.publicKey()}`,
  );
  if (!source) throw new SendError("Your account does not exist on this network.");

  const destExists = await getJson(`${cfg.horizonUrl}/accounts/${destination}`) !== null;
  const isNative = assetCode === "XLM";

  if (!destExists && !isNative) {
    throw new SendError(
      "Destination account doesn't exist yet. New accounts must be activated with XLM.",
    );
  }

  const builder = new TransactionBuilder(minimalAccount(kp.publicKey(), source.sequence), {
    fee: BASE_FEE,
    networkPassphrase: cfg.networkPassphrase,
  });

  if (!destExists) {
    builder.addOperation(
      Operation.createAccount({
        destination,
        startingBalance: normalizeAmount(amount),
      }),
    );
  } else {
    builder.addOperation(
      Operation.payment({
        destination,
        amount: normalizeAmount(amount),
        asset: isNative ? Asset.native() : new Asset(assetCode, issuer!),
      }),
    );
  }

  if (memoText) builder.addMemo(Memo.text(memoText));

  const tx = builder.setTimeout(180).build();
  tx.sign(kp);

  try {
    return await submitSignedTx(tx, network);
  } catch (err) {
    throw new SendError(explainSubmitError(err));
  }
}

export async function changeTrust(params: {
  network: NetworkKey;
  secretKey: string;
  code: string;
  issuer: string;
  add: boolean;
}): Promise<{ hash: string }> {
  const { network, secretKey, code, issuer, add } = params;
  const cfg = NETWORKS[network];
  if (!code.trim() || code.trim().length > 12) {
    throw new SendError("Asset code must be 1–12 characters.");
  }
  if (!isValidPublicAddress(issuer)) {
    throw new SendError("Issuer is not a valid Stellar address.");
  }

  const kp = Keypair.fromSecret(secretKey);
  const source = await getJson<{ sequence: string }>(
    `${cfg.horizonUrl}/accounts/${kp.publicKey()}`,
  );
  if (!source) throw new SendError("Your account does not exist on this network.");

  const tx = new TransactionBuilder(minimalAccount(kp.publicKey(), source.sequence), {
    fee: BASE_FEE,
    networkPassphrase: cfg.networkPassphrase,
  })
    .addOperation(
      Operation.changeTrust({
        asset: new Asset(code.trim(), issuer.trim()),
        limit: add ? MAX_TRUST_LIMIT : "0",
      }),
    )
    .setTimeout(180)
    .build();
  tx.sign(kp);

  try {
    return await submitSignedTx(tx, network);
  } catch (err) {
    throw new SendError(explainSubmitError(err));
  }
}

export async function fetchXlmPrice(): Promise<number | null> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd",
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { stellar?: { usd?: number } };
    return json.stellar?.usd ?? null;
  } catch {
    return null;
  }
}

export type PriceRange = "1D" | "7D" | "1M" | "1Y";

const RANGE_DAYS: Record<PriceRange, number> = { "1D": 1, "7D": 7, "1M": 30, "1Y": 365 };

export interface PriceSeries {
  range: PriceRange;
  points: Array<{ t: number; p: number }>;
  changePct: number;
  current: number;
}

export async function fetchXlmSeries(range: PriceRange): Promise<PriceSeries | null> {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/stellar/market_chart?vs_currency=usd&days=${RANGE_DAYS[range]}`,
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { prices?: Array<[number, number]> };
    if (!json.prices || json.prices.length < 2) return null;
    const points = json.prices.map(([t, p]) => ({ t, p }));
    const first = points[0].p;
    const last = points[points.length - 1].p;
    return {
      range,
      points,
      current: last,
      changePct: ((last - first) / first) * 100,
    };
  } catch {
    return null;
  }
}

export async function waitForTransaction(
  network: NetworkKey,
  hash: string,
  timeoutMs = 25_000,
): Promise<boolean | null> {
  const cfg = NETWORKS[network];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const tx = await getJson<{ successful: boolean }>(
        `${cfg.horizonUrl}/transactions/${hash}`,
      );
      if (tx) return tx.successful;
    } catch {
      void 0;
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  return null;
}
