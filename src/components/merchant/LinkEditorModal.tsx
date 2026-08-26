"use client";

/**
 * DESIGN MOCK — the counter-code editor.
 *
 * What is mocked: nothing is written. The editor works on a local draft of a
 * `CounterCode` and hands it back to its caller, which keeps it in component
 * state for the length of the session. The SEP-7 preview is built for real by
 * `buildSep7PayUri`, but the asset figure behind a fixed-price preview comes
 * from the illustrative rate table below — not from a quote.
 *
 * What a real implementation replaces: persistence through the merchant store,
 * and the example rate, which the shop would take from the same source the till
 * quotes with (`useMerchant().quotableAssets`) at the moment it prints. Nothing
 * here would ever sign: a counter code is a request against the shop's own
 * account, exactly like a charge.
 *
 * This module also owns the pieces every code surface shares — kind metadata
 * and the URI builder — so the page, the poster and the editor cannot drift
 * apart.
 */

import { useMemo, useState } from "react";
import { useMerchant } from "@/hooks/useMerchant";
import { useWallet } from "@/hooks/useWallet";
import { FIAT_SYMBOLS, memoByteLength } from "@/lib/format";
import { triggerHaptic } from "@/lib/haptics";
import { buildSep7PayUri } from "@/lib/payuri";
import { NETWORKS } from "@/lib/stellar";
import { assetKey, isNative, referencePrefix } from "@/lib/merchant/charge";
import { MOCK_NOW, MOCK_STAFF, MOCK_TILL_ADDRESS, MOCK_USDC, MOCK_XLM } from "@/lib/merchant/mock";
import {
  assetAmountFor,
  fmtMinor,
  minorToDecimal,
  roundMinor,
  toMinor,
  unitPriceE6,
} from "@/lib/merchant/money";
import type {
  AcceptedAsset,
  CounterCode,
  CounterCodeKind,
  Minor,
} from "@/lib/merchant/types";
import { useToast } from "../Toast";
import {
  Button,
  CopyButton,
  ErrorText,
  Field,
  Modal,
  ModalHeader,
  SegmentedControl,
  Select,
  Toggle,
} from "../ui";
import { IconCheck, IconClose, IconGift, IconPlus } from "../icons";
import { IconQr, IconTag } from "./icons";

/* ------------------------------------------------------------------ */
/* Shared counter-code vocabulary                                      */
/* ------------------------------------------------------------------ */

export const CODE_KINDS: { label: string; value: CounterCodeKind }[] = [
  { label: "Fixed price", value: "fixed" },
  { label: "Open amount", value: "open" },
  { label: "Tip jar", value: "tip" },
];

export interface CodeKindMeta {
  /** Full name, used wherever there is room for it. */
  label: string;
  /** What the printed card asks for. */
  blurb: string;
  /** Categorical hue. Green is money-in and merchant identity, so never here. */
  hue: string;
}

export const CODE_KIND_META: Record<CounterCodeKind, CodeKindMeta> = {
  fixed: {
    label: "Fixed price",
    blurb: "One price, carried by the code itself. The payer's wallet opens on it.",
    hue: "#0A84FF",
  },
  open: {
    label: "Open amount",
    blurb: "No amount on the code. The payer types one; the card prints your suggestions.",
    hue: "#64D2FF",
  },
  tip: {
    label: "Tip jar",
    blurb: "Suggested amounts printed on the card, and any figure the payer types instead.",
    hue: "#BF5AF2",
  },
};

/**
 * There is no code glyph in the icon set and this assignment does not own
 * `icons.tsx`, so each kind borrows the closest existing one: a price tag for a
 * fixed price, a gift for a tip jar, and the QR itself for an open amount.
 */
export function CodeKindIcon({ kind, size = 17 }: { kind: CounterCodeKind; size?: number }) {
  if (kind === "fixed") return <IconTag size={size} />;
  if (kind === "tip") return <IconGift size={size} />;
  return <IconQr size={size} />;
}

/**
 * Rates used *only* to show what a fixed-price preview would look like in an
 * asset. They are not a quote, they never leave this preview, and they are
 * unrelated to `settings.testnetDemoRates`, which governs the till.
 */
