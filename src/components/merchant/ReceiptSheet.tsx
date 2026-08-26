"use client";

/**
 * DESIGN MOCK — how the customer gets their receipt.
 *
 * What is mocked: the delivery. On screen and Print are fully rendered from the
 * order — the VAT block is recomputed with the same `distribute`/`taxOn` path
 * `orderTotals` uses, so the per-rate figures reconcile to the cent — and the
 * thermal specimen is measured to 48 columns on every line. Text and Email are
 * NOT mocked: they compose a real `sms:` / `mailto:` draft carrying the figures
 * and hand it to the OS. There is no printer driver in a browser, so Print draws
 * the specimen and calls `window.print()` behind a `@media print` stylesheet.
 *
 * What a real implementation replaces: the fixture order and hash, the printer
 * transport (MOCK_PERIPHERALS says the Star TSP143 is `unavailable` in this
 * build), and storing the customer's number or address against the order so the
 * next receipt is one tap. `previewOrder` exists only so an unsettled ticket can
 * be shown as a receipt; a settled order arrives already in this shape.
 */

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { triggerHaptic } from "@/lib/haptics";
import { useMerchant } from "@/hooks/useMerchant";
import { orderReference } from "@/lib/merchant/charge";
import { DEFAULT_TAX_RATES } from "@/lib/merchant/defaults";
import { distribute, fmtMinor, lineGrossMinor, minorToDecimal, orderTotals } from "@/lib/merchant/money";
import { MOCK_CUSTOMERS, MOCK_NOW, MOCK_PERIPHERALS, MOCK_STAFF } from "@/lib/merchant/mock";
import { NETWORKS } from "@/lib/stellar";
import type {
  MerchantProfile,
  Minor,
  Order,
  OrderLine,
  OrderTotals,
  TaxMode,
  TaxRate,
} from "@/lib/merchant/types";
import type { FiatCurrency } from "@/lib/format";
import { useToast } from "../Toast";
import { CopyButton, HashValue, Modal, ModalHeader, Notice, Spinner } from "../ui";
import { IconAlert, IconEye, IconFileText, IconSend } from "../icons";
import { IconInfo, IconPrinter, IconQr, IconXCircle } from "./icons";

/** A 80 mm thermal roll at standard density. Every printed line fits inside it. */
const COLUMNS = 48;

type ReceiptChannel = "screen" | "text" | "email" | "print" | "none";

const CHANNELS: {
  value: ReceiptChannel;
  label: string;
  hint: string;
  icon: (size: number) => React.ReactNode;
}[] = [
  { value: "screen", label: "On screen", hint: "Photograph it", icon: (s) => <IconEye size={s} /> },
  { value: "text", label: "Text", hint: "SMS draft", icon: (s) => <IconSend size={s} /> },
  { value: "email", label: "Email", hint: "Mail draft", icon: (s) => <IconFileText size={s} /> },
  { value: "print", label: "Print", hint: "48 columns", icon: (s) => <IconPrinter size={s} /> },
  { value: "none", label: "No receipt", hint: "Nothing sent", icon: (s) => <IconXCircle size={s} /> },
];

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/** Order numbers 2000–2999 belong to the counter terminal in MOCK_TERMINALS. */
export const PREVIEW_ORDER_NUMBER = 2094;

/** The settling payment. A real receipt carries the hash Horizon reported. */
export const PREVIEW_TX_HASH =
  "4f1a9c2e7b3d5081a6c4e2f09d7b1a3c5e8f0d2b4a6c8e1f3d5b7a9c0e2f4d68";

const FIXTURE_LINES: OrderLine[] = [
  {
    id: "fl_1",
    itemId: "flw",
    name: "Flat White",
    quantity: 2,
    unitPriceMinor: 320,
    modifiers: [{ modifierId: "oat", name: "Oat", priceMinor: 40 }],
    taxRateId: "standard",
    note: null,
  },
  {
    id: "fl_2",
    itemId: "nat",
    name: "Pastel de Nata",
    quantity: 3,
    unitPriceMinor: 160,
    modifiers: [],
    taxRateId: "intermediate",
    note: null,
  },
];

/**
 * Wraps whatever is on the till in the Order shape a receipt renders from, so
 * the same component serves a live ticket and a settled order.
 */
