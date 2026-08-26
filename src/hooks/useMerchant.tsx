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
import { useWallet } from "./useWallet";
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
  clearMerchantStore,
  loadMerchantStoreResult,
  MERCHANT_STORAGE_KEY,
  prune as pruneMerchantStore,
  saveMerchantStore,
} from "@/lib/merchant/storage";
import {
  commitMerchantUpdate,
  isMerchantStorageError,
  MerchantStorageError,
} from "@/lib/merchant/commit";
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
import { fetchIncomingPayments } from "@/lib/merchant/watch";
import { HorizonRequestError } from "@/lib/horizon";
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

/**
 * What today is measured against. A figure on its own is trivia: nobody can
 * tell a good day from a quiet one without something to hold it beside.
 *
 * Every field is derived from the same settled orders `today` is built from —
 * same network scoping, same `paidAt` filter — so nothing on Insights can
 * disagree with the figure above it. The store keeps 400 days, so the history
 * is genuinely there to be counted rather than estimated.
 */
export interface InsightsHistory {
  /** The same weekday a week ago. Null when the shop has no orders that day. */
  sameDayLastWeek: { takingsMinor: Minor; orderCount: number } | null;
  /** Takings up to the same clock time on that day, for a like-for-like read. */
  sameDayLastWeekToDate: { takingsMinor: Minor; orderCount: number } | null;
  /**
   * Oldest first, one entry per calendar day, days with no trade included.
   * `toDateMinor` is the same day cut at this hour of the clock, so a fortnight
   * ending in a day that is still filling can be plotted like with like instead
   * of setting a part day against thirteen whole ones.
   */
  last14Days: { at: number; takingsMinor: Minor; orderCount: number; toDateMinor: Minor }[];
  /** Mean takings per hour across the last four occurrences of this weekday. */
  typicalByHour: { hour: number; takingsMinor: Minor }[];
  /** Hours of the trading day already elapsed, so a partial day reads as partial. */
  hoursElapsed: number;
}

export type MerchantRefundOutcome =
  | { kind: "refunded"; refund: Refund }
  | { kind: "requested"; request: RefundRequest };

interface MerchantContextValue {
  ready: boolean;
  storageIssue: StorageIssue | null;
  storageError: string | null;
  exportRecoveryData: () => string | null;
  resetRecoveryData: () => void;
  online: boolean;
  enabled: boolean;
  configured: boolean;
  setEnabled: (on: boolean) => void;
  settings: MerchantSettings;
  tillTextSize: MerchantStore["tillTextSize"];
  setTillTextSize: (size: MerchantStore["tillTextSize"]) => void;
  updateSettings: (patch: Partial<MerchantSettings>) => void;
  completeSetup: (
    input: Omit<MerchantSetupInput, "pinDigest"> & { pin: string },
  ) => Promise<void>;

  staff: StaffMember[];
  activeStaff: StaffMember | null;
  terminal: TerminalDevice;
  refundRequests: RefundRequest[];
  switchStaff: (memberId: string, pin: string) => Promise<void>;
  unlockCustomerDisplay: (pin: string) => Promise<StaffMember>;
  addStaff: (input: { name: string; role: StaffRole; pin: string }) => Promise<void>;
  updateStaff: (
    memberId: string,
    patch: Partial<Pick<StaffMember, "name" | "role" | "permissions" | "active">>,
  ) => void;
  resetStaffPin: (memberId: string, pin: string) => Promise<void>;

  catalogue: CatalogueItem[];
  modifierGroups: ModifierGroup[];
  upsertItem: (item: CatalogueItem) => void;
  removeItem: (id: string) => void;

  ticket: Ticket;
  ticketTotals: OrderTotals;
  tipOptions: { label: string; amountMinor: Minor }[];
  addItemToTicket: (item: CatalogueItem, modifiers?: OrderLineModifier[], quantity?: number) => void;
  addCustomAmount: (amountMinor: Minor, label?: string) => void;
  setLineQuantity: (lineId: string, quantity: number) => void;
  removeLine: (lineId: string) => void;
  clearTicket: () => void;

