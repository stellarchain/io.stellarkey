"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { useMerchant } from "@/hooks/useMerchant";
import { triggerHaptic } from "@/lib/haptics";
import { assetKey } from "@/lib/merchant/charge";
import { invoiceStatusAt } from "@/lib/merchant/invoices";
import { assetAmountFor, fmtMinor, minorToDecimal, toMinor } from "@/lib/merchant/money";
import type { Invoice, InvoiceStatus, Minor } from "@/lib/merchant/types";
import { useToast } from "../Toast";
import {
  Button,
  CopyButton,
  ErrorText,
  Field,
  HashValue,
  Modal,
  ModalHeader,
  Notice,
  Select,
} from "../ui";
import {
  IconAlert,
  IconArrowDownLeft,
  IconCheck,
  IconCopy,
  IconFileText,
  IconSend,
} from "../icons";
import { IconCheckCircle, IconPrinter, IconXCircle } from "./icons";

const DAY = 24 * 60 * 60 * 1000;

/**
 * The document is portalled straight onto `document.body`, so one attribute
 * selector beats the blanket `body > *` rule and nothing else — app chrome, the
 * modal, the backdrop — survives onto the page.
 */
const PRINT_CSS = `
@page { size: A4; margin: 0; }

[data-invoice-print] { display: none; }

@media print {
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    background: #ffffff !important;
  }
  /* The app's ambient gradients are ::before/::after on body, which the
     child selector below cannot reach — they would wash the sheet in colour. */
  body::before,
  body::after { display: none !important; content: none !important; }
  body > * { display: none !important; }
  body > [data-invoice-print] {
    display: block !important;
    width: 210mm;
    background: #ffffff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
`;

/* The print copy only exists in a browser, and nothing about that changes while
   the sheet is up, so the portal is gated on a snapshot rather than an effect. */
const subscribeNothing = () => () => {};
const readMounted = () => true;
const readNotMounted = () => false;

type InvoiceTone = "neutral" | "accent" | "warn" | "pos" | "neg";

const TONE_CLASS: Record<InvoiceTone, string> = {
  neutral: "text-neutral-400 bg-white/[0.08]",
  accent: "text-[#0A84FF] bg-[#0A84FF]/15",
  warn: "text-[#FF9F0A] bg-[#FF9F0A]/15",
  pos: "text-[#30D158] bg-[#30D158]/15",
  neg: "text-[#FF453A] bg-[#FF453A]/15",
};

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  partially_paid: "Part paid",
  paid: "Paid",
  overdue: "Overdue",
  void: "Void",
};

const STATUS_TONE: Record<InvoiceStatus, InvoiceTone> = {
  draft: "neutral",
  sent: "accent",
  partially_paid: "warn",
  paid: "pos",
  overdue: "neg",
  void: "neutral",
};

/** Never colour alone: every status carries a glyph and a word. */
const STATUS_GLYPH: Record<InvoiceStatus, (props: { size?: number }) => React.ReactElement> = {
  draft: IconFileText,
  sent: IconSend,
  partially_paid: IconArrowDownLeft,
  paid: IconCheckCircle,
  overdue: IconAlert,
  void: IconXCircle,
};

export function InvoiceStatusPill({
  status,
  compact = false,
}: {
  status: InvoiceStatus;
  compact?: boolean;
}) {
  const Glyph = STATUS_GLYPH[status];
  /* On a list row the leading icon already carries the glyph in this same tone,
     so the compact pill spends its width on the word instead of repeating it. */
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full text-[11px] font-semibold ${
        compact ? "px-1.5 py-[2px]" : "px-2 py-[3px]"
      } ${TONE_CLASS[STATUS_TONE[status]]}`}
    >
      {!compact && <Glyph size={10} />}
      {INVOICE_STATUS_LABEL[status]}
    </span>
  );
}

export function InvoiceStatusIcon({ status }: { status: InvoiceStatus }) {
  const Glyph = STATUS_GLYPH[status];
  return (
    <span
      aria-hidden="true"
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${TONE_CLASS[STATUS_TONE[status]]}`}
    >
      <Glyph size={15} />
    </span>
  );
}

/** What is still owed on the stored figures. Never negative. */
export function invoiceBalanceMinor(invoice: Invoice): Minor {
  return Math.max(0, invoice.totals.totalMinor - invoice.paidMinor);
}

/** Positive when the due date has passed, negative when it has not, null for a draft. */
export function daysPastDue(invoice: Invoice, now = Date.now()): number | null {
  if (invoice.dueAt === null) return null;
  return Math.round((now - invoice.dueAt) / DAY);
}

