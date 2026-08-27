import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { emptyStore } from "../src/lib/merchant/defaults.ts";
import { recordRefundSubmission } from "../src/lib/merchant/refunds.ts";
import { decodeMerchantStore } from "../src/lib/merchant/storage.ts";
import { parseSep7PayUri } from "../src/lib/payuri.ts";
import { NETWORKS } from "../src/lib/stellar.ts";

const NOW = 1_800_000_000_000;
const TILL = "GAVLAAAWTBEO5XJELA3TID4XVHELGTFYRMMFRU2MQ25C5VVCBI476ZVG";
const PAYER = "GCUXWZHL7FGVL3MVYH6N5G3RACCKAC7ZLTUBKKN4I5MCCTDPJXITNGFD";
const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const USDC = { code: "USDC", issuer: ISSUER };

async function invoiceDomain() {
  try {
    return await import("../src/lib/merchant/invoices.ts");
  } catch (error) {
    assert.fail(`The persisted invoice domain is missing: ${error instanceof Error ? error.message : error}`);
  }
}

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function actor(overrides = {}) {
  return {
    id: "staff-owner",
    name: "Ari",
    role: "owner",
    permissions: {
      takePayment: true,
      applyDiscount: true,
      comp: true,
      void: true,
      refundCeilingMinor: null,
      openDrawer: true,
      seeReports: true,
      exportRecords: true,
    },
    pinDigest: null,
    pinSetAt: null,
    active: true,
    ...overrides,
  };
}

function merchantStore() {
  const member = actor();
  const base = emptyStore();
  return {
    member,
    store: {
      ...base,
      staff: [member],
      activeStaffId: member.id,
      settings: {
        ...base.settings,
        profile: { ...base.settings.profile, name: "North Star" },
        receivingPublicKey: TILL,
        acceptedAssets: [USDC],
      },
    },
  };
}

function draftInput(member, overrides = {}) {
  return {
    id: "invoice-1",
    actor: member,
    customerName: "Praça Hotel",
    customerEmail: "accounts@example.com",
    lines: [
      {
        id: "line-1",
        description: "Coffee service",
        quantity: 1,
        unitPriceMinor: 1000,
        taxRateId: "standard",
      },
    ],
    dueAt: NOW + 14 * 24 * 60 * 60 * 1000,
    note: "Thank you",
    network: "mainnet",
    now: NOW,
    ...overrides,
  };
}

function payment(id, amount, memo) {
  return {
    id,
    transactionHash: id.padEnd(64, "a").slice(0, 64),
    ledger: 12345,
    from: PAYER,
    destination: TILL,
    amount,
    asset: USDC,
    memo,
    createdAt: new Date(NOW + 1000).toISOString(),
  };
}

test("draft creation mints a durable number/reference and validates invoice data", async () => {
  const { createInvoiceDraft } = await invoiceDomain();
  const { member, store } = merchantStore();
  const created = createInvoiceDraft(store, draftInput(member));

  assert.equal(created.invoice.number, "INV-2027-0001");
  assert.equal(created.invoice.reference, "NS-I-1");
  assert.equal(created.invoice.status, "draft");
  assert.equal(created.invoice.createdById, member.id);
  assert.equal(created.invoice.totals.totalMinor, 1000);
  assert.equal(created.store.nextInvoiceNumber, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(created.store)).invoices[0], created.invoice);

  assert.throws(
    () => createInvoiceDraft(store, draftInput(member, { id: "bad", customerName: " " })),
    /customer/i,
  );
  assert.throws(
    () => createInvoiceDraft(store, draftInput(member, { id: "bad", lines: [] })),
    /line/i,
  );
  assert.throws(
    () =>
      createInvoiceDraft(
        store,
        draftInput(member, {
          id: "bad",
          lines: [{ id: "bad-line", description: "Bad", quantity: 0, unitPriceMinor: 1, taxRateId: "standard" }],
        }),
      ),
    /quantity/i,
  );
});

test("a new invoice cannot reuse a payment reference held by another merchant record", async () => {
  const { createInvoiceDraft } = await invoiceDomain();
  const { member, store } = merchantStore();
  const colliding = {
    ...store,
    counterCodes: [{ id: "legacy-code", memoPrefix: "NS-I-1" }],
  };

  assert.throws(
    () => createInvoiceDraft(colliding, draftInput(member)),
    /payment reference.*already reserved/i,
  );
});

