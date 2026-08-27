"use client";

import { useMemo, useState } from "react";
import { formatTrezorAddress } from "@/lib/address-display";
import { FIAT_SYMBOLS, memoByteLength } from "@/lib/format";
import { triggerHaptic } from "@/lib/haptics";
import { assetKey, isNative, referencePrefix } from "@/lib/merchant/charge";
import { fmtMinor, minorToDecimal, toMinor } from "@/lib/merchant/money";
import type {
  AcceptedAsset,
  CounterCode,
  CounterCodeKind,
  Minor,
} from "@/lib/merchant/types";
import { useMerchant } from "@/hooks/useMerchant";
import { useWallet } from "@/hooks/useWallet";
import { useToast } from "../Toast";
import {
  Button,
  CopyButton,
  ErrorText,
  Field,
  Modal,
  ModalHeader,
  NetworkBadge,
  Notice,
  SegmentedControl,
  Select,
  Toggle,
} from "../ui";
import { IconCheck, IconClose, IconGift, IconPlus } from "../icons";
import { IconQr, IconTag } from "./icons";

export const CODE_KINDS: { label: string; value: CounterCodeKind }[] = [
  { label: "Fixed price", value: "fixed" },
  { label: "Open amount", value: "open" },
  { label: "Tip jar", value: "tip" },
];

export interface CodeKindMeta {
  label: string;
  blurb: string;
  hue: string;
}

export const CODE_KIND_META: Record<CounterCodeKind, CodeKindMeta> = {
  fixed: {
    label: "Fixed price",
    blurb: "Locks an exact asset amount when the code is published.",
    hue: "#0A84FF",
  },
  open: {
    label: "Open amount",
    blurb: "The payer enters an amount; incoming funds are priced when observed.",
    hue: "#64D2FF",
  },
  tip: {
    label: "Tip jar",
    blurb: "Prints suggestions while still allowing the payer to choose another amount.",
    hue: "#BF5AF2",
  },
};

export function CodeKindIcon({ kind, size = 17 }: { kind: CounterCodeKind; size?: number }) {
  if (kind === "fixed") return <IconTag size={size} />;
  if (kind === "tip") return <IconGift size={size} />;
  return <IconQr size={size} />;
}

function parseAmount(text: string): Minor | null {
  const raw = text.trim();
  if (raw === "" || raw === "." || !/^\d{0,9}(\.\d{0,2})?$/.test(raw)) return null;
  return toMinor(raw);
}