const PREVIEW_UNIT_PRICE: Record<string, number> = {
  USDC: 0.92,
  EURC: 1,
  XLM: 0.2532,
};

/** Shop currency per one whole unit of the asset, or null when unlisted. */
export function previewRateFor(asset: AcceptedAsset): number | null {
  return PREVIEW_UNIT_PRICE[asset.code.toUpperCase()] ?? null;
}

/** The seven-decimal figure a fixed-price code would carry, at the example rate. */
export function previewAssetAmount(amountMinor: Minor, asset: AcceptedAsset): string | null {
  const rate = previewRateFor(asset);
  if (rate === null || amountMinor <= 0) return null;
  return assetAmountFor(amountMinor, unitPriceE6(rate));
}

/** The SEP-7 request a counter code carries, once an asset has been named. */
export function codePayUri({
  destination,
  asset,
  memo,
  message,
  networkPassphrase,
  amount,
}: {
  destination: string;
  asset: AcceptedAsset;
  memo: string;
  message: string;
  networkPassphrase: string;
  /** Omitted for an open or tip code: the payer's wallet asks for the figure. */
  amount?: string | null;
}): string {
  return buildSep7PayUri({
    destination,
    amount: amount ?? undefined,
    assetCode: isNative(asset) ? undefined : asset.code,
    assetIssuer: isNative(asset) ? undefined : (asset.issuer ?? undefined),
    memo,
    memoType: "text",
    msg: message || undefined,
    networkPassphrase,
  });
}

/* ------------------------------------------------------------------ */
/* The editor                                                          */
/* ------------------------------------------------------------------ */

/**
 * A local id for a newly drafted code. Nothing is persisted from this screen, so
 * it only has to be unique inside the session.
 */
