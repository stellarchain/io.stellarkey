"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { triggerHaptic } from "@/lib/haptics";
import { useMerchantConfiguration, useMerchantStaff } from "@/hooks/useMerchant";
import { fmtMinor } from "@/lib/merchant/money";
import type { Minor } from "@/lib/merchant/types";
import type { FiatCurrency } from "@/lib/format";
import { useToast } from "../Toast";
import { Spinner } from "../ui";
import { IconAlert, IconLock, IconRefresh } from "../icons";
import { IconBackspace, IconInfo, IconStorefront } from "./icons";

const MAX_PIN_LENGTH = 6;
const MIN_PIN_LENGTH = 4;
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
  const { settings } = useMerchantConfiguration();
  const { unlockCustomerDisplay } = useMerchantStaff();
  const { toast } = useToast();
  const [flipped, setFlipped] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [pin, setPin] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const shopName = settings.profile.name || "This shop";

  const askForPin = useCallback(() => {
    triggerHaptic("selection");
    setPin("");
    setError(null);
    setExiting(true);
  }, []);

  async function unlock() {
    if (pin.length < MIN_PIN_LENGTH || checking) return;
    setChecking(true);
    setError(null);
    try {
      const member = await unlockCustomerDisplay(pin);
      triggerHaptic("success");
      toast(`Display unlocked by ${member.name}`, "success");
      onClose();
    } catch (cause) {
      triggerHaptic("error");
      setPin("");
      setError(cause instanceof Error ? cause.message : "The display could not be unlocked.");
    } finally {
      setChecking(false);
    }
  }

  function pressPin(key: (typeof PIN_KEYS)[number]) {
    if (key === "") return;
    setError(null);
    if (key === "backspace") {
      triggerHaptic("selection");
      setPin((previous) => previous.slice(0, -1));
      return;
    }
    triggerHaptic("selection");
    setPin((previous) => (previous.length >= MAX_PIN_LENGTH ? previous : previous + key));
  }

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    root.focus({ preventScroll: true });
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    function containFocus(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        askForPin();
        return;
      }
      if (event.key !== "Tab" || !rootRef.current) return;
      const focusable = Array.from(
        rootRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
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

    window.addEventListener("keydown", containFocus, true);
    return () => {
      window.removeEventListener("keydown", containFocus, true);
      document.body.style.overflow = overflow;
      restoreFocusRef.current?.focus?.({ preventScroll: true });
    };
  }, [askForPin]);

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
        <div
          className={`flex flex-1 flex-col items-center justify-center px-6 py-10 ${
            flipped ? "rotate-180" : ""
          }`}
        >
          <div className="flex items-center gap-2 text-[#30D158]">
            <IconStorefront size={18} />
            <span className="text-[15px] font-semibold tracking-tight text-white">{shopName}</span>
          </div>
          <p className="mt-10 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
            Amount due
          </p>
          <p className="mono mt-2 text-center text-[52px] font-semibold leading-none text-white sm:text-[76px]">
            {fmtMinor(amountMinor, currency)}
          </p>
          <p className="mono mt-7 text-[18px] font-semibold tracking-wide text-white">{reference}</p>
          <p className="mt-2 max-w-[340px] text-center text-[13px] leading-relaxed text-neutral-400">
            Please hand the device back to a staff member to choose cash, card, or raise an exact
            Stellar payment request.
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-white/[0.08] px-4 py-3">
          <p className="flex min-w-0 items-center gap-2 truncate text-[11.5px] text-neutral-500">
            <IconInfo size={13} className="shrink-0" />
            Same-device display · no external screen is connected
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              aria-label="Rotate the display 180 degrees"
              aria-pressed={flipped}
              onClick={() => {
                triggerHaptic("selection");
                setFlipped((previous) => !previous);
              }}
              className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors ${
                flipped ? "bg-[#0A84FF]/20 text-[#0A84FF]" : "bg-white/[0.08] text-neutral-300"
              }`}
            >
              <IconRefresh size={17} />
            </button>
            <button type="button" onClick={askForPin} className="btn btn-secondary btn-sm">
              <IconLock size={14} /> Exit display
            </button>
          </div>
        </div>
      </div>

      {exiting && (
        <div className="fixed inset-0 z-[76] flex items-center justify-center overflow-y-auto bg-black/85 p-4 backdrop-blur-xl">
          <div className="w-full max-w-[340px] py-6">
            <p className="text-center text-[17px] font-semibold text-white">Staff PIN</p>
            <p className="mx-auto mt-1 max-w-[280px] text-center text-[12.5px] leading-relaxed text-neutral-400">
              Enter the active staff member&rsquo;s 4–6 digit PIN to return to the till.
            </p>

            <div className="mt-6 flex min-h-4 items-center justify-center gap-3" aria-hidden="true">
              {Array.from({ length: MAX_PIN_LENGTH }, (_, index) => (
                <span
                  key={index}
                  className={`h-3.5 w-3.5 rounded-full transition-colors ${
                    index < pin.length ? "bg-white" : "bg-white/[0.14]"
                  }`}
                />
              ))}
            </div>
            <p className="sr-only" role="status">{pin.length} digits entered</p>

            {error && (
              <p role="alert" className="mt-4 flex items-start gap-2 rounded-2xl border border-[#FF453A]/25 bg-[#FF453A]/10 px-3.5 py-3 text-[12px] text-[#FF8A80]">
                <IconAlert size={14} className="mt-0.5 shrink-0" /> {error}
              </p>
            )}

            <div className="mx-auto mt-5 grid max-w-[300px] grid-cols-3 gap-2.5">
              {PIN_KEYS.map((key, index) =>
                key === "" ? (
                  <span key={`gap-${index}`} />
                ) : (
                  <button
                    key={key}
                    type="button"
                    aria-label={key === "backspace" ? "Backspace" : key}
                    onClick={() => pressPin(key)}
                    disabled={checking}
                    className="flex min-h-[56px] items-center justify-center rounded-2xl bg-white/[0.08] text-[26px] font-medium leading-none text-white transition-[transform,background-color] hover:bg-white/[0.13] active:scale-95 disabled:opacity-50"
                  >
                    {key === "backspace" ? <IconBackspace size={22} /> : key}
                  </button>
                ),
              )}
            </div>

            <button
              type="button"
              onClick={() => void unlock()}
              disabled={pin.length < MIN_PIN_LENGTH || checking}
              className="btn btn-primary mt-4 w-full"
            >
              {checking && <Spinner size={14} />} Unlock till
            </button>
            <button
              type="button"
              onClick={() => {
                setPin("");
                setError(null);
                setExiting(false);
              }}
              disabled={checking}
              className="btn btn-ghost mt-2 w-full"
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
