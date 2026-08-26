"use client";

import { useState } from "react";
import { useMerchant } from "@/hooks/useMerchant";
import { triggerHaptic } from "@/lib/haptics";
import { fmtMinor } from "@/lib/merchant/money";
import { findScannedCatalogueItem } from "@/lib/merchant/runtime";
import type { Peripheral, PeripheralKind, TillTextSize } from "@/lib/merchant/types";
import { useToast } from "../Toast";
import { IOSBackButton, SegmentedControl } from "../ui";
import { IconAlert, IconCheck, IconChevronDown, IconKeyboard, IconQrScan, IconWallet } from "../icons";
import { IconInfo, IconPrinter, IconTerminal, IconXCircle } from "./icons";
import { MerchantDisclosure } from "./Disclosure";

/** Said once, then reused by the chip and the disclosure beside it. */

/* ------------------------------------------------------------------ */
/* Per-kind copy                                                       */
/* ------------------------------------------------------------------ */

const KIND_ICON: Record<PeripheralKind, (props: { size?: number }) => React.ReactElement> = {
  printer: IconPrinter,
  drawer: IconWallet,
  scanner: IconQrScan,
  display: IconTerminal,
};

const KIND_TINT: Record<PeripheralKind, string> = {
  printer: "#64D2FF",
  drawer: "#FF9F0A",
  scanner: "#30D158",
  display: "#5E5CE6",
};

function actionLabel(peripheral: Peripheral): string {
  if (peripheral.id === "system-print") return "Open a test print";
  if (peripheral.id === "keyboard-scanner") return "Test a scan";
  if (peripheral.id === "same-device-display") return "Preview the display";
  return "Unavailable in this browser";
}

const KIND_EXPLAINER: Record<PeripheralKind, string> = {
  printer:
    "The system print dialog works in the browser and offers AirPrint on supported iPhones and iPads. Direct ESC/POS control needs a native USB or Bluetooth bridge that is not installed.",
  drawer:
    "A cash drawer has no radio and no driver. It opens on a kick pulse from the receipt printer's RJ11 socket, so it is exactly as available as the printer — which needs the bridge above.",
  scanner:
    "An HID barcode scanner is a keyboard: it types what it read and presses Enter. Nothing to pair, no driver, no permission — whatever field has focus receives the code. That is why this row works when the two above it do not.",
  display:
    "The customer display is this device, turned around: the till mirrors the total, flips it 180° and dims the staff controls, so a counter with one screen can still show what is owed.",
};

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

type State = "available" | "idle" | "unavailable";

function stateOf(peripheral: Peripheral): State {
  if (peripheral.unavailable) return "unavailable";
  return peripheral.connected ? "available" : "idle";
}