test("issue-time quotes are immutable and SEP-7 carries exact asset, amount, memo, and network", async () => {
  const { createInvoiceDraft, invoicePayUri, issueInvoice } = await invoiceDomain();
  const { member, store } = merchantStore();
  const draft = createInvoiceDraft(store, draftInput(member));
  const issued = issueInvoice(draft.store, {
    invoiceId: draft.invoice.id,
    actor: member,
    network: "mainnet",
    destination: TILL,
    quotes: [{ asset: USDC, currencyPerUnit: 1 }],
    now: NOW + 100,
  });

  assert.equal(issued.invoice.status, "sent");
  assert.equal(issued.invoice.issuedAt, NOW + 100);
  assert.equal(issued.invoice.destination, TILL);
  assert.deepEqual(issued.invoice.quotes, [
    {
      asset: USDC,
      unitPriceMinorE6: 100_000_000,
      amount: "10.0000000",
      quotedAt: NOW + 100,
    },
  ]);
  const parsed = parseSep7PayUri(invoicePayUri(issued.invoice, USDC, "North Star"));
  assert.deepEqual(parsed, {
    destination: TILL,
    amount: "10.0000000",
    assetCode: "USDC",
    assetIssuer: ISSUER,
    memo: issued.invoice.reference,
    memoType: "text",
    msg: `North Star · ${issued.invoice.number}`,
    networkPassphrase: NETWORKS.mainnet.networkPassphrase,
  });

  assert.throws(
    () =>
      issueInvoice(issued.store, {
        invoiceId: draft.invoice.id,
        actor: member,
        network: "mainnet",
        destination: TILL,
        quotes: [{ asset: USDC, currencyPerUnit: 2 }],
        now: NOW + 200,
      }),
    /already issued/i,
  );
  assert.equal(issued.store.invoices[0].quotes[0].unitPriceMinorE6, 100_000_000);
});

test("Horizon payments settle partially then fully and replay is idempotent", async () => {
  const { createInvoiceDraft, issueInvoice, reconcileInvoicePayments } = await invoiceDomain();
  const { member, store } = merchantStore();
  const draft = createInvoiceDraft(store, draftInput(member));
  const issued = issueInvoice(draft.store, {
    invoiceId: draft.invoice.id,
    actor: member,
    network: "mainnet",
    destination: TILL,
    quotes: [{ asset: USDC, currencyPerUnit: 1 }],
    now: NOW + 100,
  });

  const firstPayment = payment("payment-1", "4.0000000", issued.invoice.reference);
  const first = reconcileInvoicePayments(issued.store, {
    network: "mainnet",
    payments: [firstPayment],
    now: NOW + 1000,
  });
  assert.equal(first.unclaimed.length, 0);
  assert.equal(first.store.invoices[0].status, "partially_paid");
  assert.equal(first.store.invoices[0].paidMinor, 400);
  assert.equal(first.store.invoices[0].customerAddress, PAYER);

  const replay = reconcileInvoicePayments(first.store, {
    network: "mainnet",
    payments: [firstPayment],
    now: NOW + 1500,
  });
  assert.equal(replay.store.invoices[0].paidMinor, 400);
  assert.equal(replay.store.invoices[0].payments.length, 1);

  const second = reconcileInvoicePayments(replay.store, {
    network: "mainnet",
    payments: [payment("payment-2", "6.0000000", issued.invoice.reference)],
    now: NOW + 2000,
  });
  assert.equal(second.store.invoices[0].status, "paid");
  assert.equal(second.store.invoices[0].paidMinor, 1000);
  assert.equal(second.store.invoices[0].paidAt, NOW + 2000);
  assert.equal(second.store.invoices[0].payments.length, 2);
});