function newCodeId(memo: string): string {
  return `cc_${memo.toLowerCase()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** A plain decimal amount in minor units, or null when the text is not one. */
function parseAmount(text: string): Minor | null {
  const raw = text.trim();
  if (raw === "" || raw === "." || !/^\d{0,9}(\.\d{0,2})?$/.test(raw)) return null;
  return toMinor(raw);
}

export function CodeEditorModal({
  code,
  onClose,
  onSave,
}: {
  /** null opens the editor on a new code. */
  code: CounterCode | null;
  onClose: () => void;
  /** Hands the draft back. The caller keeps it in state; nothing is persisted. */
  onSave: (draft: CounterCode) => void;
}) {
  // Keyed so moving straight from one code to another starts on clean state.
  return (
    <CodeEditor key={code?.id ?? "new-code"} code={code} onClose={onClose} onSave={onSave} />
  );
}

function CodeEditor({
  code,
  onClose,
  onSave,
}: {
  code: CounterCode | null;
  onClose: () => void;
  onSave: (draft: CounterCode) => void;
}) {
  const { settings } = useMerchant();
  const { network } = useWallet();
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
  const [active, setActive] = useState(code?.active ?? true);
  const [error, setError] = useState("");

  const currency = code?.currency ?? settings.currency;
  const symbol = FIAT_SYMBOLS[currency].trim();

  /* Everything this shop could plausibly accept on a code: what it takes at the
     till, what the code already takes, and the two assets the fixtures use. */
  const assetPool = useMemo(() => {
    const pool: AcceptedAsset[] = [
      ...settings.acceptedAssets,
      ...(code?.acceptedAssets ?? []),
      MOCK_USDC,
      MOCK_XLM,
    ];
    const seen = new Map<string, AcceptedAsset>();
    for (const asset of pool) if (!seen.has(assetKey(asset))) seen.set(assetKey(asset), asset);
    return [...seen.values()];
  }, [code, settings.acceptedAssets]);

  const [assetKeys, setAssetKeys] = useState<string[]>(() =>
    (code?.acceptedAssets ?? settings.acceptedAssets).map(assetKey),
  );
  const chosenAssets = useMemo(
    () => assetPool.filter((asset) => assetKeys.includes(assetKey(asset))),
    [assetKeys, assetPool],
  );

  const [previewKey, setPreviewKey] = useState<string>(() => assetKeys[0] ?? "");
  const previewAsset =
    chosenAssets.find((asset) => assetKey(asset) === previewKey) ?? chosenAssets[0] ?? null;

  /* A printed code cannot count, so its memo never moves: every payment against
     this card carries exactly this text, and Horizon totals the account on it. */
  const effectiveMemo = memoTouched ? memoPrefix : referencePrefix(title || "Code");
  const amountMinor = parseAmount(amountText);
  const memoBytes = memoByteLength(effectiveMemo);

  const destination = settings.receivingPublicKey ?? MOCK_TILL_ADDRESS;
  const usingFixtureAddress = settings.receivingPublicKey === null;
  const shopName = settings.profile.name.trim() || "Your shop";
  const previewAmount =
    kind === "fixed" && previewAsset && amountMinor !== null
      ? previewAssetAmount(amountMinor, previewAsset)
      : null;
  const previewRate = previewAsset ? previewRateFor(previewAsset) : null;

  const uri = previewAsset
    ? codePayUri({
        destination,
        asset: previewAsset,
        memo: effectiveMemo,
        message: `${shopName} · ${title.trim() || "Counter code"}`,
        networkPassphrase: NETWORKS[network].networkPassphrase,
        amount: previewAmount,
      })
    : null;

  function toggleAsset(asset: AcceptedAsset) {
    triggerHaptic("selection");
    const key = assetKey(asset);
    setAssetKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  function addSuggestion() {
    const minor = parseAmount(suggestionText);
    if (minor === null || minor <= 0) {
      setError("A suggested amount has to be a figure above zero.");
      triggerHaptic("error");
      return;
    }
    if (suggested.includes(minor)) {
      setError(`${fmtMinor(minor, currency)} is already suggested.`);
      triggerHaptic("error");
      return;
    }
    triggerHaptic("light");
    setError("");
    setSuggested((prev) => [...prev, minor].sort((a, b) => a - b));
    setSuggestionText("");
  }

  function handleSave() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Give the code a title. It is what the customer reads above the amount.");
      triggerHaptic("error");
      return;
    }
    if (!/^[A-Z0-9]{1,12}$/.test(effectiveMemo)) {
      setError("A memo is 1 to 12 characters, letters and digits only.");
      triggerHaptic("error");
      return;
    }
    if (chosenAssets.length === 0) {
      setError("Accept at least one asset, or there is nothing for the code to ask for.");
      triggerHaptic("error");
      return;
    }
    if (kind === "fixed" && (amountMinor === null || amountMinor <= 0)) {
      setError("A fixed-price code needs a price above zero.");
      triggerHaptic("error");
      return;
    }

    const draft: CounterCode = {
      id: code?.id ?? newCodeId(effectiveMemo),
      title: trimmedTitle,
      kind,
      amountMinor: kind === "fixed" ? amountMinor : null,
      suggestedMinor: kind === "fixed" ? [] : suggested,
      currency,
      acceptedAssets: chosenAssets,
      memoPrefix: effectiveMemo,
      staffId: kind === "tip" ? (staffId || null) : null,
      active,
      payments: code?.payments ?? 0,
      takingsMinor: code?.takingsMinor ?? 0,
      createdAt: code?.createdAt ?? MOCK_NOW,
    };

    onSave(draft);
    triggerHaptic("success");
    toast(
      isEdit
        ? `${draft.title} updated on this screen only — a changed code means a reprinted card`
        : `${draft.title} saved on this screen only. Print its card from the poster.`,
      "success",
    );
    onClose();
  }

  return (
    <Modal open onClose={onClose} wide>
      <ModalHeader
        title={isEdit ? "Edit counter code" : "New counter code"}
        subtitle={
          code !== null
            ? `${CODE_KIND_META[code.kind].label} · ${code.payments} payments taken`
            : "A request you print once and stand on the counter"
        }
        onClose={onClose}
      />

      <div className="space-y-5 p-4 sm:p-6">
        <Field label="Title">
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Tip jar"
            maxLength={48}
            autoFocus
          />
        </Field>

        {/* Kind */}
        <div className="space-y-2">
          <span className="field-label">What it asks for</span>
          <SegmentedControl<CounterCodeKind>
            value={kind}
            options={CODE_KINDS}
            onChange={(next) => {
              setKind(next);
              setError("");
            }}
          />
          <p className="flex items-start gap-2 text-[12px] leading-relaxed text-neutral-400">
            <span
              aria-hidden="true"
              className="mt-[1px] shrink-0"
              style={{ color: CODE_KIND_META[kind].hue }}
            >
              <CodeKindIcon kind={kind} size={14} />
            </span>
            {CODE_KIND_META[kind].blurb}
          </p>
        </div>

        {/* Amount, or suggestions */}
        {kind === "fixed" ? (
          <div className="space-y-1.5">
            <span className="field-label">Price</span>
            <div className="input flex items-center gap-2 focus-within:shadow-[0_0_0_3.5px_rgba(10,132,255,0.35)]">
              <span aria-hidden="true" className="mono shrink-0 text-[13px] text-neutral-500">
                {symbol}
              </span>
              <input
                className="mono min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-neutral-500 sm:text-[15.5px]"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                placeholder="0.00"
                inputMode="decimal"
                spellCheck={false}
                autoComplete="off"
                aria-label="Price"
              />
            </div>
            <p className="text-[11.5px] text-neutral-500">
              Asks for{" "}
              <span className="mono text-neutral-300">
                {fmtMinor(amountMinor ?? 0, currency)}
              </span>{" "}
              every time it is scanned.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="field-label !pb-0">Suggested amounts</span>
              <span className="text-[11px] text-neutral-400">
                {suggested.length === 0 ? "none — the payer types one" : `${suggested.length} printed`}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {suggested.map((minor) => (
                <span
                  key={minor}
                  className="chip !cursor-default gap-1.5 !py-1.5 !pr-1.5 text-neutral-200"
                >
                  {fmtMinor(minor, currency)}
                  <button
                    type="button"
                    aria-label={`Remove the ${fmtMinor(minor, currency)} suggestion`}
                    onClick={() => {
                      triggerHaptic("selection");
                      setSuggested((prev) => prev.filter((m) => m !== minor));
                    }}
                    className="flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.1] text-neutral-400 transition-colors hover:bg-[#FF453A]/20 hover:text-[#FF453A]"
                  >
                    <IconClose size={10} />
                  </button>
                </span>
              ))}
              {suggested.length === 0 && (
                <span className="text-[12px] text-neutral-500">
                  No suggestion — the card just carries the code.
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <div className="input flex min-w-0 flex-1 items-center gap-2 focus-within:shadow-[0_0_0_3.5px_rgba(10,132,255,0.35)]">
                <span aria-hidden="true" className="mono shrink-0 text-[13px] text-neutral-500">
                  {symbol}
                </span>
                <input
                  className="mono min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-neutral-500 sm:text-[15.5px]"
                  value={suggestionText}
                  onChange={(e) => setSuggestionText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addSuggestion();
                    }
                  }}
                  placeholder="2.00"
                  inputMode="decimal"
                  spellCheck={false}
                  autoComplete="off"
                  aria-label="New suggested amount"
                />
              </div>
              <Button
                variant="secondary"
                className="shrink-0 !px-4"
                onClick={addSuggestion}
                aria-label="Add suggested amount"
              >
                <IconPlus size={15} />
                Add
              </Button>
            </div>
          </div>
        )}

        {/* Accepted assets */}
        <div className="space-y-2">
          <span className="field-label">Accepted assets</span>
          <div className="panel-inset overflow-hidden">
            {assetPool.map((asset, index) => {
              const key = assetKey(asset);
              const on = assetKeys.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => toggleAsset(asset)}
                  className={`row-hover flex w-full items-center gap-3 px-3.5 py-3 text-left ${
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
                    <span className="mono block truncate text-[14px] font-semibold text-white">
                      {asset.code}
                    </span>
                    <span className="block truncate text-[11.5px] text-neutral-500">
                      {isNative(asset)
                        ? "Native asset — no trustline needed"
                        : `Issued by ${asset.issuer?.slice(0, 4)}…${asset.issuer?.slice(-4)}`}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Memo */}
        <Field label="Memo" hint={`${memoBytes} of 28 bytes`}>
          <input
            className="input mono"
            value={effectiveMemo}
            onChange={(e) => {
              setMemoTouched(true);
              setMemoPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12));
            }}
            placeholder="TIP"
            spellCheck={false}
            autoComplete="off"
          />
        </Field>
        <p className="-mt-3 text-[11.5px] leading-relaxed text-neutral-500">
          Paper cannot count, so the memo never moves: every payment against this code carries{" "}
          <span className="mono text-neutral-300">{effectiveMemo || "—"}</span>. Horizon totals the
          receiving account on it, and that is where the payment count and takings come from.
        </p>

        {/* Staff attribution */}
        {kind === "tip" && (
          <Field label="Attributed to" hint="tips split by whoever earned them">
            <Select
              value={staffId}
              ariaLabel="Staff member this tip code is attributed to"
              onChange={setStaffId}
              options={[
                { value: "", label: "The whole shop", sublabel: "pooled" },
                ...MOCK_STAFF.filter((member) => member.active).map((member) => ({
                  value: member.id,
                  label: member.name,
                  sublabel: member.role,
                })),
              ]}
            />
          </Field>
        )}

        {/* In use */}
        <div className="panel-inset flex items-center gap-3 px-3.5 py-3">
          <span className="min-w-0 flex-1">
            <span className="block text-[14.5px] font-medium text-white">In use</span>
            <span className="block text-[12px] leading-relaxed text-neutral-500">
              A retired code keeps its takings. Nothing revokes paper — take the card off the
              counter and it stops being scanned.
            </span>
          </span>
          <Toggle checked={active} label="In use" onChange={(value) => setActive(value ?? !active)} />
        </div>

        {/* SEP-7 preview */}
        <section aria-labelledby="code-uri-preview" className="panel-inset p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="code-uri-preview" className="text-[13px] font-semibold text-white">
              What the code carries
            </h3>
            {chosenAssets.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {chosenAssets.map((asset) => {
                  const key = assetKey(asset);
                  const on = previewAsset !== null && assetKey(previewAsset) === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        triggerHaptic("selection");
                        setPreviewKey(key);
                      }}
                      className={`mono rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                        on
                          ? "bg-[#0A84FF] text-white"
                          : "bg-white/[0.08] text-neutral-400 hover:text-white"
                      }`}
                    >
                      {asset.code}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {uri === null ? (
            <p className="mt-2 text-[12px] leading-relaxed text-neutral-400">
              Pick an asset above and the request appears here.
            </p>
          ) : (
            <>
              <p className="mono mt-2 break-all rounded-xl bg-black/40 p-3 text-[11.5px] leading-relaxed text-neutral-300">
                {uri}
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <CopyButton value={uri} label="Copy request" />
                <span className="text-[11px] text-neutral-500">
                  {NETWORKS[network].label}
                </span>
              </div>
              <ul className="mt-3 space-y-1.5 text-[11.5px] leading-relaxed text-neutral-500">
                <li>
                  Paid straight to{" "}
                  <span className="mono text-neutral-300">
                    {destination.slice(0, 4)}…{destination.slice(-4)}
                  </span>
                  {usingFixtureAddress
                    ? " — the fixture till, until a receiving account is set in Merchant settings."
                    : " — this shop's own account. Nothing is held on the way."}
                </li>
                {kind === "fixed" ? (
                  <li>
                    {previewAmount === null ? (
                      <>
                        No example rate for {previewAsset?.code}, so the preview leaves{" "}
                        <span className="mono text-neutral-300">amount</span> out and the
                        payer&apos;s wallet asks for the figure.
                      </>
                    ) : (
                      <>
                        <span className="mono text-neutral-300">amount</span> shown at an example
                        rate of 1 {previewAsset?.code} ={" "}
                        <span className="mono text-neutral-300">
                          {fmtMinor(roundMinor((previewRate ?? 0) * 100), currency)}
                        </span>
                        . Paper cannot re-quote, so a fixed price holds in a stablecoin and drifts
                        in anything else.
                      </>
                    )}
                  </li>
                ) : (
                  <li>
                    No <span className="mono text-neutral-300">amount</span>: the payer&apos;s wallet
                    asks for the figure, and the suggestions above are printed on the card.
                  </li>
                )}
              </ul>
            </>
          )}
        </section>

        <ErrorText message={error} />

        <div className="grid grid-cols-2 gap-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>{isEdit ? "Save changes" : "Create code"}</Button>
        </div>
      </div>
    </Modal>
  );
}
