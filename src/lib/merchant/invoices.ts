import { StrKey } from "@stellar/stellar-sdk";

import { buildSep7PayUri } from "../payuri";
import { NETWORKS, type NetworkKey } from "../stellar";
import {
  assetKey,
  buildQuotes,
  isNative,
  referencePrefix,
  sameAsset,
  type QuoteInput,
} from "./charge";
import type { ObservedPayment } from "./match";
import { assetAmountFor, minorForAssetAmount, orderTotals } from "./money";
import { parsePaymentCreatedAt } from "./payment-time";
import type {
  AcceptedAsset,
  Invoice,
  InvoiceLine,
  InvoicePayment,
  InvoiceStatus,
  MerchantStore,
  Minor,
  StaffMember,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_QUANTITY = 9_999;

export interface InvoiceCommit {
  store: MerchantStore;
  invoice: Invoice;
}

export interface CreateInvoiceDraftInput {
  id: string;
  actor: StaffMember;
  customerName: string;
  customerEmail?: string | null;
  lines: InvoiceLine[];
  dueAt?: number | null;
  note?: string | null;
  network: NetworkKey;
  now?: number;
}

export interface UpdateInvoiceDraftInput
  extends Omit<CreateInvoiceDraftInput, "id" | "network"> {
  invoiceId: string;
  network?: NetworkKey;
}

export interface IssueInvoiceInput {
  invoiceId: string;
  actor: StaffMember;
  network: NetworkKey;
  destination: string;
  quotes: QuoteInput[];
  now?: number;
}

export interface ReconcileInvoicePaymentsInput {
  network: NetworkKey;
  payments: ObservedPayment[];
  now?: number;
}

export interface ManualInvoicePaymentInput {
  invoiceId: string;
  paymentId: string;
  amountMinor: Minor;
  actor: StaffMember;
  note?: string | null;
  now?: number;
}

export interface VoidInvoiceInput {
  invoiceId: string;
  actor: StaffMember;
  reason: string;
  now?: number;
}

export interface DuplicateInvoiceInput {
  invoiceId: string;
  id: string;
  actor: StaffMember;
  now?: number;
}

function currentActor(
  store: MerchantStore,
  actor: StaffMember,
  permission: "takePayment" | "void",
): StaffMember {
  const member = store.staff.find((entry) => entry.id === actor.id);
  if (!member?.active || !member.permissions[permission]) {
    throw new Error(`${actor.name || "This staff member"} is not allowed to manage this invoice.`);
  }
  return member;
}

function safeTime(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} is invalid.`);
  return value;
}

function cleanOptional(value: string | null | undefined): string | null {
  const cleaned = value?.trim() ?? "";
  return cleaned || null;
}

function validateEmail(value: string | null): void {
  if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error("Enter a valid customer email address.");
  }
}

function invoiceTotals(store: MerchantStore, lines: InvoiceLine[]) {
  if (lines.length === 0) throw new Error("An invoice needs at least one line.");
  const ids = new Set<string>();
  const taxRateIds = new Set(store.settings.taxRates.map((rate) => rate.id));
  const orderLines = lines.map((line) => {
    const id = line.id.trim();
    const description = line.description.trim();
    if (!id || ids.has(id)) throw new Error("Every invoice line needs a unique identity.");
    ids.add(id);
    if (!description) throw new Error("Every invoice line needs a description.");
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0 || line.quantity > MAX_QUANTITY) {
      throw new Error(`Invoice quantity must be a whole number from 1 to ${MAX_QUANTITY}.`);
    }
    if (!Number.isSafeInteger(line.unitPriceMinor) || line.unitPriceMinor < 0) {
      throw new Error("Invoice price must be a non-negative integer number of minor units.");
    }
    if (!Number.isSafeInteger(line.quantity * line.unitPriceMinor)) {
      throw new Error("That invoice line is too large to total safely.");
    }
    if (!taxRateIds.has(line.taxRateId)) throw new Error("Choose a valid invoice tax rate.");
    return {
      id,
      itemId: null,
      name: description,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      modifiers: [],
      taxRateId: line.taxRateId,
      note: null,
    };
  });
  const totals = orderTotals({
    lines: orderLines,
    taxRates: store.settings.taxRates,
    taxMode: store.settings.taxMode,
  });
  if (Object.values(totals).some((value) => typeof value === "number" && !Number.isSafeInteger(value))) {
    throw new Error("The invoice total is too large to store safely.");
  }
  if (totals.totalMinor <= 0) throw new Error("An invoice total must be greater than zero.");
  return totals;
}

function normalizedLines(lines: InvoiceLine[]): InvoiceLine[] {
  return lines.map((line) => ({
    ...line,
    id: line.id.trim(),
    description: line.description.trim(),
  }));
}

function nextIdentity(store: MerchantStore, now: number): { number: string; reference: string } {
  const sequence = store.nextInvoiceNumber;
  if (!Number.isSafeInteger(sequence) || sequence <= 0) {
    throw new Error("The next invoice number is invalid.");
  }
  const year = new Date(now).getUTCFullYear();
  return {
    number: `INV-${year}-${String(sequence).padStart(4, "0")}`,
    reference: `${referencePrefix(store.settings.profile.name || "Till")}INV${sequence}`,
  };
}

function validateDraftFields(
  store: MerchantStore,
  input: Pick<
    CreateInvoiceDraftInput,
    "customerName" | "customerEmail" | "lines" | "dueAt" | "now"
  >,
) {
  const customerName = input.customerName.trim();
  if (!customerName) throw new Error("Enter the invoice customer name.");
  const customerEmail = cleanOptional(input.customerEmail);
  validateEmail(customerEmail);
  const now = safeTime(input.now ?? Date.now(), "Invoice time");
  const dueAt = input.dueAt ?? null;
  if (dueAt !== null) safeTime(dueAt, "Invoice due date");
  return {
    customerName,
    customerEmail,
    dueAt,
    now,
    lines: normalizedLines(input.lines),
    totals: invoiceTotals(store, input.lines),
  };
}

function replaceInvoice(store: MerchantStore, invoice: Invoice): MerchantStore {
  return {
    ...store,
    invoices: store.invoices.map((entry) => (entry.id === invoice.id ? invoice : entry)),
  };
}

function findInvoice(store: MerchantStore, invoiceId: string): Invoice {
  const invoice = store.invoices.find((entry) => entry.id === invoiceId);
  if (!invoice) throw new Error("That invoice no longer exists.");
  return invoice;
}

function editableDraft(store: MerchantStore, invoiceId: string): Invoice {
  const invoice = findInvoice(store, invoiceId);
  if (invoice.status !== "draft") throw new Error("That invoice is already issued.");
  return invoice;
}

export function createInvoiceDraft(
  store: MerchantStore,
  input: CreateInvoiceDraftInput,
): InvoiceCommit {
  const actor = currentActor(store, input.actor, "takePayment");
  const id = input.id.trim();
  if (!id || store.invoices.some((entry) => entry.id === id)) {
    throw new Error("That invoice identity is invalid or already exists.");
  }
  if (!NETWORKS[input.network]) throw new Error("Choose a valid Stellar network.");
  const valid = validateDraftFields(store, input);
  const identity = nextIdentity(store, valid.now);
  if (
    store.invoices.some(
      (invoice) => invoice.number === identity.number || invoice.reference === identity.reference,
    )
  ) {
    throw new Error("The next invoice sequence collides with an existing record.");
  }
  const invoice: Invoice = {
    id,
    ...identity,
    status: "draft",
    customerName: valid.customerName,
    customerEmail: valid.customerEmail,
    customerAddress: null,
    network: input.network,
    destination: null,
    quotes: [],
    payments: [],
    lines: valid.lines,
    totals: valid.totals,
    currency: store.settings.currency,
    issuedAt: null,
    dueAt: valid.dueAt,
    paidAt: null,
    paidMinor: 0,
    note: cleanOptional(input.note),
    createdAt: valid.now,
    updatedAt: valid.now,
    createdById: actor.id,
    createdBy: actor.name,
    issuedById: null,
    issuedBy: null,
    voidedAt: null,
    voidedById: null,
    voidedBy: null,
    voidReason: null,
  };
  return {
    invoice,
    store: {
      ...store,
      invoices: [invoice, ...store.invoices],
      nextInvoiceNumber: store.nextInvoiceNumber + 1,
    },
  };
}

export function updateInvoiceDraft(
  store: MerchantStore,
  input: UpdateInvoiceDraftInput,
): InvoiceCommit {
  currentActor(store, input.actor, "takePayment");
  const invoice = editableDraft(store, input.invoiceId);
  const network = input.network ?? invoice.network;
  if (!NETWORKS[network]) throw new Error("Choose a valid Stellar network.");
  const valid = validateDraftFields(store, input);
  const updated: Invoice = {
    ...invoice,
    customerName: valid.customerName,
    customerEmail: valid.customerEmail,
    lines: valid.lines,
    totals: valid.totals,
    dueAt: valid.dueAt,
    note: cleanOptional(input.note),
    network,
    updatedAt: valid.now,
  };
  return { invoice: updated, store: replaceInvoice(store, updated) };
}

export function issueInvoice(store: MerchantStore, input: IssueInvoiceInput): InvoiceCommit {
  const actor = currentActor(store, input.actor, "takePayment");
  const invoice = editableDraft(store, input.invoiceId);
  const now = safeTime(input.now ?? Date.now(), "Invoice issue time");
  if (invoice.dueAt === null || invoice.dueAt <= now) {
    throw new Error("Choose an invoice due date after its issue time.");
  }
  if (invoice.network !== input.network) throw new Error("The invoice network changed before issue.");
  const destination = input.destination.trim();
  if (!StrKey.isValidEd25519PublicKey(destination)) {
    throw new Error("The invoice receiving account is not a valid Stellar public key.");
  }
  if (input.quotes.length === 0) throw new Error("No accepted asset has a price right now.");
  const accepted = new Set(store.settings.acceptedAssets.map(assetKey));
  const seen = new Set<string>();
  for (const { asset } of input.quotes) {
    const key = assetKey(asset);
    if (!accepted.has(key)) throw new Error(`${asset.code} is not accepted by this shop.`);
    if (seen.has(key)) throw new Error(`The ${asset.code} invoice quote is duplicated.`);
    seen.add(key);
  }
  const issued: Invoice = {
    ...invoice,
    status: "sent",
    destination,
    quotes: buildQuotes(invoice.totals.totalMinor, input.quotes, now),
    issuedAt: now,
    issuedById: actor.id,
    issuedBy: actor.name,
    updatedAt: now,
  };
  return { invoice: issued, store: replaceInvoice(store, issued) };
}

export function invoicePayUri(
  invoice: Invoice,
  asset: AcceptedAsset,
  shopName?: string,
): string {
  if (!invoice.destination || !invoice.issuedAt || invoice.status === "draft" || invoice.status === "void") {
    throw new Error("This invoice is not payable.");
  }
  const remainingMinor = invoice.totals.totalMinor - invoice.paidMinor;
  if (remainingMinor <= 0) throw new Error("This invoice is already paid.");
  const quote = invoice.quotes.find((entry) => sameAsset(entry.asset, asset));
  if (!quote) throw new Error(`${asset.code} is not quoted for this invoice.`);
  return buildSep7PayUri({
    destination: invoice.destination,
    amount: assetAmountFor(remainingMinor, quote.unitPriceMinorE6),
    assetCode: isNative(asset) ? undefined : asset.code,
    assetIssuer: isNative(asset) ? undefined : (asset.issuer ?? undefined),
    memo: invoice.reference,
    memoType: "text",
    msg: shopName ? `${shopName} · ${invoice.number}` : invoice.number,
    networkPassphrase: NETWORKS[invoice.network].networkPassphrase,
  });
}

export function reconcileInvoicePayments(
  store: MerchantStore,
  input: ReconcileInvoicePaymentsInput,
): { store: MerchantStore; unclaimed: ObservedPayment[] } {
  const now = safeTime(input.now ?? Date.now(), "Invoice reconciliation time");
  const claimedIds = new Set(store.invoices.flatMap((invoice) => invoice.payments.map((payment) => payment.id)));
  let invoices = store.invoices;
  const unclaimed: ObservedPayment[] = [];

  for (const payment of input.payments) {
    if (claimedIds.has(payment.id)) continue;
    const paymentAt = parsePaymentCreatedAt(payment.createdAt);
    if (paymentAt === null) {
      unclaimed.push(payment);
      continue;
    }
    const invoiceIndex = payment.memo
      ? invoices.findIndex(
          (invoice) =>
            invoice.reference === payment.memo &&
            invoice.network === input.network &&
            invoice.destination === payment.destination &&
            (invoice.status === "sent" ||
              invoice.status === "partially_paid" ||
              invoice.status === "overdue"),
        )
      : -1;
    if (invoiceIndex < 0) {
      unclaimed.push(payment);
      continue;
    }
    const invoice = invoices[invoiceIndex];
    const quote = invoice.quotes.find((entry) => sameAsset(entry.asset, payment.asset));
    if (!quote) {
      unclaimed.push(payment);
      continue;
    }
    const amountMinor = minorForAssetAmount(payment.amount, quote.unitPriceMinorE6);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
      unclaimed.push(payment);
      continue;
    }
    const nextPaidMinor = Math.min(invoice.totals.totalMinor, invoice.paidMinor + amountMinor);
    const settled = nextPaidMinor >= invoice.totals.totalMinor;
    const record: InvoicePayment = {
      id: payment.id,
      kind: "stellar",
      network: input.network,
      amountMinor,
      asset: { ...payment.asset },
      amount: payment.amount,
      transactionHash: payment.transactionHash,
      from: payment.from,
      observedAt: paymentAt,
      recordedById: null,
      recordedBy: null,
      note: null,
    };
    const updated: Invoice = {
      ...invoice,
      status: settled ? "paid" : "partially_paid",
      paidMinor: nextPaidMinor,
      paidAt: settled ? now : null,
      customerAddress: invoice.customerAddress ?? payment.from,
      payments: [...invoice.payments, record],
      updatedAt: now,
    };
    invoices = invoices.map((entry, index) => (index === invoiceIndex ? updated : entry));
    claimedIds.add(payment.id);
  }
  return { store: invoices === store.invoices ? store : { ...store, invoices }, unclaimed };
}

export function recordManualInvoicePayment(
  store: MerchantStore,
  input: ManualInvoicePaymentInput,
): InvoiceCommit {
  const actor = currentActor(store, input.actor, "takePayment");
  const invoice = findInvoice(store, input.invoiceId);
  const now = safeTime(input.now ?? Date.now(), "Invoice payment time");
  if (invoice.status === "draft" || invoice.status === "void" || invoice.status === "paid") {
    throw new Error("This invoice cannot accept another payment.");
  }
  const remaining = invoice.totals.totalMinor - invoice.paidMinor;
  if (
    !Number.isSafeInteger(input.amountMinor) ||
    input.amountMinor <= 0 ||
    input.amountMinor > remaining
  ) {
    throw new Error(`The manual payment must be between 1 and ${remaining} minor units.`);
  }
  const paymentId = input.paymentId.trim();
  if (
    !paymentId ||
    store.invoices.some((entry) => entry.payments.some((payment) => payment.id === paymentId))
  ) {
    throw new Error("That invoice payment is invalid or already recorded.");
  }
  const nextPaidMinor = invoice.paidMinor + input.amountMinor;
  const settled = nextPaidMinor === invoice.totals.totalMinor;
  const payment: InvoicePayment = {
    id: paymentId,
    kind: "manual",
    network: invoice.network,
    amountMinor: input.amountMinor,
    asset: null,
    amount: null,
    transactionHash: null,
    from: null,
    observedAt: now,
    recordedById: actor.id,
    recordedBy: actor.name,
    note: cleanOptional(input.note),
  };
  const updated: Invoice = {
    ...invoice,
    status: settled ? "paid" : "partially_paid",
    paidMinor: nextPaidMinor,
    paidAt: settled ? now : null,
    payments: [...invoice.payments, payment],
    updatedAt: now,
  };
  return { invoice: updated, store: replaceInvoice(store, updated) };
}

export function voidInvoice(store: MerchantStore, input: VoidInvoiceInput): InvoiceCommit {
  const actor = currentActor(store, input.actor, "void");
  const invoice = findInvoice(store, input.invoiceId);
  const now = safeTime(input.now ?? Date.now(), "Invoice void time");
  const reason = input.reason.trim();
  if (!reason) throw new Error("A void reason is required.");
  if (invoice.status === "void") throw new Error("This invoice is already void.");
  if (invoice.paidMinor > 0 || invoice.payments.length > 0 || invoice.status === "paid") {
    throw new Error("An invoice with a payment cannot be voided.");
  }
  const updated: Invoice = {
    ...invoice,
    status: "void",
    voidedAt: now,
    voidedById: actor.id,
    voidedBy: actor.name,
    voidReason: reason,
    updatedAt: now,
  };
  return { invoice: updated, store: replaceInvoice(store, updated) };
}

export function duplicateInvoice(
  store: MerchantStore,
  input: DuplicateInvoiceInput,
): InvoiceCommit {
  const source = findInvoice(store, input.invoiceId);
  const now = safeTime(input.now ?? Date.now(), "Invoice duplicate time");
  const termStart = source.issuedAt ?? source.createdAt;
  const term = source.dueAt === null ? null : Math.max(DAY_MS, source.dueAt - termStart);
  return createInvoiceDraft(store, {
    id: input.id,
    actor: input.actor,
    customerName: source.customerName,
    customerEmail: source.customerEmail,
    lines: source.lines.map((line) => ({ ...line })),
    dueAt: term === null ? null : now + term,
    note: source.note,
    network: source.network,
    now,
  });
}

/** Overdue is a display state derived from the clock, never a mutable timer write. */
export function invoiceStatusAt(invoice: Invoice, now = Date.now()): InvoiceStatus {
  if (
    (invoice.status === "sent" || invoice.status === "partially_paid") &&
    invoice.dueAt !== null &&
    invoice.dueAt < now
  ) {
    return "overdue";
  }
  return invoice.status;
}