  settleCash: (receivedMinor: Minor) => Order;
  settleCard: (externalReference?: string) => Order;
  startSplitCharge: (input: MerchantSplitTenderInput) => MerchantTenderOutcome;
  applyAdjustment: (input: {
    lineId: string | null;
    amountMinor: Minor;
    reasonCode: string;
  }) => Order | null;
  voidLine: (lineId: string | null, reasonCode: string) => Order | null;
  compLine: (lineId: string | null, reasonCode: string) => Order | null;

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
  }) => Invoice;
  updateInvoiceDraft: (input: {
    invoiceId: string;
    customerName: string;
    customerEmail?: string | null;
    lines: InvoiceLine[];
    dueAt?: number | null;
    note?: string | null;
  }) => Invoice;
  issueInvoice: (invoiceId: string) => Invoice;
  recordManualInvoicePayment: (input: {
    invoiceId: string;
    amountMinor: Minor;
    note?: string | null;
  }) => Invoice;
  voidInvoice: (invoiceId: string, reason: string) => Invoice;
  duplicateInvoice: (invoiceId: string) => Invoice;
  invoicePayUriFor: (invoice: Invoice, asset: AcceptedAsset) => string | null;

  counterCodes: CounterCode[];
  counterPayments: CounterPayment[];
  counterCodeBlockedReason: string | null;
  createCounterCode: (input: MerchantCounterCodeDraft) => CounterCode;
  updateCounterCode: (input: {
    codeId: string;
    title: string;
    suggestedMinor: Minor[];
    staffId: string | null;
    expiresAt: number | null;
    active: boolean;
  }) => CounterCode;
  setCounterCodeActive: (codeId: string, active: boolean) => CounterCode;
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
  updateCustomerNote: (address: string, note: string) => CustomerRecord;
  startLoyaltyCard: (address: string, target?: number) => CustomerRecord;
  redeemLoyaltyReward: (address: string) => CustomerRecord;
  forgetCustomer: (address: string) => void;

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
  }) => { file: ReportFile; record: ExportRecord };

  settlementRule: SettlementRule;
  settlementHandoffs: SettlementHandoffs;
  updateSettlementRule: (patch: Partial<SettlementRule>) => void;

  shifts: Shift[];
  activeShift: Shift | null;
  shiftReport: ShiftReport | null;
  shiftBlockers: ReturnType<typeof unresolvedShiftFlows>;
  paymentBlockedReason: string | null;
  openShift: (floatMinor: Minor) => Shift;
  closeShift: (countedMinor: Minor) => ShiftReport;

  /** Assets that both the shop accepts and the app can price right now. */
  quotableAssets: AcceptedAsset[];
  /** Why a charge cannot be raised, or null when it can. */
  chargeBlockedReason: string | null;

  activeCharge: Charge | null;
  openCharge: (id: string) => void;
  createChargeFromTicket: (tipMinor?: Minor) => Charge;
  voidCharge: (id: string) => void;
  closeCharge: () => void;
  payUriFor: (charge: Charge, asset: AcceptedAsset) => string | null;
  /** File a tray payment against an order by hand. */
  attachPayment: (paymentId: string, chargeId: string) => void;
  dismissUnmatched: (paymentId: string) => void;

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
  declineRefundRequest: (requestId: string) => void;

  watching: boolean;
  watchedLedger: number | null;
  watchError: string | null;
  queuedChargeCount: number;
  expiredChargeCount: number;
  pollNow: () => Promise<void>;

  today: TodaySummary;
  history: InsightsHistory;
  orderFor: (chargeId: string) => Order | null;
}

const MerchantContext = createContext<MerchantContextValue | null>(null);

/** How often the till asks Horizon while a charge is open, and while it is not. */
const POLL_ACTIVE_MS = 4_000;
const POLL_IDLE_MS = 30_000;
const WATCHER_LEASE_MS = 25_000;

