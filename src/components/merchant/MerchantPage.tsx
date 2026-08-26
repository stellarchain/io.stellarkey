"use client";

import { useEffect, useRef, useState } from "react";
import { useMerchant } from "@/hooks/useMerchant";
import { useWallet } from "@/hooks/useWallet";
import { fmtMinor } from "@/lib/merchant/money";
import { triggerHaptic } from "@/lib/haptics";
import { Notice, SegmentedControl } from "../ui";
import { IconAlert, IconChevronDown } from "../icons";
import { IconClock, IconInfo, IconStorefront } from "./icons";
import { Stat, StatStrip } from "./Stat";
import { ChargeSheet } from "./ChargeSheet";
import { PosTerminal } from "./PosTerminal";
import { OrdersPage } from "./OrdersPage";
import { CataloguePage } from "./CataloguePage";
import { InvoicesPage } from "./InvoicesPage";
import { PaymentLinksPage } from "./PaymentLinksPage";
import { CustomersPage } from "./CustomersPage";
import { InsightsPage } from "./InsightsPage";
import { ShiftSheet } from "./ShiftSheet";
import {
  ConnectionRestoredNotice,
  HorizonOutageNotice,
  OfflineBanner,
  VaultLockedNotice,
} from "./OfflineStates";

/**
 * The Merchant Mode shell: alerts, the mobile sub-navigation, and the surface
 * the chosen tab renders into.
 *
 * The till, orders, catalogue, invoices, counter codes, customers, insights, and
 * shift lifecycle all read the persisted merchant store. This file only routes
 * to those operational surfaces; its local state is limited to the selected tab
 * and whether the shift sheet is showing.
 */

export type MerchantSub =
  | "pos"
  | "orders"
  | "catalogue"
  | "invoices"
  | "links"
  | "customers"
  | "insights";

/**
 * The six surfaces the shop navigates between. Counter codes is deliberately
 * absent: it is the second half of the Invoices screen rather than a peer of it,
 * so a seventh chip would only make the strip longer for no new place to go.
 * Settlement is absent too — it is a rule, and a rule is a setting.
 */
const NAV: { label: string; value: MerchantSub }[] = [
  { label: "Till", value: "pos" },
  { label: "Orders", value: "orders" },
  { label: "Catalogue", value: "catalogue" },
  { label: "Invoices", value: "invoices" },
  { label: "Customers", value: "customers" },
  { label: "Insights", value: "insights" },
];

const BILLING_OPTIONS: { label: string; value: MerchantSub }[] = [
  { label: "Invoices", value: "invoices" },
  { label: "Counter codes", value: "links" },
];

/** Which chip a sub lights up. Counter codes belongs to Invoices. */
function navKey(sub: MerchantSub): MerchantSub {
  return sub === "links" ? "invoices" : sub;
}


/**
 * The tray warning. It is a button everywhere except on Orders itself, where
 * the tray is already on screen and a link back to it would go nowhere.
 */
