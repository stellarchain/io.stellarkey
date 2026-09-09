"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatTrezorAddress } from "@/lib/address-display";
import { FIAT_SYMBOLS, memoByteLength } from "@/lib/format";
import { triggerHaptic } from "@/lib/haptics";
import { assetKey, isNative, referencePrefix } from "@/lib/merchant/charge";
import { fmtMinor, minorToDecimal, toMinor } from "@/lib/merchant/money";
import { counterReference } from "@/lib/merchant/payment-reference";
import { createMerchantRoutingId } from "@/lib/merchant/routing";
import type {
  AcceptedAsset,
  CounterCode,
  CounterCodeKind,
  Minor,
} from "@/lib/merchant/types";
import {
  useMerchantConfiguration,
  useMerchantRecords,
  useMerchantStaff,
  useMerchantStatus,
} from "@/hooks/useMerchant";
import { useWalletIdentity } from "@/hooks/useWallet";
import { useToast } from "../Toast";
import {
  Button,
  CopyButton,
  ErrorText,
  Field,
  FieldLabelRow,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  NetworkBadge,
  Notice,
  SegmentedControl,
  Select,
  Toggle,
  useModalContext,
  useRetainedForExit,
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
  if (value === "") return null;
  const timestamp = new Date(`${value}T23:59:59.999`).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function CodeEditorModal({
  open,
  code,
  onClose,
}: {
  open: boolean;
  code: CounterCode | null;
  onClose: () => void;
}) {
  // Keyed per code so stepping between rows starts clean; an edited code stays
  // rendered through the exit so the key never flips mid-animation.
  const retained = useRetainedForExit(code);
  const shownCode = open ? code : retained;
  const [pending, setPending] = useState(false);
  const [dirty, setDirty] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      busy={pending}
      busyReason="Wait for the counter code to be saved before closing."
      dirty={dirty}
      initialFocus={titleRef}
    >
      <CodeEditor
        key={shownCode?.id ?? "new-code"}
        code={shownCode}
        onClose={onClose}
        titleRef={titleRef}
        pending={pending}
        onPendingChange={setPending}
        onDirtyChange={setDirty}
      />
    </Modal>
  );
}

