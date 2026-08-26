import { emptyStore } from "./defaults";
import type {
  AcceptedAsset,
  MerchantSettings,
  MerchantStore,
  TipSettings,
} from "./types";

/**
 * Merchant data uses the wallet prefix so the wallet reset path owns it too.
 * Version 2 keeps the original key readable only long enough to migrate it.
 */
const KEY = "wallet.merchant.v2";
const LEGACY_KEY = "wallet.merchant.v1";

/** Records older than this may be pruned only after they are fully resolved. */
const RETAIN_DAYS = 400;

type UnknownRecord = Record<string, unknown>;

interface MerchantStoreV1 {
  version: 1;
  settings: MerchantSettings;
  catalogue: MerchantStore["catalogue"];
  modifierGroups?: MerchantStore["modifierGroups"];
  orders: MerchantStore["orders"];
  charges: MerchantStore["charges"];
  refunds?: MerchantStore["refunds"];
  unmatched?: MerchantStore["unmatched"];
  nextOrderNumber?: number;
  cursors?: MerchantStore["cursors"];
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positiveInteger(value: unknown, fallback: number): number {
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : fallback;
}

function nullableString(value: unknown, fallback: string | null): string | null {
  return value === null || typeof value === "string" ? value : fallback;
}

function recordArray<T>(
  value: unknown,
  valid: (record: UnknownRecord) => boolean,
): T[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((entry): entry is T => isRecord(entry) && valid(entry));
}

function idRecords<T>(value: unknown): T[] | null {
  return recordArray<T>(value, (entry) => typeof entry.id === "string");
}

function refundRecords(value: unknown): MerchantStore["refunds"] {
  const refunds = idRecords<MerchantStore["refunds"][number]>(value) ?? [];
  return refunds.map((refund) => ({
    ...refund,
    // Refunds written before outbound lifecycle tracking were presented as
    // completed, so preserve that historical meaning during the v1/v2 read.
    submissionStatus:
      refund.submissionStatus === "accepted" ||
      refund.submissionStatus === "confirmed" ||
      refund.submissionStatus === "status_unknown" ||
      refund.submissionStatus === "failed"
        ? refund.submissionStatus
        : "confirmed",
  }));
}

function acceptedAsset(value: unknown): value is AcceptedAsset {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    (value.issuer === null || typeof value.issuer === "string")
  );
}

function reconcileTips(value: unknown, base: TipSettings): TipSettings {
  if (!isRecord(value)) return base;
  const mode = value.mode === "off" || value.mode === "percent" || value.mode === "fixed"
    ? value.mode
    : base.mode;
  return {
    mode,
    percents: Array.isArray(value.percents) && value.percents.every(isFiniteNumber)
      ? value.percents
      : base.percents,
    fixedMinor: Array.isArray(value.fixedMinor) && value.fixedMinor.every(isFiniteNumber)
      ? value.fixedMinor
      : base.fixedMinor,
    thresholdMinor: isFiniteNumber(value.thresholdMinor)
      ? value.thresholdMinor
      : base.thresholdMinor,
    onNet: typeof value.onNet === "boolean" ? value.onNet : base.onNet,
  };
}

function reconcileSettings(value: unknown, base: MerchantSettings): MerchantSettings {
  if (!isRecord(value)) return base;
  const profile = isRecord(value.profile) ? value.profile : {};
  const taxRates = recordArray<MerchantSettings["taxRates"][number]>(
    value.taxRates,
    (rate) =>
      typeof rate.id === "string" &&
      typeof rate.label === "string" &&
      isFiniteNumber(rate.percent),
  );
  const acceptedAssets = Array.isArray(value.acceptedAssets)
    ? value.acceptedAssets.filter(acceptedAsset)
    : null;

  return {
    ...base,
    enabled: typeof value.enabled === "boolean" ? value.enabled : base.enabled,
    profile: {
      ...base.profile,
      name: typeof profile.name === "string" ? profile.name : base.profile.name,
      addressLines:
        Array.isArray(profile.addressLines) &&
        profile.addressLines.every((line) => typeof line === "string")
          ? profile.addressLines
          : base.profile.addressLines,
      taxId: typeof profile.taxId === "string" ? profile.taxId : base.profile.taxId,
      receiptFooter:
        typeof profile.receiptFooter === "string"
          ? profile.receiptFooter
          : base.profile.receiptFooter,
    },
    receivingPublicKey: nullableString(value.receivingPublicKey, base.receivingPublicKey),
    settlementAsset: acceptedAsset(value.settlementAsset)
      ? value.settlementAsset
      : base.settlementAsset,
    acceptedAssets:
      acceptedAssets && acceptedAssets.length > 0 ? acceptedAssets : base.acceptedAssets,
    currency:
      value.currency === "USD" || value.currency === "EUR" || value.currency === "GBP"
        ? value.currency
        : base.currency,
    taxMode:
      value.taxMode === "inclusive" || value.taxMode === "added"
        ? value.taxMode
        : base.taxMode,
    taxRates: taxRates && taxRates.length > 0 ? taxRates : base.taxRates,
    defaultTaxRateId:
      typeof value.defaultTaxRateId === "string"
        ? value.defaultTaxRateId
        : base.defaultTaxRateId,
    tips: reconcileTips(value.tips, base.tips),
    chargeExpirySeconds: isFiniteNumber(value.chargeExpirySeconds)
      ? value.chargeExpirySeconds
      : base.chargeExpirySeconds,
    toleranceBps: isFiniteNumber(value.toleranceBps)
      ? value.toleranceBps
      : base.toleranceBps,
    toleranceFloorMinor: isFiniteNumber(value.toleranceFloorMinor)
      ? value.toleranceFloorMinor
      : base.toleranceFloorMinor,
    holdAutoLockDuringCharge:
      typeof value.holdAutoLockDuringCharge === "boolean"
        ? value.holdAutoLockDuringCharge
        : base.holdAutoLockDuringCharge,
    terminalName:
      typeof value.terminalName === "string" && value.terminalName.trim()
        ? value.terminalName
        : base.terminalName,
  };
}

