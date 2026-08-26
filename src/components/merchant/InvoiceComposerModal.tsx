"use client";

import { useMemo, useState } from "react";
import { useMerchant } from "@/hooks/useMerchant";
import { FIAT_SYMBOLS } from "@/lib/format";
import { triggerHaptic } from "@/lib/haptics";
import { MOCK_INVOICES, MOCK_NOW } from "@/lib/merchant/mock";
import { fmtMinor, minorToDecimal, orderTotals, toMinor } from "@/lib/merchant/money";
import type { Invoice, Minor, OrderLine } from "@/lib/merchant/types";
import { useToast } from "../Toast";
import { Button, ErrorText, Field, Modal, ModalHeader, Select } from "../ui";
import { IconPlus, IconTrash } from "../icons";

/**
 * DESIGN MOCK — the invoice composer.
 *
 * Mocked: saving raises a toast and closes. Nothing is written and no invoice is
 * numbered; the next number is guessed from `MOCK_INVOICES` so the header reads
 * like the real thing. "Today" is the fixture's fixed `MOCK_NOW`, so payment
 * terms land on stable dates.
 *
 * Real already: the catalogue picker reads the shop's live catalogue through
 * `useMerchant()`, and every figure on the screen comes out of `orderTotals`
 * with the shop's own `taxRates` and `taxMode` — the same function the till
 * prices a ticket with. Nothing here fakes a total or does arithmetic on a
 * formatted string.
 *
 * A real implementation replaces `handleSave` with a write that mints the
 * number and reference and stores the `Invoice`. Everything after that happens
 * on the invoice itself: printing it, showing its code, or drafting an email.
 */

const DAY = 24 * 60 * 60 * 1000;

type Terms = "receipt" | "7" | "14" | "30" | "custom";

const TERMS_OPTIONS: { value: Terms; label: string }[] = [
  { value: "receipt", label: "Due on receipt" },
  { value: "7", label: "Net 7 days" },
  { value: "14", label: "Net 14 days" },
  { value: "30", label: "Net 30 days" },
  { value: "custom", label: "Custom date" },
];

/** A line being edited. Text is kept as typed so a half-finished price is legal. */
interface DraftLine {
  id: string;
  itemId: string | null;
  description: string;
  quantityText: string;
  priceText: string;
  taxRateId: string;
}

/** A whole count of units, or null while the field is not one. */
function parseQuantity(text: string): number | null {
  const raw = text.trim();
  return /^\d{1,4}$/.test(raw) && Number(raw) > 0 ? Number(raw) : null;
}

/** A plain decimal price in minor units, or null while the field is not one. */
function parsePrice(text: string): Minor | null {
  const raw = text.trim();
  if (raw === "" || raw === "." || !/^\d{0,9}(\.\d{0,2})?$/.test(raw)) return null;
  return toMinor(raw);
}

