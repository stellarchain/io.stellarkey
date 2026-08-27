import { getHorizonUrl } from "../stellar-endpoints";
import type { NetworkKey } from "../stellar";
import { getHorizonJson } from "../horizon";
import type { ObservedPayment } from "./match";
import type { AcceptedAsset } from "./types";
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
  from?: string;
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  amount?: string;
  /** Present for path payments — what the recipient actually received. */
  to_muxed?: string;
  transaction?: RawTransaction;
}

interface PaymentsPage {
  _embedded?: { records?: RawPayment[] };
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

/**
 * Only a text memo can carry a charge reference. An id or hash memo is real but
 * cannot be compared to `MC1042`, so it is treated as absent and the payment
 * falls through to the amount lane.
 */
function memoOf(record: RawPayment): string | null {
  const tx = record.transaction;
  if (!tx?.memo) return null;
  if (tx.memo_type && tx.memo_type !== "text") return null;
  return tx.memo;
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
  const url = new URL(`${getHorizonUrl(network)}/accounts/${publicKey}/payments`);
  url.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 200)));
  url.searchParams.set("join", "transactions");
  // Ascending from the cursor keeps paging forward; without one, start at the
  // tail so a freshly-enabled till does not import the account's whole history.
  url.searchParams.set("order", cursor ? "asc" : "desc");
  if (cursor) url.searchParams.set("cursor", cursor);

  const page = await getHorizonJson<PaymentsPage>(url.toString(), { signal });
  const records = page?._embedded?.records ?? [];
  const ordered = cursor ? records : [...records].reverse();

  const payments: ObservedPayment[] = [];
  let latestLedger: number | null = null;
  let lastToken: string | null = null;

  for (const record of ordered) {
    lastToken = record.paging_token ?? lastToken;
    const ledger = ledgerFromPagingToken(record.paging_token ?? "");
    if (ledger && (latestLedger === null || ledger > latestLedger)) latestLedger = ledger;

    if (record.transaction_successful === false) continue;
    if (record.transaction?.successful === false) continue;
    // create_account funds an account but is not a payment against a charge.
    if (record.type !== "payment" && record.type !== "path_payment_strict_send" &&
        record.type !== "path_payment_strict_receive") continue;
    if (record.to !== publicKey) continue;
    if (record.from === publicKey) continue;

    const asset = assetOf(record);
    if (!asset || !record.amount) continue;

    payments.push({
      id: record.id,
      transactionHash: record.transaction_hash,
      ledger: ledger ?? 0,
      from: record.from ?? "",
      destination: record.to,
      amount: record.amount,
      asset,
      memo: memoOf(record),
      createdAt: record.created_at,
    });
  }

  return { payments, cursor: lastToken, latestLedger };
}
