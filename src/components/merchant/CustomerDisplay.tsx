"use client";

/**
 * DESIGN MOCK — the customer-facing mode.
 *
 * What is mocked: the lock. Any four digits leave, because a real check reads
 * the salted digest in `StaffMember.pinDigest` — which lives outside the vault
 * precisely so the till can be authorised while the wallet is locked. The QR is
 * NOT mocked: it is a genuine SEP-7 request against the shop's own receiving
 * account carrying the memo and the network passphrase. It carries no amount,
 * because an amount belongs to a held quote and this screen has not raised a
 * charge — the screen says so rather than inventing a rate.
 *
 * What a real implementation replaces: `unlock()` would verify the digest and
 * attribute the exit to a StaffMember, and the QR would come from the live
 * charge's `payUriFor(charge, asset)`. What it cannot replace on its own is the
 * second screen: rotating this device is all one device can do — a paired
 * display needs a sync channel this build does not have.
 *
 * Deliberately absent: any route to Send, Settings, Backup or the rest of the
 * wallet. The only controls are rotate and exit, and exit asks for the PIN.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { triggerHaptic } from "@/lib/haptics";
import { useMerchant } from "@/hooks/useMerchant";
import { useWallet } from "@/hooks/useWallet";
import { buildSep7PayUri } from "@/lib/payuri";
import { fmtMinor } from "@/lib/merchant/money";
import { MOCK_PERIPHERALS } from "@/lib/merchant/mock";
import { NETWORKS } from "@/lib/stellar";
import type { Minor } from "@/lib/merchant/types";
import type { FiatCurrency } from "@/lib/format";
import { useToast } from "../Toast";
import { Spinner } from "../ui";
import { IconAlert, IconLock, IconRefresh } from "../icons";
import { IconBackspace, IconInfo, IconStorefront } from "./icons";

const PIN_LENGTH = 4;

const PIN_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "backspace"] as const;

export function CustomerDisplay({
  open,
  onClose,
  amountMinor,
  currency,
  reference,
}: {
  open: boolean;
  onClose: () => void;
  amountMinor: Minor;
  currency: FiatCurrency;
  /** The memo a payment against this order has to carry. */
  reference: string;
}) {
  if (!open) return null;
  return (
    <CustomerDisplayInner
      onClose={onClose}
      amountMinor={amountMinor}
      currency={currency}
      reference={reference}
    />
  );
}