export function previewOrder(input: {
  lines: OrderLine[];
  totals: OrderTotals;
  currency: FiatCurrency;
  shopName: string;
  terminalName: string;
  orderNumber: number;
}): Order {
  return {
    id: `ord_preview_${input.orderNumber}`,
    number: input.orderNumber,
    reference: orderReference(input.shopName || "Till", input.orderNumber),
    // A settled order carries the network of the charge that closed it; a ticket
    // that has not been charged yet has none, so the receipt assumes the shop's.
    network: "mainnet",
    status: "paid",
    lines: input.lines,
    totals: input.totals,
    currency: input.currency,
    tender: [{ kind: "crypto", amountMinor: input.totals.totalMinor }],
    staffName: MOCK_STAFF[0].name,
    terminalName: input.terminalName,
    createdAt: MOCK_NOW,
    paidAt: MOCK_NOW,
    payerAddress: MOCK_CUSTOMERS[0].address,
    note: null,
  };
}

/** A settled order, so the receipt is previewable with nothing rung up. */
export const PREVIEW_ORDER: Order = previewOrder({
  lines: FIXTURE_LINES,
  totals: orderTotals({
    lines: FIXTURE_LINES,
    taxRates: DEFAULT_TAX_RATES,
    taxMode: "inclusive",
    tipMinor: 50,
  }),
  currency: "EUR",
  shopName: "Merchant Coffee",
  terminalName: "Counter iPad",
  orderNumber: PREVIEW_ORDER_NUMBER,
});

/* ------------------------------------------------------------------ */
/* VAT, per rate                                                       */
/* ------------------------------------------------------------------ */

interface VatRow {
  id: string;
  label: string;
  percent: number;
  netMinor: Minor;
  taxMinor: Minor;
  grossMinor: Minor;
}

/**
 * Rebuilt down the same path `orderTotals` takes — a pro-rata discount spread
 * with `distribute`, then tax per line — so the rows sum to the order's own
 * figures rather than to a second, slightly different, opinion of them.
 */
function vatRows(order: Order, taxRates: TaxRate[], taxMode: TaxMode): VatRow[] {
  const lineGross = order.lines.map(lineGrossMinor);
  const perLine = distribute(order.totals.discountMinor, lineGross);
  const payable = new Map<string, Minor>();
  order.lines.forEach((line, index) => {
    payable.set(line.taxRateId, (payable.get(line.taxRateId) ?? 0) + lineGross[index] - perLine[index]);
  });
  return [...payable.entries()].map(([id, payableMinor]) => {
    const taxMinor = order.totals.taxByRate[id] ?? 0;
    const rate = taxRates.find((r) => r.id === id);
    return {
      id,
      label: rate?.label ?? id,
      percent: rate?.percent ?? 0,
      netMinor: taxMode === "inclusive" ? payableMinor - taxMinor : payableMinor,
      taxMinor,
      grossMinor: taxMode === "inclusive" ? payableMinor : payableMinor + taxMinor,
    };
  });
}

/**
 * `TenderKind` is `"crypto" | "cash"`, so an order settled on somebody else's
 * card terminal arrives with no parts at all. The receipt says that rather than
 * claiming a rail the money did not travel on.
 */
function tenderLabel(order: Order): string {
  if (order.tender.length === 0) return "another tender";
  return order.tender.map((part) => (part.kind === "cash" ? "Cash" : "Stellar")).join(" + ");
}

function receiptDate(order: Order): string {
  return new Date(order.paidAt ?? order.createdAt).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ------------------------------------------------------------------ */
/* 48-column composition                                               */
/* ------------------------------------------------------------------ */

/** Left text, right figure, one line, never wider than the roll. */
function columns(left: string, right: string): string {
  const room = Math.max(0, COLUMNS - right.length - 1);
  const head = left.length > room ? left.slice(0, room) : left;
  const gap = Math.max(1, COLUMNS - head.length - right.length);
  return `${head}${" ".repeat(gap)}${right}`.slice(0, COLUMNS);
}

function centred(text: string): string {
  const body = text.slice(0, COLUMNS);
  return `${" ".repeat(Math.max(0, Math.floor((COLUMNS - body.length) / 2)))}${body}`;
}

function rule(character = "-"): string {
  return character.repeat(COLUMNS);
}

/** Greedy wrap; a word longer than the roll is cut rather than overflowed. */
function wrapped(text: string, width = COLUMNS): string[] {
  const out: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const piece = word.length > width ? word.slice(0, width) : word;
    if (current === "") current = piece;
    else if (current.length + 1 + piece.length <= width) current = `${current} ${piece}`;
    else {
      out.push(current);
      current = piece;
    }
  }
  if (current !== "") out.push(current);
  return out;
}

