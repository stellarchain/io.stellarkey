import type { NetworkKey } from "../stellar";
import type { FiatCurrency } from "../format";

/**
 * Merchant Mode is a non-custodial point of sale. A charge is a *request*: the
 * till publishes a SEP-7 `web+stellar:pay` URI against the shop's own account and
 * watches Horizon until a matching payment closes in a ledger. Nothing is
 * escrowed, nothing is pulled, and a refund is an ordinary outbound payment.
 *
 * Money is an integer count of minor units (cents) everywhere in this module.
 * Stellar amounts stay seven-decimal strings and are compared as BigInt stroops.
 */

/** Cents. Never a float, never a formatted string. */
export type Minor = number;

/** A seven-decimal Stellar amount, e.g. "27.3300000". */
export type StellarAmount = string;

export type TaxMode = "inclusive" | "added";

export interface TaxRate {
  id: string;
  label: string;
  /** Percentage points, e.g. 23 for 23 %. */
  percent: number;
}

export interface AcceptedAsset {
  /** "XLM" for the native asset. */
  code: string;
  /** null for the native asset. */
  issuer: string | null;
}

export type TipMode = "off" | "percent" | "fixed";

export interface TipSettings {
  mode: TipMode;
  /** Percentage presets offered above `thresholdMinor`, e.g. [10, 15, 20]. */
  percents: number[];
  /** Fixed presets in minor units offered at or below `thresholdMinor`. */
  fixedMinor: Minor[];
  /** Below this ticket total the fixed presets are shown instead of percentages. */
  thresholdMinor: Minor;
  /** Tips are calculated on the net (ex-tax) figure when true. */
  onNet: boolean;
}

export interface MerchantProfile {
  name: string;
  addressLines: string[];
  /** VAT / tax registration number, printed on receipts. */
  taxId: string;
  /** Free text printed at the foot of every receipt. */
  receiptFooter: string;
}

export interface MerchantSettings {
  enabled: boolean;
  profile: MerchantProfile;
  /** Public key of the account every charge is addressed to. */
  receivingPublicKey: string | null;
  /** The asset the shop keeps its books in. */
  settlementAsset: AcceptedAsset;
  /** Assets a customer may pay in. */
  acceptedAssets: AcceptedAsset[];
  currency: FiatCurrency;
  taxMode: TaxMode;
  taxRates: TaxRate[];
  /** Rate applied to a keypad amount that has no catalogue line behind it. */
  defaultTaxRateId: string;
  tips: TipSettings;
  /** How long a charge stays payable, in seconds. */
  chargeExpirySeconds: number;
  /**
   * Amount tolerance, in basis points, applied when a payment arrives with no
   * memo. Exact-stroop comparison runs first; this band only decides a single
   * remaining candidate. 150 = ±1.5 %.
   */
  toleranceBps: number;
  /** Floor for the tolerance band in minor units, so tiny tickets stay matchable. */
  toleranceFloorMinor: Minor;
  /** Suspend the wallet's idle auto-lock while a charge is open. */
  holdAutoLockDuringCharge: boolean;
  /** When the PIN-verified till operator is cleared. */
  operatorLockMode: "after_sale" | "after_timeout";
  /** Idle minutes before an operator session clears in timeout mode. */
  operatorLockTimeoutMinutes: 1 | 5 | 15;
  /** Name of this device, attributed to every order it rings up. */
  terminalName: string;
  /** Resolved local records kept on this device; null keeps them indefinitely. */
  recordRetentionMonths: number | null;
}

export interface Modifier {
  id: string;
  name: string;
  priceMinor: Minor;
}

export interface ModifierGroup {
  id: string;
  name: string;
  min: number;
  max: number;
  modifiers: Modifier[];
}

export interface CatalogueItem {
  id: string;
  name: string;
  sku: string;
  category: string;
  priceMinor: Minor;
  taxRateId: string;
  /** Tile tint, an iOS system hex. */
  colour: string;
  modifierGroupIds: string[];
  trackStock: boolean;
  stockOnHand: number | null;
  lowStockAt: number | null;
  active: boolean;
  sortIndex: number;
}