/** The span of the trend line on Insights, and the weeks a typical day averages. */
const TREND_DAYS = 14;
const TYPICAL_WEEKS = 4;
const HOUR_MS = 60 * 60 * 1000;

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Local midnight of the calendar day `at` falls in. */
function startOfDay(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Calendar arithmetic, not 24-hour arithmetic. Across a clock change a day is
 * 23 or 25 hours long, and "the same weekday last week" has to come back the
 * same weekday however many hours sat in between.
 */
function shiftDays(dayStart: number, days: number): number {
  const d = new Date(dayStart);
  d.setDate(d.getDate() + days);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfToday(now = Date.now()): number {
  return startOfDay(now);
}

/**
 * Midnight this morning and how far the clock has got past it, read once so the
 * two can never come from different instants.
 */
function todayWindow(now = Date.now()): { start: number; elapsedMs: number } {
  const start = startOfDay(now);
  return { start, elapsedMs: now - start };
}

export function MerchantProvider({ children }: { children: React.ReactNode }) {
  const {
    phase,
    network,
    activeAccount,
    balances,
    minimumBalanceXlm,
    recommendedBaseFeeStroops,
    xlmPriceUsd,
    fiatRates,
    contacts,
    send,
    submissionStatus,
  } = useWallet();

  const [store, setStore] = useState<MerchantStore>(() => emptyStore());
  const [ready, setReady] = useState(false);
  const [storageIssue, setStorageIssue] = useState<StorageIssue | null>(null);
  const storageIssueRef = useRef<StorageIssue | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
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
  const [staffSessionId, setStaffSessionId] = useState<string | null>(null);
  const reportingNow = useLiveNow(LIVE_MINUTE_MS);
  const storeRef = useRef(store);
  const [writerId] = useState(createMerchantWriterId);
  const revisionChannelRef = useRef<MerchantRevisionChannel | null>(null);
  const pinAttempts = useRef(new Map<string, PinAttemptState>());
  const polling = useRef(false);
  const pollRef = useRef<() => Promise<void>>(async () => {});

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
    storageIssueRef.current = null;
    setStorageIssue(null);
    setStorageError(null);
    storeRef.current = next;
    setStore(next);
  }, []);

  const readMerchantKey = useCallback(() => {
    try {
      return getMerchantEncryptionKey();
    } catch (error) {
      if (error instanceof VaultLockedError) throw new MerchantStorageError("vault_locked");
      throw error;
    }
  }, []);

  const reloadExternalStore = useCallback(
    (allowAbsent: boolean) => {
      let key: Uint8Array;
      try {
        key = readMerchantKey();
      } catch (error) {
        if (isMerchantStorageError(error) && error.code === "vault_locked") return;
        throw error;
      }
      const result = loadMerchantStoreResult(key);
      if (result.kind === "ready") {
        const newer = newerMerchantStore(storeRef.current, result.value);
        if (newer) installLoadedStore(newer);
        return;
      }
      if (result.kind === "absent") {
        if (allowAbsent) installLoadedStore(emptyStore());
        return;
      }
      if (result.kind === "locked") return;
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
        setStaffSessionId(null);
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
      const result = loadMerchantStoreResult(key);
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
  }, [installLoadedStore, phase, readMerchantKey]);

  useEffect(() => {
    if (!ready) return;
    const onRevision = () => reloadExternalStore(false);
    const onStorage = (event: StorageEvent) => {
      if (event.key === MERCHANT_STORAGE_KEY) reloadExternalStore(event.newValue === null);
    };
    const channel = openMerchantRevisionChannel(onRevision);
    revisionChannelRef.current = channel;
    window.addEventListener("storage", onStorage);
    return () => {
      revisionChannelRef.current = null;
      channel.close();
      window.removeEventListener("storage", onStorage);
    };
  }, [ready, reloadExternalStore]);

  const commitStore = useCallback(
    (update: MerchantStore | ((current: MerchantStore) => MerchantStore)): void => {
      try {
        const current = storeRef.current;
        if (storageIssueRef.current) {
          commitMerchantUpdate({
            current,
            update,
            locked: true,
            save: saveMerchantStore,
            publish: () => {},
          });
          return;
        }
        const key = readMerchantKey();
        const persistedResult = loadMerchantStoreResult(key);
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
        const committed = commitMerchantUpdate({
          current,
          update: coordinated,
          save: (next) => saveMerchantStore(next, key),
          publish: (next) => {
            storeRef.current = next;
            setStore(next);
          },
        });
        revisionChannelRef.current?.postRevision(committed);
        setStorageError(null);
      } catch (error) {
        if (isMerchantStorageError(error)) setStorageError(error.message);
        throw error;
      }
    },
    [installLoadedStore, readMerchantKey, writerId],
  );

  const persist = useCallback(
    (update: MerchantStore | ((current: MerchantStore) => MerchantStore)) => {
      try {
        commitStore(update);
      } catch (error) {
        if (!isMerchantStorageError(error)) throw error;
      }
    },
    [commitStore],
  );

  const exportRecoveryData = useCallback(() => storageIssueRef.current?.raw ?? null, []);
  const resetRecoveryData = useCallback(() => {
    clearMerchantStore();
    const fresh = emptyStore();
    storageIssueRef.current = null;
    setStorageIssue(null);
    setStorageError(null);
    storeRef.current = fresh;
    setStore(fresh);
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
        (refund.submissionStatus !== "accepted" && refund.submissionStatus !== "status_unknown")
      ) {
        continue;
      }
      const resolved = submissionStatus({
        hash: refund.transactionHash,
        network: refund.network,
        status: refund.submissionStatus,
      });
      if (resolved !== refund.submissionStatus) {
        next = reconcileRefundSubmission(next, refund.id, resolved);
      }
    }
    if (next === current) return;
    try {
      commitStore(next);
    } catch (error) {
      if (!isMerchantStorageError(error)) throw error;
    }
  }, [commitStore, ready, store.refunds, submissionStatus]);

  const settings = store.settings;
  const enabled = settings.enabled;
  const configured = !needsMerchantSetup(settings, store.staff);

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
      commitStore(next);
      setStaffSessionId(next.activeStaffId);
    },
    [commitStore],
  );

  const activeStaff = useMemo(
    () =>
      staffSessionId === store.activeStaffId
        ? store.staff.find((member) => member.id === staffSessionId && member.active) ?? null
        : null,
    [staffSessionId, store.activeStaffId, store.staff],
  );

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
    (input: {
      from: number;
      to: number;
      basis: ReportBasis;
      format: ReportFormat;
    }): { file: ReportFile; record: ExportRecord } => {
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
      commitStore(created.store);
      return { file: created.file, record: created.record };
    },
    [commitStore, network, staffSessionId],
  );

  const updateSettlementRule = useCallback(
    (patch: Partial<SettlementRule>): void => {
      commitStore(updatePersistedSettlementRule(storeRef.current, patch));
    },
    [commitStore],
  );

  useEffect(() => {
    if (!ready) return;
    const current = storeRef.current;
    const next = syncCustomerContacts(current, contacts);
    if (next !== current) commitStore(next);
  }, [commitStore, contacts, ready]);

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

  const openShift = useCallback((floatMinor: Minor): Shift => {
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
    commitStore(opened.store);
    return opened.shift;
  }, [commitStore, network, staffSessionId]);

  const closeShift = useCallback((countedMinor: Minor): ShiftReport => {
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
    commitStore(closed.store);
    return closed.report;
  }, [commitStore, staffSessionId, ticket.lines.length]);

  const switchStaff = useCallback(async (memberId: string, pin: string): Promise<void> => {
    const current = storeRef.current;
    const member = current.staff.find((entry) => entry.id === memberId && entry.active);
    if (!member?.pinDigest) throw new Error("This staff member does not have a PIN yet.");
    const now = Date.now();
    const prior = pinAttempts.current.get(memberId) ?? { failures: 0, blockedUntil: 0 };
    if (now < prior.blockedUntil) {
      const seconds = Math.max(1, Math.ceil((prior.blockedUntil - now) / 1000));
      throw new Error(`Too many wrong PINs. Try again in ${seconds} seconds.`);
    }
    const verified = await verifyMerchantPin(pin, member.pinDigest);
    const attempt = nextPinAttempt(prior, verified, now);
    pinAttempts.current.set(memberId, attempt.state);
    if (!verified) {
      throw new Error(
        attempt.blocked
          ? "Too many wrong PINs. Try again in 30 seconds."
          : "That PIN is not correct.",
      );
    }
    commitStore({ ...current, activeStaffId: member.id });
    setStaffSessionId(member.id);
  }, [commitStore]);

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
    commitStore(next);
  }, [commitStore, staffSessionId]);

  const updateStaff = useCallback((
    memberId: string,
    patch: Partial<Pick<StaffMember, "name" | "role" | "permissions" | "active">>,
  ): void => {
    const actorId = staffSessionId;
    if (!actorId) throw new Error("Choose an owner before changing staff.");
    commitStore(updateStaffMember(storeRef.current, actorId, memberId, patch));
  }, [commitStore, staffSessionId]);

  const resetStaffPin = useCallback(async (memberId: string, pin: string): Promise<void> => {
    const actorId = staffSessionId;
    if (!actorId) throw new Error("Choose an owner before resetting a PIN.");
    const pinDigest = await createMerchantPinCredential(pin);
    commitStore(updateStaffMember(storeRef.current, actorId, memberId, {
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

  const createInvoiceDraft = useCallback((input: {
    customerName: string;
    customerEmail?: string | null;
    lines: InvoiceLine[];
    dueAt?: number | null;
    note?: string | null;
  }): Invoice => {
    const current = storeRef.current;
    const actor = requireInvoiceActor(current);
    const created = createPersistedInvoiceDraft(current, {
      ...input,
      id: uid("inv"),
      actor,
      network,
      now: Date.now(),
    });
    commitStore(created.store);
    return created.invoice;
  }, [commitStore, network, requireInvoiceActor]);

  const updateInvoiceDraft = useCallback((input: {
    invoiceId: string;
    customerName: string;
    customerEmail?: string | null;
    lines: InvoiceLine[];
    dueAt?: number | null;
    note?: string | null;
  }): Invoice => {
    const current = storeRef.current;
    const actor = requireInvoiceActor(current);
    const updated = updatePersistedInvoiceDraft(current, {
      ...input,
      actor,
      network,
      now: Date.now(),
    });
    commitStore(updated.store);
    return updated.invoice;
  }, [commitStore, network, requireInvoiceActor]);

  const issueInvoice = useCallback((invoiceId: string): Invoice => {
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
    commitStore(issued.store);
    return issued.invoice;
  }, [commitStore, network, quoteInputs, requireInvoiceActor]);

  const recordManualInvoicePayment = useCallback((input: {
    invoiceId: string;
    amountMinor: Minor;
    note?: string | null;
  }): Invoice => {
    const current = storeRef.current;
    const actor = requireInvoiceActor(current);
    const settled = recordPersistedManualInvoicePayment(current, {
      ...input,
      paymentId: uid("invpay"),
      actor,
      now: Date.now(),
    });
    commitStore(settled.store);
    return settled.invoice;
  }, [commitStore, requireInvoiceActor]);

  const voidInvoice = useCallback((invoiceId: string, reason: string): Invoice => {
    const current = storeRef.current;
    const actor = requireInvoiceActor(current);
    const voided = voidPersistedInvoice(current, {
      invoiceId,
      actor,
      reason,
      now: Date.now(),
    });
    commitStore(voided.store);
    return voided.invoice;
  }, [commitStore, requireInvoiceActor]);

  const duplicateInvoice = useCallback((invoiceId: string): Invoice => {
    const current = storeRef.current;
    const actor = requireInvoiceActor(current);
    const duplicate = duplicatePersistedInvoice(current, {
      invoiceId,
      id: uid("inv"),
      actor,
      now: Date.now(),
    });
    commitStore(duplicate.store);
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

  const createCounterCode = useCallback((input: MerchantCounterCodeDraft): CounterCode => {
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
    commitStore(final.store);
    return final.code;
  }, [commitStore, network, rateFor, requireCounterCodeActor]);

  const updateCounterCode = useCallback((input: {
    codeId: string;
    title: string;
    suggestedMinor: Minor[];
    staffId: string | null;
    expiresAt: number | null;
    active: boolean;
  }): CounterCode => {
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
    commitStore(final.store);
    return final.code;
  }, [commitStore, requireCounterCodeActor]);

  const setCounterCodeActive = useCallback((codeId: string, active: boolean): CounterCode => {
    const current = storeRef.current;
    const actor = requireCounterCodeActor(current);
    const changed = setPersistedCounterCodeActive(current, {
      codeId,
      actor,
      active,
      now: Date.now(),
    });
    commitStore(changed.store);
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

  const updateCustomerNote = useCallback((address: string, note: string): CustomerRecord => {
    const next = updatePersistedCustomerNote(storeRef.current, address, note);
    commitStore(next);
    return next.customers.find((customer) => customer.address === address) as CustomerRecord;
  }, [commitStore]);

  const startLoyaltyCard = useCallback((address: string, target = 10): CustomerRecord => {
    const current = storeRef.current;
    const next = startPersistedLoyaltyCard(current, {
      address,
      target,
      actor: requireCustomerActor(current),
      eventId: uid("loyalty"),
      now: Date.now(),
    });
    commitStore(next);
    return next.customers.find((customer) => customer.address === address) as CustomerRecord;
  }, [commitStore, requireCustomerActor]);

  const redeemLoyaltyReward = useCallback((address: string): CustomerRecord => {
    const current = storeRef.current;
    const next = redeemPersistedLoyaltyReward(current, {
      address,
      actor: requireCustomerActor(current),
      eventId: uid("loyalty"),
      now: Date.now(),
    });
    commitStore(next);
    return next.customers.find((customer) => customer.address === address) as CustomerRecord;
  }, [commitStore, requireCustomerActor]);

  const forgetCustomer = useCallback((address: string): void => {
    const current = storeRef.current;
    const next = forgetPersistedCustomer(current, address);
    if (next !== current) commitStore(next);
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

  const settleCash = useCallback((receivedMinor: Minor): Order => {
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
    commitStore(committed.store);
    clearTicket();
    return committed.order;
  }, [buildTicketOrder, clearTicket, commitStore, requirePaymentActor, ticket]);

  const settleCard = useCallback((externalReference?: string): Order => {
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
    commitStore(committed.store);
    clearTicket();
    return committed.order;
  }, [buildTicketOrder, clearTicket, commitStore, requirePaymentActor, ticket]);

  const startSplitCharge = useCallback((input: MerchantSplitTenderInput): MerchantTenderOutcome => {
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
      commitStore(committed.store);
      clearTicket();
      return { order: committed.order, charge: null };
    }

    const awaiting = awaitNewOrder(current, order, parts, ticket.adjustments);
    const charge = cryptoChargeFor(awaiting.order, amounts[cryptoIndex], current, now);
    commitStore({ ...awaiting.store, charges: [charge, ...awaiting.store.charges] });
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
  ]);

  const adjustTicket = useCallback((
    kind: AdjustmentKind,
    lineId: string | null,
    amountMinor: Minor,
    reasonCode: string,
  ): Order | null => {
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
      commitStore(committed.store);
      clearTicket();
      return committed.order;
    }

    if (result.totals.totalMinor === 0) {
      const adjustedTicket: Ticket = { ...result.ticket, adjustments };
      const order = buildTicketOrder(current, adjustedTicket, actor, now);
      const committed = settleNewOrder(current, order, [], adjustments, now);
      commitStore(committed.store);
      clearTicket();
      return committed.order;
    }

    setTicket({ ...result.ticket, adjustments });
    return null;
  }, [buildTicketOrder, clearTicket, commitStore, staffSessionId, ticket]);

  const applyAdjustment = useCallback((input: {
    lineId: string | null;
    amountMinor: Minor;
    reasonCode: string;
  }): Order | null => adjustTicket(
    "discount",
    input.lineId,
    input.amountMinor,
    input.reasonCode,
  ), [adjustTicket]);

  const voidLine = useCallback(
    (lineId: string | null, reasonCode: string): Order | null =>
      adjustTicket("void", lineId, 0, reasonCode),
    [adjustTicket],
  );

  const compLine = useCallback(
    (lineId: string | null, reasonCode: string): Order | null =>
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
  const createChargeFromTicket = useCallback((tipMinorOverride?: Minor): Charge => {
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
    commitStore({ ...awaiting.store, charges: [charge, ...awaiting.store.charges] });
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
    (id: string) => {
      const current = storeRef.current;
      commitStore({
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
    const timer = setInterval(() => {
      const now = Date.now();
      const current = storeRef.current;
      const stale = current.charges.some((c) => c.status === "awaiting" && now >= c.expiresAt);
      if (!stale) return;
      try {
        commitStore({
          ...current,
          charges: current.charges.map((c) =>
            c.status === "awaiting" && now >= c.expiresAt ? { ...c, status: "expired" as const } : c,
          ),
        });
      } catch (error) {
        if (!isMerchantStorageError(error)) throw error;
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [commitStore, enabled]);

  /* ---------------- the watcher ---------------- */

  const applyPayments = useCallback(
    (payments: ObservedPayment[]) => {
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
      if (withCustomers !== current) commitStore(withCustomers);
    },
    [commitStore, contacts, network, quoteInputs],
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

  const activeWatcherLeaseKey = useMemo(
    () => settings.receivingPublicKey
      ? watcherLeaseKey(network, settings.receivingPublicKey)
      : null,
    [network, settings.receivingPublicKey],
  );

  useEffect(() => {
    const release = () => {
      if (activeWatcherLeaseKey) {
        releaseWatcherLease(window.localStorage, activeWatcherLeaseKey, writerId);
      }
    };
    window.addEventListener("pagehide", release);
    return () => {
      window.removeEventListener("pagehide", release);
      release();
    };
  }, [activeWatcherLeaseKey, writerId]);

  const pollNow = useCallback(async () => {
    const till = settings.receivingPublicKey;
    if (!enabled || !online || !till || polling.current) return;
    const leaseKey = watcherLeaseKey(network, till);
    if (
      !claimWatcherLease(
        window.localStorage,
        leaseKey,
        writerId,
        Date.now(),
        WATCHER_LEASE_MS,
      )
    ) {
      return;
    }
    polling.current = true;
    try {
      const result = await fetchIncomingPayments({
        publicKey: till,
        network,
        cursor: store.cursors[network] ?? null,
      });
      if (result.latestLedger) setWatchedLedger(result.latestLedger);
      applyPayments(result.payments);
      if (result.cursor) {
        persist((prev) => ({ ...prev, cursors: { ...prev.cursors, [network]: result.cursor } }));
      }
      setWatchError(null);
    } catch (error) {
      if (isMerchantStorageError(error)) {
        setWatchError(null);
      } else {
        setWatchError(describeWatchFailure(error));
      }
    } finally {
      polling.current = false;
    }
  }, [applyPayments, enabled, network, online, persist, settings.receivingPublicKey, store.cursors, writerId]);

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

  // `pollNow` is rebuilt whenever the cursor advances. The timer must not restart
  // that often, so it reads the latest callback through a ref instead of closing
  // over one — otherwise every tick would replay the same Horizon page.
  useEffect(() => {
    pollRef.current = pollNow;
  }, [pollNow]);

  useEffect(() => {
    if (!enabled || !online || !settings.receivingPublicKey) return;
    let alive = true;
    void (async () => {
      await Promise.resolve();
      if (alive) await pollRef.current();
    })();
    const interval = setInterval(() => {
      void pollRef.current();
    }, hasLiveCharge || hasLiveInvoice ? POLL_ACTIVE_MS : POLL_IDLE_MS);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [enabled, hasLiveCharge, hasLiveInvoice, network, online, settings.receivingPublicKey]);

  /* ---------------- tray ---------------- */

  const attachPayment = useCallback(
    (paymentId: string, chargeId: string) => {
      const current = storeRef.current;
      const actor = requirePaymentActor(current);
      const attached = attachReconciledPayment(current, {
        paymentId,
        chargeId,
        actor,
        now: Date.now(),
      });
      commitStore(reconcileCustomerSettlements(current, attached, { contacts }));
    },
    [commitStore, contacts, requirePaymentActor],
  );

  const dismissUnmatched = useCallback(
    (paymentId: string) => {
      const current = storeRef.current;
      const actor = requirePaymentActor(current);
      commitStore(dismissReconciledPayment(current, {
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
      const order = current.orders.find((entry) => entry.id === orderId);
      const charge = current.charges.find((entry) => entry.orderId === orderId && entry.payment);
      if (!order || !charge?.payment) throw new Error("This order has no settled payment to refund.");
      if (order.network !== network) throw new Error("Switch to the order's Stellar network before refunding it.");
      if (activeAccount?.publicKey !== charge.destination) {
        throw new Error("Switch to the receiving account that took this payment before refunding it.");
      }
      const priorRefunds = current.refunds.filter(
        (refund) =>
          refund.kind === "order" &&
          refund.orderId === orderId &&
          refundReservesFunds(refund),
      );
      const refundedMinor = priorRefunds.reduce((sum, refund) => sum + refund.amountMinor, 0);
      const remainingMinor = availableRefundMinor(current, orderId, approvalRequestId);
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor > remainingMinor) {
        throw new Error(`Only ${remainingMinor} minor units remain refundable on this order.`);
      }

      // Calculate against cumulative refunded value so repeated partial refunds
      // return every final stroop without floating-point drift.
      const paymentStroops = toStroops(charge.payment.amount);
      const priorRefundStroops = priorRefunds.reduce(
        (sum, refund) => sum + toStroops(refund.amount),
        BigInt(0),
      );
      const cumulativeMinor = refundedMinor + amountMinor;
      const cumulativeStroops =
        (paymentStroops * BigInt(cumulativeMinor)) / BigInt(order.totals.totalMinor);
      const refundStroops = cumulativeStroops - priorRefundStroops;
      if (refundStroops <= BigInt(0)) throw new Error("This refund is below the asset's minimum precision.");
      const amount = fromStroops(refundStroops);

      const result = await send({
        destination: charge.payment.from,
        amount,
        assetCode: charge.payment.asset.code,
        issuer: charge.payment.asset.issuer,
        memo: { type: "text", value: `RF${order.number}` },
      });

      const refund: Refund = {
        id: uid("rfd"),
        orderId,
        kind: "order",
        sourcePaymentId: null,
        network: order.network,
        amountMinor,
        asset: charge.payment.asset,
        amount,
        destination: charge.payment.from,
        reason,
        note: note?.trim() || null,
        transactionHash: result.hash,
        submissionStatus: result.status,
        createdAt: Date.now(),
      };

      const latest = storeRef.current;
      commitStore(recordRefundSubmission(latest, refund));
      return refund;
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
    commitStore(requested.store);
    return { kind: "requested", request: requested.request };
  }, [commitStore, refundOrder, staffSessionId]);

  const refundReconciledPayment = useCallback(async ({
    paymentId,
    note,
  }: {
    paymentId: string;
    note?: string;
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
    const order = reconciliation.orderId
      ? current.orders.find((entry) => entry.id === reconciliation.orderId) ?? null
      : null;
    const charge = reconciliation.chargeId
      ? current.charges.find((entry) => entry.id === reconciliation.chargeId) ?? null
      : null;
    if (!order || !charge) throw new Error("The payment's original order is no longer available.");
    if (reconciliation.network !== network) {
      throw new Error("Switch to the payment's Stellar network before refunding it.");
    }
    if (activeAccount?.publicKey !== charge.destination) {
      throw new Error("Switch to the receiving account that took this payment before refunding it.");
    }

    const payment = reconciliation.payment;
    const result = await send({
      destination: payment.from,
      amount: payment.amount,
      assetCode: payment.asset.code,
      issuer: payment.asset.issuer,
      memo: { type: "text", value: `DP${order.number}` },
    });
    const now = Date.now();
    const refund: Refund = {
      id: uid("rfd"),
      orderId: order.id,
      kind: "payment_reversal",
      sourcePaymentId: reconciliation.id,
      network: reconciliation.network,
      amountMinor,
      asset: payment.asset,
      amount: payment.amount,
      destination: payment.from,
      reason: reconciliation.outcome === "overpaid" ? "overpayment" : "duplicate",
      note: note?.trim() || null,
      transactionHash: result.hash,
      submissionStatus: result.status,
      createdAt: now,
    };
    const recorded = recordRefundSubmission(storeRef.current, refund);
    if (refund.submissionStatus === "failed") {
      // Keep the incoming payment in review: a canonical failure proves no
      // money moved and the operator may safely retry after correcting it.
      commitStore(recorded);
      return refund;
    }
    const resolved = markReconciledRefund(recorded, {
      paymentId,
      refundId: refund.id,
      actor: member as StaffMember,
      now,
    });
    commitStore(resolved);
    return refund;
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
    commitStore(requested.store);
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
        })
      : await refundOrder({
          orderId: request.orderId,
          amountMinor: request.amountMinor,
          reason: request.reason,
          note: request.note ?? undefined,
          approvalRequestId: request.id,
        });
    commitStore(decideRefundRequest(storeRef.current, {
      requestId,
      reviewerId,
      decision: "approved",
      now: Date.now(),
      refundId: refund.id,
    }));
    return refund;
  }, [commitStore, refundOrder, refundReconciledPayment, staffSessionId]);

  const declineRefundRequest = useCallback((requestId: string): void => {
    const current = storeRef.current;
    if (!staffSessionId) throw new Error("Choose a staff member before reviewing refunds.");
    commitStore(decideRefundRequest(current, {
      requestId,
      reviewerId: staffSessionId,
      decision: "declined",
      now: Date.now(),
    }));
  }, [commitStore, staffSessionId]);

  /* ---------------- derived ---------------- */

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
      const charge = store.charges.find((c) => c.orderId === order.id && c.payment);
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
  }, [network, reportingNow, store.charges, store.orders, store.refunds]);

  /**
   * The same ledger of settled orders, read backwards. It recomputes on exactly
   * the inputs `today` does, so the two are always a matched pair: a comparison
   * built from a different moment than the figure it qualifies would be worse
   * than no comparison at all.
   */
  const history = useMemo<InsightsHistory>(() => {
    const { start: todayStart, elapsedMs } = todayWindow(reportingNow);

    const paid = store.orders.filter(
      (o) => o.network === network && o.paidAt !== null,
    );

    // One pass over the retained orders: totals per calendar day, the same
    // totals cut off at this hour of the clock, and takings per hour per day.
    const days = new Map<number, { takingsMinor: Minor; orderCount: number }>();
    const toClock = new Map<number, { takingsMinor: Minor; orderCount: number }>();
    const hours = new Map<number, Map<number, Minor>>();

    for (const order of paid) {
      const at = order.paidAt as number;
      const dayStart = startOfDay(at);
      const total = order.totals.totalMinor;

      const day = days.get(dayStart) ?? { takingsMinor: 0, orderCount: 0 };
      day.takingsMinor += total;
      day.orderCount += 1;
      days.set(dayStart, day);

      if (at - dayStart < elapsedMs) {
        const sofar = toClock.get(dayStart) ?? { takingsMinor: 0, orderCount: 0 };
        sofar.takingsMinor += total;
        sofar.orderCount += 1;
        toClock.set(dayStart, sofar);
      }

      const perHour = hours.get(dayStart) ?? new Map<number, Minor>();
      const hour = new Date(at).getHours();
      perHour.set(hour, (perHour.get(hour) ?? 0) + total);
      hours.set(dayStart, perHour);
    }

    const lastWeekStart = shiftDays(todayStart, -7);
    const lastWeek = days.get(lastWeekStart) ?? null;

    const last14Days = Array.from({ length: TREND_DAYS }, (_, i) => {
      const dayStart = shiftDays(todayStart, i - (TREND_DAYS - 1));
      const day = days.get(dayStart);
      return {
        at: dayStart,
        takingsMinor: day?.takingsMinor ?? 0,
        orderCount: day?.orderCount ?? 0,
        // The same one-pass `toClock` totals the lead's comparison is drawn
        // from, kept for every day rather than for last week alone.
        toDateMinor: toClock.get(dayStart)?.takingsMinor ?? 0,
      };
    });

    // Averaged over the same weekdays that actually traded, not over four flat:
    // a shop a fortnight old has two Mondays, and dividing them by four would
    // draw a typical day at half its height for today to beat.
    const weekdays = Array.from({ length: TYPICAL_WEEKS }, (_, i) =>
      shiftDays(todayStart, -7 * (i + 1)),
    ).filter((dayStart) => days.has(dayStart));

    const typicalTotals = new Map<number, Minor>();
    for (const dayStart of weekdays) {
      for (const [hour, minor] of hours.get(dayStart) ?? []) {
        typicalTotals.set(hour, (typicalTotals.get(hour) ?? 0) + minor);
      }
    }

    return {
      sameDayLastWeek: lastWeek ? { ...lastWeek } : null,
      // Paired with the full day deliberately: a day that traded but had taken
      // nothing by this hour is a real zero, not a missing figure.
      sameDayLastWeekToDate: lastWeek
        ? { ...(toClock.get(lastWeekStart) ?? { takingsMinor: 0, orderCount: 0 }) }
        : null,
      last14Days,
      typicalByHour: [...typicalTotals.entries()]
        .map(([hour, minor]) => ({ hour, takingsMinor: Math.round(minor / weekdays.length) }))
        .sort((a, b) => a.hour - b.hour),
      hoursElapsed: elapsedMs / HOUR_MS,
    };
  }, [network, reportingNow, store.orders]);

  const activeCharge = useMemo(
    () => store.charges.find((c) => c.id === activeChargeId) ?? null,
    [activeChargeId, store.charges],
  );

  const runtime = useMemo(
    () =>
      merchantRuntimeState({
        online,
        vaultPhase: phase,
        watchError,
        charges: store.charges,
        network,
        now: reportingNow,
      }),
    [network, online, phase, reportingNow, store.charges, watchError],
  );

  const value = useMemo<MerchantContextValue>(() => ({
    ready,
    storageIssue,
    storageError,
    exportRecoveryData,
    resetRecoveryData,
    online,
    enabled,
    configured,
    setEnabled: (on) =>
      persist((prev) =>
        on && needsMerchantSetup(prev.settings, prev.staff)
          ? prev
          : { ...prev, settings: { ...prev.settings, enabled: on } },
      ),
    settings,
    tillTextSize: store.tillTextSize,
    setTillTextSize: (size) => persist((prev) => ({ ...prev, tillTextSize: size })),
    updateSettings: (patch) =>
      persist((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } })),
    completeSetup,

    staff: store.staff,
    activeStaff,
    terminal: {
      ...store.terminal,
      name: settings.terminalName,
      queuedCharges: runtime.queuedChargeCount,
    },
    refundRequests: store.refundRequests,
    switchStaff,
    unlockCustomerDisplay,
    addStaff,
    updateStaff,
    resetStaffPin,

    catalogue: store.catalogue,
    modifierGroups: store.modifierGroups,
    upsertItem: (item) =>
      persist((prev) => ({
        ...prev,
        catalogue: prev.catalogue.some((i) => i.id === item.id)
          ? prev.catalogue.map((i) => (i.id === item.id ? item : i))
          : [...prev.catalogue, item],
      })),
    removeItem: (id) =>
      persist((prev) => ({ ...prev, catalogue: prev.catalogue.filter((i) => i.id !== id) })),

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
    peripherals: [...BROWSER_PERIPHERALS],
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
    invoicePayUriFor: (invoice, asset) => {
      try {
        return invoicePayUri(invoice, asset, settings.profile.name);
      } catch {
        return null;
      }
    },

    counterCodes: store.counterCodes,
    counterPayments: store.counterPayments,
    counterCodeBlockedReason,
    createCounterCode,
    updateCounterCode,
    setCounterCodeActive,
    counterCodePayUriFor: (code, asset) => {
      try {
        return counterCodePayUri(code, asset);
      } catch {
        return null;
      }
    },
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
    closeCharge: () => setActiveChargeId(null),
    payUriFor: (charge, asset) => {
      const quote = quoteFor(charge, asset);
      return quote ? chargePayUri(charge, quote, settings.profile.name) : null;
    },
    attachPayment,
    dismissUnmatched,
    refundOrder,
    submitRefund,
    submitPaymentRefund,
    approveRefundRequest,
    declineRefundRequest,

    watching: online && enabled && Boolean(settings.receivingPublicKey),
    watchedLedger,
    watchError,
    queuedChargeCount: runtime.queuedChargeCount,
    expiredChargeCount: runtime.expiredChargeCount,
    pollNow,

    today,
    history,
    orderFor: (chargeId) => {
      const charge = store.charges.find((c) => c.id === chargeId);
      return charge ? (store.orders.find((o) => o.id === charge.orderId) ?? null) : null;
    },
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
    closeShift,
    compLine,
    completeSetup,
    configured,
    counterCodeBlockedReason,
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
    exportRecoveryData,
    forgetCustomer,
    history,
    invoiceBlockedReason,
    issueInvoice,
    online,
    openShift,
    paymentBlockedReason,
    persist,
    pollNow,
    previewReportExport,
    quotableAssets,
    ready,
    recordManualInvoicePayment,
    redeemLoyaltyReward,
    refundOrder,
    removeLine,
    resetRecoveryData,
    resetStaffPin,
    runtime,
    setCounterCodeActive,
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
    storageIssue,
    store,
    submitPaymentRefund,
    submitRefund,
    switchStaff,
    taxPeriods,
    ticket,
    ticketTotals,
    tipOptions,
    today,
    unlockCustomerDisplay,
    updateCounterCode,
    updateCustomerNote,
    updateInvoiceDraft,
    updateSettlementRule,
    updateStaff,
    voidCharge,
    voidInvoice,
    voidLine,
    watchError,
    watchedLedger,
  ]);

  return <MerchantContext.Provider value={value}>{children}</MerchantContext.Provider>;
}

export function useMerchant(): MerchantContextValue {
  const context = useContext(MerchantContext);
  if (!context) throw new Error("useMerchant must be used inside MerchantProvider");
  return context;
}

export { sameAsset, assetKey, isNative };