/**
 * The thermal specimen. Every entry is measured against `COLUMNS`, which is what
 * makes this a specimen and not a screenshot of a web page.
 */
function thermalLines(
  order: Order,
  profile: MerchantProfile,
  rows: VatRow[],
  taxMode: TaxMode,
  hash: string | null,
): string[] {
  const currency = order.currency;
  const money = (minor: Minor) => minorToDecimal(minor);
  const out: string[] = [];

  out.push(centred((profile.name || "MERCHANT").toUpperCase()));
  for (const address of profile.addressLines) {
    for (const piece of wrapped(address)) out.push(centred(piece));
  }
  if (profile.taxId) out.push(centred(`VAT ${profile.taxId}`));
  out.push("");
  out.push(columns(`ORDER ${order.number}`, order.reference));
  out.push(columns(receiptDate(order), order.terminalName.slice(0, 18)));
  out.push(columns(`Served by ${order.staffName}`, ""));
  out.push(rule());

  for (const line of order.lines) {
    const unit = line.modifiers.reduce((sum, m) => sum + m.priceMinor, line.unitPriceMinor);
    const figure = money(lineGrossMinor(line));
    // A long product name wraps onto the roll rather than being cut mid-word —
    // the figure stays on the first line, where the eye looks for it.
    const title = wrapped(`${line.quantity} x ${line.name}`, COLUMNS - figure.length - 1);
    out.push(columns(title[0] ?? line.name, figure));
    for (const rest of title.slice(1)) out.push(`  ${rest}`.slice(0, COLUMNS));
    for (const modifier of line.modifiers) {
      out.push(
        columns(
          `   + ${modifier.name}`,
          modifier.priceMinor === 0 ? "" : `+${money(modifier.priceMinor)}`,
        ),
      );
    }
    if (line.quantity > 1) out.push(columns(`   @ ${money(unit)} each`, ""));
  }

  out.push(rule());
  out.push(columns("SUBTOTAL", money(order.totals.grossMinor)));
  if (order.totals.discountMinor > 0) {
    out.push(columns("DISCOUNT", `-${money(order.totals.discountMinor)}`));
  }
  if (order.totals.tipMinor > 0) out.push(columns("TIP", money(order.totals.tipMinor)));
  out.push(columns("TOTAL", `${currency} ${money(order.totals.totalMinor)}`));
  out.push(rule());

  out.push(taxMode === "inclusive" ? "VAT INCLUDED IN THE TOTAL" : "VAT ADDED TO THE TOTAL");
  // One field width for the header and every row, so the columns line up on the
  // roll rather than only in the browser's proportional preview.
  const vatRow = (label: string, pct: string, net: string, vat: string, gross: string) =>
    `${label.slice(0, 12).padEnd(12, " ")}${pct.padStart(5, " ")}${net.padStart(9, " ")}${vat.padStart(9, " ")}${gross.padStart(9, " ")}`;
  out.push(vatRow("RATE", "%", "NET", "VAT", "GROSS"));
  for (const row of rows) {
    out.push(
      vatRow(
        row.label,
        `${row.percent}%`,
        money(row.netMinor),
        money(row.taxMinor),
        money(row.grossMinor),
      ),
    );
  }
  out.push(rule());

  out.push(columns("PAID", tenderLabel(order).toUpperCase()));
  if (hash) {
    // 64 hex characters do not fit a 48-column roll, so the hash is split at the
    // halfway mark and printed on two lines the customer can read back.
    out.push("TRANSACTION HASH");
    out.push(hash.slice(0, 32));
    out.push(hash.slice(32));
  } else {
    out.push("NOT SETTLED ON CHAIN");
  }
  if (order.payerAddress) {
    out.push(columns("PAYER", `${order.payerAddress.slice(0, 4)}...${order.payerAddress.slice(-4)}`));
  }
  out.push(rule("="));

  for (const piece of wrapped(profile.receiptFooter || "Thank you.")) out.push(centred(piece));
  out.push(centred("Kept by the shop for its own records."));
  out.push("");

  return out.map((entry) => entry.slice(0, COLUMNS).trimEnd());
}

