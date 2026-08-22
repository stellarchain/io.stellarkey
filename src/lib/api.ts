"use client";

import {
  Account,
  Asset,
  Keypair,
  Memo,
  Operation,
  TransactionBuilder,
  BASE_FEE,
  type Transaction,
  type FeeBumpTransaction,
} from "@stellar/stellar-sdk";
import type { ActivityItem, AssetBalance } from "./types";
import { getHorizonUrl, NETWORKS, type NetworkKey } from "./stellar";
import { isValidPublicAddress } from "./vault";
import { normalizeAmount } from "./format";

const MAX_TRUST_LIMIT = "922337203685.4775807";

export async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
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
  const horizonUrl = getHorizonUrl(network);
  const data = await getJson<{ balances?: RawBalance[] }>(
    `${horizonUrl}/accounts/${publicKey}`,
  );
  if (!data?.balances) return [];

  const list: AssetBalance[] = [];
  let nativeBal: AssetBalance | null = null;

  for (const b of data.balances) {
    const isNative = b.asset_type === "native";
    const item: AssetBalance = {
      key: isNative ? "native" : `${b.asset_code}:${b.asset_issuer}`,
      code: isNative ? "XLM" : b.asset_code ?? "UNKNOWN",
      issuer: isNative ? null : b.asset_issuer ?? null,
      balance: b.balance,
      limit: b.limit ?? null,
      isNative,
    };
    if (isNative) nativeBal = item;
    else list.push(item);
  }

  return nativeBal ? [nativeBal, ...list] : list;
}

export interface ClaimableBalanceItem {
  id: string;
  assetCode: string;
  issuer: string | null;
  amount: string;
  sponsor?: string;
}

export async function fetchClaimableBalances(
  publicKey: string,
  network: NetworkKey,
): Promise<ClaimableBalanceItem[]> {
  const horizonUrl = getHorizonUrl(network);
  const data = await getJson<{
    _embedded?: {
      records?: Array<{
        id: string;
        asset: string;
        amount: string;
        sponsor?: string;
      }>;
    };
  }>(`${horizonUrl}/claimable_balances?claimant=${publicKey}&limit=20`);

  const records = data?._embedded?.records ?? [];
  return records.map((r) => {
    const isNative = r.asset === "native";
    const parts = r.asset.split(":");
    const code = isNative ? "XLM" : parts[0] ?? "UNKNOWN";
    const issuer = isNative ? null : parts[1] ?? null;
    return {
      id: r.id,
      assetCode: code,
      issuer,
      amount: r.amount,
      sponsor: r.sponsor,
    };
  });
}

