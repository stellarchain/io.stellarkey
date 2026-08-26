"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { useMerchant } from "@/hooks/useMerchant";
import { triggerHaptic } from "@/lib/haptics";
import { invoiceStatusAt } from "@/lib/merchant/invoices";
import { fmtMinor } from "@/lib/merchant/money";
import type { Invoice } from "@/lib/merchant/types";
import { Button, Notice, SegmentedControl } from "../ui";
import { IconPlus, IconSearch, IconSliders } from "../icons";
import { IconReceipt } from "./icons";
import { MerchantDisclosure } from "./Disclosure";
import { Stat, StatStrip } from "./Stat";
import { InvoiceComposerModal } from "./InvoiceComposerModal";
import {
  INVOICE_STATUS_LABEL,
  InvoiceDetailModal,
  InvoiceStatusIcon,
  InvoiceStatusPill,
  fmtInvoiceDate,
  invoiceBalanceMinor,
} from "./InvoiceDetailModal";

type StatusFilter = "all" | "draft" | "sent" | "overdue" | "paid";

const FILTERS: { label: string; value: StatusFilter }[] = [
  { label: "All", value: "all" },
  { label: "Draft", value: "draft" },
  { label: "Sent", value: "sent" },
  { label: "Overdue", value: "overdue" },
  { label: "Paid", value: "paid" },
];

const subscribeMinute = (notify: () => void) => {
  const interval = window.setInterval(notify, 60_000);
  return () => window.clearInterval(interval);
};
const readMinute = () => Math.floor(Date.now() / 60_000) * 60_000;
const readServerMinute = () => 0;

/** Issued, not settled and not yet late — everything the Sent tab should hold. */
function isSent(invoice: Invoice): boolean {
  return invoice.status === "sent" || invoice.status === "partially_paid";
}

/** Issued and still owed something, whatever else it says. */
function isOpen(invoice: Invoice): boolean {
  return isSent(invoice) || invoice.status === "overdue";
}

function matchesFilter(invoice: Invoice, filter: StatusFilter): boolean {
  switch (filter) {
    case "draft":
      return invoice.status === "draft";
    case "sent":
      return isSent(invoice);
    case "overdue":
      return invoice.status === "overdue";
    case "paid":
      return invoice.status === "paid";
    default:
      return true;
  }
}

function matchesQuery(invoice: Invoice, needle: string): boolean {
  if (!needle) return true;
  return (
    invoice.number.toLowerCase().includes(needle) ||
    invoice.customerName.toLowerCase().includes(needle) ||
    invoice.reference.toLowerCase().includes(needle) ||
    (invoice.customerEmail?.toLowerCase().includes(needle) ?? false)
  );
}

/** Drafts sit at the top: they are the ones still being worked on. */
function sortKey(invoice: Invoice): number {
  return invoice.issuedAt ?? invoice.createdAt;
}

