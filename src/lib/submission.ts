import { TransactionBuilder } from "@stellar/stellar-sdk";
import { NETWORKS, type NetworkKey } from "./stellar";

export type SubmissionStatus = "accepted" | "confirmed" | "status_unknown";

/**
 * The canonical transaction hash is always computed locally. `accepted` means
 * Horizon acknowledged the POST, `confirmed` means a hash lookup found the
 * transaction, and `status_unknown` means callers must track instead of retry.
 */
export interface SubmissionResult {
  hash: string;
  network: NetworkKey;
  status: SubmissionStatus;
}

export interface PreparedSubmissionIdentity {
  hash: string;
  network: NetworkKey;
  /** Exact envelope maxTime, in Unix seconds, when one exists. */
  expiresAt?: number;
}

export type SubmissionPreparedCallback = (
  prepared: PreparedSubmissionIdentity,
) => void | Promise<void>;

export async function runPreparedBroadcast<T>(options: {
  broadcast: (onPrepared: SubmissionPreparedCallback) => Promise<T>;
  prepare: SubmissionPreparedCallback;
  discard: SubmissionPreparedCallback;
  finalize: (result: T) => void;
}): Promise<T> {
  let prepared: PreparedSubmissionIdentity | null = null;
  let result: T;
  try {
    result = await options.broadcast(async (identity) => {
      prepared = identity;
      await options.prepare(identity);
    });
  } catch (error) {
    if (prepared) await options.discard(prepared);
    throw error;
  }

  // Horizon has returned. From here onward a local presentation/state error
  // must never erase the durable recovery handle for a possibly accepted tx.
  try {
    options.finalize(result);
  } catch {
    // The provisional record was persisted before broadcast. Keep returning
    // Horizon's accepted result even if a best-effort local status upgrade
    // fails (for example because storage became unavailable or full).
  }
  return result;
}

export type PendingTransactionStatus = "confirming" | "status_unknown";

export interface ReconcileAccountMergeAfterConfirmation {
  /**
   * An untrusted persistence hint only. The account to archive must always be
   * re-derived from the confirmed on-chain envelope; it is never persisted.
   */
  kind: "reconcile_account_merge";
}

export type PendingTransactionAction = ReconcileAccountMergeAfterConfirmation;

export interface PendingTransaction {
  hash: string;
  network: NetworkKey;
  label: string;
  status: PendingTransactionStatus;
  createdAt: number;
  expiresAt?: number;
  action?: PendingTransactionAction;
}

export type TransactionResolutionStatus = "confirmed" | "failed";

export interface TransactionResolution {
  hash: string;
  network: NetworkKey;
  status: TransactionResolutionStatus;
  resolvedAt: number;
  action?: PendingTransactionAction;
}

export type TransactionResolutionMap = Record<string, TransactionResolution>;

export interface TransactionTrackingState {
  pending: PendingTransaction[];
  resolutions: TransactionResolutionMap;
}

export interface TransactionPollTransition {
  tracking: TransactionTrackingState;
  resolution: TransactionResolution | null;
}

export function pendingTransactionFromSubmission(
  submission: SubmissionResult,
  label: string,
  action?: PendingTransactionAction,
): PendingTransaction | null {
  if (submission.status === "confirmed") return null;
  return {
    hash: submission.hash,
    network: submission.network,
    label,
    status: submission.status === "status_unknown" ? "status_unknown" : "confirming",
    createdAt: Date.now(),
    ...(action ? { action } : {}),
  };
}

export function pendingTransactionFromPrepared(
  prepared: PreparedSubmissionIdentity,
  label: string,
  action?: PendingTransactionAction,
  createdAt = Date.now(),
): PendingTransaction {
  return {
    hash: prepared.hash.toLowerCase(),
    network: prepared.network,
    label,
    status: "status_unknown",
    createdAt,
    ...(prepared.expiresAt !== undefined ? { expiresAt: prepared.expiresAt } : {}),
    ...(action ? { action } : {}),
  };
}

export function transactionIdentity(
  transaction: Pick<PendingTransaction, "hash" | "network">,
): string {
  return `${transaction.network}:${transaction.hash}`;
}

