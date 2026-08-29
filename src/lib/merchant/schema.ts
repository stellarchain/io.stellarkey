import { StrKey } from "@stellar/stellar-sdk";
import type * as Merchant from "./types";

type Validator<T> = (value: unknown) => value is T;
type OptionalKeys<T> = {
  [Key in keyof T]-?: object extends Pick<T, Key> ? Key : never;
}[keyof T];
type RequiredKeys<T> = Exclude<keyof T, OptionalKeys<T>>;
type RequiredValidators<T> = {
  [Key in RequiredKeys<T>]-?: Validator<T[Key]>;
};
type OptionalValidators<T> = {
  [Key in OptionalKeys<T>]-?: Validator<Exclude<T[Key], undefined>>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function objectOf<T extends object>(
  required: RequiredValidators<T>,
  optional: OptionalValidators<T>,
): Validator<T> {
  const requiredEntries = Object.entries(required) as [string, Validator<unknown>][];
  const optionalEntries = Object.entries(optional) as [string, Validator<unknown>][];
  const allowed = new Set([...requiredEntries, ...optionalEntries].map(([key]) => key));
  return (value: unknown): value is T => {
    if (!isRecord(value) || !Object.keys(value).every((key) => allowed.has(key))) return false;
    for (const [key, validate] of requiredEntries) {
      if (!Object.hasOwn(value, key) || !validate(value[key])) return false;
    }
    for (const [key, validate] of optionalEntries) {
      if (Object.hasOwn(value, key) && !validate(value[key])) return false;
    }
    return true;
  };
}

function arrayOf<T>(validate: Validator<T>): Validator<T[]> {
  return (value: unknown): value is T[] => Array.isArray(value) && value.every(validate);
}

function nonEmptyArrayOf<T>(validate: Validator<T>): Validator<T[]> {
  return (value: unknown): value is T[] =>
    Array.isArray(value) && value.length > 0 && value.every(validate);
}

function nullable<T>(validate: Validator<T>): Validator<T | null> {
  return (value: unknown): value is T | null => value === null || validate(value);
}

function oneOf<const Values extends readonly unknown[]>(
  ...values: Values
): Validator<Values[number]> {
  return (value: unknown): value is Values[number] => values.includes(value);
}

function recordOf<T>(validate: Validator<T>): Validator<Record<string, T>> {
  return (value: unknown): value is Record<string, T> =>
    isRecord(value) && Object.values(value).every(validate);
}

const stringValue: Validator<string> = (value): value is string => typeof value === "string";
const nonEmptyString: Validator<string> = (value): value is string =>
  typeof value === "string" && value.length > 0;
const booleanValue: Validator<boolean> = (value): value is boolean => typeof value === "boolean";
const finiteNumber: Validator<number> = (value): value is number =>
  typeof value === "number" && Number.isFinite(value);
const safeInteger: Validator<number> = (value): value is number => Number.isSafeInteger(value);
const nonNegativeInteger: Validator<number> = (value): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const positiveInteger: Validator<number> = (value): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;
const nonNegativeNumber: Validator<number> = (value): value is number =>
  finiteNumber(value) && value >= 0;
const timestamp = nonNegativeNumber;
const minor = nonNegativeInteger;
const signedMinor = safeInteger;
const stringArray = arrayOf(stringValue);
const nullableString = nullable(stringValue);
const nullableTimestamp = nullable(timestamp);
const nullableMinor = nullable(minor);
const network = oneOf("mainnet", "testnet");
const currency = oneOf("USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF");

const acceptedAsset = objectOf<Merchant.AcceptedAsset>({
  code: nonEmptyString,
  issuer: nullableString,
}, {});

const taxRate = objectOf<Merchant.TaxRate>({
  id: nonEmptyString,
  label: stringValue,
  percent: nonNegativeNumber,
}, {});

const merchantProfile = objectOf<Merchant.MerchantProfile>({
  name: stringValue,
  addressLines: stringArray,
  taxId: stringValue,
  receiptFooter: stringValue,
}, {});

const tipSettings = objectOf<Merchant.TipSettings>({
  mode: oneOf("off", "percent", "fixed"),
  percents: arrayOf(nonNegativeNumber),
  fixedMinor: arrayOf(minor),
  thresholdMinor: minor,
  onNet: booleanValue,
}, {});

const merchantSettings = objectOf<Merchant.MerchantSettings>({
  enabled: booleanValue,
  profile: merchantProfile,
  receivingPublicKey: nullableString,
  settlementAsset: acceptedAsset,
  acceptedAssets: arrayOf(acceptedAsset),
  currency,
  taxMode: oneOf("inclusive", "added"),
  taxRates: nonEmptyArrayOf(taxRate),
  defaultTaxRateId: nonEmptyString,
  tips: tipSettings,
  chargeExpirySeconds: nonNegativeNumber,
  toleranceBps: nonNegativeNumber,
  toleranceFloorMinor: minor,
  holdAutoLockDuringCharge: booleanValue,
  operatorLockMode: oneOf("after_sale", "after_timeout"),
  operatorLockTimeoutMinutes: oneOf(1, 5, 15),
  terminalName: nonEmptyString,
  recordRetentionMonths: nullable(positiveInteger),
}, {});

const modifier = objectOf<Merchant.Modifier>({
  id: nonEmptyString,
  name: stringValue,
  priceMinor: minor,
}, {});

const modifierGroupShape = objectOf<Merchant.ModifierGroup>({
  id: nonEmptyString,
  name: stringValue,
  min: nonNegativeInteger,
  max: nonNegativeInteger,
  modifiers: arrayOf(modifier),
}, {});
const modifierGroup: Validator<Merchant.ModifierGroup> = (value): value is Merchant.ModifierGroup =>
  modifierGroupShape(value) && value.min <= value.max;

const catalogueItem = objectOf<Merchant.CatalogueItem>({
  id: nonEmptyString,
  name: stringValue,
  sku: stringValue,
  category: stringValue,
  priceMinor: minor,
  taxRateId: nonEmptyString,
  colour: stringValue,
  modifierGroupIds: stringArray,
  trackStock: booleanValue,
  stockOnHand: nullable(nonNegativeInteger),
  lowStockAt: nullable(nonNegativeInteger),
  active: booleanValue,
  sortIndex: nonNegativeInteger,
}, {});

const orderLineModifier = objectOf<Merchant.OrderLineModifier>({
  modifierId: nonEmptyString,
  name: stringValue,
  priceMinor: minor,
}, {});

const orderLine = objectOf<Merchant.OrderLine>({
  id: nonEmptyString,
  itemId: nullableString,
  name: stringValue,
  quantity: nonNegativeNumber,
  unitPriceMinor: minor,
  modifiers: arrayOf(orderLineModifier),
  taxRateId: nonEmptyString,
  note: nullableString,
}, {
  adjustmentMinor: minor,
});

const taxByRate = recordOf(minor);
const orderTotals = objectOf<Merchant.OrderTotals>({
  grossMinor: minor,
  discountMinor: minor,
  tipMinor: minor,
  netMinor: minor,
  taxByRate,
  taxMinor: minor,
  totalMinor: minor,
}, {});

const tenderPart = objectOf<Merchant.TenderPart>({
  kind: oneOf("crypto", "cash", "card"),
  amountMinor: minor,
}, {
  chargeId: nonEmptyString,
  receivedMinor: minor,
  changeMinor: minor,
  externalReference: nonEmptyString,
});

const inventoryException = objectOf<Merchant.InventoryException>({
  reason: oneOf("insufficient_stock", "missing_count"),
  itemId: nonEmptyString,
  itemName: stringValue,
  requested: nonNegativeInteger,
  available: nullable(nonNegativeInteger),
  recordedAt: timestamp,
}, {});

const order = objectOf<Merchant.Order>({
  id: nonEmptyString,
  number: positiveInteger,
  reference: nonEmptyString,
  network,
  status: oneOf("open", "awaiting", "paid", "refunded", "partially_refunded", "voided"),
  lines: arrayOf(orderLine),
  totals: orderTotals,
  currency,
  tender: arrayOf(tenderPart),
  staffId: nullableString,
  staffName: stringValue,
  terminalName: nonEmptyString,
  createdAt: timestamp,
  paidAt: nullableTimestamp,
  stockAppliedAt: nullableTimestamp,
  stockExceptions: arrayOf(inventoryException),
  payerAddress: nullableString,
  note: nullableString,
}, {});

const chargeQuote = objectOf<Merchant.ChargeQuote>({
  unitPriceMinorE6: nonNegativeInteger,
  asset: acceptedAsset,
  amount: nonEmptyString,
  quotedAt: timestamp,
}, {});

const observedPayment = objectOf<Omit<Merchant.MatchedPayment, "lane">>({
  id: nonEmptyString,
  transactionHash: nonEmptyString,
  ledger: nonNegativeInteger,
  from: stringValue,
  destination: nonEmptyString,
  amount: nonEmptyString,
  asset: acceptedAsset,
  memo: nullableString,
  createdAt: nonEmptyString,
}, {});

const matchedPayment = objectOf<Merchant.MatchedPayment>({
  id: nonEmptyString,
  transactionHash: nonEmptyString,
  ledger: nonNegativeInteger,
  from: stringValue,
  destination: nonEmptyString,
  amount: nonEmptyString,
  asset: acceptedAsset,
  memo: nullableString,
  createdAt: nonEmptyString,
  lane: oneOf("memo", "amount", "manual"),
}, {});

const charge = objectOf<Merchant.Charge>({
  id: nonEmptyString,
  orderId: nonEmptyString,
  reference: nonEmptyString,
  network,
  destination: nonEmptyString,
  amountMinor: minor,
  currency,
  quotes: arrayOf(chargeQuote),
  status: oneOf("awaiting", "paid", "underpaid", "overpaid", "expired", "voided"),
  createdAt: timestamp,
  expiresAt: timestamp,
  payment: nullable(matchedPayment),
}, {});

const unmatchedPayment = objectOf<Merchant.UnmatchedPayment>({
  id: nonEmptyString,
  transactionHash: nonEmptyString,
  ledger: nonNegativeInteger,
  from: stringValue,
  destination: nonEmptyString,
  amount: nonEmptyString,
  asset: acceptedAsset,
  memo: nullableString,
  createdAt: nonEmptyString,
  seenAt: timestamp,
  reconciliationOutcome: oneOf(
    "settled",
    "needs_confirmation",
    "underpaid",
    "overpaid",
    "late",
    "duplicate",
    "ambiguous",
    "wrong_asset",
    "outside_band",
    "invalid_time",
    "unmatched",
  ),
  candidateChargeId: nullableString,
  candidateInvoiceId: nullableString,
}, {});

const paymentResolution = objectOf<Merchant.PaymentResolution>({
  kind: oneOf("attached", "dismissed", "refund_submitted"),
  staffId: nonEmptyString,
  staffName: stringValue,
  at: timestamp,
  targetChargeId: nullableString,
  refundId: nullableString,
}, {});

const paymentReconciliation = objectOf<Merchant.PaymentReconciliation>({
  id: nonEmptyString,
  network,
  payment: observedPayment,
  outcome: oneOf(
    "settled",
    "needs_confirmation",
    "underpaid",
    "overpaid",
    "late",
    "duplicate",
    "ambiguous",
    "wrong_asset",
    "outside_band",
    "invalid_time",
    "unmatched",
  ),
  chargeId: nullableString,
  orderId: nullableString,
  invoiceId: nullableString,
  amountMinor: nullableMinor,
  reversalAmount: nullableString,
  observedAt: timestamp,
  resolution: nullable(paymentResolution),
}, {});

const refund = objectOf<Merchant.Refund>({
  id: nonEmptyString,
  orderId: nonEmptyString,
  kind: oneOf("order", "payment_reversal"),
  sourcePaymentId: nullableString,
  network,
  amountMinor: minor,
  asset: acceptedAsset,
  amount: nonEmptyString,
  destination: nonEmptyString,
  reason: oneOf("wrong_item", "customer_request", "item_returned", "duplicate", "overpayment", "other"),
  note: nullableString,
  transactionHash: nullableString,
  submissionStatus: oneOf("prepared", "accepted", "confirmed", "status_unknown", "failed"),
  createdAt: timestamp,
}, {
  invoiceId: nullableString,
  requestId: nullableString,
});

const staffPermissions = objectOf<Merchant.StaffPermissions>({
  takePayment: booleanValue,
  applyDiscount: booleanValue,
  comp: booleanValue,
  void: booleanValue,
  refundCeilingMinor: nullableMinor,
  openDrawer: booleanValue,
  seeReports: booleanValue,
  exportRecords: booleanValue,
}, {});

const staffMember = objectOf<Merchant.StaffMember>({
  id: nonEmptyString,
  name: nonEmptyString,
  role: oneOf("owner", "manager", "server", "accountant"),
  permissions: staffPermissions,
  pinDigest: nullableString,
  pinSetAt: nullableTimestamp,
  active: booleanValue,
}, {});

const adjustment = objectOf<Merchant.Adjustment>({
  id: nonEmptyString,
  kind: oneOf("discount", "comp", "void"),
  lineId: nullableString,
  lineName: nullableString,
  amountMinor: minor,
  reasonCode: nonEmptyString,
  staffId: nonEmptyString,
  staffName: stringValue,
  at: timestamp,
  orderId: nonEmptyString,
  orderNumber: positiveInteger,
}, {});

const cashCount = objectOf<Merchant.CashCount>({
  countedMinor: minor,
  expectedMinor: minor,
  varianceMinor: signedMinor,
}, {});

const shiftStaffTotal = objectOf<Merchant.ShiftStaffTotal>({
  staffId: nullableString,
  staffName: stringValue,
  orderCount: nonNegativeInteger,
  takingsMinor: minor,
  tipsMinor: minor,
}, {});

const shiftReport = objectOf<Merchant.ShiftReport>({
  kind: oneOf("x", "z"),
  shiftId: nonEmptyString,
  sequence: positiveInteger,
  terminalName: nonEmptyString,
  network,
  openedAt: timestamp,
  generatedAt: timestamp,
  openedById: nonEmptyString,
  openedBy: stringValue,
  closedById: nullableString,
  closedBy: nullableString,
  floatMinor: minor,
  grossMinor: minor,
  refundsMinor: minor,
  tipsMinor: minor,
  discountsMinor: minor,
  compsMinor: minor,
  voidsMinor: minor,
  taxByRate,
  tenderByKind: objectOf<Record<"crypto" | "cash" | "card", number>>({
    crypto: minor,
    cash: minor,
    card: minor,
  }, {}),
  expectedCashMinor: minor,
  orderCount: nonNegativeInteger,
  staffTotals: arrayOf(shiftStaffTotal),
  adjustments: arrayOf(adjustment),
  openTabs: nonNegativeInteger,
  cash: nullable(cashCount),
}, {});

const shift = objectOf<Merchant.Shift>({
  id: nonEmptyString,
  number: positiveInteger,
  openedAt: timestamp,
  closedAt: nullableTimestamp,
  openedById: nonEmptyString,
  openedBy: stringValue,
  closedById: nullableString,
  closedBy: nullableString,
  terminalName: nonEmptyString,
  network,
  floatMinor: minor,
  grossMinor: minor,
  refundsMinor: minor,
  tipsMinor: minor,
  discountsMinor: minor,
  compsMinor: minor,
  voidsMinor: minor,
  taxByRate,
  orderCount: nonNegativeInteger,
  cash: nullable(cashCount),
  openTabs: nonNegativeInteger,
  zReport: nullable(shiftReport),
}, {});

const invoiceLine = objectOf<Merchant.InvoiceLine>({
  id: nonEmptyString,
  description: stringValue,
  quantity: nonNegativeNumber,
  unitPriceMinor: minor,
  taxRateId: nonEmptyString,
}, {});

const invoicePaymentShape = objectOf<Merchant.InvoicePayment>({
  id: nonEmptyString,
  kind: oneOf("stellar", "manual"),
  network,
  amountMinor: minor,
  receivedMinor: minor,
  overpaymentMinor: minor,
  asset: nullable(acceptedAsset),
  amount: nullableString,
  transactionHash: nullableString,
  from: nullableString,
  observedAt: timestamp,
  recordedById: nullableString,
  recordedBy: nullableString,
  note: nullableString,
}, {});
const invoicePayment: Validator<Merchant.InvoicePayment> =
  (value): value is Merchant.InvoicePayment =>
    invoicePaymentShape(value) &&
    value.receivedMinor >= value.amountMinor &&
    value.overpaymentMinor === value.receivedMinor - value.amountMinor;

const invoice = objectOf<Merchant.Invoice>({
  id: nonEmptyString,
  number: nonEmptyString,
  status: oneOf("draft", "sent", "partially_paid", "paid", "overdue", "void"),
  customerName: stringValue,
  customerEmail: nullableString,
  customerAddress: nullableString,
  reference: nonEmptyString,
  network,
  destination: nullableString,
  quotes: arrayOf(chargeQuote),
  payments: arrayOf(invoicePayment),
  lines: arrayOf(invoiceLine),
  totals: orderTotals,
  currency,
  issuedAt: nullableTimestamp,
  dueAt: nullableTimestamp,
  paidAt: nullableTimestamp,
  paidMinor: minor,
  note: nullableString,
  createdAt: timestamp,
  updatedAt: timestamp,
  createdById: nonEmptyString,
  createdBy: stringValue,
  issuedById: nullableString,
  issuedBy: nullableString,
  voidedAt: nullableTimestamp,
  voidedById: nullableString,
  voidedBy: nullableString,
  voidReason: nullableString,
}, {});

const counterCode = objectOf<Merchant.CounterCode>({
  id: nonEmptyString,
  title: stringValue,
  kind: oneOf("fixed", "open", "tip"),
  amountMinor: nullableMinor,
  suggestedMinor: arrayOf(minor),
  currency,
  acceptedAssets: nonEmptyArrayOf(acceptedAsset),
  memoPrefix: nonEmptyString,
  requestMessage: nonEmptyString,
  network,
  destination: nonEmptyString,
  quotes: arrayOf(chargeQuote),
  staffId: nullableString,
  active: booleanValue,
  payments: nonNegativeInteger,
  takingsMinor: minor,
  expiresAt: nullableTimestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
  createdById: nonEmptyString,
  createdBy: stringValue,
}, {});

const counterPayment = objectOf<Merchant.CounterPayment>({
  id: nonEmptyString,
  codeId: nonEmptyString,
  payment: matchedPayment,
  amountMinor: nullableMinor,
  quote: nullable(chargeQuote),
  seenAt: timestamp,
}, {});

const loyaltyEvent = objectOf<Merchant.LoyaltyEvent>({
  id: nonEmptyString,
  kind: oneOf("opened", "earned", "redeemed"),
  sourceId: nullableString,
  at: timestamp,
  actorId: nullableString,
  actorName: nullableString,
}, {});

const loyaltyCardShape = objectOf<Merchant.LoyaltyCard>({
  stamps: nonNegativeInteger,
  target: positiveInteger,
  redeemedCount: nonNegativeInteger,
  events: arrayOf(loyaltyEvent),
}, {});
const loyaltyCard: Validator<Merchant.LoyaltyCard> = (value): value is Merchant.LoyaltyCard =>
  loyaltyCardShape(value) && value.target >= 2 && value.target <= 20;

const customerRecordShape = objectOf<Merchant.CustomerRecord>({
  address: nonEmptyString,
  name: nullableString,
  firstSeenAt: timestamp,
  lastSeenAt: timestamp,
  orderCount: nonNegativeInteger,
  lifetimeMinor: minor,
  averageMinor: minor,
  preferredAsset: acceptedAsset,
  sourceIds: stringArray,
  loyalty: nullable(loyaltyCard),
  note: nullableString,
}, {});
const customerRecord: Validator<Merchant.CustomerRecord> =
  (value): value is Merchant.CustomerRecord =>
    customerRecordShape(value) && new Set(value.sourceIds).size === value.sourceIds.length;

const settlementRuleShape = objectOf<Merchant.SettlementRule>({
  autoConvert: booleanValue,
  maxSlippageBps: positiveInteger,
  sweepAboveMinor: nullableMinor,
  sweepDestination: nullable(stringValue),
  retainedFloatMinor: minor,
  sweepPromptHour: nullable(nonNegativeInteger),
}, {});
const settlementRule: Validator<Merchant.SettlementRule> =
  (value): value is Merchant.SettlementRule =>
    settlementRuleShape(value) &&
    value.maxSlippageBps <= 1_000 &&
    (value.sweepDestination === null || StrKey.isValidEd25519PublicKey(value.sweepDestination)) &&
    (value.sweepPromptHour === null || value.sweepPromptHour <= 23);

const refundRequest = objectOf<Merchant.RefundRequest>({
  id: nonEmptyString,
  orderId: nonEmptyString,
  orderNumber: nonNegativeInteger,
  amountMinor: minor,
  reason: oneOf("wrong_item", "customer_request", "item_returned", "duplicate", "overpayment", "other"),
  note: nullableString,
  sourcePaymentId: nullableString,
  requestedById: nonEmptyString,
  requestedBy: stringValue,
  requestedAt: timestamp,
  status: oneOf("pending", "approved", "declined"),
  reviewedById: nullableString,
  reviewedAt: nullableTimestamp,
  refundId: nullableString,
}, {
  invoiceId: nullableString,
  invoiceNumber: nullableString,
});

const peripheral = objectOf<Merchant.Peripheral>({
  id: nonEmptyString,
  kind: oneOf("printer", "drawer", "scanner", "display"),
  name: stringValue,
  connected: booleanValue,
  detail: stringValue,
}, {
  unavailable: booleanValue,
});

const exportRecordShape = objectOf<Merchant.ExportRecord>({
  id: nonEmptyString,
  format: oneOf("csv", "json", "xero", "saft"),
  basis: oneOf("transaction", "settlement"),
  from: timestamp,
  to: timestamp,
  fileName: nonEmptyString,
  rangeLabel: stringValue,
  rowCount: nonNegativeInteger,
  runById: nonEmptyString,
  runBy: nonEmptyString,
  runAt: timestamp,
}, {});
const exportRecord: Validator<Merchant.ExportRecord> =
  (value): value is Merchant.ExportRecord => exportRecordShape(value) && value.to > value.from;

const terminalDevice = objectOf<Merchant.TerminalDevice>({
  name: nonEmptyString,
  appVersion: stringValue,
  queuedCharges: nonNegativeInteger,
}, {});

function validCursors(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([key, cursor]) => {
    const separator = key.indexOf(":");
    const keyNetwork = key.slice(0, separator);
    const destination = key.slice(separator + 1);
    return separator > 0 &&
      (keyNetwork === "mainnet" || keyNetwork === "testnet") &&
      StrKey.isValidEd25519PublicKey(destination) &&
      nonEmptyString(cursor);
  });
}

