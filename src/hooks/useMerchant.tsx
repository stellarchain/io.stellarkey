"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useWalletContacts,
  useWalletIdentity,
  useWalletLedger,
  useWalletMarket,
  useWalletPhase,
  useWalletSubmission,
  useWalletTransactions,
} from "./useWallet";
import { randomHex } from "@/lib/crypto";
import { getMerchantEncryptionKey, VaultLockedError } from "@/lib/vault";
import { fetchAssetPrices, getUnitPrice, type AssetPrices } from "@/lib/prices";
import {
  assetKey,
  chargePayUri,
  createCharge,
  isNative,
  liveCharges,
  quoteFor,
  sameAsset,
  type QuoteInput,
} from "@/lib/merchant/charge";
import { LIVE_MINUTE_MS, useLiveNow } from "./useLiveNow";
import type { ObservedPayment } from "@/lib/merchant/match";
import {
  fromStroops,
  assetAmountFor,
  lineGrossMinor,
  orderTotals,
  tipPresets,
  toStroops,
  unitPriceE6,
} from "@/lib/merchant/money";
import {
  isMerchantStorageError,
  MerchantStorageError,
} from "@/lib/merchant/commit";
import { prune as pruneMerchantStore } from "@/lib/merchant/storage";
import {
  getMerchantRepository,
  MerchantRepositoryConflictError,
} from "@/lib/merchant/repository";
import {
  claimWatcherLease,
  createMerchantWriterId,
  MerchantRevisionConflictError,
  newerMerchantStore,
  openMerchantRevisionChannel,
  prepareMerchantCommit,
  releaseWatcherLease,
  watcherLeaseKey,
  type MerchantRevisionChannel,
} from "@/lib/merchant/coordination";
import type { StorageIssue } from "@/lib/storage-load";
import {
  inspectStorageHealth,
  requestPersistentStorage as requestBrowserPersistentStorage,
  type StorageHealth,
} from "@/lib/storage-health";
import { emptyStore, TESTNET_DEMO_USD } from "@/lib/merchant/defaults";
import { createMerchantPinCredential, verifyMerchantPin } from "@/lib/merchant/pin";
import {
  completeMerchantSetup,
  needsMerchantSetup,
  type MerchantSetupInput,
} from "@/lib/merchant/setup";
import {
  availableRefundMinor,
  recordRefundSubmission,
  reconcileRefundSubmission,
  refundReservesFunds,
  settledOrderPaymentSource,
} from "@/lib/merchant/refunds";
import {
  addStaffMember,
  assertCanReviewRefundRequest,
  canReleaseRefund,
  createPaymentRefundRequest,
  createRefundRequest,
  decideRefundRequest,
  nextPinAttempt,
  updateStaffMember,
  type PinAttemptState,
} from "@/lib/merchant/permissions";
import {
  activateVerifiedOperator,
  applyCompletedSalePolicy,
  applyOperatorSalePolicy,
  endOperatorShift,
  lockOperator,
  operatorTimeoutMs,
} from "@/lib/merchant/operators";
import {
  applyTicketAdjustment,
  awaitNewOrder,
  buildOrder,
  cardTender,
  cashTender,
  settleNewOrder,
  voidNewOrder,
} from "@/lib/merchant/orders";
import {
  attachReconciledPayment,
  dismissReconciledPayment,
  markReconciledRefund,
  reconcileIncomingPayments,
} from "@/lib/merchant/reconciliation";
import {
  activeShiftForTerminal,
  buildShiftReport,
  closeShift as closePersistedShift,
  openShift as openPersistedShift,
  unresolvedShiftFlows,
} from "@/lib/merchant/shifts";
import {
  createInvoiceDraft as createPersistedInvoiceDraft,
  duplicateInvoice as duplicatePersistedInvoice,
  invoicePayUri,
  issueInvoice as issuePersistedInvoice,
  reconcileInvoicePayments,
  recordManualInvoicePayment as recordPersistedManualInvoicePayment,
  updateInvoiceDraft as updatePersistedInvoiceDraft,
  voidInvoice as voidPersistedInvoice,
} from "@/lib/merchant/invoices";
import {
  buildCounterCodePayUri,
  counterCodePayUri,
  createCounterCode as createPersistedCounterCode,
  reconcileCounterPayments,
  setCounterCodeActive as setPersistedCounterCodeActive,
  updateCounterCode as updatePersistedCounterCode,
} from "@/lib/merchant/counter-codes";
import {
  customerHistory as buildCustomerHistory,
  forgetCustomer as forgetPersistedCustomer,
  reconcileCustomerSettlements,
  redeemLoyaltyReward as redeemPersistedLoyaltyReward,
  startLoyaltyCard as startPersistedLoyaltyCard,
  syncCustomerContacts,
  updateCustomerNote as updatePersistedCustomerNote,
  type CustomerHistoryEntry,
} from "@/lib/merchant/customers";
import {
  buildReportFile,
  createReportExport as createPersistedReportExport,
  deriveTaxPeriods,
  type ReportBasis,
  type ReportFile,
  type ReportFormat,
} from "@/lib/merchant/reporting";
import {
  deriveSettlementHandoffs,
  updateSettlementRule as updatePersistedSettlementRule,
  type SettlementHandoffs,
} from "@/lib/merchant/settlement";
import { BROWSER_PERIPHERALS, merchantRuntimeState } from "@/lib/merchant/runtime";
import {
  expireAwaitingCharges,
  indexMerchantRecords,
  nextAwaitingChargeExpiry,
} from "@/lib/merchant/selectors";
import {
  fetchIncomingPayments,
  merchantCursorKey,
  merchantWatchDestinations,
} from "@/lib/merchant/watch";
import { HorizonRequestError } from "@/lib/horizon";
import { writeMerchantBootstrapState } from "@/lib/merchant/bootstrap";
import {
  MerchantRuntimeDataProviders,
  type MerchantSettingsContextValue,
  type MerchantShellContextValue,
} from "./useMerchantRuntime";
import type {
  AcceptedAsset,
  Adjustment,
  AdjustmentKind,
  CatalogueItem,
  Charge,
  CounterCode,
  CounterCodeKind,
  CounterPayment,
  CustomerRecord,
  ExportRecord,
  Invoice,
  InvoiceLine,
  MerchantSettings,
  MerchantStore,
  Minor,
  ModifierGroup,
  Order,
  OrderLine,
  OrderLineModifier,
  OrderTotals,
  PendingAdjustment,
  PaymentReconciliation,
  Peripheral,
  Refund,
  RefundReason,
  RefundRequest,
  Shift,
  ShiftReport,
  SettlementRule,
  StaffMember,
  StaffRole,
  TaxPeriod,
  TerminalDevice,
  TenderKind,
  TenderPart,
  UnmatchedPayment,
} from "@/lib/merchant/types";

/** The ticket being rung up. It only becomes an Order when it is charged. */
export interface Ticket {
  lines: OrderLine[];
  discountMinor: Minor;
  tipMinor: Minor;
  /** Authorised drafts become immutable Adjustment records with the order. */
  adjustments: PendingAdjustment[];
}

export interface MerchantSplitTenderInput {
  firstKind: TenderKind;
  secondKind: TenderKind;
  firstMinor: Minor;
  /** Optional reference printed by an external card terminal. */
  cardReference?: string;
}

export interface MerchantTenderOutcome {
  order: Order;
  /** Present only while a Stellar leg still needs to settle. */
  charge: Charge | null;
}

export interface MerchantCounterCodeDraft {
  title: string;
  kind: CounterCodeKind;
  amountMinor: Minor | null;
  suggestedMinor: Minor[];
  acceptedAssets: AcceptedAsset[];
  memoPrefix: string;
  staffId: string | null;
  expiresAt: number | null;
  active: boolean;
}

export interface TodaySummary {
  takingsMinor: Minor;
  orderCount: number;
  avgTicketMinor: Minor;
  tipsMinor: Minor;
  taxMinor: Minor;
  refundedMinor: Minor;
  byHour: { hour: number; orders: number; takingsMinor: Minor }[];
  topItems: { name: string; units: number; revenueMinor: Minor }[];
  assetMix: { asset: AcceptedAsset; takingsMinor: Minor; share: number }[];
}

export type MerchantRefundOutcome =
  | { kind: "refunded"; refund: Refund }
  | { kind: "requested"; request: RefundRequest };

interface MerchantContextValue {
  ready: boolean;
  storageIssue: StorageIssue | null;
  storageError: string | null;
  storageHealth: StorageHealth | null;
  requestPersistentStorage: () => Promise<boolean>;
  exportEncryptedArchive: () => Promise<string | null>;
  exportRecoveryData: () => string | null;
  resetRecoveryData: () => Promise<void>;
  online: boolean;
  enabled: boolean;
  configured: boolean;
  setEnabled: (on: boolean) => Promise<void>;
  settings: MerchantSettings;
  tillTextSize: MerchantStore["tillTextSize"];
  setTillTextSize: (size: MerchantStore["tillTextSize"]) => Promise<void>;
  updateSettings: (patch: Partial<MerchantSettings>) => Promise<void>;
  completeSetup: (
    input: Omit<MerchantSetupInput, "pinDigest"> & { pin: string },
  ) => Promise<void>;

  staff: StaffMember[];
  activeStaff: StaffMember | null;
  onShiftStaff: StaffMember[];
  terminal: TerminalDevice;
  refundRequests: RefundRequest[];
  switchStaff: (memberId: string, pin: string) => Promise<void>;
  lockStaffSession: () => Promise<void>;
  endStaffSession: (memberId: string) => Promise<void>;
  unlockCustomerDisplay: (pin: string) => Promise<StaffMember>;
  addStaff: (input: { name: string; role: StaffRole; pin: string }) => Promise<void>;
  updateStaff: (
    memberId: string,
    patch: Partial<Pick<StaffMember, "name" | "role" | "permissions" | "active">>,
  ) => Promise<void>;
  resetStaffPin: (memberId: string, pin: string) => Promise<void>;

  catalogue: CatalogueItem[];
  modifierGroups: ModifierGroup[];
  upsertItem: (item: CatalogueItem) => Promise<void>;
  removeItem: (id: string) => Promise<void>;

  ticket: Ticket;
  ticketTotals: OrderTotals;
  tipOptions: { label: string; amountMinor: Minor }[];
  addItemToTicket: (item: CatalogueItem, modifiers?: OrderLineModifier[], quantity?: number) => void;
  addCustomAmount: (amountMinor: Minor, label?: string) => void;
  setLineQuantity: (lineId: string, quantity: number) => void;
  removeLine: (lineId: string) => void;
  clearTicket: () => void;

  settleCash: (receivedMinor: Minor) => Promise<Order>;
  settleCard: (externalReference?: string) => Promise<Order>;
  startSplitCharge: (input: MerchantSplitTenderInput) => Promise<MerchantTenderOutcome>;
  applyAdjustment: (input: {
    lineId: string | null;
    amountMinor: Minor;
    reasonCode: string;
  }) => Promise<Order | null>;
  voidLine: (lineId: string | null, reasonCode: string) => Promise<Order | null>;
  compLine: (lineId: string | null, reasonCode: string) => Promise<Order | null>;

  orders: Order[];
  charges: Charge[];
  refunds: Refund[];
  unmatched: UnmatchedPayment[];
  paymentReconciliations: PaymentReconciliation[];
  adjustments: Adjustment[];
  peripherals: Peripheral[];
  nextOrderNumber: number;

  invoices: Invoice[];
  nextInvoiceNumber: number;
  invoiceBlockedReason: string | null;
  createInvoiceDraft: (input: {
    customerName: string;
    customerEmail?: string | null;
    lines: InvoiceLine[];
    dueAt?: number | null;
    note?: string | null;
  }) => Promise<Invoice>;
  updateInvoiceDraft: (input: {
    invoiceId: string;
    customerName: string;
    customerEmail?: string | null;
    lines: InvoiceLine[];
    dueAt?: number | null;
    note?: string | null;
  }) => Promise<Invoice>;
  issueInvoice: (invoiceId: string) => Promise<Invoice>;
  recordManualInvoicePayment: (input: {
    invoiceId: string;
    amountMinor: Minor;
    note?: string | null;
  }) => Promise<Invoice>;
  voidInvoice: (invoiceId: string, reason: string) => Promise<Invoice>;
  duplicateInvoice: (invoiceId: string) => Promise<Invoice>;
  invoicePayUriFor: (invoice: Invoice, asset: AcceptedAsset) => string | null;

  counterCodes: CounterCode[];
  counterPayments: CounterPayment[];
  counterCodeBlockedReason: string | null;
  createCounterCode: (input: MerchantCounterCodeDraft) => Promise<CounterCode>;
  updateCounterCode: (input: {
    codeId: string;
    title: string;
    suggestedMinor: Minor[];
    staffId: string | null;
    expiresAt: number | null;
    active: boolean;
  }) => Promise<CounterCode>;
  setCounterCodeActive: (codeId: string, active: boolean) => Promise<CounterCode>;
  counterCodePayUriFor: (code: CounterCode, asset: AcceptedAsset) => string | null;
  counterCodePreviewUri: (input: {
    kind: CounterCodeKind;
    amountMinor: Minor | null;
    asset: AcceptedAsset;
    memo: string;
    title: string;
  }) => string | null;

  customers: CustomerRecord[];
  customerHistory: (address: string) => CustomerHistoryEntry[];
  updateCustomerNote: (address: string, note: string) => Promise<CustomerRecord>;
  startLoyaltyCard: (address: string, target?: number) => Promise<CustomerRecord>;
  redeemLoyaltyReward: (address: string) => Promise<CustomerRecord>;
  forgetCustomer: (address: string) => Promise<void>;

  taxPeriods: TaxPeriod[];
  exportRecords: ExportRecord[];
  previewReportExport: (input: {
    from: number;
    to: number;
    basis: ReportBasis;
    format: ReportFormat;
  }) => ReportFile;
  createReportExport: (input: {
    from: number;
    to: number;
    basis: ReportBasis;
    format: ReportFormat;
  }) => Promise<{ file: ReportFile; record: ExportRecord }>;

  settlementRule: SettlementRule;
  settlementHandoffs: SettlementHandoffs;
  updateSettlementRule: (patch: Partial<SettlementRule>) => Promise<void>;