export function isTrackingTaskCurrent(
  startedGeneration: number,
  currentGeneration: number,
  transaction: Pick<PendingTransaction, "hash" | "network">,
  currentQueue: Array<Pick<PendingTransaction, "hash" | "network">>,
): boolean {
  if (startedGeneration !== currentGeneration) return false;
  const identity = transactionIdentity(transaction);
  return currentQueue.some((entry) => transactionIdentity(entry) === identity);
}

export function upsertPendingTransaction(
  current: PendingTransaction[],
  incoming: PendingTransaction,
): PendingTransaction[] {
  const identity = transactionIdentity(incoming);
  const existingIndex = current.findIndex((entry) => transactionIdentity(entry) === identity);
  if (existingIndex < 0) return [...current, incoming];

  const existing = current[existingIndex];
  const status: PendingTransactionStatus = existing.status === "confirming" || incoming.status === "confirming"
    ? "confirming"
    : "status_unknown";
  const next = { ...existing, ...incoming, status, createdAt: existing.createdAt };
  return current.map((entry, index) => index === existingIndex ? next : entry);
}

export function trackPendingTransaction(
  tracking: TransactionTrackingState,
  incoming: PendingTransaction,
): TransactionTrackingState {
  const identity = transactionIdentity(incoming);
  const resolutions = { ...tracking.resolutions };
  delete resolutions[identity];
  return {
    pending: upsertPendingTransaction(tracking.pending, incoming),
    resolutions,
  };
}

export function removeTrackedTransaction(
  tracking: TransactionTrackingState,
  transaction: Pick<PendingTransaction, "hash" | "network">,
): TransactionTrackingState {
  const identity = transactionIdentity(transaction);
  const resolutions = { ...tracking.resolutions };
  delete resolutions[identity];
  return {
    pending: tracking.pending.filter((entry) => transactionIdentity(entry) !== identity),
    resolutions,
  };
}

export type CanonicalLookupStatus = "confirmed" | "failed" | "not_found" | "unavailable";

export function resolutionForExpiredLookup(
  lookup: CanonicalLookupStatus,
): boolean | null {
  if (lookup === "confirmed") return true;
  if (lookup === "failed" || lookup === "not_found") return false;
  return null;
}

export function applyTransactionPoll(
  tracking: TransactionTrackingState,
  transaction: PendingTransaction,
  outcome: boolean | null,
  resolvedAt = Date.now(),
): TransactionPollTransition {
  if (outcome === null) return { tracking, resolution: null };

  const identity = transactionIdentity(transaction);
  const resolution: TransactionResolution = {
    hash: transaction.hash,
    network: transaction.network,
    status: outcome ? "confirmed" : "failed",
    resolvedAt,
    ...(transaction.action ? { action: transaction.action } : {}),
  };
  return {
    tracking: {
      pending: tracking.pending.filter((entry) => transactionIdentity(entry) !== identity),
      resolutions: { ...tracking.resolutions, [identity]: resolution },
    },
    resolution,
  };
}

export type SubmissionLifecycleStatus = SubmissionStatus | "failed";

export function submissionLifecycleStatus(
  submission: SubmissionResult,
  resolutions: TransactionResolutionMap,
): SubmissionLifecycleStatus {
  return resolutions[transactionIdentity(submission)]?.status ?? submission.status;
}

export interface PendingTransactionPresentation {
  title: string;
  detail: string;
  caution: boolean;
  manualCheck: boolean;
}

export function pendingTransactionPresentation(
  transaction: Pick<PendingTransaction, "hash" | "network" | "label" | "status" | "expiresAt">,
  nowMs = Date.now(),
): PendingTransactionPresentation {
  const networkLabel = transaction.network === "mainnet" ? "Mainnet" : "Testnet";
  const manualCheck = transaction.expiresAt !== undefined &&
    transaction.expiresAt * 1000 <= nowMs;
  if (transaction.status === "status_unknown") {
    return {
      title: `${transaction.label} status unknown`,
      detail: manualCheck
        ? `The envelope expired before Horizon status could be verified on ${networkLabel}. Do not resubmit blindly. Use Check Status for a bounded canonical-hash lookup.`
        : `Horizon did not confirm whether this transaction was accepted on ${networkLabel}. Do not resubmit blindly. Tracking canonical hash ${transaction.hash}.`,
      caution: true,
      manualCheck,
    };
  }
  return {
    title: `${transaction.label} confirming`,
    detail: manualCheck
      ? `Accepted by Horizon on ${networkLabel}, but final status is not indexed. Use Check Status for a bounded canonical-hash lookup.`
      : `Accepted by Horizon on ${networkLabel}. Tracking canonical hash ${transaction.hash}.`,
    caution: false,
    manualCheck,
  };
}

