import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { emptyStore } from "../src/lib/merchant/defaults.ts";
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
  assert.equal(created.invoice.reference, "NSINV1");
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

  for (const screen of [list, composer, detail]) {
    assert.doesNotMatch(screen, /merchant\/mock|MOCK_INVOICES|MOCK_NOW/);
  }
  assert.match(composer, /createInvoiceDraft|updateInvoiceDraft/);
  assert.match(detail, /issueInvoice|recordManualInvoicePayment|voidInvoice|duplicateInvoice/);
  assert.match(detail, /window\.print|mailto:|Blob/);
  assert.doesNotMatch(detail, /statusOverride|would be closed|would be voided/);
});