function CodeEditor({
  code,
  onClose,
  titleRef,
  pending,
  onPendingChange,
  onDirtyChange,
}: {
  code: CounterCode | null;
  onClose: () => void;
  titleRef: React.RefObject<HTMLInputElement | null>;
  pending: boolean;
  onPendingChange: (pending: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const modal = useModalContext();
  const { network } = useWalletIdentity();
  const {
    counterCodeBlockedReason,
    counterCodePayUriFor,
    counterCodePreviewUri,
    createCounterCode,
    updateCounterCode,
  } = useMerchantRecords();
  const { quotableAssets, marketPriceStatus, retryMarketPrices } = useMerchantStatus();
  const { settings } = useMerchantConfiguration();
  const { staff } = useMerchantStaff();
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
  const [memoPrefix, setMemoPrefix] = useState("");
  const [memoTouched, setMemoTouched] = useState(isEdit);
  const [staffId, setStaffId] = useState(code?.staffId ?? "");
  const [expiry, setExpiry] = useState(dateInput(code?.expiresAt ?? null));
  const [active, setActive] = useState(code?.active ?? true);
  const [previewRoutingId] = useState(() => code?.routingId ?? createMerchantRoutingId());
  const [today] = useState(() => dateInput(Date.now()));
  const [error, setError] = useState("");
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
  const memoSuffix = memoTouched ? memoPrefix : referencePrefix(title || "Code");
  let effectiveMemo: string | null = code?.memoPrefix ?? null;
  if (!code) {
    try {
      effectiveMemo = counterReference(settings.profile.name || "Till", memoSuffix);
    } catch {
      effectiveMemo = null;
    }
  }
  const amountMinor = parseAmount(amountText);
  const memoBytes = memoByteLength(effectiveMemo ?? memoSuffix);

  /* Unsaved edits: anything that differs from the code, or from a blank form. */
  const draftKey = JSON.stringify({
    title,
    kind,
    amountText,
    suggested,
    memoPrefix: memoTouched ? memoPrefix : null,
    staffId,
    expiry,
    active,
    assetKeys,
  });
  const [initialKey] = useState(draftKey);
  const isDirty = draftKey !== initialKey;
  useEffect(() => {
    onDirtyChange(isDirty);
    return () => onDirtyChange(false);
  }, [isDirty, onDirtyChange]);
  const activeStaff = staff.filter((member) => member.active);
  const uri = previewAsset && effectiveMemo
    ? isEdit
      ? counterCodePayUriFor(code, previewAsset)
      : counterCodePreviewUri({
          kind,
          amountMinor,
          asset: previewAsset,
          routingId: previewRoutingId,
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
  }

  async function handleSave() {
    if (pending) return;
    setError("");
    onPendingChange(true);
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
            memoPrefix: memoSuffix,
            staffId: kind === "tip" ? staffId || null : null,
            expiresAt: expiryTimestamp(expiry),
            active,
            routingId: previewRoutingId,
          });
      triggerHaptic("success");
      toast(`${saved.title} ${code ? "updated" : "published"}.`, "success", { silent: true });
      onClose();
    } catch (caught) {
      triggerHaptic("error");
      setError(caught instanceof Error ? caught.message : "The counter code could not be saved.");
    } finally {
      onPendingChange(false);
    }
  }

  return (
    <>
      <ModalHeader
        title={isEdit ? "Edit counter code" : "New Counter Code"}
        subtitle={
          code
            ? `${CODE_KIND_META[code.kind].label} · ${code.payments} payments`
            : "Publish a reusable Stellar payment request"
        }
        onClose={onClose}
      />

      <ModalBody gap={5}>
        {!isEdit && counterCodeBlockedReason && <Notice tone="warn">{counterCodeBlockedReason}</Notice>}
        {isEdit && (
          <Notice tone="warn">
            The network, receiving account, payment route, assets and fixed quote are frozen. Copied and
            printed requests cannot be recalled; create a new code to change payment details.
          </Notice>
        )}

        <Field label="Title">
          <input
            ref={titleRef}
            className="input text-base sm:text-[14px]"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="What this code is for"
            maxLength={48}
            enterKeyHint="next"
            autoCapitalize="words"
          />
        </Field>

        <div className="space-y-2">
          <span className="field-label">What it asks for</span>
          <SegmentedControl
            ariaLabel="Code type"
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
          <Field label="Shop Price" hint={isEdit ? "publication value" : "quoted when saved"}>
            <div className="input flex items-center gap-2">
              <span className="mono text-[13px] text-neutral-500">{symbol}</span>
              <input
                className="mono min-w-0 flex-1 bg-transparent text-base text-white outline-none disabled:text-neutral-400"
                value={amountText}
                onChange={(event) => setAmountText(event.target.value)}
                placeholder="0.00"
                inputMode="decimal"
                enterKeyHint="next"
                autoComplete="off"
                disabled={isEdit}
                aria-label="Shop price"
              />
            </div>
          </Field>
        ) : (
          <div className="space-y-2">
            <FieldLabelRow label="Suggested Amounts" meta={suggested.length || "none"} className="!pb-0" />
            <div className="flex flex-wrap gap-2">
              {suggested.map((minor) => (
                <span key={minor} className="chip !cursor-default gap-1 !py-0 !pr-0">
                  {fmtMinor(minor, currency)}
                  <button
                    type="button"
                    className="flex items-center justify-center rounded-full text-neutral-400 transition-colors hover:text-white"
                    aria-label={`Remove ${fmtMinor(minor, currency)}`}
                    onClick={() => setSuggested((previous) => previous.filter((value) => value !== minor))}
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.1]">
                      <IconClose size={10} />
                    </span>
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
                  enterKeyHint="done"
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

        <Field
          label="Reference Suffix"
          hint={effectiveMemo ? `${effectiveMemo} · ${memoBytes} of 28 bytes` : "Use uppercase letters or numbers"}
        >
          <input
            className="input mono disabled:text-neutral-400"
            value={code?.memoPrefix ?? memoSuffix}
            disabled={isEdit}
            onChange={(event) => {
              setMemoTouched(true);
              setMemoPrefix(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 28));
            }}
            placeholder="TIP"
            autoComplete="off"
            autoCapitalize="characters"
            enterKeyHint="next"
          />
        </Field>

        {kind === "tip" && (
          <Field label="Attributed To" hint="optional">
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

        <Field label="Stops Reconciling After" hint="optional · end of local day">
          <input
            className="input text-base sm:text-[14px]"
            type="date"
            value={expiry}
            min={today}
            onChange={(event) => setExpiry(event.target.value)}
            enterKeyHint="done"
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
                    className={`mono rounded-full px-3.5 text-[12px] font-semibold transition-colors ${selected ? "bg-[#0A84FF] text-white" : "bg-white/[0.08] text-neutral-400 hover:text-white"}`}
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
        {!isEdit && kind === "fixed" && (quotableAssets.length === 0 || error.startsWith("No live price")) && (
          <div className="space-y-2">
            <p className="text-xs text-neutral-400">{marketPriceStatus}</p>
            <Button variant="secondary" loading={pricesRefreshing} disabled={pricesRefreshing} onClick={retryPrices}>Retry Prices</Button>
          </div>
        )}
        <ModalFooter
          secondary={
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                if (modal) modal.requestClose("close");
                else onClose();
              }}
            >
              Cancel
            </Button>
          }
          primary={
            <Button
              type="button"
              disabled={!isEdit && Boolean(counterCodeBlockedReason)}
              loading={pending}
              onClick={handleSave}
            >
              {isEdit ? "Save Changes" : "Publish Code"}
            </Button>
          }
        />
      </ModalBody>
    </>
  );
}
