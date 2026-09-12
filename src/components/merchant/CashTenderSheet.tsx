"use client";

import { useMemo, useRef, useState } from "react";
import { SectionHeader } from "@/components/ui";
import { triggerHaptic } from "@/lib/haptics";
import {
  useMerchantStaff,
  useMerchantTill,
  useMerchantStatus,
  type MerchantTenderOutcome,
} from "@/hooks/useMerchant";
import { fmtMinor, minorToDecimal, toMinor } from "@/lib/merchant/money";
import type { Minor } from "@/lib/merchant/types";
import type { FiatCurrency } from "@/lib/format";
import { useToast } from "../Toast";
import {
  Button,
  ErrorText,
  Field,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Notice,
  SegmentedControl,
} from "../ui";
import { IconAlert, IconCheck } from "../icons";
import { IconBackspace, IconInfo, IconQr, IconTerminal } from "./icons";

/** 999,999.99 — the same till ceiling the keypad uses. */
const MAX_TENDER_MINOR = 99_999_999;

const KEYPAD_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "backspace"] as const;

type TenderChoice = "cash" | "card" | "split";

type LegKind = "cash" | "card" | "crypto";

const LEG_LABEL: Record<LegKind, string> = {
  cash: "Cash",
  card: "Card elsewhere",
  crypto: "Stellar charge",
};

/**
 * The notes a customer actually hands over: the next round figure above the
 * total at each denomination, largest first, deduplicated.
 */
function quickTenders(totalMinor: Minor): Minor[] {
  const steps = [100, 500, 1000, 2000, 5000, 10000];
  const out: Minor[] = [];
  for (const step of steps) {
    const up = Math.ceil(totalMinor / step) * step;
    if (up > totalMinor && !out.includes(up)) out.push(up);
  }
  return out.slice(0, 3);
}

/** A typed figure, or null while it is still nonsense. */
function parseAmount(raw: string): Minor | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const minor = toMinor(trimmed);
    return minor >= 0 && minor <= MAX_TENDER_MINOR ? minor : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Keypad                                                              */
/* ------------------------------------------------------------------ */

/**
 * The cent accumulator, kept local to this sheet: the till's own keypad lives
 * in PosTerminal, and importing it back would close an import cycle.
 */
