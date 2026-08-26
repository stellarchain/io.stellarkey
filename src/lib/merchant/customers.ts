import { StrKey } from "@stellar/stellar-sdk";

import type { Contact } from "../contacts";
import type { FiatCurrency } from "../format";
import type {
  AcceptedAsset,
  CustomerRecord,
  LoyaltyCard,
  LoyaltyEvent,
  MerchantStore,
  Minor,
  StaffMember,
} from "./types";

const MAX_NOTE_LENGTH = 140;
const MIN_LOYALTY_TARGET = 2;
const MAX_LOYALTY_TARGET = 20;

export interface RecordCustomerVisitInput {
  sourceId: string;
  address: string;
  amountMinor: Minor;
  asset: AcceptedAsset;
  at: number;
  contacts: Contact[];
}

export interface CustomerHistoryEntry {
  id: string;
  kind: "order" | "invoice";
  label: string;
  sub: string;
  at: number;
  amountMinor: Minor;
  currency: FiatCurrency;
}

export interface LoyaltyActionInput {
  address: string;
  actor: StaffMember;
  eventId: string;
  now?: number;
}

export interface StartLoyaltyInput extends LoyaltyActionInput {
  target: number;
}

function safeTime(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} is invalid.`);
  return value;
}

function validAddress(value: string): string {
  const address = value.trim();
  if (!StrKey.isValidEd25519PublicKey(address)) {
    throw new Error("The customer address is not a valid Stellar public key.");
  }
  return address;
}

function validAsset(asset: AcceptedAsset): AcceptedAsset {
  const code = asset.code.trim();
  if (!/^[A-Za-z0-9]{1,12}$/.test(code)) throw new Error("The customer asset is invalid.");
  if (asset.issuer !== null && !StrKey.isValidEd25519PublicKey(asset.issuer)) {
    throw new Error("The customer asset issuer is invalid.");
  }
  return { code: asset.issuer === null ? "XLM" : code, issuer: asset.issuer };
}

function contactName(contacts: Contact[], address: string): string | null {
  const contact = contacts.find((entry) => entry.address.trim() === address);
  const name = contact?.name.trim() ?? "";
  return name || null;
}

function customerFor(store: MerchantStore, address: string): CustomerRecord {
  const customer = store.customers.find((entry) => entry.address === address);
  if (!customer) throw new Error("That customer record no longer exists.");
  return customer;
}

function replaceCustomer(store: MerchantStore, customer: CustomerRecord): MerchantStore {
  return {
    ...store,
    customers: store.customers.map((entry) =>
      entry.address === customer.address ? customer : entry,
    ),
  };
}

function currentActor(
  store: MerchantStore,
  actor: StaffMember,
  permission: "takePayment" | "comp",
): StaffMember {
  const member = store.staff.find(
    (entry) => entry.id === actor.id && entry.id === store.activeStaffId && entry.active,
  );
  if (!member || !member.permissions[permission]) {
    throw new Error(`${actor.name || "This staff member"} is not allowed to manage loyalty.`);
  }
  return member;
}

function validEventId(card: LoyaltyCard | null, value: string): string {
  const id = value.trim();
  if (!id || card?.events.some((event) => event.id === id)) {
    throw new Error("That loyalty action is invalid or already recorded.");
  }
  return id;
}

function earnStamp(card: LoyaltyCard, sourceId: string, at: number): LoyaltyCard {
  if (card.stamps >= card.target) return card;
  const event: LoyaltyEvent = {
    id: `earn:${sourceId}`,
    kind: "earned",
    sourceId,
    at,
    actorId: null,
    actorName: null,
  };
  return {
    ...card,
    stamps: card.stamps + 1,
    events: [...card.events, event],
  };
}

/** Apply one newly settled payer event exactly once. */
export function recordCustomerVisit(
  store: MerchantStore,
  input: RecordCustomerVisitInput,
): MerchantStore {
  const sourceId = input.sourceId.trim();
  if (!sourceId) throw new Error("A customer visit needs an immutable settlement source.");
  const address = validAddress(input.address);
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error("A customer visit needs a positive minor-unit amount.");
  }
  const at = safeTime(input.at, "Customer visit time");
  const asset = validAsset(input.asset);
  const owner = store.customers.find((entry) => entry.sourceIds.includes(sourceId));
  if (owner) {
    if (owner.address !== address) {
      throw new Error("That settlement is already attributed to another customer.");
    }
    return store;
  }

  const existing = store.customers.find((entry) => entry.address === address) ?? null;
  const matchedName = contactName(input.contacts, address);
  if (!existing) {
    const customer: CustomerRecord = {
      address,
      name: matchedName,
      firstSeenAt: at,
      lastSeenAt: at,
      orderCount: 1,
      lifetimeMinor: input.amountMinor,
      averageMinor: input.amountMinor,
      preferredAsset: asset,
      sourceIds: [sourceId],
      loyalty: null,
      note: null,
    };
    return { ...store, customers: [customer, ...store.customers] };
  }

  const orderCount = existing.orderCount + 1;
  const lifetimeMinor = existing.lifetimeMinor + input.amountMinor;
  const updated: CustomerRecord = {
    ...existing,
    name: matchedName ?? existing.name,
    firstSeenAt: Math.min(existing.firstSeenAt, at),
    lastSeenAt: Math.max(existing.lastSeenAt, at),
    orderCount,
    lifetimeMinor,
    averageMinor: Math.round(lifetimeMinor / orderCount),
    preferredAsset: asset,
    sourceIds: [...existing.sourceIds, sourceId],
    loyalty: existing.loyalty ? earnStamp(existing.loyalty, sourceId, at) : null,
  };
  return replaceCustomer(store, updated);
}

/**
 * Apply only transitions/new payment operations between two store snapshots.
 * This is what lets Forget stay forgotten: historical records are never
 * re-imported merely because the app loaded or another unrelated payment arrived.
 */
export function reconcileCustomerSettlements(
  previous: MerchantStore,
  current: MerchantStore,
  { contacts }: { contacts: Contact[] },
): MerchantStore {
  let next = current;
  for (const order of current.orders) {
    if (order.status !== "paid" || !order.payerAddress || order.paidAt === null) continue;
    const prior = previous.orders.find((entry) => entry.id === order.id);
    if (prior?.status === "paid" && prior.payerAddress === order.payerAddress) continue;
    const cryptoTender = order.tender.find((entry) => entry.kind === "crypto");
    if (!cryptoTender || cryptoTender.kind !== "crypto") continue;
    const charge = current.charges.find((entry) => entry.id === cryptoTender.chargeId);
    if (!charge?.payment || charge.payment.from !== order.payerAddress) continue;
    next = recordCustomerVisit(next, {
      sourceId: `order:${order.id}`,
      address: order.payerAddress,
      amountMinor: order.totals.totalMinor,
      asset: charge.payment.asset,
      at: order.paidAt,
      contacts,
    });
  }

  const priorInvoicePayments = new Set(
    previous.invoices.flatMap((invoice) => invoice.payments.map((payment) => payment.id)),
  );
  for (const invoice of current.invoices) {
    for (const payment of invoice.payments) {
      if (
        priorInvoicePayments.has(payment.id) ||
        payment.kind !== "stellar" ||
        !payment.from ||
        !payment.asset
      ) {
        continue;
      }
      next = recordCustomerVisit(next, {
        sourceId: `invoice-payment:${payment.id}`,
        address: payment.from,
        amountMinor: payment.amountMinor,
        asset: payment.asset,
        at: payment.observedAt,
        contacts,
      });
    }
  }
  return next;
}

export function syncCustomerContacts(store: MerchantStore, contacts: Contact[]): MerchantStore {
  let changed = false;
  const customers = store.customers.map((customer) => {
    const name = contactName(contacts, customer.address);
    if (name === customer.name) return customer;
    changed = true;
    return { ...customer, name };
  });
  return changed ? { ...store, customers } : store;
}

export function updateCustomerNote(
  store: MerchantStore,
  addressInput: string,
  noteInput: string,
): MerchantStore {
  const address = validAddress(addressInput);
  const customer = customerFor(store, address);
  const note = noteInput.trim();
  if (note.length > MAX_NOTE_LENGTH) {
    throw new Error(`A customer note can be at most ${MAX_NOTE_LENGTH} characters.`);
  }
  const updatedNote = note || null;
  if (customer.note === updatedNote) return store;
  return replaceCustomer(store, { ...customer, note: updatedNote });
}

export function startLoyaltyCard(
  store: MerchantStore,
  input: StartLoyaltyInput,
): MerchantStore {
  const actor = currentActor(store, input.actor, "takePayment");
  const address = validAddress(input.address);
  const customer = customerFor(store, address);
  if (customer.loyalty) throw new Error("This customer already has a loyalty card.");
  if (
    !Number.isSafeInteger(input.target) ||
    input.target < MIN_LOYALTY_TARGET ||
    input.target > MAX_LOYALTY_TARGET
  ) {
    throw new Error(`A loyalty target must be ${MIN_LOYALTY_TARGET} to ${MAX_LOYALTY_TARGET}.`);
  }
  const now = safeTime(input.now ?? Date.now(), "Loyalty opening time");
  const event: LoyaltyEvent = {
    id: validEventId(null, input.eventId),
    kind: "opened",
    sourceId: null,
    at: now,
    actorId: actor.id,
    actorName: actor.name,
  };
  return replaceCustomer(store, {
    ...customer,
    loyalty: { stamps: 0, target: input.target, redeemedCount: 0, events: [event] },
  });
}

export function redeemLoyaltyReward(
  store: MerchantStore,
  input: LoyaltyActionInput,
): MerchantStore {
  const actor = currentActor(store, input.actor, "comp");
  const address = validAddress(input.address);
  const customer = customerFor(store, address);
  const card = customer.loyalty;
  if (!card) throw new Error("This customer does not have a loyalty card.");
  if (card.stamps < card.target) throw new Error("This loyalty reward is not ready yet.");
  const now = safeTime(input.now ?? Date.now(), "Loyalty redemption time");
  const event: LoyaltyEvent = {
    id: validEventId(card, input.eventId),
    kind: "redeemed",
    sourceId: null,
    at: now,
    actorId: actor.id,
    actorName: actor.name,
  };
  return replaceCustomer(store, {
    ...customer,
    loyalty: {
      ...card,
      stamps: 0,
      redeemedCount: card.redeemedCount + 1,
      events: [...card.events, event],
    },
  });
}

export function forgetCustomer(store: MerchantStore, addressInput: string): MerchantStore {
  const address = validAddress(addressInput);
  if (!store.customers.some((customer) => customer.address === address)) return store;
  return {
    ...store,
    customers: store.customers.filter((customer) => customer.address !== address),
  };
}

export function customerHistory(
  store: MerchantStore,
  addressInput: string,
): CustomerHistoryEntry[] {
  const address = validAddress(addressInput);
  const orders: CustomerHistoryEntry[] = store.orders
    .filter(
      (order) => order.status === "paid" && order.payerAddress === address && order.paidAt !== null,
    )
    .map((order) => ({
      id: order.id,
      kind: "order",
      label: `Order #${order.number}`,
      sub: `${order.lines.length} ${order.lines.length === 1 ? "line" : "lines"} · ${order.staffName}`,
      at: order.paidAt as number,
      amountMinor: order.totals.totalMinor,
      currency: order.currency,
    }));
  const invoices: CustomerHistoryEntry[] = store.invoices.flatMap((invoice) =>
    invoice.payments
      .filter((payment) => payment.kind === "stellar" && payment.from === address)
      .map((payment) => ({
        id: payment.id,
        kind: "invoice" as const,
        label: invoice.number,
        sub: `${invoice.status.replaceAll("_", " ")} · ${invoice.customerName}`,
        at: payment.observedAt,
        amountMinor: payment.amountMinor,
        currency: invoice.currency,
      })),
  );
  return [...orders, ...invoices].sort((a, b) => b.at - a.at);
}