export interface OrderLineModifier {
  modifierId: string;
  name: string;
  priceMinor: Minor;
}

export interface OrderLine {
  id: string;
  /** null for a keypad amount with no catalogue item behind it. */
  itemId: string | null;
  name: string;
  quantity: number;
  /** Unit price before modifiers. */
  unitPriceMinor: Minor;
  modifiers: OrderLineModifier[];
  taxRateId: string;
  note: string | null;
  /** Discount or comp attached to this line, capped at its original gross. */
  adjustmentMinor?: Minor;
}

/** Every money figure a ticket needs, derived once and stored. */
export interface OrderTotals {
  /** Sum of lines including modifiers, before discount. */
  grossMinor: Minor;
  discountMinor: Minor;
  tipMinor: Minor;
  /** Tax-exclusive figure. */
  netMinor: Minor;
  /** Tax by rate id, so a mixed-rate ticket stays auditable. */
  taxByRate: Record<string, Minor>;
  taxMinor: Minor;
  /** What the customer pays: gross − discount + tip. */
  totalMinor: Minor;
}

export type TenderKind = "crypto" | "cash" | "card";

export interface TenderPart {
  kind: TenderKind;
  amountMinor: Minor;
  /** Present for a crypto leg. */
  chargeId?: string;
  /** Cash only: what the customer handed over and what they got back. */
  receivedMinor?: Minor;
  changeMinor?: Minor;
  /** External card-terminal receipt/reference. The app never stores card data. */
  externalReference?: string;
}

export type OrderStatus =
  | "open"
  | "awaiting"
  | "paid"
  | "refunded"
  | "partially_refunded"
  | "voided";

export type InventoryExceptionReason = "insufficient_stock" | "missing_count";

/** A durable stock projection issue recorded without rolling back a completed sale. */
export interface InventoryException {
  reason: InventoryExceptionReason;
  itemId: string;
  itemName: string;
  requested: number;
  available: number | null;
  recordedAt: number;
}

export interface Order {
  id: string;
  /** Human sequence, e.g. 2092. Unique per device. */
  number: number;
  /** The memo carried by this order's charges, e.g. "MC2092". */
  reference: string;
  network: NetworkKey;
  status: OrderStatus;
  lines: OrderLine[];
  totals: OrderTotals;
  currency: FiatCurrency;
  tender: TenderPart[];
  /** Stable actor identity; the name is retained as an immutable receipt snapshot. */
  staffId: string | null;
  staffName: string;
  terminalName: string;
  createdAt: number;
  paidAt: number | null;
  /** Set in the same commit as the first stock decrement. */
  stockAppliedAt: number | null;
  /** Inventory exceptions never invalidate an irreversible payment fact. */
  stockExceptions: InventoryException[];
  /** Set only once a payment has been matched to this order. */
  payerAddress: string | null;
  note: string | null;
}

export type ChargeStatus =
  | "awaiting"
  | "paid"
  | "underpaid"
  | "overpaid"
  | "expired"
  | "voided";

/** The FX quote a charge is held at, so the shop's number cannot move mid-sale. */
export interface ChargeQuote {
  /**
   * Minor units of `currency` per 1 whole unit of the asset, scaled by 1e6.
   * XLM at EUR 0.2532 is 25.32 cents, which is not an integer — the scale is
   * what keeps a cheap asset's price exact instead of rounding it to a cent.
   */
  unitPriceMinorE6: number;
  asset: AcceptedAsset;
  /** Seven-decimal asset amount the customer is asked for. */
  amount: StellarAmount;
  quotedAt: number;
}

export interface Charge {
  id: string;
  orderId: string;
  reference: string;
  network: NetworkKey;
  destination: string;
  /** What the shop is owed, in its own currency. */
  amountMinor: Minor;
  currency: FiatCurrency;
  /** One quote per accepted asset, all payable until the charge closes. */
  quotes: ChargeQuote[];
  status: ChargeStatus;
  createdAt: number;
  expiresAt: number;
  /** Set when a payment is matched. */
  payment: MatchedPayment | null;
}