/** The plain body an SMS or a mail draft carries. */
function messageBody(order: Order, profile: MerchantProfile, rows: VatRow[], verifyUrl: string | null): string {
  const money = (minor: Minor) => fmtMinor(minor, order.currency);
  const parts = [
    `${profile.name || "Your receipt"} — order ${order.number} (${order.reference})`,
    receiptDate(order),
    "",
    ...order.lines.map((line) => `${line.quantity} x ${line.name}  ${money(lineGrossMinor(line))}`),
    "",
    ...(order.totals.discountMinor > 0 ? [`Discount  -${money(order.totals.discountMinor)}`] : []),
    ...(order.totals.tipMinor > 0 ? [`Tip  ${money(order.totals.tipMinor)}`] : []),
    `Total  ${money(order.totals.totalMinor)}`,
    ...rows.map((row) => `VAT ${row.label} ${row.percent}%  ${money(row.taxMinor)}`),
    "",
    `Paid by ${tenderLabel(order).toLowerCase()}`,
    ...(verifyUrl ? [`Verify: ${verifyUrl}`] : []),
    ...(profile.receiptFooter ? ["", profile.receiptFooter] : []),
  ];
  return parts.join("\n");
}

const PRINT_CSS = `
@media print {
  html, body { background: #ffffff !important; margin: 0 !important; padding: 0 !important; }
  body > *:not(.modal-overlay) { display: none !important; }
  /* The ambient gradients are pseudo-elements of body, so the rule above cannot
     reach them and they would print as a colour wash behind the receipt. */
  body::before, body::after { display: none !important; }
  .modal-overlay {
    position: static !important;
    display: block !important;
    padding: 0 !important;
    background: none !important;
    -webkit-backdrop-filter: none !important;
    backdrop-filter: none !important;
    animation: none !important;
  }
  .modal-dialog {
    position: static !important;
    max-width: none !important;
    max-height: none !important;
    overflow: visible !important;
    border: 0 !important;
    border-radius: 0 !important;
    background: #ffffff !important;
    box-shadow: none !important;
    -webkit-backdrop-filter: none !important;
    backdrop-filter: none !important;
    animation: none !important;
  }
  .receipt-no-print { display: none !important; }
  .receipt-shell { padding: 0 !important; }
  .receipt-scroll { overflow: visible !important; }
  #merchant-receipt-paper {
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    border-radius: 0 !important;
    max-width: none !important;
    background: #ffffff !important;
    color: #000000 !important;
    box-shadow: none !important;
  }
  #merchant-receipt-paper pre {
    color: #000000 !important;
    font-size: 10pt;
    line-height: 1.3;
  }
  @page { size: 80mm auto; margin: 4mm; }
}
`;

/* ------------------------------------------------------------------ */
/* The sheet                                                           */
/* ------------------------------------------------------------------ */

export function ReceiptSheet({
  open,
  onClose,
  order,
  transactionHash = PREVIEW_TX_HASH,
}: {
  open: boolean;
  onClose: () => void;
  order: Order;
  /** The settling payment's hash — the artefact the receipt is verifiable by. */
  transactionHash?: string | null;
}) {
  if (!open) return null;
  return <ReceiptSheetInner onClose={onClose} order={order} transactionHash={transactionHash} />;
}

