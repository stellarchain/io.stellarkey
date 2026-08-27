import { orderReference } from "./charge";
import { lineAdjustmentMinor, lineGrossMinor, orderTotals } from "./money";
import type {
  Adjustment,
  AdjustmentKind,
  MerchantStore,
  Minor,
  Order,
  OrderLine,
  OrderTotals,
  PendingAdjustment,
  StaffMember,
  TenderPart,
} from "./types";
import type { NetworkKey } from "../stellar";

export interface BuildOrderInput {
  id: string;
  network: NetworkKey;
  lines: OrderLine[];
  discountMinor: Minor;
  tipMinor: Minor;
  staffId: string | null;
  staffName: string;
  now: number;
}

export interface OrderCommit {
  store: MerchantStore;
  order: Order;
}

export interface EditableTicket {
  lines: OrderLine[];
  discountMinor: Minor;
  tipMinor: Minor;
}

export interface TicketAdjustmentInput {
  id: string;
  kind: AdjustmentKind;
  lineId: string | null;
  /** Requested pre-tax line/ticket amount. Ignored for comp and void. */
  amountMinor: Minor;
  reasonCode: string;
  actor: StaffMember;
  now: number;
}

export interface TicketAdjustmentResult {
  ticket: EditableTicket;
  totals: OrderTotals;
  adjustment: PendingAdjustment;
}