function isLegacyStore(value: unknown): value is MerchantStoreV1 {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.settings)) return false;
  return (
    Array.isArray(value.catalogue) &&
    Array.isArray(value.orders) &&
    Array.isArray(value.charges)
  );
}

function reconcileV2(value: UnknownRecord): MerchantStore {
  const base = emptyStore();
  const settings = reconcileSettings(value.settings, base.settings);
  const terminalValue = isRecord(value.terminal) ? value.terminal : {};
  const settlementValue = isRecord(value.settlementRule) ? value.settlementRule : {};
  const staff = idRecords<MerchantStore["staff"][number]>(value.staff) ?? [];
  const requestedActiveStaffId = nullableString(value.activeStaffId, null);
  const tillTextSize =
    value.tillTextSize === "standard" ||
    value.tillTextSize === "large" ||
    value.tillTextSize === "xlarge"
      ? value.tillTextSize
      : base.tillTextSize;

  return {
    version: 2,
    settings,
    catalogue: idRecords<MerchantStore["catalogue"][number]>(value.catalogue) ?? base.catalogue,
    modifierGroups:
      idRecords<MerchantStore["modifierGroups"][number]>(value.modifierGroups) ??
      base.modifierGroups,
    orders: idRecords<MerchantStore["orders"][number]>(value.orders) ?? [],
    charges: idRecords<MerchantStore["charges"][number]>(value.charges) ?? [],
    refunds: refundRecords(value.refunds),
    unmatched: idRecords<MerchantStore["unmatched"][number]>(value.unmatched) ?? [],
    staff,
    activeStaffId:
      requestedActiveStaffId && staff.some((member) => member.id === requestedActiveStaffId)
        ? requestedActiveStaffId
        : null,
    shifts: idRecords<MerchantStore["shifts"][number]>(value.shifts) ?? [],
    invoices: idRecords<MerchantStore["invoices"][number]>(value.invoices) ?? [],
    counterCodes: idRecords<MerchantStore["counterCodes"][number]>(value.counterCodes) ?? [],
    counterPayments:
      idRecords<MerchantStore["counterPayments"][number]>(value.counterPayments) ?? [],
    customers:
      recordArray<MerchantStore["customers"][number]>(
        value.customers,
        (customer) => typeof customer.address === "string",
      ) ?? [],
    settlementRule: {
      autoConvert:
        typeof settlementValue.autoConvert === "boolean"
          ? settlementValue.autoConvert
          : base.settlementRule.autoConvert,
      maxSlippageBps: isFiniteNumber(settlementValue.maxSlippageBps)
        ? settlementValue.maxSlippageBps
        : base.settlementRule.maxSlippageBps,
      sweepAboveMinor:
        settlementValue.sweepAboveMinor === null || isFiniteNumber(settlementValue.sweepAboveMinor)
          ? settlementValue.sweepAboveMinor
          : base.settlementRule.sweepAboveMinor,
      sweepDestination: nullableString(
        settlementValue.sweepDestination,
        base.settlementRule.sweepDestination,
      ),
      retainedFloatMinor: isFiniteNumber(settlementValue.retainedFloatMinor)
        ? settlementValue.retainedFloatMinor
        : base.settlementRule.retainedFloatMinor,
      sweepPromptHour:
        settlementValue.sweepPromptHour === null || isFiniteNumber(settlementValue.sweepPromptHour)
          ? settlementValue.sweepPromptHour
          : base.settlementRule.sweepPromptHour,
    },
    adjustments: idRecords<MerchantStore["adjustments"][number]>(value.adjustments) ?? [],
    refundRequests:
      idRecords<MerchantStore["refundRequests"][number]>(value.refundRequests) ?? [],
    peripherals: idRecords<MerchantStore["peripherals"][number]>(value.peripherals) ?? [],
    exportRecords: idRecords<MerchantStore["exportRecords"][number]>(value.exportRecords) ?? [],
    terminal: {
      name:
        typeof terminalValue.name === "string" && terminalValue.name.trim()
          ? terminalValue.name
          : settings.terminalName,
      appVersion:
        typeof terminalValue.appVersion === "string"
          ? terminalValue.appVersion
          : base.terminal.appVersion,
      queuedCharges: isFiniteNumber(terminalValue.queuedCharges)
        ? Math.max(0, Math.trunc(terminalValue.queuedCharges))
        : base.terminal.queuedCharges,
    },
    tillTextSize,
    nextOrderNumber: positiveInteger(value.nextOrderNumber, base.nextOrderNumber),
    nextShiftNumber: positiveInteger(value.nextShiftNumber, base.nextShiftNumber),
    nextInvoiceNumber: positiveInteger(value.nextInvoiceNumber, base.nextInvoiceNumber),
    cursors: isRecord(value.cursors)
      ? (value.cursors as MerchantStore["cursors"])
      : base.cursors,
  };
}