export async function claimClaimableBalance(params: {
  network: NetworkKey;
  secretKey: string;
  balanceId: string;
}): Promise<{ hash: string }> {
  const { network, secretKey, balanceId } = params;
  const horizonUrl = getHorizonUrl(network);
  const cfg = NETWORKS[network];
  const kp = Keypair.fromSecret(secretKey);
  const source = await getJson<{ sequence: string }>(
    `${horizonUrl}/accounts/${kp.publicKey()}`,
  );
  if (!source) throw new SendError("Your account does not exist on this network.");

  const tx = new TransactionBuilder(minimalAccount(kp.publicKey(), source.sequence), {
    fee: BASE_FEE,
    networkPassphrase: cfg.networkPassphrase,
  })
    .addOperation(
      Operation.claimClaimableBalance({
        balanceId,
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

export async function mergeAccount(params: {
  network: NetworkKey;
  secretKey: string;
  destination: string;
}): Promise<{ hash: string }> {
  const { network, secretKey, destination } = params;
  if (!isValidPublicAddress(destination)) {
    throw new SendError("Destination is not a valid Stellar address.");
  }
  const horizonUrl = getHorizonUrl(network);
  const cfg = NETWORKS[network];
  const kp = Keypair.fromSecret(secretKey);
  const source = await getJson<{ sequence: string }>(
    `${horizonUrl}/accounts/${kp.publicKey()}`,
  );
  if (!source) throw new SendError("Account does not exist on this network.");

  const tx = new TransactionBuilder(minimalAccount(kp.publicKey(), source.sequence), {
    fee: BASE_FEE,
    networkPassphrase: cfg.networkPassphrase,
  })
    .addOperation(
      Operation.accountMerge({
        destination,
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

interface RawOperation {
  id: string;
  type: string;
  created_at: string;
  transaction_successful: boolean;
  transaction_hash: string;
  source_account?: string;
  account?: string;
  funder?: string;
  starting_balance?: string;
  from?: string;
  to?: string;
  amount?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  source_asset_code?: string;
  source_amount?: string;
  dest_asset_code?: string;
  dest_amount?: string;
  into?: string;
}

function assetCodeOf(op: RawOperation): string | null {
  if (op.asset_type === "native") return "XLM";
  return op.asset_code ?? null;
}

function mapOperation(op: RawOperation, publicKey: string): ActivityItem {
  const base = {
    id: op.id,
    type: op.type,
    hash: op.transaction_hash,
    createdAt: op.created_at,
    successful: op.transaction_successful,
  };

  switch (op.type) {
    case "create_account": {
      const isMe = op.account === publicKey;
      return {
        ...base,
        title: isMe ? "Account Activated" : "Created Account",
        direction: isMe ? "in" : "out",
        amount: op.starting_balance ?? null,
        assetCode: "XLM",
        counterparty: isMe ? op.funder ?? null : op.account ?? null,
      };
    }
    case "payment": {
      const isIncoming = op.to === publicKey;
      return {
        ...base,
        title: isIncoming ? "Received Payment" : "Sent Payment",
        direction: isIncoming ? "in" : "out",
        amount: op.amount ?? null,
        assetCode: assetCodeOf(op),
        counterparty: isIncoming ? op.from ?? null : op.to ?? null,
      };
    }
    case "path_payment_strict_receive":
    case "path_payment_strict_send": {
      const isIncoming = op.to === publicKey;
      return {
        ...base,
        title: "DEX Swap",
        direction: "neutral",
        amount: op.amount ?? op.dest_amount ?? null,
        assetCode: op.dest_asset_code ?? (op.asset_type === "native" ? "XLM" : null),
        counterparty: isIncoming ? op.from ?? null : op.to ?? null,
      };
    }
    case "claim_claimable_balance":
      return {
        ...base,
        title: "Claimed Airdrop",
        direction: "in",
        amount: op.amount ?? null,
        assetCode: assetCodeOf(op),
        counterparty: null,
      };
    case "change_trust":
      return {
        ...base,
        title: "Trustline Added",
        direction: "neutral",
        amount: null,
        assetCode: op.asset_code ?? null,
        counterparty: op.asset_issuer ?? null,
      };
    case "account_merge":
      return {
        ...base,
        title: "Account Merged",
        direction: op.into === publicKey ? "in" : "out",
        amount: null,
        assetCode: "XLM",
        counterparty: op.into ?? null,
      };
    default:
      return {
        ...base,
        title: op.type.replace(/_/g, " "),
        direction: "neutral",
        amount: op.amount ?? null,
        assetCode: assetCodeOf(op),
        counterparty: null,
      };
  }
}

export async function fetchActivity(
  publicKey: string,
  network: NetworkKey,
  limit = 30,
  cursor?: string,
): Promise<{ items: ActivityItem[]; nextCursor: string | null }> {
  const horizonUrl = getHorizonUrl(network);
  const url = new URL(`${horizonUrl}/accounts/${publicKey}/operations`);
  url.searchParams.set("order", "desc");
  url.searchParams.set("limit", String(limit));
  if (cursor) url.searchParams.set("cursor", cursor);

  const data = await getJson<{ _embedded?: { records?: RawOperation[] } }>(url.toString());
  const records = data?._embedded?.records ?? [];
  const items = records.map((op) => mapOperation(op, publicKey));
  const nextCursor = records.length === limit ? records[records.length - 1].id : null;
  return { items, nextCursor };
}

export async function fundWithFriendbot(
  publicKey: string,
  network: NetworkKey,
): Promise<void> {
  const cfg = NETWORKS[network];
  if (!cfg.friendbotUrl) {
    throw new Error("Friendbot is only available on testnet.");
  }
  const res = await fetch(`${cfg.friendbotUrl}?addr=${encodeURIComponent(publicKey)}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Friendbot funding failed: ${text || res.statusText}`);
  }
}

function minimalAccount(publicKey: string, sequence: string) {
  return new Account(publicKey, sequence);
}

export class SendError extends Error {}

interface SubmitFailureBody {
  title?: string;
  detail?: string;
  extras?: {
    result_codes?: {
      transaction?: string;
      operations?: string[];
    };
  };
}

export function explainSubmitError(err: unknown): string {
  if (err && typeof err === "object" && "body" in err) {
    const b = err.body as SubmitFailureBody;
    const txCode = b.extras?.result_codes?.transaction;
    const opCodes = b.extras?.result_codes?.operations ?? [];
    if (txCode === "tx_bad_seq") return "Sequence number mismatch. Please retry.";
    if (txCode === "tx_insufficient_fee") return "Fee was too low for network conditions.";
    if (txCode === "tx_insufficient_balance") return "Insufficient balance to cover payment and reserve.";
    if (opCodes.includes("op_underfunded")) return "Insufficient balance for this payment.";
    if (opCodes.includes("op_no_destination")) return "Destination account does not exist. Activate it with XLM first.";
    if (opCodes.includes("op_no_trust")) return "Destination account does not trust this asset.";
    if (opCodes.includes("op_line_full")) return "Destination trustline limit exceeded.";
    if (b.detail) return b.detail;
  }
  if (err instanceof Error) return err.message;
  return "Transaction failed on the Stellar network.";
}

export async function submitSignedTx(
  tx: Transaction | FeeBumpTransaction,
  network: NetworkKey,
): Promise<{ hash: string }> {
  const horizonUrl = getHorizonUrl(network);
  const form = new URLSearchParams();
  form.set("tx", tx.toXdr());

  const res = await fetch(`${horizonUrl}/transactions`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  const body = (await res.json()) as SubmitFailureBody & { hash?: string };
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
  feeStroops?: number;
}

export async function sendPayment(params: SendPaymentParams): Promise<{ hash: string }> {
  const { network, secretKey, destination, amount, assetCode, issuer, memoText, feeStroops = 100 } = params;

  if (!isValidPublicAddress(destination)) {
    throw new SendError("Destination is not a valid Stellar address.");
  }
  if (memoText && new TextEncoder().encode(memoText).length > 28) {
    throw new SendError("Memo must be 28 bytes or fewer.");
  }

  const horizonUrl = getHorizonUrl(network);
  const cfg = NETWORKS[network];
  const kp = Keypair.fromSecret(secretKey);
  const source = await getJson<{ sequence: string }>(
    `${horizonUrl}/accounts/${kp.publicKey()}`,
  );
  if (!source) throw new SendError("Your account does not exist on this network.");

  const destExists = await getJson(`${horizonUrl}/accounts/${destination}`) !== null;
  const isNative = assetCode === "XLM";

  if (!destExists && !isNative) {
    throw new SendError(
      "Destination account doesn't exist yet. New accounts must be activated with XLM.",
    );
  }

  const builder = new TransactionBuilder(minimalAccount(kp.publicKey(), source.sequence), {
    fee: String(feeStroops),
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

export async function sendBatchPayments(params: {
  network: NetworkKey;
  secretKey: string;
  payments: Array<{
    destination: string;
    amount: string;
    assetCode: string;
    issuer?: string | null;
  }>;
  memoText?: string;
}): Promise<{ hash: string }> {
  const { network, secretKey, payments, memoText } = params;
  if (payments.length === 0) throw new SendError("No recipients provided.");

  const horizonUrl = getHorizonUrl(network);
  const cfg = NETWORKS[network];
  const kp = Keypair.fromSecret(secretKey);
  const source = await getJson<{ sequence: string }>(
    `${horizonUrl}/accounts/${kp.publicKey()}`,
  );
  if (!source) throw new SendError("Your account does not exist on this network.");

  const builder = new TransactionBuilder(minimalAccount(kp.publicKey(), source.sequence), {
    fee: String(parseInt(BASE_FEE, 10) * payments.length),
    networkPassphrase: cfg.networkPassphrase,
  });

  for (const p of payments) {
    const isNative = p.assetCode === "XLM";
    builder.addOperation(
      Operation.payment({
        destination: p.destination,
        amount: normalizeAmount(p.amount),
        asset: isNative ? Asset.native() : new Asset(p.assetCode, p.issuer!),
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
  const horizonUrl = getHorizonUrl(network);
  const cfg = NETWORKS[network];
  if (!code.trim() || code.trim().length > 12) {
    throw new SendError("Asset code must be 1–12 characters.");
  }
  if (!isValidPublicAddress(issuer)) {
    throw new SendError("Issuer is not a valid Stellar address.");
  }

  const kp = Keypair.fromSecret(secretKey);
  const source = await getJson<{ sequence: string }>(
    `${horizonUrl}/accounts/${kp.publicKey()}`,
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

export interface FeeStats {
  lastLedgerBaseFee: number;
  minAcceptedFee: number;
  modeAcceptedFee: number;
  p90AcceptedFee: number;
  p99AcceptedFee: number;
}

export async function fetchFeeStats(network: NetworkKey): Promise<FeeStats | null> {
  const horizonUrl = getHorizonUrl(network);
  const data = await getJson<{
    last_ledger_base_fee: string;
    fee_charged?: { min: string; mode: string; p90: string; p99: string };
  }>(`${horizonUrl}/fee_stats`);

  if (!data) return null;
  return {
    lastLedgerBaseFee: parseInt(data.last_ledger_base_fee || "100", 10),
    minAcceptedFee: parseInt(data.fee_charged?.min || "100", 10),
    modeAcceptedFee: parseInt(data.fee_charged?.mode || "100", 10),
    p90AcceptedFee: parseInt(data.fee_charged?.p90 || "150", 10),
    p99AcceptedFee: parseInt(data.fee_charged?.p99 || "300", 10),
  };
}

interface CoinGeckoPriceResp {
  stellar?: { usd?: number };
}

export async function fetchXlmPrice(): Promise<number | null> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd",
    );
    if (!res.ok) return null;
    const json = (await res.json()) as CoinGeckoPriceResp;
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

interface CoinGeckoChartResp {
  prices?: Array<[number, number]>;
}

export async function fetchXlmSeries(range: PriceRange): Promise<PriceSeries | null> {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/stellar/market_chart?vs_currency=usd&days=${RANGE_DAYS[range]}`,
    );
    if (!res.ok) return null;
    const json = (await res.json()) as CoinGeckoChartResp;
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

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

export async function waitForTransaction(
  network: NetworkKey,
  hash: string,
  timeoutMs = 25_000,
): Promise<boolean | null> {
  const horizonUrl = getHorizonUrl(network);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const tx = await getJson<{ successful: boolean }>(
        `${horizonUrl}/transactions/${hash}`,
      );
      if (tx) return tx.successful;
    } catch {
      void 0;
    }
    await delay(1200);
  }
  return null;
}