export type MatchLane = "memo" | "amount" | "manual";

export interface MatchedPayment {
  /** Horizon payment operation id. */
  id: string;
  transactionHash: string;
  ledger: number;
  from: string;
  amount: StellarAmount;
  asset: AcceptedAsset;
  memo: string | null;
  createdAt: string;
  lane: MatchLane;
}

/** A payment that reached the till but belongs to no charge yet. */
export interface UnmatchedPayment extends Omit<MatchedPayment, "lane"> {
  seenAt: number;
  /** Durable explanation and candidate retained from reconciliation. */
  reconciliationOutcome: PaymentReconciliationOutcome;
  candidateChargeId: string | null;
}

export type PaymentReconciliationOutcome =
  | "settled"
  | "needs_confirmation"
  | "underpaid"
  | "overpaid"
  | "late"
  | "duplicate"
  | "ambiguous"
  | "wrong_asset"
  | "outside_band"
  | "unmatched";

export type PaymentResolutionKind = "attached" | "dismissed" | "refund_submitted";

export interface PaymentResolution {
  kind: PaymentResolutionKind;
  staffId: string;
  staffName: string;
  at: number;
  targetChargeId: string | null;
  refundId: string | null;
}

/** One immutable observation per Horizon payment operation ID. */
export interface PaymentReconciliation {
  /** Horizon payment operation ID and the idempotency key. */
  id: string;
  network: NetworkKey;
  payment: Omit<MatchedPayment, "lane">;
  outcome: PaymentReconciliationOutcome;
  chargeId: string | null;
  orderId: string | null;
  /** Exact held-quote value where a matching asset/charge exists. */
  amountMinor: Minor | null;
  observedAt: number;
  resolution: PaymentResolution | null;
}

export type RefundReason =
  | "wrong_item"
  | "customer_request"
  | "item_returned"
  | "duplicate"
  | "overpayment"
  | "other";

/** Canonical-hash lifecycle for the outbound Stellar payment behind a refund. */
export type RefundSubmissionStatus =
  | "accepted"
  | "confirmed"
  | "status_unknown"
  | "failed";

export type RefundKind = "order" | "payment_reversal";

export interface Refund {
  id: string;
  orderId: string;
  kind: RefundKind;
  /** Horizon payment operation being returned outside the order's sale value. */
  sourcePaymentId: string | null;
  network: NetworkKey;
  amountMinor: Minor;
  asset: AcceptedAsset;
  amount: StellarAmount;
  destination: string;
  reason: RefundReason;
  note: string | null;
  transactionHash: string | null;
  /** Never infer success from a hash alone: ambiguous submissions stay reserved and tracked. */
  submissionStatus: RefundSubmissionStatus;
  createdAt: number;
}

/* Operational records are persisted in MerchantStore. Components must not use
 * fixture data as a runtime substitute for these records. */

export type StaffRole = "owner" | "manager" | "server" | "accountant";

export interface StaffPermissions {
  takePayment: boolean;
  applyDiscount: boolean;
  comp: boolean;
  void: boolean;
  /** Maximum refund a member can release unaided; above it a request is raised. */
  refundCeilingMinor: Minor | null;
  openDrawer: boolean;
  seeReports: boolean;
  exportRecords: boolean;
}

export interface StaffMember {
  id: string;
  name: string;
  role: StaffRole;
  permissions: StaffPermissions;
  /**
   * A salted digest, never a reversible payload, and stored outside the vault:
   * a PIN has to be checkable while the vault is locked. It authorises the till,
   * never a signature.
   */
  pinDigest: string | null;
  pinSetAt: number | null;
  active: boolean;
}

/**
 * This device, and the only one. Pairing, a roster and reserved order-number
 * blocks all exist to stop two synced tills colliding, and syncing needs a
 * server — so one install is one terminal. There is no `state` and no
 * `lastSeenAt`: the connectivity of the device in your hand is observed live,
 * never stored, and "last seen" is only a question you ask about a device
 * somewhere else. The live name is `MerchantSettings.terminalName`; this record
 * carries what settings does not.
 */
