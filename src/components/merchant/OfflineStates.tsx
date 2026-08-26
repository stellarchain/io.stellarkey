"use client";

/**
 * MOCK — the five states Merchant Mode falls into when the network, the ledger
 * or the vault is not there, exported as drop-in fragments plus a gallery that
 * puts them side by side for review.
 *
 * What is mocked: the conditions. Nothing here listens to `navigator.onLine`,
 * polls Horizon, inspects the vault or counts a real queue — each fragment takes
 * its figures as props, and the defaults come from `mock.ts` fixtures so a bare
 * `<OfflineBanner />` still renders something true to the shop. The buttons flip
 * local state and toast what a wired build would do.
 *
 * Why these states are short: nothing is waiting on a service. A charge is drawn
 * on this device and paid to the shop's own account, so an offline till is one
 * fact behind the ledger rather than cut off from an operator — the queue is
 * rows in this device's own storage, and each one settles itself the moment
 * Horizon can be read again. There is nothing to resend and nobody to call.
 *
 * What a real implementation replaces: the props. `queuedCount` comes from the
 * charges this device has not yet confirmed, `reconciled` / `unmatched` from the
 * sweep that runs when the watcher reconnects, `ceilingMinor` from a merchant
 * setting, and the fragments get mounted by whatever already knows the
 * condition — the charge sheet, the till, the orders ledger, the shift banner.
 * `HorizonOutageNotice` is the shareable twin of the inline block ChargeSheet
 * already renders from `watchError`; that one is wired, this one is the piece
 * every other surface can reuse.
 */

import { createContext, useContext, useState } from "react";
import type { FiatCurrency } from "@/lib/format";
import { triggerHaptic } from "@/lib/haptics";
import { MOCK_SHIFT, MOCK_TERMINAL } from "@/lib/merchant/mock";
import { fmtMinor } from "@/lib/merchant/money";
import type { Minor } from "@/lib/merchant/types";
import { useToast } from "../Toast";
import { IOSBackButton, Spinner } from "../ui";
import { IconAlert, IconCheck, IconLock, IconRefresh } from "../icons";
import { IconClock, IconInfo, IconQr, IconReceipt, IconXCircle } from "./icons";
import { MerchantDisclosure } from "./Disclosure";

/** Said once, then reused by the chip and the disclosure beside it. */

/**
 * On the gallery these fragments are specimens, not conditions the shop is in.
 * A specimen must not announce itself as a live region — five of them would talk
 * over each other the moment the page loaded — so the gallery switches the role
 * off and the real mount points keep it.
 */
const SpecimenContext = createContext(false);

/* ------------------------------------------------------------------ */
/* Figures                                                             */
/* ------------------------------------------------------------------ */

/**
 * Charges this device is holding unconfirmed, and the only queue there is: the
 * rows live in this app's own storage, not in a service holding them for the
 * shop. A real mount passes the count its store actually carries.
 */
const QUEUED_ON_THIS_DEVICE = MOCK_TERMINAL.queuedCharges;

/**
 * The offline ceiling is a merchant setting and `mock.ts` has no fixture for it,
 * so the default is the shift float: the one figure in the fixtures a shop has
 * already decided it is willing to be out of pocket for. A real screen passes
 * the setting instead.
 */
const CEILING_IN_FIXTURES: Minor = MOCK_SHIFT.floatMinor;

/** The average ticket on the open shift, used as the example charge. */
const EXAMPLE_TICKET: Minor = Math.round(MOCK_SHIFT.grossMinor / MOCK_SHIFT.orderCount);

const DEFAULT_CURRENCY: FiatCurrency = "EUR";

/* ------------------------------------------------------------------ */
/* Shared chrome                                                       */
/* ------------------------------------------------------------------ */

type Tone = "warn" | "pos" | "indigo";

const TONE: Record<Tone, { ink: string; ring: string; wash: string }> = {
  warn: { ink: "#FF9F0A", ring: "ring-[#FF9F0A]/30", wash: "bg-[#FF9F0A]/[0.07]" },
  pos: { ink: "#30D158", ring: "ring-[#30D158]/30", wash: "bg-[#30D158]/[0.07]" },
  indigo: { ink: "#5E5CE6", ring: "ring-[#5E5CE6]/35", wash: "bg-[#5E5CE6]/[0.09]" },
};

