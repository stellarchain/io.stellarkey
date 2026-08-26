"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { useMerchant } from "@/hooks/useMerchant";
import { triggerHaptic } from "@/lib/haptics";
import { NETWORKS } from "@/lib/stellar";
import { assetKey } from "@/lib/merchant/charge";
import { counterCodeAvailability } from "@/lib/merchant/counter-codes";
import { fmtMinor } from "@/lib/merchant/money";
import type { AcceptedAsset, CounterCode } from "@/lib/merchant/types";
import { Button, CopyButton, Modal, ModalHeader, Notice } from "../ui";
import { IconInfo, IconPrinter } from "./icons";

/** A6 in millimetres, and the code's printed width inside it. */
const A6_WIDTH_MM = 105;
const A6_HEIGHT_MM = 148;
/**
 * The symbol itself is 44 mm across — the rule of thumb is ten times the width
 * in scanning distance, so 44 mm reads comfortably at arm's length and still
 * works from across the counter. The quiet zone is white paper the code needs
 * around it to be found at all; it is drawn here rather than baked into the
 * image, so the printed symbol is exactly 44 mm and not 44 mm minus its margin.
 */
const QR_WIDTH_MM = 44;
const QR_QUIET_MM = 5.5;
/** Shares of the card's width, so one markup prints and previews. */
const QR_QUIET_CQW = (QR_QUIET_MM / A6_WIDTH_MM) * 100;
const QR_BOX_CQW = ((QR_WIDTH_MM + 2 * QR_QUIET_MM) / A6_WIDTH_MM) * 100;

/**
 * The app is hidden rather than the poster re-parented: the card is portalled
 * straight onto `document.body`, so one attribute selector beats the blanket
 * `body > *` rule and nothing else survives onto the page.
 */
const PRINT_CSS = `
@page { size: ${A6_WIDTH_MM}mm ${A6_HEIGHT_MM}mm; margin: 0; }

[data-counter-poster-print] { display: none; }

@media print {
  html, body {
    margin: 0 !important;
    padding: 0 !important;
    background: #ffffff !important;
  }
  /* The app's ambient gradients are ::before/::after on body, which the
     child selector below cannot reach — they would wash the sheet in colour. */
  body::before,
  body::after { display: none !important; content: none !important; }
  body > * { display: none !important; }
  body > [data-counter-poster-print] {
    display: block !important;
    width: ${A6_WIDTH_MM}mm;
    height: ${A6_HEIGHT_MM}mm;
    overflow: hidden;
    background: #ffffff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
`;

/* The print copy only exists in a browser, and nothing about that changes
   while the page is up, so the portal is gated on a snapshot rather than an
   effect that would set state on mount. */
const subscribeNothing = () => () => {};
const readMounted = () => true;
const readNotMounted = () => false;

function assetLine(assets: AcceptedAsset[]): string {
  const codes = assets.map((asset) => asset.code);
  if (codes.length === 0) return "any Stellar asset";
  if (codes.length === 1) return codes[0];
  return `${codes.slice(0, -1).join(", ")} or ${codes[codes.length - 1]}`;
}

/**
 * One card, two sizes. Every figure inside is expressed in `cqw` — a share of
 * the card's own width — so the on-screen preview and the 105 mm print are the
 * same drawing, and the QR is 44 mm on paper wherever it is rendered.
 */