function safeMinor(value: Minor, label: string): Minor {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer number of minor units.`);
  }
  return value;
}

function canAdjust(actor: StaffMember, kind: AdjustmentKind): boolean {
  if (!actor.active) return false;
  if (kind === "discount") return actor.permissions.applyDiscount;
  if (kind === "comp") return actor.permissions.comp;
  return actor.permissions.void;
}

/** Apply one authorised ticket edit and return its immutable audit draft. */
export function applyTicketAdjustment(
  store: MerchantStore,
  ticket: EditableTicket,
  input: TicketAdjustmentInput,
): TicketAdjustmentResult {
  if (!canAdjust(input.actor, input.kind)) {
    throw new Error(`${input.actor.name} is not allowed to ${input.kind} this ticket.`);
  }
  const reasonCode = input.reasonCode.trim();
  if (!reasonCode) throw new Error("Every adjustment needs a reason.");
  if (ticket.lines.length === 0) throw new Error("There is nothing on this ticket to adjust.");
  const line = input.lineId
    ? ticket.lines.find((entry) => entry.id === input.lineId) ?? null
    : null;
  if (input.lineId && !line) throw new Error("That ticket line no longer exists.");

  const before = orderTotals({
    ...ticket,
    taxRates: store.settings.taxRates,
    taxMode: store.settings.taxMode,
  });
  let next: EditableTicket;

  if (input.kind === "void") {
    next = line
      ? { ...ticket, lines: ticket.lines.filter((entry) => entry.id !== line.id) }
      : { lines: [], discountMinor: 0, tipMinor: 0 };
  } else if (input.kind === "comp") {
    next = {
      ...ticket,
      lines: ticket.lines.map((entry) =>
        !line || entry.id === line.id
          ? { ...entry, adjustmentMinor: lineGrossMinor(entry) }
          : entry,
      ),
      ...(!line ? { discountMinor: 0, tipMinor: 0 } : {}),
    };
  } else {
    const requested = safeMinor(input.amountMinor, "Discount");
    if (requested <= 0) throw new Error("A discount must be greater than zero.");
    next = line
      ? {
          ...ticket,
          lines: ticket.lines.map((entry) =>
            entry.id === line.id
              ? {
                  ...entry,
                  adjustmentMinor: Math.min(
                    lineGrossMinor(entry),
                    lineAdjustmentMinor(entry) + requested,
                  ),
                }
              : entry,
          ),
        }
      : { ...ticket, discountMinor: ticket.discountMinor + requested };
  }

  const totals = orderTotals({
    ...next,
    taxRates: store.settings.taxRates,
    taxMode: store.settings.taxMode,
  });
  const amountMinor = before.totalMinor - totals.totalMinor;
  if (amountMinor <= 0) throw new Error("That adjustment does not change the ticket total.");

  return {
    ticket: next,
    totals,
    adjustment: {
      id: input.id,
      kind: input.kind,
      lineId: line?.id ?? null,
      lineName: line?.name ?? null,
      amountMinor,
      reasonCode,
      staffId: input.actor.id,
      staffName: input.actor.name,
      at: input.now,
    },
  };
}

export function buildOrder(store: MerchantStore, input: BuildOrderInput): Order {
  if (input.lines.length === 0) throw new Error("An order needs at least one line.");
  const number = store.nextOrderNumber;
  return {
    id: input.id,
    number,
    reference: orderReference(store.settings.profile.name || "Till", number),
    network: input.network,
    status: "open",
    lines: input.lines.map((line) => ({ ...line })),
    totals: orderTotals({
      lines: input.lines,
      taxRates: store.settings.taxRates,
      taxMode: store.settings.taxMode,
      discountMinor: input.discountMinor,
      tipMinor: input.tipMinor,
    }),
    currency: store.settings.currency,
    tender: [],
    staffId: input.staffId,
    staffName: input.staffName,
    terminalName: store.settings.terminalName,
    createdAt: input.now,
    paidAt: null,
    stockAppliedAt: null,
    stockExceptions: [],
    payerAddress: null,
    note: null,
  };
}

export function cashTender(amountMinor: Minor, receivedMinor: Minor): TenderPart {
  const amount = safeMinor(amountMinor, "Cash amount");
  const received = safeMinor(receivedMinor, "Cash received");
  if (received < amount) throw new Error("Cash received does not cover the tender amount.");
  return {
    kind: "cash",
    amountMinor: amount,
    receivedMinor: received,
    changeMinor: received - amount,
  };
}

export function cardTender(amountMinor: Minor, externalReference?: string): TenderPart {
  const amount = safeMinor(amountMinor, "Card amount");
  const reference = externalReference?.trim();
  return {
    kind: "card",
    amountMinor: amount,
    ...(reference ? { externalReference: reference } : {}),
  };
}

function tenderTotal(parts: TenderPart[]): Minor {
  return parts.reduce((sum, part) => sum + safeMinor(part.amountMinor, "Tender amount"), 0);
}

function finaliseAdjustments(order: Order, drafts: PendingAdjustment[]): Adjustment[] {
  return drafts.map((draft) => ({
    ...draft,
    orderId: order.id,
    orderNumber: order.number,
  }));
}

function assertNewOrder(store: MerchantStore, order: Order): void {
  if (store.orders.some((entry) => entry.id === order.id)) {
    throw new Error("This order has already been committed.");
  }
}

/** Apply catalogue quantities once, in the same durable state as settlement. */
export function applyStockForOrder(
  store: MerchantStore,
  orderId: string,
  now: number,
): MerchantStore {
  const order = store.orders.find((entry) => entry.id === orderId);
  if (!order) throw new Error("The order to apply stock for was not found.");
  if (order.status !== "paid" && order.status !== "partially_refunded" && order.status !== "refunded") {
    throw new Error("Stock can move only after an order settles.");
  }
  if (order.stockAppliedAt !== null) return store;

  const quantities = new Map<string, number>();
  for (const line of order.lines) {
    if (!line.itemId) continue;
    quantities.set(line.itemId, (quantities.get(line.itemId) ?? 0) + line.quantity);
  }

  const stockExceptions: Order["stockExceptions"] = [];
  for (const item of store.catalogue) {
    const quantity = quantities.get(item.id) ?? 0;
    if (!item.trackStock || quantity === 0) continue;
    if (!Number.isSafeInteger(item.stockOnHand)) {
      stockExceptions.push({
        reason: "missing_count",
        itemId: item.id,
        itemName: item.name,
        requested: quantity,
        available: null,
        recordedAt: now,
      });
      continue;
    }
    if ((item.stockOnHand as number) < quantity) {
      stockExceptions.push({
        reason: "insufficient_stock",
        itemId: item.id,
        itemName: item.name,
        requested: quantity,
        available: item.stockOnHand,
        recordedAt: now,
      });
    }
  }

  return {
    ...store,
    catalogue: store.catalogue.map((item) => {
      const quantity = quantities.get(item.id) ?? 0;
      return item.trackStock && quantity > 0 && Number.isSafeInteger(item.stockOnHand)
        ? { ...item, stockOnHand: (item.stockOnHand as number) - quantity }
        : item;
    }),
    orders: store.orders.map((entry) =>
      entry.id === orderId
        ? {
            ...entry,
            stockAppliedAt: now,
            stockExceptions: [...(entry.stockExceptions ?? []), ...stockExceptions],
          }
        : entry,
    ),
  };
}

export function settleNewOrder(
  store: MerchantStore,
  order: Order,
  tender: TenderPart[],
  adjustments: PendingAdjustment[],
  now: number,
): OrderCommit {
  assertNewOrder(store, order);
  if (tenderTotal(tender) !== order.totals.totalMinor) {
    throw new Error("Tender must cover the order total exactly.");
  }
  const settled: Order = {
    ...order,
    status: "paid",
    tender: tender.map((part) => ({ ...part })),
    paidAt: now,
    stockAppliedAt: null,
  };
  const committed = applyStockForOrder(
    {
      ...store,
      orders: [settled, ...store.orders],
      adjustments: [...finaliseAdjustments(settled, adjustments), ...store.adjustments],
      nextOrderNumber: store.nextOrderNumber + 1,
    },
    settled.id,
    now,
  );
  return {
    order: committed.orders.find((entry) => entry.id === settled.id) as Order,
    store: committed,
  };
}

/** Persist an awaiting order while retaining any cash/card legs already taken. */
export function awaitNewOrder(
  store: MerchantStore,
  order: Order,
  completedTender: TenderPart[],
  adjustments: PendingAdjustment[],
): OrderCommit {
  assertNewOrder(store, order);
  if (completedTender.some((part) => part.kind === "crypto")) {
    throw new Error("A crypto tender is retained only after its payment settles.");
  }
  const covered = tenderTotal(completedTender);
  if (covered >= order.totals.totalMinor) {
    throw new Error("An awaiting order must leave a positive remainder to settle.");
  }
  const awaiting: Order = {
    ...order,
    status: "awaiting",
    tender: completedTender.map((part) => ({ ...part })),
  };
  return {
    order: awaiting,
    store: {
      ...store,
      orders: [awaiting, ...store.orders],
      adjustments: [...finaliseAdjustments(awaiting, adjustments), ...store.adjustments],
      nextOrderNumber: store.nextOrderNumber + 1,
    },
  };
}

/** Retain a cancelled ticket and its reason without ever treating it as takings. */
export function voidNewOrder(
  store: MerchantStore,
  order: Order,
  adjustments: PendingAdjustment[],
): OrderCommit {
  assertNewOrder(store, order);
  const voided: Order = {
    ...order,
    status: "voided",
    tender: [],
    paidAt: null,
    stockAppliedAt: null,
  };
  return {
    order: voided,
    store: {
      ...store,
      orders: [voided, ...store.orders],
      adjustments: [...finaliseAdjustments(voided, adjustments), ...store.adjustments],
      nextOrderNumber: store.nextOrderNumber + 1,
    },
  };
}

export interface CompleteCryptoTenderInput {
  orderId: string;
  chargeId: string;
  amountMinor: Minor;
  payerAddress: string;
  now: number;
}

/** Close the outstanding crypto leg and apply stock once the whole order is covered. */
export function completeCryptoTender(
  store: MerchantStore,
  input: CompleteCryptoTenderInput,
): OrderCommit {
  const order = store.orders.find((entry) => entry.id === input.orderId);
  if (!order) throw new Error("The order for this crypto payment was not found.");
  const existing = order.tender.find(
    (part) => part.kind === "crypto" && part.chargeId === input.chargeId,
  );
  if (existing && order.status === "paid") return { store, order };
  if (order.status !== "awaiting") {
    throw new Error("Only an awaiting order can accept a crypto tender.");
  }
  const amount = safeMinor(input.amountMinor, "Crypto amount");
  if (amount <= 0 || tenderTotal(order.tender) + amount !== order.totals.totalMinor) {
    throw new Error("The crypto tender must equal the exact outstanding remainder.");
  }

  const settled: Order = {
    ...order,
    status: "paid",
    paidAt: input.now,
    payerAddress: input.payerAddress,
    tender: [
      ...order.tender,
      { kind: "crypto", amountMinor: amount, chargeId: input.chargeId },
    ],
  };
  const withOrder = {
    ...store,
    orders: store.orders.map((entry) => (entry.id === settled.id ? settled : entry)),
  };
  const committed = applyStockForOrder(withOrder, settled.id, input.now);
  return {
    store: committed,
    order: committed.orders.find((entry) => entry.id === settled.id) as Order,
  };
}