export interface TerminalDevice {
  /** Mirrors `MerchantSettings.terminalName`, which is where a shop edits it. */
  name: string;
  appVersion: string;
  /** Charges rung up while Horizon was unreachable, still to be confirmed. */
  queuedCharges: number;
}

export interface CashCount {
  /** Counted before the figure is revealed, so the count is not anchored. */
  countedMinor: Minor;
  expectedMinor: Minor;
  varianceMinor: Minor;
}

export interface ShiftStaffTotal {
  staffId: string | null;
  staffName: string;
  orderCount: number;
  takingsMinor: Minor;
  tipsMinor: Minor;
}

export interface ShiftReport {
  /** X is a live reading; Z is the immutable snapshot persisted at close. */
  kind: "x" | "z";
  shiftId: string;
  sequence: number;
  terminalName: string;
  network: NetworkKey;
  openedAt: number;
  generatedAt: number;
  openedById: string;
  openedBy: string;
  closedById: string | null;
  closedBy: string | null;
  floatMinor: Minor;
  grossMinor: Minor;
  refundsMinor: Minor;
  tipsMinor: Minor;
  discountsMinor: Minor;
  compsMinor: Minor;
  voidsMinor: Minor;
  taxByRate: Record<string, Minor>;
  tenderByKind: Record<TenderKind, Minor>;
  expectedCashMinor: Minor;
  orderCount: number;
  staffTotals: ShiftStaffTotal[];
  /** Full immutable snapshots, not IDs whose source records may later change. */
  adjustments: Adjustment[];
  openTabs: number;
  cash: CashCount | null;
}

export interface Shift {
  id: string;
  /** Z-reports are sequential and never re-issued. */
  number: number;
  openedAt: number;
  closedAt: number | null;
  openedById: string;
  openedBy: string;
  closedById: string | null;
  closedBy: string | null;
  terminalName: string;
  network: NetworkKey;
  floatMinor: Minor;
  grossMinor: Minor;
  refundsMinor: Minor;
  tipsMinor: Minor;
  discountsMinor: Minor;
  compsMinor: Minor;
  voidsMinor: Minor;
  taxByRate: Record<string, Minor>;
  orderCount: number;
  cash: CashCount | null;
  /** Tabs still unsettled block a close. */
  openTabs: number;
  /** Written exactly once with the close; live X reports are never persisted here. */
  zReport: ShiftReport | null;
}

export type InvoiceStatus =
  | "draft"
  | "sent"
  | "partially_paid"
  | "paid"
  | "overdue"
  | "void";

export interface InvoiceLine {
  id: string;
  description: string;
  quantity: number;
  unitPriceMinor: Minor;
  taxRateId: string;
}

export interface InvoicePayment {
  /** Horizon operation ID or a locally minted manual-audit ID. */
  id: string;
  kind: "stellar" | "manual";
  network: NetworkKey;
  amountMinor: Minor;
  asset: AcceptedAsset | null;
  amount: StellarAmount | null;
  transactionHash: string | null;
  from: string | null;
  observedAt: number;
  /** Null for automatic Horizon reconciliation. */
  recordedById: string | null;
  recordedBy: string | null;
  note: string | null;
}

export interface Invoice {
  id: string;
  number: string;
  status: InvoiceStatus;
  customerName: string;
  /** Addresses a `mailto:` draft the OS composes. Nothing is sent from here. */
  customerEmail: string | null;
  /** The payer's address once one has paid, otherwise null. */
  customerAddress: string | null;
  reference: string;
  network: NetworkKey;
  /** Snapshotted at issue so a later settings change cannot redirect the document. */
  destination: string | null;
  /** Immutable issue-time prices. A remaining-balance request reuses their unit price. */
  quotes: ChargeQuote[];
  payments: InvoicePayment[];
  lines: InvoiceLine[];
  totals: OrderTotals;
  currency: FiatCurrency;
  issuedAt: number | null;
  dueAt: number | null;
  paidAt: number | null;
  paidMinor: Minor;
  note: string | null;
  createdAt: number;
  updatedAt: number;
  createdById: string;
  createdBy: string;
  issuedById: string | null;
  issuedBy: string | null;
  voidedAt: number | null;
  voidedById: string | null;
  voidedBy: string | null;
  voidReason: string | null;
}