function PosterFace({
  shopName,
  addressLines,
  taxId,
  title,
  priceLine,
  suggestionLine,
  qrDataUrl,
  assetsText,
  memo,
  footer,
}: {
  shopName: string;
  addressLines: string[];
  taxId: string;
  title: string;
  priceLine: string;
  suggestionLine: string | null;
  qrDataUrl: string | null;
  assetsText: string;
  memo: string;
  footer: string;
}) {
  return (
    <div
      style={{
        containerType: "inline-size",
        width: "100%",
        height: "100%",
        background: "#ffffff",
        color: "#000000",
      }}
    >
      <div
        style={{
          display: "flex",
          height: "100%",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "space-between",
          boxSizing: "border-box",
          padding: "7cqw 7cqw",
          textAlign: "center",
        }}
      >
        {/* Who is being paid */}
        <div style={{ width: "100%" }}>
          <p
            style={{
              margin: 0,
              fontSize: "7.2cqw",
              fontWeight: 700,
              letterSpacing: "-0.02em",
              lineHeight: 1.1,
            }}
          >
            {shopName}
          </p>
          {(addressLines.length > 0 || taxId) && (
            <p style={{ margin: "1.6cqw 0 0", fontSize: "2.8cqw", lineHeight: 1.35 }}>
              {[...addressLines, taxId].filter(Boolean).join(" · ")}
            </p>
          )}
          <div
            style={{
              margin: "4cqw auto 0",
              width: "18cqw",
              height: "0.5mm",
              background: "#000000",
            }}
          />
        </div>

        {/* What this code asks for */}
        <div style={{ width: "100%" }}>
          <p style={{ margin: 0, fontSize: "5.4cqw", fontWeight: 650, lineHeight: 1.2 }}>
            {title}
          </p>
          <p style={{ margin: "1.6cqw 0 0", fontSize: "4.4cqw", fontWeight: 600 }}>{priceLine}</p>
          {suggestionLine && (
            <p
              style={{
                margin: "1.2cqw 0 0",
                fontSize: "3.6cqw",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              {suggestionLine}
            </p>
          )}
          <p
            style={{
              margin: "3.4cqw 0 0",
              fontSize: "4cqw",
              fontWeight: 500,
              lineHeight: 1.25,
            }}
          >
            Pay with any Stellar wallet
          </p>
        </div>

        {/* The code: 44 mm of symbol inside 5.5 mm of quiet zone */}
        <div
          style={{
            width: `${QR_BOX_CQW}cqw`,
            border: "0.3mm solid #000000",
            padding: `${QR_QUIET_CQW}cqw`,
            boxSizing: "border-box",
            background: "#ffffff",
          }}
        >
          {qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qrDataUrl}
              alt={`Payment code for ${title} at ${shopName}`}
              style={{ display: "block", width: "100%", aspectRatio: "1 / 1" }}
            />
          ) : (
            <div
              role="status"
              aria-label="Drawing the payment code"
              style={{
                width: "100%",
                aspectRatio: "1 / 1",
                background: "repeating-linear-gradient(45deg,#eeeeee 0 4px,#ffffff 4px 8px)",
              }}
            />
          )}
        </div>

        {/* What it takes, and the memo a hand-typed payment must quote */}
        <div style={{ width: "100%" }}>
          <p style={{ margin: 0, fontSize: "3.4cqw", fontWeight: 600 }}>Accepts {assetsText}</p>
          <p
            style={{
              margin: "1.4cqw 0 0",
              fontSize: "3cqw",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          >
            Memo {memo}
          </p>
        </div>

        {/* Small print */}
        <p
          style={{
            margin: 0,
            width: "100%",
            fontSize: "2.7cqw",
            lineHeight: 1.4,
            textWrap: "balance",
          }}
        >
          {footer}
        </p>
      </div>
    </div>
  );
}

export function CounterPosterModal({
  code,
  onClose,
}: {
  code: CounterCode | null;
  onClose: () => void;
}) {
  if (!code) return null;
  return <CounterPoster key={code.id} code={code} onClose={onClose} />;
}

function CounterPoster({ code, onClose }: { code: CounterCode; onClose: () => void }) {
  const { counterCodePayUriFor, settings } = useMerchant();

  const [chosenKey, setChosenKey] = useState(() =>
    code.acceptedAssets.length > 0 ? assetKey(code.acceptedAssets[0]) : "",
  );
  const [now] = useState(() => Date.now());
  const [qr, setQr] = useState<{ uri: string; dataUrl: string } | null>(null);
  const mounted = useSyncExternalStore(subscribeNothing, readMounted, readNotMounted);

  const asset =
    code.acceptedAssets.find((a) => assetKey(a) === chosenKey) ?? code.acceptedAssets[0] ?? null;

  const shopName = settings.profile.name.trim() || "Your shop";
  /* Paper cannot count, so the memo is fixed: every payment against this card
     carries it, and Horizon totals the account on it. */
  const memo = code.memoPrefix;
  const printedAmount = asset
    ? code.quotes.find((quote) => assetKey(quote.asset) === assetKey(asset))?.amount ?? null
    : null;
  const uri = asset ? counterCodePayUriFor(code, asset) : null;
  const availability = counterCodeAvailability(code, now);
  const receivingAccountChanged = settings.receivingPublicKey !== code.destination;
  const canShare = availability === "active" && !receivingAccountChanged && uri !== null;

  /* A real encoding, at a resolution that still has ink at 44 mm and 300 dpi. */
  useEffect(() => {
    if (!uri) return;
    let alive = true;
    void (async () => {
      try {
        const dataUrl = await QRCode.toDataURL(uri, {
          width: 1024,
          margin: 0,
          errorCorrectionLevel: "M",
          color: { dark: "#000000", light: "#ffffff" },
        });
        if (alive) setQr({ uri, dataUrl });
      } catch {
        if (alive) setQr(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [uri]);

  /* Never show one asset's code while another asset's is still encoding. */
  const qrDataUrl = qr !== null && uri !== null && qr.uri === uri ? qr.dataUrl : null;

  const priceLine =
    code.kind === "fixed" && code.amountMinor !== null
      ? `${fmtMinor(code.amountMinor, code.currency)}${printedAmount && asset ? ` · ${printedAmount} ${asset.code}` : ""}`
      : code.kind === "tip"
        ? "Thank you — any amount"
        : "Choose your amount";

  const suggestionLine =
    code.kind !== "fixed" && code.suggestedMinor.length > 0
      ? code.suggestedMinor.map((minor) => fmtMinor(minor, code.currency)).join("  ·  ")
      : null;

  const face = (
    <PosterFace
      shopName={shopName}
      addressLines={settings.profile.addressLines}
      taxId={settings.profile.taxId}
      title={code.title}
      priceLine={priceLine}
      suggestionLine={suggestionLine}
      qrDataUrl={qrDataUrl}
      assetsText={asset ? asset.code : assetLine(code.acceptedAssets)}
      memo={memo}
      footer={
        settings.profile.receiptFooter.trim() ||
        "Payments go straight to this shop's own Stellar account. Nothing is held by anyone in between, and a refund is an ordinary payment back."
      }
    />
  );

  return (
    <>
      <Modal open onClose={onClose} wide>
        <ModalHeader
          title="Counter poster"
          subtitle={`${code.title} · A6 card, ${A6_WIDTH_MM} × ${A6_HEIGHT_MM} mm`}
          onClose={onClose}
        />

        <div className="space-y-5 p-4 sm:p-6">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            {/* Preview: the same drawing the printer gets, scaled by its width. */}
            <div
              aria-label="Poster preview"
              className="w-full max-w-[248px] shrink-0 overflow-hidden rounded-[10px] shadow-[0_18px_40px_-16px_rgba(0,0,0,0.9)] ring-1 ring-white/15"
              style={{ aspectRatio: `${A6_WIDTH_MM} / ${A6_HEIGHT_MM}` }}
            >
              {face}
            </div>

            <div className="min-w-0 flex-1 space-y-3">
              {code.acceptedAssets.length > 1 && (
                <div className="space-y-1.5">
                  <span className="field-label">Code asks for</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {code.acceptedAssets.map((option) => {
                      const key = assetKey(option);
                      const on = asset !== null && assetKey(asset) === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          aria-pressed={on}
                          onClick={() => {
                            triggerHaptic("selection");
                            setChosenKey(key);
                          }}
                          className={`mono rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition-colors ${
                            on
                              ? "bg-[#0A84FF] text-white"
                              : "bg-white/[0.08] text-neutral-400 hover:text-white"
                          }`}
                        >
                          {option.code}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11.5px] leading-relaxed text-neutral-500">
                    One code names one asset. Print a card for each, or stand them side by side.
                  </p>
                </div>
              )}

              <dl className="panel-inset divide-y divide-white/[0.08] text-[12.5px]">
                <div className="flex items-baseline justify-between gap-3 px-3.5 py-2.5">
                  <dt className="text-neutral-400">Card</dt>
                  <dd className="mono text-white">
                    A6 · {A6_WIDTH_MM} × {A6_HEIGHT_MM} mm
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 px-3.5 py-2.5">
                  <dt className="text-neutral-400">Code</dt>
                  <dd className="mono text-white">
                    {QR_WIDTH_MM} mm + {QR_QUIET_MM} mm quiet
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 px-3.5 py-2.5">
                  <dt className="text-neutral-400">Reads at</dt>
                  <dd className="mono text-white">44 cm+</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 px-3.5 py-2.5">
                  <dt className="text-neutral-400">Memo</dt>
                  <dd className="mono text-white">{memo}</dd>
                </div>
                {printedAmount && asset && (
                  <div className="flex items-baseline justify-between gap-3 px-3.5 py-2.5">
                    <dt className="text-neutral-400">Exact request</dt>
                    <dd className="mono text-white">{printedAmount} {asset.code}</dd>
                  </div>
                )}
              </dl>

              <p className="text-[11.5px] leading-relaxed text-neutral-500">
                44 mm is the smallest code that still reads at arm&apos;s length: the ten-to-one
                rule of thumb puts it at 44 cm, and a phone camera with autofocus does better.
              </p>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <Button
                  disabled={!canShare || !qrDataUrl}
                  onClick={() => {
                    triggerHaptic("light");
                    window.print();
                  }}
                >
                  <IconPrinter size={16} />
                  Print
                </Button>
                {canShare && uri ? (
                  <CopyButton
                    value={uri}
                    label="Copy request"
                    iconSize={15}
                    className="btn btn-secondary w-full"
                  />
                ) : (
                  <Button variant="secondary" disabled>
                    {uri ? "Sharing disabled" : "Request unavailable"}
                  </Button>
                )}
              </div>
            </div>
          </div>

          <Notice tone={availability !== "active" || receivingAccountChanged || !uri ? "warn" : "info"}>
            <span className="flex items-start gap-2.5">
              <IconInfo
                size={15}
                className={`mt-[1px] shrink-0 ${
                  availability !== "active" || receivingAccountChanged || !uri
                    ? "text-[#FF9F0A]"
                    : "text-neutral-400"
                }`}
              />
              <span>
                {!uri ? (
                  <>
                    <span className="font-semibold text-white">Incomplete legacy record. </span>
                    This saved code has no reproducible publication request and cannot be printed.
                  </>
                ) : availability !== "active" ? (
                  <>
                    <span className="font-semibold text-white">
                      {availability === "expired" ? "Expired. " : "Retired. "}
                    </span>
                    Existing paper is still readable, but new printing is disabled and matching
                    ledger payments are no longer filed to this code.
                  </>
                ) : receivingAccountChanged ? (
                  <>
                    <span className="font-semibold text-white">Receiving account changed. </span>
                    This poster still pays {code.destination.slice(0, 4)}…{code.destination.slice(-4)}
                    on {NETWORKS[code.network].label}. Re-select that account for reconciliation or
                    retire this code before sharing it.
                  </>
                ) : (
                  <>
                    <span className="font-semibold text-white">What prints. </span>
                    The card alone, black on white at A6 — no app chrome, no background. The code is
                    a SEP-7 request against this shop&apos;s own account on{" "}
                    {NETWORKS[code.network].label}, and the paper carries all of it.
                  </>
                )}
              </span>
            </span>
          </Notice>
        </div>
      </Modal>

      {/* The print copy: hidden on screen, and the only thing left on paper. */}
      {mounted &&
        createPortal(
          <div data-counter-poster-print="">
            <style>{PRINT_CSS}</style>
            {face}
          </div>,
          document.body,
        )}
    </>
  );
}
