import { emptyStore } from "./defaults";
import { StrKey } from "@stellar/stellar-sdk";
import type {
  AcceptedAsset,
  LoyaltyEvent,
  MerchantSettings,
  MerchantStore,
  TipSettings,
} from "./types";
import type { StorageLoadResult } from "../storage-load";
import {
  decryptMerchantStore,
  encryptMerchantStore,
  isEncryptedMerchantEnvelope,
} from "./crypto";

/**
 * Merchant data uses the wallet prefix so the wallet reset path owns it too.
 * Version 2 keeps the original key readable only long enough to migrate it.
 */
const KEY = "wallet.merchant.v2";
const LEGACY_KEY = "wallet.merchant.v1";

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

function shiftRecords(
  value: unknown,
  settings: MerchantSettings,
  staff: MerchantStore["staff"],
): MerchantStore["shifts"] {
  const shifts = idRecords<MerchantStore["shifts"][number]>(value) ?? [];
  return shifts.map((shift) => {
    const openedById =
      typeof shift.openedById === "string" && shift.openedById
        ? shift.openedById
        : staff.find(
            (member) => member.id === shift.openedBy || member.name === shift.openedBy,
          )?.id ?? `legacy:${shift.id}`;
    const closedById =
      shift.closedBy === null
        ? null
        : typeof shift.closedById === "string" && shift.closedById
          ? shift.closedById
          : staff.find(
              (member) => member.id === shift.closedBy || member.name === shift.closedBy,
            )?.id ?? `legacy:${shift.id}`;
    return {
      ...shift,
      openedById,
      closedById,
      terminalName:
        typeof shift.terminalName === "string" && shift.terminalName.trim()
          ? shift.terminalName
          : settings.terminalName,
      network: shift.network === "testnet" ? "testnet" : "mainnet",
      zReport: isRecord(shift.zReport)
        ? (shift.zReport as MerchantStore["shifts"][number]["zReport"])
        : null,
    };
  });
}

function invoiceRecords(
  value: unknown,
  staff: MerchantStore["staff"],
): MerchantStore["invoices"] {
  const invoices = idRecords<MerchantStore["invoices"][number]>(value) ?? [];
  return invoices.map((invoice) => {
    const issuedAt = invoice.issuedAt === null || isFiniteNumber(invoice.issuedAt)
      ? invoice.issuedAt
      : null;
    const paidAt = invoice.paidAt === null || isFiniteNumber(invoice.paidAt)
      ? invoice.paidAt
      : null;
    const createdAt = isFiniteNumber(invoice.createdAt)
      ? invoice.createdAt
      : issuedAt ?? paidAt ?? 1;
    const createdBy = typeof invoice.createdBy === "string" && invoice.createdBy.trim()
      ? invoice.createdBy
      : "Imported record";
    const createdById = typeof invoice.createdById === "string" && invoice.createdById
      ? invoice.createdById
      : staff.find((member) => member.name === createdBy)?.id ?? `legacy:${invoice.id}`;
    const issuedBy = issuedAt === null
      ? null
      : typeof invoice.issuedBy === "string" && invoice.issuedBy.trim()
        ? invoice.issuedBy
        : createdBy;
    const issuedById = issuedAt === null
      ? null
      : typeof invoice.issuedById === "string" && invoice.issuedById
        ? invoice.issuedById
        : staff.find((member) => member.name === issuedBy)?.id ?? createdById;
    const quotes = recordArray<MerchantStore["invoices"][number]["quotes"][number]>(
      invoice.quotes,
      (quote) =>
        acceptedAsset(quote.asset) &&
        isFiniteNumber(quote.unitPriceMinorE6) &&
        typeof quote.amount === "string" &&
        isFiniteNumber(quote.quotedAt),
    ) ?? [];
    const payments = recordArray<MerchantStore["invoices"][number]["payments"][number]>(
      invoice.payments,
      (payment) =>
        typeof payment.id === "string" &&
        (payment.kind === "stellar" || payment.kind === "manual") &&
        isFiniteNumber(payment.amountMinor),
    ) ?? [];
    return {
      ...invoice,
      network: invoice.network === "testnet" ? "testnet" : "mainnet",
      destination: nullableString(invoice.destination, null),
      quotes,
      payments,
      createdAt,
      updatedAt: isFiniteNumber(invoice.updatedAt)
        ? invoice.updatedAt
        : paidAt ?? issuedAt ?? createdAt,
      createdById,
      createdBy,
      issuedById,
      issuedBy,
      voidedAt:
        invoice.voidedAt === null || isFiniteNumber(invoice.voidedAt)
          ? invoice.voidedAt
          : null,
      voidedById: nullableString(invoice.voidedById, null),
      voidedBy: nullableString(invoice.voidedBy, null),
      voidReason: nullableString(invoice.voidReason, null),
    };
  });
}