export type CounterCodeKind = "fixed" | "open" | "tip";

/**
 * A reusable SEP-7 payment request the shop saves once and prints as a QR for
 * the counter — a tip jar, a fixed-price item, a donation. There is no URL and
 * no slug because nothing is served: the QR carries the request itself, so it
 * resolves in any wallet with no page behind it.
 *
 * `payments` and `takingsMinor` are totals Horizon gives back by filtering the
 * receiving account on `memoPrefix`. Scans are not here and cannot be: counting
 * a scan means serving the page that was scanned.
 */
export interface CounterCode {
  id: string;
  title: string;
  kind: CounterCodeKind;
  amountMinor: Minor | null;
  suggestedMinor: Minor[];
  currency: FiatCurrency;
  acceptedAssets: AcceptedAsset[];
  /** Prefix for the memo every payment against this code carries. */
  memoPrefix: string;
  /** Immutable human-readable SEP-7 message captured when the request is published. */
  requestMessage: string;
  /** Snapshotted publication network and destination; shared paper cannot be redirected later. */
  network: NetworkKey;
  destination: string;
  /** Fixed-price requests lock one quote per accepted asset. Open and tip codes keep this empty. */
  quotes: ChargeQuote[];
  /** Attributes a tip code to one staff member. */
  staffId: string | null;
  /**
   * Whether the shop still counts this code as current. It is a filing flag,
   * not a switch: a QR already printed and stuck to a table keeps resolving,
   * because there is no server in the path to revoke it. Retiring a code means
   * taking the paper down and no longer reconciling its memo.
   */
  active: boolean;
  payments: number;
  takingsMinor: Minor;
  /** Filing deadline only. A paper copy remains readable after this instant. */
  expiresAt: number | null;
  createdAt: number;
  updatedAt: number;
  createdById: string;
  createdBy: string;
}

/** One immutable Horizon payment attributed to a reusable counter code. */
export interface CounterPayment {
  /** Horizon payment operation id; also the deduplication key. */
  id: string;
  codeId: string;
  payment: MatchedPayment;
  /** Null when the payment could not be priced and still needs review. */
  amountMinor: Minor | null;
  /** Fixed-price codes retain the quote printed into their QR. */
  quote: ChargeQuote | null;
  seenAt: number;
}

export type LoyaltyEventKind = "opened" | "earned" | "redeemed";

export interface LoyaltyEvent {
  id: string;
  kind: LoyaltyEventKind;
  /** Visit source for an earned stamp; null for manual lifecycle actions. */
  sourceId: string | null;
  at: number;
  /** Automatic earning has no actor; opening and redemption retain one. */
  actorId: string | null;
  actorName: string | null;
}

export interface LoyaltyCard {
  /** Stamps collected toward the reward. */
  stamps: number;
  target: number;
  redeemedCount: number;
  /** Append-only local audit of card opening, automatic stamps, and redemption. */
  events: LoyaltyEvent[];
}

export interface CustomerRecord {
  /** Customers are keyed on the paying address — the only durable identifier. */
  address: string;
  /** Set when the address matches a wallet contact. */
  name: string | null;
  firstSeenAt: number;
  lastSeenAt: number;
  orderCount: number;
  lifetimeMinor: Minor;
  averageMinor: Minor;
  preferredAsset: AcceptedAsset;
  /** Immutable settlement sources already applied to this local summary. */
  sourceIds: string[];
  loyalty: LoyaltyCard | null;
  note: string | null;
}