export function parsePendingTransactions(serialized: string | null): PendingTransaction[] {
  if (!serialized) return [];
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];

  return value.reduce<PendingTransaction[]>((pending, candidate) => {
    if (!candidate || typeof candidate !== "object") return pending;
    const entry = candidate as Record<string, unknown>;
    if (
      typeof entry.hash !== "string" ||
      !/^[0-9a-f]{64}$/i.test(entry.hash) ||
      (entry.network !== "mainnet" && entry.network !== "testnet") ||
      typeof entry.label !== "string" ||
      entry.label.trim().length === 0 ||
      (entry.status !== "confirming" && entry.status !== "status_unknown") ||
      typeof entry.createdAt !== "number" ||
      !Number.isFinite(entry.createdAt) ||
      entry.createdAt < 0
    ) {
      return pending;
    }
    return upsertPendingTransaction(pending, {
      hash: entry.hash.toLowerCase(),
      network: entry.network,
      label: entry.label,
      status: entry.status,
      createdAt: entry.createdAt,
      ...(typeof entry.expiresAt === "number" &&
        Number.isSafeInteger(entry.expiresAt) &&
        entry.expiresAt >= 0
        ? { expiresAt: entry.expiresAt }
        : {}),
      ...(isPendingTransactionAction(entry.action)
        ? { action: { kind: "reconcile_account_merge" } as const }
        : {}),
    });
  }, []);
}

type PendingTransactionStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem" | "length" | "key"
>;

export function pendingTransactionStoragePrefix(key: string): string {
  return `${key}.record.`;
}

function pendingTransactionStorageKey(
  key: string,
  record: Pick<PendingTransaction, "hash" | "network">,
): string {
  return `${pendingTransactionStoragePrefix(key)}${record.network}.${record.hash.toLowerCase()}`;
}

function pendingTransactionStorageKeys(
  storage: Pick<Storage, "length" | "key">,
  key: string,
): string[] {
  const prefix = pendingTransactionStoragePrefix(key);
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const candidate = storage.key(index);
    if (candidate?.startsWith(prefix)) keys.push(candidate);
  }
  return keys;
}

/** Serialize only the authority-free recovery identity accepted by the parser. */
export function serializePendingTransactions(records: PendingTransaction[]): string {
  return JSON.stringify(parsePendingTransactions(JSON.stringify(records)));
}

export function persistPendingTransactionQueue(
  storage: PendingTransactionStorage,
  key: string,
  records: PendingTransaction[],
): PendingTransaction[] {
  const sanitized = parsePendingTransactions(JSON.stringify(records));
  const desiredKeys = new Set(
    sanitized.map((record) => pendingTransactionStorageKey(key, record)),
  );
  for (const record of sanitized) persistDurablePendingTransaction(storage, key, record);
  for (const storedKey of pendingTransactionStorageKeys(storage, key)) {
    if (!desiredKeys.has(storedKey)) storage.removeItem(storedKey);
  }
  storage.removeItem(key);
  return sanitized;
}

/** Persist one recovery identity without replacing records written by another tab. */
export function persistDurablePendingTransaction(
  storage: Pick<Storage, "setItem">,
  key: string,
  record: PendingTransaction,
): PendingTransaction {
  const [sanitized] = parsePendingTransactions(JSON.stringify([record]));
  if (!sanitized) throw new Error("Pending transaction recovery record is invalid.");
  storage.setItem(
    pendingTransactionStorageKey(key, sanitized),
    serializePendingTransactions([sanitized]),
  );
  return sanitized;
}

/** Remove only the resolved envelope, preserving recovery records from other tabs. */
export function removeDurablePendingTransaction(
  storage: Pick<Storage, "removeItem">,
  key: string,
  record: Pick<PendingTransaction, "hash" | "network">,
): void {
  storage.removeItem(pendingTransactionStorageKey(key, record));
}