export function InvoicesPage() {
  const { invoices, pollNow, settings, watchError, watching } = useMerchant();

  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [openInvoiceId, setOpenInvoiceId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composing, setComposing] = useState<Invoice | null>(null);
  const now = useSyncExternalStore(subscribeMinute, readMinute, readServerMinute);

  const displayedInvoices = useMemo(
    () =>
      invoices.map((invoice) => {
        const status = now > 0 ? invoiceStatusAt(invoice, now) : invoice.status;
        return status === invoice.status ? invoice : { ...invoice, status };
      }),
    [invoices, now],
  );
  const currency = settings.currency;
  const mixedCurrencies = displayedInvoices.some((invoice) => invoice.currency !== currency);

  const summary = useMemo(() => {
    const sameCurrency = displayedInvoices.filter((invoice) => invoice.currency === currency);
    const open = sameCurrency.filter(isOpen);
    const overdue = sameCurrency.filter((inv) => inv.status === "overdue");
    const month = new Date(now);
    const paidThisMonth = sameCurrency.filter(
      (inv) =>
        now > 0 &&
        inv.paidAt !== null &&
        new Date(inv.paidAt).getUTCFullYear() === month.getUTCFullYear() &&
        new Date(inv.paidAt).getUTCMonth() === month.getUTCMonth(),
    );
    return {
      openCount: open.length,
      openMinor: open.reduce((sum, inv) => sum + invoiceBalanceMinor(inv), 0),
      overdueCount: overdue.length,
      overdueMinor: overdue.reduce((sum, inv) => sum + invoiceBalanceMinor(inv), 0),
      paidCount: paidThisMonth.length,
      paidMinor: paidThisMonth.reduce((sum, inv) => sum + inv.paidMinor, 0),
    };
  }, [currency, displayedInvoices, now]);

  const needle = query.trim().toLowerCase();

  const filtered = useMemo(
    () =>
      displayedInvoices
        .filter((inv) => matchesFilter(inv, filter) && matchesQuery(inv, needle))
        .sort((a, b) => sortKey(b) - sortKey(a)),
    [displayedInvoices, filter, needle],
  );

  const openInvoice = useMemo(
    () => invoices.find((inv) => inv.id === openInvoiceId) ?? null,
    [invoices, openInvoiceId],
  );

  function openComposer(invoice: Invoice | null) {
    triggerHaptic("selection");
    setComposing(invoice);
    setComposerOpen(true);
  }

  const filterLabel = FILTERS.find((f) => f.value === filter)?.label.toLowerCase() ?? "current";

  return (
    <section className="fade-up w-full min-w-0 pb-[132px] md:pb-12">
      {/* ---------------- the state of the book ---------------- */}
      <StatStrip columns="repeat(3, minmax(0, 1fr))">
        <Stat
          label="Open"
          value={fmtMinor(summary.openMinor, currency)}
          delta={{ label: `${summary.openCount}`, tone: "ink" }}
        />
        <Stat
          label="Overdue"
          value={
            summary.overdueCount === 0 ? "None" : fmtMinor(summary.overdueMinor, currency)
          }
          tone={summary.overdueCount > 0 ? "bad" : "ink"}
          delta={
            summary.overdueCount > 0
              ? { label: `${summary.overdueCount}`, tone: "bad" }
              : undefined
          }
          divider="left"
        />
        <Stat
          label="Paid this month"
          value={fmtMinor(summary.paidMinor, currency)}
          tone={summary.paidMinor > 0 ? "money" : "ink"}
          delta={{ label: `${summary.paidCount}`, tone: "ink" }}
          divider="left"
        />
      </StatStrip>
      {mixedCurrencies && (
        <p className="mt-2 text-[11.5px] text-neutral-500">
          Summary totals show {currency} only. Invoices in other currencies remain in the ledger below.
        </p>
      )}
      {watchError && (
        <div className="mt-3">
          <Notice tone="warn">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>{watchError} Invoice settlement will retry automatically.</span>
              <Button variant="secondary" disabled={!watching} onClick={() => void pollNow()}>
                Retry now
              </Button>
            </div>
          </Notice>
        </div>
      )}

      {/* ---------------- narrowing it down ---------------- */}
      <div className="mt-3 flex flex-col gap-2.5 lg:flex-row lg:items-center">
        <div className="search-field flex-1">
          <IconSearch size={14} className="shrink-0 text-neutral-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Number, customer or reference…"
            aria-label="Search invoices"
            className="w-full bg-transparent text-base text-white outline-none placeholder:text-neutral-500 sm:text-[13.5px]"
          />
        </div>
        <div className="lg:w-[320px]">
          <SegmentedControl<StatusFilter> value={filter} options={FILTERS} onChange={setFilter} />
        </div>
        <button
          type="button"
          onClick={() => openComposer(null)}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0A84FF] text-white shadow-[0_8px_20px_-6px_rgba(10,132,255,0.55)] transition-all hover:bg-[#2492ff] active:scale-90"
          title="New invoice"
          aria-label="New invoice"
        >
          <IconPlus size={17} />
        </button>
      </div>

      {/* ---------------- the book ---------------- */}
      <div className="mt-4">
        {invoices.length === 0 ? (
          <EmptyState
            title="No invoices yet"
            body="Bill a customer who is not standing at the counter."
            action={
              <Button variant="secondary" onClick={() => openComposer(null)}>
                <IconPlus size={15} /> New invoice
              </Button>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="Nothing matches"
            body={
              needle
                ? `No invoice matches “${query.trim()}” under the ${filterLabel} filter.`
                : `No invoice is ${filterLabel} right now.`
            }
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  triggerHaptic("selection");
                  setQuery("");
                  setFilter("all");
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <div className="list-group">
            {filtered.map((invoice, i) => (
              <InvoiceRow
                key={invoice.id}
                invoice={invoice}
                sep={i > 0}
                onOpen={() => {
                  triggerHaptic("selection");
                  setOpenInvoiceId(invoice.id);
                }}
                onEdit={() => openComposer(invoice)}
              />
            ))}
          </div>
        )}
      </div>

      <InvoiceDetailModal invoice={openInvoice} onClose={() => setOpenInvoiceId(null)} />
      <InvoiceComposerModal
        invoice={composing}
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
      />
      {/* The explanation lives under the book: the figures lead, and the
          mechanism is one tap away for whoever wants it. */}
      <div className="mt-6 border-t border-white/[0.08] pt-4">
        <MerchantDisclosure label="How invoices work">
          <p>
            An invoice is a request addressed to this shop&rsquo;s own Stellar account. Each one
            carries its own reference, and the payment that quotes it files itself against it —
            nothing is escrowed, and no card rail is involved.
          </p>
          <p>
            The document is made on this device and stays on it. Print it or save it as a PDF, hand
            it over, and Horizon reconciles it by that reference.
          </p>
          <p>
            A draft is not owed anything yet. Issuing it starts the due date; a part payment leaves
            the balance owing on the row.
          </p>
        </MerchantDisclosure>
      </div>

    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */


function InvoiceRow({
  invoice,
  sep,
  onOpen,
  onEdit,
}: {
  invoice: Invoice;
  sep: boolean;
  onOpen: () => void;
  onEdit: () => void;
}) {
  const isDraft = invoice.status === "draft";

  /* Two lines, the app's own shape. The balance still owing and how late it is
     are the document's business, and the document is one tap away. */
  const secondary = [
    invoice.customerName,
    invoice.issuedAt === null ? "not issued" : `issued ${fmtInvoiceDate(invoice.issuedAt)}`,
    invoice.dueAt === null ? "no due date" : `due ${fmtInvoiceDate(invoice.dueAt)}`,
  ].join(" · ");

  // A draft's row opens the document like any other; editing it is its own
  // target, so one tap never has to mean two different things.
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className={`row-hover flex w-full cursor-pointer items-center gap-3.5 px-4 py-3.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#0A84FF] ${
        sep ? "ios-sep" : ""
      }`}
    >
      <InvoiceStatusIcon status={invoice.status} />

      <span className="min-w-0 flex-1">
        <span className="mono block truncate text-[15.5px] font-normal leading-tight text-white">
          {invoice.number}
        </span>
        <span className="mono block truncate text-[12px] leading-tight text-neutral-400">
          {/* No room for a pill beside the number on a phone, so the status is a
              word on this line there and a pill on the trailing side from sm up. */}
          <span className="sm:hidden">{INVOICE_STATUS_LABEL[invoice.status]} · </span>
          {secondary}
        </span>
      </span>

      <span className="flex shrink-0 items-center gap-2">
        <span className="hidden shrink-0 sm:block">
          <InvoiceStatusPill status={invoice.status} compact />
        </span>
        <span className="mono text-[14.5px] font-medium text-neutral-400">
          {fmtMinor(invoice.totals.totalMinor, invoice.currency)}
        </span>

        {isDraft && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            aria-label={`Edit draft ${invoice.number}`}
            /* 32px of ink, 44px of target: the pseudo-element carries the reach
               so the row keeps the app's height. */
            className="relative flex h-8 w-8 items-center justify-center rounded-full text-[#0A84FF] transition-colors before:absolute before:-inset-1.5 before:content-[''] hover:bg-[#0A84FF]/15 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#0A84FF]"
          >
            <IconSliders size={16} />
          </button>
        )}

        <svg
          className="chevron"
          width="8"
          height="14"
          viewBox="0 0 8 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m1.5 1.5 5 5.5-5 5.5" />
        </svg>
      </span>
    </div>
  );
}

function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-[20px] border border-white/[0.08] bg-white/[0.02] px-6 py-14 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#30D158]/12 text-[#30D158]">
        <IconReceipt size={24} />
      </span>
      <p className="mt-4 text-[17px] font-semibold text-white">{title}</p>
      <p className="mt-1 max-w-[340px] text-[13px] leading-relaxed text-neutral-400">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
