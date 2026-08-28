"use client";

import { useMemo, useState } from "react";
import { useMerchantConfiguration, useMerchantTill } from "@/hooks/useMerchant";
import type { FiatCurrency } from "@/lib/format";
import { triggerHaptic } from "@/lib/haptics";
import { fmtMinor } from "@/lib/merchant/money";
import type { CatalogueItem } from "@/lib/merchant/types";
import { IconBook, IconPlus, IconSearch } from "../icons";
import { Button, IOSBackButton, SegmentedControl } from "../ui";
import { ItemEditorModal } from "./ItemEditorModal";

type ViewMode = "rows" | "tiles";

interface StockState {
  text: string;
  colour: string | null;
}

/** What the row says about stock, and whether it should shout. */
function stockState(item: CatalogueItem): StockState | null {
  if (!item.trackStock || item.stockOnHand === null) return null;
  if (item.stockOnHand <= 0) return { text: "Out of stock", colour: "#FF453A" };
  const low = item.lowStockAt !== null && item.stockOnHand <= item.lowStockAt;
  return {
    text: `${item.stockOnHand} in stock`,
    colour: low ? "#FF9F0A" : null,
  };
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "??";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

export function CataloguePage({ onBack }: { onBack?: () => void }) {
  const { catalogue } = useMerchantTill();
  const { settings } = useMerchantConfiguration();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [inactiveOnly, setInactiveOnly] = useState(false);
  const [view, setView] = useState<ViewMode>("rows");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<CatalogueItem | null>(null);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of catalogue) {
      counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [catalogue]);

  const inactiveCount = useMemo(() => catalogue.filter((i) => !i.active).length, [catalogue]);

  const taxLabelFor = useMemo(() => {
    const byId = new Map(settings.taxRates.map((r) => [r.id, r]));
    return (id: string) => {
      const rate = byId.get(id);
      return rate ? `${rate.label} ${rate.percent} %` : "No tax rate";
    };
  }, [settings.taxRates]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalogue
      .filter((item) => category === null || item.category === category)
      .filter((item) => !inactiveOnly || !item.active)
      .filter(
        (item) =>
          q === "" ||
          item.name.toLowerCase().includes(q) ||
          item.sku.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q),
      )
      .sort((a, b) => a.sortIndex - b.sortIndex || a.name.localeCompare(b.name));
  }, [catalogue, category, inactiveOnly, query]);

  /** Rows and tiles both read better grouped under their category. */
  const sections = useMemo(() => {
    const map = new Map<string, CatalogueItem[]>();
    for (const item of filtered) {
      const bucket = map.get(item.category);
      if (bucket) bucket.push(item);
      else map.set(item.category, [item]);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  function openEditor(item: CatalogueItem | null) {
    triggerHaptic("selection");
    setEditing(item);
    setEditorOpen(true);
  }


  return (
    <section className="fade-up w-full pb-[132px] md:pb-12">
      {/* Header — only the sub-page variant needs one; in Merchant Mode the app
          header and the sidebar already name the page. */}
      {onBack && (
        <div className="flex items-center gap-2 pb-4">
          <IOSBackButton onClick={onBack} label="Back to Merchant Mode" />
          <h1 className="display-h min-w-0 flex-1 truncate text-[22px] text-white">Catalogue</h1>
        </div>
      )}

      {catalogue.length === 0 ? (
        <div className="flex flex-col items-center rounded-[28px] border border-white/[0.08] bg-white/[0.02] px-6 py-16 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full border border-[#30D158]/25 bg-[#30D158]/10 text-[#30D158]">
            <IconBook size={26} />
          </span>
          <p className="display-h mt-4 text-[18px] font-semibold text-white">
            Nothing in the catalogue
          </p>
          <p className="mt-1 max-w-[340px] text-[13px] leading-relaxed text-neutral-400">
            Add what the shop sells and the till turns into two taps: pick the item, take the
            payment. Keypad amounts keep working either way.
          </p>
          <Button className="mt-6" onClick={() => openEditor(null)}>
            Add the first item
          </Button>
        </div>
      ) : (
        <>
          {/* Search + view */}
          <div className="flex items-center gap-2.5">
            <div className="search-field min-w-0 flex-1">
              <IconSearch size={14} className="shrink-0 text-neutral-400" />
              <input
                placeholder="Search name, SKU or category"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search the catalogue"
                className="w-full bg-transparent text-base text-white outline-none placeholder:text-neutral-500 sm:text-[13.5px]"
              />
            </div>
            <div className="w-[132px] shrink-0">
              <SegmentedControl<ViewMode>
                value={view}
                onChange={setView}
                options={[
                  { label: "Rows", value: "rows" },
                  { label: "Tiles", value: "tiles" },
                ]}
              />
            </div>
            <button
              type="button"
              onClick={() => openEditor(null)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0A84FF] text-white shadow-[0_8px_20px_-6px_rgba(10,132,255,0.55)] transition-all hover:bg-[#2492ff] active:scale-90"
              title="New item"
              aria-label="New item"
            >
              <IconPlus size={17} />
            </button>
          </div>

          {/* Category filter */}
          <div
            role="group"
            aria-label="Filter the catalogue"
            className="mt-3 flex items-center gap-2 overflow-x-auto pb-1"
          >
            <button
              type="button"
              aria-pressed={category === null && !inactiveOnly}
              onClick={() => {
                triggerHaptic("selection");
                setCategory(null);
                setInactiveOnly(false);
              }}
              className={`chip shrink-0 font-sans ${
                category === null && !inactiveOnly
                  ? "bg-[#0A84FF]/20 text-white"
                  : "text-neutral-400"
              }`}
            >
              All
              <span className="mono text-[11px] opacity-60">{catalogue.length}</span>
            </button>

            {categories.map(([name, count]) => {
              const on = category === name;
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    triggerHaptic("selection");
                    setCategory(on ? null : name);
                  }}
                  className={`chip shrink-0 font-sans ${
                    on ? "bg-[#0A84FF]/20 text-white" : "text-neutral-400"
                  }`}
                >
                  {name}
                  <span className="mono text-[11px] opacity-60">{count}</span>
                </button>
              );
            })}

            {inactiveCount > 0 && (
              <>
                <span aria-hidden="true" className="h-4 w-px shrink-0 bg-white/10" />
                <button
                  type="button"
                  aria-pressed={inactiveOnly}
                  onClick={() => {
                    triggerHaptic("selection");
                    setInactiveOnly((prev) => !prev);
                  }}
                  className={`chip shrink-0 font-sans ${
                    inactiveOnly ? "bg-[#FF9F0A]/20 text-[#FF9F0A]" : "text-neutral-400"
                  }`}
                >
                  Inactive
                  <span className="mono text-[11px] opacity-60">{inactiveCount}</span>
                </button>
              </>
            )}
          </div>

          {/* Results */}
          {filtered.length === 0 ? (
            <p className="px-2 py-12 text-center text-[13px] text-neutral-500">
              No item matches this filter.
            </p>
          ) : (
            <div className="mt-4 space-y-5">
              {sections.map(([name, items]) => (
                <div key={name}>
                  <p className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-500">
                    {name}
                  </p>
                  {view === "rows" ? (
                    <div className="list-group">
                      {items.map((item, index) => (
                        <ItemRow
                          key={item.id}
                          item={item}
                          sep={index > 0}
                          currency={settings.currency}
                          taxLabel={taxLabelFor(item.taxRateId)}
                          onOpen={() => openEditor(item)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                      {items.map((item) => (
                        <ItemTile
                          key={item.id}
                          item={item}
                          currency={settings.currency}
                          onOpen={() => openEditor(item)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {editorOpen && (
        <ItemEditorModal item={editing} onClose={() => setEditorOpen(false)} />
      )}
    </section>
  );
}

function ItemRow({
  item,
  sep,
  currency,
  taxLabel,
  onOpen,
}: {
  item: CatalogueItem;
  sep: boolean;
  currency: FiatCurrency;
  taxLabel: string;
  onOpen: () => void;
}) {
  const stock = stockState(item);
  /* The wallet's own list row: 34px glyph, title, one mono line, the price and
     the chevron. The stock word keeps its tint inside that single line rather
     than wrapping the row on to a third one at 393px. */
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Edit ${item.name}`}
      className={`row-hover flex w-full items-center gap-3.5 px-4 py-3.5 text-left ${
        sep ? "ios-sep" : ""
      } ${item.active ? "" : "opacity-60"}`}
    >
      <span
        aria-hidden="true"
        className="row-icon text-[12.5px] font-bold"
        style={{
          background: `color-mix(in srgb, ${item.colour} 20%, transparent)`,
          color: "#fff",
        }}
      >
        {initialsOf(item.name)}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[15.5px] font-normal leading-tight text-white">
            {item.name}
          </span>
          {!item.active && (
            <span className="badge-net shrink-0 px-2 py-0.5 text-[10.5px] leading-tight">
              Inactive
            </span>
          )}
        </span>
        <span className="mono block truncate text-[12px] leading-tight text-neutral-400">
          {item.sku} · {taxLabel}
          {stock && (
            <>
              {" · "}
              <span style={stock.colour ? { color: stock.colour } : undefined}>{stock.text}</span>
            </>
          )}
        </span>
      </span>

      <span className="mono shrink-0 text-[14.5px] font-medium text-white">
        {fmtMinor(item.priceMinor, currency)}
      </span>
      <svg
        className="chevron"
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
    </button>
  );
}

function ItemTile({
  item,
  currency,
  onOpen,
}: {
  item: CatalogueItem;
  currency: FiatCurrency;
  onOpen: () => void;
}) {
  const stock = stockState(item);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Edit ${item.name}`}
      className={`flex min-h-[112px] flex-col justify-between rounded-[18px] p-3 text-left transition-transform active:scale-[0.97] ${
        item.active ? "" : "opacity-55"
      }`}
      style={{
        background: `color-mix(in srgb, ${item.colour} 14%, transparent)`,
        boxShadow: `inset 0 0 0 0.5px color-mix(in srgb, ${item.colour} 45%, transparent)`,
      }}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="mono text-[10.5px] tracking-wide text-neutral-300">
          {item.sku}
        </span>
        {!item.active && (
          <span className="badge-net shrink-0 px-1.5 py-0.5 text-[10px]">Off</span>
        )}
      </span>

      <span className="mt-2 line-clamp-2 text-[14.5px] font-semibold leading-tight text-white">
        {item.name}
      </span>

      <span className="mt-1.5 flex items-end justify-between gap-2">
        <span className="mono text-[15.5px] font-medium text-white">
          {fmtMinor(item.priceMinor, currency)}
        </span>
        {stock && (
          <span
            className="mono text-[10.5px] text-neutral-400"
            style={stock.colour ? { color: stock.colour } : undefined}
          >
            {stock.text}
          </span>
        )}
      </span>
    </button>
  );
}