function nextInvoiceSequence(
  value: unknown,
  invoices: MerchantStore["invoices"],
  fallback: number,
): number {
  const stored = positiveInteger(value, fallback);
  const afterHighest = invoices.reduce((next, invoice) => {
    const match = /^INV-\d{4}-(\d+)$/.exec(invoice.number);
    if (!match) return next;
    const sequence = Number(match[1]);
    return Number.isSafeInteger(sequence) ? Math.max(next, sequence + 1) : next;
  }, fallback);
  return Math.max(stored, afterHighest);
}

function quoteRecords(value: unknown): MerchantStore["counterCodes"][number]["quotes"] {
  return recordArray<MerchantStore["counterCodes"][number]["quotes"][number]>(
    value,
    (quote) =>
      acceptedAsset(quote.asset) &&
      isFiniteNumber(quote.unitPriceMinorE6) &&
      typeof quote.amount === "string" &&
      isFiniteNumber(quote.quotedAt),
  ) ?? [];
}

function counterCodeRecords(
  value: unknown,
  staff: MerchantStore["staff"],
): MerchantStore["counterCodes"] {
  const codes = idRecords<MerchantStore["counterCodes"][number]>(value) ?? [];
  return codes.map((code) => {
    const createdAt = isFiniteNumber(code.createdAt) ? code.createdAt : 1;
    const createdBy = typeof code.createdBy === "string" && code.createdBy.trim()
      ? code.createdBy
      : "Imported record";
    const createdById = typeof code.createdById === "string" && code.createdById
      ? code.createdById
      : staff.find((member) => member.name === createdBy)?.id ?? `legacy:${code.id}`;
    return {
      ...code,
      network: code.network === "testnet" ? "testnet" : "mainnet",
      // Never redirect a previously shared payment request during migration.
      // An absent snapshot stays absent and the UI treats it as audit-only.
      destination: typeof code.destination === "string" ? code.destination : "",
      requestMessage:
        typeof code.requestMessage === "string" && code.requestMessage.trim()
          ? code.requestMessage
          : code.title,
      quotes: quoteRecords(code.quotes),
      expiresAt:
        code.expiresAt === null || isFiniteNumber(code.expiresAt) ? code.expiresAt : null,
      createdAt,
      updatedAt: isFiniteNumber(code.updatedAt) ? code.updatedAt : createdAt,
      createdById,
      createdBy,
    };
  });
}

function counterPaymentRecords(value: unknown): MerchantStore["counterPayments"] {
  return recordArray<MerchantStore["counterPayments"][number]>(
    value,
    (entry) =>
      typeof entry.id === "string" &&
      typeof entry.codeId === "string" &&
      isRecord(entry.payment) &&
      acceptedAsset(entry.payment.asset),
  )?.map((entry) => ({
    ...entry,
    amountMinor:
      entry.amountMinor === null || isFiniteNumber(entry.amountMinor) ? entry.amountMinor : null,
    quote: isRecord(entry.quote) ? quoteRecords([entry.quote])[0] ?? null : null,
    seenAt: isFiniteNumber(entry.seenAt) ? entry.seenAt : 1,
  })) ?? [];
}

