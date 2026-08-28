"use client";

import { useMemo, useState } from "react";
import { useMerchantConfiguration, useMerchantRecords } from "@/hooks/useMerchant";
import { useLiveNow } from "@/hooks/useLiveNow";
import { triggerHaptic } from "@/lib/haptics";
import { fmtMinor } from "@/lib/merchant/money";
import type { FiatCurrency } from "@/lib/format";
import type { CustomerRecord } from "@/lib/merchant/types";
import { Avatar, Button, HashValue, SegmentedControl } from "../ui";
import { Stat, StatStrip } from "./Stat";
import { IconSearch, IconUsers } from "../icons";
import {
  CustomerDetailModal,
  LoyaltyBadge,
  customerTitle,
  relativeTime,
} from "./CustomerDetailModal";

type SortKey = "recent" | "lifetime" | "visits";

const SORTS: { label: string; value: SortKey }[] = [
  { label: "Recent", value: "recent" },
  { label: "Lifetime", value: "lifetime" },
  { label: "Visits", value: "visits" },
];

function matches(customer: CustomerRecord, needle: string): boolean {
  if (!needle) return true;
  return (
    (customer.name?.toLowerCase().includes(needle) ?? false) ||
    customer.address.toLowerCase().includes(needle) ||
    (customer.note?.toLowerCase().includes(needle) ?? false)
  );
}

function sortBy(key: SortKey) {
  return (a: CustomerRecord, b: CustomerRecord) => {
    if (key === "lifetime") return b.lifetimeMinor - a.lifetimeMinor;
    if (key === "visits") return b.orderCount - a.orderCount;
    return b.lastSeenAt - a.lastSeenAt;
  };
}