  shifts: Shift[];
  activeShift: Shift | null;
  shiftReport: ShiftReport | null;
  shiftBlockers: ReturnType<typeof unresolvedShiftFlows>;
  paymentBlockedReason: string | null;
  openShift: (floatMinor: Minor) => Promise<Shift>;
  closeShift: (countedMinor: Minor) => Promise<ShiftReport>;

  /** Assets that both the shop accepts and the app can price right now. */
  quotableAssets: AcceptedAsset[];
  /** Why a charge cannot be raised, or null when it can. */
  chargeBlockedReason: string | null;

  activeCharge: Charge | null;
  openCharge: (id: string) => void;
  createChargeFromTicket: (tipMinor?: Minor) => Promise<Charge>;
  voidCharge: (id: string) => Promise<void>;
  closeCharge: () => void;
  payUriFor: (charge: Charge, asset: AcceptedAsset) => string | null;
  /** File a tray payment against an order by hand. */
  attachPayment: (paymentId: string, chargeId: string) => Promise<void>;
  dismissUnmatched: (paymentId: string) => Promise<void>;

  refundOrder: (params: {
    orderId: string;
    amountMinor: Minor;
    reason: RefundReason;
    note?: string;
  }) => Promise<Refund>;
  submitRefund: (params: {
    orderId: string;
    amountMinor: Minor;
    reason: RefundReason;
    note?: string;
  }) => Promise<MerchantRefundOutcome>;
  submitPaymentRefund: (paymentId: string, note?: string) => Promise<MerchantRefundOutcome>;
  approveRefundRequest: (requestId: string) => Promise<Refund>;
  declineRefundRequest: (requestId: string) => Promise<void>;

  watching: boolean;
  watchedLedger: number | null;
  watchError: string | null;
  queuedChargeCount: number;
  expiredChargeCount: number;
  pollNow: () => Promise<void>;

  today: TodaySummary;
  orderFor: (chargeId: string) => Order | null;
}

const MerchantContext = createContext<MerchantContextValue | null>(null);

type MerchantStatusValue = Pick<
  MerchantContextValue,
  | "ready"
  | "storageIssue"
  | "storageError"
  | "storageHealth"
  | "requestPersistentStorage"
  | "exportEncryptedArchive"
  | "exportRecoveryData"
  | "resetRecoveryData"
  | "online"
  | "enabled"
  | "configured"
  | "setEnabled"
  | "completeSetup"
  | "quotableAssets"
  | "chargeBlockedReason"
  | "watching"
  | "watchedLedger"
  | "watchError"
  | "queuedChargeCount"
  | "expiredChargeCount"
  | "pollNow"
>;

type MerchantConfigurationValue = Pick<
  MerchantContextValue,
  | "settings"
  | "tillTextSize"
  | "setTillTextSize"
  | "updateSettings"
  | "peripherals"
  | "settlementRule"
  | "settlementHandoffs"
  | "updateSettlementRule"
>;

type MerchantStaffValue = Pick<
  MerchantContextValue,
  | "staff"
  | "activeStaff"
  | "onShiftStaff"
  | "terminal"
  | "refundRequests"
  | "switchStaff"
  | "lockStaffSession"
  | "endStaffSession"
  | "unlockCustomerDisplay"
  | "addStaff"
  | "updateStaff"
  | "resetStaffPin"
  | "approveRefundRequest"
  | "declineRefundRequest"
>;

type MerchantTillValue = Pick<
  MerchantContextValue,
  | "catalogue"
  | "modifierGroups"
  | "upsertItem"
  | "removeItem"
  | "ticket"
  | "ticketTotals"
  | "tipOptions"
  | "addItemToTicket"
  | "addCustomAmount"
  | "setLineQuantity"
  | "removeLine"
  | "clearTicket"
  | "settleCash"
  | "settleCard"
  | "startSplitCharge"
  | "applyAdjustment"
  | "voidLine"
  | "compLine"
  | "nextOrderNumber"
  | "shifts"
  | "activeShift"
  | "shiftReport"
  | "shiftBlockers"
  | "paymentBlockedReason"
  | "openShift"
  | "closeShift"
  | "createChargeFromTicket"
>;

type MerchantRecordsValue = Pick<
  MerchantContextValue,
  | "orders"
  | "charges"
  | "refunds"
  | "unmatched"
  | "paymentReconciliations"
  | "adjustments"
  | "invoices"
  | "nextInvoiceNumber"
  | "invoiceBlockedReason"
  | "createInvoiceDraft"
  | "updateInvoiceDraft"
  | "issueInvoice"
  | "recordManualInvoicePayment"
  | "voidInvoice"
  | "duplicateInvoice"
  | "invoicePayUriFor"
  | "counterCodes"
  | "counterPayments"
  | "counterCodeBlockedReason"
  | "createCounterCode"
  | "updateCounterCode"
  | "setCounterCodeActive"
  | "counterCodePayUriFor"
  | "counterCodePreviewUri"
  | "customers"
  | "customerHistory"
  | "updateCustomerNote"
  | "startLoyaltyCard"
  | "redeemLoyaltyReward"
  | "forgetCustomer"
  | "activeCharge"
  | "openCharge"
  | "voidCharge"
  | "closeCharge"
  | "payUriFor"
  | "attachPayment"
  | "dismissUnmatched"
  | "refundOrder"
  | "submitRefund"
  | "submitPaymentRefund"
  | "orderFor"
>;

type MerchantReportingValue = Pick<
  MerchantContextValue,
  | "today"
  | "taxPeriods"
  | "exportRecords"
  | "previewReportExport"
  | "createReportExport"
>;

const MerchantStatusContext = createContext<MerchantStatusValue | null>(null);
const MerchantConfigurationContext = createContext<MerchantConfigurationValue | null>(null);
const MerchantStaffContext = createContext<MerchantStaffValue | null>(null);
const MerchantTillContext = createContext<MerchantTillValue | null>(null);
const MerchantRecordsContext = createContext<MerchantRecordsValue | null>(null);
const MerchantReportingContext = createContext<MerchantReportingValue | null>(null);