function CustomerDisplayInner({
  onClose,
  amountMinor,
  currency,
  reference,
}: {
  onClose: () => void;
  amountMinor: Minor;
  currency: FiatCurrency;
  reference: string;
}) {
  const { settings } = useMerchant();
  const { network } = useWallet();
  const { toast } = useToast();

  const [flipped, setFlipped] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [pin, setPin] = useState("");
  const [qr, setQr] = useState<{ uri: string; dataUrl: string } | null>(null);

  const shopName = settings.profile.name || "This shop";
  const destination = settings.receivingPublicKey;
  const displayPeripheral = MOCK_PERIPHERALS.find((p) => p.kind === "display");

  /* A real request, minus the amount: the amount belongs to a held quote. */
  const payUri = useMemo(() => {
    if (!destination) return null;
    return buildSep7PayUri({
      destination,
      memo: reference,
      memoType: "text",
      msg: `${shopName} · ${reference}`,
      networkPassphrase: NETWORKS[network].networkPassphrase,
    });
  }, [destination, network, reference, shopName]);

  useEffect(() => {
    if (!payUri) return;
    let alive = true;
    void (async () => {
      try {
        const dataUrl = await QRCode.toDataURL(payUri, {
          width: 560,
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

  /* Never one request's QR under another request's figure. */
  const qrDataUrl = qr !== null && payUri !== null && qr.uri === payUri ? qr.dataUrl : null;

  const askForPin = useCallback(() => {
    triggerHaptic("selection");
    setPin("");
    setExiting(true);
  }, []);

  /* Escape does not leave the display — it only asks for the PIN, the same as
     the button does. There is no other way out of this screen. */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        askForPin();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [askForPin]);

  /* Four digits and the mock lets go. A real till checks pinDigest here. */
  useEffect(() => {
    if (pin.length < PIN_LENGTH) return;
    const timer = window.setTimeout(() => {
      triggerHaptic("success");
      toast("Staff PIN accepted. Any four digits leave this mock.", "success");
      onClose();
    }, 220);
    return () => window.clearTimeout(timer);
  }, [onClose, pin, toast]);

  function pressPin(key: (typeof PIN_KEYS)[number]) {
    if (key === "") return;
    if (key === "backspace") {
      triggerHaptic("selection");
      setPin((prev) => prev.slice(0, -1));
      return;
    }
    triggerHaptic("selection");
    setPin((prev) => (prev.length >= PIN_LENGTH ? prev : prev + key));
  }

  /**
   * The display claims a customer can reach nothing but this screen, so it has
   * to be true: the wallet is still mounted behind this overlay, and without a
   * trap Tab would walk straight into Send and Settings. Escape is swallowed —
   * the only way out is the staff PIN.
   */
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key !== "Tab" || !rootRef.current) return;
      const focusable = Array.from(
        rootRef.current.querySelectorAll<HTMLElement>(
          'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) {
        event.preventDefault();
        rootRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = overflow;
    };
  }, []);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={`${shopName} customer display`}
      className="fixed inset-0 z-[75] overflow-y-auto overscroll-contain bg-[#0A0A0B] outline-none"
    >
      <div className="flex min-h-full flex-col">
        {/* ---------------- what the customer sees ---------------- */}
        <div
          className={`flex flex-1 flex-col items-center justify-center px-6 py-10 ${
            flipped ? "rotate-180" : ""
          }`}
        >
          <div className="flex items-center gap-2 text-[#30D158]">
            <IconStorefront size={18} />
            <span className="text-[15px] font-semibold tracking-tight text-white">{shopName}</span>
          </div>

          <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
            Amount due
          </p>
          <p className="mono mt-1.5 text-center text-[46px] font-semibold leading-none text-white sm:text-[68px]">
            {fmtMinor(amountMinor, currency)}
          </p>

          <div className="mt-8 rounded-[28px] bg-white p-4 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.95)]">
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrDataUrl}
                alt={`Pay ${shopName}, reference ${reference}`}
                width={260}
                height={260}
                className="h-[220px] w-[220px] rounded-2xl sm:h-[280px] sm:w-[280px]"
              />
            ) : destination ? (
              <div className="flex h-[220px] w-[220px] items-center justify-center text-black sm:h-[280px] sm:w-[280px]">
                <Spinner size={20} />
              </div>
            ) : (
              <div className="flex h-[220px] w-[220px] flex-col items-center justify-center gap-2 px-6 text-center text-black sm:h-[280px] sm:w-[280px]">
                <IconAlert size={22} />
                <p className="text-[13px] font-semibold leading-snug">
                  No receiving account is set for this shop
                </p>
              </div>
            )}
          </div>

          <p className="mono mt-5 text-[20px] font-semibold tracking-wide text-white">{reference}</p>
          <p className="mt-1 max-w-[320px] text-center text-[12.5px] leading-relaxed text-neutral-400">
            Scan with any Stellar wallet. Leave the reference on the payment — it is how the shop
            finds your order.
          </p>
          <p className="mt-4 max-w-[340px] text-center text-[11.5px] leading-relaxed text-neutral-600">
            This request carries the shop, the reference and the network. A charge raised from the
            till adds the exact asset amount at the rate it is held for.
          </p>
        </div>

        {/* ---------------- the two controls that exist ---------------- */}
        <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <IconInfo size={13} className="shrink-0 text-neutral-600" />
            <p className="truncate text-[11.5px] text-neutral-500">
              Customer display · {displayPeripheral?.detail ?? "rotates this screen 180°"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              aria-label="Rotate the display 180 degrees"
              aria-pressed={flipped}
              onClick={() => {
                triggerHaptic("selection");
                setFlipped((prev) => !prev);
              }}
              className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors ${
                flipped ? "bg-[#0A84FF]/20 text-[#0A84FF]" : "bg-white/[0.08] text-neutral-300"
              }`}
            >
              <IconRefresh size={17} />
            </button>
            <button
              type="button"
              onClick={askForPin}
              className="btn btn-secondary btn-sm"
            >
              <IconLock size={14} /> Exit display
            </button>
          </div>
        </div>
      </div>

      {/* ---------------- the PIN ---------------- */}
      {exiting && (
        <div className="fixed inset-0 z-[76] flex items-center justify-center overflow-y-auto bg-black/85 p-4 backdrop-blur-xl">
          <div className="w-full max-w-[340px] py-6">
            <p className="text-center text-[17px] font-semibold text-white">Staff PIN</p>
            <p className="mx-auto mt-1 max-w-[280px] text-center text-[12.5px] leading-relaxed text-neutral-400">
              The display stays up until a staff member unlocks it, so a customer cannot walk the
              till back into the wallet.
            </p>

            <div className="mt-6 flex items-center justify-center gap-3" aria-hidden="true">
              {Array.from({ length: PIN_LENGTH }, (_, index) => (
                <span
                  key={index}
                  className={`h-3.5 w-3.5 rounded-full transition-colors ${
                    index < pin.length ? "bg-white" : "bg-white/[0.14]"
                  }`}
                />
              ))}
            </div>
            <p className="sr-only" role="status">
              {pin.length} of {PIN_LENGTH} digits entered
            </p>

            <div className="mx-auto mt-6 grid max-w-[300px] grid-cols-3 gap-2.5">
              {PIN_KEYS.map((key, index) =>
                key === "" ? (
                  <span key={`gap-${index}`} />
                ) : (
                  <button
                    key={key}
                    type="button"
                    aria-label={key === "backspace" ? "Backspace" : key}
                    onClick={() => pressPin(key)}
                    className="flex min-h-[56px] items-center justify-center rounded-2xl bg-white/[0.08] text-[26px] font-medium leading-none text-white transition-[transform,background-color] duration-150 hover:bg-white/[0.13] active:scale-95"
                  >
                    {key === "backspace" ? <IconBackspace size={22} /> : key}
                  </button>
                ),
              )}
            </div>

            <p className="mt-5 flex items-start gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3.5 py-3 text-[11.5px] leading-relaxed text-neutral-400">
              <IconInfo size={13} className="mt-0.5 shrink-0 text-neutral-500" />
              Mock — any four digits open it. A real till compares the salted digest kept in{" "}
              <span className="mono text-neutral-300">pinDigest</span>, which is stored outside the
              vault so the PIN still works while the wallet is locked.
            </p>

            <p className="mt-2.5 flex items-start gap-2 px-1 text-[11.5px] leading-relaxed text-neutral-500">
              <IconAlert size={13} className="mt-0.5 shrink-0" />
              This mode rotates <em className="not-italic text-neutral-300">this</em> device. Driving
              a second screen at the counter needs a sync channel between two devices, which this
              build does not have.
            </p>

            <button
              type="button"
              onClick={() => {
                triggerHaptic("selection");
                setPin("");
                setExiting(false);
              }}
              className="btn btn-ghost mt-4 w-full"
            >
              Back to the display
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