function migrateV1(store: MerchantStoreV1): MerchantStore {
  const base = emptyStore();
  return reconcileV2({
    ...store,
    version: 2,
    settings: store.settings,
    terminal: {
      ...base.terminal,
      name: store.settings.terminalName || base.settings.terminalName,
    },
  });
}

/** Decode supported data without mutating storage. Future versions are rejected. */
export function decodeMerchantStore(value: unknown): MerchantStore | null {
  if (!isRecord(value)) return null;
  if (value.version === 2) return reconcileV2(value);
  if (isLegacyStore(value)) return migrateV1(value);
  return null;
}

export function loadMerchantStore(): MerchantStore {
  if (typeof window === "undefined") return emptyStore();

  const currentRaw = window.localStorage.getItem(KEY);
  if (currentRaw !== null) {
    try {
      return decodeMerchantStore(JSON.parse(currentRaw)) ?? emptyStore();
    } catch {
      // Preserve the unreadable payload for recovery; do not overwrite it here.
      return emptyStore();
    }
  }

  const legacyRaw = window.localStorage.getItem(LEGACY_KEY);
  if (legacyRaw === null) return emptyStore();
  try {
    const parsed: unknown = JSON.parse(legacyRaw);
    if (!isLegacyStore(parsed)) return emptyStore();
    const migrated = migrateV1(parsed);
    saveMerchantStore(migrated);
    return migrated;
  } catch {
    return emptyStore();
  }
}

/** Returns false when quota or storage policy prevents a durable commit. */
export function saveMerchantStore(store: MerchantStore): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prune(store)));
    window.localStorage.removeItem(LEGACY_KEY);
    return true;
  } catch {
    // Quota exhausted: retain unresolved records and retry with shorter history.
    try {
      window.localStorage.setItem(KEY, JSON.stringify(prune(store, 30)));
      window.localStorage.removeItem(LEGACY_KEY);
      return true;
    } catch {
      return false;
    }
  }
}

/** Drops resolved history beyond the retention window and retains live work. */
export function prune(store: MerchantStore, retainDays = RETAIN_DAYS): MerchantStore {
  const cutoff = Date.now() - retainDays * 24 * 60 * 60 * 1000;
  const orders = store.orders.filter(
    (order) =>
      order.createdAt >= cutoff || order.status === "open" || order.status === "awaiting",
  );
  const keptOrderIds = new Set(orders.map((order) => order.id));
  const openInvoiceStatuses = new Set(["draft", "sent", "partially_paid", "overdue"]);

  return {
    ...store,
    orders,
    charges: store.charges.filter(
      (charge) => keptOrderIds.has(charge.orderId) || charge.status === "awaiting",
    ),
    refunds: store.refunds.filter((refund) => keptOrderIds.has(refund.orderId)),
    unmatched: store.unmatched.filter((payment) => payment.seenAt >= cutoff),
    shifts: store.shifts.filter(
      (shift) => shift.closedAt === null || shift.closedAt >= cutoff,
    ),
    invoices: store.invoices.filter(
      (invoice) =>
        openInvoiceStatuses.has(invoice.status) ||
        (invoice.paidAt ?? invoice.issuedAt ?? cutoff) >= cutoff,
    ),
    counterPayments: store.counterPayments.filter((payment) => payment.seenAt >= cutoff),
    adjustments: store.adjustments.filter((adjustment) => adjustment.at >= cutoff),
    refundRequests: store.refundRequests.filter(
      (request) => request.status === "pending" || request.requestedAt >= cutoff,
    ),
    exportRecords: store.exportRecords.filter((record) => record.runAt >= cutoff),
  };
}

export function clearMerchantStore(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
  window.localStorage.removeItem(LEGACY_KEY);
}

export const MERCHANT_STORAGE_KEY = KEY;
export const MERCHANT_LEGACY_STORAGE_KEY = LEGACY_KEY;