test("an invoice overpayment settles only the balance and isolates the exact surplus", async () => {
  const { createInvoiceDraft, issueInvoice, reconcileInvoicePayments } = await invoiceDomain();
  const { member, store } = merchantStore();
  const draft = createInvoiceDraft(store, draftInput(member));
  const issued = issueInvoice(draft.store, {
    invoiceId: draft.invoice.id,
    actor: member,
    network: "mainnet",
    destination: TILL,
    quotes: [{ asset: USDC, currencyPerUnit: 1 }],
    now: NOW + 100,
  });
  const observed = payment("payment-overpaid", "12.0000000", issued.invoice.reference);

  const reconciled = reconcileInvoicePayments(issued.store, {
    network: "mainnet",
    payments: [observed],
    now: NOW + 2_000,
  });
  const invoice = reconciled.store.invoices[0];

  assert.equal(invoice.status, "paid");
  assert.equal(invoice.paidMinor, 1_000);
  assert.deepEqual(invoice.payments[0], {
    id: observed.id,
    kind: "stellar",
    network: "mainnet",
    amountMinor: 1_000,
    receivedMinor: 1_200,
    overpaymentMinor: 200,
    asset: USDC,
    amount: "12.0000000",
    transactionHash: observed.transactionHash,
    from: PAYER,
    observedAt: NOW + 1_000,
    recordedById: null,
    recordedBy: null,
    note: null,
  });
  assert.equal(reconciled.unclaimed.length, 0);
  assert.deepEqual(reconciled.store.paymentReconciliations[0], {
    id: observed.id,
    network: "mainnet",
    payment: observed,
    outcome: "overpaid",
    chargeId: null,
    orderId: null,
    invoiceId: invoice.id,
    amountMinor: 200,
    reversalAmount: "2.0000000",
    observedAt: NOW + 2_000,
    resolution: null,
  });
  assert.equal(reconciled.store.unmatched[0].id, observed.id);
  assert.equal(reconciled.store.unmatched[0].candidateInvoiceId, invoice.id);

  const refund = {
    id: "refund-invoice-surplus",
    orderId: invoice.id,
    invoiceId: invoice.id,
    kind: "payment_reversal",
    sourcePaymentId: observed.id,
    network: "mainnet",
    amountMinor: 200,
    asset: USDC,
    amount: "2.0000000",
    destination: PAYER,
    reason: "overpayment",
    note: null,
    transactionHash: "f".repeat(64),
    submissionStatus: "accepted",
    createdAt: NOW + 2_100,
  };
  assert.equal(
    recordRefundSubmission(reconciled.store, refund).refunds[0].invoiceId,
    invoice.id,
  );
  assert.throws(
    () =>
      recordRefundSubmission(reconciled.store, {
        ...refund,
        id: "refund-too-large",
        amount: "2.0000001",
        transactionHash: "e".repeat(64),
      }),
    /exceeds.*source payment/i,
  );

  const replay = reconcileInvoicePayments(reconciled.store, {
    network: "mainnet",
    payments: [observed],
    now: NOW + 3_000,
  });
  assert.equal(replay.store.invoices[0].payments.length, 1);
  assert.equal(replay.store.paymentReconciliations.length, 1);
});

test("an invoice payment cannot file against another receiving account", async () => {
  const { createInvoiceDraft, issueInvoice, reconcileInvoicePayments } = await invoiceDomain();
  const { member, store } = merchantStore();
  const draft = createInvoiceDraft(store, draftInput(member));
  const issued = issueInvoice(draft.store, {
    invoiceId: draft.invoice.id,
    actor: member,
    network: "mainnet",
    destination: TILL,
    quotes: [{ asset: USDC, currencyPerUnit: 1 }],
    now: NOW + 100,
  });
  const observed = {
    ...payment("wrong-invoice-destination", "10.0000000", issued.invoice.reference),
    destination: ISSUER,
  };
  const reconciled = reconcileInvoicePayments(issued.store, {
    network: "mainnet",
    payments: [observed],
    now: NOW + 2_000,
  });

  assert.deepEqual(reconciled.unclaimed, [observed]);
  assert.equal(reconciled.store.invoices[0].paidMinor, 0);
});

