"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SectionHeader } from "@/components/ui";
import { triggerHaptic } from "@/lib/haptics";
import { useMerchantConfiguration, useMerchantStaff } from "@/hooks/useMerchant";
import { fmtMinor } from "@/lib/merchant/money";
import type { Minor } from "@/lib/merchant/types";
import type { FiatCurrency } from "@/lib/format";
import { useToast } from "../Toast";
import { AlertContent, Button, Modal, ModalFooter, useBodyScrollLock } from "../ui";
import { IconAlert, IconLock, IconRefresh } from "../icons";
import { IconBackspace, IconInfo, IconReceiptStellar } from "./icons";

const MAX_PIN_LENGTH = 6;
const MIN_PIN_LENGTH = 4;
const PIN_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "backspace"] as const;

/**
 * The screen turned to the customer: a full-screen takeover that is never
 * dismissed by a gesture. The only way back to the till is a staff PIN, so
 * Escape and the exit control both open that step rather than closing it.
 */
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
  return (
    <Modal
      open={open}
      onClose={onClose}
      presentation="fullscreen"
      dismissable={false}
      ariaLabel="Customer display"
    >
      <CustomerDisplayInner
        onClose={onClose}
        amountMinor={amountMinor}
        currency={currency}
        reference={reference}
      />
    </Modal>
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
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const shopName = settings.profile.name || "This shop";

  const askForPin = useCallback(() => {
    setPin("");
    setError(null);
    setExiting(true);
  }, []);

  function backToDisplay() {
    setPin("");
    setError(null);
    setExiting(false);
  }

  async function unlock() {
    if (pin.length < MIN_PIN_LENGTH || checking) return;
    setChecking(true);
    setError(null);
    try {
      const member = await unlockCustomerDisplay(pin);
      triggerHaptic("success");
      toast(`Display unlocked by ${member.name}`, "success", { silent: true });
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

  // The shell locks scroll and traps focus; this keeps the page still for as
  // long as the display is up and hands focus back to the till control that
  // opened it once the takeover ends.
  useBodyScrollLock(true);

  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    return () => {
      restoreFocusRef.current?.focus?.({ preventScroll: true });
    };
  }, []);

  /* Escape never closes the display outright: it asks for the PIN instead. The
     PIN alert is its own dialog above this one, so Escape there is left to it. */
  useEffect(() => {
    if (exiting) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      askForPin();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [askForPin, exiting]);

  return (
    <div className="flex min-h-full flex-col pb-[env(safe-area-inset-bottom)] pt-[var(--app-safe-area-top)]">
      <div
        className={`flex flex-1 flex-col items-center justify-center px-6 py-10 transition-transform ${
          flipped ? "rotate-180" : ""
        }`}
      >
        <div className="flex items-center gap-2 text-[#30D158]">
          <IconReceiptStellar size={18} />
          <span className="text-[15px] font-semibold tracking-tight text-white">{shopName}</span>
        </div>
        <SectionHeader className="mt-10">Amount due</SectionHeader>
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
            onClick={() => setFlipped((previous) => !previous)}
            className={`flex h-11 w-11 items-center justify-center rounded-full transition-colors ${
              flipped ? "bg-[#0A84FF]/20 text-[#0A84FF]" : "bg-white/[0.08] text-neutral-300"
            }`}
          >
            <IconRefresh size={17} />
          </button>
          <Button variant="secondary" onClick={askForPin}>
            <IconLock size={14} /> Exit display
          </Button>
        </div>
      </div>

      <Modal
        open={exiting}
        onClose={backToDisplay}
        presentation="alert"
        busy={checking}
        busyReason="Wait for the PIN to be checked."
      >
        <AlertContent
          title="Staff PIN"
          message="Enter the active staff member’s 4–6 digit PIN to return to the till."
          actions={
            <ModalFooter
              stack
              primary={
                <Button
                  loading={checking}
                  loadingLabel="Checking the PIN"
                  disabled={pin.length < MIN_PIN_LENGTH}
                  onClick={() => void unlock()}
                >
                  Unlock till
                </Button>
              }
              secondary={
                <Button variant="ghost" disabled={checking} onClick={backToDisplay}>
                  Back to the Display
                </Button>
              }
            />
          }
        >
          <div className="flex min-h-4 items-center justify-center gap-3" aria-hidden="true">
            {Array.from({ length: MAX_PIN_LENGTH }, (_, index) => (
              <span
                key={index}
                className={`h-3.5 w-3.5 rounded-full transition-colors ${
                  index < pin.length ? "bg-[var(--color-oncolor)]" : "bg-white/[0.14]"
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

          <div className="mx-auto mt-4 grid grid-cols-3 gap-2">
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
                  className="flex min-h-[56px] items-center justify-center rounded-2xl bg-white/[0.08] text-[26px] font-medium leading-none text-[var(--color-oncolor)] transition-[transform,background-color] hover:bg-white/[0.13] active:scale-95 disabled:opacity-50"
                >
                  {key === "backspace" ? <IconBackspace size={22} /> : key}
                </button>
              ),
            )}
          </div>
        </AlertContent>
      </Modal>
    </div>
  );
}
