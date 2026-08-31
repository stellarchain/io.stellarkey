"use client";

import { useEffect, useId, useState } from "react";
import { useWalletIdentity, useWalletPreferences } from "@/hooks/useWallet";
import { NETWORKS } from "@/lib/stellar";
import { activityAmountLines, opTypeLabel } from "@/lib/format";
import type { ActivityItem } from "@/lib/types";
import { triggerHaptic } from "@/lib/haptics";
import { loadPrivateTxNote, savePrivateTxNote } from "@/lib/vault";
import { Button, CopyButton, HashValue, Modal, ModalHeader } from "./ui";
import { FiatValue } from "./FiatValue";
import { IconCheck, IconClose, IconExternal, IconRefresh, IconShare } from "./icons";
import { activityAssetPresentation } from "@/lib/transaction-intent";

export function decodePrivateMemoHex(memoHex: string | undefined): string | null {
  if (!memoHex || memoHex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(memoHex)) return null;
  try {
    const bytes = Uint8Array.from(
      memoHex.match(/.{2}/g) ?? [],
      byte => Number.parseInt(byte, 16),
    );
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function TxDetailModal({
  item,
  onClose,
}: {
  item: ActivityItem | null;
  onClose: () => void;
}) {
  const { network } = useWalletIdentity();
  const { privacyMode } = useWalletPreferences();
  const [copiedReceipt, setCopiedReceipt] = useState(false);
  const [note, setNote] = useState("");
  const noteFieldId = useId();
  const [noteError, setNoteError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!item) return;
    void loadPrivateTxNote(item.hash)
      .then((value) => {
        if (alive) setNote(value);
      })
      .catch((cause) => {
        if (alive) setNoteError(cause instanceof Error ? cause.message : "Unable to decrypt note.");
      });
    return () => {
      alive = false;
    };
  }, [item]);

  async function handleSaveNote() {
    if (!item) return;
    setNoteError(null);
    try {
      await savePrivateTxNote(item.hash, note);
    } catch (cause) {
      setNoteError(cause instanceof Error ? cause.message : "Unable to encrypt note.");
    }
  }
  if (!item) return null;

  const incoming = item.direction === "in";
  const presentedAsset = activityAssetPresentation(item);
  const amountLines = activityAmountLines(item);
  const privateMemo = decodePrivateMemoHex(item.private?.memoHex);

  const explorerUrl = NETWORKS[network].explorerTxUrl(item.hash);
  const labUrl = `https://laboratory.stellar.org/#explorer?resource=transactions&endpoint=single&values=${encodeURIComponent(
    item.hash,
  )}&network=${network}`;

  const receiptSummary = `Stellar Transaction Receipt
Title: ${item.title}
Status: ${item.pending ? "Confirming" : item.successful ? "Confirmed" : "Failed"}
Network: Stellar ${NETWORKS[network].label}
Amount: ${amountLines.length > 0 ? amountLines.map((line) => line.display).join(" / ") : "N/A"}
Asset Issuer: ${item.swap ? `Debited: ${item.swap.debit.assetIssuer ?? "Native"}; Credited: ${item.swap.credit.assetIssuer ?? "Native"}` : presentedAsset.issuer ?? (presentedAsset.isNative ? "Native" : "N/A")}
Date: ${new Date(item.createdAt).toLocaleString("en-US")}
Counterparty: ${item.counterparty ?? "N/A"}
Hash: ${item.hash}
Explorer: ${explorerUrl}`;

  async function handleShareReceipt() {
    triggerHaptic("selection");
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({
          title: `Stellar Receipt: ${item?.title}`,
          text: receiptSummary,
          url: explorerUrl,
        });
        triggerHaptic("success");
      } catch {
        void 0;
      }
    } else {
      await navigator.clipboard.writeText(receiptSummary);
      setCopiedReceipt(true);
      triggerHaptic("success");
      window.setTimeout(() => setCopiedReceipt(false), 2000);
    }
  }

  return (
    <Modal open onClose={onClose}>
      <ModalHeader
        title={item.title}
        subtitle={new Date(item.createdAt).toLocaleString("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
        })}
        onClose={onClose}
      />
      <div className="p-4 sm:p-6">
        {/* Status Badge & Amount */}
        <div className="flex flex-col items-center pb-3 pt-1">
          <span
            className="flex h-12 w-12 items-center justify-center rounded-full text-xl"
            style={{
              color: item.pending ? "#FF9F0A" : item.successful ? "#30D158" : "#FF453A",
              background: item.pending ? "rgba(255,159,10,0.15)" : item.successful ? "rgba(48,209,88,0.15)" : "rgba(255,69,58,0.15)",
            }}
          >
            {item.pending ? <IconRefresh size={24} /> : item.successful ? <IconCheck size={24} /> : <IconClose size={24} />}
          </span>
          <p className="mt-3 text-[13px] font-semibold text-neutral-400">
            {item.pending
              ? "Confirming on Stellar"
              : item.private
                ? "Verified locally"
              : item.successful
                ? "Transaction Confirmed"
                : "Transaction Failed"}
          </p>
          {item.swap || item.internalTransfer ? (
            <div className="mt-3 w-full rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
              {amountLines.map((line) => (
                <div
                  key={`${line.balance ?? "asset"}:${line.direction}`}
                  className="flex items-center justify-between gap-3 py-1 first:pt-0 last:pb-0"
                >
                  <span className="text-[12px] font-medium text-neutral-400">
                    {line.balance
                      ? `${line.balance === "public" ? "Public" : "Private"} balance`
                      : line.direction === "out"
                        ? "You paid"
                        : "You received"}
                  </span>
                  <span
                    className={`mono whitespace-nowrap text-[16px] font-semibold ${
                      line.direction === "out" ? "text-[#FF453A]" : "text-[#30D158]"
                    }`}
                  >
                    {privacyMode ? "••••••" : line.display}
                  </span>
                </div>
              ))}
            </div>
          ) : item.amount !== null ? (
            <p className="display-h mt-1 text-[32px] font-light text-white">
              {privacyMode ? "••••••" : amountLines[0]?.display.replace(/\s+\S+$/, "")}{" "}
              {presentedAsset.code && (
                <span
                  className="mono text-[18px] text-neutral-400 font-normal"
                  title={presentedAsset.detailLabel ?? undefined}
                >
                  {presentedAsset.code}
                </span>
              )}
            </p>
          ) : null}
          {!item.swap && !item.internalTransfer && item.amount !== null && presentedAsset.code && (
            <FiatValue
              amount={item.amount}
              code={presentedAsset.code}
              issuer={presentedAsset.issuer}
              isNative={presentedAsset.isNative}
              className="mt-1 text-[12.5px] text-neutral-400"
            />
          )}
        </div>

        {/* Details list */}
        <div className="panel-inset mt-4 divide-y divide-white/[0.08]">
          <Row label="Operation">
            <span className="text-[13px] text-white capitalize">
              {opTypeLabel(item.type)}
            </span>
          </Row>
          {item.counterparty && (
            <Row label={incoming ? (item.type === "create_account" ? "Funder" : "From") : "To"}>
              <HashValue
                value={item.counterparty}
                className="justify-end text-[12px] text-neutral-300"
              />
            </Row>
          )}
          {item.swap ? (
            <>
              {item.swap.debit.assetIssuer && (
                <Row label="Debited Issuer">
                  <HashValue
                    value={item.swap.debit.assetIssuer}
                    className="justify-end text-[12px] text-neutral-300"
                  />
                </Row>
              )}
              {item.swap.credit.assetIssuer && (
                <Row label="Credited Issuer">
                  <HashValue
                    value={item.swap.credit.assetIssuer}
                    className="justify-end text-[12px] text-neutral-300"
                  />
                </Row>
              )}
            </>
          ) : presentedAsset.issuer ? (
            <Row label="Asset Issuer">
              <HashValue
                value={presentedAsset.issuer}
                className="justify-end text-[12px] text-neutral-300"
              />
            </Row>
          ) : null}
          {item.type === "create_account" && (
            <Row label="Account Creation">
              <span className="text-[12px] font-semibold text-[#30D158]">
                ✨ Genesis Account Activation
              </span>
            </Row>
          )}
          <Row label="Network">
            <span className="text-[13px] text-white capitalize">
              {NETWORKS[network].label}
            </span>
          </Row>
          {item.private?.actionIndex !== undefined ? (
            <Row label="Private action">
              <span className="mono text-[13px] text-white">#{item.private.actionIndex}</span>
            </Row>
          ) : (
            <Row label="Tx Hash">
              <HashValue
                value={item.hash}
                className="justify-end text-[12px] text-neutral-400"
              />
            </Row>
          )}
          {item.private?.actionKind === "transfer" && (
            <Row label="Private memo">
              <span className="max-w-[65%] break-words text-right text-[13px] text-white">
                {privacyMode ? "••••••" : privateMemo ?? "None"}
              </span>
            </Row>
          )}
        </div>

        {/* Private Transaction Note / Tag */}
        <div className="mt-3.5 panel-inset p-3.5 space-y-1.5">
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-400" htmlFor={noteFieldId}>
            Private Transaction Note (Encrypted Locally)
          </label>
          <input
            id={noteFieldId}
            type="text"
            placeholder="e.g. 🧾 Freelance Design Invoice #104"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => void handleSaveNote()}
            className="input !h-11 text-base md:!h-8 sm:text-[13px]"
            maxLength={60}
          />
          {noteError && <p role="alert" className="text-[11px] text-[#FF453A]">{noteError}</p>}
        </div>

        {/* Action Links */}
        {!item.private && <div className="mt-5 flex flex-wrap gap-2">
          {item.counterparty && (
            <CopyButton
              value={item.counterparty}
              label={incoming ? "Copy Sender" : "Copy Recipient"}
              className="chip flex-1 justify-center"
            />
          )}
          <CopyButton value={item.hash} label="Copy Hash" className="chip flex-1 justify-center" />
          <button
            type="button"
            onClick={() => void handleShareReceipt()}
            className="chip flex-1 justify-center flex items-center gap-1.5 text-white"
          >
            <IconShare size={12} />
            <span>{copiedReceipt ? "Copied Receipt!" : "Share Receipt"}</span>
          </button>
          <a
            className="chip flex-1 justify-center"
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => triggerHaptic("light")}
          >
            Stellarchain <IconExternal size={11} />
          </a>
          <a
            className="chip flex-1 justify-center text-neutral-400 hover:text-white"
            href={labUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => triggerHaptic("light")}
          >
            Stellar Lab <IconExternal size={11} />
          </a>
        </div>}

        <Button variant="ghost" className="mt-4 w-full" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-4 py-3">
      <span className="shrink-0 pt-0.5 text-[13px] font-medium text-neutral-400">
        {label}
      </span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}