const merchantStoreShape = objectOf<Merchant.MerchantStore>({
  version: oneOf(2),
  revision: nonNegativeInteger,
  writerId: nullable(nonEmptyString),
  updatedAt: timestamp,
  settings: merchantSettings,
  catalogue: arrayOf(catalogueItem),
  modifierGroups: arrayOf(modifierGroup),
  orders: arrayOf(order),
  charges: arrayOf(charge),
  refunds: arrayOf(refund),
  unmatched: arrayOf(unmatchedPayment),
  paymentReconciliations: arrayOf(paymentReconciliation),
  staff: arrayOf(staffMember),
  activeStaffId: nullableString,
  onShiftStaffIds: stringArray,
  shifts: arrayOf(shift),
  invoices: arrayOf(invoice),
  counterCodes: arrayOf(counterCode),
  counterPayments: arrayOf(counterPayment),
  customers: arrayOf(customerRecord),
  settlementRule,
  adjustments: arrayOf(adjustment),
  refundRequests: arrayOf(refundRequest),
  peripherals: arrayOf(peripheral),
  exportRecords: arrayOf(exportRecord),
  terminal: terminalDevice,
  tillTextSize: oneOf("standard", "large", "xlarge"),
  nextOrderNumber: positiveInteger,
  nextShiftNumber: positiveInteger,
  nextInvoiceNumber: positiveInteger,
  cursors: validCursors,
}, {});

