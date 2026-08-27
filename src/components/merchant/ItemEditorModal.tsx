"use client";

import { useId, useMemo, useState } from "react";
import { useMerchant } from "@/hooks/useMerchant";
import { FIAT_SYMBOLS } from "@/lib/format";
import { triggerHaptic } from "@/lib/haptics";
import { fmtMinor, minorToDecimal, toMinor } from "@/lib/merchant/money";
import type { CatalogueItem } from "@/lib/merchant/types";
import { IconCheck } from "../icons";
import { useToast } from "../Toast";
import { Button, ErrorText, Field, Modal, ModalHeader, Select, Toggle } from "../ui";

/** The tile tints a shop may choose from — iOS system colours only. */
const TILE_COLOURS: { hex: string; name: string }[] = [
  { hex: "#0A84FF", name: "Blue" },
  { hex: "#5E5CE6", name: "Indigo" },
  { hex: "#BF5AF2", name: "Purple" },
  { hex: "#64D2FF", name: "Cyan" },
  { hex: "#FF9F0A", name: "Orange" },
  { hex: "#FF453A", name: "Red" },
  { hex: "#30D158", name: "Green" },
];

/** Sentinel for the "new category" row; a space keeps it off any real category. */
const NEW_CATEGORY = " new-category";

/** "Flat White" to "FLA", the shape the seed catalogue gives its SKUs. */
function suggestSku(name: string): string {
  return name.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 3);
}

/** A plain decimal price in minor units, or null when the text is not one. */
function parsePrice(text: string): number | null {
  const raw = text.trim();
  if (raw === "" || raw === "." || !/^\d{0,9}(\.\d{0,2})?$/.test(raw)) return null;
  return toMinor(raw);
}