/** How often the till asks Horizon while a charge is open, and while it is not. */
const POLL_ACTIVE_MS = 4_000;
const POLL_IDLE_MS = 30_000;
const WATCHER_LEASE_MS = 25_000;

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomHex(12)}`;
}

/** Local midnight of the calendar day `at` falls in. */
function startOfDay(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfToday(now = Date.now()): number {
  return startOfDay(now);
}

export function MerchantProvider({
  children,
  enableOnReady = false,
}: {
  children: React.ReactNode;
  enableOnReady?: boolean;
}) {
  const { phase } = useWalletPhase();
  const { network, activeAccount } = useWalletIdentity();
  const { balances, minimumBalanceXlm, recommendedBaseFeeStroops } = useWalletLedger();
  const { xlmPriceUsd, fiatRates } = useWalletMarket();
  const { contacts } = useWalletContacts();
  const { send } = useWalletTransactions();
  const { submissionStatus } = useWalletSubmission();

  const [store, setStore] = useState<MerchantStore>(() => emptyStore());
  const [ready, setReady] = useState(false);
  const [storageIssue, setStorageIssue] = useState<StorageIssue | null>(null);
  const storageIssueRef = useRef<StorageIssue | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [storageHealth, setStorageHealth] = useState<StorageHealth | null>(null);
  const [ticket, setTicket] = useState<Ticket>({
    lines: [],
    discountMinor: 0,
    tipMinor: 0,
    adjustments: [],
  });
  const [activeChargeId, setActiveChargeId] = useState<string | null>(null);
  const [assetPrices, setAssetPrices] = useState<AssetPrices>({});
  const [watchedLedger, setWatchedLedger] = useState<number | null>(null);
  const [watchError, setWatchError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [foreground, setForeground] = useState(true);
  const [staffSessionId, setStaffSessionId] = useState<string | null>(null);
  const reportingNow = useLiveNow(LIVE_MINUTE_MS);
  const storeRef = useRef(store);
  const staffSessionIdRef = useRef<string | null>(null);
  const [writerId] = useState(createMerchantWriterId);
  const merchantWriterLockRef = useRef<"pending" | "held" | "fallback">("pending");
  const enableAttemptedRef = useRef(false);
  const revisionChannelRef = useRef<MerchantRevisionChannel | null>(null);
  const pinAttempts = useRef(new Map<string, PinAttemptState>());
  const polling = useRef(false);
  const pollRef = useRef<() => Promise<void>>(async () => {});
  const repositoryRef = useRef(getMerchantRepository());
  const commitQueueRef = useRef<Promise<void>>(Promise.resolve());

  const updateStaffSessionId = useCallback((memberId: string | null) => {
    staffSessionIdRef.current = memberId;
    setStaffSessionId(memberId);
  }, []);

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  const installLoadedStore = useCallback((next: MerchantStore) => {
    // Persisted revisions never carry proof that this tab verified a PIN.
    updateStaffSessionId(null);
    storageIssueRef.current = null;
    setStorageIssue(null);
    setStorageError(null);
    storeRef.current = next;
    setStore(next);
  }, [updateStaffSessionId]);

  const readMerchantKey = useCallback(() => {
    try {
      return getMerchantEncryptionKey();
    } catch (error) {
      if (error instanceof VaultLockedError) throw new MerchantStorageError("vault_locked");
      throw error;
    }
  }, []);

  const reloadExternalStore = useCallback(
    async (allowAbsent: boolean) => {
      let key: Uint8Array;
      try {
        key = readMerchantKey();
      } catch (error) {
        if (isMerchantStorageError(error) && error.code === "vault_locked") return;
        throw error;
      }
      let result;
      try {
        result = await repositoryRef.current.load(key);
      } catch (error) {
        setStorageError(
          error instanceof Error
            ? error.message
            : "Merchant storage could not be opened on this device.",
        );
        return;
      } finally {
        key.fill(0);
      }
      if (result.kind === "ready") {
        const newer = newerMerchantStore(storeRef.current, result.value);
        if (newer) installLoadedStore(newer);
        return;
      }
      if (result.kind === "absent") {
        if (allowAbsent) installLoadedStore(emptyStore());
        return;
      }
      storageIssueRef.current = result;
      setStorageIssue(result);
    },
    [installLoadedStore, readMerchantKey],
  );

  // Deferred the way the wallet bootstraps its own vault: localStorage is not
  // available while the page is server-rendered, and the first client render has
  // to match the server's.
  useEffect(() => {
    let alive = true;
    void (async () => {
      await Promise.resolve();
      if (!alive) return;
      if (phase !== "unlocked") {
        const fresh = emptyStore();
        storeRef.current = fresh;
        setStore(fresh);
        updateStaffSessionId(null);
        setReady(false);
        return;
      }
      let key: Uint8Array;
      try {
        key = readMerchantKey();
      } catch (error) {
        if (isMerchantStorageError(error) && error.code === "vault_locked") {
          if (alive) setReady(false);
          return;
        }
        throw error;
      }
      let result;
      try {
        result = await repositoryRef.current.load(key);
      } catch (error) {
        if (alive) {
          setStorageError(
            error instanceof Error
              ? error.message
              : "Merchant storage could not be opened on this device.",
          );
          setReady(true);
        }
        return;
      } finally {
        key.fill(0);
      }
      if (!alive) return;
      const issue = result.kind === "corrupt" || result.kind === "future" ? result : null;
      const loaded = result.kind === "ready" ? result.value : emptyStore();
      if (issue) {
        storageIssueRef.current = issue;
        setStorageIssue(issue);
      } else {
        installLoadedStore(loaded);
      }
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [installLoadedStore, phase, readMerchantKey, updateStaffSessionId]);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    void inspectStorageHealth().then((health) => {
      if (alive) setStorageHealth(health);
    });
    return () => {
      alive = false;
    };
  }, [ready, store.revision]);

  const requestPersistentStorage = useCallback(async (): Promise<boolean> => {
    const granted = await requestBrowserPersistentStorage();
    setStorageHealth(await inspectStorageHealth());
    return granted;
  }, []);

  useEffect(() => {
    if (!ready || phase !== "unlocked") {
      merchantWriterLockRef.current = "pending";
      return;
    }
    if (!("locks" in navigator) || !navigator.locks) {
      merchantWriterLockRef.current = "fallback";
      return;
    }

    const controller = new AbortController();
    let releaseLock: (() => void) | null = null;
    merchantWriterLockRef.current = "pending";
    void navigator.locks.request(
      "stellarkey.merchant.writer.v1",
      { mode: "exclusive", signal: controller.signal },
      async () => {
        if (controller.signal.aborted) return;
        merchantWriterLockRef.current = "held";
        setStorageError(null);
        await new Promise<void>((resolve) => {
          releaseLock = resolve;
        });
      },
    ).catch(() => {
      if (!controller.signal.aborted) merchantWriterLockRef.current = "fallback";
    });

    return () => {
      controller.abort();
      releaseLock?.();
      merchantWriterLockRef.current = "pending";
    };
  }, [phase, ready]);

  useEffect(() => {
    if (!ready) return;
    const onRevision = () => void reloadExternalStore(true);
    const channel = openMerchantRevisionChannel(onRevision);
    revisionChannelRef.current = channel;
    return () => {
      revisionChannelRef.current = null;
      channel.close();
    };
  }, [ready, reloadExternalStore]);

  const commitStore = useCallback(
    (update: MerchantStore | ((current: MerchantStore) => MerchantStore)): Promise<void> => {
      const requestedRevision = storeRef.current.revision;
      const operation = commitQueueRef.current.then(async () => {
        if (
          merchantWriterLockRef.current === "pending" &&
          "locks" in navigator &&
          navigator.locks
        ) {
          throw new MerchantStorageError("writer_unavailable");
        }
        if (merchantWriterLockRef.current === "pending") {
          merchantWriterLockRef.current = "fallback";
        }
        const current = storeRef.current;
        if (typeof update !== "function" && current.revision !== requestedRevision) {
          throw new MerchantStorageError("conflict");
        }
        if (storageIssueRef.current) {
          throw new MerchantStorageError("recovery_required");
        }
        const key = readMerchantKey();
        try {
          let persistedResult;
          try {
            persistedResult = await repositoryRef.current.loadCommitBasis(key);
          } catch {
            throw new MerchantStorageError("write_failed");
          }
          if (persistedResult.kind === "corrupt" || persistedResult.kind === "future") {
            storageIssueRef.current = persistedResult;
            setStorageIssue(persistedResult);
            throw new MerchantStorageError("recovery_required");
          }
          const updated = typeof update === "function" ? update(current) : update;
          if (updated === current) return;
          const candidate = pruneMerchantStore(updated);
          let coordinated: MerchantStore;
          try {
            coordinated = prepareMerchantCommit({
              current,
              candidate,
              persisted: persistedResult.kind === "ready" ? persistedResult.value : null,
              writerId,
            });
          } catch (error) {
            if (!(error instanceof MerchantRevisionConflictError)) throw error;
            if (persistedResult.kind === "ready") {
              const newer = newerMerchantStore(current, persistedResult.value);
              if (newer) installLoadedStore(newer);
            } else if (current.revision > 0) {
              installLoadedStore(emptyStore());
            }
            throw new MerchantStorageError("conflict");
          }
          let committed: MerchantStore;
          try {
            committed = await repositoryRef.current.commit(
              coordinated,
              key,
              persistedResult.kind === "ready" ? persistedResult.value.revision : null,
            );
          } catch (error) {
            if (error instanceof MerchantRepositoryConflictError) {
              await reloadExternalStore(false);
              throw new MerchantStorageError("conflict");
            }
            throw new MerchantStorageError("write_failed");
          }
          storeRef.current = committed;
          setStore(committed);
          // Publish the non-sensitive runtime hint in the same successful
          // handoff as the encrypted commit. Waiting for React's effect here
          // can briefly unmount the lazy provider after first-time setup,
          // before the enabled state reaches the boundary.
          if (phase === "unlocked") {
            writeMerchantBootstrapState({
              enabled: committed.settings.enabled,
              configured: !needsMerchantSetup(committed.settings, committed.staff),
            });
          }
          revisionChannelRef.current?.postRevision(committed);
          setStorageError(null);
        } finally {
          key.fill(0);
        }
      }).catch((error: unknown) => {
        if (isMerchantStorageError(error)) setStorageError(error.message);
        throw error;
      });
      commitQueueRef.current = operation.catch(() => {});
      return operation;
    },
    [installLoadedStore, phase, readMerchantKey, reloadExternalStore, writerId],
  );

  const persist = useCallback(
    async (update: MerchantStore | ((current: MerchantStore) => MerchantStore)) => {
      try {
        await commitStore(update);
      } catch (error) {
        if (!isMerchantStorageError(error)) throw error;
      }
    },
    [commitStore],
  );

  const exportRecoveryData = useCallback(() => storageIssueRef.current?.raw ?? null, []);
  const exportEncryptedArchive = useCallback(async () => {
    const key = readMerchantKey();
    try {
      return await repositoryRef.current.exportEncryptedArchive(key);
    } finally {
      key.fill(0);
    }
  }, [readMerchantKey]);
  const resetRecoveryData = useCallback(async () => {
    try {
      await repositoryRef.current.clear();
    } catch (error) {
      setStorageError(
        error instanceof Error ? error.message : "Merchant recovery data could not be erased.",
      );
      return;
    }
    const fresh = emptyStore();
    storageIssueRef.current = null;
    setStorageIssue(null);
    setStorageError(null);
    storeRef.current = fresh;
    setStore(fresh);
    revisionChannelRef.current?.postRevision(fresh);
  }, []);

  // The wallet owns canonical-hash tracking. Merchant state mirrors a final
  // resolution so an ambiguous outbound refund is never presented as complete.
  useEffect(() => {
    if (!ready) return;
    const current = storeRef.current;
    let next = current;
    for (const refund of current.refunds) {
      if (
        !refund.transactionHash ||
        (refund.submissionStatus !== "prepared" &&
          refund.submissionStatus !== "accepted" &&
          refund.submissionStatus !== "status_unknown")
      ) {
        continue;
      }
      const resolved = submissionStatus({
        hash: refund.transactionHash,
        network: refund.network,
        status: refund.submissionStatus === "prepared"
          ? "status_unknown"
          : refund.submissionStatus,
      });
      if (resolved !== refund.submissionStatus) {
        next = reconcileRefundSubmission(next, refund.id, resolved);
      }
    }
    if (next === current) return;
    void persist(next);
  }, [persist, ready, store.refunds, submissionStatus]);

  const settings = store.settings;
  const enabled = settings.enabled;
  const configured = !needsMerchantSetup(settings, store.staff);
  const setEnabled = useCallback(
    (on: boolean) =>
      commitStore((prev) =>
        on && needsMerchantSetup(prev.settings, prev.staff)
          ? prev
          : { ...prev, settings: { ...prev.settings, enabled: on } },
      ),
    [commitStore],
  );

  // This sidecar contains no merchant content. It lets a disabled wallet avoid
  // loading this operational provider on its next unlock; the encrypted store
  // above remains the source of truth whenever the hint is absent or invalid.
  useEffect(() => {
    if (!ready || phase !== "unlocked") return;
    writeMerchantBootstrapState({ enabled, configured });
  }, [configured, enabled, phase, ready]);

  // A configured disabled store can be enabled from the thin Settings shell.
  // Web Locks may still be transferring on the first frame, so retry only that
  // precise transient condition and leave all other storage failures visible.
  useEffect(() => {
    if (!enableOnReady) {
      enableAttemptedRef.current = false;
      return;
    }
    if (!ready || !configured || enabled || enableAttemptedRef.current) return;
    enableAttemptedRef.current = true;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const enable = async (attemptsLeft: number) => {
      try {
        await setEnabled(true);
      } catch (error) {
        if (
          !cancelled &&
          attemptsLeft > 0 &&
          isMerchantStorageError(error) &&
          error.code === "writer_unavailable"
        ) {
          timer = setTimeout(() => void enable(attemptsLeft - 1), 50);
        }
      }
    };
    void enable(20);
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [configured, enableOnReady, enabled, ready, setEnabled]);

  const completeSetup = useCallback(
    async (input: Omit<MerchantSetupInput, "pinDigest"> & { pin: string }) => {
      const { pin, ...details } = input;
      const pinDigest = await createMerchantPinCredential(pin);
      const now = Date.now();
      const next = completeMerchantSetup(
        storeRef.current,
        { ...details, pinDigest },
        { now, ownerId: uid("staff") },
      );
      await commitStore(next);
      updateStaffSessionId(next.activeStaffId);
    },
    [commitStore, updateStaffSessionId],
  );

  const activeStaff = useMemo(
    () =>
      staffSessionId === store.activeStaffId
        ? store.staff.find((member) => member.id === staffSessionId && member.active) ?? null
        : null,
    [staffSessionId, store.activeStaffId, store.staff],
  );

  const onShiftStaff = useMemo(() => {
    const roster = new Set(store.onShiftStaffIds);
    return store.staff.filter((member) => member.active && roster.has(member.id));
  }, [store.onShiftStaffIds, store.staff]);

  const taxPeriods = useMemo(
    () => deriveTaxPeriods(store, { network, now: reportingNow }),
    [network, reportingNow, store],
  );

  const previewReportExport = useCallback(
    (input: {
      from: number;
      to: number;
      basis: ReportBasis;
      format: ReportFormat;
    }): ReportFile => {
      const current = storeRef.current;
      const actor = current.staff.find(
        (member) =>
          member.id === staffSessionId &&
          member.id === current.activeStaffId &&
          member.active &&
          member.permissions.seeReports,
      );
      if (!actor) throw new Error("This staff member cannot view merchant reports.");
      return buildReportFile(current, { ...input, network });
    },
    [network, staffSessionId],
  );

  const createReportExport = useCallback(
    async (input: {
      from: number;
      to: number;
      basis: ReportBasis;
      format: ReportFormat;
    }): Promise<{ file: ReportFile; record: ExportRecord }> => {
      const current = storeRef.current;
      const actor = current.staff.find(
        (member) => member.id === staffSessionId && member.id === current.activeStaffId,
      );
      if (!actor) throw new Error("Choose an active staff member before exporting records.");
      const created = createPersistedReportExport(current, {
        ...input,
        id: uid("export"),
        actor,
        network,
        now: Date.now(),
      });
      await commitStore(created.store);
      return { file: created.file, record: created.record };
    },
    [commitStore, network, staffSessionId],
  );

  const updateSettlementRule = useCallback(
    async (patch: Partial<SettlementRule>): Promise<void> => {
      await commitStore(updatePersistedSettlementRule(storeRef.current, patch));
    },
    [commitStore],
  );

  useEffect(() => {
    if (!ready) return;
    const current = storeRef.current;
    const next = syncCustomerContacts(current, contacts);
    if (next !== current) void persist(next);
  }, [contacts, persist, ready]);

  const activeShift = useMemo(
    () => activeShiftForTerminal(store),
    [store],
  );

  const shiftReport = useMemo(
    () => (activeShift ? buildShiftReport(store, activeShift.id) : null),
    [activeShift, store],
  );

  const shiftBlockers = useMemo(
    () =>
      activeShift
        ? [
            ...unresolvedShiftFlows(store, activeShift.id),
            ...(ticket.lines.length > 0
              ? [{ kind: "order" as const, id: "draft-ticket", label: "The current ticket has not been settled or cleared." }]
              : []),
          ]
        : [],
    [activeShift, store, ticket.lines.length],
  );

  const openShift = useCallback(async (floatMinor: Minor): Promise<Shift> => {
    const current = storeRef.current;
    const actor = current.staff.find(
      (member) =>
        member.id === staffSessionId &&
        member.id === current.activeStaffId &&
        member.active,
    );
    if (!actor) throw new Error("Choose an active staff member before opening a shift.");
    const opened = openPersistedShift(current, {
      id: uid("shift"),
      actor,
      terminalName: current.settings.terminalName,
      network,
      floatMinor,
      now: Date.now(),
    });
    await commitStore(opened.store);
    return opened.shift;
  }, [commitStore, network, staffSessionId]);

  const closeShift = useCallback(async (countedMinor: Minor): Promise<ShiftReport> => {
    const current = storeRef.current;
    const actor = current.staff.find(
      (member) =>
        member.id === staffSessionId &&
        member.id === current.activeStaffId &&
        member.active,
    );
    if (!actor) throw new Error("Choose an active staff member before closing a shift.");
    if (ticket.lines.length > 0) {
      throw new Error("Clear or settle the current ticket before closing this shift.");
    }
    const shift = activeShiftForTerminal(current);
    if (!shift) throw new Error("Open a shift before counting the drawer.");
    const closed = closePersistedShift(current, {
      shiftId: shift.id,
      actor,
      countedMinor,
      now: Date.now(),
    });
    await commitStore(closed.store);
    return closed.report;
  }, [commitStore, staffSessionId, ticket.lines.length]);

  const switchStaff = useCallback(async (memberId: string, pin: string): Promise<void> => {
    const current = storeRef.current;
    const member = current.staff.find((entry) => entry.id === memberId && entry.active);
    if (!member?.pinDigest) throw new Error("This staff member does not have a PIN yet.");
    const expectedPinDigest = member.pinDigest;
    const now = Date.now();
    const prior = pinAttempts.current.get(memberId) ?? { failures: 0, blockedUntil: 0 };
    if (now < prior.blockedUntil) {
      const seconds = Math.max(1, Math.ceil((prior.blockedUntil - now) / 1000));
      throw new Error(`Too many wrong PINs. Try again in ${seconds} seconds.`);
    }
    const verified = await verifyMerchantPin(pin, expectedPinDigest);
    const attempt = nextPinAttempt(prior, verified, now);
    pinAttempts.current.set(memberId, attempt.state);
    if (!verified) {
      throw new Error(
        attempt.blocked
          ? "Too many wrong PINs. Try again in 30 seconds."
          : "That PIN is not correct.",
      );
    }
    await commitStore((latest) =>
      activateVerifiedOperator(latest, member.id, expectedPinDigest));
    updateStaffSessionId(member.id);
  }, [commitStore, updateStaffSessionId]);

  const lockStaffSession = useCallback(async (): Promise<void> => {
    updateStaffSessionId(null);
    await commitStore((current) => lockOperator(current));
  }, [commitStore, updateStaffSessionId]);

  const endStaffSession = useCallback(async (memberId: string): Promise<void> => {
    const current = storeRef.current;
    const actor = current.staff.find(
      (member) =>
        member.id === staffSessionId &&
        member.id === current.activeStaffId &&
        member.active,
    );
    if (memberId !== staffSessionId && actor?.role !== "owner") {
      throw new Error("Only the owner can end another operator's session.");
    }
    const next = endOperatorShift(current, memberId);
    if (next === current) return;
    if (memberId === staffSessionId) updateStaffSessionId(null);
    await commitStore(next);
  }, [commitStore, staffSessionId, updateStaffSessionId]);

  useEffect(() => {
    const timeout = operatorTimeoutMs(settings);
    if (!ready || !staffSessionId || timeout === null) return;
    let timer = window.setTimeout(() => {
      updateStaffSessionId(null);
      void persist((current) => lockOperator(current));
    }, timeout);
    const resetTimer = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        updateStaffSessionId(null);
        void persist((current) => lockOperator(current));
      }, timeout);
    };
    const onVisibilityChange = () => {
      if (document.hidden) {
        window.clearTimeout(timer);
        updateStaffSessionId(null);
        void persist((current) => lockOperator(current));
      } else {
        resetTimer();
      }
    };
    window.addEventListener("pointerdown", resetTimer, { passive: true });
    window.addEventListener("keydown", resetTimer);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", resetTimer);
      window.removeEventListener("keydown", resetTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [persist, ready, settings, staffSessionId, updateStaffSessionId]);

  const unlockCustomerDisplay = useCallback(async (pin: string): Promise<StaffMember> => {
    const current = storeRef.current;
    const member = current.staff.find(
      (entry) =>
        entry.id === staffSessionId &&
        entry.id === current.activeStaffId &&
        entry.active,
    );
    if (!member?.pinDigest) {
      throw new Error("The active staff session cannot unlock this display.");
    }
    const now = Date.now();
    const prior = pinAttempts.current.get(member.id) ?? { failures: 0, blockedUntil: 0 };
    if (now < prior.blockedUntil) {
      const seconds = Math.max(1, Math.ceil((prior.blockedUntil - now) / 1000));
      throw new Error(`Too many wrong PINs. Try again in ${seconds} seconds.`);
    }
    const verified = await verifyMerchantPin(pin, member.pinDigest);
    const attempt = nextPinAttempt(prior, verified, now);
    pinAttempts.current.set(member.id, attempt.state);
    if (!verified) {
      throw new Error(
        attempt.blocked
          ? "Too many wrong PINs. Try again in 30 seconds."
          : "That PIN is not correct.",
      );
    }
    return member;
  }, [staffSessionId]);

  const addStaff = useCallback(async ({
    name,
    role,
    pin,
  }: {
    name: string;
    role: StaffRole;
    pin: string;
  }): Promise<void> => {
    const actorId = staffSessionId;
    if (!actorId) throw new Error("Choose an owner before adding staff.");
    const pinDigest = await createMerchantPinCredential(pin);
    const next = addStaffMember(storeRef.current, actorId, {
      id: uid("staff"),
      name,
      role,
      pinDigest,
      now: Date.now(),
    });
    await commitStore(next);
  }, [commitStore, staffSessionId]);

  const updateStaff = useCallback(async (
    memberId: string,
    patch: Partial<Pick<StaffMember, "name" | "role" | "permissions" | "active">>,
  ): Promise<void> => {
    const actorId = staffSessionId;
    if (!actorId) throw new Error("Choose an owner before changing staff.");
    await commitStore(updateStaffMember(storeRef.current, actorId, memberId, patch));
  }, [commitStore, staffSessionId]);

  const resetStaffPin = useCallback(async (memberId: string, pin: string): Promise<void> => {
    const actorId = staffSessionId;
    if (!actorId) throw new Error("Choose an owner before resetting a PIN.");
    const pinDigest = await createMerchantPinCredential(pin);
    await commitStore(updateStaffMember(storeRef.current, actorId, memberId, {
      pinDigest,
      pinSetAt: Date.now(),
    }));
    pinAttempts.current.delete(memberId);
  }, [commitStore, staffSessionId]);

  /* ---------------- prices ---------------- */

  useEffect(() => {
    if (!enabled) return;
    const credit = settings.acceptedAssets.filter((a) => !isNative(a));
    if (credit.length === 0) return;
    let alive = true;
    void (async () => {
      const prices = await fetchAssetPrices(
        credit.map((a) => ({ network, code: a.code, issuer: a.issuer })),
      );
      if (alive) setAssetPrices(prices);
    })();
    return () => {
      alive = false;
    };
  }, [enabled, network, settings.acceptedAssets]);

  const fiatRate = settings.currency === "USD" ? 1 : fiatRates[settings.currency];

  /**
   * Off mainnet the wallet deliberately refuses to price anything, so a testnet
   * charge could never be quoted. Merchant Mode falls back to a fixed rate there.
   * Being on testnet is the whole explanation, so no screen announces it, and
   * portfolio valuation stays untouched.
   */
  const onTestnet = network !== "mainnet";

  /**
   * On testnet the till must work even when the live fiat rates have not loaded
   * — that is the whole point of testnet. On mainnet a missing rate stops the
   * charge, because inventing one would misprice real money.
   */
  const effectiveFiatRate = fiatRate ?? (onTestnet ? 1 : undefined);

  /** Shop currency per one whole unit of the asset, or null when unpriceable. */
  const rateFor = useCallback(
    (asset: AcceptedAsset): number | null => {
      if (effectiveFiatRate === undefined) return null;
      const live = getUnitPrice(
        asset.code,
        asset.issuer,
        network,
        isNative(asset),
        xlmPriceUsd,
        assetPrices,
      );
      const usd =
        live !== null && live > 0
          ? live
          : onTestnet
            ? (TESTNET_DEMO_USD[asset.code.toUpperCase()] ?? null)
            : null;
      if (usd === null || usd <= 0) return null;
      return usd * effectiveFiatRate;
    },
    [assetPrices, effectiveFiatRate, network, onTestnet, xlmPriceUsd],
  );

  const quotableAssets = useMemo(
    () => settings.acceptedAssets.filter((a) => rateFor(a) !== null),
    [rateFor, settings.acceptedAssets],
  );

  const settlementHandoffs = useMemo(() => {
    const holdings = (balances ?? []).map((balance) => {
      let available = toStroops(balance.balance) - toStroops(balance.sellingLiabilities);
      if (balance.isNative && minimumBalanceXlm !== null) {
        // One fee pays the prepared handoff; one remains so settlement cannot
        // strand the account at reserve with no way to move again.
        available -= toStroops(minimumBalanceXlm) + BigInt(recommendedBaseFeeStroops) * BigInt(2);
      }
      if (available < BigInt(0)) available = BigInt(0);
      const asset: AcceptedAsset = { code: balance.code, issuer: balance.issuer };
      const rate = rateFor(asset);
      return {
        asset,
        available: fromStroops(available),
        unitPriceMinorE6: rate === null ? null : unitPriceE6(rate),
      };
    });
    return deriveSettlementHandoffs(store, {
      network,
      sourceAccount: activeAccount?.publicKey ?? null,
      holdings,
      localHour: new Date(reportingNow).getHours(),
    });
  }, [
    activeAccount?.publicKey,
    balances,
    minimumBalanceXlm,
    network,
    rateFor,
    recommendedBaseFeeStroops,
    reportingNow,
    store,
  ]);

  const paymentBlockedReason = useMemo(() => {
    if (!activeStaff) return "Choose an active staff member before taking a payment.";
    if (!activeStaff.permissions.takePayment) return `${activeStaff.name} is not allowed to take payments.`;
    if (!activeShift) return `Open a shift on ${settings.terminalName} before taking a payment.`;
    if (activeShift.network !== network) {
      return `Shift ${activeShift.number} is open on ${activeShift.network}; switch network or close it first.`;
    }
    return null;
  }, [activeShift, activeStaff, network, settings.terminalName]);

  const chargeBlockedReason = useMemo(() => {
    if (paymentBlockedReason) return paymentBlockedReason;
    if (!online) return "This device is offline. Reconnect before raising a new priced charge.";
    if (!settings.receivingPublicKey) return "Choose the account that receives payments in Merchant settings.";
    if (settings.acceptedAssets.length === 0) return "Add at least one accepted asset in Merchant settings.";
    if (quotableAssets.length === 0) {
      return network === "mainnet"
        ? "No live price is available for the assets you accept, so an amount cannot be quoted."
        : "No price is available for the assets you accept.";
    }
    return null;
  }, [network, online, paymentBlockedReason, quotableAssets.length, settings.acceptedAssets.length, settings.receivingPublicKey]);

  const invoiceBlockedReason = useMemo(() => {
    if (!activeStaff) return "Choose an active staff member before managing invoices.";
    if (!activeStaff.permissions.takePayment) {
      return `${activeStaff.name} is not allowed to issue or settle invoices.`;
    }
    if (!settings.receivingPublicKey) {
      return "Choose the account that receives payments in Merchant settings.";
    }
    if (settings.acceptedAssets.length === 0) {
      return "Add at least one accepted asset in Merchant settings.";
    }
    if (quotableAssets.length === 0) {
      return network === "mainnet"
        ? "No live price is available for the assets you accept, so this invoice cannot be issued."
        : "No price is available for the assets you accept, so this invoice cannot be issued.";
    }
    return null;
  }, [activeStaff, network, quotableAssets.length, settings.acceptedAssets.length, settings.receivingPublicKey]);

  const counterCodeBlockedReason = useMemo(() => {
    if (!activeStaff) return "Choose an active staff member before managing counter codes.";
    if (!activeStaff.permissions.takePayment) {
      return `${activeStaff.name} is not allowed to manage payment requests.`;
    }
    if (!settings.receivingPublicKey) {
      return "Choose the account that receives payments in Merchant settings.";
    }
    if (settings.acceptedAssets.length === 0) {
      return "Add at least one accepted asset in Merchant settings.";
    }
    return null;
  }, [activeStaff, settings.acceptedAssets.length, settings.receivingPublicKey]);

  /* ---------------- ticket ---------------- */

  const ticketTotals = useMemo(
    () =>
      orderTotals({
        lines: ticket.lines,
        taxRates: settings.taxRates,
        taxMode: settings.taxMode,
        discountMinor: ticket.discountMinor,
        tipMinor: ticket.tipMinor,
      }),
    [settings.taxMode, settings.taxRates, ticket],
  );

  const tipOptions = useMemo(() => {
    const base = settings.tips.onNet ? ticketTotals.netMinor : ticketTotals.grossMinor - ticketTotals.discountMinor;
    return tipPresets(base, settings.tips);
  }, [settings.tips, ticketTotals]);

  const addItemToTicket = useCallback(
    (item: CatalogueItem, modifiers: OrderLineModifier[] = [], quantity = 1) => {
      setTicket((prev) => {
        const signature = modifiers.map((m) => m.modifierId).sort().join("|");
        const existing = prev.lines.find(
          (l) =>
            l.itemId === item.id &&
            l.modifiers.map((m) => m.modifierId).sort().join("|") === signature,
        );
        if (existing) {
          return {
            ...prev,
            lines: prev.lines.map((l) =>
              l.id === existing.id ? { ...l, quantity: l.quantity + quantity } : l,
            ),
          };
        }
        const line: OrderLine = {
          id: uid("line"),
          itemId: item.id,
          name: item.name,
          quantity,
          unitPriceMinor: item.priceMinor,
          modifiers,
          taxRateId: item.taxRateId,
          note: null,
          adjustmentMinor: 0,
        };
        return { ...prev, lines: [...prev.lines, line] };
      });
    },
    [],
  );

  const addCustomAmount = useCallback(
    (amountMinor: Minor, label = "Custom amount") => {
      if (amountMinor <= 0) return;
      setTicket((prev) => ({
        ...prev,
        lines: [
          ...prev.lines,
          {
            id: uid("line"),
            itemId: null,
            name: label,
            quantity: 1,
            unitPriceMinor: amountMinor,
            modifiers: [],
            taxRateId: settings.defaultTaxRateId,
            note: null,
            adjustmentMinor: 0,
          },
        ],
      }));
    },
    [settings.defaultTaxRateId],
  );

  const setLineQuantity = useCallback((lineId: string, quantity: number) => {
    setTicket((prev) => ({
      ...prev,
      lines:
        quantity <= 0
          ? prev.lines.filter((l) => l.id !== lineId)
          : prev.lines.map((l) =>
              l.id === lineId ? { ...l, quantity, adjustmentMinor: 0 } : l,
            ),
      adjustments: prev.adjustments.filter((entry) => entry.lineId !== lineId),
    }));
  }, []);

  const removeLine = useCallback((lineId: string) => {
    setTicket((prev) => ({
      ...prev,
      lines: prev.lines.filter((l) => l.id !== lineId),
      adjustments: prev.adjustments.filter((entry) => entry.lineId !== lineId),
    }));
  }, []);

  const clearTicket = useCallback(() => {
    setTicket({ lines: [], discountMinor: 0, tipMinor: 0, adjustments: [] });
  }, []);

  const requirePaymentActor = useCallback((current: MerchantStore): StaffMember => {
    const actor = current.staff.find(
      (member) =>
        member.id === staffSessionId &&
        member.id === current.activeStaffId &&
        member.active,
    );
    if (!actor) throw new Error("Choose an active staff member before taking a payment.");
    if (!actor.permissions.takePayment) {
      throw new Error(`${actor.name} is not allowed to take payments.`);
    }
    const shift = activeShiftForTerminal(current);
    if (!shift) throw new Error(`Open a shift on ${current.settings.terminalName} before taking a payment.`);
    if (shift.network !== network) {
      throw new Error(`Shift ${shift.number} is open on ${shift.network}; switch network or close it first.`);
    }
    return actor;
  }, [network, staffSessionId]);

  const buildTicketOrder = useCallback((
    current: MerchantStore,
    source: Ticket,
    actor: StaffMember,
    now: number,
    tipMinorOverride?: Minor,
  ): Order => buildOrder(current, {
    id: uid("ord"),
    network,
    lines: source.lines,
    discountMinor: source.discountMinor,
    tipMinor: tipMinorOverride ?? source.tipMinor,
    staffId: actor.id,
    staffName: actor.name,
    now,
  }), [network]);

  const quoteInputs = useCallback((): QuoteInput[] =>
    quotableAssets
      .map((asset) => ({ asset, currencyPerUnit: rateFor(asset) as number }))
      .filter((quote) => quote.currencyPerUnit > 0), [quotableAssets, rateFor]);

  /* ---------------- invoices ---------------- */

  const requireInvoiceActor = useCallback((current: MerchantStore): StaffMember => {
    const actor = current.staff.find(
      (member) =>
        member.id === staffSessionId &&
        member.id === current.activeStaffId &&
        member.active,
    );
    if (!actor) throw new Error("Choose an active staff member before managing invoices.");
    if (!actor.permissions.takePayment) {
      throw new Error(`${actor.name} is not allowed to issue or settle invoices.`);
    }
    return actor;
  }, [staffSessionId]);

  const createInvoiceDraft = useCallback(async (input: {
    customerName: string;
    customerEmail?: string | null;
    lines: InvoiceLine[];
    dueAt?: number | null;
    note?: string | null;
  }): Promise<Invoice> => {
    const current = storeRef.current;
    const actor = requireInvoiceActor(current);
    const created = createPersistedInvoiceDraft(current, {
      ...input,
      id: uid("inv"),
      actor,
      network,
      now: Date.now(),
    });
    await commitStore(created.store);
    return created.invoice;
  }, [commitStore, network, requireInvoiceActor]);

  const updateInvoiceDraft = useCallback(async (input: {
    invoiceId: string;
    customerName: string;
    customerEmail?: string | null;
    lines: InvoiceLine[];
    dueAt?: number | null;
    note?: string | null;
  }): Promise<Invoice> => {
    const current = storeRef.current;
    const actor = requireInvoiceActor(current);
    const updated = updatePersistedInvoiceDraft(current, {
      ...input,
      actor,
      network,
      now: Date.now(),
    });
    await commitStore(updated.store);
    return updated.invoice;
  }, [commitStore, network, requireInvoiceActor]);

  const issueInvoice = useCallback(async (invoiceId: string): Promise<Invoice> => {
    const current = storeRef.current;
    const actor = requireInvoiceActor(current);
    const destination = current.settings.receivingPublicKey;
    if (!destination) {
      throw new Error("Choose the account that receives payments in Merchant settings.");
    }
    const quotes = quoteInputs();
    if (quotes.length === 0) {
      throw new Error(
        network === "mainnet"
          ? "No live price is available for the assets you accept, so this invoice cannot be issued."
          : "No price is available for the assets you accept, so this invoice cannot be issued.",
      );
    }
    const issued = issuePersistedInvoice(current, {
      invoiceId,
      actor,
      network,
      destination,
      quotes,
      now: Date.now(),
    });
    await commitStore(issued.store);
    return issued.invoice;
  }, [commitStore, network, quoteInputs, requireInvoiceActor]);

  const recordManualInvoicePayment = useCallback(async (input: {
    invoiceId: string;
    amountMinor: Minor;
    note?: string | null;
  }): Promise<Invoice> => {
    const current = storeRef.current;
    const actor = requireInvoiceActor(current);
    const settled = recordPersistedManualInvoicePayment(current, {
      ...input,
      paymentId: uid("invpay"),
      actor,
      now: Date.now(),
    });
    await commitStore(settled.store);
    return settled.invoice;
  }, [commitStore, requireInvoiceActor]);

  const voidInvoice = useCallback(async (invoiceId: string, reason: string): Promise<Invoice> => {
    const current = storeRef.current;
    const actor = requireInvoiceActor(current);
    const voided = voidPersistedInvoice(current, {
      invoiceId,
      actor,
      reason,
      now: Date.now(),
    });
    await commitStore(voided.store);
    return voided.invoice;
  }, [commitStore, requireInvoiceActor]);

  const duplicateInvoice = useCallback(async (invoiceId: string): Promise<Invoice> => {
    const current = storeRef.current;
    const actor = requireInvoiceActor(current);
    const duplicate = duplicatePersistedInvoice(current, {
      invoiceId,
      id: uid("inv"),
      actor,
      now: Date.now(),
    });
    await commitStore(duplicate.store);
    return duplicate.invoice;
  }, [commitStore, requireInvoiceActor]);

  const requireCounterCodeActor = useCallback((current: MerchantStore): StaffMember => {
    const actor = current.staff.find(
      (member) =>
        member.id === staffSessionId &&
        member.id === current.activeStaffId &&
        member.active,
    );
    if (!actor) throw new Error("Choose an active staff member before managing counter codes.");
    if (!actor.permissions.takePayment) {
      throw new Error(`${actor.name} is not allowed to manage payment requests.`);
    }
    return actor;
  }, [staffSessionId]);

  const createCounterCode = useCallback(async (
    input: MerchantCounterCodeDraft,
  ): Promise<CounterCode> => {
    const current = storeRef.current;
    const actor = requireCounterCodeActor(current);
    const destination = current.settings.receivingPublicKey;
    if (!destination) {
      throw new Error("Choose the account that receives payments in Merchant settings.");
    }
    const quotes = input.kind === "fixed"
      ? input.acceptedAssets.map((asset) => {
          const currencyPerUnit = rateFor(asset);
          if (currencyPerUnit === null) {
            throw new Error(`No live price is available for ${asset.code}, so its fixed request cannot be published.`);
          }
          return { asset, currencyPerUnit };
        })
      : [];
    const now = Date.now();
    const created = createPersistedCounterCode(current, {
      ...input,
      id: uid("cc"),
      actor,
      network,
      destination,
      quotes,
      now,
    });
    const final = input.active
      ? created
      : setPersistedCounterCodeActive(created.store, {
          codeId: created.code.id,
          actor,
          active: false,
          now,
        });
    await commitStore(final.store);
    return final.code;
  }, [commitStore, network, rateFor, requireCounterCodeActor]);

  const updateCounterCode = useCallback(async (input: {
    codeId: string;
    title: string;
    suggestedMinor: Minor[];
    staffId: string | null;
    expiresAt: number | null;
    active: boolean;
  }): Promise<CounterCode> => {
    const current = storeRef.current;
    const actor = requireCounterCodeActor(current);
    const now = Date.now();
    const updated = updatePersistedCounterCode(current, { ...input, actor, now });
    const final = updated.code.active === input.active
      ? updated
      : setPersistedCounterCodeActive(updated.store, {
          codeId: updated.code.id,
          actor,
          active: input.active,
          now,
        });
    await commitStore(final.store);
    return final.code;
  }, [commitStore, requireCounterCodeActor]);

  const setCounterCodeActive = useCallback(async (
    codeId: string,
    active: boolean,
  ): Promise<CounterCode> => {
    const current = storeRef.current;
    const actor = requireCounterCodeActor(current);
    const changed = setPersistedCounterCodeActive(current, {
      codeId,
      actor,
      active,
      now: Date.now(),
    });
    await commitStore(changed.store);
    return changed.code;
  }, [commitStore, requireCounterCodeActor]);

  const counterCodePreviewUri = useCallback((input: {
    kind: CounterCodeKind;
    amountMinor: Minor | null;
    asset: AcceptedAsset;
    memo: string;
    title: string;
  }): string | null => {
    const destination = storeRef.current.settings.receivingPublicKey;
    if (!destination) return null;
    let amount: string | null = null;
    if (input.kind === "fixed") {
      const rate = rateFor(input.asset);
      if (rate === null || input.amountMinor === null || input.amountMinor <= 0) return null;
      amount = assetAmountFor(input.amountMinor, unitPriceE6(rate));
    }
    return buildCounterCodePayUri({
      destination,
      network,
      asset: input.asset,
      memo: input.memo,
      title: input.title || "Counter code",
      shopName: storeRef.current.settings.profile.name.trim() || "Your shop",
      amount,
    });
  }, [network, rateFor]);

  const requireCustomerActor = useCallback((current: MerchantStore): StaffMember => {
    const actor = current.staff.find(
      (member) =>
        member.id === staffSessionId &&
        member.id === current.activeStaffId &&
        member.active,
    );
    if (!actor) throw new Error("Choose an active staff member before managing loyalty.");
    return actor;
  }, [staffSessionId]);

  const updateCustomerNote = useCallback(async (
    address: string,
    note: string,
  ): Promise<CustomerRecord> => {
    const next = updatePersistedCustomerNote(storeRef.current, address, note);
    await commitStore(next);
    return next.customers.find((customer) => customer.address === address) as CustomerRecord;
  }, [commitStore]);

  const startLoyaltyCard = useCallback(async (
    address: string,
    target = 10,
  ): Promise<CustomerRecord> => {
    const current = storeRef.current;
    const next = startPersistedLoyaltyCard(current, {
      address,
      target,
      actor: requireCustomerActor(current),
      eventId: uid("loyalty"),
      now: Date.now(),
    });
    await commitStore(next);
    return next.customers.find((customer) => customer.address === address) as CustomerRecord;
  }, [commitStore, requireCustomerActor]);

  const redeemLoyaltyReward = useCallback(async (address: string): Promise<CustomerRecord> => {
    const current = storeRef.current;
    const next = redeemPersistedLoyaltyReward(current, {
      address,
      actor: requireCustomerActor(current),
      eventId: uid("loyalty"),
      now: Date.now(),
    });
    await commitStore(next);
    return next.customers.find((customer) => customer.address === address) as CustomerRecord;
  }, [commitStore, requireCustomerActor]);

  const forgetCustomer = useCallback(async (address: string): Promise<void> => {
    const current = storeRef.current;
    const next = forgetPersistedCustomer(current, address);
    if (next !== current) await commitStore(next);
  }, [commitStore]);

  const customerHistory = useCallback(
    (address: string): CustomerHistoryEntry[] => buildCustomerHistory(storeRef.current, address),
    [],
  );

  const cryptoChargeFor = useCallback((
    order: Order,
    amountMinor: Minor,
    current: MerchantStore,
    now: number,
  ): Charge => {
    const destination = current.settings.receivingPublicKey;
    if (!destination) {
      throw new Error("Choose the account that receives payments in Merchant settings.");
    }
    if (current.settings.acceptedAssets.length === 0) {
      throw new Error("Add at least one accepted asset in Merchant settings.");
    }
    const quotes = quoteInputs();
    if (quotes.length === 0) {
      throw new Error(
        network === "mainnet"
          ? "No live price is available for the assets you accept, so an amount cannot be quoted."
          : "No price is available for the assets you accept.",
      );
    }
    return createCharge({
      order,
      settings: current.settings,
      network,
      destination,
      quotes,
      amountMinor,
      now,
    });
  }, [network, quoteInputs]);

  const settleCash = useCallback(async (receivedMinor: Minor): Promise<Order> => {
    const current = storeRef.current;
    const actor = requirePaymentActor(current);
    if (ticket.lines.length === 0) throw new Error("Add something to the ticket first.");
    const now = Date.now();
    const order = buildTicketOrder(current, ticket, actor, now);
    const committed = settleNewOrder(
      current,
      order,
      [cashTender(order.totals.totalMinor, receivedMinor)],
      ticket.adjustments,
      now,
    );
    const securedStore = applyOperatorSalePolicy(committed.store);
    await commitStore(securedStore);
    if (securedStore.activeStaffId === null) updateStaffSessionId(null);
    clearTicket();
    return committed.order;
  }, [buildTicketOrder, clearTicket, commitStore, requirePaymentActor, ticket, updateStaffSessionId]);

  const settleCard = useCallback(async (externalReference?: string): Promise<Order> => {
    const current = storeRef.current;
    const actor = requirePaymentActor(current);
    if (ticket.lines.length === 0) throw new Error("Add something to the ticket first.");
    const now = Date.now();
    const order = buildTicketOrder(current, ticket, actor, now);
    const committed = settleNewOrder(
      current,
      order,
      [cardTender(order.totals.totalMinor, externalReference)],
      ticket.adjustments,
      now,
    );
    const securedStore = applyOperatorSalePolicy(committed.store);
    await commitStore(securedStore);
    if (securedStore.activeStaffId === null) updateStaffSessionId(null);
    clearTicket();
    return committed.order;
  }, [buildTicketOrder, clearTicket, commitStore, requirePaymentActor, ticket, updateStaffSessionId]);

  const startSplitCharge = useCallback(async (
    input: MerchantSplitTenderInput,
  ): Promise<MerchantTenderOutcome> => {
    const current = storeRef.current;
    const actor = requirePaymentActor(current);
    if (ticket.lines.length === 0) throw new Error("Add something to the ticket first.");
    if (input.firstKind === input.secondKind) {
      throw new Error("A split needs two different tender types.");
    }
    const now = Date.now();
    const order = buildTicketOrder(current, ticket, actor, now);
    if (
      !Number.isSafeInteger(input.firstMinor) ||
      input.firstMinor <= 0 ||
      input.firstMinor >= order.totals.totalMinor
    ) {
      throw new Error("The first split amount must be within the order total.");
    }
    const amounts = [input.firstMinor, order.totals.totalMinor - input.firstMinor];
    const kinds = [input.firstKind, input.secondKind] as const;
    const parts: TenderPart[] = kinds.flatMap((kind, index) => {
      const amount = amounts[index];
      if (kind === "crypto") return [];
      return kind === "cash"
        ? [cashTender(amount, amount)]
        : [cardTender(amount, input.cardReference)];
    });
    const cryptoIndex = kinds.findIndex((kind) => kind === "crypto");

    if (cryptoIndex < 0) {
      const committed = settleNewOrder(current, order, parts, ticket.adjustments, now);
      const securedStore = applyOperatorSalePolicy(committed.store);
      await commitStore(securedStore);
      if (securedStore.activeStaffId === null) updateStaffSessionId(null);
      clearTicket();
      return { order: committed.order, charge: null };
    }

    const awaiting = awaitNewOrder(current, order, parts, ticket.adjustments);
    const charge = cryptoChargeFor(awaiting.order, amounts[cryptoIndex], current, now);
    const nextStore = {
      ...awaiting.store,
      charges: [charge, ...awaiting.store.charges],
    };
    await commitStore(nextStore);
    setActiveChargeId(charge.id);
    clearTicket();
    return { order: awaiting.order, charge };
  }, [
    buildTicketOrder,
    clearTicket,
    commitStore,
    cryptoChargeFor,
    requirePaymentActor,
    ticket,
    updateStaffSessionId,
  ]);

  const adjustTicket = useCallback(async (
    kind: AdjustmentKind,
    lineId: string | null,
    amountMinor: Minor,
    reasonCode: string,
  ): Promise<Order | null> => {
    const current = storeRef.current;
    const actor = current.staff.find(
      (member) =>
        member.id === staffSessionId &&
        member.id === current.activeStaffId &&
        member.active,
    );
    if (!actor) throw new Error("Choose an active staff member before adjusting a ticket.");
    const now = Date.now();
    const result = applyTicketAdjustment(current, ticket, {
      id: uid("aj"),
      kind,
      lineId,
      amountMinor,
      reasonCode,
      actor,
      now,
    });
    const adjustments = [...ticket.adjustments, result.adjustment];

    if (kind === "void" && result.ticket.lines.length === 0) {
      const order = buildTicketOrder(current, ticket, actor, now);
      const committed = voidNewOrder(current, order, adjustments);
      await commitStore(committed.store);
      clearTicket();
      return committed.order;
    }

    if (result.totals.totalMinor === 0) {
      const adjustedTicket: Ticket = { ...result.ticket, adjustments };
      const order = buildTicketOrder(current, adjustedTicket, actor, now);
      const committed = settleNewOrder(current, order, [], adjustments, now);
      const securedStore = applyOperatorSalePolicy(committed.store);
      await commitStore(securedStore);
      if (securedStore.activeStaffId === null) updateStaffSessionId(null);
      clearTicket();
      return committed.order;
    }

    setTicket({ ...result.ticket, adjustments });
    return null;
  }, [buildTicketOrder, clearTicket, commitStore, staffSessionId, ticket, updateStaffSessionId]);

  const applyAdjustment = useCallback((input: {
    lineId: string | null;
    amountMinor: Minor;
    reasonCode: string;
  }): Promise<Order | null> => adjustTicket(
    "discount",
    input.lineId,
    input.amountMinor,
    input.reasonCode,
  ), [adjustTicket]);

  const voidLine = useCallback(
    (lineId: string | null, reasonCode: string): Promise<Order | null> =>
      adjustTicket("void", lineId, 0, reasonCode),
    [adjustTicket],
  );

  const compLine = useCallback(
    (lineId: string | null, reasonCode: string): Promise<Order | null> =>
      adjustTicket("comp", lineId, 0, reasonCode),
    [adjustTicket],
  );

  /* ---------------- charges ---------------- */

  /**
   * The tip is chosen after Charge is pressed, so it arrives as an argument
   * rather than through `setTip`. A state write at that point would not be
   * visible to this call, and the charge — and therefore the QR the customer
   * scans — would encode the untipped total.
   */
  const createChargeFromTicket = useCallback(async (
    tipMinorOverride?: Minor,
  ): Promise<Charge> => {
    const current = storeRef.current;
    const actor = requirePaymentActor(current);
    if (ticket.lines.length === 0) throw new Error("Add something to the ticket first.");
    const now = Date.now();
    const order = buildTicketOrder(current, ticket, actor, now, tipMinorOverride);
    const awaiting = awaitNewOrder(current, order, [], ticket.adjustments);
    const charge = cryptoChargeFor(
      awaiting.order,
      awaiting.order.totals.totalMinor,
      current,
      now,
    );
    const nextStore = {
      ...awaiting.store,
      charges: [charge, ...awaiting.store.charges],
    };
    await commitStore(nextStore);
    setActiveChargeId(charge.id);
    clearTicket();
    return charge;
  }, [
    buildTicketOrder,
    clearTicket,
    commitStore,
    cryptoChargeFor,
    requirePaymentActor,
    ticket,
  ]);

  const voidCharge = useCallback(
    async (id: string): Promise<void> => {
      const current = storeRef.current;
      await commitStore({
        ...current,
        charges: current.charges.map((charge) =>
          charge.id === id ? { ...charge, status: "voided" } : charge,
        ),
        orders: current.orders.map((order) =>
          current.charges.some((charge) => charge.id === id && charge.orderId === order.id) &&
          order.status === "awaiting"
            ? { ...order, status: "voided" }
            : order,
        ),
      });
      setActiveChargeId((current) => (current === id ? null : current));
    },
    [commitStore],
  );

  /** Expire anything past its window so the UI never shows a dead countdown. */
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      const current = storeRef.current;
      const nextExpiry = nextAwaitingChargeExpiry(current.charges);
      if (nextExpiry === null) return;
      const delay = Math.min(Math.max(0, nextExpiry - Date.now()), 2_147_483_647);
      timer = setTimeout(() => {
        if (cancelled) return;
        const latest = storeRef.current;
        const charges = expireAwaitingCharges(latest.charges, Date.now());
        if (charges === latest.charges) {
          schedule();
          return;
        }
        void persist({
          ...latest,
          charges,
        });
      }, delay);
    };
    schedule();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [enabled, persist, store.charges]);

  /* ---------------- the watcher ---------------- */

  const applyPayments = useCallback(
    async (payments: ObservedPayment[]): Promise<void> => {
      if (payments.length === 0) return;
      const current = storeRef.current;
      const invoiceResult = reconcileInvoicePayments(current, {
        network,
        payments,
        now: Date.now(),
      });
      const counterResult = reconcileCounterPayments(invoiceResult.store, {
        network,
        payments: invoiceResult.unclaimed,
        rates: quoteInputs(),
        now: Date.now(),
      });
      const next = reconcileIncomingPayments(counterResult.store, {
        network,
        payments: counterResult.unclaimed,
        now: Date.now(),
      });
      const withCustomers = reconcileCustomerSettlements(current, next, { contacts });
      if (withCustomers !== current) {
        const settlementStaffId = staffSessionIdRef.current;
        const securedStore = applyCompletedSalePolicy(
          current,
          withCustomers,
          settlementStaffId,
        );
        await commitStore(securedStore);
        if (
          securedStore.activeStaffId === null &&
          current.activeStaffId !== null &&
          staffSessionIdRef.current === settlementStaffId
        ) {
          updateStaffSessionId(null);
        }
      }
    },
    [commitStore, contacts, network, quoteInputs, updateStaffSessionId],
  );

  /**
   * Horizon's own wording is written for developers. A counter needs to know
   * what to do, and the commonest failure here is not an outage at all — it is a
   * receiving account that has never been funded, so Horizon has no such record.
   */
  function describeWatchFailure(error: unknown): string {
    if (error instanceof HorizonRequestError) {
      if (error.kind === "not_found") {
        return "This account is not active on the Stellar network yet, so payments cannot be watched. Fund it, then try again.";
      }
      if (error.kind === "rate_limited") {
        return "The network is asking us to slow down. Payments will still be picked up, just a little later.";
      }
      if (error.kind === "network") {
        return "No connection to the Stellar network.";
      }
      return "The Stellar network is not answering right now.";
    }
    return "The Stellar network is not answering right now.";
  }

  const watchDestinations = useMemo(
    () => merchantWatchDestinations(
      {
        receivingPublicKey: settings.receivingPublicKey,
        charges: store.charges,
        counterCodes: store.counterCodes,
        invoices: store.invoices,
      },
      network,
    ),
    [network, settings.receivingPublicKey, store.charges, store.counterCodes, store.invoices],
  );

  const activeWatcherLeaseKeys = useMemo(
    () => watchDestinations.map((destination) => watcherLeaseKey(network, destination)),
    [network, watchDestinations],
  );

  useEffect(() => {
    const release = () => {
      for (const leaseKey of activeWatcherLeaseKeys) {
        releaseWatcherLease(window.localStorage, leaseKey, writerId);
      }
    };
    let wasVisible = document.visibilityState === "visible";
    const handleVisibility = () => {
      const visible = document.visibilityState === "visible";
      setForeground(visible);
      if (!visible) {
        release();
      } else if (!wasVisible) {
        void pollRef.current();
      }
      wasVisible = visible;
    };
    window.addEventListener("pagehide", release);
    document.addEventListener("visibilitychange", handleVisibility);
    const initialVisibilityCheck = setTimeout(handleVisibility, 0);
    return () => {
      clearTimeout(initialVisibilityCheck);
      window.removeEventListener("pagehide", release);
      document.removeEventListener("visibilitychange", handleVisibility);
      release();
    };
  }, [activeWatcherLeaseKeys, writerId]);

  const pollNow = useCallback(async () => {
    if (!enabled || !online || watchDestinations.length === 0 || polling.current) return;
    polling.current = true;
    let latestLedger: number | null = null;
    let firstFailure: unknown = null;
    try {
      for (const destination of watchDestinations) {
        const leaseKey = watcherLeaseKey(network, destination);
        if (
          !claimWatcherLease(
            window.localStorage,
            leaseKey,
            writerId,
            Date.now(),
            WATCHER_LEASE_MS,
          )
        ) {
          continue;
        }
        const cursorKey = merchantCursorKey(network, destination);
        try {
          const result = await fetchIncomingPayments({
            publicKey: destination,
            network,
            cursor: storeRef.current.cursors[cursorKey] ?? null,
          });
          if (
            result.latestLedger &&
            (latestLedger === null || result.latestLedger > latestLedger)
          ) {
            latestLedger = result.latestLedger;
          }
          await applyPayments(result.payments);
          if (result.cursor) {
            await persist((prev) => ({
              ...prev,
              cursors: { ...prev.cursors, [cursorKey]: result.cursor as string },
            }));
          }
        } catch (error) {
          firstFailure ??= error;
        }
      }
      if (latestLedger !== null) setWatchedLedger(latestLedger);
      if (firstFailure === null || isMerchantStorageError(firstFailure)) {
        setWatchError(null);
      } else {
        setWatchError(describeWatchFailure(firstFailure));
      }
    } finally {
      polling.current = false;
    }
  }, [applyPayments, enabled, network, online, persist, watchDestinations, writerId]);

  const hasLiveCharge = useMemo(
    () => liveCharges(store.charges, network).length > 0,
    [network, store.charges],
  );

  const hasLiveInvoice = useMemo(
    () =>
      store.invoices.some(
        (invoice) =>
          invoice.network === network &&
          (invoice.status === "sent" ||
            invoice.status === "partially_paid" ||
            invoice.status === "overdue"),
      ),
    [network, store.invoices],
  );

  const hasLiveCounterCode = useMemo(
    () => store.counterCodes.some((code) => code.network === network && code.active),
    [network, store.counterCodes],
  );

  // `pollNow` is rebuilt whenever the cursor advances. The timer must not restart
  // that often, so it reads the latest callback through a ref instead of closing
  // over one — otherwise every tick would replay the same Horizon page.
  useEffect(() => {
    pollRef.current = pollNow;
  }, [pollNow]);

  useEffect(() => {
    if (!enabled || !online || !foreground || watchDestinations.length === 0) return;
    let alive = true;
    void (async () => {
      await Promise.resolve();
      if (alive) await pollRef.current();
    })();
    const interval = setInterval(() => {
      void pollRef.current();
    }, hasLiveCharge || hasLiveInvoice || hasLiveCounterCode ? POLL_ACTIVE_MS : POLL_IDLE_MS);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [
    enabled,
    foreground,
    hasLiveCharge,
    hasLiveCounterCode,
    hasLiveInvoice,
    network,
    online,
    watchDestinations.length,
  ]);

  /* ---------------- tray ---------------- */

  const attachPayment = useCallback(
    async (paymentId: string, chargeId: string): Promise<void> => {
      const current = storeRef.current;
      const actor = requirePaymentActor(current);
      const attached = attachReconciledPayment(current, {
        paymentId,
        chargeId,
        actor,
        now: Date.now(),
      });
      const reconciled = reconcileCustomerSettlements(current, attached, { contacts });
      const securedStore = applyOperatorSalePolicy(reconciled);
      await commitStore(securedStore);
      if (securedStore.activeStaffId === null && staffSessionIdRef.current === actor.id) {
        updateStaffSessionId(null);
      }
    },
    [commitStore, contacts, requirePaymentActor, updateStaffSessionId],
  );

  const dismissUnmatched = useCallback(
    async (paymentId: string): Promise<void> => {
      const current = storeRef.current;
      const actor = requirePaymentActor(current);
      await commitStore(dismissReconciledPayment(current, {
        paymentId,
        actor,
        now: Date.now(),
      }));
    },
    [commitStore, requirePaymentActor],
  );

  /* ---------------- refunds ---------------- */

  const refundOrder = useCallback(
    async ({
      orderId,
      amountMinor,
      reason,
      note,
      approvalRequestId,
    }: {
      orderId: string;
      amountMinor: Minor;
      reason: RefundReason;
      note?: string;
      approvalRequestId?: string;
    }): Promise<Refund> => {
      const current = storeRef.current;
      const member = current.staff.find((entry) => entry.id === staffSessionId) ?? null;
      if (!canReleaseRefund(member, amountMinor)) {
        throw new Error("This refund needs approval from a staff member with a higher ceiling.");
      }
      const existingApprovalRefund = approvalRequestId
        ? current.refunds.find(
            (refund) =>
              refund.requestId === approvalRequestId && refund.submissionStatus !== "failed",
          )
        : null;
      if (existingApprovalRefund) return existingApprovalRefund;
      const order = current.orders.find((entry) => entry.id === orderId);
      const charge = settledOrderPaymentSource(current, orderId);
      if (!order || !charge?.payment) throw new Error("This order has no settled payment to refund.");
      const sourcePayment = charge.payment;
      if (order.network !== network) throw new Error("Switch to the order's Stellar network before refunding it.");
      if (activeAccount?.publicKey !== charge.destination) {
        throw new Error("Switch to the receiving account that took this payment before refunding it.");
      }
      const priorRefunds = current.refunds.filter(
        (refund) =>
          refund.kind === "order" &&
          refund.orderId === orderId &&
          (refund.sourcePaymentId === sourcePayment.id || refund.sourcePaymentId === null) &&
          refundReservesFunds(refund),
      );
      const refundedMinor = priorRefunds.reduce((sum, refund) => sum + refund.amountMinor, 0);
      const remainingMinor = availableRefundMinor(current, orderId, approvalRequestId);
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor > remainingMinor) {
        throw new Error(`Only ${remainingMinor} minor units remain refundable on this order.`);
      }

      // Calculate against cumulative refunded value so repeated partial refunds
      // return every final stroop without floating-point drift.
      const paymentStroops = toStroops(sourcePayment.amount);
      const priorRefundStroops = priorRefunds.reduce(
        (sum, refund) => sum + toStroops(refund.amount),
        BigInt(0),
      );
      const cumulativeMinor = refundedMinor + amountMinor;
      const cumulativeStroops =
        (paymentStroops * BigInt(cumulativeMinor)) / BigInt(charge.amountMinor);
      const refundStroops = cumulativeStroops - priorRefundStroops;
      if (refundStroops <= BigInt(0)) throw new Error("This refund is below the asset's minimum precision.");
      const amount = fromStroops(refundStroops);

      const refundId = uid("rfd");
      const createdAt = Date.now();
      const refundBase: Omit<Refund, "transactionHash" | "submissionStatus"> = {
        id: refundId,
        orderId,
        kind: "order",
        sourcePaymentId: sourcePayment.id,
        requestId: approvalRequestId ?? null,
        network: order.network,
        amountMinor,
        asset: sourcePayment.asset,
        amount,
        destination: sourcePayment.from,
        reason,
        note: note?.trim() || null,
        createdAt,
      };
      const result = await send({
        destination: sourcePayment.from,
        amount,
        assetCode: sourcePayment.asset.code,
        issuer: sourcePayment.asset.issuer,
        memo: { type: "text", value: `RF${order.number}` },
        submissionJournal: {
          onPrepared: async (prepared) => {
            const intent: Refund = {
              ...refundBase,
              transactionHash: prepared.hash,
              submissionStatus: "prepared",
            };
            await commitStore((latest) => recordRefundSubmission(latest, intent));
          },
          onRejected: async () => {
            if (!storeRef.current.refunds.some((refund) => refund.id === refundId)) return;
            await commitStore((latest) =>
              reconcileRefundSubmission(latest, refundId, "failed"));
          },
        },
      });
      await commitStore((latest) =>
        reconcileRefundSubmission(latest, refundId, result.status));
      return {
        ...refundBase,
        transactionHash: result.hash,
        submissionStatus: result.status,
      };
    },
    [activeAccount?.publicKey, commitStore, network, send, staffSessionId],
  );

  const submitRefund = useCallback(async (params: {
    orderId: string;
    amountMinor: Minor;
    reason: RefundReason;
    note?: string;
  }): Promise<MerchantRefundOutcome> => {
    const current = storeRef.current;
    const member = current.staff.find((entry) => entry.id === staffSessionId) ?? null;
    if (canReleaseRefund(member, params.amountMinor)) {
      return { kind: "refunded", refund: await refundOrder(params) };
    }
    if (!member) throw new Error("Choose a staff member before requesting a refund.");
    const order = current.orders.find((entry) => entry.id === params.orderId);
    if (!order || params.amountMinor > availableRefundMinor(current, params.orderId)) {
      throw new Error("That amount is no longer refundable on this order.");
    }
    const requested = createRefundRequest(current, {
      id: uid("rr"),
      ...params,
      requestedById: member.id,
      now: Date.now(),
    });
    await commitStore(requested.store);
    return { kind: "requested", request: requested.request };
  }, [commitStore, refundOrder, staffSessionId]);

  const refundReconciledPayment = useCallback(async ({
    paymentId,
    note,
    approvalRequestId,
  }: {
    paymentId: string;
    note?: string;
    approvalRequestId?: string;
  }): Promise<Refund> => {
    const current = storeRef.current;
    const member = current.staff.find((entry) => entry.id === staffSessionId) ?? null;
    const reconciliation = current.paymentReconciliations.find(
      (entry) => entry.id === paymentId,
    );
    if (!reconciliation || reconciliation.resolution) {
      throw new Error("That incoming payment is no longer available for refund.");
    }
    const amountMinor = reconciliation.amountMinor;
    if (amountMinor === null || !canReleaseRefund(member, amountMinor)) {
      throw new Error("This payment refund needs approval from a staff member with a higher ceiling.");
    }
    const existingApprovalRefund = approvalRequestId
      ? current.refunds.find(
          (refund) =>
            refund.requestId === approvalRequestId && refund.submissionStatus !== "failed",
        )
      : null;
    if (existingApprovalRefund) return existingApprovalRefund;
    const order = reconciliation.orderId
      ? current.orders.find((entry) => entry.id === reconciliation.orderId) ?? null
      : null;
    const invoice = reconciliation.invoiceId
      ? current.invoices.find((entry) => entry.id === reconciliation.invoiceId) ?? null
      : null;
    const charge = reconciliation.chargeId
      ? current.charges.find((entry) => entry.id === reconciliation.chargeId) ?? null
      : null;
    if ((!order || !charge) && !invoice) {
      throw new Error("The payment's original sale or invoice is no longer available.");
    }
    if (reconciliation.network !== network) {
      throw new Error("Switch to the payment's Stellar network before refunding it.");
    }
    const receivingDestination = charge?.destination ?? invoice?.destination ?? null;
    if (activeAccount?.publicKey !== receivingDestination) {
      throw new Error("Switch to the receiving account that took this payment before refunding it.");
    }

    const payment = reconciliation.payment;
    const reversalAmount = reconciliation.reversalAmount ?? payment.amount;
    const refundId = uid("rfd");
    const now = Date.now();
    const refundBase: Omit<Refund, "transactionHash" | "submissionStatus"> = {
      id: refundId,
      orderId: order?.id ?? invoice?.id ?? "",
      invoiceId: invoice?.id ?? null,
      kind: "payment_reversal",
      sourcePaymentId: reconciliation.id,
      requestId: approvalRequestId ?? null,
      network: reconciliation.network,
      amountMinor,
      asset: payment.asset,
      amount: reversalAmount,
      destination: payment.from,
      reason: reconciliation.outcome === "overpaid" ? "overpayment" : "duplicate",
      note: note?.trim() || null,
      createdAt: now,
    };
    const result = await send({
      destination: payment.from,
      amount: reversalAmount,
      assetCode: payment.asset.code,
      issuer: payment.asset.issuer,
      memo: {
        type: "text",
        value: order ? `DP${order.number}` : `IP${invoice?.number ?? "SURPLUS"}`,
      },
      submissionJournal: {
        onPrepared: async (prepared) => {
          const intent: Refund = {
            ...refundBase,
            transactionHash: prepared.hash,
            submissionStatus: "prepared",
          };
          await commitStore((latest) => recordRefundSubmission(latest, intent));
        },
        onRejected: async () => {
          if (!storeRef.current.refunds.some((refund) => refund.id === refundId)) return;
          await commitStore((latest) =>
            reconcileRefundSubmission(latest, refundId, "failed"));
        },
      },
    });
    await commitStore((latest) => {
      const recorded = reconcileRefundSubmission(latest, refundId, result.status);
      return markReconciledRefund(recorded, {
        paymentId,
        refundId,
        actor: member as StaffMember,
        now,
      });
    });
    return {
      ...refundBase,
      transactionHash: result.hash,
      submissionStatus: result.status,
    };
  }, [activeAccount?.publicKey, commitStore, network, send, staffSessionId]);

  const submitPaymentRefund = useCallback(async (
    paymentId: string,
    note?: string,
  ): Promise<MerchantRefundOutcome> => {
    const current = storeRef.current;
    const member = current.staff.find((entry) => entry.id === staffSessionId) ?? null;
    const reconciliation = current.paymentReconciliations.find(
      (entry) => entry.id === paymentId,
    );
    if (!reconciliation || reconciliation.amountMinor === null) {
      throw new Error("That payment has no verified value to refund.");
    }
    if (canReleaseRefund(member, reconciliation.amountMinor)) {
      return {
        kind: "refunded",
        refund: await refundReconciledPayment({ paymentId, note }),
      };
    }
    if (!member) throw new Error("Choose a staff member before requesting a refund.");
    const requested = createPaymentRefundRequest(current, {
      id: uid("rr"),
      paymentId,
      requestedById: member.id,
      note,
      now: Date.now(),
    });
    await commitStore(requested.store);
    return { kind: "requested", request: requested.request };
  }, [commitStore, refundReconciledPayment, staffSessionId]);

  const approveRefundRequest = useCallback(async (requestId: string): Promise<Refund> => {
    const before = storeRef.current;
    const request = before.refundRequests.find((entry) => entry.id === requestId);
    const reviewerId = staffSessionId;
    if (!request || !reviewerId) throw new Error("That refund request is no longer available.");
    // Validate authority before opening the wallet signing path.
    assertCanReviewRefundRequest(before, {
      requestId,
      reviewerId,
    });
    const refund = request.sourcePaymentId
      ? await refundReconciledPayment({
          paymentId: request.sourcePaymentId,
          note: request.note ?? undefined,
          approvalRequestId: request.id,
        })
      : await refundOrder({
          orderId: request.orderId,
          amountMinor: request.amountMinor,
          reason: request.reason,
          note: request.note ?? undefined,
          approvalRequestId: request.id,
        });
    await commitStore(decideRefundRequest(storeRef.current, {
      requestId,
      reviewerId,
      decision: "approved",
      now: Date.now(),
      refundId: refund.id,
    }));
    return refund;
  }, [commitStore, refundOrder, refundReconciledPayment, staffSessionId]);

  const declineRefundRequest = useCallback(async (requestId: string): Promise<void> => {
    const current = storeRef.current;
    if (!staffSessionId) throw new Error("Choose a staff member before reviewing refunds.");
    await commitStore(decideRefundRequest(current, {
      requestId,
      reviewerId: staffSessionId,
      decision: "declined",
      now: Date.now(),
    }));
  }, [commitStore, staffSessionId]);

  /* ---------------- derived ---------------- */

  const recordIndex = useMemo(
    () => indexMerchantRecords(store.orders, store.charges),
    [store.charges, store.orders],
  );

  const today = useMemo<TodaySummary>(() => {
    const from = startOfToday(reportingNow);
    const paid = store.orders.filter(
      (o) => o.network === network && o.paidAt !== null && o.paidAt >= from,
    );
    const takingsMinor = paid.reduce((sum, o) => sum + o.totals.totalMinor, 0);
    const tipsMinor = paid.reduce((sum, o) => sum + o.totals.tipMinor, 0);
    const taxMinor = paid.reduce((sum, o) => sum + o.totals.taxMinor, 0);
    const refundedMinor = store.refunds
      .filter(
        (r) =>
          r.kind === "order" &&
          r.network === network &&
          r.createdAt >= from &&
          r.submissionStatus === "confirmed",
      )
      .reduce((sum, r) => sum + r.amountMinor, 0);

    const hours = new Map<number, { orders: number; takingsMinor: Minor }>();
    for (const order of paid) {
      const hour = new Date(order.paidAt as number).getHours();
      const bucket = hours.get(hour) ?? { orders: 0, takingsMinor: 0 };
      bucket.orders += 1;
      bucket.takingsMinor += order.totals.totalMinor;
      hours.set(hour, bucket);
    }

    const items = new Map<string, { units: number; revenueMinor: Minor }>();
    for (const order of paid) {
      for (const line of order.lines) {
        const entry = items.get(line.name) ?? { units: 0, revenueMinor: 0 };
        entry.units += line.quantity;
        entry.revenueMinor += lineGrossMinor(line);
        items.set(line.name, entry);
      }
    }

    const mix = new Map<string, { asset: AcceptedAsset; takingsMinor: Minor }>();
    for (const order of paid) {
      const charge = recordIndex.paymentChargeByOrderId.get(order.id);
      const asset = charge?.payment?.asset;
      if (!asset) continue;
      const key = assetKey(asset);
      const entry = mix.get(key) ?? { asset, takingsMinor: 0 };
      entry.takingsMinor += order.totals.totalMinor;
      mix.set(key, entry);
    }

    return {
      takingsMinor,
      orderCount: paid.length,
      avgTicketMinor: paid.length ? Math.round(takingsMinor / paid.length) : 0,
      tipsMinor,
      taxMinor,
      refundedMinor,
      byHour: [...hours.entries()]
        .map(([hour, v]) => ({ hour, ...v }))
        .sort((a, b) => a.hour - b.hour),
      topItems: [...items.entries()]
        .map(([name, v]) => ({ name, ...v }))
        .sort((a, b) => b.revenueMinor - a.revenueMinor)
        .slice(0, 8),
      assetMix: [...mix.values()]
        .map((v) => ({
          ...v,
          share: takingsMinor ? v.takingsMinor / takingsMinor : 0,
        }))
        .sort((a, b) => b.takingsMinor - a.takingsMinor),
    };
  }, [network, recordIndex.paymentChargeByOrderId, reportingNow, store.orders, store.refunds]);

  const activeCharge = useMemo(
    () => (activeChargeId ? (recordIndex.chargesById.get(activeChargeId) ?? null) : null),
    [activeChargeId, recordIndex.chargesById],
  );

  const runtime = useMemo(
    () =>
      merchantRuntimeState({
        online,
        foreground,
        vaultPhase: phase,
        watchError,
        charges: store.charges,
        network,
        now: reportingNow,
      }),
    [foreground, network, online, phase, reportingNow, store.charges, watchError],
  );

  const setTillTextSize = useCallback(
    (size: MerchantStore["tillTextSize"]) => persist((prev) => ({ ...prev, tillTextSize: size })),
    [persist],
  );
  const updateSettings = useCallback(
    (patch: Partial<MerchantSettings>) =>
      persist((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } })),
    [persist],
  );
  const upsertItem = useCallback(
    (item: CatalogueItem) =>
      commitStore((prev) => ({
        ...prev,
        catalogue: prev.catalogue.some((candidate) => candidate.id === item.id)
          ? prev.catalogue.map((candidate) => (candidate.id === item.id ? item : candidate))
          : [...prev.catalogue, item],
      })),
    [commitStore],
  );
  const removeItemFromCatalogue = useCallback(
    (id: string) =>
      commitStore((prev) => ({
        ...prev,
        catalogue: prev.catalogue.filter((item) => item.id !== id),
      })),
    [commitStore],
  );
  const invoicePayUriFor = useCallback(
    (invoice: Invoice, asset: AcceptedAsset) => {
      try {
        return invoicePayUri(invoice, asset, settings.profile.name);
      } catch {
        return null;
      }
    },
    [settings.profile.name],
  );
  const counterCodePayUriFor = useCallback((code: CounterCode, asset: AcceptedAsset) => {
    try {
      return counterCodePayUri(code, asset);
    } catch {
      return null;
    }
  }, []);
  const closeCharge = useCallback(() => setActiveChargeId(null), []);
  const payUriFor = useCallback(
    (charge: Charge, asset: AcceptedAsset) => {
      const quote = quoteFor(charge, asset);
      return quote ? chargePayUri(charge, quote, settings.profile.name) : null;
    },
    [settings.profile.name],
  );
  const orderFor = useCallback(
    (chargeId: string) => {
      const charge = recordIndex.chargesById.get(chargeId);
      return charge ? (recordIndex.ordersById.get(charge.orderId) ?? null) : null;
    },
    [recordIndex.chargesById, recordIndex.ordersById],
  );
  const peripherals = useMemo<Peripheral[]>(() => [...BROWSER_PERIPHERALS], []);
  const terminal = useMemo<TerminalDevice>(
    () => ({
      ...store.terminal,
      name: settings.terminalName,
      queuedCharges: runtime.queuedChargeCount,
    }),
    [runtime.queuedChargeCount, settings.terminalName, store.terminal],
  );
  const watching = foreground && online && enabled && Boolean(settings.receivingPublicKey);

  const value = useMemo<MerchantContextValue>(() => ({
    ready,
    storageIssue,
    storageError,
    storageHealth,
    requestPersistentStorage,
    exportEncryptedArchive,
    exportRecoveryData,
    resetRecoveryData,
    online,
    enabled,
    configured,
    setEnabled,
    settings,
    tillTextSize: store.tillTextSize,
    setTillTextSize,
    updateSettings,
    completeSetup,

    staff: store.staff,
    activeStaff,
    onShiftStaff,
    terminal,
    refundRequests: store.refundRequests,
    switchStaff,
    lockStaffSession,
    endStaffSession,
    unlockCustomerDisplay,
    addStaff,
    updateStaff,
    resetStaffPin,

    catalogue: store.catalogue,
    modifierGroups: store.modifierGroups,
    upsertItem,
    removeItem: removeItemFromCatalogue,

    ticket,
    ticketTotals,
    tipOptions,
    addItemToTicket,
    addCustomAmount,
    setLineQuantity,
    removeLine,
    clearTicket,

    settleCash,
    settleCard,
    startSplitCharge,
    applyAdjustment,
    voidLine,
    compLine,

    orders: store.orders,
    charges: store.charges,
    refunds: store.refunds,
    unmatched: store.unmatched,
    paymentReconciliations: store.paymentReconciliations,
    adjustments: store.adjustments,
    peripherals,
    nextOrderNumber: store.nextOrderNumber,

    invoices: store.invoices,
    nextInvoiceNumber: store.nextInvoiceNumber,
    invoiceBlockedReason,
    createInvoiceDraft,
    updateInvoiceDraft,
    issueInvoice,
    recordManualInvoicePayment,
    voidInvoice,
    duplicateInvoice,
    invoicePayUriFor,

    counterCodes: store.counterCodes,
    counterPayments: store.counterPayments,
    counterCodeBlockedReason,
    createCounterCode,
    updateCounterCode,
    setCounterCodeActive,
    counterCodePayUriFor,
    counterCodePreviewUri,

    customers: store.customers,
    customerHistory,
    updateCustomerNote,
    startLoyaltyCard,
    redeemLoyaltyReward,
    forgetCustomer,

    taxPeriods,
    exportRecords: store.exportRecords,
    previewReportExport,
    createReportExport,

    settlementRule: store.settlementRule,
    settlementHandoffs,
    updateSettlementRule,

    shifts: store.shifts,
    activeShift,
    shiftReport,
    shiftBlockers,
    paymentBlockedReason,
    openShift,
    closeShift,

    quotableAssets,
    chargeBlockedReason,

    activeCharge,
    openCharge: setActiveChargeId,
    createChargeFromTicket,
    voidCharge,
    closeCharge,
    payUriFor,
    attachPayment,
    dismissUnmatched,
    refundOrder,
    submitRefund,
    submitPaymentRefund,
    approveRefundRequest,
    declineRefundRequest,

    watching,
    watchedLedger,
    watchError,
    queuedChargeCount: runtime.queuedChargeCount,
    expiredChargeCount: runtime.expiredChargeCount,
    pollNow,

    today,
    orderFor,
  }), [
    activeCharge,
    activeShift,
    activeStaff,
    addCustomAmount,
    addItemToTicket,
    addStaff,
    applyAdjustment,
    approveRefundRequest,
    attachPayment,
    chargeBlockedReason,
    clearTicket,
    closeCharge,
    closeShift,
    compLine,
    completeSetup,
    configured,
    counterCodeBlockedReason,
    counterCodePayUriFor,
    counterCodePreviewUri,
    createChargeFromTicket,
    createCounterCode,
    createInvoiceDraft,
    createReportExport,
    customerHistory,
    declineRefundRequest,
    dismissUnmatched,
    duplicateInvoice,
    enabled,
    endStaffSession,
    exportEncryptedArchive,
    exportRecoveryData,
    forgetCustomer,
    invoiceBlockedReason,
    invoicePayUriFor,
    issueInvoice,
    lockStaffSession,
    online,
    onShiftStaff,
    openShift,
    orderFor,
    payUriFor,
    paymentBlockedReason,
    peripherals,
    pollNow,
    previewReportExport,
    quotableAssets,
    ready,
    recordManualInvoicePayment,
    redeemLoyaltyReward,
    refundOrder,
    removeLine,
    removeItemFromCatalogue,
    resetRecoveryData,
    requestPersistentStorage,
    resetStaffPin,
    runtime,
    setCounterCodeActive,
    setEnabled,
    setTillTextSize,
    setLineQuantity,
    settings,
    settleCard,
    settleCash,
    settlementHandoffs,
    shiftBlockers,
    shiftReport,
    startLoyaltyCard,
    startSplitCharge,
    storageError,
    storageHealth,
    storageIssue,
    store,
    submitPaymentRefund,
    submitRefund,
    switchStaff,
    taxPeriods,
    terminal,
    ticket,
    ticketTotals,
    tipOptions,
    today,
    unlockCustomerDisplay,
    updateCounterCode,
    updateCustomerNote,
    updateInvoiceDraft,
    updateSettlementRule,
    updateSettings,
    updateStaff,
    upsertItem,
    voidCharge,
    voidInvoice,
    voidLine,
    watchError,
    watchedLedger,
    watching,
  ]);

  const statusValue = useMemo<MerchantStatusValue>(
    () => ({
      ready,
      storageIssue,
      storageError,
      storageHealth,
      requestPersistentStorage,
      exportEncryptedArchive,
      exportRecoveryData,
      resetRecoveryData,
      online,
      enabled,
      configured,
      setEnabled,
      completeSetup,
      quotableAssets,
      chargeBlockedReason,
      watching,
      watchedLedger,
      watchError,
      queuedChargeCount: runtime.queuedChargeCount,
      expiredChargeCount: runtime.expiredChargeCount,
      pollNow,
    }),
    [
      chargeBlockedReason,
      completeSetup,
      configured,
      enabled,
      exportEncryptedArchive,
      exportRecoveryData,
      online,
      pollNow,
      quotableAssets,
      ready,
      requestPersistentStorage,
      resetRecoveryData,
      runtime.expiredChargeCount,
      runtime.queuedChargeCount,
      setEnabled,
      storageError,
      storageHealth,
      storageIssue,
      watchedLedger,
      watchError,
      watching,
    ],
  );

  const configurationValue = useMemo<MerchantConfigurationValue>(
    () => ({
      settings,
      tillTextSize: store.tillTextSize,
      setTillTextSize,
      updateSettings,
      peripherals,
      settlementRule: store.settlementRule,
      settlementHandoffs,
      updateSettlementRule,
    }),
    [
      peripherals,
      setTillTextSize,
      settings,
      settlementHandoffs,
      store.settlementRule,
      store.tillTextSize,
      updateSettings,
      updateSettlementRule,
    ],
  );

  const staffValue = useMemo<MerchantStaffValue>(
    () => ({
      staff: store.staff,
      activeStaff,
      onShiftStaff,
      terminal,
      refundRequests: store.refundRequests,
      switchStaff,
      lockStaffSession,
      endStaffSession,
      unlockCustomerDisplay,
      addStaff,
      updateStaff,
      resetStaffPin,
      approveRefundRequest,
      declineRefundRequest,
    }),
    [
      activeStaff,
      addStaff,
      approveRefundRequest,
      declineRefundRequest,
      endStaffSession,
      lockStaffSession,
      onShiftStaff,
      resetStaffPin,
      store.refundRequests,
      store.staff,
      switchStaff,
      terminal,
      unlockCustomerDisplay,
      updateStaff,
    ],
  );

  const tillValue = useMemo<MerchantTillValue>(
    () => ({
      catalogue: store.catalogue,
      modifierGroups: store.modifierGroups,
      upsertItem,
      removeItem: removeItemFromCatalogue,
      ticket,
      ticketTotals,
      tipOptions,
      addItemToTicket,
      addCustomAmount,
      setLineQuantity,
      removeLine,
      clearTicket,
      settleCash,
      settleCard,
      startSplitCharge,
      applyAdjustment,
      voidLine,
      compLine,
      nextOrderNumber: store.nextOrderNumber,
      shifts: store.shifts,
      activeShift,
      shiftReport,
      shiftBlockers,
      paymentBlockedReason,
      openShift,
      closeShift,
      createChargeFromTicket,
    }),
    [
      activeShift,
      addCustomAmount,
      addItemToTicket,
      applyAdjustment,
      clearTicket,
      closeShift,
      compLine,
      createChargeFromTicket,
      openShift,
      paymentBlockedReason,
      removeItemFromCatalogue,
      removeLine,
      setLineQuantity,
      settleCard,
      settleCash,
      shiftBlockers,
      shiftReport,
      startSplitCharge,
      store.catalogue,
      store.modifierGroups,
      store.nextOrderNumber,
      store.shifts,
      ticket,
      ticketTotals,
      tipOptions,
      upsertItem,
      voidLine,
    ],
  );

  const recordsValue = useMemo<MerchantRecordsValue>(
    () => ({
      orders: store.orders,
      charges: store.charges,
      refunds: store.refunds,
      unmatched: store.unmatched,
      paymentReconciliations: store.paymentReconciliations,
      adjustments: store.adjustments,
      invoices: store.invoices,
      nextInvoiceNumber: store.nextInvoiceNumber,
      invoiceBlockedReason,
      createInvoiceDraft,
      updateInvoiceDraft,
      issueInvoice,
      recordManualInvoicePayment,
      voidInvoice,
      duplicateInvoice,
      invoicePayUriFor,
      counterCodes: store.counterCodes,
      counterPayments: store.counterPayments,
      counterCodeBlockedReason,
      createCounterCode,
      updateCounterCode,
      setCounterCodeActive,
      counterCodePayUriFor,
      counterCodePreviewUri,
      customers: store.customers,
      customerHistory,
      updateCustomerNote,
      startLoyaltyCard,
      redeemLoyaltyReward,
      forgetCustomer,
      activeCharge,
      openCharge: setActiveChargeId,
      voidCharge,
      closeCharge,
      payUriFor,
      attachPayment,
      dismissUnmatched,
      refundOrder,
      submitRefund,
      submitPaymentRefund,
      orderFor,
    }),
    [
      activeCharge,
      attachPayment,
      closeCharge,
      counterCodeBlockedReason,
      counterCodePayUriFor,
      counterCodePreviewUri,
      createCounterCode,
      createInvoiceDraft,
      customerHistory,
      dismissUnmatched,
      duplicateInvoice,
      forgetCustomer,
      invoiceBlockedReason,
      invoicePayUriFor,
      issueInvoice,
      orderFor,
      payUriFor,
      recordManualInvoicePayment,
      redeemLoyaltyReward,
      refundOrder,
      setCounterCodeActive,
      startLoyaltyCard,
      store.adjustments,
      store.charges,
      store.counterCodes,
      store.counterPayments,
      store.customers,
      store.invoices,
      store.nextInvoiceNumber,
      store.orders,
      store.paymentReconciliations,
      store.refunds,
      store.unmatched,
      submitPaymentRefund,
      submitRefund,
      updateCounterCode,
      updateCustomerNote,
      updateInvoiceDraft,
      voidCharge,
      voidInvoice,
    ],
  );

  const reportingValue = useMemo<MerchantReportingValue>(
    () => ({
      today,
      taxPeriods,
      exportRecords: store.exportRecords,
      previewReportExport,
      createReportExport,
    }),
    [createReportExport, previewReportExport, store.exportRecords, taxPeriods, today],
  );

  const shellValue = useMemo<MerchantShellContextValue>(
    () => ({
      enabled,
      unmatched: store.unmatched,
      charges: store.charges,
      activeShift,
    }),
    [activeShift, enabled, store.charges, store.unmatched],
  );
  const settingsValue = useMemo<MerchantSettingsContextValue>(
    () => ({ enabled, configured, setEnabled, profileName: settings.profile.name }),
    [configured, enabled, setEnabled, settings.profile.name],
  );

  return (
    <MerchantRuntimeDataProviders shell={shellValue} settings={settingsValue}>
      <MerchantStatusContext.Provider value={statusValue}>
        <MerchantConfigurationContext.Provider value={configurationValue}>
          <MerchantStaffContext.Provider value={staffValue}>
            <MerchantTillContext.Provider value={tillValue}>
              <MerchantRecordsContext.Provider value={recordsValue}>
                <MerchantReportingContext.Provider value={reportingValue}>
                  <MerchantContext.Provider value={value}>{children}</MerchantContext.Provider>
                </MerchantReportingContext.Provider>
              </MerchantRecordsContext.Provider>
            </MerchantTillContext.Provider>
          </MerchantStaffContext.Provider>
        </MerchantConfigurationContext.Provider>
      </MerchantStatusContext.Provider>
    </MerchantRuntimeDataProviders>
  );
}

export function useMerchant(): MerchantContextValue {
  const context = useContext(MerchantContext);
  if (!context) throw new Error("useMerchant must be used inside MerchantProvider");
  return context;
}

export function useMerchantStatus(): MerchantStatusValue {
  const context = useContext(MerchantStatusContext);
  if (!context) throw new Error("useMerchantStatus must be used inside MerchantProvider");
  return context;
}

export function useMerchantConfiguration(): MerchantConfigurationValue {
  const context = useContext(MerchantConfigurationContext);
  if (!context) throw new Error("useMerchantConfiguration must be used inside MerchantProvider");
  return context;
}

export function useMerchantStaff(): MerchantStaffValue {
  const context = useContext(MerchantStaffContext);
  if (!context) throw new Error("useMerchantStaff must be used inside MerchantProvider");
  return context;
}

export function useMerchantTill(): MerchantTillValue {
  const context = useContext(MerchantTillContext);
  if (!context) throw new Error("useMerchantTill must be used inside MerchantProvider");
  return context;
}

export function useMerchantRecords(): MerchantRecordsValue {
  const context = useContext(MerchantRecordsContext);
  if (!context) throw new Error("useMerchantRecords must be used inside MerchantProvider");
  return context;
}

export function useMerchantReporting(): MerchantReportingValue {
  const context = useContext(MerchantReportingContext);
  if (!context) throw new Error("useMerchantReporting must be used inside MerchantProvider");
  return context;
}

export { sameAsset, assetKey, isNative };
export { useMerchantSettings, useMerchantShell } from "./useMerchantRuntime";