function toDateInput(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function fromDateInput(value: string): number | null {
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isNaN(ms) ? null : ms;
}

/** What the next invoice would be called. A real till mints this on save. */
function nextInvoiceIdentity(): { number: string; reference: string } {
  const highest = MOCK_INVOICES.reduce((max, inv) => {
    const tail = Number(inv.number.split("-").pop());
    return Number.isFinite(tail) ? Math.max(max, tail) : max;
  }, 0);
  const padded = String(highest + 1).padStart(4, "0");
  return {
    number: `INV-${new Date(MOCK_NOW).getUTCFullYear()}-${padded}`,
    reference: `MCINV${padded}`,
  };
}

function uid(): string {
  return `dl_${Math.random().toString(36).slice(2, 10)}`;
}

export function InvoiceComposerModal({
  invoice,
  open,
  onClose,
}: {
  /** null composes a new invoice. */
  invoice: Invoice | null;
  open: boolean;
  onClose: () => void;
}) {
  // The composer only exists while the sheet is up, so its state resets on close.
  return (
    <Modal open={open} onClose={onClose} wide>
      <Composer key={invoice?.id ?? "new-invoice"} invoice={invoice} onClose={onClose} />
    </Modal>
  );
}

function Composer({ invoice, onClose }: { invoice: Invoice | null; onClose: () => void }) {
  const { catalogue, settings } = useMerchant();
  const { toast } = useToast();

  const isEdit = invoice !== null;
  const identity = useMemo(
    () => (invoice ? { number: invoice.number, reference: invoice.reference } : nextInvoiceIdentity()),
    [invoice],
  );
  const currency = invoice?.currency ?? settings.currency;
  const symbol = FIAT_SYMBOLS[currency].trim();
  const issuedBase = invoice?.issuedAt ?? MOCK_NOW;
  const defaultRate = settings.taxRates.some((r) => r.id === settings.defaultTaxRateId)
    ? settings.defaultTaxRateId
    : (settings.taxRates[0]?.id ?? "standard");

  const [customerName, setCustomerName] = useState(invoice?.customerName ?? "");
  const [customerEmail, setCustomerEmail] = useState(invoice?.customerEmail ?? "");
  const [lines, setLines] = useState<DraftLine[]>(() =>
    (invoice?.lines ?? []).map((line) => ({
      id: line.id,
      itemId: null,
      description: line.description,
      quantityText: String(line.quantity),
      priceText: minorToDecimal(line.unitPriceMinor),
      taxRateId: line.taxRateId,
    })),
  );
  const [terms, setTerms] = useState<Terms>(invoice?.dueAt ? "custom" : "14");
  const [dueDate, setDueDate] = useState(
    toDateInput(invoice?.dueAt ?? issuedBase + 14 * DAY),
  );
  const [note, setNote] = useState(invoice?.note ?? "");
  const [error, setError] = useState("");

  /* The one place the money is decided: the shop's own rates and mode, through
     the same function that prices a ticket on the till. */
  const orderLines: OrderLine[] = useMemo(
    () =>
      lines.map((line) => ({
        id: line.id,
        itemId: line.itemId,
        name: line.description,
        quantity: parseQuantity(line.quantityText) ?? 0,
        unitPriceMinor: parsePrice(line.priceText) ?? 0,
        modifiers: [],
        taxRateId: line.taxRateId,
        note: null,
      })),
    [lines],
  );

  const totals = useMemo(
    () =>
      orderTotals({
        lines: orderLines,
        taxRates: settings.taxRates,
        taxMode: settings.taxMode,
      }),
    [orderLines, settings.taxMode, settings.taxRates],
  );

  const rateLabel = useMemo(() => {
    const byId = new Map(settings.taxRates.map((r) => [r.id, r]));
    return (id: string) => {
      const rate = byId.get(id);
      return rate ? `${rate.label} ${rate.percent} %` : id;
    };
  }, [settings.taxRates]);

  const catalogueOptions = useMemo(
    () =>
      catalogue
        .filter((item) => item.active)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((item) => ({
          value: item.id,
          label: item.name,
          sublabel: fmtMinor(item.priceMinor, currency),
        })),
    [catalogue, currency],
  );

  const rateOptions = useMemo(
    () => settings.taxRates.map((r) => ({ value: r.id, label: `${r.label} ${r.percent} %` })),
    [settings.taxRates],
  );

  function addCatalogueLine(itemId: string) {
    const item = catalogue.find((i) => i.id === itemId);
    if (!item) return;
    setError("");
    setLines((prev) => [
      ...prev,
      {
        id: uid(),
        itemId: item.id,
        description: item.name,
        quantityText: "1",
        priceText: minorToDecimal(item.priceMinor),
        taxRateId: item.taxRateId,
      },
    ]);
  }

  function addFreeLine() {
    triggerHaptic("selection");
    setError("");
    setLines((prev) => [
      ...prev,
      {
        id: uid(),
        itemId: null,
        description: "",
        quantityText: "1",
        priceText: "",
        taxRateId: defaultRate,
      },
    ]);
  }

  function patchLine(id: string, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }

  function removeLine(id: string) {
    triggerHaptic("light");
    setLines((prev) => prev.filter((line) => line.id !== id));
  }

  function applyTerms(next: Terms) {
    setTerms(next);
    if (next === "custom") return;
    const days = next === "receipt" ? 0 : Number(next);
    setDueDate(toDateInput(issuedBase + days * DAY));
  }

  function handleSave() {
    if (!customerName.trim()) {
      triggerHaptic("error");
      setError("Give the invoice a customer. It is the name that goes on the document.");
      return;
    }
    if (lines.length === 0) {
      triggerHaptic("error");
      setError("An invoice needs at least one line. Add one from the catalogue, or type your own.");
      return;
    }
    const badLine = lines.find(
      (line) =>
        !line.description.trim() ||
        parseQuantity(line.quantityText) === null ||
        parsePrice(line.priceText) === null,
    );
    if (badLine) {
      triggerHaptic("error");
      setError(
        "Every line needs a description, a whole quantity and a plain price such as 12.00.",
      );
      return;
    }
    if (fromDateInput(dueDate) === null) {
      triggerHaptic("error");
      setError("The due date has to be a real date.");
      return;
    }
    triggerHaptic("success");
    toast("Invoice saved as a draft", "success");
    onClose();
  }

  return (
    <>
      <ModalHeader
        title={isEdit ? "Edit invoice" : "New invoice"}
        subtitle={`${identity.number} · memo ${identity.reference}`}
        onClose={onClose}
      />

      <div className="space-y-5 p-4 sm:p-6">
        {/* ---------- who it is for ---------- */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Customer">
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Praça Hotel"
              className="input text-base sm:text-[14px]"
            />
          </Field>
          <Field label="Email" hint="Optional">
            <input
              type="email"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              placeholder="contas@example.pt"
              autoComplete="off"
              className="input text-base sm:text-[14px]"
            />
          </Field>
        </div>

        {/* ---------- what is on it ---------- */}
        <div className="space-y-2.5">
          <p className="field-label !pb-0">Lines</p>

          {lines.length === 0 ? (
            <p className="panel-inset px-4 py-4 text-[12.5px] leading-relaxed text-neutral-400">
              Nothing on the invoice yet. Pull a line from the catalogue and it arrives with its
              price and tax rate, or type a one-off line of your own.
            </p>
          ) : (
            lines.map((line) => {
              const quantity = parseQuantity(line.quantityText);
              const price = parsePrice(line.priceText);
              const lineTotal = quantity !== null && price !== null ? quantity * price : null;
              return (
                <div key={line.id} className="panel-inset space-y-2.5 p-3">
                  <div className="flex items-start gap-2">
                    <input
                      type="text"
                      value={line.description}
                      onChange={(e) => patchLine(line.id, { description: e.target.value })}
                      placeholder="What is being charged for"
                      aria-label="Line description"
                      className="input min-w-0 flex-1 text-base sm:text-[14px]"
                    />
                    <button
                      type="button"
                      onClick={() => removeLine(line.id)}
                      aria-label={`Remove ${line.description.trim() || "this line"}`}
                      className="icon-btn !h-11 !w-11 shrink-0 !text-neutral-400 hover:!text-[#FF453A]"
                    >
                      <IconTrash size={16} />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-[88px_minmax(0,1fr)_minmax(0,1fr)]">
                    <div>
                      <label
                        htmlFor={`qty-${line.id}`}
                        className="field-label !pb-1 !text-[11px]"
                      >
                        Qty
                      </label>
                      <input
                        id={`qty-${line.id}`}
                        type="text"
                        inputMode="numeric"
                        value={line.quantityText}
                        onChange={(e) => patchLine(line.id, { quantityText: e.target.value })}
                        className="input mono text-base sm:text-[14px]"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`price-${line.id}`}
                        className="field-label !pb-1 !text-[11px]"
                      >
                        Unit price
                      </label>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[13px] text-neutral-500">
                          {symbol}
                        </span>
                        <input
                          id={`price-${line.id}`}
                          type="text"
                          inputMode="decimal"
                          value={line.priceText}
                          onChange={(e) => patchLine(line.id, { priceText: e.target.value })}
                          placeholder="0.00"
                          className="input mono !pl-8 text-base sm:text-[14px]"
                        />
                      </div>
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <span className="field-label !pb-1 !text-[11px]">VAT rate</span>
                      <Select
                        value={line.taxRateId}
                        onChange={(value) => patchLine(line.id, { taxRateId: value })}
                        options={rateOptions}
                        ariaLabel={`VAT rate for ${line.description.trim() || "this line"}`}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] pt-2.5">
                    <span className="text-[12px] text-neutral-500">
                      {rateLabel(line.taxRateId)}
                    </span>
                    <span className="mono text-[13.5px] font-semibold text-white">
                      {lineTotal === null ? "—" : fmtMinor(lineTotal, currency)}
                    </span>
                  </div>
                </div>
              );
            })
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="min-w-0 flex-1">
              <Select
                value=""
                onChange={addCatalogueLine}
                options={catalogueOptions}
                placeholder="Add from the catalogue…"
                ariaLabel="Add a catalogue item to the invoice"
              />
            </div>
            {/* Built on `.input`, not `.btn`: it sits beside a Select in a form
                row, so it has to share that control's height by construction
                rather than by a matching number. */}
            <button
              type="button"
              onClick={addFreeLine}
              className="input flex shrink-0 cursor-pointer items-center justify-center gap-1.5 text-[14px] font-medium text-[#0A84FF] transition-colors hover:bg-[rgba(118,118,128,0.28)] sm:w-auto sm:px-4"
            >
              <IconPlus size={14} /> Free-text line
            </button>
          </div>
        </div>

        {/* ---------- what it comes to ---------- */}
        <div className="panel-inset space-y-2 p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] text-neutral-400">Net</span>
            <span className="mono text-[13.5px] text-neutral-200">
              {fmtMinor(totals.netMinor, currency)}
            </span>
          </div>
          {Object.entries(totals.taxByRate).length === 0 ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] text-neutral-400">VAT</span>
              <span className="mono text-[13.5px] text-neutral-500">
                {fmtMinor(0, currency)}
              </span>
            </div>
          ) : (
            Object.entries(totals.taxByRate).map(([rateId, minor]) => (
              <div key={rateId} className="flex items-center justify-between gap-3">
                <span className="text-[13px] text-neutral-400">VAT · {rateLabel(rateId)}</span>
                <span className="mono text-[13.5px] text-neutral-200">
                  {fmtMinor(minor, currency)}
                </span>
              </div>
            ))
          )}
          <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] pt-2.5">
            <span className="text-[13.5px] font-semibold text-white">Total</span>
            <span className="mono text-[20px] font-semibold text-white">
              {fmtMinor(totals.totalMinor, currency)}
            </span>
          </div>
          <p className="text-[11.5px] leading-relaxed text-neutral-500">
            {settings.taxMode === "inclusive"
              ? "Unit prices include VAT, so the total is what the customer pays."
              : "VAT is added to the unit prices."}{" "}
            Worked out from the shop&apos;s own rates in Merchant settings.
          </p>
        </div>

        {/* ---------- when it is due ---------- */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <span className="field-label">Payment terms</span>
            <Select
              value={terms}
              onChange={(value) => applyTerms(value as Terms)}
              options={TERMS_OPTIONS}
              ariaLabel="Payment terms"
            />
          </div>
          <Field label="Due date">
            <input
              type="date"
              value={dueDate}
              onChange={(e) => {
                setDueDate(e.target.value);
                setTerms("custom");
              }}
              className="input mono text-base sm:text-[14px]"
            />
          </Field>
        </div>

        {/* ---------- anything else ---------- */}
        <Field label="Note" hint="Printed on the invoice">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Monthly wholesale order."
            className="input resize-none text-base sm:text-[14px]"
          />
        </Field>

        {error && <ErrorText message={error} />}

        {/* ---------- out ---------- */}
        <div className="flex flex-col gap-2.5 border-t border-white/[0.08] pt-4 sm:flex-row-reverse">
          <Button className="sm:flex-1" onClick={handleSave}>
            Save draft
          </Button>
          <Button
            variant="ghost"
            className="sm:flex-1"
            onClick={() => {
              triggerHaptic("light");
              onClose();
            }}
          >
            Cancel
          </Button>
        </div>
        <p className="text-center text-[12px] leading-relaxed text-neutral-500">
          Saving keeps it as a draft on this device. Open it to print it, show its code, or draft an
          email to the customer.
        </p>
      </div>
    </>
  );
}