/** Restore the current per-transaction durable recovery queue. */
export function loadDurablePendingTransactions(
  durableStorage: PendingTransactionStorage,
  durableKey: string,
): PendingTransaction[] {
  return pendingTransactionStorageKeys(durableStorage, durableKey).reduce(
    (records, recordKey) =>
      parsePendingTransactions(durableStorage.getItem(recordKey)).reduce(
        upsertPendingTransaction,
        records,
      ),
    [] as PendingTransaction[],
  );
}

export function clearDurablePendingTransactions(
  durableStorage: Pick<Storage, "removeItem" | "length" | "key">,
  durableKey: string,
): void {
  durableStorage.removeItem(durableKey);
  for (const recordKey of pendingTransactionStorageKeys(durableStorage, durableKey)) {
    durableStorage.removeItem(recordKey);
  }
}

function isPendingTransactionAction(value: unknown): value is PendingTransactionAction {
  if (!value || typeof value !== "object") return false;
  const action = value as Record<string, unknown>;
  return action.kind === "reconcile_account_merge";
}

export interface SubmissionNotice {
  tone: "info" | "warn" | "success";
  message: string;
}

export function assetDetailSubmissionView(
  error: string | null,
  submission: SubmissionResult | null,
  status: SubmissionLifecycleStatus | null,
): { error: string | null; notice: SubmissionNotice | null } {
  if (!submission || !status || status === "failed") return { error, notice: null };
  if (status === "status_unknown") {
    return {
      error,
      notice: {
        tone: "warn",
        message: "Trustline removal status unknown. Do not resubmit blindly.",
      },
    };
  }
  return {
    error,
    notice: {
      tone: status === "confirmed" ? "success" : "info",
      message: status === "confirmed"
        ? "Trustline removal confirmed."
        : "Trustline removal accepted and confirming.",
    },
  };
}

export function configSubmissionAfterResolution(
  submission: SubmissionResult | null,
  status: SubmissionLifecycleStatus | null,
): SubmissionResult | null {
  return status === "confirmed" || status === "failed" ? null : submission;
}

