"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { useMerchant } from "@/hooks/useMerchant";
import { useWallet } from "@/hooks/useWallet";
import { triggerHaptic } from "@/lib/haptics";
import { MOCK_NOW } from "@/lib/merchant/mock";
import { fmtMinor } from "@/lib/merchant/money";
import type { Invoice, InvoiceStatus, Minor } from "@/lib/merchant/types";
import { buildSep7PayUri } from "@/lib/payuri";
import { NETWORKS } from "@/lib/stellar";
import { useToast } from "../Toast";
import { Button, CopyButton, HashValue, Modal, ModalHeader, Notice } from "../ui";
import {
  IconAlert,
  IconArrowDownLeft,
  IconCheck,
  IconCopy,
  IconFileText,
  IconSend,
} from "../icons";
import { IconCheckCircle, IconPrinter, IconXCircle } from "./icons";

/**
 * DESIGN MOCK — the invoice as a document.
 *
 * Mocked: the invoice arrives from `MOCK_INVOICES`, "now" is the fixture's fixed
 * `MOCK_NOW` so a screenshot never drifts, and marking it paid or voiding it
 * moves local state and says so. Nothing is written and nothing is signed.
 *
 * Real already, and all of it on the device: the money is the invoice's own
 * stored `totals`, printed only through `fmtMinor`; the QR is a genuine SEP-7
 * `web+stellar:pay` request built with `buildSep7PayUri` against the shop's
 * receiving account, so a customer's wallet really reads it; Print lays the
 * document out at A4 against the stylesheet below and calls `window.print()`,
 * which is also how it is saved as a PDF; and the reminder hands the OS a
 * `mailto:` draft carrying the figures. Nothing leaves the device on its own —
 * the shop presses send in its own mail app.
 *
 * A real implementation swaps the fixture for a stored `Invoice`, writes a
 * manual tender when the invoice is marked paid, and stamps the timeline from
 * the record's own issued and paid times.
 */

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
export function daysPastDue(invoice: Invoice, now = MOCK_NOW): number | null {
  if (invoice.dueAt === null) return null;
  return Math.round((now - invoice.dueAt) / DAY);
}

