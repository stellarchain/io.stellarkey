"use client";

import { useEffect, useMemo, useState } from "react";
import {
  useMerchantConfiguration,
  useMerchantRecords,
  useMerchantTill,
} from "@/hooks/useMerchant";
import { FIAT_SYMBOLS } from "@/lib/format";
import { triggerHaptic } from "@/lib/haptics";
import { invoiceReference } from "@/lib/merchant/payment-reference";
import { fmtMinor, minorToDecimal, orderTotals, parsePriceMinor } from "@/lib/merchant/money";
import type { Invoice, InvoiceLine, OrderLine } from "@/lib/merchant/types";
import { useToast } from "../Toast";
import {
  Button,
  ErrorText,
  Field,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Select,
  useModalContext,
  useRetainedForExit,
} from "../ui";
import { IconPlus, IconTrash } from "../icons";

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

function toDateInput(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function fromDateInput(value: string): number | null {
  const ms = Date.parse(`${value}T23:59:59.999Z`);
  return Number.isNaN(ms) ? null : ms;
}

function nextInvoiceIdentity(
  sequence: number,
  shopName: string,
  now: number,
): { number: string; reference: string } {
  return {
    number: `INV-${new Date(now).getUTCFullYear()}-${String(sequence).padStart(4, "0")}`,
    reference: invoiceReference(shopName || "Till", sequence),
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
  // An edited invoice stays rendered through the exit so the key never flips mid-animation.
  const retained = useRetainedForExit(invoice);
  const shownInvoice = open ? invoice : retained;
  const [dirty, setDirty] = useState(false);
  return (
    <Modal open={open} onClose={onClose} wide dirty={dirty}>
      <Composer
        key={shownInvoice?.id ?? "new-invoice"}
        invoice={shownInvoice}
        onClose={onClose}
        onDirtyChange={setDirty}
      />
    </Modal>
  );
}

function Composer({
  invoice,
  onClose,
  onDirtyChange,
}: {
  invoice: Invoice | null;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const modal = useModalContext();
  const { catalogue } = useMerchantTill();
  const { createInvoiceDraft, nextInvoiceNumber, updateInvoiceDraft } = useMerchantRecords();
  const { settings } = useMerchantConfiguration();
  const { toast } = useToast();
  const [draftBase] = useState(() => invoice?.issuedAt ?? Date.now());

  const isEdit = invoice !== null;
  const identity = useMemo(
    () =>
      invoice
        ? { number: invoice.number, reference: invoice.reference }
        : nextInvoiceIdentity(nextInvoiceNumber, settings.profile.name, draftBase),
    [draftBase, invoice, nextInvoiceNumber, settings.profile.name],
  );
  const currency = invoice?.currency ?? settings.currency;
  const symbol = FIAT_SYMBOLS[currency].trim();
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
    toDateInput(invoice?.dueAt ?? draftBase + 14 * DAY),
  );
  const [note, setNote] = useState(invoice?.note ?? "");
  const [error, setError] = useState("");

  /* Unsaved edits: anything that differs from the invoice, or from a blank draft. */
  const draftKey = JSON.stringify({ customerName, customerEmail, lines, terms, dueDate, note });
  const [initialKey] = useState(draftKey);
  const isDirty = draftKey !== initialKey;
  useEffect(() => {
    onDirtyChange(isDirty);
    return () => onDirtyChange(false);
  }, [isDirty, onDirtyChange]);

  /* The one place the money is decided: the shop's own rates and mode, through
     the same function that prices a ticket on the till. */
  const orderLines: OrderLine[] = useMemo(
    () =>
      lines.map((line) => ({
        id: line.id,
        itemId: line.itemId,
        name: line.description,
        quantity: parseQuantity(line.quantityText) ?? 0,
        unitPriceMinor: parsePriceMinor(line.priceText) ?? 0,
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
    setLines((prev) => prev.filter((line) => line.id !== id));
  }

  function applyTerms(next: Terms) {
    setTerms(next);
    if (next === "custom") return;
    const days = next === "receipt" ? 0 : Number(next);
    setDueDate(toDateInput(draftBase + days * DAY));
  }

  function handleSave() {
    try {
      if (!customerName.trim()) {
        throw new Error("Give the invoice a customer. It is the name that goes on the document.");
      }
      if (lines.length === 0) {
        throw new Error("An invoice needs at least one line. Add one from the catalogue, or type your own.");
      }
      const invoiceLines: InvoiceLine[] = lines.map((line) => {
        const description = line.description.trim();
        const quantity = parseQuantity(line.quantityText);
        const unitPriceMinor = parsePriceMinor(line.priceText);
        if (!description || quantity === null || unitPriceMinor === null) {
          throw new Error("Every line needs a description, a whole quantity and a plain price such as 12.00.");
        }
        return { id: line.id, description, quantity, unitPriceMinor, taxRateId: line.taxRateId };
      });
      const dueAt = fromDateInput(dueDate);
      if (dueAt === null) throw new Error("The due date has to be a real date.");
      const draft = { customerName, customerEmail, lines: invoiceLines, dueAt, note };
      if (invoice) {
        updateInvoiceDraft({ ...draft, invoiceId: invoice.id });
      } else {
        createInvoiceDraft(draft);
      }
      triggerHaptic("success");
      toast(invoice ? "Invoice draft updated" : "Invoice saved as a draft", "success", {
        silent: true,
      });
      onClose();
    } catch (saveError) {
      triggerHaptic("error");
      setError(saveError instanceof Error ? saveError.message : "The invoice could not be saved.");
    }
  }

  return (
    <>
      <ModalHeader
        title={isEdit ? "Edit invoice" : "New Invoice"}
        subtitle={`${identity.number} · reference ${identity.reference}`}
        onClose={onClose}
      />

      <ModalBody gap={5}>
        {/* ---------- who it is for ---------- */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Customer">
            <input
              type="text"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Customer name"
              enterKeyHint="next"
              autoCapitalize="words"
              className="input text-base sm:text-[14px]"
            />
          </Field>
          <Field label="Email" hint="Optional">
            <input
              type="email"
              inputMode="email"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              placeholder="name@example.com"
              autoComplete="off"
              autoCapitalize="none"
              enterKeyHint="next"
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
              const price = parsePriceMinor(line.priceText);
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
                      enterKeyHint="next"
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
                        enterKeyHint="next"
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
                          enterKeyHint="next"
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
            <Button type="button" variant="ghost" className="shrink-0 sm:w-auto" onClick={addFreeLine}>
              <IconPlus size={14} /> Free-Text Line
            </Button>
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
          <Field label="Due Date">
            <input
              type="date"
              value={dueDate}
              onChange={(e) => {
                setDueDate(e.target.value);
                setTerms("custom");
              }}
              enterKeyHint="done"
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
            placeholder="Shown on the invoice"
            className="input resize-none text-base sm:text-[14px]"
          />
        </Field>

        <ErrorText message={error} />

        {/* ---------- out ---------- */}
        <ModalFooter
          secondary={
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                if (modal) modal.requestClose("close");
                else onClose();
              }}
            >
              Cancel
            </Button>
          }
          primary={
            <Button type="button" onClick={handleSave}>
              Save Draft
            </Button>
          }
        />
        <p className="text-center text-[12px] leading-relaxed text-neutral-500">
          Saving keeps it as a draft on this device. Open it to print it, show its code, or draft an
          email to the customer.
        </p>
      </ModalBody>
    </>
  );
}