function UnmatchedStrip({
  label,
  body,
  onOpen,
}: {
  label: string;
  body: string;
  onOpen: (() => void) | null;
}) {
  const shell =
    "flex items-center gap-3 rounded-2xl border border-[#FF9F0A]/30 bg-[#FF9F0A]/10 px-4 py-3";
  const inner = (
    <>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#FF9F0A]/15 text-[#FF9F0A]">
        <IconAlert size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-[#FF9F0A]">{label}</span>
        <span className="block text-[12px] leading-relaxed text-neutral-400">{body}</span>
      </span>
      {onOpen && <IconChevronDown size={16} className="chevron -rotate-90" />}
    </>
  );

  if (!onOpen) {
    return (
      <div role="status" className={shell}>
        {inner}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`row-hover w-full text-left transition-transform active:scale-[0.99] ${shell}`}
    >
      {inner}
    </button>
  );
}

export function MerchantPage({
  sub,
  onSubChange,
  shiftOpen,
  onShiftOpenChange,
}: {
  sub: MerchantSub;
  onSubChange: (next: MerchantSub) => void;
  /** Optional: lets the desktop sidebar drive the same sheet this page mounts. */
  shiftOpen?: boolean;
  onShiftOpenChange?: (open: boolean) => void;
}) {
  const {
    ready,
    online,
    enabled,
    settings,
    today,
    activeShift,
    chargeBlockedReason,
    unmatched,
    watchError,
    queuedChargeCount,
    expiredChargeCount,
    pollNow,
    activeCharge,
    closeCharge,
  } = useMerchant();
  const { phase } = useWallet();

  // Uncontrolled by default so the page works on its own; the shell passes both
  // props so the sidebar's shift row opens this very sheet.
  const [localShiftOpen, setLocalShiftOpen] = useState(false);
  const [connectionRestored, setConnectionRestored] = useState(false);
  const previousOnline = useRef(online);
  const shiftShowing = shiftOpen ?? localShiftOpen;
  const setShiftShowing = onShiftOpenChange ?? setLocalShiftOpen;

  useEffect(() => {
    let showTimer: ReturnType<typeof setTimeout> | undefined;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    if (!previousOnline.current && online) {
      showTimer = setTimeout(() => setConnectionRestored(true), 0);
      hideTimer = setTimeout(() => setConnectionRestored(false), 5_000);
    }
    previousOnline.current = online;
    return () => {
      if (showTimer) clearTimeout(showTimer);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, [online]);

  if (!ready) {
    return (
      <div
        role="status"
        aria-label="Loading Merchant Mode"
        className="w-full min-w-0 space-y-3 pb-[132px] md:pb-0"
      >
        <div className="skeleton h-[62px] rounded-[14px] md:hidden" />
        <div className="skeleton h-[44px] rounded-xl md:hidden" />
        <div className="skeleton h-[340px] rounded-[20px]" />
      </div>
    );
  }

  if (!enabled) {
    return (
      <section className="fade-up mx-auto w-full max-w-[520px] pb-[132px] md:pb-0">
        <div className="flex flex-col items-center rounded-[28px] border border-white/[0.08] bg-white/[0.02] px-6 py-16 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full border border-[#30D158]/25 bg-[#30D158]/10 text-[#30D158]">
            <IconStorefront size={26} />
          </span>
          <p className="display-h mt-4 text-[18px] font-semibold text-white">Merchant Mode is off</p>
          <p className="mt-1 max-w-[340px] text-[13px] leading-relaxed text-neutral-400">
            Turn it on to run a counter from this wallet. Every charge is a request paid straight to
            your own account — nothing is held for you, and a refund is an ordinary payment back.
          </p>
          <p className="mt-6 rounded-full bg-white/[0.06] px-4 py-2 text-[12.5px] font-medium text-neutral-300">
            Settings → Merchant → Merchant Mode
          </p>
        </div>
      </section>
    );
  }

  const needsAttention = unmatched.length;
  const attentionLabel = `${needsAttention} payment${needsAttention === 1 ? "" : "s"} need${
    needsAttention === 1 ? "s" : ""
  } attention`;
  const attentionBody = "Money reached the till that no open charge claims. File it against an order.";
  // Orders draws its own unmatched tray, which says the same thing and can act on
  // it. Two banners for one fact is exactly the noise this pass removed.
  const showTray = needsAttention > 0 && sub !== "orders";
  const showChargeBlock = Boolean(chargeBlockedReason) && online;
  const showRuntime = !online || Boolean(watchError) || phase === "locked" || connectionRestored;
  const showAlerts = showChargeBlock || showTray || showRuntime;
  const active = navKey(sub);
  const onBilling = sub === "invoices" || sub === "links";

  /*
    The takings strip carries today's three figures to the screens that do not
    state them. Insights is the one screen that does — and states them better,
    with the comparison that makes them mean something, about a hundred pixels
    lower. Two readings of the same three labels on one phone screen is how the
    two came to disagree: the strip reads the live till, while Insights falls
    back to a sample day until the first sale settles, so a fresh install showed
    € 0.00 above € 502.00. Putting the sample into the strip would only spread
    it onto the till, Orders and Catalogue as well, where there is no room to
    say it is a sample. So the strip stands down on Insights instead, and the
    page keeps the figures it can qualify.
  */
  const showTakings = sub !== "insights";

  // Every sub-page clears the floating mobile tab bar itself — Orders, Catalogue
  // and Insights with their own bottom padding, the till with the sticky charge
  // bar that parks above it — so padding again here would only strand that bar
  // hundreds of pixels up the screen at the end of the scroll.
  return (
    // Same column the app gives Activity and Settings: 1000px inside the shell's
    // 1200px body, so merchant content lines up with the rest of the wallet.
    <section className="fade-up mx-auto w-full min-w-0 max-w-[1000px]">
      {showAlerts && (
        <div className="mb-4 space-y-2.5">
          {!online && (
            <OfflineBanner
              queuedCount={queuedChargeCount}
              expiredCount={expiredChargeCount}
            />
          )}

          {online && watchError && (
            <HorizonOutageNotice detail={watchError} onRetry={pollNow} />
          )}

          {online && !watchError && connectionRestored && (
            <ConnectionRestoredNotice queuedCount={queuedChargeCount} />
          )}

          {phase === "locked" && <VaultLockedNotice />}

          {showChargeBlock && chargeBlockedReason && (
            <div role="status">
              <Notice tone="warn">
                <span className="flex items-start gap-2.5">
                  <IconInfo size={15} className="mt-[1px] shrink-0 text-[#FF9F0A]" />
                  <span>
                    <span className="font-semibold text-white">Charges are paused. </span>
                    {chargeBlockedReason}
                  </span>
                </span>
              </Notice>
            </div>
          )}

          {showTray && (
            <UnmatchedStrip
              label={attentionLabel}
              body={attentionBody}
              onOpen={() => {
                triggerHaptic("warning");
                onSubChange("orders");
              }}
            />
          )}
        </div>
      )}

      {/* Mobile keeps its own sub-nav: the tab bar only has one Merchant slot. */}
      <div className="mb-4 space-y-2.5 md:hidden">
        {/* Takings gets the widest column: it is the longest figure on the strip. */}
        {showTakings && (
          <StatStrip columns="minmax(0,1.3fr) minmax(0,0.7fr) minmax(0,1fr)">
            <Stat
              label="Takings today"
              value={fmtMinor(today.takingsMinor, settings.currency)}
              tone="money"
            />
            <Stat label="Orders" value={String(today.orderCount)} divider="left" />
            <Stat
              label="Avg ticket"
              value={fmtMinor(today.avgTicketMinor, settings.currency)}
              divider="left"
            />
          </StatStrip>
        )}

        {/*
          Six destinations will not fit one segmented row on a 393px phone, so
          the strip scrolls and bleeds to the screen edge — the last chip is
          half-visible, which is what tells you there is more to scroll to. Shift
          is pinned outside the scroller: it is the one control a person reaches
          for without looking, and it must never be scrolled off.
        */}
        <div className="flex items-center gap-2">
          <nav
            aria-label="Merchant sections"
            className="scrollbar-none -ml-4 min-w-0 flex-1 overflow-x-auto pl-4"
          >
            <div className="flex w-max items-center gap-1.5 pr-2">
              {NAV.map((item) => {
                const isActive = item.value === active;
                return (
                  <button
                    key={item.value}
                    type="button"
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => {
                      if (isActive) return;
                      triggerHaptic("selection");
                      onSubChange(item.value);
                    }}
                    className={`chip min-h-[44px] shrink-0 font-sans text-[13px] font-semibold ${
                      isActive
                        ? "bg-[#0A84FF] text-white shadow-sm hover:bg-[#0A84FF]"
                        : "text-neutral-300"
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </nav>

          <button
            type="button"
            onClick={() => {
              triggerHaptic("selection");
              setShiftShowing(true);
            }}
            className="chip min-h-[44px] shrink-0 gap-1.5 border border-white/10 font-sans text-[13px] font-semibold text-white"
          >
            <IconClock size={14} className={activeShift ? "text-[#30D158]" : "text-[#FF9F0A]"} />
            <span>{activeShift ? `Shift ${activeShift.number}` : "Open shift"}</span>
          </button>
        </div>
      </div>

      {/*
        Invoices and counter codes are the same job — asking for money away from
        the counter — so they share one destination and split it in two here
        rather than competing for a chip of their own.
      */}
      {onBilling && (
        <div className="mb-3 w-full">
          <div className="max-w-[300px]">
            <SegmentedControl
              value={sub === "links" ? "links" : "invoices"}
              options={BILLING_OPTIONS}
              onChange={onSubChange}
            />
          </div>
        </div>
      )}

      {sub === "pos" ? (
        <PosTerminal />
      ) : sub === "orders" ? (
        <OrdersPage />
      ) : sub === "catalogue" ? (
        <CataloguePage />
      ) : sub === "invoices" ? (
        <InvoicesPage />
      ) : sub === "links" ? (
        <PaymentLinksPage />
      ) : sub === "customers" ? (
        <CustomersPage />
      ) : (
        <InsightsPage />
      )}

      {/* The charge sheet hangs off the whole of Merchant Mode, not off the till:
          a request stays on screen while the staff member steps over to Orders,
          and Orders can put a live one back on screen from its own list. */}
      <ChargeSheet charge={activeCharge} onClose={closeCharge} />

      {/* The shift belongs to the counter, not to any one tab: it opens over
          whatever is on screen and closes back onto it. */}
      <ShiftSheet open={shiftShowing} onClose={() => setShiftShowing(false)} />
    </section>
  );
}
