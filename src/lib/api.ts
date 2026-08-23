"use client";

import {
  Account,
  Asset,
  Keypair,
  Operation,
  StrKey,
  TransactionBuilder,
  BASE_FEE,
  type Transaction,
  type FeeBumpTransaction,
} from "@stellar/stellar-sdk";
import type { ActivityItem, AssetBalance } from "./types";
import { getHorizonUrl, NETWORKS, type NetworkKey } from "./stellar";
import { isValidPublicAddress } from "./vault";
import { normalizeAmount } from "./format";
import { signHardwareTx, type HardwareSigner } from "./hardware";
import { getHorizonJson, HorizonRequestError } from "./horizon";
import {
  buildStellarMemo,
  calculateMinimumBalance,
  toStellarAsset,
  type StellarMemoInput,
} from "./stellar-domain";

const MAX_TRUST_LIMIT = "922337203685.4775807";

export async function getJson<T>(url: string): Promise<T | null> {
  try {
    return await getHorizonJson<T>(url);
  } catch (error) {
    if (error instanceof HorizonRequestError && error.kind === "not_found") return null;
    throw error;
  }
}

interface RawBalance {
  asset_type: string;
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
  selling_liabilities?: string;
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
      sellingLiabilities: b.selling_liabilities ?? "0",
      limit: b.limit ?? null,
      isNative,
    };
    if (isNative) nativeBal = item;
    else list.push(item);
  }

  return nativeBal ? [nativeBal, ...list] : list;
}

export async function fetchMinimumNativeBalance(
  publicKey: string,
  network: NetworkKey,
): Promise<string> {
  const horizonUrl = getHorizonUrl(network);
  const [account, ledgers] = await Promise.all([
    getJson<{
      subentry_count?: number;
      num_sponsoring?: number;
      num_sponsored?: number;
    }>(`${horizonUrl}/accounts/${publicKey}`),
    getHorizonJson<{
      _embedded?: { records?: Array<{ base_reserve_in_stroops?: string }> };
    }>(`${horizonUrl}/ledgers?order=desc&limit=1`),
  ]);
  const baseReserveStroops = ledgers._embedded?.records?.[0]?.base_reserve_in_stroops;
  if (!baseReserveStroops || !/^\d+$/.test(baseReserveStroops)) {
    throw new Error("Horizon did not return the current base reserve.");
  }
  return calculateMinimumBalance({
    baseReserveStroops,
    subentryCount: account?.subentry_count ?? 0,
    numSponsoring: account?.num_sponsoring ?? 0,
    numSponsored: account?.num_sponsored ?? 0,
  });
}


/**
 * Native XLM balance for one account.
 * Returns 0 for unfunded/inactive accounts (Horizon 404),
 * and null only when the network request itself failed.
 */