/** A whole, non-negative count, or null. */
function parseCount(text: string): number | null {
  const raw = text.trim();
  return /^\d{1,7}$/.test(raw) ? Number(raw) : null;
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "??";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

export function ItemEditorModal({
  item,
  onClose,
}: {
  /** null opens the editor in create mode. */
  item: CatalogueItem | null;
  onClose: () => void;
}) {
  // Keyed so moving straight from one row to another starts on clean state.
  return <ItemEditor key={item?.id ?? "new-item"} item={item} onClose={onClose} />;
}

function ItemEditor({ item, onClose }: { item: CatalogueItem | null; onClose: () => void }) {
  const { catalogue, modifierGroups, settings, upsertItem, removeItem } = useMerchant();
  const { toast } = useToast();
  const isEdit = item !== null;
  const priceId = useId();

  const categories = useMemo(() => {
    const seen = new Set(catalogue.map((i) => i.category.trim()).filter(Boolean));
    return [...seen].sort((a, b) => a.localeCompare(b));
  }, [catalogue]);

  const preferredRate = item?.taxRateId ?? settings.defaultTaxRateId;
  const knownRate = settings.taxRates.some((r) => r.id === preferredRate);

  const [name, setName] = useState(item?.name ?? "");
  const [sku, setSku] = useState(item?.sku ?? "");
  const [skuTouched, setSkuTouched] = useState(isEdit);
  const [category, setCategory] = useState(item?.category ?? categories[0] ?? "");
  const [freeCategory, setFreeCategory] = useState(!isEdit && categories.length === 0);
  const [priceText, setPriceText] = useState(item ? minorToDecimal(item.priceMinor) : "");
  const [taxRateId, setTaxRateId] = useState(
    knownRate ? preferredRate : (settings.taxRates[0]?.id ?? preferredRate),
  );
  const [colour, setColour] = useState(
    item?.colour ?? TILE_COLOURS[catalogue.length % TILE_COLOURS.length].hex,
  );
  const [groupIds, setGroupIds] = useState<string[]>(item?.modifierGroupIds ?? []);
  const [trackStock, setTrackStock] = useState(item?.trackStock ?? false);
  const [stockText, setStockText] = useState(
    item?.stockOnHand === null || item?.stockOnHand === undefined ? "" : String(item.stockOnHand),
  );
  const [lowStockText, setLowStockText] = useState(
    item?.lowStockAt === null || item?.lowStockAt === undefined ? "" : String(item.lowStockAt),
  );
  const [active, setActive] = useState(item?.active ?? true);
  const [error, setError] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const effectiveSku = skuTouched ? sku : suggestSku(name);
  const previewMinor = parsePrice(priceText);
  const symbol = FIAT_SYMBOLS[settings.currency].trim();
  const draftId = isEdit ? item.id : effectiveSku.trim().toLowerCase();

  function toggleGroup(id: string) {
    triggerHaptic("selection");
    setGroupIds((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]));
  }

  function fail(message: string) {
    setError(message);
    triggerHaptic("error");
  }

  async function handleSave() {
    const trimmedName = name.trim();
    if (!trimmedName) {
      fail("Give the item a name. It is what staff tap on the till.");
      return;
    }

    const skuValue = effectiveSku.trim().toUpperCase();
    if (!skuValue) {
      fail("Give the item a SKU. It becomes the item id, so it cannot be blank.");
      return;
    }

    const id = isEdit ? item.id : skuValue.toLowerCase();
    if (!isEdit) {
      const clash = catalogue.find((i) => i.id === id);
      if (clash) {
        fail(`The id ${id} already belongs to ${clash.name}. Choose a different SKU.`);
        return;
      }
    }

    const priceMinor = parsePrice(priceText);
    if (priceMinor === null) {
      fail("Enter the price as a plain amount, such as 3.20. It cannot be negative or blank.");
      return;
    }

    let stockOnHand: number | null = null;
    let lowStockAt: number | null = null;
    if (trackStock) {
      stockOnHand = stockText.trim() === "" ? 0 : parseCount(stockText);
      if (stockOnHand === null) {
        fail("Stock on hand has to be a whole number of units, such as 24.");
        return;
      }
      if (lowStockText.trim() !== "") {
        lowStockAt = parseCount(lowStockText);
        if (lowStockAt === null) {
          fail("Low stock at has to be a whole number of units, or left blank.");
          return;
        }
      }
    }

    const nextSortIndex = catalogue.reduce((max, i) => Math.max(max, i.sortIndex), -1) + 1;

    const next: CatalogueItem = {
      id,
      name: trimmedName,
      sku: skuValue,
      category: category.trim() || "General",
      priceMinor,
      taxRateId,
      colour,
      modifierGroupIds: groupIds,
      trackStock,
      stockOnHand,
      lowStockAt,
      active,
      sortIndex: item?.sortIndex ?? nextSortIndex,
    };

    try {
      await upsertItem(next);
    } catch (caught) {
      fail(caught instanceof Error ? caught.message : "The item could not be saved.");
      return;
    }
    triggerHaptic("success");
    toast(isEdit ? `${next.name} updated` : `${next.name} added to the catalogue`, "success");
    onClose();
  }

  async function handleDelete() {
    if (!item) return;
    try {
      await removeItem(item.id);
    } catch (caught) {
      fail(caught instanceof Error ? caught.message : "The item could not be removed.");
      return;
    }
    triggerHaptic("success");
    toast(`${item.name} removed from the catalogue`, "info");
    onClose();
  }

  return (
    <Modal open onClose={onClose} wide>
      <ModalHeader
        title={isEdit ? "Edit Item" : "New Item"}
        subtitle={
          isEdit
            ? `Item id ${item.id} · position ${item.sortIndex + 1}`
            : "Everything the till needs to ring this up"
        }
        onClose={onClose}
      />

      <div className="space-y-5 p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Name">
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Flat White"
                maxLength={48}
                autoFocus
              />
            </Field>
          </div>

          <Field label="SKU" hint={draftId ? `id ${draftId}` : "id comes from the SKU"}>
            <input
              className="input mono"
              value={effectiveSku}
              onChange={(e) => {
                setSkuTouched(true);
                setSku(e.target.value.toUpperCase());
              }}
              placeholder="FLW"
              maxLength={12}
              spellCheck={false}
              autoComplete="off"
            />
          </Field>

          <div className="space-y-2">
            <Field label="Category">
              <Select
                value={freeCategory ? NEW_CATEGORY : category}
                ariaLabel="Category"
                placeholder="Choose a category"
                onChange={(value) => {
                  if (value === NEW_CATEGORY) {
                    setFreeCategory(true);
                    setCategory("");
                    return;
                  }
                  setFreeCategory(false);
                  setCategory(value);
                }}
                options={[
                  ...categories.map((c) => ({ value: c, label: c })),
                  { value: NEW_CATEGORY, label: "New category" },
                ]}
              />
            </Field>
            {freeCategory && (
              <input
                className="input"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Coffee"
                maxLength={24}
                aria-label="New category name"
              />
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor={priceId} className="field-label pb-0">
                Price
              </label>
              <span className="text-[11px] text-neutral-400">
                {settings.currency} · tax {settings.taxMode}
              </span>
            </div>
            <div className="input flex items-center gap-2 focus-within:shadow-[0_0_0_3.5px_rgba(10,132,255,0.35)]">
              <span aria-hidden="true" className="mono shrink-0 text-[13px] text-neutral-500">
                {symbol}
              </span>
              <input
                id={priceId}
                className="mono min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-neutral-500 sm:text-[15.5px]"
                value={priceText}
                onChange={(e) => setPriceText(e.target.value)}
                placeholder="0.00"
                inputMode="decimal"
                spellCheck={false}
                autoComplete="off"
              />
            </div>
            <p className="text-[11.5px] text-neutral-500">
              Rings up as{" "}
              <span className="mono text-neutral-300">
                {fmtMinor(previewMinor ?? 0, settings.currency)}
              </span>
            </p>
          </div>

          <Field label="Tax rate">
            <Select
              value={taxRateId}
              ariaLabel="Tax rate"
              onChange={setTaxRateId}
              options={settings.taxRates.map((r) => ({
                value: r.id,
                label: r.label,
                sublabel: `${r.percent} %`,
              }))}
            />
          </Field>
        </div>

        {/* Tile colour */}
        <div className="space-y-2">
          <span className="field-label">Tile colour</span>
          <div className="flex flex-wrap items-center gap-3">
            <span
              aria-hidden="true"
              className="row-icon text-[13px] font-bold"
              style={{
                background: `color-mix(in srgb, ${colour} 20%, transparent)`,
                color: colour,
              }}
            >
              {initialsOf(name)}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {TILE_COLOURS.map((swatch) => {
                const on = swatch.hex.toLowerCase() === colour.toLowerCase();
                return (
                  <button
                    key={swatch.hex}
                    type="button"
                    aria-label={swatch.name}
                    aria-pressed={on}
                    onClick={() => {
                      triggerHaptic("selection");
                      setColour(swatch.hex);
                    }}
                    className="flex h-8 w-8 items-center justify-center rounded-full transition-transform active:scale-90"
                    style={{
                      background: swatch.hex,
                      boxShadow: on
                        ? `0 0 0 2px #000000, 0 0 0 4px ${swatch.hex}`
                        : "inset 0 0 0 0.5px rgba(255,255,255,0.25)",
                    }}
                  >
                    <span className={on ? "text-white" : "text-transparent"}>
                      <IconCheck size={13} />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Modifier groups */}
        {modifierGroups.length > 0 && (
          <div className="space-y-2">
            <span className="field-label">Modifier groups</span>
            <div className="panel-inset overflow-hidden">
              {modifierGroups.map((group, index) => {
                const on = groupIds.includes(group.id);
                return (
                  <button
                    key={group.id}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggleGroup(group.id)}
                    className={`row-hover flex w-full items-center gap-3 px-3.5 py-2.5 text-left ${
                      index > 0 ? "border-t border-white/[0.08]" : ""
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] transition-colors ${
                        on ? "bg-[#0A84FF] text-white" : "bg-white/[0.09] text-transparent"
                      }`}
                    >
                      <IconCheck size={12} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14.5px] font-medium text-white">
                        {group.name}
                      </span>
                      <span className="block truncate text-[12px] text-neutral-500">
                        {group.modifiers.map((m) => m.name).join(", ")}
                      </span>
                    </span>
                    <span className="mono shrink-0 text-[11px] text-neutral-500">
                      {group.min === group.max ? `pick ${group.min}` : `${group.min} to ${group.max}`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Stock */}
        <div className="panel-inset overflow-hidden">
          <div className="flex items-center gap-3 px-3.5 py-3">
            <span className="min-w-0 flex-1">
              <span className="block text-[14.5px] font-medium text-white">Track stock</span>
              <span className="block text-[12px] text-neutral-500">
                Count units down as the till sells them
              </span>
            </span>
            <Toggle
              checked={trackStock}
              label="Track stock"
              onChange={(value) => {
                const next = value ?? !trackStock;
                setTrackStock(next);
                if (next && stockText.trim() === "") setStockText("0");
              }}
            />
          </div>
          {trackStock && (
            <div className="grid gap-3 border-t border-white/[0.08] px-3.5 py-3 sm:grid-cols-2">
              <Field label="Stock on hand">
                <input
                  className="input mono"
                  value={stockText}
                  onChange={(e) => setStockText(e.target.value)}
                  placeholder="0"
                  inputMode="numeric"
                  autoComplete="off"
                />
              </Field>
              <Field label="Low stock at" hint="optional">
                <input
                  className="input mono"
                  value={lowStockText}
                  onChange={(e) => setLowStockText(e.target.value)}
                  placeholder="none"
                  inputMode="numeric"
                  autoComplete="off"
                />
              </Field>
            </div>
          )}
        </div>

        {/* Active */}
        <div className="panel-inset flex items-center gap-3 px-3.5 py-3">
          <span className="min-w-0 flex-1">
            <span className="block text-[14.5px] font-medium text-white">Active</span>
            <span className="block text-[12px] text-neutral-500">
              Inactive items stay in the catalogue but leave the till
            </span>
          </span>
          <Toggle checked={active} label="Active" onChange={(value) => setActive(value ?? !active)} />
        </div>

        <ErrorText message={error} />

        <div className="grid grid-cols-2 gap-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>{isEdit ? "Save Changes" : "Add Item"}</Button>
        </div>

        {isEdit &&
          (confirmingDelete ? (
            <div className="rounded-2xl border border-[#FF453A]/30 bg-[#FF453A]/10 p-3.5">
              <p className="text-[13px] leading-relaxed text-neutral-200">
                Delete {item.name}? Orders already rung up keep their lines, so the takings stay
                intact. The item simply stops being sellable.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2.5">
                <Button variant="secondary" onClick={() => setConfirmingDelete(false)}>
                  Keep Item
                </Button>
                <Button variant="danger" onClick={handleDelete}>
                  Delete
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-danger w-full"
              onClick={() => {
                triggerHaptic("warning");
                setConfirmingDelete(true);
              }}
            >
              Delete Item
            </button>
          ))}
      </div>
    </Modal>
  );
}