function dateInput(timestamp: number | null): string {
  if (timestamp === null) return "";
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function expiryTimestamp(value: string): number | null {
  if (!value) return null;
  const timestamp = new Date(`${value}T23:59:59.999`).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function CodeEditorModal({
  code,
  onClose,
}: {
  code: CounterCode | null;
  onClose: () => void;
}) {
  return <CodeEditor key={code?.id ?? "new-code"} code={code} onClose={onClose} />;
}

function CodeEditor({ code, onClose }: { code: CounterCode | null; onClose: () => void }) {
  const { network } = useWallet();
  const {
    counterCodeBlockedReason,
    counterCodePayUriFor,
    counterCodePreviewUri,
    createCounterCode,
    quotableAssets,
    settings,
    staff,
    updateCounterCode,
  } = useMerchant();
  const { toast } = useToast();
  const isEdit = code !== null;

  const [title, setTitle] = useState(code?.title ?? "");
  const [kind, setKind] = useState<CounterCodeKind>(code?.kind ?? "fixed");
  const [amountText, setAmountText] = useState(
    code?.amountMinor === null || code?.amountMinor === undefined
      ? ""
      : minorToDecimal(code.amountMinor),
  );
  const [suggested, setSuggested] = useState<Minor[]>(code?.suggestedMinor ?? [100, 200, 500]);
  const [suggestionText, setSuggestionText] = useState("");
  const [memoPrefix, setMemoPrefix] = useState(code?.memoPrefix ?? "");
  const [memoTouched, setMemoTouched] = useState(isEdit);
  const [staffId, setStaffId] = useState(code?.staffId ?? "");
  const [expiry, setExpiry] = useState(dateInput(code?.expiresAt ?? null));
  const [active, setActive] = useState(code?.active ?? true);
  const [today] = useState(() => dateInput(Date.now()));
  const [error, setError] = useState("");

  const currency = code?.currency ?? settings.currency;
  const symbol = FIAT_SYMBOLS[currency].trim();
  const currentPool = kind === "fixed" ? quotableAssets : settings.acceptedAssets;
  const assetPool = useMemo(() => {
    const entries = [...(code?.acceptedAssets ?? []), ...currentPool];
    return [...new Map(entries.map((asset) => [assetKey(asset), asset])).values()];
  }, [code, currentPool]);
  const [assetKeys, setAssetKeys] = useState(() =>
    (code?.acceptedAssets ?? currentPool).map(assetKey),
  );
  const chosenAssets = useMemo(
    () => assetPool.filter((asset) => assetKeys.includes(assetKey(asset))),
    [assetKeys, assetPool],
  );
  const [previewKey, setPreviewKey] = useState(assetKeys[0] ?? "");
  const previewAsset =
    chosenAssets.find((asset) => assetKey(asset) === previewKey) ?? chosenAssets[0] ?? null;
  const effectiveMemo = memoTouched ? memoPrefix : referencePrefix(title || "Code");
  const amountMinor = parseAmount(amountText);
  const memoBytes = memoByteLength(effectiveMemo);
  const activeStaff = staff.filter((member) => member.active);
  const uri = previewAsset
    ? isEdit
      ? counterCodePayUriFor(code, previewAsset)
      : counterCodePreviewUri({
          kind,
          amountMinor,
          asset: previewAsset,
          memo: effectiveMemo,
          title: title.trim() || "Counter code",
        })
    : null;

  function chooseKind(next: CounterCodeKind) {
    if (isEdit) return;
    const nextPool = next === "fixed" ? quotableAssets : settings.acceptedAssets;
    setKind(next);
    setAssetKeys(nextPool.map(assetKey));
    setPreviewKey(nextPool[0] ? assetKey(nextPool[0]) : "");
    setError("");
  }

  function toggleAsset(asset: AcceptedAsset) {
    if (isEdit) return;
    triggerHaptic("selection");
    const key = assetKey(asset);
    setAssetKeys((previous) =>
      previous.includes(key) ? previous.filter((entry) => entry !== key) : [...previous, key],
    );
  }

  function addSuggestion() {
    const minor = parseAmount(suggestionText);
    if (minor === null || minor <= 0) {
      setError("A suggested amount has to be above zero.");
      triggerHaptic("error");
      return;
    }
    if (suggested.includes(minor)) {
      setError(`${fmtMinor(minor, currency)} is already suggested.`);
      triggerHaptic("error");
      return;
    }
    setSuggested((previous) => [...previous, minor].sort((a, b) => a - b));
    setSuggestionText("");
    setError("");
    triggerHaptic("light");
  }

  async function handleSave() {
    setError("");
    try {
      const saved = code
        ? await updateCounterCode({
            codeId: code.id,
            title,
            suggestedMinor: code.kind === "fixed" ? [] : suggested,
            staffId: code.kind === "tip" ? staffId || null : null,
            expiresAt: expiryTimestamp(expiry),
            active,
          })
        : await createCounterCode({
            title,
            kind,
            amountMinor: kind === "fixed" ? amountMinor : null,
            suggestedMinor: kind === "fixed" ? [] : suggested,
            acceptedAssets: chosenAssets,
            memoPrefix: effectiveMemo,
            staffId: kind === "tip" ? staffId || null : null,
            expiresAt: expiryTimestamp(expiry),
            active,
          });
      triggerHaptic("success");
      toast(`${saved.title} ${code ? "updated" : "published"}.`, "success");
      onClose();
    } catch (caught) {
      triggerHaptic("error");
      setError(caught instanceof Error ? caught.message : "The counter code could not be saved.");
    }
  }

  return (
    <Modal open onClose={onClose} wide>
      <ModalHeader
        title={isEdit ? "Edit counter code" : "New counter code"}
        subtitle={
          code
            ? `${CODE_KIND_META[code.kind].label} · ${code.payments} payments`
            : "Publish a reusable Stellar payment request"
        }
        onClose={onClose}
      />

      <div className="space-y-5 p-4 sm:p-6">
        {!isEdit && counterCodeBlockedReason && <Notice tone="warn">{counterCodeBlockedReason}</Notice>}
        {isEdit && (
          <Notice tone="warn">
            The network, receiving account, memo, assets and fixed quote are frozen. Copied and
            printed requests cannot be recalled; create a new code to change payment details.
          </Notice>
        )}

        <Field label="Title">
          <input
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Tip jar"
            maxLength={48}
            autoFocus
          />
        </Field>

        <div className="space-y-2">
          <span className="field-label">What it asks for</span>
          <SegmentedControl
            value={kind}
            options={CODE_KINDS.map((option) => ({ ...option, disabled: isEdit }))}
            onChange={chooseKind}
          />
          <p className="flex items-start gap-2 text-[12px] leading-relaxed text-neutral-400">
            <span aria-hidden="true" style={{ color: CODE_KIND_META[kind].hue }}>
              <CodeKindIcon kind={kind} size={14} />
            </span>
            {CODE_KIND_META[kind].blurb}
          </p>
        </div>

        {kind === "fixed" ? (
          <Field label="Shop price" hint={isEdit ? "publication value" : "quoted when saved"}>
            <div className="input flex items-center gap-2">
              <span className="mono text-[13px] text-neutral-500">{symbol}</span>
              <input
                className="mono min-w-0 flex-1 bg-transparent text-base text-white outline-none disabled:text-neutral-400"
                value={amountText}
                onChange={(event) => setAmountText(event.target.value)}
                placeholder="0.00"
                inputMode="decimal"
                autoComplete="off"
                disabled={isEdit}
                aria-label="Shop price"
              />
            </div>
          </Field>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="field-label !pb-0">Suggested amounts</span>
              <span className="text-[11px] text-neutral-400">{suggested.length || "none"}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {suggested.map((minor) => (
                <span key={minor} className="chip !cursor-default gap-1.5 !py-1.5 !pr-1.5">
                  {fmtMinor(minor, currency)}
                  <button
                    type="button"
                    className="flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.1] text-neutral-400"
                    aria-label={`Remove ${fmtMinor(minor, currency)}`}
                    onClick={() => setSuggested((previous) => previous.filter((value) => value !== minor))}
                  >
                    <IconClose size={10} />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <div className="input flex min-w-0 flex-1 items-center gap-2">
                <span className="mono text-[13px] text-neutral-500">{symbol}</span>
                <input
                  className="mono min-w-0 flex-1 bg-transparent text-base text-white outline-none"
                  value={suggestionText}
                  onChange={(event) => setSuggestionText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addSuggestion();
                    }
                  }}
                  placeholder="2.00"
                  inputMode="decimal"
                  aria-label="New suggested amount"
                />
              </div>
              <Button variant="secondary" onClick={addSuggestion} aria-label="Add suggestion">
                <IconPlus size={15} /> Add
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <span className="field-label">Accepted assets</span>
          {assetPool.length === 0 ? (
            <Notice tone="warn">
              {kind === "fixed"
                ? "No accepted asset has a live price, so a fixed request cannot be published yet."
                : "Add an accepted asset in Merchant settings first."}
            </Notice>
          ) : (
            <div className="panel-inset overflow-hidden">
              {assetPool.map((asset, index) => {
                const key = assetKey(asset);
                const selected = assetKeys.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    disabled={isEdit}
                    onClick={() => toggleAsset(asset)}
                    className={`row-hover flex w-full items-center gap-3 px-3.5 py-3 text-left disabled:cursor-default ${index > 0 ? "border-t border-white/[0.08]" : ""}`}
                  >
                    <span className={`flex h-[22px] w-[22px] items-center justify-center rounded-[7px] ${selected ? "bg-[#0A84FF] text-white" : "bg-white/[0.09] text-transparent"}`}>
                      <IconCheck size={12} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="mono block text-[14px] font-semibold text-white">{asset.code}</span>
                      <span className="block truncate text-[11.5px] text-neutral-500">
                        {isNative(asset) ? "Native Stellar asset" : formatTrezorAddress(asset.issuer ?? "")}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <Field label="Memo" hint={`${memoBytes} of 28 bytes`}>
          <input
            className="input mono disabled:text-neutral-400"
            value={effectiveMemo}
            disabled={isEdit}
            onChange={(event) => {
              setMemoTouched(true);
              setMemoPrefix(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 28));
            }}
            placeholder="TIP"
            autoComplete="off"
          />
        </Field>

        {kind === "tip" && (
          <Field label="Attributed to" hint="optional">
            <Select
              value={staffId}
              ariaLabel="Staff member this tip code is attributed to"
              onChange={setStaffId}
              options={[
                { value: "", label: "The whole shop", sublabel: "pooled" },
                ...activeStaff.map((member) => ({
                  value: member.id,
                  label: member.name,
                  sublabel: member.role,
                })),
              ]}
            />
          </Field>
        )}

        <Field label="Stops reconciling after" hint="optional · end of local day">
          <input
            className="input"
            type="date"
            value={expiry}
            min={today}
            onChange={(event) => setExpiry(event.target.value)}
          />
        </Field>

        <div className="panel-inset flex items-center gap-3 px-3.5 py-3">
          <span className="min-w-0 flex-1">
            <span className="block text-[14.5px] font-medium text-white">In use</span>
            <span className="block text-[12px] text-neutral-500">
              Retiring stops automatic filing; remove any printed copies as well.
            </span>
          </span>
          <Toggle checked={active} label="In use" onChange={(value) => setActive(value ?? !active)} />
        </div>

        <section aria-labelledby="counter-request-preview" className="panel-inset p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="counter-request-preview" className="text-[13px] font-semibold text-white">
              Exact wallet request
            </h3>
            <NetworkBadge network={code?.network ?? network} />
          </div>
          {chosenAssets.length > 1 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {chosenAssets.map((asset) => {
                const key = assetKey(asset);
                const selected = previewAsset !== null && assetKey(previewAsset) === key;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setPreviewKey(key)}
                    className={`mono rounded-full px-2.5 py-1 text-[11px] font-semibold ${selected ? "bg-[#0A84FF] text-white" : "bg-white/[0.08] text-neutral-400"}`}
                  >
                    {asset.code}
                  </button>
                );
              })}
            </div>
          )}
          {uri ? (
            <>
              <p className="mono mt-2 break-all rounded-xl bg-black/40 p-3 text-[11.5px] leading-relaxed text-neutral-300">{uri}</p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <CopyButton value={uri} label="Copy request" />
                <span className="mono text-[11px] text-neutral-500">
                  {formatTrezorAddress(code?.destination ?? settings.receivingPublicKey ?? "")}
                </span>
              </div>
              <p className="mt-2 text-[11.5px] leading-relaxed text-neutral-500">
                {kind === "fixed"
                  ? isEdit
                    ? "This is the exact asset amount locked when the code was published."
                    : "Saving locks the current live asset amount into every future copy and poster."
                  : "No amount is embedded; the payer chooses one and the ledger records what arrives."}
              </p>
            </>
          ) : (
            <p className="mt-2 text-[12px] leading-relaxed text-neutral-400">
              Choose an asset and enter valid payment details to preview the request.
            </p>
          )}
        </section>

        <ErrorText message={error} />
        <div className="grid grid-cols-2 gap-3">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!isEdit && Boolean(counterCodeBlockedReason)} onClick={handleSave}>
            {isEdit ? "Save changes" : "Publish code"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