function customerRecords(
  value: unknown,
  settings: MerchantSettings,
): MerchantStore["customers"] {
  const customers = recordArray<MerchantStore["customers"][number]>(
    value,
    (customer) => typeof customer.address === "string",
  ) ?? [];
  return customers.map((customer) => {
    const sourceIds = Array.isArray(customer.sourceIds)
      ? [...new Set(customer.sourceIds.filter((entry): entry is string => typeof entry === "string" && Boolean(entry)))]
      : [];
    const rawLoyalty = isRecord(customer.loyalty) ? customer.loyalty : null;
    const events = (rawLoyalty
      ? recordArray<LoyaltyEvent>(
          rawLoyalty.events,
          (event) =>
            typeof event.id === "string" &&
            (event.kind === "opened" || event.kind === "earned" || event.kind === "redeemed") &&
            isFiniteNumber(event.at),
        ) ?? []
      : []).map((event) => ({
        ...event,
        sourceId: nullableString(event.sourceId, null),
        actorId: nullableString(event.actorId, null),
        actorName: nullableString(event.actorName, null),
      }));
    const loyalty = rawLoyalty &&
      isFiniteNumber(rawLoyalty.stamps) &&
      isFiniteNumber(rawLoyalty.target) &&
      isFiniteNumber(rawLoyalty.redeemedCount)
      ? {
          stamps: Math.max(0, Math.trunc(rawLoyalty.stamps)),
          target: Math.max(2, Math.min(20, Math.trunc(rawLoyalty.target))),
          redeemedCount: Math.max(0, Math.trunc(rawLoyalty.redeemedCount)),
          events,
        }
      : null;
    return {
      ...customer,
      name: nullableString(customer.name, null),
      preferredAsset: acceptedAsset(customer.preferredAsset)
        ? customer.preferredAsset
        : settings.settlementAsset,
      sourceIds,
      loyalty,
      note: nullableString(customer.note, null),
    };
  });
}

function orderRecords(value: unknown): MerchantStore["orders"] {
  const orders = idRecords<MerchantStore["orders"][number]>(value) ?? [];
  return orders.map((order) => {
    const lines = Array.isArray(order.lines)
      ? order.lines.map((line) => ({
          ...line,
          adjustmentMinor: isFiniteNumber(line.adjustmentMinor)
            ? Math.max(0, Math.trunc(line.adjustmentMinor))
            : 0,
        }))
      : [];
    const historicallySettled =
      order.status === "paid" ||
      order.status === "partially_refunded" ||
      order.status === "refunded";
    return {
      ...order,
      lines,
      staffId: nullableString(order.staffId, null),
      stockAppliedAt:
        order.stockAppliedAt === null || isFiniteNumber(order.stockAppliedAt)
          ? order.stockAppliedAt
          : historicallySettled
            ? (isFiniteNumber(order.paidAt) ? order.paidAt : order.createdAt)
            : null,
    };
  });
}

function adjustmentRecords(value: unknown): MerchantStore["adjustments"] {
  const adjustments = idRecords<MerchantStore["adjustments"][number]>(value) ?? [];
  return adjustments.map((adjustment) => {
    const orderNumber = positiveInteger(adjustment.orderNumber, 0);
    return {
      ...adjustment,
      orderId:
        typeof adjustment.orderId === "string" && adjustment.orderId
          ? adjustment.orderId
          : `legacy-order-${orderNumber}`,
      lineId: nullableString(adjustment.lineId, null),
      staffId:
        typeof adjustment.staffId === "string" && adjustment.staffId
          ? adjustment.staffId
          : "legacy-staff",
    };
  });
}

function paymentOutcome(value: unknown): MerchantStore["paymentReconciliations"][number]["outcome"] {
  return value === "settled" ||
    value === "needs_confirmation" ||
    value === "underpaid" ||
    value === "overpaid" ||
    value === "late" ||
    value === "duplicate" ||
    value === "ambiguous" ||
    value === "wrong_asset" ||
    value === "outside_band"
    ? value
    : "unmatched";
}

function unmatchedRecords(value: unknown): MerchantStore["unmatched"] {
  const payments = idRecords<MerchantStore["unmatched"][number]>(value) ?? [];
  return payments.map((payment) => ({
    ...payment,
    reconciliationOutcome: paymentOutcome(payment.reconciliationOutcome),
    candidateChargeId: nullableString(payment.candidateChargeId, null),
  }));
}