function nextInvoiceNumberIsCurrent(store: Merchant.MerchantStore): boolean {
  const afterHighest = store.invoices.reduce((next, invoice) => {
    const match = /^INV-\d{4}-(\d+)$/.exec(invoice.number);
    if (!match) return next;
    const sequence = Number(match[1]);
    return Number.isSafeInteger(sequence) ? Math.max(next, sequence + 1) : next;
  }, 1);
  return store.nextInvoiceNumber >= afterHighest;
}

function staffSelectionIsCurrent(store: Merchant.MerchantStore): boolean {
  const activeIds = new Set(
    store.staff.filter((member) => member.active).map((member) => member.id),
  );
  if (store.activeStaffId !== null && !activeIds.has(store.activeStaffId)) return false;
  if (new Set(store.onShiftStaffIds).size !== store.onShiftStaffIds.length) return false;
  if (!store.onShiftStaffIds.every((id) => activeIds.has(id))) return false;
  return store.activeStaffId === null || store.onShiftStaffIds.includes(store.activeStaffId);
}

/** Accept exactly the current persisted schema; unsupported POC data stays untouched. */
export function isCurrentMerchantStore(value: unknown): value is Merchant.MerchantStore {
  return merchantStoreShape(value) &&
    staffSelectionIsCurrent(value) &&
    nextInvoiceNumberIsCurrent(value);
}