export function CustomersPage() {
  const { customers } = useMerchantRecords();
  const { settings } = useMerchantConfiguration();

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("recent");
  const [openAddress, setOpenAddress] = useState<string | null>(null);
  const now = useLiveNow();

  const needle = query.trim().toLowerCase();

  const shown = useMemo(
    () => customers.filter((customer) => matches(customer, needle)).sort(sortBy(sort)),
    [customers, needle, sort],
  );

  const open = useMemo(
    () => customers.find((customer) => customer.address === openAddress) ?? null,
    [customers, openAddress],
  );

  const lifetime = customers.reduce((sum, customer) => sum + customer.lifetimeMinor, 0);
  const returning = customers.filter((customer) => customer.orderCount > 1).length;

  /*
    A list, and it reads like one: three figures, one search field, one sort,
    one line of privacy with the rest folded behind it. Nothing here is a
    primary action — the screen is for finding a person, not for doing a thing.
  */
  return (
    <section className="fade-up w-full min-w-0 pb-[132px] md:pb-12">
      {/* Totals */}
      <StatStrip columns="repeat(3, minmax(0, 1fr))" className="mb-3">
        <Stat label="Lifetime" value={fmtMinor(lifetime, settings.currency)} tone="money" />
        <Stat
          label="Avg customer"
          value={fmtMinor(
            customers.length === 0 ? 0 : Math.round(lifetime / customers.length),
            settings.currency,
          )}
          divider="left"
        />
        <Stat
          label="Returning"
          value={
            customers.length === 0
              ? "0%"
              : `${Math.round((returning / customers.length) * 100)}%`
          }
          divider="left"
        />
      </StatStrip>

      {/* Search and sort */}
      <div className="mb-3 flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <div className="search-field flex-1">
          <IconSearch size={14} className="shrink-0 text-neutral-400" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, address or note…"
            aria-label="Search customers"
            className="w-full bg-transparent text-base text-white outline-none placeholder:text-neutral-500 sm:text-[13.5px]"
          />
        </div>
        <div className="sm:w-[264px]">
          <SegmentedControl<SortKey> value={sort} options={SORTS} onChange={setSort} />
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-col items-center rounded-[20px] border border-white/[0.08] bg-white/[0.02] px-6 py-14 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#30D158]/12 text-[#30D158]">
            <IconUsers size={24} />
          </span>
          <p className="mt-4 text-[17px] font-semibold text-white">
            {customers.length === 0 ? "Nobody on file" : "Nothing matches"}
          </p>
          <p className="mt-1 max-w-[360px] text-[13px] leading-relaxed text-neutral-400">
            {customers.length === 0
              ? "Customers appear as addresses pay. Nothing is asked of them — no sign-up, no email, no card on file."
              : `No customer matches “${query.trim()}”.`}
          </p>
          {needle && (
            <div className="mt-5">
              <Button
                variant="secondary"
                onClick={() => {
                  triggerHaptic("selection");
                  setQuery("");
                }}
              >
                Clear search
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="list-group">
          {shown.map((customer, index) => (
            <CustomerRow
              key={customer.address}
              customer={customer}
              currency={settings.currency}
              now={now}
              sep={index > 0}
              onOpen={() => {
                triggerHaptic("selection");
                setOpenAddress(customer.address);
              }}
            />
          ))}
        </div>
      )}

      <CustomerDetailModal
        customer={open}
        onClose={() => setOpenAddress(null)}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */


/**
 * The wallet's own list row, unchanged: glyph, title, one mono line under it,
 * the figure, the chevron. Four things scan here — who, when they were last in,
 * how often, and what they have spent. A full card is the one thing the counter
 * has to act on, so it rides in the trailing cluster as a badge rather than
 * pushing the row on to a third line; everything else about the card is on the
 * card. The average went with it: the row shows lifetime, the card shows both.
 */
function CustomerRow({
  customer,
  currency,
  now,
  sep,
  onOpen,
}: {
  customer: CustomerRecord;
  currency: FiatCurrency;
  now: number;
  sep: boolean;
  onOpen: () => void;
}) {
  /* The whole row opens the card, but an unnamed customer is titled by their
     address in the wallet's own chunked presentation — and HashValue is itself
     a button. So the row's target is laid underneath the content rather than
     wrapped around it, and only the address takes its own taps back. */
  return (
    <div
      className={`row-hover relative flex w-full items-center gap-3.5 px-4 py-3.5 text-left ${
        sep ? "ios-sep" : ""
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open the card for ${customerTitle(customer)}`}
        className="absolute inset-0 z-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#0A84FF]"
      />

      <span aria-hidden="true" className="pointer-events-none relative z-10 shrink-0">
        <Avatar
          seed={customer.address}
          size={34}
          label={(customer.name ?? customer.address).slice(0, 1).toUpperCase()}
        />
      </span>

      <span className="pointer-events-none relative z-10 min-w-0 flex-1">
        <span className="flex min-w-0 items-center text-[15.5px] font-normal leading-tight text-white">
          {customer.name ? (
            <span className="truncate">{customer.name}</span>
          ) : (
            <HashValue
              value={customer.address}
              head={4}
              tail={4}
              className="pointer-events-auto leading-tight"
            />
          )}
        </span>
        <span className="mono block truncate text-[12px] leading-tight text-neutral-400">
          {relativeTime(customer.lastSeenAt, now)} · {customer.orderCount}{" "}
          {customer.orderCount === 1 ? "visit" : "visits"}
        </span>
      </span>

      {customer.loyalty && (
        <span className="pointer-events-none relative z-10 hidden sm:inline-flex">
          <LoyaltyBadge loyalty={customer.loyalty} />
        </span>
      )}

      <span className="mono pointer-events-none relative z-10 shrink-0 text-[14.5px] font-medium text-white">
        {fmtMinor(customer.lifetimeMinor, currency)}
      </span>

      <svg
        className="chevron pointer-events-none relative z-10"
        width="8"
        height="14"
        viewBox="0 0 8 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m1.5 1.5 5 5.5-5 5.5" />
      </svg>
    </div>
  );
}