/** Never colour alone: each of these is a glyph and a word. */
function StatusPill({ state }: { state: State }) {
  const map = {
    available: {
      className: "text-[#30D158] bg-[#30D158]/15",
      Glyph: IconCheck,
      label: "Available",
    },
    idle: {
      className: "text-neutral-400 bg-white/[0.08]",
      Glyph: IconAlert,
      label: "Not connected",
    },
    unavailable: {
      className: "text-neutral-400 bg-white/[0.08]",
      Glyph: IconXCircle,
      label: "Unavailable",
    },
  } as const;
  const { className, Glyph, label } = map[state];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-[3px] text-[11px] font-semibold leading-none ${className}`}
    >
      <Glyph size={10} />
      {label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Till text size                                                      */
/* ------------------------------------------------------------------ */

const TEXT_SIZE_LABEL: Record<TillTextSize, string> = {
  standard: "Standard",
  large: "Large",
  xlarge: "Extra Large",
};

const TEXT_SIZE_TOTAL: Record<TillTextSize, string> = {
  standard: "text-[28px]",
  large: "text-[34px]",
  xlarge: "text-[44px]",
};

const TEXT_SIZE_LINE: Record<TillTextSize, string> = {
  standard: "text-[13px]",
  large: "text-[15.5px]",
  xlarge: "text-[19px]",
};

/* ------------------------------------------------------------------ */
/* The page                                                            */
/* ------------------------------------------------------------------ */

export function PeripheralsPage({ onBack }: { onBack: () => void }) {
  const { settings, catalogue, peripherals, tillTextSize, setTillTextSize } = useMerchant();
  const { toast } = useToast();

  const [openRow, setOpenRow] = useState<string | null>(null);
  const [scanDraft, setScanDraft] = useState("");
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [displayPreview, setDisplayPreview] = useState(false);

  const currency = settings.currency;
  const deviceName = settings.terminalName.trim() || "This device";

  function toggleRow(id: string) {
    triggerHaptic("selection");
    setOpenRow((current) => (current === id ? null : id));
  }

  function runAction(peripheral: Peripheral) {
    if (peripheral.id === "system-print") {
      triggerHaptic("selection");
      window.print();
      return;
    }
    if (peripheral.unavailable) {
      triggerHaptic("warning");
      toast(`${peripheral.name} needs a native bridge that is not installed.`, "error");
      return;
    }
    if (peripheral.id === "keyboard-scanner") {
      triggerHaptic("light");
      setOpenRow(peripheral.id);
      toast("Scan into the field below");
      return;
    }
    triggerHaptic("light");
    setOpenRow(peripheral.id);
    setDisplayPreview((on) => !on);
    toast(displayPreview ? "Preview closed" : "Same-device display preview opened");
  }

  return (
    <section className="fade-up w-full pb-[132px] md:pb-12">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          body::before, body::after { display: none !important; }
          #merchant-test-receipt, #merchant-test-receipt * { visibility: visible !important; }
          #merchant-test-receipt {
            display: block !important;
            position: fixed !important;
            inset: 0 auto auto 0 !important;
            width: 72mm !important;
            padding: 8mm !important;
            background: #fff !important;
            color: #000 !important;
            font: 12px/1.45 ui-monospace, monospace !important;
          }
        }
      `}</style>
      <div id="merchant-test-receipt" className="hidden" aria-hidden="true">
        <p className="text-center font-bold">{settings.profile.name.trim() || "Merchant receipt"}</p>
        <p className="mt-3">System print / AirPrint test</p>
        <p>{deviceName}</p>
        <p className="mt-3 border-t border-black pt-2 font-bold">Printer ready</p>
      </div>
      {/* ---------------- header ---------------- */}
      <div className="flex items-center justify-between pb-1 pt-2">
        <IOSBackButton onClick={onBack} label="Back to Merchant settings" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
          Merchant
        </span>
        <span className="w-11" aria-hidden />
      </div>

      <h1 className="display-h text-[28px] font-bold text-white">Peripherals</h1>
      <p className="mt-1.5 max-w-[60ch] text-[13px] leading-relaxed text-neutral-400">
        Hardware attached to {deviceName} — a cable, a short-range radio, a keyboard, or this screen
        turned around.
      </p>

      <div className="mb-5 mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <MerchantDisclosure label="What this build can and cannot drive">
          <p>
            The printer and the drawer need a native bridge this build does not have — a browser
            cannot open a Bluetooth serial or USB port, and the drawer only opens on a kick pulse
            from the printer. The scanner works because an HID scanner is just a keyboard.
          </p>
        </MerchantDisclosure>
      </div>

      <div className="space-y-5">
        {/* ---------------- the four rows ---------------- */}
        <section className="space-y-2">
          <h2 className="px-1 text-[12px] font-semibold uppercase tracking-wider text-neutral-400">
            Hardware
          </h2>
          <div className="list-group">
            {peripherals.map((peripheral, index) => {
              const state = stateOf(peripheral);
              const Glyph = KIND_ICON[peripheral.kind];
              const expanded = openRow === peripheral.id;
              return (
                <div key={peripheral.id} className={index > 0 ? "ios-sep" : ""}>
                  <button
                    type="button"
                    id={`${peripheral.id}-trigger`}
                    onClick={() => toggleRow(peripheral.id)}
                    aria-expanded={expanded}
                    aria-controls={`${peripheral.id}-detail`}
                    className="row-hover flex w-full items-center gap-3.5 px-4 py-3.5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#0A84FF]"
                  >
                    <span
                      aria-hidden="true"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white shadow-sm"
                      style={{
                        background:
                          state === "unavailable"
                            ? "rgba(118,118,128,0.28)"
                            : KIND_TINT[peripheral.kind],
                      }}
                    >
                      <Glyph size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15.5px] font-normal leading-tight text-white">
                        {peripheral.name}
                      </span>
                      <span className="mono block truncate text-[12px] leading-tight text-neutral-400">
                        {peripheral.detail}
                      </span>
                    </span>
                    <StatusPill state={state} />
                    <IconChevronDown
                      size={16}
                      className={`chevron transition-transform ${expanded ? "rotate-180" : ""}`}
                    />
                  </button>

                  <div
                    id={`${peripheral.id}-detail`}
                    role="region"
                    aria-labelledby={`${peripheral.id}-trigger`}
                    hidden={!expanded}
                  >
                    {expanded && (
                    <div className="border-t border-white/[0.08] bg-white/[0.02] px-4 py-3.5">
                      <p className="text-[12.5px] leading-relaxed text-neutral-400">
                        {KIND_EXPLAINER[peripheral.kind]}
                      </p>

                      {peripheral.kind === "scanner" && (
                        <div className="mt-3">
                          <label
                            htmlFor="peripheral-scan-capture"
                            className="field-label flex items-center gap-1.5"
                          >
                            <IconKeyboard size={13} /> Capture field
                          </label>
                          <input
                            id="peripheral-scan-capture"
                            type="text"
                            value={scanDraft}
                            placeholder="Scan a barcode, or type one and press Enter"
                            onChange={(e) => setScanDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key !== "Enter") return;
                              const code = scanDraft.trim();
                              if (!code) return;
                              setLastScan(code);
                              setScanDraft("");
                              const item = findScannedCatalogueItem(catalogue, code);
                              triggerHaptic(item ? "success" : "warning");
                              toast(
                                item
                                  ? `Matched ${item.name}. The till adds this SKU when scanned.`
                                  : `No active catalogue item has SKU ${code}.`,
                                item ? "success" : "error",
                              );
                            }}
                            className="input mono text-base sm:text-[13.5px]"
                          />
                          {lastScan && (
                            <p className="mt-2 flex items-center gap-1.5 text-[12px] text-[#30D158]">
                              <IconCheck size={12} />
                              <span>
                                Last read <span className="mono">{lastScan}</span>
                              </span>
                            </p>
                          )}
                        </div>
                      )}

                      {peripheral.kind === "display" && displayPreview && (
                        <div className="mt-3 rounded-[14px] border border-white/[0.08] px-4 py-4">
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                            Facing the customer
                          </p>
                          <div className="mt-2 rotate-180 text-center">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                              Total
                            </p>
                            <p className="mono mt-1 text-[28px] font-semibold leading-none text-white">
                              {fmtMinor(480, currency)}
                            </p>
                            <p className="mt-1.5 text-[11.5px] text-neutral-400">
                              2 items · {settings.profile.name.trim() || "Your shop"}
                            </p>
                          </div>
                        </div>
                      )}

                      <div className="mt-3 flex flex-wrap items-center gap-2.5">
                        <button
                          type="button"
                          onClick={() => runAction(peripheral)}
                          disabled={state === "unavailable"}
                          className="btn btn-secondary"
                        >
                          {actionLabel(peripheral)}
                        </button>
                        {state === "unavailable" && (
                          <span className="text-[12px] text-neutral-500">
                            Needs a native bridge this build does not have
                          </span>
                        )}
                      </div>
                    </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="flex items-start gap-2 px-1 text-[12px] leading-relaxed text-neutral-500">
            <IconInfo size={13} className="mt-[2px] shrink-0 text-[#64D2FF]" />
            <span>
              None of this is required to take money. A charge is a QR this device draws and a
              ledger it watches, so a counter with no hardware runs the whole day.
            </span>
          </p>
        </section>

        {/* ---------------- till text size ---------------- */}
        <section className="space-y-2">
          <h2 className="px-1 text-[12px] font-semibold uppercase tracking-wider text-neutral-400">
            Till text size
          </h2>
          <div className="list-group">
            <div className="px-4 py-3.5">
              <div className="sm:max-w-[320px]">
                <SegmentedControl<TillTextSize>
                  value={tillTextSize}
                  onChange={setTillTextSize}
                  options={(Object.keys(TEXT_SIZE_LABEL) as TillTextSize[]).map((size) => ({
                    label: TEXT_SIZE_LABEL[size],
                    value: size,
                  }))}
                />
              </div>
            </div>
          </div>
          <p className="px-1 pt-2 text-[12px] leading-relaxed text-neutral-400">
            The web has no Dynamic Type, so the till carries its own scale — the ticket, the keypad
            and the total, never the receipt.
          </p>

          {/* The preview is a surface, not a settings row, so it sits on its own. */}
          <div className="panel">
            <div className="px-4 py-3.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                Preview
              </p>
              <div className="mt-2 rounded-[14px] border border-white/[0.08] px-4 py-3.5">
                <div className={`mono flex justify-between gap-3 text-neutral-300 ${TEXT_SIZE_LINE[tillTextSize]}`}>
                  <span className="truncate">1 × Flat White</span>
                  <span className="shrink-0">{fmtMinor(320, currency)}</span>
                </div>
                <div
                  className={`mono mt-1 flex justify-between gap-3 text-neutral-300 ${TEXT_SIZE_LINE[tillTextSize]}`}
                >
                  <span className="truncate">1 × Pastel de Nata</span>
                  <span className="shrink-0">{fmtMinor(160, currency)}</span>
                </div>
                <div className="mt-3 border-t border-white/[0.08] pt-3 text-center">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                    Total
                  </p>
                  <p
                    className={`mono mt-1 font-semibold leading-none text-white ${TEXT_SIZE_TOTAL[tillTextSize]}`}
                  >
                    {fmtMinor(480, currency)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