/** Day-first, the register the fixture's own range labels use. */
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
  const { settings } = useMerchant();
  const { network } = useWallet();
  const { toast } = useToast();

  /* Local only. A real till would write these; here they move the screen and say so. */
  const [statusOverride, setStatusOverride] = useState<InvoiceStatus | null>(null);
  const [confirmingVoid, setConfirmingVoid] = useState(false);
  const [qr, setQr] = useState<{ uri: string; dataUrl: string } | null>(null);
  const mounted = useSyncExternalStore(subscribeNothing, readMounted, readNotMounted);

  const status = statusOverride ?? invoice.status;
  const currency = invoice.currency;
  const shopName = settings.profile.name.trim();
  const destination = settings.receivingPublicKey;

  const paidMinor = status === "paid" ? invoice.totals.totalMinor : invoice.paidMinor;
  const balanceMinor = Math.max(0, invoice.totals.totalMinor - paidMinor);
  const overdueDays = daysPastDue(invoice);

  const rateLabel = useMemo(() => {
    const byId = new Map(settings.taxRates.map((r) => [r.id, r]));
    return (id: string) => {
      const rate = byId.get(id);
      return rate ? `${rate.label} ${rate.percent} %` : id;
    };
  }, [settings.taxRates]);

  /* A real SEP-7 request: the shop's own account, the invoice reference as the
     memo, and the network passphrase so a testnet request cannot be mistaken for
     a mainnet one. No amount rides on it — the invoice is priced in the shop's
     currency and the asset amount is only fixed when the payer picks an asset. */
  const payUri = useMemo(() => {
    if (!destination) return null;
    return buildSep7PayUri({
      destination,
      memo: invoice.reference,
      memoType: "text",
      msg: shopName ? `${shopName} · ${invoice.number}` : invoice.number,
      networkPassphrase: NETWORKS[network].networkPassphrase,
    });
  }, [destination, invoice.number, invoice.reference, network, shopName]);

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

            {destination && payUri ? (
              <>
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
                  The request carries the account and the reference, not an amount: the invoice is
                  priced in {currency} and the asset amount is fixed when the payer chooses one. It
                  prints on the document too, so the paper copy can be paid from.
                </p>
                <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] pt-3">
                  <span className="shrink-0 text-[13px] text-neutral-400">To</span>
                  <HashValue value={destination} className="text-[12.5px] text-neutral-200" />
                </div>
              </>
            ) : (
              <Notice tone="warn">
                <p className="font-semibold text-white">No receiving account is set.</p>
                <p className="mt-1">
                  Merchant settings → Receiving account. Until one is chosen there is nothing to
                  address the payment to, so no request and no QR can be made.
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
              {reminderHref && status !== "void" ? (
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
              <Button
                variant="secondary"
                disabled={status === "paid" || status === "void"}
                onClick={() => {
                  triggerHaptic("success");
                  setStatusOverride("paid");
                  toast(
                    `${invoice.number} would be closed with a manual tender for ${fmtMinor(balanceMinor, currency)}`,
                    "success",
                  );
                }}
              >
                <IconCheck size={14} /> Mark as paid
              </Button>
              {confirmingVoid ? (
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    className="flex-1 !px-3 !text-[13.5px]"
                    onClick={() => {
                      triggerHaptic("selection");
                      setConfirmingVoid(false);
                    }}
                  >
                    Keep it
                  </Button>
                  <Button
                    variant="danger"
                    className="flex-1 !px-3 !text-[13.5px]"
                    onClick={() => {
                      triggerHaptic("warning");
                      setConfirmingVoid(false);
                      setStatusOverride("void");
                      toast(`${invoice.number} would be voided and no longer chased`, "error");
                    }}
                  >
                    Void it
                  </Button>
                </div>
              ) : (
                <Button
                  variant="danger"
                  disabled={status === "void"}
                  onClick={() => {
                    triggerHaptic("warning");
                    setConfirmingVoid(true);
                  }}
                >
                  <IconXCircle size={14} /> Void
                </Button>
              )}
            </div>

            <p className="text-center text-[12px] leading-relaxed text-neutral-500">
              {statusOverride
                ? `Shown on this screen only. Nothing has been written, and reopening the invoice brings back ${INVOICE_STATUS_LABEL[invoice.status].toLowerCase()}.`
                : invoice.customerEmail
                  ? "The reminder opens your mail app with the figures and the reference already in it. Nothing is sent until you send it."
                  : "No email on file, so there is no draft to open. Print the invoice and hand it over instead."}
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
              Handed over is derived from the issue date here. A real record stamps it when the
              document is printed or the draft is opened, and stamps settlement from the ledger.
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

/**
 * Built from the dates the fixture actually carries. Where a record would hold
 * its own stamp and this one does not, the step still shows — with the reason it
 * has no time against it, rather than an invented one.
 */
function buildTimeline(
  invoice: Invoice,
  status: InvoiceStatus,
  paidMinor: Minor,
): TimelineStep[] {
  const issued = invoice.issuedAt;
  const partial = paidMinor > 0 && paidMinor < invoice.totals.totalMinor;
  const overdueDays = daysPastDue(invoice);
  const steps: TimelineStep[] = [
    {
      key: "issued",
      label: "Issued",
      at: issued,
      pendingText: "Still a draft",
      state: issued === null ? "pending" : "done",
    },
    {
      key: "handed-over",
      label: "Handed over",
      at: issued,
      pendingText: "Not issued yet",
      state: issued === null ? "pending" : "done",
    },
  ];

  if (partial) {
    steps.push({
      key: "part",
      label: `Part paid — ${fmtMinor(paidMinor, invoice.currency)} received`,
      at: invoice.paidAt,
      pendingText: "No stamp on the fixture",
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

  steps.push({
    key: "settled",
    label:
      status === "void"
        ? "Voided"
        : status === "paid"
          ? "Paid in full"
          : "Settlement",
    at: status === "paid" ? invoice.paidAt : null,
    pendingText: status === "void" ? "Closed without payment" : "Still outstanding",
    state: status === "paid" ? "done" : "pending",
  });

  return steps;
}