function TenderKeypad({
  minor,
  currency,
  onChange,
}: {
  minor: Minor;
  currency: FiatCurrency;
  onChange: (next: Minor) => void;
}) {
  function press(key: (typeof KEYPAD_KEYS)[number]) {
    if (key === "backspace") {
      triggerHaptic("selection");
      onChange(Math.floor(minor / 10));
      return;
    }
    const next = key === "00" ? minor * 100 : minor * 10 + Number(key);
    if (next > MAX_TENDER_MINOR) {
      triggerHaptic("warning");
      return;
    }
    triggerHaptic("selection");
    onChange(next);
  }

  return (
    <div>
      <SectionHeader className="pb-2 text-center">Received · {fmtMinor(minor, currency)}</SectionHeader>
      <div className="mx-auto grid w-full max-w-[420px] grid-cols-3 gap-2">
        {KEYPAD_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => press(key)}
            aria-label={key === "backspace" ? "Backspace" : key}
            className="flex min-h-[52px] items-center justify-center rounded-2xl bg-white/[0.08] text-[26px] font-medium leading-none text-[var(--color-oncolor)] transition-[transform,background-color] hover:bg-white/[0.13] active:scale-95"
          >
            {key === "backspace" ? <IconBackspace size={24} /> : key}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The sheet                                                           */
/* ------------------------------------------------------------------ */

export function CashTenderSheet({
  open,
  onClose,
  totalMinor,
  currency,
  onSettled,
}: {
  open: boolean;
  onClose: () => void;
  totalMinor: Minor;
  currency: FiatCurrency;
  onSettled: (outcome: MerchantTenderOutcome) => void;
}) {
  const [pending, setPending] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={pending}
      busyReason="Wait for the tender to be saved before closing."
    >
      <CashTenderSheetInner
        onClose={onClose}
        totalMinor={totalMinor}
        currency={currency}
        onSettled={onSettled}
        pending={pending}
        onPendingChange={setPending}
      />
    </Modal>
  );
}

function CashTenderSheetInner({
  onClose,
  totalMinor,
  currency,
  onSettled,
  pending,
  onPendingChange,
}: {
  onClose: () => void;
  totalMinor: Minor;
  currency: FiatCurrency;
  onSettled: (outcome: MerchantTenderOutcome) => void;
  pending: boolean;
  onPendingChange: (pending: boolean) => void;
}) {
  const { toast } = useToast();
  const { activeStaff, terminal } = useMerchantStaff();
  const { settleCash, settleCard, startSplitCharge } = useMerchantTill();
  const { marketPriceStatus, retryMarketPrices } = useMerchantStatus();

  const [choice, setChoice] = useState<TenderChoice>("cash");
  const [receivedMinor, setReceivedMinor] = useState<Minor>(0);
  const [cardReference, setCardReference] = useState("");
  const [firstLeg, setFirstLeg] = useState<LegKind>("cash");
  const [secondLeg, setSecondLeg] = useState<LegKind>("crypto");
  const [firstRaw, setFirstRaw] = useState("");
  const [splitError, setSplitError] = useState("");
  const [pricesRefreshing, setPricesRefreshing] = useState(false);
  const priceRetryPending = useRef(false);

  async function retryPrices() {
    if (priceRetryPending.current) return;
    priceRetryPending.current = true;
    setPricesRefreshing(true);
    try {
      await retryMarketPrices();
    } finally {
      priceRetryPending.current = false;
      setPricesRefreshing(false);
    }
  }

  const quick = useMemo(() => quickTenders(totalMinor), [totalMinor]);

  /* ---- cash ---- */
  const changeMinor = receivedMinor - totalMinor;
  const cashShort = receivedMinor > 0 && changeMinor < 0;
  const cashReady = receivedMinor >= totalMinor && totalMinor > 0;

  /* ---- split ---- */
  const firstMinor = parseAmount(firstRaw);
  const firstValid = firstMinor !== null && firstMinor > 0 && firstMinor < totalMinor;
  const remainingMinor = firstValid ? totalMinor - firstMinor : totalMinor;
  const splitReady = firstValid && firstLeg !== secondLeg;

  function finish(outcome: MerchantTenderOutcome, detail: string, kind: "success" | "info") {
    triggerHaptic(kind === "success" ? "success" : "light");
    toast(detail, kind === "success" ? "success" : "info", { silent: true });
    onSettled(outcome);
    onClose();
  }

  function fail(error: unknown) {
    triggerHaptic("error");
    toast(error instanceof Error ? error.message : "This tender could not be saved.", "error", {
      silent: true,
    });
  }

  /** One tender at a time: the sheet is busy until the record is written. */
  async function settle(task: () => Promise<void>) {
    if (pending) return;
    onPendingChange(true);
    try {
      await task();
    } finally {
      onPendingChange(false);
    }
  }

  async function takeCash() {
    await settle(async () => {
      try {
        const order = await settleCash(receivedMinor);
        finish(
          { order, charge: null },
          changeMinor > 0
            ? `Cash saved. Return ${fmtMinor(changeMinor, currency)} change.`
            : "Cash saved as exact money.",
          "success",
        );
      } catch (error) {
        fail(error);
      }
    });
  }

  async function takeCard() {
    await settle(async () => {
      try {
        const order = await settleCard(cardReference);
        finish(
          { order, charge: null },
          `Card sale saved${cardReference.trim() ? ` · ${cardReference.trim()}` : ""}.`,
          "success",
        );
      } catch (error) {
        fail(error);
      }
    });
  }

  async function takeSplit() {
    if (firstMinor === null) return;
    setSplitError("");
    await settle(async () => {
      try {
        const outcome = await startSplitCharge({
          firstKind: firstLeg,
          secondKind: secondLeg,
          firstMinor,
          cardReference,
        });
        finish(
          outcome,
          outcome.charge
            ? `${LEG_LABEL[firstLeg]} saved. Stellar charge ready for ${fmtMinor(outcome.charge.amountMinor, currency)}.`
            : `Split sale saved: ${LEG_LABEL[firstLeg]} + ${LEG_LABEL[secondLeg]}.`,
          "success",
        );
      } catch (error) {
        setSplitError(error instanceof Error ? error.message : "This split could not be saved.");
        fail(error);
      }
    });
  }

  const cardReferenceField = (
    <Field label="Terminal Receipt Number" hint="Optional — ties the two records together">
      <input
        type="text"
        value={cardReference}
        onChange={(event) => setCardReference(event.target.value)}
        placeholder="e.g. 004913"
        enterKeyHint="done"
        autoCapitalize="characters"
        className="input mono text-base sm:text-[13px]"
      />
    </Field>
  );

  const primary =
    choice === "cash" ? (
      <Button type="button" disabled={!cashReady} loading={pending} onClick={takeCash}>
        {changeMinor > 0
          ? `Take cash · ${fmtMinor(changeMinor, currency)} change`
          : `Take ${fmtMinor(totalMinor, currency)} cash`}
      </Button>
    ) : choice === "card" ? (
      <Button type="button" loading={pending} onClick={takeCard}>
        Ring up {fmtMinor(totalMinor, currency)} as card
      </Button>
    ) : (
      <Button type="button" disabled={!splitReady} loading={pending} onClick={takeSplit}>
        Record Split
      </Button>
    );

  return (
    <>
      <ModalHeader
        title="Other Tender"
        subtitle={`${fmtMinor(totalMinor, currency)} to settle`}
        onClose={onClose}
      />

      <ModalBody>
        <SegmentedControl<TenderChoice>
          ariaLabel="How this order is paid"
          value={choice}
          onChange={setChoice}
          options={[
            { label: "Cash", value: "cash" },
            { label: "Card elsewhere", value: "card" },
            { label: "Split", value: "split" },
          ]}
        />

        {/* ---------------- cash ---------------- */}
        {choice === "cash" && (
          <div className="space-y-4">
            <div className="panel-inset px-4 py-3.5 text-center">
              <SectionHeader>{cashShort ? "Still owed" : "Change due"}</SectionHeader>
              <p
                className="mono mt-1 text-[34px] font-semibold leading-none"
                style={{ color: cashShort ? "#FF9F0A" : "#ffffff" }}
              >
                {fmtMinor(Math.abs(changeMinor), currency)}
              </p>
              <p className="mt-1.5 flex items-center justify-center gap-1.5 text-[12px] text-neutral-400">
                {cashShort ? (
                  <IconAlert size={12} className="text-[#FF9F0A]" />
                ) : receivedMinor > 0 ? (
                  <IconCheck size={12} className="text-[#30D158]" />
                ) : (
                  <IconInfo size={12} className="text-neutral-500" />
                )}
                {receivedMinor === 0
                  ? "Tap what the customer handed over"
                  : cashShort
                    ? `${fmtMinor(receivedMinor, currency)} received against ${fmtMinor(totalMinor, currency)}`
                    : `${fmtMinor(receivedMinor, currency)} received`}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <button
                type="button"
                aria-pressed={receivedMinor === totalMinor}
                onClick={() => setReceivedMinor(totalMinor)}
                className={`min-h-[52px] rounded-2xl px-2 text-[13.5px] font-semibold transition-colors ${
                  receivedMinor === totalMinor
                    ? "bg-[#0A84FF]/20 text-[#0A84FF]"
                    : "bg-white/[0.08] text-white hover:bg-white/[0.13]"
                }`}
              >
                <SectionHeader as="span" className="block">Exact</SectionHeader>
                <span className="mono">{minorToDecimal(totalMinor)}</span>
              </button>
              {quick.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  aria-pressed={receivedMinor === amount}
                  onClick={() => setReceivedMinor(amount)}
                  className={`mono min-h-[52px] rounded-2xl px-2 text-[15.5px] font-semibold transition-colors ${
                    receivedMinor === amount
                      ? "bg-[#0A84FF]/20 text-[#0A84FF]"
                      : "bg-white/[0.08] text-white hover:bg-white/[0.13]"
                  }`}
                >
                  {minorToDecimal(amount)}
                </button>
              ))}
            </div>

            <TenderKeypad minor={receivedMinor} currency={currency} onChange={setReceivedMinor} />
          </div>
        )}

        {/* ---------------- card taken elsewhere ---------------- */}
        {choice === "card" && (
          <div className="space-y-4">
            <Notice>
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 shrink-0 text-neutral-400">
                  <IconTerminal size={15} />
                </span>
                <div>
                  <p className="font-semibold text-white">Recorded, never processed</p>
                  <p className="mt-1 text-neutral-300">
                    The card is taken on your bank&rsquo;s terminal. This rings the sale up here so
                    the day&rsquo;s takings, the VAT and the stock all balance — no card number
                    reaches this wallet, and no money moves through it.
                  </p>
                </div>
              </div>
            </Notice>

            <div className="panel-inset px-4 py-3.5">
              <div className="flex items-baseline justify-between">
                <span className="text-[13.5px] text-neutral-400">Rung up as card</span>
                <span className="mono text-[20px] font-semibold text-white">
                  {fmtMinor(totalMinor, currency)}
                </span>
              </div>
            </div>

            {cardReferenceField}
          </div>
        )}

        {/* ---------------- split ---------------- */}
        {choice === "split" && (
          <div className="space-y-4">
            <div className="panel-inset px-4 py-3.5 text-center">
              <SectionHeader>Still to cover</SectionHeader>
              <p className="mono mt-1 text-[34px] font-semibold leading-none text-white">
                {fmtMinor(remainingMinor, currency)}
              </p>
              <p className="mt-1.5 text-[12px] text-neutral-400">
                of {fmtMinor(totalMinor, currency)}
              </p>
            </div>

            <section className="list-group">
              <div className="px-4 pb-2 pt-3">
                <p className="text-[13.5px] font-semibold text-white">First part</p>
              </div>
              <div className="space-y-3 px-4 pb-4">
                <SegmentedControl<LegKind>
                  ariaLabel="First payment method"
                  value={firstLeg}
                  onChange={(next) => {
                    setFirstLeg(next);
                    if (next === secondLeg) {
                      setSecondLeg(next === "crypto" ? "cash" : "crypto");
                    }
                  }}
                  options={[
                    { label: "Cash", value: "cash" },
                    { label: "Card", value: "card" },
                    { label: "Stellar", value: "crypto" },
                  ]}
                />
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    enterKeyHint={firstLeg === "card" || secondLeg === "card" ? "next" : "done"}
                    value={firstRaw}
                    onChange={(e) => setFirstRaw(e.target.value)}
                    placeholder={minorToDecimal(Math.floor(totalMinor / 2))}
                    aria-label="First part amount"
                    aria-invalid={firstRaw.trim() !== "" && !firstValid}
                    className="input mono text-base sm:text-[15px]"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="shrink-0"
                    onClick={() => setFirstRaw(minorToDecimal(Math.floor(totalMinor / 2)))}
                  >
                    Half
                  </Button>
                </div>
                {firstRaw.trim() !== "" && !firstValid && (
                  <p className="text-[12px] text-[#FF9F0A]">
                    A first part has to be more than nothing and less than{" "}
                    {fmtMinor(totalMinor, currency)} — otherwise it is not a split.
                  </p>
                )}
              </div>
            </section>

            <section className="list-group">
              <div className="flex items-baseline justify-between px-4 pb-2 pt-3">
                <p className="text-[13.5px] font-semibold text-white">Second part</p>
                <p className="mono text-[15.5px] font-semibold text-white">
                  {fmtMinor(remainingMinor, currency)}
                </p>
              </div>
              <div className="space-y-2 px-4 pb-4">
                <SegmentedControl<LegKind>
                  ariaLabel="Second payment method"
                  value={secondLeg}
                  onChange={(next) => {
                    setSecondLeg(next);
                    if (next === firstLeg) {
                      setFirstLeg(next === "crypto" ? "cash" : "crypto");
                    }
                  }}
                  options={[
                    { label: "Cash", value: "cash" },
                    { label: "Card", value: "card" },
                    { label: "Stellar", value: "crypto" },
                  ]}
                />
                {secondLeg === "crypto" && (
                  <p className="flex items-start gap-2 text-[12px] leading-relaxed text-neutral-400">
                    <IconQr size={13} className="mt-0.5 shrink-0 text-[#0A84FF]" />
                    A charge for {fmtMinor(remainingMinor, currency)} will be raised against this
                    order&rsquo;s reference, ready for the customer to scan.
                  </p>
                )}
              </div>
            </section>

            {(firstLeg === "card" || secondLeg === "card") && cardReferenceField}

            <ErrorText message={splitError} />
            {splitError.startsWith("No live price") && (
              <div className="space-y-2">
                <p className="text-xs text-neutral-400">{marketPriceStatus}</p>
                <Button variant="secondary" loading={pricesRefreshing} disabled={pricesRefreshing} onClick={retryPrices}>Retry Prices</Button>
              </div>
            )}
          </div>
        )}

        <ModalFooter primary={primary} />

        <p className="border-t border-white/[0.08] pt-3 text-center text-[11.5px] leading-relaxed text-neutral-500">
          {activeStaff
            ? `Attributed to ${activeStaff.name} on ${terminal.name}.`
            : "Choose a staff member before settling this sale."} The app records card payments
          but never handles card data.
        </p>
      </ModalBody>
    </>
  );
}
