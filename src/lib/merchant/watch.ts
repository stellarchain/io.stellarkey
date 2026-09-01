import { NETWORKS, type NetworkKey } from "../stellar";
import { getHorizonJson } from "../horizon";
import { amountToStroops } from "../stellar-domain";
import { isValidPaymentAddress, isValidPublicAddress } from "../vault";
import type { ObservedPayment } from "./match";
import type { AcceptedAsset } from "./types";
import { isMerchantRoutingId } from "./routing";
export { merchantCursorKey, merchantWatchDestinations } from "./watch-targets";

/**
 * The payment watcher.
 *
 * The wallet's existing `fetchActivity` reads `/accounts/{id}/operations`, and
 * Horizon puts the memo on the *transaction*, not the operation — so that
 * pipeline structurally cannot reconcile a charge. This watcher reads
 * `/payments` with `join=transactions`, which embeds the transaction and its
 * memo alongside each payment, and pages forward from a stored cursor so a till
 * left open all day never re-reads the morning.
 *
 * It is deliberately a separate loop from the wallet's 15-second refresh: that
 * cycle already issues several calls, and a till needs a different cadence from
 * a portfolio.
 */

interface RawTransaction {
  memo?: string;
  memo_type?: string;
  successful?: boolean;
}

interface RawPayment {
  id: string;
  type: string;
  transaction_hash: string;
  transaction_successful?: boolean;
  created_at: string;
  paging_token: string;
  to?: string;
  to_muxed?: string;
  to_muxed_id?: string;
  from?: string;
  from_muxed?: string;
  from_muxed_id?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  amount?: string;
  transaction?: RawTransaction;
}

interface PaymentsPage {
  _embedded?: { records?: RawPayment[] };
}

function assertSuccessfulPaymentRecord(record: RawPayment): void {
  if (
    !record ||
    typeof record.id !== "string" ||
    !record.id ||
    typeof record.type !== "string" ||
    typeof record.paging_token !== "string" ||
    !/^[1-9][0-9]*$/.test(record.paging_token) ||
    typeof record.transaction_hash !== "string" ||
    !/^[0-9a-f]{64}$/i.test(record.transaction_hash) ||
    record.transaction_successful !== true ||
    record.transaction?.successful !== true ||
    typeof record.created_at !== "string" ||
    !Number.isFinite(Date.parse(record.created_at))
  ) {
    throw new Error("Invalid Horizon payment: explicit successful transaction evidence is required.");
  }
}

export interface WatchResult {
  payments: ObservedPayment[];
  /** Paging token to resume from next poll. */
  cursor: string | null;
  /** Highest ledger sequence observed, for the "watching ledger N" indicator. */
  latestLedger: number | null;
}

function assetOf(record: RawPayment): AcceptedAsset | null {
  if (record.asset_type === "native") return { code: "XLM", issuer: null };
  if (record.asset_code && record.asset_issuer) {
    return { code: record.asset_code, issuer: record.asset_issuer };
  }
  return null;
}

function memoOf(record: RawPayment): string | null {
  return record.transaction?.memo ?? null;
}

function routingOf(record: RawPayment): {
  routingId: string | null;
  routingConflict: boolean;
} {
  const muxedValue = record.to_muxed_id;
  const memoValue = record.transaction?.memo_type?.toLowerCase() === "id"
    ? record.transaction.memo
    : undefined;
  const muxedId = muxedValue && isMerchantRoutingId(muxedValue) ? muxedValue : null;
  const memoId = memoValue && isMerchantRoutingId(memoValue) ? memoValue : null;
  const malformed = (muxedValue !== undefined && muxedId === null) ||
    (memoValue !== undefined && memoId === null);
  const disagrees = muxedId !== null && memoId !== null && muxedId !== memoId;
  if (malformed || disagrees) return { routingId: null, routingConflict: true };
  return { routingId: muxedId ?? memoId, routingConflict: false };
}

/**
 * Horizon's payments feed only reports the ledger on the transaction resource,
 * which `join=transactions` does not include. The paging token's high bits are
 * the ledger sequence, so it is derived rather than fetched separately.
 */
export function ledgerFromPagingToken(token: string): number | null {
  try {
    const value = BigInt(token);
    const ledger = Number(value >> BigInt(32));
    return Number.isFinite(ledger) && ledger > 0 ? ledger : null;
  } catch {
    return null;
  }
}

export interface FetchPaymentsInput {
  publicKey: string;
  network: NetworkKey;
  cursor?: string | null;
  limit?: number;
  signal?: AbortSignal;
}

/**
 * One poll. Returns only successful, inbound credits to `publicKey`, oldest
 * first, so a caller can apply them in the order the ledger closed them.
 */
export async function fetchIncomingPayments({
  publicKey,
  network,
  cursor,
  limit = 50,
  signal,
}: FetchPaymentsInput): Promise<WatchResult> {
  const url = new URL(`${NETWORKS[network].horizonUrl}/accounts/${publicKey}/payments`);
  url.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 200)));
  url.searchParams.set("join", "transactions");
  // Ascending from the cursor keeps paging forward; without one, start at the
  // tail so a freshly-enabled till does not import the account's whole history.
  url.searchParams.set("order", cursor ? "asc" : "desc");
  if (cursor) url.searchParams.set("cursor", cursor);

  const page = await getHorizonJson<PaymentsPage>(url.toString(), { signal });
  const records = page?._embedded?.records;
  if (!Array.isArray(records)) throw new Error("Invalid Horizon payments response.");
  const ordered = cursor ? records : [...records].reverse();

  const payments: ObservedPayment[] = [];
  let latestLedger: number | null = null;
  let lastToken: string | null = null;

  for (const record of ordered) {
    assertSuccessfulPaymentRecord(record);
    lastToken = record.paging_token ?? lastToken;
    const ledger = ledgerFromPagingToken(record.paging_token ?? "");
    if (ledger && (latestLedger === null || ledger > latestLedger)) latestLedger = ledger;

    // create_account funds an account but is not a payment against a charge.
    if (record.type !== "payment" && record.type !== "path_payment_strict_send" &&
        record.type !== "path_payment_strict_receive") continue;
    if (
      typeof record.to !== "string" ||
      !isValidPublicAddress(record.to) ||
      typeof record.from !== "string" ||
      !isValidPaymentAddress(record.from)
    ) {
      throw new Error("Invalid Horizon payment endpoint.");
    }
    if (record.to !== publicKey) continue;
    if (record.from === publicKey) continue;

    const asset = assetOf(record);
    if (!asset || !record.amount) throw new Error("Invalid Horizon payment asset.");
    try {
      if (amountToStroops(record.amount) <= BigInt(0)) throw new Error("zero amount");
    } catch {
      throw new Error("Invalid Horizon payment amount.");
    }
    const routing = routingOf(record);

    payments.push({
      id: record.id,
      transactionHash: record.transaction_hash,
      ledger: ledger ?? 0,
      from: record.from_muxed ?? record.from ?? "",
      destination: record.to,
      amount: record.amount,
      asset,
      ...routing,
      memo: memoOf(record),
      createdAt: record.created_at,
    });
  }

  return { payments, cursor: lastToken, latestLedger };
}