export function trackedEnvelopeSubmissionStatus(
  xdr: string,
  network: NetworkKey,
  tracking: TransactionTrackingState,
): SubmissionLifecycleStatus | null {
  let hash: string;
  try {
    const transaction = TransactionBuilder.fromXdr(
      xdr.trim(),
      NETWORKS[network].networkPassphrase,
    );
    hash = Array.from(transaction.hash(), (byte) =>
      byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }

  const identity = transactionIdentity({ hash, network });
  const resolution = tracking.resolutions[identity];
  if (resolution) return resolution.status;
  const pending = tracking.pending.find((entry) => transactionIdentity(entry) === identity);
  if (!pending) return null;
  return pending.status === "confirming" ? "accepted" : "status_unknown";
}

export function approvalSubmissionGuard(
  status: SubmissionLifecycleStatus | null,
): string | null {
  if (!status || status === "failed") return null;
  if (status === "status_unknown") {
    return "This exact envelope has an unknown submission status and is still being tracked. Do not resubmit it.";
  }
  if (status === "accepted") {
    return "This exact envelope was already accepted and is still being tracked for confirmation.";
  }
  if (status === "confirmed") {
    return "This exact envelope is already confirmed and cannot be submitted again.";
  }
  return null;
}

export type MergeReconciliationStatus =
  | "pending"
  | "retry"
  | "status_unknown"
  | "last_account"
  | "source_active";

export function mergeReconciliationPresentation(
  status: MergeReconciliationStatus,
): { message: string; verified: boolean; manualCheck: boolean } {
  if (status === "last_account") {
    return {
      message: "The account merge is confirmed and its source is closed on-chain, but this is your final local account. It has not been archived. Add another account and the wallet will safely retry local reconciliation.",
      verified: true,
      manualCheck: false,
    };
  }
  if (status === "source_active") {
    return {
      message: "A successful merge was verified, but that source address is active on-chain again. Automatic local removal was stopped; review the account before taking manual action.",
      verified: true,
      manualCheck: false,
    };
  }
  if (status === "retry") {
    return {
      message: "The wallet could not yet finish verifying and reconciling this account merge. It will retry automatically and has kept the recovery record.",
      verified: false,
      manualCheck: false,
    };
  }
  if (status === "status_unknown") {
    return {
      message: "The merge envelope expired, but Horizon status is unavailable. Do not retry the merge blindly. Automatic checks have stopped; use Check Status for a bounded canonical-hash lookup.",
      verified: false,
      manualCheck: true,
    };
  }
  return {
    message: "The account merge submission is being tracked. The wallet is checking the selected network before changing local account state.",
    verified: false,
    manualCheck: false,
  };
}

export interface MergeReconciliation {
  hash: string;
  network: NetworkKey;
  status: MergeReconciliationStatus;
  /** Exact envelope maxTime in Unix seconds, when known. */
  expiresAt?: number;
  /** Derived from the confirmed envelope in memory; never trusted from storage. */
  sourcePublicKey?: string;
}

export interface ConfirmedMergeInspection {
  sourcePublicKey: string;
  sourceAccountExists: boolean;
}

export type MergeReconciliationOutcome =
  | "removed"
  | "discarded"
  | "retry"
  | "status_unknown"
  | "last_account"
  | "source_active";

export interface MergeReconciliationResult {
  outcome: MergeReconciliationOutcome;
  record: MergeReconciliation | null;
  accountId?: string;
}

export function createMergeReconciliation(
  transaction: Pick<PreparedSubmissionIdentity, "hash" | "network" | "expiresAt">,
): MergeReconciliation {
  const expiresAt = transaction.expiresAt;
  return {
    hash: transaction.hash.toLowerCase(),
    network: transaction.network,
    status: "pending",
    ...(typeof expiresAt === "number" && Number.isSafeInteger(expiresAt) && expiresAt >= 0
      ? { expiresAt }
      : {}),
  };
}

export function upsertMergeReconciliation(
  current: MergeReconciliation[],
  incoming: MergeReconciliation,
): MergeReconciliation[] {
  const identity = transactionIdentity(incoming);
  const index = current.findIndex((entry) => transactionIdentity(entry) === identity);
  if (index < 0) return [...current, incoming];
  return current.map((entry, entryIndex) => entryIndex === index
    ? {
        ...incoming,
        ...(incoming.expiresAt === undefined && entry.expiresAt !== undefined
          ? { expiresAt: entry.expiresAt }
          : {}),
      }
    : entry);
}

export async function reconcileConfirmedMerge(
  record: MergeReconciliation,
  accounts: Array<{ id: string; publicKey: string }>,
  inspect: (
    network: NetworkKey,
    hash: string,
  ) => Promise<ConfirmedMergeInspection | null>,
  removeAccount: (accountId: string) => void | Promise<void>,
): Promise<MergeReconciliationResult> {
  let inspection: ConfirmedMergeInspection | null;
  try {
    inspection = await inspect(record.network, record.hash);
  } catch {
    return { outcome: "retry", record: { ...record, status: "retry" } };
  }
  if (!inspection) return { outcome: "discarded", record: null };

  const account = accounts.find((candidate) =>
    candidate.publicKey === inspection?.sourcePublicKey);
  if (!account) return { outcome: "discarded", record: null };

  const verifiedRecord: MergeReconciliation = {
    ...record,
    sourcePublicKey: inspection.sourcePublicKey,
  };
  if (inspection.sourceAccountExists) {
    return { outcome: "source_active", record: { ...verifiedRecord, status: "source_active" } };
  }
  if (accounts.length <= 1) {
    return { outcome: "last_account", record: { ...verifiedRecord, status: "last_account" } };
  }

  try {
    await removeAccount(account.id);
    return { outcome: "removed", record: null, accountId: account.id };
  } catch {
    return { outcome: "retry", record: { ...verifiedRecord, status: "retry" } };
  }
}

export async function reconcileMergeRecovery(
  record: MergeReconciliation,
  accounts: Array<{ id: string; publicKey: string }>,
  nowMs: number,
  lookup: (network: NetworkKey, hash: string) => Promise<CanonicalLookupStatus>,
  inspect: (
    network: NetworkKey,
    hash: string,
  ) => Promise<ConfirmedMergeInspection | null>,
  removeAccount: (accountId: string) => void | Promise<void>,
): Promise<MergeReconciliationResult> {
  const hasKnownExpiry = record.expiresAt !== undefined;
  const expired = hasKnownExpiry && record.expiresAt! * 1000 <= nowMs;

  // A durable-only legacy record has no expiry proof. Check once by canonical
  // hash, then require a manual retry if Horizon cannot establish finality.
  if (expired || !hasKnownExpiry) {
    let status: CanonicalLookupStatus;
    try {
      status = await lookup(record.network, record.hash);
    } catch {
      status = "unavailable";
    }
    if (status === "failed" || (expired && status === "not_found")) {
      return { outcome: "discarded", record: null };
    }
    if (status !== "confirmed") {
      return {
        outcome: "status_unknown",
        record: { ...record, status: "status_unknown" },
      };
    }
  }

  return reconcileConfirmedMerge(record, accounts, inspect, removeAccount);
}

export function serializeMergeReconciliations(records: MergeReconciliation[]): string {
  return JSON.stringify(records.map(({ hash, network, expiresAt }) => ({
    hash,
    network,
    ...(typeof expiresAt === "number" && Number.isSafeInteger(expiresAt) && expiresAt >= 0
      ? { expiresAt }
      : {}),
  })));
}

type MergeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function persistMergeReconciliationQueue(
  storage: MergeStorage,
  key: string,
  records: MergeReconciliation[],
): MergeReconciliation[] {
  if (records.length === 0) storage.removeItem(key);
  else storage.setItem(key, serializeMergeReconciliations(records));
  return records;
}

export function persistMergeReconciliation(
  storage: Pick<Storage, "getItem" | "setItem">,
  key: string,
  record: MergeReconciliation,
): MergeReconciliation[] {
  const next = upsertMergeReconciliation(
    parseMergeReconciliations(storage.getItem(key)),
    {
      hash: record.hash,
      network: record.network,
      status: "pending",
      ...(typeof record.expiresAt === "number" &&
        Number.isSafeInteger(record.expiresAt) &&
        record.expiresAt >= 0
        ? { expiresAt: record.expiresAt }
        : {}),
    },
  );
  storage.setItem(key, serializeMergeReconciliations(next));
  return next;
}

export function persistMergeRecoveryForSubmission(
  storage: Pick<Storage, "getItem" | "setItem">,
  key: string,
  submission: Pick<PreparedSubmissionIdentity, "hash" | "network" | "expiresAt">,
  action?: PendingTransactionAction,
): MergeReconciliation | null {
  if (action?.kind !== "reconcile_account_merge") return null;
  const record = createMergeReconciliation(submission);
  persistMergeReconciliation(storage, key, record);
  return record;
}

/** Restore authority-free merge recovery handles from current durable storage. */
export function loadDurableMergeReconciliations(
  durableStorage: MergeStorage,
  durableKey: string,
): MergeReconciliation[] {
  const records = parseMergeReconciliations(durableStorage.getItem(durableKey));
  if (records.length > 0) {
    durableStorage.setItem(durableKey, serializeMergeReconciliations(records));
  } else {
    durableStorage.removeItem(durableKey);
  }
  return records;
}

export function clearDurableMergeReconciliations(
  durableStorage: Pick<Storage, "removeItem">,
  durableKey: string,
): void {
  durableStorage.removeItem(durableKey);
}

export function parseMergeReconciliations(serialized: string | null): MergeReconciliation[] {
  if (!serialized) return [];
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];

  return value.reduce<MergeReconciliation[]>((records, candidate) => {
    if (!candidate || typeof candidate !== "object") return records;
    const record = candidate as Record<string, unknown>;
    if (
      typeof record.hash !== "string" ||
      !/^[0-9a-f]{64}$/i.test(record.hash) ||
      (record.network !== "mainnet" && record.network !== "testnet")
    ) {
      return records;
    }
    return upsertMergeReconciliation(records, {
      hash: record.hash.toLowerCase(),
      network: record.network,
      status: "pending",
      ...(typeof record.expiresAt === "number" &&
        Number.isSafeInteger(record.expiresAt) &&
        record.expiresAt >= 0
        ? { expiresAt: record.expiresAt }
        : {}),
    });
  }, []);
}
