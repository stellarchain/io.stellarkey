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
import { fetchAssetPrices, getUnitPrice, type AssetPrices } from "@/lib/prices";
import {
  assetKey,
  chargePayUri,
  createCharge,
  isNative,
  liveCharges,
  orderReference,
  quoteFor,
  sameAsset,
  secondsRemaining,
  type QuoteInput,
} from "@/lib/merchant/charge";
import { chargeStatusFor, matchPayment, type ObservedPayment } from "@/lib/merchant/match";
import {
  fromStroops,
  lineGrossMinor,
  orderTotals,
  tipPresets,
  toStroops,
} from "@/lib/merchant/money";
import { loadMerchantStore, saveMerchantStore } from "@/lib/merchant/storage";
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
  canReleaseRefund,
  createRefundRequest,
  decideRefundRequest,
  nextPinAttempt,
  updateStaffMember,
  type PinAttemptState,
} from "@/lib/merchant/permissions";
import { fetchIncomingPayments } from "@/lib/merchant/watch";
import { HorizonRequestError } from "@/lib/horizon";
import type {
  AcceptedAsset,
  CatalogueItem,
  Charge,
  MerchantSettings,
  MerchantStore,
  Minor,
  ModifierGroup,
  Order,
  OrderLine,
  OrderLineModifier,
  OrderTotals,
  Refund,
  RefundReason,
  RefundRequest,
  StaffMember,
  StaffRole,
  TerminalDevice,
  UnmatchedPayment,
} from "@/lib/merchant/types";

/** The ticket being rung up. It only becomes an Order when it is charged. */
export interface Ticket {
  lines: OrderLine[];
  discountMinor: Minor;
  tipMinor: Minor;
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
  enabled: boolean;
  configured: boolean;
  setEnabled: (on: boolean) => void;
  settings: MerchantSettings;
  tillTextSize: MerchantStore["tillTextSize"];
  updateSettings: (patch: Partial<MerchantSettings>) => void;
  completeSetup: (
    input: Omit<MerchantSetupInput, "pinDigest"> & { pin: string },
  ) => Promise<void>;

  staff: StaffMember[];
  activeStaff: StaffMember | null;
  terminal: TerminalDevice;
  refundRequests: RefundRequest[];
  switchStaff: (memberId: string, pin: string) => Promise<void>;
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
  setDiscount: (minor: Minor) => void;
  setTip: (minor: Minor) => void;
  clearTicket: () => void;

  orders: Order[];
  charges: Charge[];
  refunds: Refund[];
  unmatched: UnmatchedPayment[];

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
  secondsLeft: (charge: Charge) => number;

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
  approveRefundRequest: (requestId: string) => Promise<Refund>;
  declineRefundRequest: (requestId: string) => void;

  watching: boolean;
  watchedLedger: number | null;
  watchError: string | null;
  pollNow: () => Promise<void>;

  today: TodaySummary;
  history: InsightsHistory;
  orderFor: (chargeId: string) => Order | null;
}

const MerchantContext = createContext<MerchantContextValue | null>(null);

/** How often the till asks Horizon while a charge is open, and while it is not. */
const POLL_ACTIVE_MS = 4_000;
const POLL_IDLE_MS = 30_000;

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

function startOfToday(): number {
  return startOfDay(Date.now());
}

/**
 * Midnight this morning and how far the clock has got past it, read once so the
 * two can never come from different instants.
 */
function todayWindow(): { start: number; elapsedMs: number } {
  const now = Date.now();
  const start = startOfDay(now);
  return { start, elapsedMs: now - start };
}