export interface SettlementRule {
  /** Convert held assets to the settlement asset in batches, never on receipt. */
  autoConvert: boolean;
  maxSlippageBps: number;
  /** Move anything above this to the treasury account. */
  sweepAboveMinor: Minor | null;
  sweepDestination: string | null;
  /** Never sweep to zero: an account needs its reserve plus refund headroom. */
  retainedFloatMinor: Minor;
  /**
   * Hour of day the till offers the sweep, not one it performs. A sweep is an
   * outbound payment and needs the vault, so nothing can fire while the device
   * is locked or shut — this is a prompt at close of day, never a transfer.
   */
  sweepPromptHour: number | null;
}

/** On-ledger moves only: a path payment, or a send to the treasury account. */

export interface TaxPeriod {
  id: string;
  label: string;
  from: number;
  to: number;
  grossMinor: Minor;
  netMinor: Minor;
  taxByRate: Record<string, Minor>;
  refundsMinor: Minor;
  orderCount: number;
}

export interface ExportRecord {
  id: string;
  format: "csv" | "json" | "xero" | "saft";
  basis: "transaction" | "settlement";
  from: number;
  to: number;
  fileName: string;
  rangeLabel: string;
  rowCount: number;
  runById: string;
  runBy: string;
  runAt: number;
}

export type AdjustmentKind = "discount" | "comp" | "void";

/** Adjustment authorised on the live ticket, before its order number is committed. */
export interface PendingAdjustment {
  id: string;
  kind: AdjustmentKind;
  lineId: string | null;
  lineName: string | null;
  amountMinor: Minor;
  reasonCode: string;
  staffId: string;
  staffName: string;
  at: number;
}

/** Immutable audit record after the ticket becomes an order. */
export interface Adjustment extends PendingAdjustment {
  orderId: string;
  orderNumber: number;
}

export interface RefundRequest {
  id: string;
  orderId: string;
  orderNumber: number;
  amountMinor: Minor;
  reason: RefundReason;
  note: string | null;
  /** Present when approval is for a duplicate/ambiguous incoming payment. */
  sourcePaymentId: string | null;
  requestedById: string;
  requestedBy: string;
  requestedAt: number;
  status: "pending" | "approved" | "declined";
  reviewedById: string | null;
  reviewedAt: number | null;
  /** Present only after the explicitly signed refund has been persisted. */
  refundId: string | null;
}

export type PeripheralKind = "printer" | "drawer" | "scanner" | "display";

export interface Peripheral {
  id: string;
  kind: PeripheralKind;
  name: string;
  connected: boolean;
  detail: string;
  /** True when the design shows it but the platform cannot deliver it yet. */
  unavailable?: boolean;
}

export type TillTextSize = "standard" | "large" | "xlarge";

/** Everything Merchant Mode keeps on this device, versioned for migration. */
export interface MerchantStore {
  version: 2;
  /** Monotonic local revision used to reject stale writes from another tab. */
  revision: number;
  /** Per-tab identifier of the last successful writer. */
  writerId: string | null;
  /** Wall-clock time of the last coordinated write. */
  updatedAt: number;
  settings: MerchantSettings;
  catalogue: CatalogueItem[];
  modifierGroups: ModifierGroup[];
  orders: Order[];
  charges: Charge[];
  refunds: Refund[];
  unmatched: UnmatchedPayment[];
  paymentReconciliations: PaymentReconciliation[];
  staff: StaffMember[];
  activeStaffId: string | null;
  /** Staff currently rostered on this local till, independent of the selected operator. */
  onShiftStaffIds: string[];
  shifts: Shift[];
  invoices: Invoice[];
  counterCodes: CounterCode[];
  counterPayments: CounterPayment[];
  customers: CustomerRecord[];
  settlementRule: SettlementRule;
  adjustments: Adjustment[];
  refundRequests: RefundRequest[];
  peripherals: Peripheral[];
  exportRecords: ExportRecord[];
  terminal: TerminalDevice;
  tillTextSize: TillTextSize;
  /** Next order number to mint on this device. */
  nextOrderNumber: number;
  /** Next immutable Z-report sequence. */
  nextShiftNumber: number;
  /** Next human invoice sequence. */
  nextInvoiceNumber: number;
  /** Horizon paging token the payment watcher resumes from, per network. */
  cursors: Partial<Record<NetworkKey, string>>;
}