test("manual settlement records the exact actor and survives reload", async () => {
  const { createInvoiceDraft, issueInvoice, recordManualInvoicePayment } = await invoiceDomain();
  const { member, store } = merchantStore();
  const draft = createInvoiceDraft(store, draftInput(member));
  const issued = issueInvoice(draft.store, {
    invoiceId: draft.invoice.id,
    actor: member,
    network: "mainnet",
    destination: TILL,
    quotes: [{ asset: USDC, currencyPerUnit: 1 }],
    now: NOW + 100,
  });
  const settled = recordManualInvoicePayment(issued.store, {
    invoiceId: issued.invoice.id,
    paymentId: "manual-1",
    amountMinor: 1000,
    actor: member,
    note: "Bank transfer checked",
    now: NOW + 300,
  });

  assert.equal(settled.invoice.status, "paid");
  assert.deepEqual(settled.invoice.payments[0], {
    id: "manual-1",
    kind: "manual",
    network: "mainnet",
    amountMinor: 1000,
    receivedMinor: 1000,
    overpaymentMinor: 0,
    asset: null,
    amount: null,
    transactionHash: null,
    from: null,
    observedAt: NOW + 300,
    recordedById: member.id,
    recordedBy: member.name,
    note: "Bank transfer checked",
  });
  const persisted = JSON.parse(JSON.stringify(settled.store));
  delete persisted.nextInvoiceNumber;
  const reloaded = decodeMerchantStore(persisted);
  assert.ok(reloaded);
  assert.deepEqual(reloaded.invoices[0], settled.invoice);
  assert.equal(reloaded.nextInvoiceNumber, 2);
});

test("void constraints and duplication preserve the audit trail without copying settlement", async () => {
  const {
    createInvoiceDraft,
    duplicateInvoice,
    issueInvoice,
    recordManualInvoicePayment,
    voidInvoice,
  } = await invoiceDomain();
  const { member, store } = merchantStore();
  const draft = createInvoiceDraft(store, draftInput(member));
  const voided = voidInvoice(draft.store, {
    invoiceId: draft.invoice.id,
    actor: member,
    reason: "Created in error",
    now: NOW + 10,
  });
  assert.equal(voided.invoice.status, "void");
  assert.equal(voided.invoice.voidedById, member.id);

  const duplicate = duplicateInvoice(voided.store, {
    invoiceId: voided.invoice.id,
    id: "invoice-2",
    actor: member,
    now: NOW + 20,
  });
  assert.equal(duplicate.invoice.number, "INV-2027-0002");
  assert.equal(duplicate.invoice.status, "draft");
  assert.equal(duplicate.invoice.paidMinor, 0);
  assert.deepEqual(duplicate.invoice.payments, []);
  assert.deepEqual(duplicate.invoice.quotes, []);

  const issued = issueInvoice(duplicate.store, {
    invoiceId: duplicate.invoice.id,
    actor: member,
    network: "mainnet",
    destination: TILL,
    quotes: [{ asset: USDC, currencyPerUnit: 1 }],
    now: NOW + 30,
  });
  const part = recordManualInvoicePayment(issued.store, {
    invoiceId: issued.invoice.id,
    paymentId: "manual-part",
    amountMinor: 100,
    actor: member,
    now: NOW + 40,
  });
  assert.throws(
    () =>
      voidInvoice(part.store, {
        invoiceId: part.invoice.id,
        actor: member,
        reason: "Too late",
        now: NOW + 50,
      }),
    /payment/i,
  );
});

test("production invoice surfaces use persisted actions and real document handoffs", () => {
  const list = source("src/components/merchant/InvoicesPage.tsx");
  const composer = source("src/components/merchant/InvoiceComposerModal.tsx");
  const detail = source("src/components/merchant/InvoiceDetailModal.tsx");
  const hook = source("src/hooks/useMerchant.tsx");

  for (const screen of [list, composer, detail]) {
    assert.doesNotMatch(screen, /merchant\/mock|MOCK_INVOICES|MOCK_NOW/);
  }
  assert.match(composer, /createInvoiceDraft|updateInvoiceDraft/);
  assert.match(detail, /issueInvoice|recordManualInvoicePayment|voidInvoice|duplicateInvoice/);
  assert.match(detail, /window\.print|mailto:|Blob/);
  assert.match(detail, /Invoice surplus/);
  assert.match(detail, /submitPaymentRefund/);
  assert.match(hook, /reconciliation\.reversalAmount \?\? payment\.amount/);
  assert.doesNotMatch(detail, /statusOverride|would be closed|would be voided/);
});