export async function fetchNativeBalance(
  publicKey: string,
  network: NetworkKey,
): Promise<number | null> {
  try {
    const res = await fetch(`${getHorizonUrl(network)}/accounts/${publicKey}`);
    if (res.status === 404) return 0;
    if (!res.ok) return null;
    const data = (await res.json()) as { balances?: RawBalance[] };
    const native = data.balances?.find((b) => b.asset_type === "native");
    return native ? parseFloat(native.balance) : 0;
  } catch {
    return null;
  }
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
  secretKey?: string;
  hardwareSigner?: HardwareSigner;
  balanceId: string;
}): Promise<{ hash: string }> {
  const { network, secretKey, balanceId } = params;
  const horizonUrl = getHorizonUrl(network);
  const cfg = NETWORKS[network];
  const { kp, publicKey } = resolveSource(secretKey, params.hardwareSigner);
  const source = await getJson<{ sequence: string }>(
    `${horizonUrl}/accounts/${publicKey}`,
  );
  if (!source) throw new SendError("Your account does not exist on this network.");

  const tx = new TransactionBuilder(minimalAccount(publicKey, source.sequence), {
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

  try {
    return await signAndSubmit(tx, network, kp, params.hardwareSigner);
  } catch (err) {
    throw new SendError(explainSubmitError(err));
  }
}

export async function mergeAccount(params: {
  network: NetworkKey;
  secretKey?: string;
  hardwareSigner?: HardwareSigner;
  destination: string;
}): Promise<{ hash: string }> {
  const { network, secretKey, destination } = params;
  if (!isValidPublicAddress(destination)) {
    throw new SendError("Destination is not a valid Stellar address.");
  }
  const horizonUrl = getHorizonUrl(network);
  const cfg = NETWORKS[network];
  const { kp, publicKey } = resolveSource(secretKey, params.hardwareSigner);
  const source = await getJson<{ sequence: string }>(
    `${horizonUrl}/accounts/${publicKey}`,
  );
  if (!source) throw new SendError("Account does not exist on this network.");

  const tx = new TransactionBuilder(minimalAccount(publicKey, source.sequence), {
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

  try {
    return await signAndSubmit(tx, network, kp, params.hardwareSigner);
  } catch (err) {
    throw new SendError(explainSubmitError(err));
  }
}

export interface AccountSignerInfo {
  thresholds: {
    low_threshold: number;
    med_threshold: number;
    high_threshold: number;
  };
  signers: Array<{
    key: string;
    weight: number;
    type: string;
  }>;
}

function isByteWeight(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255;
}

function isSignerKeyValid(type: string, key: string): boolean {
  try {
    if (type === "ed25519_public_key") return StrKey.isValidEd25519PublicKey(key);
    if (type === "ed25519_signed_payload") return StrKey.isValidSignedPayload(key);
    if (type === "preauth_tx") return StrKey.decodePreAuthTx(key).length === 32;
    if (type === "sha256_hash") return StrKey.decodeSha256Hash(key).length === 32;
    return false;
  } catch {
    return false;
  }
}

function parseAccountSignerInfo(
  value: unknown,
  accountPublicKey: string,
): AccountSignerInfo | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const thresholds = record.thresholds;
  const signers = record.signers;
  if (!thresholds || typeof thresholds !== "object" || !Array.isArray(signers)) return null;

  const thresholdRecord = thresholds as Record<string, unknown>;
  const low = thresholdRecord.low_threshold;
  const medium = thresholdRecord.med_threshold;
  const high = thresholdRecord.high_threshold;
  if (!isByteWeight(low) || !isByteWeight(medium) || !isByteWeight(high)) return null;

  const parsedSigners: AccountSignerInfo["signers"] = [];
  const seenKeys = new Set<string>();
  for (const value of signers) {
    if (!value || typeof value !== "object") return null;
    const signer = value as Record<string, unknown>;
    if (
      typeof signer.key !== "string" ||
      typeof signer.type !== "string" ||
      !isByteWeight(signer.weight) ||
      !isSignerKeyValid(signer.type, signer.key) ||
      seenKeys.has(signer.key)
    ) {
      return null;
    }
    seenKeys.add(signer.key);
    parsedSigners.push({ key: signer.key, type: signer.type, weight: signer.weight });
  }
  if (!parsedSigners.some(
    (signer) => signer.type === "ed25519_public_key" && signer.key === accountPublicKey,
  )) {
    return null;
  }

  return {
    thresholds: { low_threshold: low, med_threshold: medium, high_threshold: high },
    signers: parsedSigners,
  };
}

export async function fetchAccountSignerInfo(
  publicKey: string,
  network: NetworkKey,
): Promise<AccountSignerInfo | null> {
  const horizonUrl = getHorizonUrl(network);
  const data = await getJson<unknown>(`${horizonUrl}/accounts/${publicKey}`);

  if (!data) return null;
  return parseAccountSignerInfo(data, publicKey);
}

export async function testHorizonPing(network: NetworkKey): Promise<number | null> {
  const horizonUrl = getHorizonUrl(network);
  const start = performance.now();
  try {
    const res = await fetch(`${horizonUrl}/fee_stats`, { method: "HEAD" });
    if (!res.ok) return null;
    return Math.round(performance.now() - start);
  } catch {
    return null;
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
  source_asset_type?: string;
  source_asset_code?: string;
  source_asset_issuer?: string;
  source_amount?: string;
  selling_asset_type?: string;
  selling_asset_code?: string;
  selling_asset_issuer?: string;
  buying_asset_type?: string;
  buying_asset_code?: string;
  buying_asset_issuer?: string;
  buy_amount?: string;
  asset?: string;
  balance_id?: string;
  into?: string;
}

function assetCodeOf(op: RawOperation): string | null {
  if (op.asset_type === "native") return "XLM";
  return op.asset_code ?? null;
}

function activityAssetFields(
  assetType?: string,
  assetCode?: string,
  assetIssuer?: string,
): Pick<ActivityItem, "assetCode" | "assetIssuer"> {
  if (assetType === "native") return { assetCode: "XLM", assetIssuer: null };
  if (assetCode && assetIssuer) return { assetCode, assetIssuer };
  return { assetCode: null, assetIssuer: null };
}

function claimableAssetFields(asset?: string): Pick<ActivityItem, "assetCode" | "assetIssuer"> {
  if (asset === "native") return { assetCode: "XLM", assetIssuer: null };
  if (!asset) return { assetCode: null, assetIssuer: null };
  const separator = asset.indexOf(":");
  return separator > 0 && separator < asset.length - 1
    ? { assetCode: asset.slice(0, separator), assetIssuer: asset.slice(separator + 1) }
    : { assetCode: null, assetIssuer: null };
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
        assetIssuer: null,
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
        assetIssuer: op.asset_type === "native" ? null : op.asset_issuer ?? null,
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
        amount: op.amount ?? null,
        assetCode: assetCodeOf(op),
        assetIssuer: op.asset_type === "native" ? null : op.asset_issuer ?? null,
        counterparty: isIncoming ? op.from ?? null : op.to ?? null,
      };
    }
    case "claim_claimable_balance":
      return {
        ...base,
        title: "Claimed Airdrop",
        direction: "in",
        amount: null,
        assetCode: null,
        assetIssuer: null,
        counterparty: null,
      };
    case "create_claimable_balance":
      return {
        ...base,
        title: "Created Claimable Balance",
        direction: "out",
        amount: op.amount ?? null,
        ...claimableAssetFields(op.asset),
        counterparty: null,
      };
    case "manage_sell_offer":
    case "create_passive_sell_offer":
      return {
        ...base,
        title: "Trade Offer",
        direction: "neutral",
        amount: op.amount ?? null,
        ...activityAssetFields(
          op.selling_asset_type,
          op.selling_asset_code,
          op.selling_asset_issuer,
        ),
        counterparty: null,
      };
    case "manage_buy_offer":
      return {
        ...base,
        title: "Trade Offer",
        direction: "neutral",
        amount: op.buy_amount ?? null,
        ...activityAssetFields(
          op.buying_asset_type,
          op.buying_asset_code,
          op.buying_asset_issuer,
        ),
        counterparty: null,
      };
    case "change_trust":
      return {
        ...base,
        title: "Trustline Added",
        direction: "neutral",
        amount: null,
        assetCode: op.asset_code ?? null,
        assetIssuer: op.asset_issuer ?? null,
        counterparty: op.asset_issuer ?? null,
      };
    case "account_merge":
      return {
        ...base,
        title: "Account Merged",
        direction: op.into === publicKey ? "in" : "out",
        amount: null,
        assetCode: "XLM",
        assetIssuer: null,
        counterparty: op.into ?? null,
      };
    default:
      return {
        ...base,
        title: op.type.replace(/_/g, " "),
        direction: "neutral",
        amount: null,
        assetCode: null,
        assetIssuer: null,
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

export function minimalAccount(publicKey: string, sequence: string) {
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
    if (opCodes.includes("op_low_reserve")) return "The amount is below Stellar's current minimum balance requirement.";
    if (opCodes.includes("op_no_destination")) return "Destination account does not exist. Activate it with XLM first.";
    if (opCodes.includes("op_no_trust")) return "Destination account does not trust this asset.";
    if (opCodes.includes("op_line_full")) return "Destination trustline limit exceeded.";
    if (b.detail) return b.detail;
  }
  if (err instanceof Error) return err.message;
  return "Transaction failed on the Stellar network.";
}

export function resolveSource(
  secretKey: string | undefined,
  hardwareSigner?: HardwareSigner,
): { kp: Keypair | null; publicKey: string } {
  if (hardwareSigner) return { kp: null, publicKey: hardwareSigner.publicKey };
  if (!secretKey) throw new SendError("No signing credential available.");
  const kp = Keypair.fromSecret(secretKey);
  return { kp, publicKey: kp.publicKey() };
}

export async function signAndSubmit(
  tx: Transaction,
  network: NetworkKey,
  kp: Keypair | null,
  hardwareSigner?: HardwareSigner,
): Promise<{ hash: string }> {
  if (hardwareSigner) {
    await signHardwareTx(tx, hardwareSigner);
  } else if (kp) {
    tx.sign(kp);
  } else {
    throw new SendError("No signing credential available.");
  }
  return submitSignedTx(tx, network);
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
  secretKey?: string;
  hardwareSigner?: HardwareSigner;
  destination: string;
  amount: string;
  assetCode: string;
  issuer?: string | null;
  memo?: StellarMemoInput;
  /** @deprecated Use `memo` so the memo type is preserved. */
  memoText?: string;
  feeStroops?: number;
}

export async function sendPayment(params: SendPaymentParams): Promise<{ hash: string }> {
  const { network, secretKey, destination, amount, assetCode, issuer, memoText, feeStroops = 100 } = params;
  const memo = buildStellarMemo(
    params.memo ?? (memoText ? { type: "text", value: memoText } : null),
  );

  if (!isValidPublicAddress(destination)) {
    throw new SendError("Destination is not a valid Stellar address.");
  }

  const horizonUrl = getHorizonUrl(network);
  const cfg = NETWORKS[network];
  const { kp, publicKey } = resolveSource(secretKey, params.hardwareSigner);
  const source = await getJson<{ sequence: string }>(
    `${horizonUrl}/accounts/${publicKey}`,
  );
  if (!source) throw new SendError("Your account does not exist on this network.");

  const destExists = await getJson(`${horizonUrl}/accounts/${destination}`) !== null;
  const paymentAsset = toStellarAsset(assetCode, issuer);
  const isNative = paymentAsset.isNative();

  if (!destExists && !isNative) {
    throw new SendError(
      "Destination account doesn't exist yet. New accounts must be activated with XLM.",
    );
  }

  const builder = new TransactionBuilder(minimalAccount(publicKey, source.sequence), {
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
        asset: paymentAsset,
      }),
    );
  }

  if (memo) builder.addMemo(memo);

  const tx = builder.setTimeout(180).build();

  try {
    return await signAndSubmit(tx, network, kp, params.hardwareSigner);
  } catch (err) {
    throw new SendError(explainSubmitError(err));
  }
}

export async function sendBatchPayments(params: {
  network: NetworkKey;
  secretKey?: string;
  hardwareSigner?: HardwareSigner;
  payments: Array<{
    destination: string;
    amount: string;
    assetCode: string;
    issuer?: string | null;
  }>;
  memo?: StellarMemoInput;
  /** @deprecated Use `memo` so the memo type is preserved. */
  memoText?: string;
}): Promise<{ hash: string }> {
  const { network, secretKey, payments, memoText } = params;
  const memo = buildStellarMemo(
    params.memo ?? (memoText ? { type: "text", value: memoText } : null),
  );
  if (payments.length === 0) throw new SendError("No recipients provided.");
  if (payments.length > 100) {
    throw new SendError("A Stellar transaction can contain at most 100 operations.");
  }

  const prepared = payments.map((payment) => {
    const destination = payment.destination.trim();
    if (!isValidPublicAddress(destination)) {
      throw new SendError("One of the recipients is not a valid Stellar address.");
    }
    return {
      ...payment,
      destination,
      amount: normalizeAmount(payment.amount),
      asset: toStellarAsset(payment.assetCode, payment.issuer),
    };
  });

  const horizonUrl = getHorizonUrl(network);
  const cfg = NETWORKS[network];
  const { kp, publicKey } = resolveSource(secretKey, params.hardwareSigner);
  const source = await getJson<{ sequence: string }>(
    `${horizonUrl}/accounts/${publicKey}`,
  );
  if (!source) throw new SendError("Your account does not exist on this network.");

  const uniqueDestinations = [...new Set(prepared.map((payment) => payment.destination))];
  const destinationEntries = await Promise.all(
    uniqueDestinations.map(async (destination) => [
      destination,
      destination === publicKey || (await getJson(`${horizonUrl}/accounts/${destination}`)) !== null,
    ] as const),
  );
  const destinationExists = new Map(destinationEntries);
  const activatedInTransaction = new Set<string>();

  const builder = new TransactionBuilder(minimalAccount(publicKey, source.sequence), {
    fee: BASE_FEE,
    networkPassphrase: cfg.networkPassphrase,
  });

  for (const payment of prepared) {
    const exists = destinationExists.get(payment.destination) === true;
    if (!exists && !payment.asset.isNative()) {
      throw new SendError(
        `Destination ${payment.destination} must be activated with XLM before receiving ${payment.asset.getCode()}.`,
      );
    }
    if (!exists && !activatedInTransaction.has(payment.destination)) {
      builder.addOperation(
        Operation.createAccount({
          destination: payment.destination,
          startingBalance: payment.amount,
        }),
      );
      activatedInTransaction.add(payment.destination);
    } else {
      builder.addOperation(
        Operation.payment({
          destination: payment.destination,
          amount: payment.amount,
          asset: payment.asset,
        }),
      );
    }
  }

  if (memo) builder.addMemo(memo);

  const tx = builder.setTimeout(180).build();

  try {
    return await signAndSubmit(tx, network, kp, params.hardwareSigner);
  } catch (err) {
    throw new SendError(explainSubmitError(err));
  }
}

export async function changeTrust(params: {
  network: NetworkKey;
  secretKey?: string;
  hardwareSigner?: HardwareSigner;
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

  const { kp, publicKey } = resolveSource(secretKey, params.hardwareSigner);
  const source = await getJson<{ sequence: string }>(
    `${horizonUrl}/accounts/${publicKey}`,
  );
  if (!source) throw new SendError("Your account does not exist on this network.");

  const tx = new TransactionBuilder(minimalAccount(publicKey, source.sequence), {
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

  try {
    return await signAndSubmit(tx, network, kp, params.hardwareSigner);
  } catch (err) {
    throw new SendError(explainSubmitError(err));
  }
}


/**
 * Add multiple trustlines atomically — one transaction, N changeTrust ops.
 * All-or-nothing: if any op fails validation on-chain, none are created.
 */
export async function changeTrustBatch(params: {
  network: NetworkKey;
  secretKey?: string;
  hardwareSigner?: HardwareSigner;
  assets: Array<{ code: string; issuer: string }>;
}): Promise<{ hash: string; added: number }> {
  const { network, secretKey, assets } = params;
  const horizonUrl = getHorizonUrl(network);
  const cfg = NETWORKS[network];

  if (assets.length === 0) throw new SendError("No assets selected.");
  if (assets.length > 100) throw new SendError("Maximum 100 trustlines per transaction.");

  const seen = new Set<string>();
  for (const a of assets) {
    const code = a.code.trim();
    if (!code || code.length > 12) {
      throw new SendError(`Invalid asset code: "${a.code}" (1–12 characters).`);
    }
    if (!isValidPublicAddress(a.issuer)) {
      throw new SendError(`Invalid issuer for ${code}.`);
    }
    const key = `${code}:${a.issuer}`;
    if (seen.has(key)) throw new SendError(`Duplicate asset selected: ${code}.`);
    seen.add(key);
  }

  const { kp, publicKey } = resolveSource(secretKey, params.hardwareSigner);
  const source = await getJson<{ sequence: string }>(
    `${horizonUrl}/accounts/${publicKey}`,
  );
  if (!source) throw new SendError("Your account does not exist on this network.");

  const builder = new TransactionBuilder(minimalAccount(publicKey, source.sequence), {
    fee: BASE_FEE,
    networkPassphrase: cfg.networkPassphrase,
  });

  for (const a of assets) {
    builder.addOperation(
      Operation.changeTrust({
        asset: new Asset(a.code.trim(), a.issuer.trim()),
        limit: MAX_TRUST_LIMIT,
      }),
    );
  }

  const tx = builder.setTimeout(180).build();

  try {
    const result = await signAndSubmit(tx, network, kp, params.hardwareSigner);
    return { hash: result.hash, added: assets.length };
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