function reconciliationRecords(value: unknown): MerchantStore["paymentReconciliations"] {
  return recordArray<MerchantStore["paymentReconciliations"][number]>(
    value,
    (record) => typeof record.id === "string" && isRecord(record.payment),
  )?.map((record) => ({
    ...record,
    outcome: paymentOutcome(record.outcome),
    chargeId: nullableString(record.chargeId, null),
    orderId: nullableString(record.orderId, null),
    amountMinor: record.amountMinor === null || isFiniteNumber(record.amountMinor)
      ? record.amountMinor
      : null,
    resolution: isRecord(record.resolution) ? record.resolution : null,
  })) ?? [];
}

function refundRecords(value: unknown): MerchantStore["refunds"] {
  const refunds = idRecords<MerchantStore["refunds"][number]>(value) ?? [];
  return refunds.map((refund) => ({
    ...refund,
    kind: refund.kind === "payment_reversal" ? "payment_reversal" as const : "order" as const,
    sourcePaymentId: nullableString(refund.sourcePaymentId, null),
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

function refundRequestRecords(value: unknown): MerchantStore["refundRequests"] {
  const requests = idRecords<MerchantStore["refundRequests"][number]>(value) ?? [];
  return requests.map((request) => ({
    ...request,
    sourcePaymentId: nullableString(request.sourcePaymentId, null),
  }));
}

function exportRecords(
  value: unknown,
  staff: MerchantStore["staff"],
): MerchantStore["exportRecords"] {
  const records = idRecords<MerchantStore["exportRecords"][number]>(value) ?? [];
  return records.map((record) => {
    const runBy = typeof record.runBy === "string" && record.runBy.trim()
      ? record.runBy
      : "Imported record";
    const runAt = isFiniteNumber(record.runAt) ? record.runAt : 1;
    const from = isFiniteNumber(record.from) ? record.from : runAt;
    const to = isFiniteNumber(record.to) && record.to > from ? record.to : from + 1;
    const format =
      record.format === "json" || record.format === "xero" || record.format === "saft"
        ? record.format
        : "csv";
    return {
      ...record,
      format,
      basis: record.basis === "settlement" ? "settlement" : "transaction",
      from,
      to,
      fileName:
        typeof record.fileName === "string" && record.fileName.trim()
          ? record.fileName
          : `legacy-export-${record.id}.${format}`,
      rangeLabel:
        typeof record.rangeLabel === "string" ? record.rangeLabel : "Imported range",
      rowCount: isFiniteNumber(record.rowCount) ? Math.max(0, Math.trunc(record.rowCount)) : 0,
      runById:
        typeof record.runById === "string" && record.runById
          ? record.runById
          : staff.find((member) => member.name === runBy)?.id ?? `legacy:${record.id}`,
      runBy,
      runAt,
    };
  });
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
    recordRetentionMonths:
      value.recordRetentionMonths === null
        ? null
        : isFiniteNumber(value.recordRetentionMonths) && value.recordRetentionMonths > 0
          ? Math.trunc(value.recordRetentionMonths)
          : base.recordRetentionMonths,
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
  const invoices = invoiceRecords(value.invoices, staff);
  const requestedActiveStaffId = nullableString(value.activeStaffId, null);
  const tillTextSize =
    value.tillTextSize === "standard" ||
    value.tillTextSize === "large" ||
    value.tillTextSize === "xlarge"
      ? value.tillTextSize
      : base.tillTextSize;

  return {
    version: 2,
    revision:
      Number.isSafeInteger(value.revision) && (value.revision as number) >= 0
        ? (value.revision as number)
        : base.revision,
    writerId:
      typeof value.writerId === "string" && value.writerId
        ? value.writerId
        : base.writerId,
    updatedAt:
      isFiniteNumber(value.updatedAt) && value.updatedAt >= 0
        ? value.updatedAt
        : base.updatedAt,
    settings,
    catalogue: idRecords<MerchantStore["catalogue"][number]>(value.catalogue) ?? base.catalogue,
    modifierGroups:
      idRecords<MerchantStore["modifierGroups"][number]>(value.modifierGroups) ??
      base.modifierGroups,
    orders: orderRecords(value.orders),
    charges: idRecords<MerchantStore["charges"][number]>(value.charges) ?? [],
    refunds: refundRecords(value.refunds),
    unmatched: unmatchedRecords(value.unmatched),
    paymentReconciliations: reconciliationRecords(value.paymentReconciliations),
    staff,
    activeStaffId:
      requestedActiveStaffId && staff.some((member) => member.id === requestedActiveStaffId)
        ? requestedActiveStaffId
        : null,
    shifts: shiftRecords(value.shifts, settings, staff),
    invoices,
    counterCodes: counterCodeRecords(value.counterCodes, staff),
    counterPayments: counterPaymentRecords(value.counterPayments),
    customers: customerRecords(value.customers, settings),
    settlementRule: {
      autoConvert:
        typeof settlementValue.autoConvert === "boolean"
          ? settlementValue.autoConvert
          : base.settlementRule.autoConvert,
      maxSlippageBps: isFiniteNumber(settlementValue.maxSlippageBps)
        && Number.isInteger(settlementValue.maxSlippageBps)
        && settlementValue.maxSlippageBps >= 1
        && settlementValue.maxSlippageBps <= 1_000
        ? settlementValue.maxSlippageBps
        : base.settlementRule.maxSlippageBps,
      sweepAboveMinor:
        settlementValue.sweepAboveMinor === null ||
        (Number.isSafeInteger(settlementValue.sweepAboveMinor) &&
          (settlementValue.sweepAboveMinor as number) >= 0)
          ? (settlementValue.sweepAboveMinor as number | null)
          : base.settlementRule.sweepAboveMinor,
      sweepDestination:
        settlementValue.sweepDestination === null ||
        (typeof settlementValue.sweepDestination === "string" &&
          StrKey.isValidEd25519PublicKey(settlementValue.sweepDestination))
          ? settlementValue.sweepDestination
          : base.settlementRule.sweepDestination,
      retainedFloatMinor:
        Number.isSafeInteger(settlementValue.retainedFloatMinor) &&
        (settlementValue.retainedFloatMinor as number) >= 0
        ? (settlementValue.retainedFloatMinor as number)
        : base.settlementRule.retainedFloatMinor,
      sweepPromptHour:
        settlementValue.sweepPromptHour === null ||
        (Number.isInteger(settlementValue.sweepPromptHour) &&
          (settlementValue.sweepPromptHour as number) >= 0 &&
          (settlementValue.sweepPromptHour as number) <= 23)
          ? (settlementValue.sweepPromptHour as number | null)
          : base.settlementRule.sweepPromptHour,
    },
    adjustments: adjustmentRecords(value.adjustments),
    refundRequests: refundRequestRecords(value.refundRequests),
    peripherals: idRecords<MerchantStore["peripherals"][number]>(value.peripherals) ?? [],
    exportRecords: exportRecords(value.exportRecords, staff),
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
    nextInvoiceNumber: nextInvoiceSequence(
      value.nextInvoiceNumber,
      invoices,
      base.nextInvoiceNumber,
    ),
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

export type MerchantStoreLoadResult = StorageLoadResult<MerchantStore> | {
  kind: "locked";
  raw: string;
  message: string;
};

export function loadMerchantStoreResult(key?: Uint8Array): MerchantStoreLoadResult {
  if (typeof window === "undefined") return { kind: "absent" };

  const currentRaw = window.localStorage.getItem(KEY);
  if (currentRaw !== null) {
    try {
      const parsed: unknown = JSON.parse(currentRaw);
      if (isEncryptedMerchantEnvelope(parsed)) {
        if (!key) {
          return {
            kind: "locked",
            raw: currentRaw,
            message: "Unlock the wallet to read encrypted merchant data.",
          };
        }
        try {
          const decoded = decodeMerchantStore(decryptMerchantStore(parsed, key));
          if (
            !decoded ||
            decoded.revision !== parsed.revision ||
            decoded.writerId !== parsed.writerId ||
            decoded.updatedAt !== parsed.updatedAt
          ) {
            throw new Error("Merchant envelope metadata does not match its payload.");
          }
          return { kind: "ready", value: decoded };
        } catch {
          return {
            kind: "corrupt",
            raw: currentRaw,
            message: "Encrypted merchant data could not be decrypted or authenticated.",
          };
        }
      }
      if (isRecord(parsed) && typeof parsed.version === "number" && parsed.version > 2) {
        return {
          kind: "future",
          raw: currentRaw,
          version: parsed.version,
          message: `Merchant data uses a newer schema (${parsed.version}).`,
        };
      }
      const decoded = decodeMerchantStore(parsed);
      if (decoded && key && !saveMerchantStore(decoded, key)) {
        return {
          kind: "corrupt",
          raw: currentRaw,
          message: "Merchant data could not be migrated to encrypted storage.",
        };
      }
      return decoded
        ? { kind: "ready", value: decoded }
        : {
            kind: "corrupt",
            raw: currentRaw,
            message: "Merchant data is incomplete or uses an unsupported schema.",
          };
    } catch {
      return {
        kind: "corrupt",
        raw: currentRaw,
        message: "Merchant data is not valid JSON.",
      };
    }
  }

  const legacyRaw = window.localStorage.getItem(LEGACY_KEY);
  if (legacyRaw === null) return { kind: "absent" };
  try {
    const parsed: unknown = JSON.parse(legacyRaw);
    if (!isLegacyStore(parsed)) {
      return {
        kind: "corrupt",
        raw: legacyRaw,
        message: "Legacy merchant data is incomplete or malformed.",
      };
    }
    const migrated = migrateV1(parsed);
    if (key) saveMerchantStore(migrated, key);
    return { kind: "ready", value: migrated };
  } catch {
    return {
      kind: "corrupt",
      raw: legacyRaw,
      message: "Legacy merchant data is not valid JSON.",
    };
  }
}

export function loadMerchantStore(key?: Uint8Array): MerchantStore {
  const result = loadMerchantStoreResult(key);
  return result.kind === "ready" ? result.value : emptyStore();
}

/** Returns false when quota or storage policy prevents a durable commit. */
export function saveMerchantStore(store: MerchantStore, key?: Uint8Array): boolean {
  if (typeof window === "undefined" || !key) return false;
  let previousRaw: string | null;
  try {
    previousRaw = window.localStorage.getItem(KEY);
  } catch {
    return false;
  }
  const restorePrevious = () => {
    try {
      if (previousRaw === null) window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, previousRaw);
    } catch {
      // The caller still receives a failed durable commit. Storage may be
      // unavailable entirely, so restoration is best-effort at this point.
    }
  };
  const writeVerified = (value: MerchantStore) => {
    const raw = JSON.stringify(encryptMerchantStore(value, key));
    window.localStorage.setItem(KEY, raw);
    const storedRaw = window.localStorage.getItem(KEY);
    if (storedRaw !== raw) throw new Error("Merchant storage did not retain the encrypted write.");
    const stored: unknown = JSON.parse(storedRaw);
    if (!isEncryptedMerchantEnvelope(stored)) throw new Error("Merchant storage envelope is invalid.");
    const verified = decryptMerchantStore(stored, key);
    if (verified.revision !== value.revision || verified.writerId !== value.writerId) {
      throw new Error("Merchant storage verification failed.");
    }
  };
  try {
    writeVerified(prune(store));
    window.localStorage.removeItem(LEGACY_KEY);
    return true;
  } catch {
    // Quota exhausted: retain unresolved records and retry with shorter history.
    try {
      writeVerified(prune(store, 30));
      window.localStorage.removeItem(LEGACY_KEY);
      return true;
    } catch {
      restorePrevious();
      return false;
    }
  }
}

/** Drops resolved history beyond the configured window and retains live work. */
export function prune(store: MerchantStore, retainDays?: number): MerchantStore {
  const cutoff = (() => {
    if (retainDays !== undefined) return Date.now() - retainDays * 24 * 60 * 60 * 1000;
    if (store.settings.recordRetentionMonths === null) return Number.NEGATIVE_INFINITY;
    const date = new Date();
    date.setMonth(date.getMonth() - store.settings.recordRetentionMonths);
    return date.getTime();
  })();
  const unresolvedReconciliations = store.paymentReconciliations.filter(
    (record) => record.resolution === null,
  );
  const protectedOrderIds = new Set<string>();
  const protectedChargeIds = new Set<string>();
  for (const record of unresolvedReconciliations) {
    if (record.orderId) protectedOrderIds.add(record.orderId);
    if (record.chargeId) protectedChargeIds.add(record.chargeId);
  }
  for (const refund of store.refunds) {
    if (refund.submissionStatus === "accepted" || refund.submissionStatus === "status_unknown") {
      protectedOrderIds.add(refund.orderId);
    }
  }
  for (const request of store.refundRequests) {
    if (request.status === "pending") protectedOrderIds.add(request.orderId);
  }
  const orders = store.orders.filter(
    (order) =>
      order.createdAt >= cutoff ||
      order.status === "open" ||
      order.status === "awaiting" ||
      protectedOrderIds.has(order.id),
  );
  const keptOrderIds = new Set(orders.map((order) => order.id));
  const unresolvedPaymentIds = new Set(unresolvedReconciliations.map((record) => record.id));
  const openInvoiceStatuses = new Set(["draft", "sent", "partially_paid", "overdue"]);
  const invoices = store.invoices.filter(
    (invoice) =>
      openInvoiceStatuses.has(invoice.status) ||
      (invoice.paidAt ?? invoice.issuedAt ?? cutoff) >= cutoff,
  );
  const protectedCustomerSources = new Set<string>(unresolvedPaymentIds);
  for (const order of orders) protectedCustomerSources.add(`order:${order.id}`);
  for (const invoice of invoices) {
    for (const payment of invoice.payments ?? []) {
      protectedCustomerSources.add(`invoice-payment:${payment.id}`);
    }
  }
  const customers = store.customers.flatMap((customer) => {
    const recent = customer.lastSeenAt >= cutoff;
    const sourceIds = recent
      ? customer.sourceIds
      : customer.sourceIds.filter((sourceId) => protectedCustomerSources.has(sourceId));
    const events = customer.loyalty?.events.filter(
      (event) =>
        event.at >= cutoff ||
        (event.sourceId !== null && protectedCustomerSources.has(event.sourceId)),
    ) ?? [];
    if (!recent && sourceIds.length === 0 && events.length === 0) return [];
    return [{
      ...customer,
      name: recent ? customer.name : null,
      note: recent ? customer.note : null,
      sourceIds,
      loyalty: customer.loyalty ? { ...customer.loyalty, events } : null,
    }];
  });

  return {
    ...store,
    orders,
    charges: store.charges.filter(
      (charge) =>
        keptOrderIds.has(charge.orderId) ||
        charge.status === "awaiting" ||
        protectedChargeIds.has(charge.id),
    ),
    refunds: store.refunds.filter(
      (refund) =>
        keptOrderIds.has(refund.orderId) ||
        refund.submissionStatus === "accepted" ||
        refund.submissionStatus === "status_unknown",
    ),
    unmatched: store.unmatched.filter(
      (payment) => payment.seenAt >= cutoff || unresolvedPaymentIds.has(payment.id),
    ),
    paymentReconciliations: store.paymentReconciliations.filter(
      (record) => record.observedAt >= cutoff || record.resolution === null,
    ),
    shifts: store.shifts.filter(
      (shift) => shift.closedAt === null || shift.closedAt >= cutoff,
    ),
    invoices,
    counterPayments: store.counterPayments.filter((payment) => payment.seenAt >= cutoff),
    adjustments: store.adjustments.filter((adjustment) => adjustment.at >= cutoff),
    refundRequests: store.refundRequests.filter(
      (request) => request.status === "pending" || request.requestedAt >= cutoff,
    ),
    exportRecords: store.exportRecords.filter((record) => record.runAt >= cutoff),
    customers,
  };
}

export function clearMerchantStore(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
  window.localStorage.removeItem(LEGACY_KEY);
}

export function exportEncryptedMerchantArchive(): string | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return isEncryptedMerchantEnvelope(JSON.parse(raw)) ? raw : null;
  } catch {
    return null;
  }
}

export const MERCHANT_STORAGE_KEY = KEY;
export const MERCHANT_LEGACY_STORAGE_KEY = LEGACY_KEY;