function ReceiptSheetInner({
  onClose,
  order,
  transactionHash,
}: {
  onClose: () => void;
  order: Order;
  transactionHash: string | null;
}) {
  const { settings } = useMerchant();
  const { toast } = useToast();

  const [channel, setChannel] = useState<ReceiptChannel>("screen");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [qr, setQr] = useState<{ url: string; dataUrl: string } | null>(null);

  const profile = settings.profile;
  const rows = useMemo(
    () => vatRows(order, settings.taxRates, settings.taxMode),
    [order, settings.taxRates, settings.taxMode],
  );
  const verifyUrl = transactionHash
    ? NETWORKS[order.network].explorerTxUrl(transactionHash)
    : null;
  const body = useMemo(
    () => messageBody(order, profile, rows, verifyUrl),
    [order, profile, rows, verifyUrl],
  );
  const paper = useMemo(
    () => thermalLines(order, profile, rows, settings.taxMode, transactionHash),
    [order, profile, rows, settings.taxMode, transactionHash],
  );
  const widest = paper.reduce((max, entry) => Math.max(max, entry.length), 0);
  const printer = MOCK_PERIPHERALS.find((p) => p.kind === "printer");

  /* The verification QR is a real encoding of the explorer link, so the customer
     photographs something that resolves rather than a decorative square. The
     encoded URL is kept beside the image so a stale one is never shown. */
  const qrTarget = channel === "screen" ? verifyUrl : null;
  useEffect(() => {
    if (!qrTarget) return;
    let alive = true;
    void (async () => {
      try {
        const dataUrl = await QRCode.toDataURL(qrTarget, {
          width: 320,
          margin: 1.5,
          color: { dark: "#000000", light: "#ffffff" },
        });
        if (alive) setQr({ url: qrTarget, dataUrl });
      } catch {
        if (alive) setQr(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [qrTarget]);

  const qrDataUrl = qr !== null && qrTarget !== null && qr.url === qrTarget ? qr.dataUrl : null;

  const subject = `${profile.name || "Receipt"} — order ${order.number}`;
  const smsHref = `sms:${phone.trim()}?&body=${encodeURIComponent(body)}`;
  const mailHref = `mailto:${email.trim()}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  function print() {
    triggerHaptic("light");
    toast("Sent to the browser's print dialog — the receipt prints alone.");
    window.print();
  }

  return (
    <Modal open onClose={onClose} wide>
      <style>{PRINT_CSS}</style>

      <div className="receipt-no-print">
        <ModalHeader
          title="Receipt"
          subtitle={`Order ${order.number} · ${fmtMinor(order.totals.totalMinor, order.currency)}`}
          onClose={onClose}
        />
      </div>

      <div className="receipt-shell space-y-4 p-4 sm:p-6">
        {/* ---------------- the chooser ---------------- */}
        <div className="receipt-no-print grid grid-cols-2 gap-2 sm:grid-cols-5">
          {CHANNELS.map((option) => {
            const on = channel === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  triggerHaptic("selection");
                  setChannel(option.value);
                }}
                className={`flex min-h-[88px] flex-col items-center justify-center gap-1.5 rounded-2xl px-2 py-3 text-center transition-colors ${
                  option.value === "none" ? "col-span-2 sm:col-span-1" : ""
                } ${
                  on
                    ? "bg-[#0A84FF]/20 text-[#0A84FF]"
                    : "bg-white/[0.08] text-white hover:bg-white/[0.13]"
                }`}
              >
                {option.icon(19)}
                <span className="text-[13px] font-semibold leading-tight">{option.label}</span>
                <span
                  className={`text-[10.5px] leading-tight ${on ? "text-[#0A84FF]/80" : "text-neutral-500"}`}
                >
                  {option.hint}
                </span>
              </button>
            );
          })}
        </div>

        {/* ---------------- on screen ---------------- */}
        {channel === "screen" && (
          <div className="receipt-no-print space-y-3">
            <p className="flex items-center gap-1.5 px-1 text-[12.5px] text-neutral-400">
              <IconInfo size={13} className="shrink-0 text-neutral-500" />
              Hand the screen over. Nothing leaves the device.
            </p>

            <div className="panel">
              <div className="border-b border-white/[0.08] px-4 py-4 text-center">
                <p className="text-[17px] font-semibold text-white">
                  {profile.name || "Your receipt"}
                </p>
                {profile.addressLines.map((address) => (
                  <p key={address} className="text-[12px] leading-relaxed text-neutral-400">
                    {address}
                  </p>
                ))}
                {profile.taxId && (
                  <p className="mono mt-1 text-[11.5px] text-neutral-500">VAT {profile.taxId}</p>
                )}
              </div>

              <div className="flex items-center justify-between px-4 py-2.5 text-[12.5px]">
                <span className="text-neutral-400">
                  Order {order.number} · {order.reference}
                </span>
                <span className="text-neutral-500">{receiptDate(order)}</span>
              </div>

              <ul className="border-t border-white/[0.08]">
                {order.lines.map((line, index) => (
                  <li
                    key={line.id}
                    className={`flex items-start justify-between gap-3 px-4 py-2.5 ${
                      index > 0 ? "border-t border-white/[0.08]" : ""
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block text-[14px] text-white">
                        {line.quantity} × {line.name}
                      </span>
                      {line.modifiers.length > 0 && (
                        <span className="block text-[11.5px] text-neutral-500">
                          {line.modifiers.map((m) => m.name).join(" · ")}
                        </span>
                      )}
                    </span>
                    <span className="mono shrink-0 text-[14px] text-white">
                      {fmtMinor(lineGrossMinor(line), order.currency)}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="border-t border-white/[0.08] px-4 py-3">
                <Row label="Subtotal" value={fmtMinor(order.totals.grossMinor, order.currency)} />
                {order.totals.discountMinor > 0 && (
                  <Row
                    label="Discount"
                    value={`−${fmtMinor(order.totals.discountMinor, order.currency)}`}
                  />
                )}
                {order.totals.tipMinor > 0 && (
                  <Row label="Tip" value={fmtMinor(order.totals.tipMinor, order.currency)} />
                )}
                {rows.map((row) => (
                  <Row
                    key={row.id}
                    label={`VAT ${row.label} ${row.percent} % · ${
                      settings.taxMode === "inclusive" ? "included" : "added"
                    }`}
                    value={fmtMinor(row.taxMinor, order.currency)}
                  />
                ))}
                <div className="mt-2 flex items-center justify-between border-t border-white/[0.08] pt-2.5">
                  <span className="text-[15.5px] font-semibold text-white">Total</span>
                  <span className="mono text-[22px] font-semibold text-white">
                    {fmtMinor(order.totals.totalMinor, order.currency)}
                  </span>
                </div>
              </div>

              {/* The hash is the receipt. Everything above it is bookkeeping. */}
              <div className="border-t border-white/[0.08] px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                  Paid by {tenderLabel(order).toLowerCase()}
                </p>
                {transactionHash ? (
                  <>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <HashValue value={transactionHash} className="text-[12.5px] text-neutral-200" />
                      <CopyButton value={transactionHash} label="Copy" />
                    </div>
                    <div className="mt-3 flex items-center gap-3">
                      <div className="shrink-0 rounded-2xl bg-white p-2">
                        {qrDataUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={qrDataUrl}
                            alt={`Verify transaction ${transactionHash.slice(0, 8)} on the block explorer`}
                            width={92}
                            height={92}
                            className="rounded-lg"
                          />
                        ) : (
                          <div className="flex h-[92px] w-[92px] items-center justify-center text-black">
                            <Spinner size={16} />
                          </div>
                        )}
                      </div>
                      <p className="text-[12px] leading-relaxed text-neutral-400">
                        Anyone can check this payment against the ledger without asking the shop.
                        The QR opens it on a block explorer.
                      </p>
                    </div>
                  </>
                ) : (
                  <p className="mt-1.5 text-[12.5px] text-[#FF9F0A]">
                    Not settled on chain yet, so there is no hash to verify against.
                  </p>
                )}
              </div>

              {profile.receiptFooter && (
                <p className="border-t border-white/[0.08] px-4 py-3 text-center text-[12px] leading-relaxed text-neutral-400">
                  {profile.receiptFooter}
                </p>
              )}
            </div>

            <button type="button" onClick={onClose} className="btn btn-primary w-full">
              Done
            </button>
          </div>
        )}

        {/* ---------------- text ---------------- */}
        {channel === "text" && (
          <div className="receipt-no-print space-y-3">
            <Notice>
              This one is real. The button hands your phone an SMS draft already carrying the
              figures — nothing is sent until you press send in Messages, and the number is never
              stored here.
            </Notice>
            <div className="space-y-1.5">
              <label className="field-label !pb-0" htmlFor="receipt-phone">
                Mobile number
              </label>
              <input
                id="receipt-phone"
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+351 000 000 000"
                className="input input-mono text-base sm:text-[15px]"
              />
            </div>
            <DraftPreview body={body} />
            <a
              href={smsHref}
              onClick={() => triggerHaptic("light")}
              className="btn btn-primary w-full"
            >
              Open the message
            </a>
          </div>
        )}

        {/* ---------------- email ---------------- */}
        {channel === "email" && (
          <div className="receipt-no-print space-y-3">
            <Notice>
              Also real. It opens a mail draft with the subject, the figures and the verification
              link filled in. No address book, no sending server, no copy kept.
            </Notice>
            <div className="space-y-1.5">
              <label className="field-label !pb-0" htmlFor="receipt-email">
                Email address
              </label>
              <input
                id="receipt-email"
                type="email"
                inputMode="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="input text-base sm:text-[15px]"
              />
            </div>
            <DraftPreview body={body} />
            <a
              href={mailHref}
              onClick={() => triggerHaptic("light")}
              className="btn btn-primary w-full"
            >
              Open the draft
            </a>
          </div>
        )}

        {/* ---------------- print ---------------- */}
        {channel === "print" && (
          <>
            <div className="receipt-no-print space-y-3">
              {printer && !printer.connected && (
                <Notice tone="warn">
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 shrink-0 text-[#FF9F0A]">
                      <IconAlert size={15} />
                    </span>
                    <div>
                      <p className="font-semibold text-white">
                        {printer.name} is not reachable from a browser
                      </p>
                      <p className="mt-1 text-neutral-300">
                        {printer.detail}. Until there is a native transport, the specimen below goes
                        to the system print dialog instead — a roll printer set as the system
                        printer prints it correctly.
                      </p>
                    </div>
                  </div>
                </Notice>
              )}
              <div className="flex items-center justify-between px-1">
                <p className="text-[12.5px] text-neutral-400">
                  {COLUMNS}-column specimen · 80 mm roll
                </p>
                <span className="mono text-[11.5px] text-neutral-500">
                  widest line {widest}/{COLUMNS}
                </span>
              </div>
            </div>

            <div className="receipt-scroll overflow-x-auto">
              <div
                id="merchant-receipt-paper"
                className="mx-auto w-full min-w-[320px] max-w-[380px] rounded-2xl bg-white px-4 py-5"
              >
                <pre className="mono whitespace-pre text-[9.5px] leading-[1.5] text-black sm:text-[11px]">
                  {paper.join("\n")}
                </pre>
              </div>
            </div>

            <div className="receipt-no-print space-y-2">
              <button type="button" onClick={print} className="btn btn-primary w-full">
                <IconPrinter size={16} /> Print
              </button>
              <p className="text-center text-[11.5px] leading-relaxed text-neutral-500">
                The print stylesheet hides the app and the sheet chrome, so the page that comes out
                is the receipt and nothing else.
              </p>
            </div>
          </>
        )}

        {/* ---------------- no receipt ---------------- */}
        {channel === "none" && (
          <div className="receipt-no-print space-y-3">
            <Notice>
              Nothing is printed, drafted or sent. The order keeps its own record either way, and
              the customer can still verify the payment from their own wallet — they have the
              transaction.
            </Notice>
            <button
              type="button"
              onClick={() => {
                triggerHaptic("light");
                toast("No receipt issued. The order keeps its record.");
                onClose();
              }}
              className="btn btn-secondary w-full"
            >
              Finish without a receipt
            </button>
          </div>
        )}

        <p className="receipt-no-print flex items-start gap-2 border-t border-white/[0.08] pt-3 text-[11.5px] leading-relaxed text-neutral-500">
          <IconQr size={13} className="mt-0.5 shrink-0" />
          Served by {order.staffName} on {order.terminalName}.
        </p>
      </div>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-[13px]">
      <span className="text-neutral-400">{label}</span>
      <span className="mono text-neutral-200">{value}</span>
    </div>
  );
}

function DraftPreview({ body }: { body: string }) {
  return (
    <div className="panel-inset max-h-[180px] overflow-y-auto px-3.5 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
        What it carries
      </p>
      <pre className="mono mt-1.5 whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-neutral-300">
        {body}
      </pre>
    </div>
  );
}