export function MerchantProvider({ children }: { children: React.ReactNode }) {
  const {
    network,
    activeAccount,
    xlmPriceUsd,
    fiatRates,
    send,
    submissionStatus,
  } = useWallet();

  const [store, setStore] = useState<MerchantStore>(() => emptyStore());
  const [ready, setReady] = useState(false);
  const [ticket, setTicket] = useState<Ticket>({ lines: [], discountMinor: 0, tipMinor: 0 });
  const [activeChargeId, setActiveChargeId] = useState<string | null>(null);
  const [assetPrices, setAssetPrices] = useState<AssetPrices>({});
  const [watchedLedger, setWatchedLedger] = useState<number | null>(null);
  const [watchError, setWatchError] = useState<string | null>(null);
  const [staffSessionId, setStaffSessionId] = useState<string | null>(null);
  const storeRef = useRef(store);
  const pinAttempts = useRef(new Map<string, PinAttemptState>());
  const polling = useRef(false);
  const pollRef = useRef<() => Promise<void>>(async () => {});

  // Deferred the way the wallet bootstraps its own vault: localStorage is not
  // available while the page is server-rendered, and the first client render has
  // to match the server's.
  useEffect(() => {
    let alive = true;
    void (async () => {
      await Promise.resolve();
      if (!alive) return;
      const loaded = loadMerchantStore();
      storeRef.current = loaded;
      setStore(loaded);
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const persist = useCallback((next: MerchantStore | ((prev: MerchantStore) => MerchantStore)) => {
    setStore((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      saveMerchantStore(value);
      storeRef.current = value;
      return value;
    });
  }, []);

  const commitStore = useCallback((next: MerchantStore): void => {
    if (!saveMerchantStore(next)) {
      throw new Error("Merchant data could not be saved on this device. Free storage and try again.");
    }
    storeRef.current = next;
    setStore(next);
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
      setWatchError(
        error instanceof Error
          ? error.message
          : "A tracked refund changed status but could not be saved on this device.",
      );
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

  const chargeBlockedReason = useMemo(() => {
    if (!activeStaff) return "Choose an active staff member before taking a payment.";
    if (!activeStaff.permissions.takePayment) return `${activeStaff.name} is not allowed to take payments.`;
    if (!settings.receivingPublicKey) return "Choose the account that receives payments in Merchant settings.";
    if (settings.acceptedAssets.length === 0) return "Add at least one accepted asset in Merchant settings.";
    if (quotableAssets.length === 0) {
      return network === "mainnet"
        ? "No live price is available for the assets you accept, so an amount cannot be quoted."
        : "No price is available for the assets you accept.";
    }
    return null;
  }, [activeStaff, network, quotableAssets.length, settings.acceptedAssets.length, settings.receivingPublicKey]);

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
          : prev.lines.map((l) => (l.id === lineId ? { ...l, quantity } : l)),
    }));
  }, []);

  const removeLine = useCallback((lineId: string) => {
    setTicket((prev) => ({ ...prev, lines: prev.lines.filter((l) => l.id !== lineId) }));
  }, []);

  const clearTicket = useCallback(() => {
    setTicket({ lines: [], discountMinor: 0, tipMinor: 0 });
  }, []);

  /* ---------------- charges ---------------- */

  /**
   * The tip is chosen after Charge is pressed, so it arrives as an argument
   * rather than through `setTip`. A state write at that point would not be
   * visible to this call, and the charge — and therefore the QR the customer
   * scans — would encode the untipped total.
   */
  const createChargeFromTicket = useCallback((tipMinorOverride?: Minor): Charge => {
    if (chargeBlockedReason) throw new Error(chargeBlockedReason);
    if (ticket.lines.length === 0) throw new Error("Add something to the ticket first.");
    const totals =
      tipMinorOverride === undefined
        ? ticketTotals
        : orderTotals({
            lines: ticket.lines,
            taxRates: settings.taxRates,
            taxMode: settings.taxMode,
            discountMinor: ticket.discountMinor,
            tipMinor: tipMinorOverride,
          });
    const destination = settings.receivingPublicKey as string;
    const now = Date.now();
    const number = store.nextOrderNumber;
    const reference = orderReference(settings.profile.name || "Till", number);

    const order: Order = {
      id: uid("ord"),
      number,
      reference,
      network,
      status: "awaiting",
      lines: ticket.lines,
      totals,
      currency: settings.currency,
      tender: [],
      staffName: activeStaff?.name ?? "Till",
      terminalName: settings.terminalName,
      createdAt: now,
      paidAt: null,
      payerAddress: null,
      note: null,
    };

    const quotes: QuoteInput[] = quotableAssets
      .map((asset) => ({ asset, currencyPerUnit: rateFor(asset) as number }))
      .filter((q) => q.currencyPerUnit > 0);

    const charge = createCharge({ order, settings, network, destination, quotes, now });

    persist((prev) => ({
      ...prev,
      orders: [order, ...prev.orders],
      charges: [charge, ...prev.charges],
      nextOrderNumber: prev.nextOrderNumber + 1,
    }));
    setActiveChargeId(charge.id);
    clearTicket();
    return charge;
  }, [
    activeStaff?.name,
    chargeBlockedReason,
    clearTicket,
    network,
    persist,
    quotableAssets,
    rateFor,
    settings,
    store.nextOrderNumber,
    ticket.discountMinor,
    ticket.lines,
    ticketTotals,
  ]);

  const voidCharge = useCallback(
    (id: string) => {
      persist((prev) => ({
        ...prev,
        charges: prev.charges.map((c) => (c.id === id ? { ...c, status: "voided" } : c)),
        orders: prev.orders.map((o) =>
          prev.charges.some((c) => c.id === id && c.orderId === o.id) && o.status === "awaiting"
            ? { ...o, status: "voided" }
            : o,
        ),
      }));
      setActiveChargeId((current) => (current === id ? null : current));
    },
    [persist],
  );

  /** Expire anything past its window so the UI never shows a dead countdown. */
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setStore((prev) => {
        const stale = prev.charges.some((c) => c.status === "awaiting" && now >= c.expiresAt);
        if (!stale) return prev;
        const next = {
          ...prev,
          charges: prev.charges.map((c) =>
            c.status === "awaiting" && now >= c.expiresAt ? { ...c, status: "expired" as const } : c,
          ),
        };
        saveMerchantStore(next);
        storeRef.current = next;
        return next;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [enabled]);

  /* ---------------- the watcher ---------------- */

  const applyPayments = useCallback(
    (payments: ObservedPayment[]) => {
      if (payments.length === 0) return;
      persist((prev) => {
        let charges = prev.charges;
        let orders = prev.orders;
        const unmatched = [...prev.unmatched];
        const seen = new Set(
          [...prev.unmatched.map((p) => p.id), ...prev.charges.map((c) => c.payment?.id)].filter(
            Boolean,
          ) as string[],
        );

        for (const payment of payments) {
          if (seen.has(payment.id)) continue;
          seen.add(payment.id);
          const scoped = charges.filter((c) => c.network === network);
          const outcome = matchPayment(payment, scoped, prev.settings);

          if (outcome.lane === "memo") {
            const status = chargeStatusFor(outcome.verdict);
            charges = charges.map((c) =>
              c.id === outcome.charge.id
                ? { ...c, status, payment: { ...payment, lane: "memo" as const } }
                : c,
            );
            if (status === "paid") {
              orders = orders.map((o) =>
                o.id === outcome.charge.orderId
                  ? {
                      ...o,
                      status: "paid" as const,
                      paidAt: Date.now(),
                      payerAddress: payment.from,
                      tender: [
                        { kind: "crypto" as const, amountMinor: o.totals.totalMinor, chargeId: outcome.charge.id },
                      ],
                    }
                  : o,
              );
            }
            continue;
          }

          // Everything else needs a person: the tray holds it until they decide.
          unmatched.unshift({ ...payment, seenAt: Date.now() });
        }

        return { ...prev, charges, orders, unmatched: unmatched.slice(0, 200) };
      });
    },
    [network, persist],
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

  const pollNow = useCallback(async () => {
    const till = settings.receivingPublicKey;
    if (!enabled || !till || polling.current) return;
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
      setWatchError(describeWatchFailure(error));
    } finally {
      polling.current = false;
    }
  }, [applyPayments, enabled, network, persist, settings.receivingPublicKey, store.cursors]);

  const hasLiveCharge = useMemo(
    () => liveCharges(store.charges, network).length > 0,
    [network, store.charges],
  );

  // `pollNow` is rebuilt whenever the cursor advances. The timer must not restart
  // that often, so it reads the latest callback through a ref instead of closing
  // over one — otherwise every tick would replay the same Horizon page.
  useEffect(() => {
    pollRef.current = pollNow;
  }, [pollNow]);

  useEffect(() => {
    if (!enabled || !settings.receivingPublicKey) return;
    let alive = true;
    void (async () => {
      await Promise.resolve();
      if (alive) await pollRef.current();
    })();
    const interval = setInterval(() => {
      void pollRef.current();
    }, hasLiveCharge ? POLL_ACTIVE_MS : POLL_IDLE_MS);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [enabled, hasLiveCharge, network, settings.receivingPublicKey]);

  /* ---------------- tray ---------------- */

  const attachPayment = useCallback(
    (paymentId: string, chargeId: string) => {
      persist((prev) => {
        const payment = prev.unmatched.find((p) => p.id === paymentId);
        const charge = prev.charges.find((c) => c.id === chargeId);
        if (!payment || !charge) return prev;
        // Attaching is a staff decision, so it files the order regardless of the
        // amount lane — the audit trail records that a person made the call.
        return {
          ...prev,
          unmatched: prev.unmatched.filter((p) => p.id !== paymentId),
          charges: prev.charges.map((c) =>
            c.id === chargeId
              ? { ...c, status: "paid" as const, payment: { ...payment, lane: "manual" as const } }
              : c,
          ),
          orders: prev.orders.map((o) =>
            o.id === charge.orderId
              ? {
                  ...o,
                  status: "paid" as const,
                  paidAt: Date.now(),
                  payerAddress: payment.from,
                  tender: [{ kind: "crypto" as const, amountMinor: o.totals.totalMinor, chargeId }],
                }
              : o,
          ),
        };
      });
    },
    [persist],
  );

  const dismissUnmatched = useCallback(
    (paymentId: string) => {
      persist((prev) => ({
        ...prev,
        unmatched: prev.unmatched.filter((p) => p.id !== paymentId),
      }));
    },
    [persist],
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
        (refund) => refund.orderId === orderId && refundReservesFunds(refund),
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

  const approveRefundRequest = useCallback(async (requestId: string): Promise<Refund> => {
    const before = storeRef.current;
    const request = before.refundRequests.find((entry) => entry.id === requestId);
    const reviewerId = staffSessionId;
    if (!request || !reviewerId) throw new Error("That refund request is no longer available.");
    // Validate authority before opening the wallet signing path.
    decideRefundRequest(before, {
      requestId,
      reviewerId,
      decision: "approved",
      now: Date.now(),
      refundId: "authority-check",
    });
    const refund = await refundOrder({
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
  }, [commitStore, refundOrder, staffSessionId]);

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
    const from = startOfToday();
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
  }, [network, store.charges, store.orders, store.refunds]);

  /**
   * The same ledger of settled orders, read backwards. It recomputes on exactly
   * the inputs `today` does, so the two are always a matched pair: a comparison
   * built from a different moment than the figure it qualifies would be worse
   * than no comparison at all.
   */
  const history = useMemo<InsightsHistory>(() => {
    const { start: todayStart, elapsedMs } = todayWindow();

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
  }, [network, store.orders]);

  const activeCharge = useMemo(
    () => store.charges.find((c) => c.id === activeChargeId) ?? null,
    [activeChargeId, store.charges],
  );

  const value: MerchantContextValue = {
    ready,
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
    updateSettings: (patch) =>
      persist((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } })),
    completeSetup,

    staff: store.staff,
    activeStaff,
    terminal: store.terminal,
    refundRequests: store.refundRequests,
    switchStaff,
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
    setDiscount: (minor) => setTicket((prev) => ({ ...prev, discountMinor: Math.max(0, minor) })),
    setTip: (minor) => setTicket((prev) => ({ ...prev, tipMinor: Math.max(0, minor) })),
    clearTicket,

    orders: store.orders,
    charges: store.charges,
    refunds: store.refunds,
    unmatched: store.unmatched,

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
    secondsLeft: (charge) => secondsRemaining(charge),

    attachPayment,
    dismissUnmatched,
    refundOrder,
    submitRefund,
    approveRefundRequest,
    declineRefundRequest,

    watching: enabled && Boolean(settings.receivingPublicKey),
    watchedLedger,
    watchError,
    pollNow,

    today,
    history,
    orderFor: (chargeId) => {
      const charge = store.charges.find((c) => c.id === chargeId);
      return charge ? (store.orders.find((o) => o.id === charge.orderId) ?? null) : null;
    },
  };

  return <MerchantContext.Provider value={value}>{children}</MerchantContext.Provider>;
}

export function useMerchant(): MerchantContextValue {
  const context = useContext(MerchantContext);
  if (!context) throw new Error("useMerchant must be used inside MerchantProvider");
  return context;
}

export { sameAsset, assetKey, isNative };