/** The shell every state below shares: tinted card, glyph, headline, body. */
function StateCard({
  tone,
  icon,
  title,
  children,
  className = "",
}: {
  tone: Tone;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  const { ink, ring, wash } = TONE[tone];
  const specimen = useContext(SpecimenContext);
  return (
    <div
      role={specimen ? undefined : "status"}
      className={`panel ring-1 ring-inset ${ring} ${className}`}
    >
      <div className={`${wash} px-4 py-3.5`}>
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px]"
            style={{ backgroundColor: `${ink}26`, color: ink }}
          >
            {icon}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold leading-tight text-white">{title}</p>
            <div className="mt-1 text-[12.5px] leading-relaxed text-neutral-400">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="btn btn-secondary btn-sm"
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* 1 — the offline banner                                              */
/* ------------------------------------------------------------------ */

/**
 * Sits above the till while the device has no connection. The point it has to
 * make in one line: the sale is not blocked, only the confirmation is.
 */
export function OfflineBanner({
  queuedCount = QUEUED_ON_THIS_DEVICE,
  onRetry,
  className = "",
}: {
  queuedCount?: number;
  onRetry?: () => void;
  className?: string;
}) {
  const { toast } = useToast();
  const [checking, setChecking] = useState(false);

  function check() {
    triggerHaptic("selection");
    setChecking(true);
    if (onRetry) onRetry();
    else toast("Would reopen the stream and sweep the queue");
    window.setTimeout(() => setChecking(false), 900);
  }

  return (
    <StateCard tone="warn" icon={<IconAlert size={17} />} title="Offline — charges still work" className={className}>
      <p>
        The QR is built on this device and the money goes straight to the shop&rsquo;s account: a
        customer can scan and pay as always. Only this till&rsquo;s view of it waits.
        {queuedCount > 0 && (
          <>
            {" "}
            <span className="text-[#FF9F0A]">
              {queuedCount} {queuedCount === 1 ? "charge is" : "charges are"} queued on this device.
            </span>
          </>
        )}
      </p>
      <div className="mt-2.5">
        <ActionButton onClick={check}>
          {checking ? <Spinner size={13} /> : <IconRefresh size={13} />}
          {checking ? "Checking…" : "Check the connection"}
        </ActionButton>
      </div>
    </StateCard>
  );
}

/* ------------------------------------------------------------------ */
/* 2 — Unconfirmed                                                     */
/* ------------------------------------------------------------------ */

/**
 * The third state, between awaiting and paid. A pill, so a row can carry it the
 * way `OrderStatusPill` carries the rest — glyph and word, never colour alone.
 */
export function UnconfirmedPill() {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#FF9F0A]/15 px-2 py-[3px] text-[11px] font-semibold text-[#FF9F0A]">
      <IconAlert size={10} />
      Unconfirmed
    </span>
  );
}

/**
 * The full state: what the customer showed, what the shop cannot yet see, and
 * the ceiling the shop set for exactly this moment.
 */
export function UnconfirmedCharge({
  amountMinor = EXAMPLE_TICKET,
  ceilingMinor = CEILING_IN_FIXTURES,
  queuedCount = QUEUED_ON_THIS_DEVICE,
  currency = DEFAULT_CURRENCY,
  className = "",
}: {
  amountMinor?: Minor;
  ceilingMinor?: Minor;
  queuedCount?: number;
  currency?: FiatCurrency;
  className?: string;
}) {
  const { toast } = useToast();
  const specimen = useContext(SpecimenContext);
  const [taken, setTaken] = useState(false);
  const withinCeiling = amountMinor <= ceilingMinor;
  const share = ceilingMinor > 0 ? Math.min(100, (amountMinor / ceilingMinor) * 100) : 100;

  return (
    <div
      role={specimen ? undefined : "status"}
      className={`panel ring-1 ring-inset ring-[#FF9F0A]/30 ${className}`}
    >
      <div className="bg-[#FF9F0A]/[0.07] px-4 py-3.5">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] bg-[#FF9F0A]/15 text-[#FF9F0A]"
          >
            <IconQr size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <span className="mono text-[17px] font-semibold text-white">
                {fmtMinor(amountMinor, currency)}
              </span>
              <UnconfirmedPill />
            </div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-neutral-400">
              The wallet says it sent; this device cannot yet read the ledger to see it close. The
              order stays open here until it can.
            </p>
          </div>
        </div>

        {/* ---- the ceiling ---- */}
        <div className="mt-3 rounded-[14px] border border-white/[0.10] px-3.5 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
              Offline ceiling
            </p>
            <p className="mono text-[13px] font-semibold text-white">
              {fmtMinor(ceilingMinor, currency)}
            </p>
          </div>
          <div
            aria-hidden="true"
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.10]"
          >
            <span
              className="block h-full rounded-full"
              style={{
                width: `${share}%`,
                backgroundColor: withinCeiling ? "#FF9F0A" : "#FF453A",
              }}
            />
          </div>
          <p
            className={`mt-2 flex items-start gap-1.5 text-[12px] leading-relaxed ${
              withinCeiling ? "text-neutral-400" : "text-[#FF453A]"
            }`}
          >
            {withinCeiling ? (
              <IconInfo size={13} className="mt-[2px] shrink-0" />
            ) : (
              <IconXCircle size={13} className="mt-[2px] shrink-0" />
            )}
            <span>
              {withinCeiling
                ? `Inside the ceiling: hand it over and settle when the ledger answers. Above ${fmtMinor(ceilingMinor, currency)}, the customer waits.`
                : `Over the ceiling: ask the customer to wait, or take it another way. Unconfirmed, this size is the shop's risk.`}
            </span>
          </p>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          {taken ? (
            <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[#30D158]">
              <IconCheck size={13} /> Handed over on trust
            </span>
          ) : (
            <ActionButton
              onClick={() => {
                if (!withinCeiling) {
                  triggerHaptic("warning");
                  toast("Over the ceiling — this one waits for the ledger", "error");
                  return;
                }
                triggerHaptic("success");
                setTaken(true);
                toast("Would mark it handed over and keep watching");
              }}
            >
              Hand it over on trust
            </ActionButton>
          )}
          <span className="text-[12px] text-neutral-500">
            {queuedCount} queued on this device
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 3 — the reconnect sweep                                             */
/* ------------------------------------------------------------------ */

/**
 * What the till says the moment it gets its connection back. The unmatched
 * figure is the one that matters: it is the only part of the queue a human has
 * to look at.
 */
export function ReconnectSweep({
  reconciled = QUEUED_ON_THIS_DEVICE,
  unmatched = 1,
  onReview,
  className = "",
}: {
  /** Queued charges the matcher could file against an order on its own. */
  reconciled?: number;
  /** Payments that reached the till belonging to no charge — the only human work. */
  unmatched?: number;
  onReview?: () => void;
  className?: string;
}) {
  const { toast } = useToast();

  return (
    <StateCard
      tone={unmatched > 0 ? "warn" : "pos"}
      icon={unmatched > 0 ? <IconRefresh size={17} /> : <IconCheck size={17} />}
      title="Back online — queue swept"
      className={className}
    >
      <p>
        <span className="font-semibold text-[#30D158]">
          {reconciled} queued {reconciled === 1 ? "charge" : "charges"} reconciled
        </span>
        {unmatched > 0 ? (
          <>
            ,{" "}
            <span className="font-semibold text-[#FF9F0A]">
              {unmatched} still unmatched
            </span>
            . A payment with no memo the rules trust waits in the tray.
          </>
        ) : (
          ". Every one carried a memo the rules could file it against."
        )}
      </p>

      <dl className="mt-2.5 divide-y divide-white/[0.08] rounded-[14px] border border-white/[0.10]">
        <div className="flex items-center justify-between gap-3 px-3.5 py-2">
          <dt className="flex items-center gap-2 text-[12.5px] text-neutral-300">
            <IconCheck size={13} className="text-[#30D158]" /> Filed against an order
          </dt>
          <dd className="mono text-[13px] font-semibold text-white">{reconciled}</dd>
        </div>
        <div className="flex items-center justify-between gap-3 px-3.5 py-2">
          <dt className="flex items-center gap-2 text-[12.5px] text-neutral-300">
            <IconAlert size={13} className="text-[#FF9F0A]" /> Payments needing a human
          </dt>
          <dd className="mono text-[13px] font-semibold text-white">{unmatched}</dd>
        </div>
      </dl>

      {unmatched > 0 && (
        <div className="mt-2.5">
          <ActionButton
            onClick={() => {
              triggerHaptic("selection");
              if (onReview) onReview();
              else toast("Would open Orders on the unmatched tray");
            }}
          >
            <IconReceipt size={13} /> Review in Orders
          </ActionButton>
        </div>
      )}
    </StateCard>
  );
}

/* ------------------------------------------------------------------ */
/* 4 — vault locked mid-shift                                          */
/* ------------------------------------------------------------------ */

/**
 * The auto-lock fired while the shop was open. Almost nothing stops: receiving
 * needs no key. Paying money back does.
 */
export function VaultLockedNotice({
  onUnlock,
  className = "",
}: {
  onUnlock?: () => void;
  className?: string;
}) {
  const { toast } = useToast();
  return (
    <StateCard tone="indigo" icon={<IconLock size={17} />} title="Vault locked — the till is still open" className={className}>
      <p>
        A charge is addressed to your public key, so taking money needs no signature.
      </p>
      <ul className="mt-2 space-y-1.5">
        <li className="flex items-start gap-2">
          <IconCheck size={13} className="mt-[2px] shrink-0 text-[#30D158]" />
          <span>Ring up, charge, watch it settle, print — all unaffected.</span>
        </li>
        <li className="flex items-start gap-2">
          <IconLock size={13} className="mt-[2px] shrink-0 text-[#5E5CE6]" />
          <span>A refund is an outbound payment, so it must be signed.</span>
        </li>
      </ul>
      <div className="mt-2.5">
        <ActionButton
          onClick={() => {
            triggerHaptic("selection");
            if (onUnlock) onUnlock();
            else toast("Would raise the lock screen, then return here");
          }}
        >
          Unlock to refund
        </ActionButton>
      </div>
    </StateCard>
  );
}

/* ------------------------------------------------------------------ */
/* 5 — Horizon outage                                                  */
/* ------------------------------------------------------------------ */

/**
 * The connection is fine and the ledger is not. The only sentence that matters
 * to the person at the counter is that the charge has not been invalidated.
 */
export function HorizonOutageNotice({
  detail,
  onRetry,
  className = "",
}: {
  detail?: string;
  onRetry?: () => void;
  className?: string;
}) {
  const { toast } = useToast();
  const [checking, setChecking] = useState(false);

  return (
    <StateCard tone="warn" icon={<IconAlert size={17} />} title="Horizon is not answering" className={className}>
      {detail && <p className="text-neutral-300">{detail}</p>}
      <p className={detail ? "mt-1" : ""}>
        The charge is still valid: a payment closes in a ledger whether this device is watching or
        not, and this device picks it up as soon as it can read again.
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
        <ActionButton
          onClick={() => {
            triggerHaptic("selection");
            setChecking(true);
            if (onRetry) onRetry();
            else toast("Would poll Horizon and reopen the stream");
            window.setTimeout(() => setChecking(false), 900);
          }}
        >
          {checking ? <Spinner size={13} /> : <IconRefresh size={13} />}
          {checking ? "Checking…" : "Check again"}
        </ActionButton>
        <span className="flex items-center gap-1.5 text-[12px] text-neutral-500">
          <IconClock size={12} /> The expiry clock keeps running
        </span>
      </div>
    </StateCard>
  );
}

/* ------------------------------------------------------------------ */
/* The gallery                                                         */
/* ------------------------------------------------------------------ */

function GallerySection({
  title,
  where,
  children,
}: {
  title: string;
  where: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="px-1">
        <h2 className="text-[12px] font-semibold uppercase tracking-wider text-neutral-400">
          {title}
        </h2>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-neutral-500">{where}</p>
      </div>
      {children}
    </section>
  );
}

/**
 * One page carrying every fragment above, so the set can be reviewed together
 * rather than found one outage at a time. It is a gallery, not a screen a shop
 * ever routes to on its own.
 */
export function OfflineStatesGallery({
  onBack,
  currency = DEFAULT_CURRENCY,
}: {
  onBack?: () => void;
  currency?: FiatCurrency;
}) {
  return (
    <section className="fade-up w-full pb-[132px] md:pb-12">
      <div className="flex items-center gap-2 pb-4">
        {onBack && <IOSBackButton onClick={onBack} label="Back to Merchant Mode" />}
        <div className="min-w-0 flex-1">
          <h1 className="display-h truncate text-[22px] text-white">Offline states</h1>
          <p className="truncate text-[11px] text-neutral-500">
            Five fragments
          </p>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <MerchantDisclosure label="Why the counter never stops">
          <p>
            A charge is a request drawn on this device against the shop&rsquo;s own account, so a
            till with no connection can still put one in front of a customer and a payment can still
            close in a ledger. Only the shop&rsquo;s knowledge of it is deferred.
          </p>
          <p>
            Nothing in these states is waiting on a service to come back. The queue is rows in this
            device&rsquo;s own storage, and every one of them settles itself the moment Horizon can
            be read again — which is why an outage is a short delay here rather than a closed till.
          </p>
          <p>
            Each piece below is the real fragment the rest of Merchant Mode drops in, shown here as
            a specimen rather than as a condition this shop is in.
          </p>
        </MerchantDisclosure>
      </div>

      <SpecimenContext value={true}>
        <div className="space-y-5">
          <GallerySection
            title="Offline banner"
            where="Above the till, while offline."
          >
            <OfflineBanner />
          </GallerySection>

          <GallerySection
            title="Unconfirmed"
            where="Charge sheet and order row."
          >
            <UnconfirmedCharge currency={currency} />
          </GallerySection>

          <GallerySection
            title="Reconnect sweep"
            where="Top of the till, on reconnect."
          >
            <ReconnectSweep />
          </GallerySection>

          <GallerySection
            title="Vault locked mid-shift"
            where="The till and the refund flow."
          >
            <VaultLockedNotice />
          </GallerySection>

          <GallerySection
            title="Horizon outage"
            where="Charge sheet and Orders."
          >
            <HorizonOutageNotice detail="horizon.stellar.org timed out after 15 s." />
          </GallerySection>
        </div>
      </SpecimenContext>
    </section>
  );
}