/** Day-first invoice dates for the shop's persisted document record. */
export function fmtInvoiceDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function fmtInvoiceDateTime(ts: number): string {
  return new Date(ts).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

/* ------------------------------------------------------------------ */
/* The document                                                        */
/* ------------------------------------------------------------------ */

export function InvoiceDetailModal({
  invoice,
  onClose,
}: {
  invoice: Invoice | null;
  onClose: () => void;
}) {
  if (!invoice) return null;
  // Keyed so stepping from one invoice to the next starts on clean local state.
  return <InvoiceDocument key={invoice.id} invoice={invoice} onClose={onClose} />;
}

function InvoiceDocument({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const {
    duplicateInvoice,
    invoiceBlockedReason,
    invoicePayUriFor,
    issueInvoice,
    paymentReconciliations,
    recordManualInvoicePayment,
    settings,
    submitPaymentRefund,
    voidInvoice,
  } = useMerchant();
  const { toast } = useToast();

  const [confirmingPayment, setConfirmingPayment] = useState(false);
  const [confirmingVoid, setConfirmingVoid] = useState(false);
  const [manualAmount, setManualAmount] = useState(() => minorToDecimal(invoiceBalanceMinor(invoice)));
  const [manualNote, setManualNote] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [actionError, setActionError] = useState("");
  const [refundingSurplus, setRefundingSurplus] = useState(false);
  const [selectedAssetKey, setSelectedAssetKey] = useState(
    () => invoice.quotes[0] ? assetKey(invoice.quotes[0].asset) : "",
  );
  const [qr, setQr] = useState<{ uri: string; dataUrl: string } | null>(null);
  const mounted = useSyncExternalStore(subscribeNothing, readMounted, readNotMounted);

  const status = invoiceStatusAt(invoice);
  const currency = invoice.currency;
  const shopName = settings.profile.name.trim();
  const destination = invoice.destination;

  const paidMinor = invoice.paidMinor;
  const balanceMinor = Math.max(0, invoice.totals.totalMinor - paidMinor);
  const overdueDays = daysPastDue(invoice);
  const surplus = paymentReconciliations.find(
    (entry) => entry.invoiceId === invoice.id && entry.outcome === "overpaid",
  ) ?? null;

  const rateLabel = useMemo(() => {
    const byId = new Map(settings.taxRates.map((r) => [r.id, r]));
    return (id: string) => {
      const rate = byId.get(id);
      return rate ? `${rate.label} ${rate.percent} %` : id;
    };
  }, [settings.taxRates]);

  const selectedQuote = invoice.quotes.find(
    (quote) => assetKey(quote.asset) === selectedAssetKey,
  ) ?? invoice.quotes[0] ?? null;
  const payAmount = selectedQuote && balanceMinor > 0
    ? assetAmountFor(balanceMinor, selectedQuote.unitPriceMinorE6)
    : null;
  const payUri = useMemo(() => {
    if (!selectedQuote) return null;
    return invoicePayUriFor(invoice, selectedQuote.asset);
  }, [invoice, invoicePayUriFor, selectedQuote]);

  useEffect(() => {
    if (!payUri) return;
    let alive = true;
    void (async () => {
      try {
        const dataUrl = await QRCode.toDataURL(payUri, {
          width: 440,
          margin: 1.5,
          color: { dark: "#000000", light: "#ffffff" },
        });
        if (alive) setQr({ uri: payUri, dataUrl });
      } catch {
        if (alive) setQr(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [payUri]);

  const qrDataUrl = qr !== null && qr.uri === payUri ? qr.dataUrl : null;

  async function copyPayUri() {
    if (!payUri) return;
    try {
      await navigator.clipboard.writeText(payUri);
      triggerHaptic("selection");
      toast("Payment request copied. It carries the account and the reference.", "success");
    } catch {
      triggerHaptic("error");
      toast("The clipboard is not available here", "error");
    }
  }

  /* A draft the OS composes. Nothing is sent from here and no address is stored:
     the shop reads it over and presses send in its own mail app. */
  const reminderHref = useMemo(() => {
    if (!invoice.customerEmail) return null;
    const subject = `${shopName || "Invoice"} — ${invoice.number}`;
    const lines = [
      `${invoice.customerName},`,
      "",
      invoice.issuedAt === null
        ? `Invoice ${invoice.number}.`
        : `Invoice ${invoice.number}, issued ${fmtInvoiceDate(invoice.issuedAt)}.`,
      `Total ${fmtMinor(invoice.totals.totalMinor, currency)}`,
      ...(paidMinor > 0 ? [`Paid so far ${fmtMinor(paidMinor, currency)}`] : []),
      invoice.dueAt === null
        ? `Balance due ${fmtMinor(balanceMinor, currency)}`
        : `Balance due ${fmtMinor(balanceMinor, currency)} by ${fmtInvoiceDate(invoice.dueAt)}`,
      ...(overdueDays !== null && overdueDays > 0
        ? [`This is ${overdueDays} ${overdueDays === 1 ? "day" : "days"} past due.`]
        : []),
      "",
      ...(destination ? [`Pay to ${destination}`] : []),
      `Quote ${invoice.reference} as the payment memo, or the payment lands unmatched.`,
      ...(payUri ? ["", payUri] : []),
      "",
      shopName || "",
    ];
    const body = lines.join("\n");
    return `mailto:${invoice.customerEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }, [
    balanceMinor,
    currency,
    destination,
    invoice.customerEmail,
    invoice.customerName,
    invoice.dueAt,
    invoice.issuedAt,
    invoice.number,
    invoice.reference,
    invoice.totals.totalMinor,
    overdueDays,
    paidMinor,
    payUri,
    shopName,
  ]);

  async function handleIssue() {
    setActionError("");
    try {
      await issueInvoice(invoice.id);
      triggerHaptic("success");
      toast(`${invoice.number} issued with locked asset quotes`, "success");
    } catch (error) {
      triggerHaptic("error");
      setActionError(error instanceof Error ? error.message : "The invoice could not be issued.");
    }
  }

  async function handleManualPayment() {
    setActionError("");
    try {
      const amountMinor = toMinor(manualAmount);
      await recordManualInvoicePayment({
        invoiceId: invoice.id,
        amountMinor,
        note: manualNote,
      });
      triggerHaptic("success");
      toast(`${fmtMinor(amountMinor, currency)} recorded against ${invoice.number}`, "success");
      setConfirmingPayment(false);
      setManualNote("");
    } catch (error) {
      triggerHaptic("error");
      setActionError(error instanceof Error ? error.message : "The payment could not be recorded.");
    }
  }

  async function handleSurplusRefund() {
    if (!surplus || surplus.resolution || refundingSurplus) return;
    setActionError("");
    setRefundingSurplus(true);
    try {
      const outcome = await submitPaymentRefund(
        surplus.id,
        `Invoice surplus for ${invoice.number}`,
      );
      if (outcome.kind === "requested") {
        toast(`Refund approval requested for the ${invoice.number} surplus`, "info");
      } else if (outcome.refund.submissionStatus === "failed") {
        setActionError("The surplus refund was rejected. No funds moved, so it remains safe to retry.");
      } else {
        toast(
          outcome.refund.submissionStatus === "confirmed"
            ? `Invoice surplus returned for ${invoice.number}`
            : "Surplus refund submitted and tracked on Stellar",
          outcome.refund.submissionStatus === "confirmed" ? "success" : "info",
        );
      }
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "The invoice surplus could not be returned.",
      );
    } finally {
      setRefundingSurplus(false);
    }
  }

  async function handleVoid() {
    setActionError("");
    try {
      await voidInvoice(invoice.id, voidReason);
      triggerHaptic("warning");
      toast(`${invoice.number} voided with an audit reason`, "success");
      setConfirmingVoid(false);
    } catch (error) {
      triggerHaptic("error");
      setActionError(error instanceof Error ? error.message : "The invoice could not be voided.");
    }
  }

  async function handleDuplicate() {
    setActionError("");
    try {
      const duplicate = await duplicateInvoice(invoice.id);
      triggerHaptic("success");
      toast(`${duplicate.number} saved as a new draft`, "success");
      onClose();
    } catch (error) {
      triggerHaptic("error");
      setActionError(error instanceof Error ? error.message : "The invoice could not be duplicated.");
    }
  }

  function exportInvoice() {
    const blob = new Blob([JSON.stringify(invoice, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${invoice.number.toLowerCase()}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 0);
    triggerHaptic("light");
    toast("Invoice audit record exported", "success");
  }

  const steps = buildTimeline(invoice, status, paidMinor);

  return (
    <>
      <Modal open onClose={onClose} wide>
        <ModalHeader
          title={invoice.number}
          subtitle={`${invoice.customerName} · ${INVOICE_STATUS_LABEL[status]}`}
          onClose={onClose}
        />

        <div className="space-y-4 p-4 sm:p-6">
          {/* ---------- what it comes to ---------- */}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="mono text-[34px] font-semibold leading-none text-white">
                {fmtMinor(invoice.totals.totalMinor, currency)}
              </p>
              <p className="mt-2 text-[13px] text-neutral-400">
                {status === "void"
                  ? "Voided — nothing is owed on it."
                  : balanceMinor === 0
                    ? "Settled in full."
                    : `${fmtMinor(balanceMinor, currency)} outstanding`}
                {status !== "void" &&
                  overdueDays !== null &&
                  overdueDays > 0 &&
                  balanceMinor > 0 && (
                    <span className="text-[#FF453A]">
                      {" "}
                      · {overdueDays} {overdueDays === 1 ? "day" : "days"} past due
                    </span>
                  )}
              </p>
            </div>
            <InvoiceStatusPill status={status} />
          </div>

          {/* ---------- who to who ---------- */}
          <div className="panel-inset grid gap-4 p-4 sm:grid-cols-2">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                From
              </p>
              <p className="mt-1 text-[13.5px] font-semibold text-white">
                {shopName || "Your shop"}
              </p>
              {settings.profile.addressLines.filter(Boolean).map((line) => (
                <p key={line} className="text-[12.5px] leading-relaxed text-neutral-400">
                  {line}
                </p>
              ))}
              {settings.profile.taxId.trim() ? (
                <p className="mono mt-1 text-[11.5px] text-neutral-500">
                  VAT {settings.profile.taxId.trim()}
                </p>
              ) : (
                <p className="mt-1 text-[11.5px] text-neutral-500">
                  No tax number set — Merchant settings → Shop details
                </p>
              )}
            </div>

            <div className="min-w-0 border-t border-white/[0.08] pt-3 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                Billed to
              </p>
              <p className="mt-1 text-[13.5px] font-semibold text-white">{invoice.customerName}</p>
              <p className="text-[12.5px] text-neutral-400">
                {invoice.customerEmail ?? "No email on file"}
              </p>
              {invoice.customerAddress && (
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="text-[11.5px] text-neutral-500">Pays from</span>
                  <HashValue
                    value={invoice.customerAddress}
                    head={6}
                    tail={6}
                    className="text-[11.5px] text-neutral-300"
                  />
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[11.5px] text-neutral-500">
                <span>
                  Issued{" "}
                  <span className="mono text-neutral-300">
                    {invoice.issuedAt === null ? "—" : fmtInvoiceDate(invoice.issuedAt)}
                  </span>
                </span>
                <span>
                  Due{" "}
                  <span
                    className="mono"
                    style={{
                      color: overdueDays !== null && overdueDays > 0 ? "#FF453A" : "#d4d4d4",
                    }}
                  >
                    {invoice.dueAt === null ? "—" : fmtInvoiceDate(invoice.dueAt)}
                  </span>
                </span>
              </div>
            </div>
          </div>

          {/* ---------- the lines ---------- */}
          <div className="list-group">
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
              <span>Item</span>
              <span>Amount</span>
            </div>
            {invoice.lines.map((line) => (
              <div
                key={line.id}
                className="flex items-start justify-between gap-3 border-t border-white/[0.08] px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-[13.5px] leading-snug text-white">{line.description}</p>
                  <p className="mono mt-0.5 text-[11.5px] text-neutral-500">
                    {line.quantity} × {fmtMinor(line.unitPriceMinor, currency)} ·{" "}
                    {rateLabel(line.taxRateId)}
                  </p>
                </div>
                <p className="mono shrink-0 text-[13.5px] text-white">
                  {fmtMinor(line.quantity * line.unitPriceMinor, currency)}
                </p>
              </div>
            ))}
          </div>

          {/* ---------- the money ---------- */}
          <div className="panel-inset space-y-2 p-4">
            <SumRow label="Net" value={fmtMinor(invoice.totals.netMinor, currency)} />
            {Object.entries(invoice.totals.taxByRate).map(([rateId, minor]) => (
              <SumRow
                key={rateId}
                label={`VAT · ${rateLabel(rateId)}`}
                value={fmtMinor(minor, currency)}
              />
            ))}
            <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] pt-2.5">
              <span className="text-[13.5px] font-semibold text-white">Total</span>
              <span className="mono text-[17px] font-semibold text-white">
                {fmtMinor(invoice.totals.totalMinor, currency)}
              </span>
            </div>
            {paidMinor > 0 && (
              <SumRow
                label="Paid"
                value={`− ${fmtMinor(paidMinor, currency)}`}
                valueClass="text-[#30D158]"
              />
            )}
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] text-neutral-400">Balance due</span>
              <span
                className="mono text-[15.5px] font-semibold"
                style={{
                  color:
                    balanceMinor === 0
                      ? "#30D158"
                      : overdueDays !== null && overdueDays > 0
                        ? "#FF453A"
                        : "#ffffff",
                }}
              >
                {fmtMinor(balanceMinor, currency)}
              </span>
            </div>
            <p className="pt-1 text-[11.5px] leading-relaxed text-neutral-500">
              {settings.taxMode === "inclusive"
                ? "Unit prices include VAT."
                : "VAT is added to the unit prices."}
            </p>
          </div>

          {surplus && (
            <Notice tone={surplus.resolution ? "pos" : "warn"}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold text-white">Invoice surplus</p>
                  <p className="mt-1">
                    {surplus.reversalAmount ?? surplus.payment.amount} {surplus.payment.asset.code}
                    {surplus.resolution
                      ? " has been resolved in the incoming-payment audit."
                      : ` (${fmtMinor(surplus.amountMinor ?? 0, currency)}) arrived above the balance and was not counted as invoice takings.`}
                  </p>
                </div>
                {!surplus.resolution && (
                  <Button
                    variant="secondary"
                    className="shrink-0"
                    loading={refundingSurplus}
                    onClick={() => void handleSurplusRefund()}
                  >
                    Return surplus
                  </Button>
                )}
              </div>
            </Notice>
          )}

          {invoice.note && (
            <div className="panel-inset px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                Note
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-neutral-300">{invoice.note}</p>
            </div>
          )}

          {/* ---------- how it gets paid ---------- */}
          <div className="panel-inset space-y-3.5 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
              Payment
            </p>

            <div>
              <p className="text-[12px] text-neutral-400">
                Reference the payer must quote as the memo
              </p>
              <div className="mt-1.5 flex items-center justify-between gap-3">
                <span className="mono text-[20px] font-semibold text-white">
                  {invoice.reference}
                </span>
                <CopyButton value={invoice.reference} label="Copy" />
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-neutral-400">
                A payment that arrives without it lands in the unmatched tray and has to be filed
                against this invoice by hand.
              </p>
            </div>

            {status === "draft" ? (
              <Notice tone="info">
                <p className="font-semibold text-white">Issue before sharing a payment request.</p>
                <p className="mt-1">
                  Issuing snapshots the receiving account and live asset prices so this document
                  cannot silently change after it reaches the customer.
                </p>
              </Notice>
            ) : status === "paid" ? (
              <Notice tone="pos">
                <p className="font-semibold text-white">Paid in full.</p>
                <p className="mt-1">The payment history below is the settlement audit for this invoice.</p>
              </Notice>
            ) : status === "void" ? (
              <Notice tone="warn">
                <p className="font-semibold text-white">This invoice is void.</p>
                <p className="mt-1">Its old payment request must no longer be shared.</p>
              </Notice>
            ) : destination && payUri && selectedQuote && payAmount ? (
              <>
                {invoice.quotes.length > 1 && (
                  <div>
                    <span className="field-label">Pay with</span>
                    <Select
                      value={assetKey(selectedQuote.asset)}
                      onChange={setSelectedAssetKey}
                      options={invoice.quotes.map((quote) => ({
                        value: assetKey(quote.asset),
                        label: quote.asset.code,
                        sublabel: quote.asset.issuer ? `${quote.asset.issuer.slice(0, 5)}…${quote.asset.issuer.slice(-5)}` : "native",
                      }))}
                      ariaLabel="Invoice payment asset"
                      preserveOptionLabels
                    />
                  </div>
                )}
                <div className="rounded-2xl bg-[#0A84FF]/10 px-4 py-3 text-center">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#64AFFF]">
                    Exact amount requested
                  </p>
                  <p className="mono mt-1 text-[24px] font-semibold text-white">
                    {payAmount} {selectedQuote.asset.code}
                  </p>
                  <p className="mt-1 text-[11.5px] text-neutral-400">
                    Locked when issued · balance {fmtMinor(balanceMinor, currency)}
                  </p>
                </div>
                <div className="flex justify-center pt-1">
                  <div className="rounded-3xl bg-white p-3.5 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.9)]">
                    {qrDataUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={qrDataUrl}
                        alt={`Payment request for ${invoice.number}, reference ${invoice.reference}`}
                        width={182}
                        height={182}
                        className="rounded-2xl"
                      />
                    ) : (
                      <div className="skeleton h-[182px] w-[182px] rounded-2xl" />
                    )}
                  </div>
                </div>
                <p className="text-center text-[12px] leading-relaxed text-neutral-400">
                  The request carries this exact amount, asset, issuer, memo, destination and
                  {invoice.network} network. Horizon applies matching payments to the balance once.
                </p>
                <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] pt-3">
                  <span className="shrink-0 text-[13px] text-neutral-400">To</span>
                  <HashValue value={destination} className="text-[12.5px] text-neutral-200" />
                </div>
              </>
            ) : (
              <Notice tone="warn">
                <p className="font-semibold text-white">A payable request is unavailable.</p>
                <p className="mt-1">
                  This issued record has no complete destination and asset quote snapshot. It is
                  preserved for audit, but the app will not invent payment details for it.
                </p>
              </Notice>
            )}
          </div>

          {/* ---------- what you can do about it ---------- */}
          <div className="space-y-2.5">
            <Button
              className="w-full"
              onClick={() => {
                triggerHaptic("light");
                toast("Sent to the print dialog — the invoice prints alone. Save as PDF is there too.");
                window.print();
              }}
            >
              <IconPrinter size={15} /> Print / Save as PDF
            </Button>

            <div className="grid gap-2.5 sm:grid-cols-2">
              {/* An anchor, not a Button: only a real `mailto:` href makes the OS
                  open its own composer. The classes match `variant="secondary"`
                  so it sits level with the buttons beside it. */}
              {reminderHref && status !== "draft" && status !== "void" ? (
                <a
                  href={reminderHref}
                  onClick={() => triggerHaptic("light")}
                  className="btn border border-white/10 bg-white/[0.08] text-white hover:bg-white/[0.14]"
                >
                  <IconSend size={14} /> Send a reminder
                </a>
              ) : (
                <Button variant="secondary" disabled>
                  <IconSend size={14} /> Send a reminder
                </Button>
              )}
              <Button variant="secondary" disabled={!payUri} onClick={() => void copyPayUri()}>
                <IconCopy size={14} /> Copy request
              </Button>
              <Button variant="secondary" onClick={exportInvoice}>
                <IconFileText size={14} /> Export record
              </Button>
              <Button variant="secondary" onClick={handleDuplicate}>
                <IconCopy size={14} /> Duplicate
              </Button>
              {status === "draft" ? (
                <Button disabled={Boolean(invoiceBlockedReason)} onClick={handleIssue}>
                  <IconSend size={14} /> Issue invoice
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  disabled={status === "paid" || status === "void"}
                  onClick={() => {
                    setActionError("");
                    setManualAmount(minorToDecimal(balanceMinor));
                    setConfirmingPayment(true);
                  }}
                >
                  <IconCheck size={14} /> Record payment
                </Button>
              )}
              <Button
                variant="danger"
                disabled={status === "void" || paidMinor > 0}
                onClick={() => {
                  triggerHaptic("warning");
                  setActionError("");
                  setConfirmingVoid(true);
                }}
              >
                <IconXCircle size={14} /> Void
              </Button>
            </div>

            {status === "draft" && invoiceBlockedReason && (
              <Notice tone="warn">{invoiceBlockedReason}</Notice>
            )}

            {confirmingPayment && (
              <div className="panel-inset space-y-3 p-4">
                <p className="text-[13.5px] font-semibold text-white">Record an external payment</p>
                <p className="text-[12px] leading-relaxed text-neutral-400">
                  Use this only after checking the bank, cash, or another rail. The staff member,
                  amount, time and note are written to the audit record.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={`Amount · ${currency}`}>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={manualAmount}
                      onChange={(event) => setManualAmount(event.target.value)}
                      className="input mono text-base sm:text-[14px]"
                    />
                  </Field>
                  <Field label="Evidence note" hint="Optional">
                    <input
                      type="text"
                      value={manualNote}
                      onChange={(event) => setManualNote(event.target.value)}
                      placeholder="Bank transfer checked"
                      className="input text-base sm:text-[14px]"
                    />
                  </Field>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" className="flex-1" onClick={() => setConfirmingPayment(false)}>
                    Cancel
                  </Button>
                  <Button className="flex-1" onClick={handleManualPayment}>
                    Record payment
                  </Button>
                </div>
              </div>
            )}

            {confirmingVoid && (
              <div className="panel-inset space-y-3 p-4">
                <p className="text-[13.5px] font-semibold text-white">Void this invoice?</p>
                <Field label="Audit reason">
                  <input
                    type="text"
                    value={voidReason}
                    onChange={(event) => setVoidReason(event.target.value)}
                    placeholder="Created in error"
                    className="input text-base sm:text-[14px]"
                  />
                </Field>
                <div className="flex gap-2">
                  <Button variant="secondary" className="flex-1" onClick={() => setConfirmingVoid(false)}>
                    Keep it
                  </Button>
                  <Button variant="danger" className="flex-1" onClick={handleVoid}>
                    Void invoice
                  </Button>
                </div>
              </div>
            )}

            {actionError && <ErrorText message={actionError} />}

            <p className="text-center text-[12px] leading-relaxed text-neutral-500">
              {invoice.customerEmail
                ? "The reminder opens your mail app with the figures and exact request already in it. Nothing is sent until you send it."
                : "No email is stored, so there is no mail draft to open. Print or export the invoice instead."}
            </p>
          </div>

          {/* ---------- how it got here ---------- */}
          <div className="panel-inset p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
              Timeline
            </p>
            <ol className="mt-3">
              {steps.map((step, i) => (
                <li key={step.key} className="relative flex gap-3 pb-4 last:pb-0">
                  {i < steps.length - 1 && (
                    <span
                      aria-hidden="true"
                      className="absolute bottom-0 left-[7px] top-4 w-px bg-white/[0.12]"
                    />
                  )}
                  <span
                    aria-hidden="true"
                    className="relative mt-[3px] flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full"
                    style={{
                      backgroundColor:
                        step.state === "done"
                          ? "#30D158"
                          : step.state === "alert"
                            ? "#FF453A"
                            : "rgba(255,255,255,0.14)",
                    }}
                  >
                    {step.state === "done" && <IconCheck size={9} className="text-black" />}
                    {step.state === "alert" && <IconAlert size={9} className="text-white" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className="text-[13px] font-medium"
                      style={{ color: step.state === "pending" ? "#8e8e93" : "#ffffff" }}
                    >
                      {step.label}
                    </p>
                    <p className="mono text-[11.5px] text-neutral-500">
                      {step.at === null ? step.pendingText : fmtInvoiceDateTime(step.at)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-1 text-[11.5px] leading-relaxed text-neutral-500">
              Stellar payments come from Horizon; manual entries retain the operator and evidence note.
            </p>
          </div>
        </div>
      </Modal>

      {/* The print copy: hidden on screen, and the only thing left on paper. */}
      {mounted &&
        createPortal(
          <div data-invoice-print="">
            <style>{PRINT_CSS}</style>
            <InvoicePaper
              invoice={invoice}
              status={status}
              paidMinor={paidMinor}
              balanceMinor={balanceMinor}
              rateLabel={rateLabel}
              shopName={shopName || "Your shop"}
              addressLines={settings.profile.addressLines.filter(Boolean)}
              taxId={settings.profile.taxId.trim()}
              footer={settings.profile.receiptFooter.trim()}
              destination={destination}
              qrDataUrl={qrDataUrl}
              payAmount={payAmount}
              payAssetCode={selectedQuote?.asset.code ?? null}
              taxModeNote={
                settings.taxMode === "inclusive"
                  ? "Unit prices include VAT."
                  : "VAT is added to the unit prices."
              }
            />
          </div>,
          document.body,
        )}
    </>
  );
}

function SumRow({
  label,
  value,
  valueClass = "text-neutral-200",
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[13px] text-neutral-400">{label}</span>
      <span className={`mono text-[13.5px] ${valueClass}`}>{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The paper                                                           */
/* ------------------------------------------------------------------ */

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

/**
 * A4 black-on-white, laid out in millimetres and points so the printer gets the
 * document and nothing else. It carries the same figures as the screen — same
 * `totals`, same `fmtMinor` — plus the reference and the SEP-7 code, so the
 * paper copy can be paid from on its own.
 */
function InvoicePaper({
  invoice,
  status,
  paidMinor,
  balanceMinor,
  rateLabel,
  shopName,
  addressLines,
  taxId,
  footer,
  destination,
  qrDataUrl,
  payAmount,
  payAssetCode,
  taxModeNote,
}: {
  invoice: Invoice;
  status: InvoiceStatus;
  paidMinor: Minor;
  balanceMinor: Minor;
  rateLabel: (id: string) => string;
  shopName: string;
  addressLines: string[];
  taxId: string;
  footer: string;
  destination: string | null;
  qrDataUrl: string | null;
  payAmount: string | null;
  payAssetCode: string | null;
  taxModeNote: string;
}) {
  const currency = invoice.currency;
  const cell: React.CSSProperties = { padding: "2.4mm 0", verticalAlign: "top" };
  const head: React.CSSProperties = {
    padding: "0 0 1.6mm",
    borderBottom: "0.4mm solid #000000",
    fontSize: "7.5pt",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  };

  return (
    <div
      style={{
        width: "210mm",
        minHeight: "297mm",
        boxSizing: "border-box",
        padding: "16mm",
        background: "#ffffff",
        color: "#000000",
        fontSize: "9.5pt",
        lineHeight: 1.45,
      }}
    >
      {/* Who is billing whom for what */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: "10mm" }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: "15pt", fontWeight: 700, letterSpacing: "-0.01em" }}>
            {shopName}
          </p>
          {addressLines.map((line) => (
            <p key={line} style={{ margin: 0, fontSize: "8.5pt" }}>
              {line}
            </p>
          ))}
          {taxId && (
            <p style={{ margin: "1mm 0 0", fontSize: "8.5pt", fontFamily: MONO }}>VAT {taxId}</p>
          )}
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <p style={{ margin: 0, fontSize: "8pt", letterSpacing: "0.14em", fontWeight: 600 }}>
            {status === "void" ? "VOID INVOICE" : "INVOICE"}
          </p>
          <p style={{ margin: "0.5mm 0 0", fontSize: "13pt", fontWeight: 700, fontFamily: MONO }}>
            {invoice.number}
          </p>
          <p style={{ margin: "1.5mm 0 0", fontSize: "8.5pt" }}>
            Issued {invoice.issuedAt === null ? "—" : fmtInvoiceDate(invoice.issuedAt)}
          </p>
          <p style={{ margin: 0, fontSize: "8.5pt" }}>
            Due {invoice.dueAt === null ? "—" : fmtInvoiceDate(invoice.dueAt)}
          </p>
        </div>
      </div>

      <div style={{ margin: "8mm 0 0" }}>
        <p style={{ margin: 0, fontSize: "7.5pt", letterSpacing: "0.08em", fontWeight: 600 }}>
          BILLED TO
        </p>
        <p style={{ margin: "1mm 0 0", fontSize: "11pt", fontWeight: 650 }}>
          {invoice.customerName}
        </p>
        {invoice.customerEmail && (
          <p style={{ margin: 0, fontSize: "8.5pt" }}>{invoice.customerEmail}</p>
        )}
      </div>

      {/* What is on it */}
      <table style={{ width: "100%", borderCollapse: "collapse", margin: "8mm 0 0" }}>
        <thead>
          <tr>
            <th style={{ ...head, textAlign: "left" }}>Description</th>
            <th style={{ ...head, textAlign: "right", width: "16mm" }}>Qty</th>
            <th style={{ ...head, textAlign: "right", width: "26mm" }}>Unit</th>
            <th style={{ ...head, textAlign: "left", width: "34mm", paddingLeft: "6mm" }}>VAT</th>
            <th style={{ ...head, textAlign: "right", width: "30mm" }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((line) => (
            <tr key={line.id} style={{ borderBottom: "0.2mm solid #cccccc" }}>
              <td style={{ ...cell, textAlign: "left" }}>{line.description}</td>
              <td style={{ ...cell, textAlign: "right", fontFamily: MONO }}>{line.quantity}</td>
              <td style={{ ...cell, textAlign: "right", fontFamily: MONO }}>
                {fmtMinor(line.unitPriceMinor, currency)}
              </td>
              <td style={{ ...cell, textAlign: "left", paddingLeft: "6mm", fontSize: "8.5pt" }}>
                {rateLabel(line.taxRateId)}
              </td>
              <td style={{ ...cell, textAlign: "right", fontFamily: MONO }}>
                {fmtMinor(line.quantity * line.unitPriceMinor, currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* What it comes to */}
      <div style={{ display: "flex", justifyContent: "flex-end", margin: "6mm 0 0" }}>
        <table style={{ borderCollapse: "collapse", minWidth: "76mm" }}>
          <tbody>
            <PaperSum label="Net" value={fmtMinor(invoice.totals.netMinor, currency)} />
            {Object.entries(invoice.totals.taxByRate).map(([rateId, minor]) => (
              <PaperSum
                key={rateId}
                label={`VAT · ${rateLabel(rateId)}`}
                value={fmtMinor(minor, currency)}
              />
            ))}
            <PaperSum
              label="Total"
              value={fmtMinor(invoice.totals.totalMinor, currency)}
              strong
              rule
            />
            {paidMinor > 0 && (
              <PaperSum label="Paid" value={`− ${fmtMinor(paidMinor, currency)}`} />
            )}
            <PaperSum label="Balance due" value={fmtMinor(balanceMinor, currency)} strong />
          </tbody>
        </table>
      </div>
      <p style={{ margin: "2mm 0 0", fontSize: "8pt", textAlign: "right" }}>{taxModeNote}</p>

      {invoice.note && (
        <p style={{ margin: "8mm 0 0", fontSize: "9pt" }}>
          <span style={{ fontWeight: 650 }}>Note. </span>
          {invoice.note}
        </p>
      )}

      {/* How to pay it */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "8mm",
          margin: "10mm 0 0",
          padding: "5mm",
          border: "0.4mm solid #000000",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: "7.5pt", letterSpacing: "0.08em", fontWeight: 600 }}>
            HOW TO PAY
          </p>
          <p style={{ margin: "2mm 0 0", fontSize: "8.5pt" }}>
            Pay in any Stellar wallet, to this account:
          </p>
          <p
            style={{
              margin: "1mm 0 0",
              fontSize: "8pt",
              fontFamily: MONO,
              wordBreak: "break-all",
            }}
          >
            {destination ?? "— no receiving account set —"}
          </p>
          <p style={{ margin: "3mm 0 0", fontSize: "8.5pt" }}>
            Quote this reference as the payment memo:
          </p>
          <p style={{ margin: "1mm 0 0", fontSize: "14pt", fontWeight: 700, fontFamily: MONO }}>
            {invoice.reference}
          </p>
          <p style={{ margin: "2mm 0 0", fontSize: "7.5pt" }}>
            A payment without the reference has to be matched by hand.
          </p>
          {payAmount && payAssetCode && (
            <p style={{ margin: "3mm 0 0", fontSize: "11pt", fontWeight: 700, fontFamily: MONO }}>
              Pay exactly {payAmount} {payAssetCode}
            </p>
          )}
        </div>
        {qrDataUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qrDataUrl}
            alt={`Payment request for ${invoice.number}, reference ${invoice.reference}`}
            style={{ display: "block", width: "32mm", height: "32mm", flexShrink: 0 }}
          />
        )}
      </div>

      {footer && (
        <p style={{ margin: "8mm 0 0", fontSize: "8pt", textAlign: "center" }}>{footer}</p>
      )}
    </div>
  );
}

function PaperSum({
  label,
  value,
  strong = false,
  rule = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  rule?: boolean;
}) {
  return (
    <tr style={rule ? { borderTop: "0.4mm solid #000000" } : undefined}>
      <td
        style={{
          padding: "1.4mm 8mm 1.4mm 0",
          fontSize: strong ? "10pt" : "9pt",
          fontWeight: strong ? 700 : 400,
        }}
      >
        {label}
      </td>
      <td
        style={{
          padding: "1.4mm 0",
          textAlign: "right",
          fontFamily: MONO,
          fontSize: strong ? "10pt" : "9pt",
          fontWeight: strong ? 700 : 400,
        }}
      >
        {value}
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

interface TimelineStep {
  key: string;
  label: string;
  at: number | null;
  pendingText: string;
  state: "done" | "pending" | "alert";
}

function buildTimeline(
  invoice: Invoice,
  status: InvoiceStatus,
  paidMinor: Minor,
): TimelineStep[] {
  const overdueDays = daysPastDue(invoice);
  const steps: TimelineStep[] = [
    {
      key: "created",
      label: `Draft created by ${invoice.createdBy}`,
      at: invoice.createdAt,
      pendingText: "Creation time unavailable",
      state: "done",
    },
    {
      key: "issued",
      label: invoice.issuedBy ? `Issued by ${invoice.issuedBy}` : "Issued",
      at: invoice.issuedAt,
      pendingText: "Still a draft",
      state: invoice.issuedAt === null ? "pending" : "done",
    },
  ];

  for (const payment of [...invoice.payments].sort((a, b) => a.observedAt - b.observedAt)) {
    steps.push({
      key: `payment-${payment.id}`,
      label:
        payment.kind === "stellar"
          ? payment.overpaymentMinor > 0
            ? `${fmtMinor(payment.receivedMinor, invoice.currency)} received in ${payment.asset?.code ?? "Stellar asset"}; ${fmtMinor(payment.amountMinor, invoice.currency)} applied`
            : `${fmtMinor(payment.amountMinor, invoice.currency)} received in ${payment.asset?.code ?? "Stellar asset"}`
          : `${fmtMinor(payment.amountMinor, invoice.currency)} recorded by ${payment.recordedBy ?? "staff"}`,
      at: payment.observedAt,
      pendingText: payment.note ?? "Payment recorded",
      state: "done",
    });
  }

  if (invoice.dueAt !== null) {
    const past = overdueDays !== null && overdueDays > 0;
    const owed = invoice.totals.totalMinor - paidMinor > 0 && status !== "void";
    steps.push({
      key: "due",
      label: past && owed ? `Due — ${overdueDays} days past it` : "Due",
      at: invoice.dueAt,
      pendingText: "No due date",
      state: past && owed ? "alert" : owed ? "pending" : "done",
    });
  }

  if (status === "void") {
    steps.push({
      key: "void",
      label: `Voided by ${invoice.voidedBy ?? "staff"} · ${invoice.voidReason ?? "No reason retained"}`,
      at: invoice.voidedAt,
      pendingText: "Void time unavailable",
      state: "done",
    });
  } else {
    steps.push({
      key: "settled",
      label: status === "paid" ? "Paid in full" : "Settlement",
      at: status === "paid" ? invoice.paidAt : null,
      pendingText:
        paidMinor > 0
          ? `${fmtMinor(invoice.totals.totalMinor - paidMinor, invoice.currency)} remains`
          : "Still outstanding",
      state: status === "paid" ? "done" : "pending",
    });
  }

  return steps;
}
